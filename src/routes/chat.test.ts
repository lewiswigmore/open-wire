import * as assert from 'assert';

/**
 * Standalone copies of the pure functions from chat.ts for testing
 * (the originals depend on the vscode module which isn't available outside the extension host).
 */

// -- normalizeContent ---------------------------------------------------------

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

// -- parseXmlToolCalls --------------------------------------------------------

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

// =============================================================================
// Tests
// =============================================================================

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
	try {
		fn();
		passed++;
		console.log(`  ✓ ${name}`);
	} catch (e: any) {
		failed++;
		console.log(`  ✗ ${name}`);
		console.log(`    ${e.message}`);
	}
}

console.log('\nnormalizeContent');

test('passes through plain strings', () => {
	assert.strictEqual(normalizeContent('hello'), 'hello');
});

test('extracts text from Anthropic content array', () => {
	const input = [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }];
	assert.strictEqual(normalizeContent(input), 'Hello world');
});

test('handles mixed string and object arrays', () => {
	const input = ['Hello ', { type: 'text', text: 'world' }];
	assert.strictEqual(normalizeContent(input), 'Hello world');
});

test('skips non-text content parts (e.g. images)', () => {
	const input = [
		{ type: 'text', text: 'desc: ' },
		{ type: 'image_url', image_url: { url: 'data:...' } },
	];
	assert.strictEqual(normalizeContent(input), 'desc: ');
});

test('returns empty string for null/undefined', () => {
	assert.strictEqual(normalizeContent(null), '');
	assert.strictEqual(normalizeContent(undefined), '');
});

test('stringifies other types', () => {
	assert.strictEqual(normalizeContent(42), '42');
});

console.log('\nparseXmlToolCalls');

test('parses single function call', () => {
	const input = `Let me check that.\n<function_calls>\n<invoke name="exec">\n<parameter name="command">gh auth status 2>&1</parameter>\n</invoke>\n</function_calls>`;
	const { cleanedText, toolCalls } = parseXmlToolCalls(input);
	assert.strictEqual(cleanedText, 'Let me check that.');
	assert.strictEqual(toolCalls.length, 1);
	assert.strictEqual(toolCalls[0].name, 'exec');
	assert.deepStrictEqual(JSON.parse(toolCalls[0].arguments), { command: 'gh auth status 2>&1' });
});

test('parses multiple function calls', () => {
	const input = `<function_calls>\n<invoke name="read">\n<parameter name="path">/tmp/a.txt</parameter>\n</invoke>\n<invoke name="exec">\n<parameter name="command">ls -la</parameter>\n</invoke>\n</function_calls>`;
	const { toolCalls } = parseXmlToolCalls(input);
	assert.strictEqual(toolCalls.length, 2);
	assert.strictEqual(toolCalls[0].name, 'read');
	assert.strictEqual(toolCalls[1].name, 'exec');
});

test('parses multiple parameters', () => {
	const input = `<function_calls>\n<invoke name="write">\n<parameter name="path">/tmp/out.txt</parameter>\n<parameter name="content">hello world</parameter>\n</invoke>\n</function_calls>`;
	const { toolCalls } = parseXmlToolCalls(input);
	assert.strictEqual(toolCalls.length, 1);
	const args = JSON.parse(toolCalls[0].arguments);
	assert.strictEqual(args.path, '/tmp/out.txt');
	assert.strictEqual(args.content, 'hello world');
});

test('returns original text when no function calls present', () => {
	const input = 'Just a normal response.';
	const { cleanedText, toolCalls } = parseXmlToolCalls(input);
	assert.strictEqual(cleanedText, 'Just a normal response.');
	assert.strictEqual(toolCalls.length, 0);
});

test('handles text before and after function calls', () => {
	const input = `Before text.\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo hi</parameter>\n</invoke>\n</function_calls>\nAfter text.`;
	const { cleanedText, toolCalls } = parseXmlToolCalls(input);
	assert.ok(cleanedText.includes('Before text.'));
	assert.ok(cleanedText.includes('After text.'));
	assert.ok(!cleanedText.includes('function_calls'));
	assert.strictEqual(toolCalls.length, 1);
});

test('handles multiple separate function_calls blocks', () => {
	const input = `First call:\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo 1</parameter>\n</invoke>\n</function_calls>\nThen:\n<function_calls>\n<invoke name="exec">\n<parameter name="command">echo 2</parameter>\n</invoke>\n</function_calls>`;
	const { toolCalls } = parseXmlToolCalls(input);
	assert.strictEqual(toolCalls.length, 2);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
