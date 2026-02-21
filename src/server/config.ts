import * as vscode from 'vscode';

export interface ServerConfig {
	host: string;
	port: number;
	apiKey: string;
	defaultModel: string;
	defaultSystemPrompt: string;
	maxConcurrentRequests: number;
	rateLimitPerMinute: number;
	requestTimeoutSeconds: number;
	enableLogging: boolean;
	autoStart: boolean;
}

const SECTION = 'openWire.server';

export function loadConfig(): ServerConfig {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	return {
		host: cfg.get<string>('host', '127.0.0.1'),
		port: cfg.get<number>('port', 3030),
		apiKey: cfg.get<string>('apiKey', ''),
		defaultModel: cfg.get<string>('defaultModel', ''),
		defaultSystemPrompt: cfg.get<string>('defaultSystemPrompt', ''),
		maxConcurrentRequests: cfg.get<number>('maxConcurrentRequests', 4),
		rateLimitPerMinute: cfg.get<number>('rateLimitPerMinute', 60),
		requestTimeoutSeconds: cfg.get<number>('requestTimeoutSeconds', 300),
		enableLogging: cfg.get<boolean>('enableLogging', false),
		autoStart: cfg.get<boolean>('autoStart', true),
	};
}

export async function setDefaultModel(model: string): Promise<void> {
	const cfg = vscode.workspace.getConfiguration(SECTION);
	await cfg.update('defaultModel', model, vscode.ConfigurationTarget.Global);
}
