import type { ServerResponse } from 'http';
import { errorEnvelope } from './envelope';

/**
 * Server-sent event framing.
 *
 * Every frame is written through here so the `[DONE]` sentinel, heartbeat
 * comments and the in-stream error shape stay identical across endpoints, and so
 * nothing is written to a response that has already ended.
 */

/** Write one `data:` frame holding a JSON payload. */
export function writeSseFrame(res: ServerResponse, payload: unknown): void {
	if (res.writableEnded) return;
	res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Terminate a stream with the sentinel every OpenAI client expects. */
export function writeSseDone(res: ServerResponse): void {
	if (res.writableEnded) return;
	res.write('data: [DONE]\n\n');
}

/** A heartbeat comment. SSE parsers ignore lines that begin with a colon. */
export function writeSseComment(res: ServerResponse, comment = 'ping'): void {
	if (res.writableEnded) return;
	res.write(`: ${comment}\n\n`);
}

/**
 * Emit an error inside an already-open stream, then terminate it cleanly.
 * Writing a bare JSON body here would corrupt the event stream.
 */
export function writeSseError(res: ServerResponse, message: string, code?: number): void {
	writeSseFrame(res, errorEnvelope(message, 'server_error', code));
	writeSseDone(res);
}
