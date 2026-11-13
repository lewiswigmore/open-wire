import type { ServerResponse } from 'http';

/**
 * Transport-level SSE framing shared by the chat pipeline and the gateway.
 * Chunk payloads shaped like chat.completion objects stay in chat.ts; this
 * module only knows how to move `data:` frames onto the wire.
 */

/** Write one `data:` frame unless the response has already ended. */
export function sseChunk(res: ServerResponse, payload: object): void {
	if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Terminate an SSE stream the way OpenAI-compatible clients expect. */
export function sseDone(res: ServerResponse): void {
	if (!res.writableEnded) res.write('data: [DONE]\n\n');
}

/**
 * Emit an error inside an already-open SSE stream, then terminate it cleanly.
 * Writing a bare JSON body here would corrupt the event stream.
 */
export function writeSseError(res: ServerResponse, message: string, code?: number): void {
	sseChunk(res, { error: { message, type: 'server_error', ...(code ? { code } : {}) } });
	sseDone(res);
}
