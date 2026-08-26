import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
	resolve: {
		alias: {
			// Lets the gateway and chat pipeline run outside the extension host.
			vscode: path.resolve(__dirname, 'src/test/vscode-mock.ts'),
		},
	},
	test: {
		include: ['src/**/*.test.ts'],
	},
});
