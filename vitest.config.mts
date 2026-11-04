import { defineConfig } from 'vitest/config';
import * as path from 'path';
import { fileURLToPath } from 'url';

// .mts keeps this file native ESM, which is what Vitest's future default
// config loader expects. ESM has no __dirname, so derive the directory from
// import.meta.url instead.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			// Lets the gateway and chat pipeline run outside the extension host.
			vscode: path.resolve(here, 'src/test/vscode-mock.ts'),
		},
	},
	test: {
		include: ['src/**/*.test.ts'],
	},
});
