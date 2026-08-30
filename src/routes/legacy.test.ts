import { describe, it, expect } from 'vitest';
import { rewriteSseLine, toLegacyChunk, toLegacyCompletion } from './legacy';

describe('toLegacyCompletion', () => {
	it('maps message content onto choices[].text', () => {
		const result = toLegacyCompletion({
			id: 'cmpl-1',
			object: 'chat.completion',
			model: 'm',
			choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
			usage: { total_tokens: 3 },
		});
		expect(result.object).toBe('text_completion');
		expect(result.choices).toEqual([
			{ index: 0, text: 'hello', logprobs: null, finish_reason: 'stop' },
		]);
		expect(result.usage).toEqual({ total_tokens: 3 });
	});

	it('produces an empty string when content is null', () => {
		const result = toLegacyCompletion({
			choices: [{ index: 0, message: { content: null }, finish_reason: 'tool_calls' }],
		});
		expect(result.choices[0].text).toBe('');
	});

	it('tolerates a missing choices array', () => {
		expect(toLegacyCompletion({}).choices).toEqual([]);
	});
});

describe('toLegacyChunk', () => {
	it('maps delta content onto text', () => {
		const chunk = toLegacyChunk({
			object: 'chat.completion.chunk',
			choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }],
		});
		expect(chunk.object).toBe('text_completion');
		expect(chunk.choices[0]).toEqual({
			index: 0, text: 'partial', logprobs: null, finish_reason: null,
		});
	});

	it('preserves the terminal finish_reason', () => {
		const chunk = toLegacyChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
		expect(chunk.choices[0]).toMatchObject({ text: '', finish_reason: 'stop' });
	});
});

describe('rewriteSseLine', () => {
	it('rewrites a data frame', () => {
		const line = `data: ${JSON.stringify({
			object: 'chat.completion.chunk',
			choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }],
		})}\n\n`;
		const parsed = JSON.parse(rewriteSseLine(line).slice(6));
		expect(parsed.object).toBe('text_completion');
		expect(parsed.choices[0].text).toBe('hi');
	});

	it('leaves the terminator untouched', () => {
		expect(rewriteSseLine('data: [DONE]\n\n')).toBe('data: [DONE]\n\n');
	});

	it('leaves heartbeat comments untouched', () => {
		expect(rewriteSseLine(': ping\n\n')).toBe(': ping\n\n');
	});

	it('leaves error frames untouched', () => {
		const line = `data: ${JSON.stringify({ error: { message: 'boom' } })}\n\n`;
		expect(rewriteSseLine(line)).toBe(line);
	});

	it('leaves unparseable frames untouched', () => {
		expect(rewriteSseLine('data: not-json\n\n')).toBe('data: not-json\n\n');
	});
});
