import { badRequest } from './errors';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
	kind: 'text';
	text: string;
}

export interface ImagePart {
	kind: 'image';
	mimeType: string;
	/** Raw base64 payload, without the data: URI prefix. */
	base64: string;
}

export type ContentPart = TextPart | ImagePart;

export interface NormalizedMessage {
	role: Role;
	parts: ContentPart[];
	/** Flattened text, for token counting and text-only transports. */
	text: string;
	tool_calls?: unknown[];
	tool_call_id?: string;
}

const SUPPORTED_IMAGE_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
]);

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const SUPPORTED_IMAGE_MIME_TYPES: string[] = [...SUPPORTED_IMAGE_TYPES].sort();

/**
 * Parse a data: URI into a mime type and base64 payload.
 * Returns null when the input is not a data: URI.
 */
export function parseDataUri(url: string): { mimeType: string; base64: string } | null {
	if (!url.startsWith('data:')) return null;

	const comma = url.indexOf(',');
	if (comma === -1) {
		throw badRequest('Malformed data: URI in image_url (missing comma separator)');
	}

	const meta = url.slice(5, comma);
	const payload = url.slice(comma + 1);

	if (!/;base64$/i.test(meta)) {
		throw badRequest('Only base64-encoded data: URIs are supported for image_url');
	}

	const mimeType = meta.replace(/;base64$/i, '').trim().toLowerCase();
	if (!mimeType) {
		throw badRequest('image_url data: URI must declare an image MIME type');
	}
	if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
		throw badRequest(
			`Unsupported image type "${mimeType}". Supported: ${[...SUPPORTED_IMAGE_TYPES].join(', ')}`,
		);
	}

	if (/\s/.test(payload)) {
		throw badRequest('image_url base64 payload must not contain whitespace');
	}
	const base64 = payload;
	const maxEncodedLength = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
	if (base64.length > maxEncodedLength) {
		throw badRequest('Decoded image exceeds 8 MiB');
	}
	if (!isCanonicalBase64Shape(base64)) {
		throw badRequest('image_url data: URI does not contain valid base64 data');
	}

	const bytes = Buffer.from(base64, 'base64');
	if (bytes.length === 0 || bytes.toString('base64') !== base64) {
		throw badRequest('image_url data: URI does not contain valid base64 data');
	}
	if (bytes.length > MAX_IMAGE_BYTES) {
		throw badRequest('Decoded image exceeds 8 MiB');
	}
	if (!matchesImageSignature(bytes, mimeType)) {
		throw badRequest(`Image data does not match declared image type "${mimeType}"`);
	}

	return { mimeType, base64 };
}

function isCanonicalBase64Shape(value: string): boolean {
	if (!value || value.length % 4 !== 0) return false;
	const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
	for (let i = 0; i < value.length - padding; i++) {
		const code = value.charCodeAt(i);
		const valid =
			(code >= 0x41 && code <= 0x5a) ||
			(code >= 0x61 && code <= 0x7a) ||
			(code >= 0x30 && code <= 0x39) ||
			code === 0x2b || code === 0x2f;
		if (!valid) return false;
	}
	for (let i = value.length - padding; i < value.length; i++) {
		if (value[i] !== '=') return false;
	}
	return true;
}

function matchesImageSignature(bytes: Buffer, mimeType: string): boolean {
	switch (mimeType) {
		case 'image/png':
			return bytes.length >= 8 && bytes.subarray(0, 8).equals(
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			);
		case 'image/jpeg':
			return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
		case 'image/gif': {
			const header = bytes.subarray(0, 6).toString('ascii');
			return header === 'GIF87a' || header === 'GIF89a';
		}
		case 'image/webp':
			return bytes.length >= 12 &&
				bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
				bytes.subarray(8, 12).toString('ascii') === 'WEBP';
		default:
			return false;
	}
}

/** Convert one OpenAI content part into our internal representation. */
function toContentPart(part: unknown): ContentPart | null {
	if (typeof part === 'string') {
		return { kind: 'text', text: part };
	}
	if (typeof part !== 'object' || part === null || Array.isArray(part)) {
		throw badRequest('Each content part must be a string or object');
	}

	const p = part as Record<string, any>;

	if (p.type === 'text') {
		if (typeof p.text !== 'string') {
			throw badRequest('text part must contain a string text value');
		}
		return { kind: 'text', text: p.text };
	}

	if (p.type === 'image_url') {
		const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
		if (typeof url !== 'string' || !url) {
			throw badRequest('image_url part is missing a url');
		}
		if (/^https?:/i.test(url)) {
			// Fetching remote URLs would let a caller drive requests from the user's
			// machine into their own network. Callers must inline the bytes instead.
			throw badRequest(
				'Remote image URLs are not supported. Inline the image as a base64 data: URI.',
			);
		}
		const parsed = parseDataUri(url);
		if (!parsed) {
			throw badRequest('image_url must be a base64 data: URI');
		}
		return { kind: 'image', mimeType: parsed.mimeType, base64: parsed.base64 };
	}

	if (p.type === 'input_audio' || p.type === 'file') {
		throw badRequest(`Content part type "${p.type}" is not supported by OpenWire`);
	}

	if (typeof p.type !== 'string' || !p.type) {
		throw badRequest('Each content part must specify a type');
	}
	throw badRequest(`Content part type "${p.type}" is not supported by OpenWire`);
}

