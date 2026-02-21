import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import * as vscode from 'vscode';
import { discoverModels, findModel, resolveModelId } from '../models';
import type { ServerConfig } from '../server/config';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
	content: string | unknown;
	tool_calls?: unknown[];
	tool_call_id?: string;
}

/** Normalise incoming messages to a flat role+content array */
export function normalizeMessages(raw: unknown): ChatMessage[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(m => ({
		role: m.role === 'developer' ? 'system' : m.role,
		content: m.content,
		tool_calls: m.tool_calls,
		tool_call_id: m.tool_call_id,
	}));
}

/** Convert our chat messages to VS Code LanguageModelChatMessage[] */
function toVscodeMessages(msgs: ChatMessage[]): vscode.LanguageModelChatMessage[] {
	return msgs.map(msg => {
		const text = typeof msg.content === 'string'
			? msg.content
			: JSON.stringify(msg.content);

		switch (msg.role) {
			case 'system':
				return vscode.LanguageModelChatMessage.User(`[System]: ${text}`);
			case 'assistant':
				if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
					const info = msg.tool_calls.map((tc: any) =>
						`[Called function: ${tc.function?.name || tc.name}(${tc.function?.arguments || JSON.stringify(tc.arguments)})]`
					).join('\n');
					return vscode.LanguageModelChatMessage.Assistant(info);
				}
				return vscode.LanguageModelChatMessage.Assistant(text);
			case 'tool': {
				const toolText = `[Tool result for ${msg.tool_call_id || 'unknown'}]: ${text}`;
				return vscode.LanguageModelChatMessage.User(toolText);
			}
			default:
				return vscode.LanguageModelChatMessage.User(text);
		}
	});
}

/** Inject default system prompt if none present */
function injectSystemPrompt(msgs: ChatMessage[], prompt: string): ChatMessage[] {
	if (!prompt) return msgs;
	if (msgs.some(m => m.role === 'system')) return msgs;
	return [{ role: 'system', content: prompt }, ...msgs];
}

/** Non-streaming chat completion */
export async function processChatCompletion(
	payload: any,
	config: ServerConfig,
): Promise<object> {
	let messages = normalizeMessages(payload?.messages);
	messages = injectSystemPrompt(messages, config.defaultSystemPrompt);

	const modelId = resolveModelId(payload?.model, config.defaultModel);
	const models = await discoverModels();
	if (models.length === 0) {
		throw { status: 503, message: 'No language models available. Is GitHub Copilot signed in?' };
	}

	const lm = findModel(modelId, models);
	if (!lm) {
		throw { status: 404, message: `Model "${modelId}" not found. Available: ${models.map(m => m.id).join(', ')}` };
	}

	const lmMessages = toVscodeMessages(messages);
	const options: vscode.LanguageModelChatRequestOptions = {};

	// Forward tools if provided (guard: LanguageModelToolInputSchema may not exist in older VS Code)
	if (payload?.tools && Array.isArray(payload.tools) && payload.tools.length > 0
		&& typeof vscode.LanguageModelToolInformation === 'function'
		&& typeof vscode.LanguageModelToolInputSchema?.from === 'function') {
		options.tools = payload.tools.map((t: any) => {
			const fn = t.function || t;
			return new vscode.LanguageModelToolInformation(
				fn.name,
				fn.description || '',
				fn.parameters ? vscode.LanguageModelToolInputSchema.from(fn.parameters) : vscode.LanguageModelToolInputSchema.from({}),
			);
		});
		const tc = payload.tool_choice;
		options.toolMode = (tc === 'required' || tc === 'any')
			? vscode.LanguageModelChatToolMode.Required
			: vscode.LanguageModelChatToolMode.Auto;
	}

	const cts = new vscode.CancellationTokenSource();
	try {
		const response = await lm.sendRequest(lmMessages, options, cts.token);
		let content = '';
		const toolCalls: any[] = [];

		for await (const part of response.stream) {
			if (part instanceof vscode.LanguageModelTextPart) {
				content += part.value;
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				toolCalls.push({
					id: part.callId || `call_${randomUUID()}`,
					type: 'function',
					function: { name: part.name, arguments: JSON.stringify(part.input) },
				});
			}
		}

		const requestId = `chatcmpl-${randomUUID()}`;
		const result: any = {
			id: requestId,
			object: 'chat.completion',
			created: Math.floor(Date.now() / 1000),
			model: modelId,
			choices: [{
				index: 0,
				message: {
					role: 'assistant',
					content: toolCalls.length > 0 ? null : content,
					...(toolCalls.length > 0 && { tool_calls: toolCalls }),
				},
				finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
			}],
			usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
		};

		// Best-effort token counting
		try {
			const promptStr = lmMessages.map(m =>
				typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
			).join('\n');
			result.usage.prompt_tokens = await lm.countTokens(promptStr, cts.token);
			result.usage.completion_tokens = await lm.countTokens(content, cts.token);
			result.usage.total_tokens = result.usage.prompt_tokens + result.usage.completion_tokens;
		} catch { }

		return result;
	} finally {
		cts.dispose();
	}
}

