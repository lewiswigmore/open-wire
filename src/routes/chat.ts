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

/** Extract plain text from content that may be a string, array of content parts, or other format */
function normalizeContent(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		return content
			.filter((p: any) => typeof p === 'string' || p?.type === 'text')
			.map((p: any) => typeof p === 'string' ? p : (p?.text ?? ''))
			.join('');
	}
	if (content == null) return '';
	return String(content);
}

/** Normalise incoming messages to a flat role+content array */
export function normalizeMessages(raw: unknown): ChatMessage[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(m => ({
		role: m.role === 'developer' ? 'system' : m.role,
		content: normalizeContent(m.content),
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
			case 'assistant': {
				if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
					const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
					// Preserve any text content the assistant produced before tool calls
					if (text && text !== 'null' && text !== 'undefined') {
						parts.push(new vscode.LanguageModelTextPart(text));
					}
					for (const tc of msg.tool_calls as any[]) {
						const name = tc.function?.name || tc.name || 'unknown';
						const rawArgs = tc.function?.arguments || tc.arguments;
						const callId = tc.id || `call_${randomUUID()}`;
						let input: object;
						if (typeof rawArgs === 'string') {
							try { input = JSON.parse(rawArgs); } catch { input = { _raw: rawArgs }; }
						} else {
							input = rawArgs ?? {};
						}
						parts.push(new vscode.LanguageModelToolCallPart(callId, name, input));
					}
					return vscode.LanguageModelChatMessage.Assistant(parts);
				}
				return vscode.LanguageModelChatMessage.Assistant(text);
			}
			case 'tool': {
				const callId = msg.tool_call_id || 'unknown';
				return vscode.LanguageModelChatMessage.User([
					new vscode.LanguageModelToolResultPart(callId, [
						new vscode.LanguageModelTextPart(text),
					]),
				]);
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

/**
 * Parse XML-style function calls from model text output.
 * Claude falls back to this format when native tool calling isn't available.
 */
function parseXmlToolCalls(text: string): { cleanedText: string; toolCalls: any[] } {
	const toolCalls: any[] = [];
	const cleaned = text.replace(
		/<function_calls>\s*([\s\S]*?)<\/function_calls>/g,
		(_match, block: string) => {
			for (const inv of block.matchAll(/<invoke\s+name="([^"]+)">\s*([\s\S]*?)<\/invoke>/g)) {
				const params: Record<string, string> = {};
				for (const p of inv[2].matchAll(/<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g)) {
					params[p[1]] = p[2];
				}
				toolCalls.push({
					id: `call_${randomUUID()}`,
					type: 'function',
					function: { name: inv[1], arguments: JSON.stringify(params) },
				});
			}
			return '';
		},
	);
	return { cleanedText: cleaned.trim(), toolCalls };
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

	// Forward tools as plain LanguageModelChatTool objects
	if (payload?.tools && Array.isArray(payload.tools) && payload.tools.length > 0) {
		options.tools = payload.tools.map((t: any) => {
			const fn = t.function || t;
			return {
				name: fn.name,
				description: fn.description || '',
				inputSchema: fn.parameters || {},
			};
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

		// If no native tool calls detected, check for XML-format function calls in text
		if (toolCalls.length === 0 && content.includes('<function_calls>')) {
			const parsed = parseXmlToolCalls(content);
			toolCalls.push(...parsed.toolCalls);
			content = parsed.cleanedText;
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

	if (payload?.tools && Array.isArray(payload.tools) && payload.tools.length > 0) {
		options.tools = payload.tools.map((t: any) => {
			const fn = t.function || t;
			return {
				name: fn.name,
				description: fn.description || '',
				inputSchema: fn.parameters || {},
			};
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
		const toolsForwarded = !!(options.tools && options.tools.length > 0);
		const needsToolParsing = !toolsForwarded && payload?.tools?.length > 0;

		if (needsToolParsing) {
			// Buffer mode: tools were requested but couldn't be forwarded natively.
			// Collect the full response and parse XML-format function calls from text.
			let content = '';
			for await (const part of response.stream) {
				if (cts.token.isCancellationRequested) break;
				if (part instanceof vscode.LanguageModelTextPart) {
					content += part.value;
				}
			}

			if (!cts.token.isCancellationRequested) {
				const parsed = content.includes('<function_calls>')
					? parseXmlToolCalls(content)
					: { cleanedText: content, toolCalls: [] as any[] };

				if (parsed.cleanedText) {
					const chunk = {
						id: requestId,
						object: 'chat.completion.chunk',
						created,
						model: modelId,
						choices: [{
							index: 0,
							delta: { role: 'assistant' as const, content: parsed.cleanedText },
							finish_reason: null,
						}],
					};
					res.write(`data: ${JSON.stringify(chunk)}\n\n`);
				}

				for (let i = 0; i < parsed.toolCalls.length; i++) {
					const tc = parsed.toolCalls[i];
					const chunk = {
						id: requestId,
						object: 'chat.completion.chunk',
						created,
						model: modelId,
						choices: [{
							index: 0,
							delta: {
								tool_calls: [{
									index: i,
									id: tc.id,
									type: 'function',
									function: tc.function,
								}],
							},
							finish_reason: null,
						}],
					};
					res.write(`data: ${JSON.stringify(chunk)}\n\n`);
				}

				const final = {
					id: requestId,
					object: 'chat.completion.chunk',
					created,
					model: modelId,
					choices: [{
						index: 0,
						delta: {},
						finish_reason: parsed.toolCalls.length > 0 ? 'tool_calls' : 'stop',
					}],
				};
				res.write(`data: ${JSON.stringify(final)}\n\n`);
				res.write('data: [DONE]\n\n');
			}
		} else {
			// Normal streaming mode with native tool calling support
			let hasToolCalls = false;
			let toolCallIndex = 0;
			let isFirstDelta = true;

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
							delta: {
								...(isFirstDelta && { role: 'assistant' as const }),
								content: part.value,
							},
							finish_reason: null,
						}],
					};
					isFirstDelta = false;
					res.write(`data: ${JSON.stringify(chunk)}\n\n`);
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					hasToolCalls = true;
					const chunk = {
						id: requestId,
						object: 'chat.completion.chunk',
						created,
						model: modelId,
						choices: [{
							index: 0,
							delta: {
								...(isFirstDelta && { role: 'assistant' as const }),
								tool_calls: [{
									index: toolCallIndex++,
									id: part.callId || `call_${randomUUID()}`,
									type: 'function',
									function: { name: part.name, arguments: JSON.stringify(part.input) },
								}],
							},
							finish_reason: null,
						}],
					};
					isFirstDelta = false;
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
					choices: [{
						index: 0,
						delta: {},
						finish_reason: hasToolCalls ? 'tool_calls' : 'stop',
					}],
				};
				res.write(`data: ${JSON.stringify(final)}\n\n`);
				res.write('data: [DONE]\n\n');
			}
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
