import { badRequest } from './errors';
import { assertSchemaSupported, isPlainObject, validateAgainstSchema } from './schema';

/**
 * Server-side enforcement of `response_format`.
 *
 * The VS Code LM path offers no provider-level JSON mode, so prompt discipline
 * alone cannot be a contract. OpenWire hardens the instruction, salvages JSON
 * from prose, validates it, and retries once. If it still cannot deliver valid
 * JSON it fails loudly rather than returning prose that claims to be JSON.
 */

export type ResponseFormat =
	| { mode: 'text' }
	| { mode: 'json_object' }
	| { mode: 'json_schema'; name: string; schema: Record<string, any> };

export function parseResponseFormat(raw: unknown): ResponseFormat {
	if (raw === undefined || raw === null) return { mode: 'text' };

	if (!isPlainObject(raw)) {
		throw badRequest('response_format must be an object');
	}

	const type = raw.type;
	if (type === undefined) {
		throw badRequest('response_format.type is required when response_format is supplied');
	}
	if (type === 'text') return { mode: 'text' };

	if (type === 'json_object') return { mode: 'json_object' };

	if (type === 'json_schema') {
		const spec = raw.json_schema;
		if (!isPlainObject(spec)) {
			throw badRequest('response_format.json_schema must be an object');
		}
		const schema = spec.schema;
		assertSchemaSupported(schema);
		const name = typeof spec.name === 'string' && spec.name ? spec.name : 'response';
		return { mode: 'json_schema', name, schema: schema as Record<string, any> };
	}

	throw badRequest(
		`Unsupported response_format.type "${String(type)}". Supported: text, json_object, json_schema`,
	);
}

export function isJsonMode(format: ResponseFormat): boolean {
	return format.mode !== 'text';
}

/** The instruction appended to the conversation to elicit bare JSON. */
export function buildJsonInstruction(format: ResponseFormat): string {
	if (format.mode === 'text') return '';

	const base =
		'Respond with a single valid JSON value and nothing else. ' +
		'Do not write any explanation, preamble, or commentary before or after it. ' +
		'Do not wrap the JSON in markdown code fences.';

	if (format.mode === 'json_schema') {
		return (
			`${base}\n\nThe JSON must conform to this schema:\n` +
			`${JSON.stringify(format.schema, null, 2)}`
		);
	}
	return base;
}

/** The harsher instruction used for the single repair attempt. */
export function buildRepairInstruction(
	format: ResponseFormat,
	invalidOutput: string,
	reason: string,
): string {
	const truncated = invalidOutput.length > 2000
		? `${invalidOutput.slice(0, 2000)}…`
		: invalidOutput;

	let instruction =
		'Your previous response was rejected because it was not valid JSON for this request.\n' +
		`Reason: ${reason}\n\n` +
		`Previous response:\n${truncated}\n\n` +
		'Return ONLY the corrected JSON value. ' +
		'Your entire message must start with { or [ and end with } or ]. ' +
		'No prose. No markdown fences.';

	if (format.mode === 'json_schema') {
		instruction += `\n\nIt must conform to this schema:\n${JSON.stringify(format.schema, null, 2)}`;
	}
	return instruction;
}

/**
 * Walk from an opening brace/bracket to its match, respecting string literals
 * and escapes. Returns the index of the closing character, or -1.
 */
function matchFrom(text: string, start: number): number {
	const open = text[start];
	const close = open === '{' ? '}' : ']';
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (let i = start; i < text.length; i++) {
		const ch = text[i];

		if (inString) {
			if (escaped) { escaped = false; continue; }
			if (ch === '\\') { escaped = true; continue; }
			if (ch === '"') inString = false;
			continue;
		}

		if (ch === '"') { inString = true; continue; }
		if (ch === open) { depth++; continue; }
		if (ch === close) {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Every balanced {...} / [...] span in the text, outermost first.
 *
 * A failed scan runs to the end of the input, so a pathological reply made
 * largely of unmatched opening brackets would be quadratic. Failures are
 * capped: legitimate output needs only a handful.
 */
const MAX_FAILED_SCANS = 32;

function balancedCandidates(text: string): string[] {
	const found: string[] = [];
	let failures = 0;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch !== '{' && ch !== '[') continue;
		const end = matchFrom(text, i);
		if (end === -1) {
			if (++failures >= MAX_FAILED_SCANS) break;
			continue;
		}
		found.push(text.slice(i, end + 1));
		i = end;
	}
	return found;
}

function tryParse(text: string): { value: unknown } | null {
	try {
		return { value: JSON.parse(text) };
	} catch {
		return null;
	}
}

/**
 * Recover a JSON value from model output that may be wrapped in prose or
 * markdown fences. Returns the parsed value, or null when nothing parses.
 */
export function extractJson(text: string): { raw: string; value: unknown } | null {
	const trimmed = text.trim();
	if (!trimmed) return null;

	const direct = tryParse(trimmed);
	if (direct) return { raw: trimmed, value: direct.value };

	for (const match of trimmed.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)) {
		const body = match[1].trim();
		const parsed = tryParse(body);
		if (parsed) return { raw: body, value: parsed.value };
	}

	const candidates = balancedCandidates(trimmed);
	// Prefer objects: structured-output callers almost always expect one.
	const parsedCandidates = candidates
		.map(c => ({ raw: c, parsed: tryParse(c) }))
		.filter((c): c is { raw: string; parsed: { value: unknown } } => c.parsed !== null);

	const object = parsedCandidates.find(c => isPlainObject(c.parsed.value));
	const chosen = object ?? parsedCandidates[0];
	return chosen ? { raw: chosen.raw, value: chosen.parsed.value } : null;
}

export type JsonValidation =
	| { ok: true; json: string; value: unknown }
	| { ok: false; reason: string };

/** Extract, parse and (for json_schema) schema-check a model response. */
export function validateJsonOutput(text: string, format: ResponseFormat): JsonValidation {
	if (format.mode === 'text') {
		return { ok: true, json: text, value: text };
	}

	const extracted = extractJson(text);
	if (!extracted) {
		return { ok: false, reason: 'response did not contain a parseable JSON value' };
	}

	// OpenAI's json_object contract promises an object, not any JSON value.
	// Returning a bare scalar or array here would break `JSON.parse(...).field`.
	if (format.mode === 'json_object' && !isPlainObject(extracted.value)) {
		return {
			ok: false,
			reason: 'response_format json_object requires a JSON object, but the response was a ' +
				(Array.isArray(extracted.value) ? 'array' : typeof extracted.value),
		};
	}

	if (format.mode === 'json_schema') {
		const errors = validateAgainstSchema(extracted.value, format.schema);
		if (errors.length > 0) {
			return {
				ok: false,
				reason: `JSON did not match the supplied schema: ${errors.slice(0, 5).join('; ')}`,
			};
		}
	}

	return {
		ok: true,
		json: JSON.stringify(extracted.value),
		value: extracted.value,
	};
}
