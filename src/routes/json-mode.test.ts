import { describe, it, expect } from 'vitest';
import {
	buildJsonInstruction,
	buildRepairInstruction,
	extractJson,
	isJsonMode,
	parseResponseFormat,
	validateJsonOutput,
	type ResponseFormat,
} from './json-mode';

describe('parseResponseFormat', () => {
	it('defaults to text', () => {
		expect(parseResponseFormat(undefined)).toEqual({ mode: 'text' });
		expect(parseResponseFormat(null)).toEqual({ mode: 'text' });
		expect(parseResponseFormat({ type: 'text' })).toEqual({ mode: 'text' });
	});

	it('parses json_object', () => {
		expect(parseResponseFormat({ type: 'json_object' })).toEqual({ mode: 'json_object' });
	});

	it('parses json_schema and keeps the schema', () => {
		const format = parseResponseFormat({
			type: 'json_schema',
			json_schema: { name: 'audit', schema: { type: 'object' } },
		});
		expect(format).toEqual({ mode: 'json_schema', name: 'audit', schema: { type: 'object' } });
	});

	it('defaults the schema name', () => {
		const format = parseResponseFormat({ type: 'json_schema', json_schema: { schema: { type: 'object' } } });
		expect(format).toMatchObject({ name: 'response' });
	});

	it('rejects an unsupported type instead of ignoring it', () => {
		expect(() => parseResponseFormat({ type: 'yaml_object' }))
			.toThrow(/Unsupported response_format.type/);
	});

	it('rejects a schema using keywords it cannot enforce', () => {
		expect(() => parseResponseFormat({
			type: 'json_schema',
			json_schema: { schema: { type: 'object', patternProperties: {} } },
		})).toThrow(/Unsupported JSON Schema keyword/);
	});

	it('rejects a non-object response_format', () => {
		expect(() => parseResponseFormat('json')).toThrow(/must be an object/);
	});

	it('rejects a supplied response_format without a type', () => {
		expect(() => parseResponseFormat({ json_schema: { schema: { type: 'object' } } }))
			.toThrow(/response_format.type is required/);
	});

	it('rejects json_schema without a json_schema object', () => {
		expect(() => parseResponseFormat({ type: 'json_schema' })).toThrow(/must be an object/);
	});
});

describe('isJsonMode', () => {
	it('is false only for text', () => {
		expect(isJsonMode({ mode: 'text' })).toBe(false);
		expect(isJsonMode({ mode: 'json_object' })).toBe(true);
	});
});

describe('extractJson', () => {
	it('parses a bare object', () => {
		expect(extractJson('{"ok":true}')?.value).toEqual({ ok: true });
	});

	it('parses a bare array', () => {
		expect(extractJson('[1,2]')?.value).toEqual([1, 2]);
	});

	// The exact shapes observed in the audit pipeline's parse failures.
	it('recovers JSON from a fenced block with leading prose', () => {
		const text = 'I\'ll analyze that now.\n\n```json\n{"findings": []}\n```';
		expect(extractJson(text)?.value).toEqual({ findings: [] });
	});

	it('recovers JSON from a raw object with leading prose', () => {
		const text = 'Here is my assessment:\n{"severity": "low"}';
		expect(extractJson(text)?.value).toEqual({ severity: 'low' });
	});

	it('recovers JSON with trailing prose', () => {
		expect(extractJson('{"a":1}\n\nLet me know if you need more.')?.value).toEqual({ a: 1 });
	});

	it('handles an unlabelled code fence', () => {
		expect(extractJson('```\n{"a":1}\n```')?.value).toEqual({ a: 1 });
	});

	it('is not fooled by braces inside strings', () => {
		expect(extractJson('prefix {"note":"a } brace","b":2} suffix')?.value)
			.toEqual({ note: 'a } brace', b: 2 });
	});

	it('handles escaped quotes inside strings', () => {
		expect(extractJson('x {"q":"say \\"hi\\""} y')?.value).toEqual({ q: 'say "hi"' });
	});

	it('handles nested structures', () => {
		const text = 'result:\n{"a":{"b":[1,{"c":2}]}}';
		expect(extractJson(text)?.value).toEqual({ a: { b: [1, { c: 2 }] } });
	});

	it('prefers an object when both an array and object are present', () => {
		expect(extractJson('list [1,2] then {"a":1}')?.value).toEqual({ a: 1 });
	});

	it('returns null when nothing parses', () => {
		expect(extractJson('no json at all')).toBeNull();
		expect(extractJson('')).toBeNull();
		expect(extractJson('{unbalanced')).toBeNull();
	});
});

