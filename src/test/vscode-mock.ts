/**
 * Minimal in-memory stand-in for the `vscode` module.
 *
 * Vitest aliases `vscode` to this file (see vitest.config.ts) so the gateway and
 * chat pipeline can be exercised over real HTTP outside the extension host.
 * Only the surface OpenWire actually touches is implemented.
 */

export class LanguageModelTextPart {
	constructor(public readonly value: string) { }
}

export class LanguageModelToolCallPart {
	constructor(
		public readonly callId: string,
		public readonly name: string,
		public readonly input: object,
	) { }
}

export class LanguageModelToolResultPart {
	constructor(public readonly callId: string, public readonly content: unknown[]) { }
}

export class LanguageModelPromptTsxPart {
	constructor(public readonly value: unknown) { }
}

/** Exposed only when `enableDataPart(true)` has run, to model VS Code < 1.125. */
export class LanguageModelDataPartImpl {
	constructor(public readonly data: Uint8Array, public readonly mimeType: string) { }
	static image(data: Uint8Array, mime: string): LanguageModelDataPartImpl {
		return new LanguageModelDataPartImpl(data, mime);
	}
}

export let LanguageModelDataPart: typeof LanguageModelDataPartImpl | undefined;

export function enableDataPart(enabled: boolean): void {
	LanguageModelDataPart = enabled ? LanguageModelDataPartImpl : undefined;
}

export class LanguageModelChatMessage {
	constructor(
		public readonly role: string,
		public readonly content: unknown,
		public readonly name?: string,
	) { }

	static User(content: unknown, name?: string): LanguageModelChatMessage {
		return new LanguageModelChatMessage('user', content, name);
	}

	static Assistant(content: unknown, name?: string): LanguageModelChatMessage {
		return new LanguageModelChatMessage('assistant', content, name);
	}
}

export const LanguageModelChatToolMode = { Auto: 1, Required: 2 } as const;
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 } as const;
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export class CancellationTokenSource {
	private listeners: Array<() => void> = [];
	token = {
		isCancellationRequested: false,
		onCancellationRequested: (fn: () => void) => {
			this.listeners.push(fn);
			return { dispose: () => { } };
		},
	};
	cancel(): void {
		this.token.isCancellationRequested = true;
		for (const fn of this.listeners) fn();
	}
	dispose(): void { }
}

export class EventEmitter<T> {
	private handlers: Array<(e: T) => void> = [];
	event = (handler: (e: T) => void) => {
		this.handlers.push(handler);
		return { dispose: () => { } };
	};
	fire(value: T): void {
		for (const h of this.handlers) h(value);
	}
	dispose(): void { }
}

// ── scriptable model ──────────────────────────────────────

export type ScriptedTurn = Array<LanguageModelTextPart | LanguageModelToolCallPart>;

interface RecordedRequest {
	messages: any[];
	options: any;
}

class FakeModel {
	readonly vendor = 'copilot';
	readonly version = '1.0';
	readonly maxInputTokens = 128000;

	constructor(
		public readonly id: string,
		public readonly name: string,
		public readonly family: string,
	) { }

	async sendRequest(messages: any[], options: any, _token: unknown) {
		state.requests.push({ messages, options });

		if (state.failNext) {
			state.failNext = false;
			throw new Error('model exploded');
		}

		const turn = state.turns.shift() ?? [new LanguageModelTextPart('default reply')];
		const delayMs = state.responseDelayMs;

		return {
			stream: (async function* () {
				if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
				for (const part of turn) yield part;
			})(),
		};
	}

	async countTokens(text: string): Promise<number> {
		return Math.ceil(String(text).length / 4);
	}
}

interface MockState {
	config: Record<string, unknown>;
	models: FakeModel[];
	turns: ScriptedTurn[];
	requests: RecordedRequest[];
	responseDelayMs: number;
	failNext: boolean;
}

const state: MockState = {
	config: {},
	models: [],
	turns: [],
	requests: [],
	responseDelayMs: 0,
	failNext: false,
};

/** Reset every piece of mock state between tests. */
export function resetMock(config: Record<string, unknown> = {}): void {
	state.config = { ...config };
	state.models = [new FakeModel('test-model', 'Test Model', 'test')];
	state.turns = [];
	state.requests = [];
	state.responseDelayMs = 0;
	state.failNext = false;
	enableDataPart(true);
}

/** Queue the parts the model should emit, one array per turn. */
export function queueTurns(...turns: ScriptedTurn[]): void {
	state.turns.push(...turns);
}

/** Queue plain-text turns. */
export function queueText(...texts: string[]): void {
	for (const t of texts) state.turns.push([new LanguageModelTextPart(t)]);
}

export function recordedRequests(): RecordedRequest[] {
	return state.requests;
}

export function setModels(models: Array<{ id: string; name?: string; family?: string }>): void {
	state.models = models.map(m => new FakeModel(m.id, m.name ?? m.id, m.family ?? m.id));
}

export function setResponseDelay(ms: number): void {
	state.responseDelayMs = ms;
}

export function failNextRequest(): void {
	state.failNext = true;
}

// ── namespaces ────────────────────────────────────────────

export const workspace = {
	getConfiguration(_section: string) {
		return {
			get: <T>(key: string, fallback: T): T =>
				(state.config[key] !== undefined ? state.config[key] as T : fallback),
			update: async (key: string, value: unknown) => { state.config[key] = value; },
		};
	},
	onDidChangeConfiguration(_fn: unknown) {
		return { dispose: () => { } };
	},
};

export const lm = {
	async selectChatModels(): Promise<FakeModel[]> {
		return state.models;
	},
};

export const extensions = {
	getExtension(_id: string) {
		return { packageJSON: { version: '0.4.0-test' } };
	},
};

export const window = {
	createOutputChannel(_name: string) {
		return { appendLine: (_m: string) => { }, dispose: () => { } };
	},
	createStatusBarItem(_align?: unknown, _priority?: number) {
		return {
			text: '', tooltip: '', command: '',
			show: () => { }, hide: () => { }, dispose: () => { },
		};
	},
	registerWebviewViewProvider() {
		return { dispose: () => { } };
	},
};

export const commands = {
	registerCommand(_id: string, _fn: unknown) {
		return { dispose: () => { } };
	},
};
