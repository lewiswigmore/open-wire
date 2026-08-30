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

	it('stringifies other types', () => {
		expect(normalizeContent(42)).toBe('42');
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

	it('detects image parts across messages', () => {
		const msgs = normalizeMessages([
			{ role: 'user', content: 'hi' },
			{
				role: 'user',
				content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PNG_1PX}` } }],
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
		const parsed = parseDataUri(`data:image/jpeg;base64,${PNG_1PX}`);
		expect(parsed?.mimeType).toBe('image/jpeg');
		expect(parsed?.base64).toBe(PNG_1PX);
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

	it('returns an empty array for non-array input', () => {
		expect(normalizeMessages(undefined)).toEqual([]);
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
