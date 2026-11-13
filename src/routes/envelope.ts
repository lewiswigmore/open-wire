import { randomUUID } from 'crypto';
import type { ParamReport } from './params';

/**
 * The OpenAI-compatible response envelope.
 *
 * Identifiers, timestamps, single-choice framing and the capability report are
 * built here so the streaming and non-streaming paths cannot drift apart: a
 * client that works against one shape must work against the other.
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
 * The capability report attached to responses: what the caller sent that
 * OpenWire could not honour. Returns undefined when everything was honoured, so
 * callers can omit the key entirely instead of emitting an empty block.
 */
export function paramReportBlock(report: ParamReport): Record<string, unknown> | undefined {
	if (report.unsupported.length === 0 && report.unknown.length === 0) return undefined;
	return {
		unsupported_params: report.unsupported,
		unknown_params: report.unknown,
		note: 'These fields were accepted but had no effect. Enable openWire.server.strictParams to reject them instead.',
	};
}

/**
 * The error body shared by HTTP responses and in-stream error frames. `type`
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
