import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sidebarSource = readFileSync(resolve(process.cwd(), 'src/ui/sidebar.ts'), 'utf8');

describe('sidebar model table layout', () => {
	it('keeps header and value columns on shared tracks with first-cell-only indentation', () => {
		const gridRule = sidebarSource.match(/\.model-table-head,\s*\.model-row\s*\{([^}]+)\}/)?.[1];

		expect(gridRule).toContain('grid-template-columns: minmax(0, 1fr) 30px 38px 28px;');
		expect(sidebarSource).not.toMatch(/\.model-row\s*\{[^}]*margin-left:/);
		expect(sidebarSource).toMatch(/\.model-table-head > :first-child\s*\{\s*padding-left:\s*10px;\s*\}/);
		expect(sidebarSource).toMatch(/\.model-row > :first-child\s*\{\s*padding-left:\s*10px;\s*\}/);
	});
});
