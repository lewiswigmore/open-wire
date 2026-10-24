import * as vscode from 'vscode';
import { RequestError } from '../routes/errors';

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

// `vscode.lm.selectChatModels()` normally resolves in milliseconds, but on
// some VS Code builds it never settles (#45), wedging every authenticated
// /v1/* request at model enumeration. Bound the call so the server degrades
// to a real error or a stale list instead of an indefinite hang.
export const DISCOVERY_TIMEOUT_MS = 10_000;
export const DISCOVERY_CACHE_TTL_MS = 10_000;

// After a timed-out discovery, skip further calls for this long: serve the
// last known list or fail fast with 503 instead of stalling every request
// behind another silent wait.
const DISCOVERY_COOLDOWN_MS = 10_000;

let cachedModels: vscode.LanguageModelChat[] = [];
let lastDiscovery = 0;
let retryNotBefore = 0;
let inFlight: Promise<vscode.LanguageModelChat[]> | undefined;
let timeoutMs = DISCOVERY_TIMEOUT_MS;

type LogFn = (message: string) => void;
let log: LogFn = () => { };

/** Route discovery diagnostics to the OpenWire output channel. */
export function setDiscoveryLogger(fn: LogFn): void {
	log = fn;
}

/** Override the discovery timeout (tests use a short value). */
export function setDiscoveryTimeoutMs(ms: number): void {
	timeoutMs = ms;
}

/** Drop the cached list, cooldown and any in-flight discovery. */
export function resetDiscoveryCache(): void {
	cachedModels = [];
	lastDiscovery = 0;
	retryNotBefore = 0;
	inFlight = undefined;
}

/** Age the cache out so the next request must discover again (tests). */
export function expireDiscoveryCache(): void {
	lastDiscovery = Date.now() - DISCOVERY_CACHE_TTL_MS - 1;
}

class DiscoveryTimeoutError extends Error { }

function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new DiscoveryTimeoutError()), ms);
		promise.then(
			value => { clearTimeout(timer); resolve(value); },
			err => { clearTimeout(timer); reject(err); },
		);
	});
}

async function runDiscovery(): Promise<vscode.LanguageModelChat[]> {
	const started = Date.now();
	log('Model discovery: calling vscode.lm.selectChatModels()...');
	try {
		const models = await withTimeout(vscode.lm.selectChatModels(), timeoutMs);
		log(`Model discovery: ${models.length} model(s) in ${Date.now() - started}ms`);
		cachedModels = models;
		lastDiscovery = Date.now();
		retryNotBefore = 0;
		return models;
	} catch (err) {
		if (err instanceof DiscoveryTimeoutError) {
			log(`Model discovery: vscode.lm.selectChatModels() did not resolve within ${timeoutMs}ms.`);
			retryNotBefore = Date.now() + DISCOVERY_COOLDOWN_MS;
			if (cachedModels.length > 0) {
				log(`Model discovery: serving ${cachedModels.length} cached model(s) from ${new Date(lastDiscovery).toISOString()}.`);
				return cachedModels;
			}
			log('Model discovery: no cached models. Check that GitHub Copilot Chat is installed and signed in, then try "Developer: Reload Window".');
			throw new RequestError(
				503,
				`Model discovery timed out after ${Math.round(timeoutMs / 1000)}s: vscode.lm.selectChatModels() did not resolve. ` +
				'Check that GitHub Copilot Chat is installed and signed in, then reload the window.',
			);
		}
		log(`Model discovery: selectChatModels() failed after ${Date.now() - started}ms: ${err instanceof Error ? err.message : String(err)}`);
		throw err;
	}
}

export async function discoverModels(): Promise<vscode.LanguageModelChat[]> {
	const now = Date.now();
	if (cachedModels.length > 0 && now - lastDiscovery < DISCOVERY_CACHE_TTL_MS) {
		return cachedModels;
	}
	if (now < retryNotBefore) {
		// The API just wedged on us; degrade gracefully instead of hanging again.
		if (cachedModels.length > 0) return cachedModels;
		throw new RequestError(
			503,
			'Model discovery is unavailable: vscode.lm.selectChatModels() did not resolve. ' +
			'Check that GitHub Copilot Chat is installed and signed in, then reload the window.',
		);
	}
	// Share one call across concurrent requests so a wedged API is hit once
	// per cooldown window, not once per request.
	if (!inFlight) {
		inFlight = runDiscovery().finally(() => {
			inFlight = undefined;
		});
	}
	return inFlight;
}

export async function listModels(): Promise<ModelInfo[]> {
	const models = await discoverModels();
	const now = Math.floor(Date.now() / 1000);

	// Deduplicate by model ID, preferring the 'copilot' vendor over 'copilotcli'
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
