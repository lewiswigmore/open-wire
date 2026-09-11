import * as vscode from 'vscode';
import {
	DEFAULT_API_KEY,
	DEFAULT_CORS_ALLOWED_ORIGINS,
	isApiKeyUnconfigured,
	normalizeApiKey,
	normalizeCorsAllowedOrigins,
} from './security';

export interface ServerConfig {
	host: string;
	port: number;
	apiKey: string;
	apiKeyWasGenerated: boolean;
	corsAllowedOrigins: string[];
	defaultModel: string;
	defaultSystemPrompt: string;
	maxConcurrentRequests: number;
	rateLimitPerMinute: number;
	requestTimeoutSeconds: number;
	enableLogging: boolean;
	autoStart: boolean;
	strictParams: boolean;
	jsonModeMaxRetries: number;
	maxRequestBodyMb: number;
}

const SECTION = 'openWire.server';

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
	const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	return Math.min(max, Math.max(min, Math.trunc(number)));
}

export function loadConfig(): ServerConfig {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	const rawApiKey = cfg.get<string>('apiKey', DEFAULT_API_KEY);
	return {
		host: cfg.get<string>('host', '127.0.0.1'),
		port: cfg.get<number>('port', 3030),
		apiKey: normalizeApiKey(rawApiKey),
		apiKeyWasGenerated: isApiKeyUnconfigured(rawApiKey),
		corsAllowedOrigins: normalizeCorsAllowedOrigins(
			cfg.get<unknown>('corsAllowedOrigins', DEFAULT_CORS_ALLOWED_ORIGINS),
		),
		defaultModel: cfg.get<string>('defaultModel', ''),
		defaultSystemPrompt: cfg.get<string>('defaultSystemPrompt', ''),
		maxConcurrentRequests: cfg.get<number>('maxConcurrentRequests', 4),
		rateLimitPerMinute: cfg.get<number>('rateLimitPerMinute', 60),
		requestTimeoutSeconds: cfg.get<number>('requestTimeoutSeconds', 300),
		enableLogging: cfg.get<boolean>('enableLogging', false),
		autoStart: cfg.get<boolean>('autoStart', true),
		strictParams: cfg.get<boolean>('strictParams', false),
		jsonModeMaxRetries: boundedInteger(cfg.get<unknown>('jsonModeMaxRetries', 1), 1, 0, 3),
		maxRequestBodyMb: boundedInteger(cfg.get<unknown>('maxRequestBodyMb', 10), 10, 1, 100),
	};
}

export async function setDefaultModel(model: string): Promise<void> {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	await cfg.update('defaultModel', model, vscode.ConfigurationTarget.Global);
}
