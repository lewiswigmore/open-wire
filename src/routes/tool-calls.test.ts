import { describe, it, expect } from 'vitest';
import {
	applyToolChoice,
	mapTools,
	parseXmlToolCalls,
	planToolChoice,
} from './tool-calls';

describe('parseXmlToolCalls', () => {
	it('parses single function call', () => {
		const input = `Let me check that.\n<function_calls>\n<invoke name="exec">\n<parameter name="command">gh auth status 2>&1</parameter>\n</invoke>\n</function_calls>`;
		const { cleanedText, toolCalls } = parseXmlToolCalls(input);
		expect(cleanedText).toBe('Let me check that.');
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].function.name).toBe('exec');
		expect(JSON.parse(toolCalls[0].function.arguments)).toEqual({ command: 'gh auth status 2>&1' });
	});

	it('parses multiple function calls', () => {
		const input = `<function_calls>\n<invoke name="read">\n<parameter name="path">/tmp/a.txt</parameter>\n</invoke>\n<invoke name="exec">\n<parameter name="command">ls -la</parameter>\n</invoke>\n</function_calls>`;
		const { toolCalls } = parseXmlToolCalls(input);
		expect(toolCalls.map(t => t.function.name)).toEqual(['read', 'exec']);
	});

	it('parses multiple parameters', () => {
		const input = `<function_calls>\n<invoke name="write">\n<parameter name="path">/tmp/out.txt</parameter>\n<parameter name="content">hello world</parameter>\n</invoke>\n</function_calls>`;
		const { toolCalls } = parseXmlToolCalls(input);
		const args = JSON.parse(toolCalls[0].function.arguments);
		expect(args).toEqual({ path: '/tmp/out.txt', content: 'hello world' });
	});

	it('returns original text when no function calls present', () => {
		const { cleanedText, toolCalls } = parseXmlToolCalls('Just a normal response.');
		expect(cleanedText).toBe('Just a normal response.');
		expect(toolCalls).toHaveLength(0);
	});

	it('handles text before and after function calls', () => {
		const input = `Before text.\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo hi</parameter>\n</invoke>\n</function_calls>\nAfter text.`;
		const { cleanedText, toolCalls } = parseXmlToolCalls(input);
		expect(cleanedText).toContain('Before text.');
		expect(cleanedText).toContain('After text.');
		expect(cleanedText).not.toContain('function_calls');
		expect(toolCalls).toHaveLength(1);
	});

	it('handles multiple separate function_calls blocks', () => {
		const input = `First:\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo 1</parameter>\n</invoke>\n</function_calls>\nThen:\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo 2</parameter>\n</invoke>\n</function_calls>`;
		expect(parseXmlToolCalls(input).toolCalls).toHaveLength(2);
	});

	it('assigns a distinct id to each call', () => {
		const input = `<function_calls>\n<invoke name="a">\n</invoke>\n<invoke name="b">\n</invoke>\n</function_calls>`;
		const { toolCalls } = parseXmlToolCalls(input);
		expect(toolCalls[0].id).not.toBe(toolCalls[1].id);
	});
});

describe('planToolChoice', () => {
	it('defaults to auto', () => {
		expect(planToolChoice(undefined)).toEqual({ mode: 'auto' });
		expect(planToolChoice('auto')).toEqual({ mode: 'auto' });
	});

	it('maps none', () => {
		expect(planToolChoice('none')).toEqual({ mode: 'none' });
	});

	it('maps required and any', () => {
		expect(planToolChoice('required')).toEqual({ mode: 'required' });
		expect(planToolChoice('any')).toEqual({ mode: 'required' });
	});

	it('maps a named function to required with a target', () => {
		expect(planToolChoice({ type: 'function', function: { name: 'lookup' } }))
			.toEqual({ mode: 'required', only: 'lookup' });
	});

	it('rejects an object without a name', () => {
		expect(() => planToolChoice({ type: 'function' })).toThrow(/function.name/);
	});

	it('rejects unknown string values', () => {
		expect(() => planToolChoice('sometimes')).toThrow(/Invalid tool_choice/);
	});
});

describe('mapTools', () => {
	it('maps OpenAI function tools', () => {
		const tools = mapTools([
			{ type: 'function', function: { name: 'a', description: 'd', parameters: { type: 'object' } } },
		]);
		expect(tools).toEqual([{ name: 'a', description: 'd', inputSchema: { type: 'object' } }]);
	});

	it('accepts a bare tool shape', () => {
		expect(mapTools([{ name: 'a' }])[0].name).toBe('a');
	});

	it('rejects a tool without a name', () => {
		expect(() => mapTools([{ description: 'no name' }])).toThrow(/function.name/);
	});

	it('returns an empty list when tools are omitted', () => {
		expect(mapTools(undefined)).toEqual([]);
	});

	it('rejects a non-array tools value', () => {
		expect(() => mapTools({ name: 'a' })).toThrow(/tools must be an array/);
		expect(() => mapTools(null)).toThrow(/tools must be an array/);
	});
});

describe('applyToolChoice', () => {
	const tools = [
		{ name: 'alpha', description: '', inputSchema: {} },
		{ name: 'beta', description: '', inputSchema: {} },
	];

	it('drops tools entirely for none', () => {
		expect(applyToolChoice(tools, { mode: 'none' })).toBeNull();
	});

	it('returns null when there are no tools', () => {
		expect(applyToolChoice([], { mode: 'auto' })).toBeNull();
	});

	it('rejects required mode when there are no tools', () => {
		expect(() => applyToolChoice([], { mode: 'required' })).toThrow(/at least one tool/);
	});

	it('forwards all tools in auto mode', () => {
		expect(applyToolChoice(tools, { mode: 'auto' })).toEqual({ tools, required: false });
	});

	it('marks required without narrowing when no name is given', () => {
		expect(applyToolChoice(tools, { mode: 'required' })).toEqual({ tools, required: true });
	});

	it('narrows to the single named tool', () => {
		const result = applyToolChoice(tools, { mode: 'required', only: 'beta' });
		expect(result).toEqual({ tools: [tools[1]], required: true });
	});

	it('rejects a name that is not in the tools array', () => {
		expect(() => applyToolChoice(tools, { mode: 'required', only: 'gamma' }))
			.toThrow(/not in the tools array/);
	});
});
