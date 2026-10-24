// Fails when @types/vscode and engines.vscode are not on the same minor version.
//
// vsce refuses to package when @types/vscode is newer than engines.vscode, but it
// happily packages the reverse: an engines.vscode raised on its own claims a VS Code
// floor that the compiled types do not cover. This check catches both directions.
// See the Development section of the README.

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const engineSpec = pkg.engines?.vscode;
const typesSpec = pkg.devDependencies?.['@types/vscode'];

if (!engineSpec || !typesSpec) {
	console.error('package.json must define both engines.vscode and devDependencies["@types/vscode"].');
	process.exit(1);
}

const minorOf = (spec) => {
	const match = /(\d+)\.(\d+)/.exec(spec);
	if (!match) {
		console.error(`Cannot read a major.minor version out of "${spec}".`);
		process.exit(1);
	}
	return `${match[1]}.${match[2]}`;
};

const engineMinor = minorOf(engineSpec);
const typesMinor = minorOf(typesSpec);

if (engineMinor !== typesMinor) {
	console.error(
		`@types/vscode (${typesSpec}) and engines.vscode (${engineSpec}) are out of step: ` +
			`${typesMinor} vs ${engineMinor}. Raise both together.`,
	);
	process.exit(1);
}

console.log(`@types/vscode and engines.vscode are in step on ${engineMinor}.`);