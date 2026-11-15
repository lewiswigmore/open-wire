import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync(resolve(process.cwd(), 'src/ui/sidebar.ts'), 'utf8');

describe('sidebar model table layout', () => {
	it('aligns the model heading with the indented model IDs', () => {
		expect(sidebarSource).toMatch(/\.model-table-head > :first-child\s*\{\s*padding-left:\s*10px;\s*\}/);
	});
});
