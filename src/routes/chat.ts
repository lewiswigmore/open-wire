import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import * as vscode from 'vscode';
import { discoverModels, findModel, resolveModelId } from '../models';
import type { ServerConfig } from '../server/config';
import {
	appendInstruction,
	hasImageParts,
	injectSystemPrompt,
	normalizeMessages,
	type ContentPart,
	type NormalizedMessage,
} from './content';
import { RequestError, badRequest } from './errors';
import {
	buildJsonInstruction,
	buildRepairInstruction,
	isJsonMode,
	parseResponseFormat,
	validateJsonOutput,
	type ResponseFormat,
} from './json-mode';
import {
	assertSingleChoice,
	buildModelOptions,
	classifyParams,
	wantsStreamUsage,
	type ParamReport,
} from './params';
import {
	applyToolChoice,
	mapTools,
	parseXmlToolCalls,
	planToolChoice,
	type ParsedToolCall,
} from './tool-calls';

export { normalizeMessages };
export type ChatMessage = NormalizedMessage;

/**
 * Image input needs `LanguageModelDataPart`, which reached the stable VS Code
 * API in 1.125. OpenWire keeps a 1.95 engine floor so the rest of the release
 * stays broadly installable, so the capability is detected rather than assumed.
 */
export function supportsImageInput(): boolean {
	const DataPart = (vscode as any).LanguageModelDataPart;
	return typeof DataPart?.image === 'function';
}

function toDataPart(part: Extract<ContentPart, { kind: 'image' }>): unknown {
	const DataPart = (vscode as any).LanguageModelDataPart;
	return DataPart.image(new Uint8Array(Buffer.from(part.base64, 'base64')), part.mimeType);
}

/** Build the vscode content parts for a user turn, including images. */
function toUserParts(msg: NormalizedMessage): unknown[] {
	const parts: unknown[] = [];
	for (const part of msg.parts) {
		if (part.kind === 'text') {
			if (part.text) parts.push(new vscode.LanguageModelTextPart(part.text));
		} else {
			parts.push(toDataPart(part));
		}
	}
	return parts;
}

