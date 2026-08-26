import { badRequest } from './errors';

/**
 * Request-parameter mapping and classification.
 *
 * Every field a caller sends lands in exactly one bucket: honoured, rejected,
 * or reported as ignored. Nothing is silently dropped.
 */

/** Params forwarded to the model via LanguageModelChatRequestOptions.modelOptions. */
const SAMPLING_PARAMS = [
	'temperature',
	'top_p',
	'max_tokens',
	'stop',
	'seed',
	'presence_penalty',
	'frequency_penalty',
] as const;

/** Params consumed by OpenWire itself rather than forwarded as sampling options. */
const STRUCTURAL_PARAMS = new Set([
	'model',
	'messages',
	'stream',
	'stream_options',
	'tools',
	'tool_choice',
	'response_format',
	'max_completion_tokens',
	'n',
]);

/**
 * Known OpenAI params OpenWire cannot honour on the VS Code LM path.
 * Reported back to the caller rather than ignored in silence.
 */
const KNOWN_UNSUPPORTED = new Set([
	'logprobs',
	'top_logprobs',
	'logit_bias',
	'user',
	'service_tier',
	'parallel_tool_calls',
	'store',
	'metadata',
	'modalities',
	'audio',
	'prediction',
	'reasoning_effort',
	'best_of',
	'echo',
	'suffix',
	'functions',
	'function_call',
]);

export const HONOURED_PARAMS: string[] = [...SAMPLING_PARAMS, ...STRUCTURAL_PARAMS].sort();
export const UNSUPPORTED_PARAMS: string[] = [...KNOWN_UNSUPPORTED].sort();

export interface ParamReport {
	/** Known OpenAI params present in the request that OpenWire cannot honour. */
	unsupported: string[];
	/** Fields OpenWire does not recognise at all. */
	unknown: string[];
}

/** Classify a request body so callers can be told what was actually applied. */
export function classifyParams(payload: unknown): ParamReport {
	const unsupported: string[] = [];
	const unknown: string[] = [];

	if (typeof payload !== 'object' || payload === null) {
		return { unsupported, unknown };
	}

	for (const key of Object.keys(payload)) {
		if (STRUCTURAL_PARAMS.has(key)) continue;
		if ((SAMPLING_PARAMS as readonly string[]).includes(key)) continue;
		if (KNOWN_UNSUPPORTED.has(key)) { unsupported.push(key); continue; }
		unknown.push(key);
	}

	return { unsupported: unsupported.sort(), unknown: unknown.sort() };
}

function requireNumber(value: unknown, name: string, min: number, max: number): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw badRequest(`${name} must be a finite number`);
	}
	if (value < min || value > max) {
		throw badRequest(`${name} must be between ${min} and ${max} (got ${value})`);
	}
	return value;
}

function normalizeStop(value: unknown): string[] {
	const list = Array.isArray(value) ? value : [value];
	if (list.length > 4) {
		throw badRequest('stop supports at most 4 sequences');
	}
	for (const item of list) {
		if (typeof item !== 'string') {
			throw badRequest('stop must be a string or an array of strings');
		}
	}
	return list as string[];
}

/**
 * Build the modelOptions bag forwarded to the VS Code LM API.
 * Invalid values are rejected rather than clamped: a silently altered request
 * is indistinguishable from an honoured one.
 */
export function buildModelOptions(payload: any): Record<string, unknown> {
	const options: Record<string, unknown> = {};
	if (typeof payload !== 'object' || payload === null) return options;

	if (payload.temperature !== undefined) {
		options.temperature = requireNumber(payload.temperature, 'temperature', 0, 2);
	}
	if (payload.top_p !== undefined) {
		options.top_p = requireNumber(payload.top_p, 'top_p', 0, 1);
	}
	if (payload.presence_penalty !== undefined) {
		options.presence_penalty = requireNumber(payload.presence_penalty, 'presence_penalty', -2, 2);
	}
	if (payload.frequency_penalty !== undefined) {
		options.frequency_penalty = requireNumber(payload.frequency_penalty, 'frequency_penalty', -2, 2);
	}

	// max_completion_tokens is the modern spelling; both map to the same option.
	const maxTokens = payload.max_tokens ?? payload.max_completion_tokens;
	if (maxTokens !== undefined && maxTokens !== null) {
		if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1) {
			throw badRequest('max_tokens must be a positive integer');
		}
		options.max_tokens = maxTokens;
	}

	if (payload.seed !== undefined) {
		if (typeof payload.seed !== 'number' || !Number.isInteger(payload.seed)) {
			throw badRequest('seed must be an integer');
		}
		options.seed = payload.seed;
	}

	if (payload.stop !== undefined && payload.stop !== null) {
		options.stop = normalizeStop(payload.stop);
	}

	return options;
}

/**
 * Reject requests asking for multiple choices. Returning a single choice for
 * n > 1 would look like success while breaking the caller's contract.
 */
export function assertSingleChoice(payload: any): void {
	if (payload?.n === undefined || payload.n === null) return;
	if (payload.n !== 1) {
		throw badRequest('n > 1 is not supported: OpenWire returns exactly one choice');
	}
}

/** True when the caller asked for usage to be included in a stream. */
export function wantsStreamUsage(payload: any): boolean {
	return payload?.stream_options?.include_usage === true;
}