/** Normalise message content into ordered parts. */
export function normalizeContentParts(content: unknown): ContentPart[] {
	if (typeof content === 'string') {
		return content ? [{ kind: 'text', text: content }] : [];
	}
	if (Array.isArray(content)) {
		const parts: ContentPart[] = [];
		for (const raw of content) {
			const part = toContentPart(raw);
			if (part) parts.push(part);
		}
		return parts;
	}
	if (content == null) return [];
	throw badRequest('message content must be a string, null, or an array of content parts');
}

/** Flatten parts to plain text. Non-text parts contribute nothing. */
export function partsToText(parts: ContentPart[]): string {
	return parts.map(p => (p.kind === 'text' ? p.text : '')).join('');
}

/** Extract text from content that is a string, an array of text parts, or something else. */
export function normalizeContent(content: unknown): string {
	return partsToText(normalizeContentParts(content));
}

/** True when any message carries an image part. */
export function hasImageParts(messages: NormalizedMessage[]): boolean {
	return messages.some(m => m.parts.some(p => p.kind === 'image'));
}

/** Normalise incoming messages to a flat role + parts array. */
export function normalizeMessages(raw: unknown): NormalizedMessage[] {
	if (!Array.isArray(raw)) {
		throw badRequest('messages must be an array');
	}
	if (raw.length === 0) {
		throw badRequest('messages must contain at least one message');
	}
	return raw.map((m, index) => {
		if (typeof m !== 'object' || m === null || Array.isArray(m)) {
			throw badRequest(`message at index ${index} must be an object`);
		}
		const role = m.role === 'developer' ? 'system' : m.role;
		if (!['system', 'user', 'assistant', 'tool'].includes(role)) {
			throw badRequest(`message at index ${index} has unsupported role "${String(m.role)}"`);
		}
		if (!Object.prototype.hasOwnProperty.call(m, 'content') &&
			!(role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)) {
			throw badRequest(`message at index ${index} content is required`);
		}
		if (m.tool_calls !== undefined && role !== 'assistant') {
			throw badRequest(`message at index ${index} tool_calls are only valid for assistant messages`);
		}
		if (role === 'assistant' && m.tool_calls !== undefined) {
			validateToolCalls(m.tool_calls, index);
		}
		if (role === 'tool' && (typeof m.tool_call_id !== 'string' || !m.tool_call_id)) {
			throw badRequest(`tool message at index ${index} must include tool_call_id`);
		}
		const parts = normalizeContentParts(m?.content);
		if (role !== 'user' && parts.some(part => part.kind === 'image')) {
			throw badRequest(`message at index ${index}: image parts are only supported in user messages`);
		}
		const hasContent = parts.some(part => part.kind === 'image' || part.text.length > 0);
		if (role === 'assistant') {
			if (!hasContent && (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0)) {
				throw badRequest(`assistant message at index ${index} requires content or tool_calls`);
			}
		} else if (!hasContent) {
			throw badRequest(`${role} message at index ${index} requires non-empty content`);
		}
		return {
			role: role as Role,
			parts,
			text: partsToText(parts),
			tool_calls: m?.tool_calls,
			tool_call_id: m?.tool_call_id,
		};
	});
}

function validateToolCalls(raw: unknown, messageIndex: number): void {
	if (!Array.isArray(raw) || raw.length === 0) {
		throw badRequest(`assistant message at index ${messageIndex} tool_calls must be a non-empty array`);
	}
	for (let index = 0; index < raw.length; index++) {
		const call = raw[index];
		const prefix = `assistant message at index ${messageIndex} tool_calls[${index}]`;
		if (typeof call !== 'object' || call === null || Array.isArray(call)) {
			throw badRequest(`${prefix} must be an object`);
		}
		if (typeof call.id !== 'string' || !call.id) {
			throw badRequest(`${prefix}.id must be a non-empty string`);
		}
		if (call.type !== 'function') {
			throw badRequest(`${prefix}.type must be "function"`);
		}
		if (typeof call.function !== 'object' || call.function === null || Array.isArray(call.function) ||
			typeof call.function.name !== 'string' || !call.function.name) {
			throw badRequest(`${prefix}.function.name must be a non-empty string`);
		}
		if (typeof call.function.arguments !== 'string') {
			throw badRequest(`${prefix}.function.arguments must be a JSON string`);
		}
		try {
			const parsed = JSON.parse(call.function.arguments);
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				throw new Error('arguments must decode to an object');
			}
		} catch {
			throw badRequest(`${prefix}.function.arguments must contain a JSON object`);
		}
	}
}

/** Inject a default system prompt when the request has no system message. */
export function injectSystemPrompt(
	msgs: NormalizedMessage[],
	prompt: string,
): NormalizedMessage[] {
	if (!prompt) return msgs;
	if (msgs.some(m => m.role === 'system')) return msgs;
	return [
		{ role: 'system', parts: [{ kind: 'text', text: prompt }], text: prompt },
		...msgs,
	];
}

/** Append a trailing instruction as its own user turn. */
export function appendInstruction(
	msgs: NormalizedMessage[],
	instruction: string,
): NormalizedMessage[] {
	if (!instruction) return msgs;
	return [
		...msgs,
		{ role: 'user', parts: [{ kind: 'text', text: instruction }], text: instruction },
	];
}