/** Convert normalised messages to VS Code LanguageModelChatMessage[] */
function toVscodeMessages(msgs: NormalizedMessage[]): vscode.LanguageModelChatMessage[] {
	return msgs.map(msg => {
		const text = msg.text;

		switch (msg.role) {
			case 'system':
				// The VS Code LM API exposes no System factory, so system content is
				// delivered as a marked user turn.
				return vscode.LanguageModelChatMessage.User(`[System]: ${text}`);

			case 'assistant': {
				if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
					const parts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [];
					// Preserve any text content the assistant produced before tool calls
					if (text && text !== 'null' && text !== 'undefined') {
						parts.push(new vscode.LanguageModelTextPart(text));
					}
					for (const tc of msg.tool_calls as any[]) {
						const name = tc.function?.name || tc.name || 'unknown';
						const rawArgs = tc.function?.arguments ?? tc.arguments;
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

			default: {
				// Keep plain text turns as strings; only switch to the parts form
				// when there is binary content that a string cannot carry.
				if (!msg.parts.some(p => p.kind === 'image')) {
					return vscode.LanguageModelChatMessage.User(text);
				}
				return vscode.LanguageModelChatMessage.User(toUserParts(msg) as any);
			}
		}
	});
}

interface PreparedRequest {
	modelId: string;
	lm: vscode.LanguageModelChat;
	messages: NormalizedMessage[];
	options: vscode.LanguageModelChatRequestOptions;
	format: ResponseFormat;
	report: ParamReport;
}

/** Shared validation and setup for both the streaming and non-streaming paths. */
async function prepareRequest(payload: any, config: ServerConfig): Promise<PreparedRequest> {
	assertSingleChoice(payload);

	const report = classifyParams(payload);
	if (config.strictParams && (report.unsupported.length > 0 || report.unknown.length > 0)) {
		const offending = [...report.unsupported, ...report.unknown].join(', ');
		throw badRequest(
			`Unsupported parameter(s): ${offending}. ` +
			'Disable openWire.server.strictParams to send them as no-ops.',
		);
	}

	const format = parseResponseFormat(payload?.response_format);

	let messages = normalizeMessages(payload?.messages);
	messages = injectSystemPrompt(messages, config.defaultSystemPrompt);

	if (hasImageParts(messages) && !supportsImageInput()) {
		throw new RequestError(
			501,
			'Image input requires VS Code 1.125 or newer (LanguageModelDataPart is unavailable in this build).',
		);
	}

	if (isJsonMode(format)) {
		messages = appendInstruction(messages, buildJsonInstruction(format));
	}

	const modelId = resolveModelId(payload?.model, config.defaultModel);
	const models = await discoverModels();
	if (models.length === 0) {
		throw new RequestError(503, 'No language models available. Is GitHub Copilot signed in?');
	}

	const lm = findModel(modelId, models);
	if (!lm) {
		throw new RequestError(
			404,
			`Model "${modelId}" not found. Available: ${models.map(m => m.id).join(', ')}`,
		);
	}

	const options: vscode.LanguageModelChatRequestOptions = {};

	const modelOptions = buildModelOptions(payload);
	if (Object.keys(modelOptions).length > 0) {
		options.modelOptions = modelOptions;
	}

	const plan = planToolChoice(payload?.tool_choice);
	const resolved = applyToolChoice(mapTools(payload?.tools), plan);
	if (resolved) {
		options.tools = resolved.tools;
		options.toolMode = resolved.required
			? vscode.LanguageModelChatToolMode.Required
			: vscode.LanguageModelChatToolMode.Auto;
	}

	return { modelId, lm, messages, options, format, report };
}

interface ModelTurn {
	content: string;
	toolCalls: ParsedToolCall[];
}

/** Run one full model turn, collecting text and native tool calls. */
async function runTurn(
	lm: vscode.LanguageModelChat,
	messages: vscode.LanguageModelChatMessage[],
	options: vscode.LanguageModelChatRequestOptions,
	token: vscode.CancellationToken,
): Promise<ModelTurn> {
	const response = await lm.sendRequest(messages, options, token);
	let content = '';
	const toolCalls: ParsedToolCall[] = [];

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

	// Some models answer with a raw XML block instead of a native tool call.
	if (toolCalls.length === 0 && content.includes('<function_calls>')) {
		const parsed = parseXmlToolCalls(content);
		toolCalls.push(...parsed.toolCalls);
		content = parsed.cleanedText;
	}

	return { content, toolCalls };
}

/**
 * Run a turn and, when JSON is required, validate it and retry a bounded number
 * of times. Fails with 502 rather than returning prose that claims to be JSON.
 */
async function runWithJsonEnforcement(
	prepared: PreparedRequest,
	config: ServerConfig,
	token: vscode.CancellationToken,
): Promise<ModelTurn> {
	const { lm, options, format } = prepared;
	let conversation = toVscodeMessages(prepared.messages);
	let lastReason = 'unknown';
	let lastOutput = '';

	const attempts = isJsonMode(format) ? config.jsonModeMaxRetries + 1 : 1;

	for (let attempt = 0; attempt < attempts; attempt++) {
		const turn = await runTurn(lm, conversation, options, token);

		// A tool call is a valid non-final answer; JSON mode applies to prose replies.
		if (!isJsonMode(format) || turn.toolCalls.length > 0) {
			return turn;
		}

		const validation = validateJsonOutput(turn.content, format);
		if (validation.ok) {
			return { content: validation.json, toolCalls: turn.toolCalls };
		}

		lastReason = validation.reason;
		lastOutput = turn.content;

		if (attempt < attempts - 1) {
			conversation = [
				...conversation,
				vscode.LanguageModelChatMessage.Assistant(turn.content),
				vscode.LanguageModelChatMessage.User(
					buildRepairInstruction(format, turn.content, validation.reason),
				),
			];
		}
	}

	throw new RequestError(
		502,
		'Model did not return valid JSON for the requested response_format after ' +
		`${attempts} attempt(s). Last failure: ${lastReason}. ` +
		`Last output began: ${JSON.stringify(lastOutput.slice(0, 200))}`,
	);
}

async function countUsage(
	lm: vscode.LanguageModelChat,
	messages: vscode.LanguageModelChatMessage[],
	completion: string,
	token: vscode.CancellationToken,
): Promise<{ prompt_tokens: number; completion_tokens: number; total_tokens: number }> {
	const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
	try {
		const promptStr = messages.map(messageToText).join('\n');
		usage.prompt_tokens = await lm.countTokens(promptStr, token);
		usage.completion_tokens = await lm.countTokens(completion, token);
		usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
	} catch { /* best effort */ }
	return usage;
}

/** Flatten a vscode message back to text for token estimation. */
function messageToText(message: vscode.LanguageModelChatMessage): string {
	const content: unknown = message.content;
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((part: any) => (typeof part?.value === 'string' ? part.value : ''))
		.join('');
}

/** Attach the capability report so callers can see what was ignored. */
function withParamReport<T extends object>(result: T, report: ParamReport): T {
	if (report.unsupported.length === 0 && report.unknown.length === 0) return result;
	return {
		...result,
		x_openwire: {
			unsupported_params: report.unsupported,
			unknown_params: report.unknown,
			note: 'These fields were accepted but had no effect. Enable openWire.server.strictParams to reject them instead.',
		},
	};
}

/** Non-streaming chat completion */
export async function processChatCompletion(
	payload: any,
	config: ServerConfig,
): Promise<object> {
	const prepared = await prepareRequest(payload, config);
	const cts = new vscode.CancellationTokenSource();

	try {
		const turn = await runWithJsonEnforcement(prepared, config, cts.token);
		const lmMessages = toVscodeMessages(prepared.messages);
		const usage = await countUsage(prepared.lm, lmMessages, turn.content, cts.token);

		const hasTools = turn.toolCalls.length > 0;
		const result = {
			id: `chatcmpl-${randomUUID()}`,
			object: 'chat.completion',
			created: Math.floor(Date.now() / 1000),
			model: prepared.modelId,
			choices: [{
				index: 0,
				message: {
					role: 'assistant',
					content: hasTools ? null : turn.content,
					...(hasTools && { tool_calls: turn.toolCalls }),
				},
				finish_reason: hasTools ? 'tool_calls' : 'stop',
			}],
			usage,
		};

		return withParamReport(result, prepared.report);
	} finally {
		cts.dispose();
	}
}

// ── streaming ─────────────────────────────────────────────

function sseChunk(res: ServerResponse, payload: object): void {
	if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sseDone(res: ServerResponse): void {
	if (!res.writableEnded) res.write('data: [DONE]\n\n');
}

/**
 * Emit an error inside an already-open SSE stream, then terminate it cleanly.
 * Writing a bare JSON body here would corrupt the event stream.
 */
export function writeSseError(res: ServerResponse, message: string, code?: number): void {
	sseChunk(res, { error: { message, type: 'server_error', ...(code ? { code } : {}) } });
	sseDone(res);
}

/** Streaming chat completion via SSE */
export async function processStreamingChatCompletion(
	payload: any,
	config: ServerConfig,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	// Prepare before writing headers so validation failures surface as real HTTP
	// status codes rather than an error buried inside a 200 stream.
	const prepared = await prepareRequest(payload, config);
	const includeUsage = wantsStreamUsage(payload);

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

	const base = { id: requestId, object: 'chat.completion.chunk', created, model: prepared.modelId };
	let completionText = '';

	try {
		if (isJsonMode(prepared.format)) {
			// Validity cannot be judged mid-stream, so JSON mode buffers the turn,
			// enforces the contract, then emits the result as a single delta.
			const turn = await runWithJsonEnforcement(prepared, config, cts.token);
			if (cts.token.isCancellationRequested) return;

			completionText = turn.content;
			const hasTools = turn.toolCalls.length > 0;

			if (hasTools) {
				turn.toolCalls.forEach((tc, i) => {
					sseChunk(res, {
						...base,
						choices: [{
							index: 0,
							delta: {
								...(i === 0 ? { role: 'assistant' as const } : {}),
								tool_calls: [{ index: i, id: tc.id, type: 'function', function: tc.function }],
							},
							finish_reason: null,
						}],
					});
				});
			} else {
				sseChunk(res, {
					...base,
					choices: [{
						index: 0,
						delta: { role: 'assistant' as const, content: turn.content },
						finish_reason: null,
					}],
				});
			}

			sseChunk(res, {
				...base,
				choices: [{ index: 0, delta: {}, finish_reason: hasTools ? 'tool_calls' : 'stop' }],
			});
		} else {
			const response = await prepared.lm.sendRequest(
				toVscodeMessages(prepared.messages),
				prepared.options,
				cts.token,
			);

			let hasToolCalls = false;
			let toolCallIndex = 0;
			let isFirstDelta = true;

			for await (const part of response.stream) {
				if (cts.token.isCancellationRequested) break;

				if (part instanceof vscode.LanguageModelTextPart) {
					completionText += part.value;
					sseChunk(res, {
						...base,
						choices: [{
							index: 0,
							delta: {
								...(isFirstDelta ? { role: 'assistant' as const } : {}),
								content: part.value,
							},
							finish_reason: null,
						}],
					});
					isFirstDelta = false;
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					hasToolCalls = true;
					sseChunk(res, {
						...base,
						choices: [{
							index: 0,
							delta: {
								...(isFirstDelta ? { role: 'assistant' as const } : {}),
								tool_calls: [{
									index: toolCallIndex++,
									id: part.callId || `call_${randomUUID()}`,
									type: 'function',
									function: { name: part.name, arguments: JSON.stringify(part.input) },
								}],
							},
							finish_reason: null,
						}],
					});
					isFirstDelta = false;
				}
			}

			if (cts.token.isCancellationRequested) return;

			sseChunk(res, {
				...base,
				choices: [{ index: 0, delta: {}, finish_reason: hasToolCalls ? 'tool_calls' : 'stop' }],
			});
		}

		if (includeUsage) {
			const usage = await countUsage(
				prepared.lm,
				toVscodeMessages(prepared.messages),
				completionText,
				cts.token,
			);
			sseChunk(res, { ...base, choices: [], usage });
		}

		sseDone(res);
	} catch (err: any) {
		if (!cts.token.isCancellationRequested) {
			writeSseError(res, err?.message || 'Internal error', err?.status);
		}
	} finally {
		clearInterval(heartbeat);
		cts.dispose();
		if (!res.writableEnded) res.end();
	}
}
