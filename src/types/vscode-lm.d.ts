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

	/**
	 * Binary content part, used here for image input.
	 *
	 * Reached the stable API in VS Code 1.125. OpenWire keeps an engine floor of
	 * 1.95 so the rest of the release stays widely installable, and detects this
	 * class at runtime (see `supportsImageInput`) rather than assuming it exists.
	 */
	export class LanguageModelDataPart {
		static image(data: Uint8Array, mime: string): LanguageModelDataPart;
		static json(value: any, mime?: string): LanguageModelDataPart;
		static text(value: string, mime?: string): LanguageModelDataPart;
		readonly mimeType: string;
		readonly data: Uint8Array;
	}
}
