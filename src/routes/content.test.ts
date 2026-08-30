import { describe, it, expect } from 'vitest';
import {
	appendInstruction,
	hasImageParts,
	injectSystemPrompt,
	normalizeContent,
	normalizeContentParts,
	normalizeMessages,
	parseDataUri,
} from './content';
import { RequestError } from './errors';

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('normalizeContent', () => {
	it('passes through plain strings', () => {
		expect(normalizeContent('hello')).toBe('hello');
	});

	it('extracts text from a content part array', () => {
		const input = [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }];
		expect(normalizeContent(input)).toBe('Hello world');
	});

	it('handles mixed string and object arrays', () => {
		const input = ['Hello ', { type: 'text', text: 'world' }];
		expect(normalizeContent(input)).toBe('Hello world');
	});

	it('returns empty string for null/undefined', () => {
		expect(normalizeContent(null)).toBe('');
		expect(normalizeContent(undefined)).toBe('');
	});

	it('rejects malformed scalar content', () => {
		expect(() => normalizeContent(42)).toThrow(/content must be/);
	});
});

describe('image content parts', () => {
	it('preserves image parts instead of dropping them', () => {
		const input = [
			{ type: 'text', text: 'describe: ' },
			{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
		];
		const parts = normalizeContentParts(input);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toEqual({ kind: 'text', text: 'describe: ' });
		expect(parts[1]).toMatchObject({ kind: 'image', mimeType: 'image/png' });
	});

	it('flattens to text without inventing image text', () => {
		const input = [
			{ type: 'text', text: 'desc: ' },
			{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
		];
		expect(normalizeContent(input)).toBe('desc: ');
	});

	it('rejects remote image URLs to avoid server-side fetching', () => {
		const input = [{ type: 'image_url', image_url: { url: 'https://example.com/cat.png' } }];
		expect(() => normalizeContentParts(input)).toThrow(RequestError);
		expect(() => normalizeContentParts(input)).toThrow(/Remote image URLs are not supported/);
	});

	it('rejects unsupported image mime types', () => {
		const input = [{ type: 'image_url', image_url: { url: 'data:image/tiff;base64,QUJD' } }];
		expect(() => normalizeContentParts(input)).toThrow(/Unsupported image type/);
	});

	it('rejects non-base64 data URIs', () => {
		const input = [{ type: 'image_url', image_url: { url: 'data:image/png,notbase64' } }];
		expect(() => normalizeContentParts(input)).toThrow(/base64/);
	});

	it('rejects unsupported part types explicitly', () => {
		expect(() => normalizeContentParts([{ type: 'input_audio', input_audio: {} }]))
			.toThrow(/not supported/);
	});

	it('rejects unknown and malformed content parts', () => {
		expect(() => normalizeContentParts([{ type: 'video', url: 'x' }]))
			.toThrow(/Content part type "video" is not supported/);
		expect(() => normalizeContentParts([{ type: 'text', text: 42 }]))
			.toThrow(/text part must contain a string/);
		expect(() => normalizeContentParts([{}]))
			.toThrow(/content part must specify a type/);
	});

	it('detects image parts across messages', () => {
		const msgs = normalizeMessages([
			{ role: 'user', content: 'hi' },
			{
				role: 'user',
				content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_1PX}` } }],
			},
		]);
		expect(hasImageParts(msgs)).toBe(true);
	});

	it('reports no images for text-only conversations', () => {
		expect(hasImageParts(normalizeMessages([{ role: 'user', content: 'hi' }]))).toBe(false);
	});
});

describe('parseDataUri', () => {
	it('returns null for non-data URIs', () => {
		expect(parseDataUri('https://example.com/a.png')).toBeNull();
	});

	it('parses mime type and payload', () => {
		const parsed = parseDataUri(`data:image/png;base64,${PNG_1PX}`);
		expect(parsed?.mimeType).toBe('image/png');
		expect(parsed?.base64).toBe(PNG_1PX);
	});

	it('rejects non-canonical or empty base64 payloads', () => {
		expect(() => parseDataUri('data:image/png;base64,A=')).toThrow(/valid base64/);
		expect(() => parseDataUri('data:image/png;base64,AAAA=')).toThrow(/valid base64/);
		expect(() => parseDataUri(`data:image/png;base64,${PNG_1PX.slice(0, 8)}\n${PNG_1PX.slice(8)}`))
			.toThrow(/whitespace/);
	});

	it('rejects a data URI without a declared image MIME type', () => {
		expect(() => parseDataUri(`data:;base64,${PNG_1PX}`))
			.toThrow(/must declare an image MIME type/);
	});

	it('rejects bytes whose signature does not match the declared MIME type', () => {
		expect(() => parseDataUri(`data:image/jpeg;base64,${PNG_1PX}`))
			.toThrow(/does not match declared image type/);
	});

	it('rejects decoded images larger than 8 MiB', () => {
		const bytes = Buffer.alloc(8 * 1024 * 1024 + 1);
		bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		expect(() => parseDataUri(`data:image/png;base64,${bytes.toString('base64')}`))
			.toThrow(/exceeds 8 MiB/);
	});
});

describe('normalizeMessages', () => {
	it('maps developer role onto system', () => {
		const msgs = normalizeMessages([{ role: 'developer', content: 'be terse' }]);
		expect(msgs[0].role).toBe('system');
	});

	it('preserves tool call metadata', () => {
		const msgs = normalizeMessages([
			{ role: 'tool', content: 'result', tool_call_id: 'call_1' },
		]);
		expect(msgs[0].tool_call_id).toBe('call_1');
	});

	it('rejects missing, non-array, and empty message lists', () => {
		expect(() => normalizeMessages(undefined)).toThrow(/messages must be an array/);
		expect(() => normalizeMessages({})).toThrow(/messages must be an array/);
		expect(() => normalizeMessages([])).toThrow(/at least one message/);
	});

	it('rejects malformed entries and unknown roles', () => {
		expect(() => normalizeMessages([null])).toThrow(/message at index 0 must be an object/);
		expect(() => normalizeMessages([{ role: 'admin', content: 'x' }]))
			.toThrow(/unsupported role/);
		expect(() => normalizeMessages([{ role: 'user' }])).toThrow(/content is required/);
	});

	it('requires tool messages to identify their tool call', () => {
		expect(() => normalizeMessages([{ role: 'tool', content: 'result' }]))
			.toThrow(/tool_call_id/);
	});

	it('validates assistant tool call entries', () => {
		for (const toolCall of [
			null,
			{},
			{ id: 'call_1', type: 'other', function: { name: 'lookup', arguments: '{}' } },
			{ id: '', type: 'function', function: { name: 'lookup', arguments: '{}' } },
			{ id: 'call_1', type: 'function', function: { name: '', arguments: '{}' } },
			{ id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{bad' } },
		]) {
			expect(() => normalizeMessages([{ role: 'assistant', content: null, tool_calls: [toolCall] }]))
				.toThrow(/tool_calls/);
		}
	});

	it('accepts a valid assistant tool call without text content', () => {
		const messages = normalizeMessages([{
			role: 'assistant',
			content: null,
			tool_calls: [{
				id: 'call_1',
				type: 'function',
				function: { name: 'lookup', arguments: '{"q":"x"}' },
			}],
		}]);
		expect(messages[0].tool_calls).toHaveLength(1);
	});

	it('rejects tool_calls on non-assistant messages', () => {
		expect(() => normalizeMessages([{
			role: 'user', content: 'x',
			tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }],
		}])).toThrow(/tool_calls are only valid/);
	});

	it('enforces role-specific content requirements', () => {
		for (const role of ['system', 'user', 'tool']) {
			const message = role === 'tool'
				? { role, content: null, tool_call_id: 'call_1' }
				: { role, content: null };
			expect(() => normalizeMessages([message])).toThrow(/requires non-empty content/);
		}
		expect(() => normalizeMessages([{ role: 'assistant', content: null }]))
			.toThrow(/requires content or tool_calls/);
	});

	it('rejects image parts outside user messages', () => {
		for (const role of ['system', 'assistant', 'tool']) {
			const message: Record<string, unknown> = {
				role,
				content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_1PX}` } }],
			};
			if (role === 'tool') message.tool_call_id = 'call_1';
			expect(() => normalizeMessages([message])).toThrow(/image parts are only supported in user messages/);
		}
	});
});

describe('injectSystemPrompt', () => {
	it('prepends when no system message exists', () => {
		const msgs = injectSystemPrompt(normalizeMessages([{ role: 'user', content: 'hi' }]), 'be terse');
		expect(msgs[0].role).toBe('system');
		expect(msgs[0].text).toBe('be terse');
	});

	it('leaves messages untouched when a system message is present', () => {
		const original = normalizeMessages([{ role: 'system', content: 'existing' }]);
		expect(injectSystemPrompt(original, 'be terse')).toEqual(original);
	});

	it('is a no-op for an empty prompt', () => {
		const original = normalizeMessages([{ role: 'user', content: 'hi' }]);
		expect(injectSystemPrompt(original, '')).toEqual(original);
	});
});

describe('appendInstruction', () => {
	it('appends a trailing user turn', () => {
		const msgs = appendInstruction(normalizeMessages([{ role: 'user', content: 'hi' }]), 'JSON only');
		expect(msgs).toHaveLength(2);
		expect(msgs[1].role).toBe('user');
		expect(msgs[1].text).toBe('JSON only');
	});
});
