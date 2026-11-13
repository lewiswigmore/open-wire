import { describe, it, expect } from 'vitest';
import type { ServerResponse } from 'http';
import { writeSseComment, writeSseDone, writeSseError, writeSseFrame } from './sse';

/** Capture what the framing helpers write, without a real socket. */
function fakeResponse(options: { ended?: boolean } = {}) {
	const written: string[] = [];
	const res = {
		writableEnded: options.ended ?? false,
		write(chunk: string) {
			written.push(chunk);
			return true;
		},
	};
	return { res: res as unknown as ServerResponse, written };
}

describe('writeSseFrame', () => {
	it('writes one data frame holding the JSON payload', () => {
		const { res, written } = fakeResponse();
		writeSseFrame(res, { a: 1 });
		expect(written).toEqual(['data: {"a":1}\n\n']);
	});

	it('stays silent once the response has ended', () => {
		const { res, written } = fakeResponse({ ended: true });
		writeSseFrame(res, { a: 1 });
		writeSseDone(res);
		writeSseComment(res);
		expect(written).toEqual([]);
	});
});

describe('writeSseDone', () => {
	it('writes the terminator every OpenAI client expects', () => {
		const { res, written } = fakeResponse();
		writeSseDone(res);
		expect(written).toEqual(['data: [DONE]\n\n']);
	});
});

describe('writeSseComment', () => {
	it('writes a comment SSE parsers ignore', () => {
		const { res, written } = fakeResponse();
		writeSseComment(res, 'ping');
		expect(written).toEqual([': ping\n\n']);
	});
});

describe('writeSseError', () => {
	it('frames the error, then terminates the stream', () => {
		const { res, written } = fakeResponse();
		writeSseError(res, 'boom', 504);

		expect(written).toHaveLength(2);
		expect(JSON.parse(written[0].slice(6))).toEqual({
			error: { message: 'boom', type: 'server_error', code: 504 },
		});
		expect(written[1]).toBe('data: [DONE]\n\n');
	});

	it('omits the code when the error carries none', () => {
		const { res, written } = fakeResponse();
		writeSseError(res, 'boom');
		expect(JSON.parse(written[0].slice(6)).error).toEqual({
			message: 'boom',
			type: 'server_error',
		});
	});
});