/** Streaming chat completion via SSE */
export async function processStreamingChatCompletion(
	payload: any,
	config: ServerConfig,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	let messages = normalizeMessages(payload?.messages);
	messages = injectSystemPrompt(messages, config.defaultSystemPrompt);

	const modelId = resolveModelId(payload?.model, config.defaultModel);
	const models = await discoverModels();
	if (models.length === 0) {
		throw { status: 503, message: 'No language models available. Is GitHub Copilot signed in?' };
	}

	const lm = findModel(modelId, models);
	if (!lm) {
		throw { status: 404, message: `Model "${modelId}" not found. Available: ${models.map(m => m.id).join(', ')}` };
	}

	const lmMessages = toVscodeMessages(messages);
	const options: vscode.LanguageModelChatRequestOptions = {};

	if (payload?.tools && Array.isArray(payload.tools) && payload.tools.length > 0
		&& typeof vscode.LanguageModelToolInformation === 'function'
		&& typeof vscode.LanguageModelToolInputSchema?.from === 'function') {
		options.tools = payload.tools.map((t: any) => {
			const fn = t.function || t;
			return new vscode.LanguageModelToolInformation(
				fn.name,
				fn.description || '',
				fn.parameters ? vscode.LanguageModelToolInputSchema.from(fn.parameters) : vscode.LanguageModelToolInputSchema.from({}),
			);
		});
		const tc = payload.tool_choice;
		options.toolMode = (tc === 'required' || tc === 'any')
			? vscode.LanguageModelChatToolMode.Required
			: vscode.LanguageModelChatToolMode.Auto;
	}

	const requestId = `chatcmpl-${randomUUID()}`;
	const created = Math.floor(Date.now() / 1000);

	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		'Connection': 'keep-alive',
		'X-Request-Id': requestId,
	});

	const cts = new vscode.CancellationTokenSource();
	req.on('close', () => cts.cancel());

	const heartbeat = setInterval(() => {
		if (!res.writableEnded) res.write(': ping\n\n');
	}, 15_000);

	try {
		const response = await lm.sendRequest(lmMessages, options, cts.token);

		for await (const part of response.stream) {
			if (cts.token.isCancellationRequested) break;

			if (part instanceof vscode.LanguageModelTextPart) {
				const chunk = {
					id: requestId,
					object: 'chat.completion.chunk',
					created,
					model: modelId,
					choices: [{
						index: 0,
						delta: { content: part.value },
						finish_reason: null,
					}],
				};
				res.write(`data: ${JSON.stringify(chunk)}\n\n`);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				const chunk = {
					id: requestId,
					object: 'chat.completion.chunk',
					created,
					model: modelId,
					choices: [{
						index: 0,
						delta: {
							tool_calls: [{
								index: 0,
								id: part.callId || `call_${randomUUID()}`,
								type: 'function',
								function: { name: part.name, arguments: JSON.stringify(part.input) },
							}],
						},
						finish_reason: null,
					}],
				};
				res.write(`data: ${JSON.stringify(chunk)}\n\n`);
			}
		}

		// Final chunk
		if (!cts.token.isCancellationRequested) {
			const final = {
				id: requestId,
				object: 'chat.completion.chunk',
				created,
				model: modelId,
				choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
			};
			res.write(`data: ${JSON.stringify(final)}\n\n`);
			res.write('data: [DONE]\n\n');
		}
	} catch (err: any) {
		if (!cts.token.isCancellationRequested) {
			const errChunk = {
				error: { message: err.message || 'Internal error', type: 'server_error' },
			};
			res.write(`data: ${JSON.stringify(errChunk)}\n\n`);
		}
	} finally {
		clearInterval(heartbeat);
		cts.dispose();
		if (!res.writableEnded) res.end();
	}
}
