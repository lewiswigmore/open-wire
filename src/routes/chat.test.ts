import { describe, it, expect } from 'vitest';

/**
 * Standalone copies of the pure functions from chat.ts for testing
 * (the originals depend on the vscode module which isn't available outside the extension host).
 */

function normalizeContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter((p: any) => typeof p === 'string' || p?.type === 'text')
			.map((p: any) => typeof p === 'string' ? p : (p?.text ?? ''))
			.join('');
	}
	if (content == null) return '';
	return String(content);
}

function parseXmlToolCalls(text: string): { cleanedText: string; toolCalls: { name: string; arguments: string }[] } {
	const toolCalls: { name: string; arguments: string }[] = [];
	const cleaned = text.replace(
		/<function_calls>\s*([\s\S]*?)<\/function_calls>/g,
		(_match, block: string) => {
			for (const inv of block.matchAll(/<invoke\s+name="([^"]+)">\s*([\s\S]*?)<\/invoke>/g)) {
				const params: Record<string, string> = {};
				for (const p of inv[2].matchAll(/<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g)) {
					params[p[1]] = p[2];
				}
				toolCalls.push({
					name: inv[1],
					arguments: JSON.stringify(params),
				});
			}
			return '';
		},
	);
	return { cleanedText: cleaned.trim(), toolCalls };
}

describe('normalizeContent', () => {
	it('passes through plain strings', () => {
		expect(normalizeContent('hello')).toBe('hello');
	});

	it('extracts text from Anthropic content array', () => {
		const input = [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }];
		expect(normalizeContent(input)).toBe('Hello world');
	});

	it('handles mixed string and object arrays', () => {
		const input = ['Hello ', { type: 'text', text: 'world' }];
		expect(normalizeContent(input)).toBe('Hello world');
	});

	it('skips non-text content parts (e.g. images)', () => {
		const input = [
			{ type: 'text', text: 'desc: ' },
			{ type: 'image_url', image_url: { url: 'data:...' } },
		];
		expect(normalizeContent(input)).toBe('desc: ');
	});

	it('returns empty string for null/undefined', () => {
		expect(normalizeContent(null)).toBe('');
		expect(normalizeContent(undefined)).toBe('');
	});

	it('stringifies other types', () => {
		expect(normalizeContent(42)).toBe('42');
	});
});

describe('parseXmlToolCalls', () => {
	it('parses single function call', () => {
		const input = `Let me check that.\n<function_calls>\n<invoke name="exec">\n<parameter name="command">gh auth status 2>&1</parameter>\n</invoke>\n</function_calls>`;
		const { cleanedText, toolCalls } = parseXmlToolCalls(input);
		expect(cleanedText).toBe('Let me check that.');
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls[0].name).toBe('exec');
		expect(JSON.parse(toolCalls[0].arguments)).toEqual({ command: 'gh auth status 2>&1' });
	});

	it('parses multiple function calls', () => {
		const input = `<function_calls>\n<invoke name="read">\n<parameter name="path">/tmp/a.txt</parameter>\n</invoke>\n<invoke name="exec">\n<parameter name="command">ls -la</parameter>\n</invoke>\n</function_calls>`;
		const { toolCalls } = parseXmlToolCalls(input);
		expect(toolCalls).toHaveLength(2);
		expect(toolCalls[0].name).toBe('read');
		expect(toolCalls[1].name).toBe('exec');
	});

	it('parses multiple parameters', () => {
		const input = `<function_calls>\n<invoke name="write">\n<parameter name="path">/tmp/out.txt</parameter>\n<parameter name="content">hello world</parameter>\n</invoke>\n</function_calls>`;
		const { toolCalls } = parseXmlToolCalls(input);
		expect(toolCalls).toHaveLength(1);
		const args = JSON.parse(toolCalls[0].arguments);
		expect(args.path).toBe('/tmp/out.txt');
		expect(args.content).toBe('hello world');
	});

	it('returns original text when no function calls present', () => {
		const input = 'Just a normal response.';
		const { cleanedText, toolCalls } = parseXmlToolCalls(input);
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
		const input = `First call:\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo 1</parameter>\n</invoke>\n</function_calls>\nThen:\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo 2</parameter>\n</invoke>\n</function_calls>`;
		const { toolCalls } = parseXmlToolCalls(input);
		expect(toolCalls).toHaveLength(2);
	});
});