describe('validateJsonOutput', () => {
	const jsonObject: ResponseFormat = { mode: 'json_object' };

	it('passes text mode straight through', () => {
		const result = validateJsonOutput('anything', { mode: 'text' });
		expect(result).toEqual({ ok: true, json: 'anything', value: 'anything' });
	});

	it('normalises recovered JSON to compact form', () => {
		const result = validateJsonOutput('Sure!\n```json\n{ "a" : 1 }\n```', jsonObject);
		expect(result).toEqual({ ok: true, json: '{"a":1}', value: { a: 1 } });
	});

	it('fails when no JSON is present', () => {
		const result = validateJsonOutput('I cannot do that.', jsonObject);
		expect(result).toEqual({ ok: false, reason: expect.stringMatching(/parseable JSON/) });
	});

	it('validates against a schema', () => {
		const format: ResponseFormat = {
			mode: 'json_schema',
			name: 'r',
			schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
		};
		expect(validateJsonOutput('{"ok":true}', format).ok).toBe(true);

		const bad = validateJsonOutput('{"ok":"yes"}', format);
		expect(bad.ok).toBe(false);
		expect(bad.ok === false && bad.reason).toMatch(/did not match the supplied schema/);
	});

	it('fails a schema mismatch even when the JSON parses', () => {
		const format: ResponseFormat = {
			mode: 'json_schema',
			name: 'r',
			schema: { type: 'object', required: ['missing'] },
		};
		expect(validateJsonOutput('{}', format).ok).toBe(false);
	});

	// json_object promises an object, so a bare scalar or array is not a pass.
	it.each(['null', '5', '"hi"', 'true', '[1,2]'])(
		'rejects %s under json_object',
		(output) => {
			const result = validateJsonOutput(output, jsonObject);
			expect(result.ok).toBe(false);
			expect(result.ok === false && result.reason).toMatch(/requires a JSON object/);
		},
	);

	it('still accepts an object under json_object', () => {
		expect(validateJsonOutput('{"a":1}', jsonObject).ok).toBe(true);
	});

	it('allows a top-level array when a schema asks for one', () => {
		const format: ResponseFormat = {
			mode: 'json_schema', name: 'r', schema: { type: 'array', items: { type: 'number' } },
		};
		expect(validateJsonOutput('[1,2]', format).ok).toBe(true);
	});
});

describe('extractJson performance', () => {
	it('stays bounded on pathological unbalanced input', () => {
		const started = Date.now();
		expect(extractJson('{'.repeat(50_000))).toBeNull();
		expect(Date.now() - started).toBeLessThan(500);
	});

	it('still finds JSON that follows unbalanced braces', () => {
		expect(extractJson(`${'{'.repeat(5)} then {"a":1}`)?.value).toEqual({ a: 1 });
	});
});

describe('instructions', () => {
	it('builds no instruction for text mode', () => {
		expect(buildJsonInstruction({ mode: 'text' })).toBe('');
	});

	it('forbids fences and prose for json_object', () => {
		const instruction = buildJsonInstruction({ mode: 'json_object' });
		expect(instruction).toMatch(/single valid JSON value/);
		expect(instruction).toMatch(/code fences/);
	});

	it('includes the schema for json_schema', () => {
		const instruction = buildJsonInstruction({
			mode: 'json_schema', name: 'r', schema: { type: 'object' },
		});
		expect(instruction).toContain('"type": "object"');
	});

	it('quotes the reason and prior output in a repair instruction', () => {
		const instruction = buildRepairInstruction({ mode: 'json_object' }, 'sorry, here goes', 'no JSON');
		expect(instruction).toContain('no JSON');
		expect(instruction).toContain('sorry, here goes');
		expect(instruction).toMatch(/ONLY the corrected JSON/);
	});

	it('truncates very long prior output', () => {
		const instruction = buildRepairInstruction({ mode: 'json_object' }, 'x'.repeat(5000), 'bad');
		expect(instruction.length).toBeLessThan(3000);
		expect(instruction).toContain('…');
	});
});
