import * as vscode from 'vscode';
import {
	DEFAULT_API_KEY,
	DEFAULT_CORS_ALLOWED_ORIGINS,
	normalizeApiKey,
	normalizeCorsAllowedOrigins,
} from './security';

export interface ServerConfig {
	host: string;
	port: number;
	apiKey: string;
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

export function loadConfig(): ServerConfig {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	return {
		host: cfg.get<string>('host', '127.0.0.1'),
		port: cfg.get<number>('port', 3030),
		apiKey: normalizeApiKey(cfg.get<string>('apiKey', DEFAULT_API_KEY)),
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
		jsonModeMaxRetries: Math.max(0, cfg.get<number>('jsonModeMaxRetries', 1)),
		maxRequestBodyMb: Math.max(1, cfg.get<number>('maxRequestBodyMb', 10)),
	};
}

export async function setDefaultModel(model: string): Promise<void> {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	await cfg.update('defaultModel', model, vscode.ConfigurationTarget.Global);
}
