import { randomUUID } from 'crypto';

/**
 * OpenAI-compatible response envelope.
 *
 * Completion ids, timestamps, single-choice framing and the error body are
 * built here so the streaming and non-streaming paths, and the gateway's JSON
 * errors, cannot drift apart.
 */

/** Seconds since the epoch, the unit OpenAI uses for `created`. */
export function unixSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

/** A completion identifier with the prefix OpenAI clients expect. */
export function completionId(): string {
	return `chatcmpl-${randomUUID()}`;
}

export interface ChunkEnvelope {
	id: string;
	object: 'chat.completion.chunk';
	created: number;
	model: string;
}

/** The fields every chunk of one streamed completion shares. */
export function chunkEnvelope(model: string): ChunkEnvelope {
	return {
		id: completionId(),
		object: 'chat.completion.chunk',
		created: unixSeconds(),
		model,
	};
}

export interface ChunkChoice {
	index: 0;
	delta: Record<string, unknown>;
	finish_reason: string | null;
}

/**
 * One streamed choice. OpenWire answers with exactly one choice (n > 1 is
 * rejected by assertSingleChoice), so the index is fixed here rather than at
 * every call site.
 */
export function chunkChoice(
	delta: Record<string, unknown>,
	finishReason: string | null = null,
): ChunkChoice {
	return { index: 0, delta, finish_reason: finishReason };
}

/**
 * The error body shared by JSON responses and in-stream error frames. `type`
 * differs by transport: JSON responses report `api_error`, frames already
 * inside an open stream report `server_error`.
 */
export function errorEnvelope(
	message: string,
	type: 'api_error' | 'server_error',
	code?: number,
): { error: { message: string; type: string; code?: number } } {
	return { error: { message, type, ...(code ? { code } : {}) } };
}
