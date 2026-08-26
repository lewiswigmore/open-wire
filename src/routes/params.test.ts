import { describe, it, expect } from 'vitest';
import {
	assertSingleChoice,
	buildModelOptions,
	classifyParams,
	wantsStreamUsage,
} from './params';

describe('buildModelOptions', () => {
	it('forwards sampling parameters', () => {
		const options = buildModelOptions({
			temperature: 0.2,
			top_p: 0.9,
			max_tokens: 512,
			seed: 7,
			stop: ['\n\n'],
			presence_penalty: 0.5,
			frequency_penalty: -0.5,
		});
		expect(options).toEqual({
			temperature: 0.2,
			top_p: 0.9,
			max_tokens: 512,
			seed: 7,
			stop: ['\n\n'],
			presence_penalty: 0.5,
			frequency_penalty: -0.5,
		});
	});

	it('returns an empty bag when nothing is supplied', () => {
		expect(buildModelOptions({ model: 'x', messages: [] })).toEqual({});
	});

	it('honours max_completion_tokens as an alias', () => {
		expect(buildModelOptions({ max_completion_tokens: 256 })).toEqual({ max_tokens: 256 });
	});

	it('prefers max_tokens when both are present', () => {
		expect(buildModelOptions({ max_tokens: 100, max_completion_tokens: 256 }))
			.toEqual({ max_tokens: 100 });
	});

	it('normalises a bare string stop value', () => {
		expect(buildModelOptions({ stop: 'END' })).toEqual({ stop: ['END'] });
	});

	it('preserves temperature 0 rather than treating it as absent', () => {
		expect(buildModelOptions({ temperature: 0 })).toEqual({ temperature: 0 });
	});

	it.each([
		['temperature', { temperature: 3 }],
		['temperature', { temperature: -1 }],
		['top_p', { top_p: 1.5 }],
		['presence_penalty', { presence_penalty: 5 }],
		['frequency_penalty', { frequency_penalty: -5 }],
	])('rejects out-of-range %s rather than clamping', (_name, payload) => {
		expect(() => buildModelOptions(payload)).toThrow(/must be between/);
	});

	it('rejects a non-integer max_tokens', () => {
		expect(() => buildModelOptions({ max_tokens: 1.5 })).toThrow(/positive integer/);
	});

	it('rejects a zero or negative max_tokens', () => {
		expect(() => buildModelOptions({ max_tokens: 0 })).toThrow(/positive integer/);
	});

	it('rejects a non-integer seed', () => {
		expect(() => buildModelOptions({ seed: 1.5 })).toThrow(/seed must be an integer/);
	});

	it('rejects more than four stop sequences', () => {
		expect(() => buildModelOptions({ stop: ['a', 'b', 'c', 'd', 'e'] })).toThrow(/at most 4/);
	});

	it('rejects non-string stop entries', () => {
		expect(() => buildModelOptions({ stop: [1] })).toThrow(/string or an array of strings/);
	});

	it('ignores explicit nulls', () => {
		expect(buildModelOptions({ max_tokens: null, stop: null })).toEqual({});
	});
});

describe('classifyParams', () => {
	it('treats structural and sampling params as honoured', () => {
		const report = classifyParams({
			model: 'm', messages: [], stream: true, tools: [], tool_choice: 'auto',
			response_format: { type: 'text' }, temperature: 0.5, max_tokens: 10,
		});
		expect(report).toEqual({ unsupported: [], unknown: [] });
	});

	it('flags known OpenAI params that cannot be honoured', () => {
		const report = classifyParams({ logprobs: true, user: 'abc', parallel_tool_calls: false });
		expect(report.unsupported).toEqual(['logprobs', 'parallel_tool_calls', 'user']);
		expect(report.unknown).toEqual([]);
	});

	it('flags fields it does not recognise at all', () => {
		const report = classifyParams({ wibble: 1 });
		expect(report.unknown).toEqual(['wibble']);
	});

	it('handles non-object payloads', () => {
		expect(classifyParams(null)).toEqual({ unsupported: [], unknown: [] });
	});
});

describe('assertSingleChoice', () => {
	it('allows n omitted or exactly 1', () => {
		expect(() => assertSingleChoice({})).not.toThrow();
		expect(() => assertSingleChoice({ n: 1 })).not.toThrow();
	});

	it('rejects n > 1 rather than silently returning one choice', () => {
		expect(() => assertSingleChoice({ n: 3 })).toThrow(/n > 1 is not supported/);
	});
});

describe('wantsStreamUsage', () => {
	it('detects the opt-in', () => {
		expect(wantsStreamUsage({ stream_options: { include_usage: true } })).toBe(true);
	});

	it('defaults to false', () => {
		expect(wantsStreamUsage({})).toBe(false);
		expect(wantsStreamUsage({ stream_options: {} })).toBe(false);
	});
});
