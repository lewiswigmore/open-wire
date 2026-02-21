/** Augment vscode types for newer LM tool APIs (available at runtime, not yet in @types/vscode) */
declare module 'vscode' {
	export class LanguageModelToolInformation {
		constructor(name: string, description: string, inputSchema: any);
		readonly name: string;
		readonly description: string;
		readonly inputSchema: any;
	}

	export class LanguageModelToolInputSchema {
		static from(schema: object): LanguageModelToolInputSchema;
	}
}
