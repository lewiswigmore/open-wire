import * as vscode from 'vscode';

export interface ModelInfo {
	id: string;
	object: 'model';
	created: number;
	owned_by: string;
	name: string;
	family: string;
	version: string;
	max_input_tokens: number;
}

let cachedModels: vscode.LanguageModelChat[] = [];
let lastDiscovery = 0;
const CACHE_TTL = 10_000;

export async function discoverModels(): Promise<vscode.LanguageModelChat[]> {
	const now = Date.now();
	if (cachedModels.length > 0 && now - lastDiscovery < CACHE_TTL) {
		return cachedModels;
	}
	cachedModels = await vscode.lm.selectChatModels();
	lastDiscovery = now;
	return cachedModels;
}

export async function listModels(): Promise<ModelInfo[]> {
	const models = await discoverModels();
	const now = Math.floor(Date.now() / 1000);

	// Deduplicate by model ID — prefer 'copilot' vendor over 'copilotcli'
	const seen = new Map<string, ModelInfo>();
	for (const m of models) {
		const id = m.id;
		const existing = seen.get(id);
		const vendor = m.vendor || 'unknown';
		if (!existing || (existing.owned_by === 'copilotcli' && vendor === 'copilot')) {
			seen.set(id, {
				id,
				object: 'model' as const,
				created: now,
				owned_by: vendor,
				name: m.name,
				family: m.family,
				version: m.version,
				max_input_tokens: m.maxInputTokens,
			});
		}
	}
	return Array.from(seen.values());
}

export function findModel(
	requestedId: string,
	models: vscode.LanguageModelChat[],
): vscode.LanguageModelChat | null {
	const req = requestedId.toLowerCase();
	return (
		models.find(m => m.id.toLowerCase() === req) ??
		models.find(m => m.family?.toLowerCase() === req) ??
		null
	);
}

export function resolveModelId(model: unknown, defaultModel: string): string {
	if (typeof model === 'string' && model.trim()) {
		return model.trim();
	}
	return defaultModel;
}
