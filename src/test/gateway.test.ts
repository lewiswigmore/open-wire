import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'net';
import { Gateway } from '../server/gateway';
import {
	LanguageModelTextPart,
	LanguageModelToolCallPart,
	enableDataPart,
	failNextRequest,
	queueText,
	queueTurns,
	recordedRequests,
	resetMock,
	setResponseDelay,
	window as mockWindow,
} from './vscode-mock';

const API_KEY = 'test-key';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let gateway: Gateway | undefined;
let baseUrl = '';

async function startGateway(config: Record<string, unknown> = {}): Promise<void> {
	resetMock({ apiKey: API_KEY, port: 0, host: '127.0.0.1', ...config });
	const output = mockWindow.createOutputChannel('test') as any;
	const statusItem = mockWindow.createStatusBarItem() as any;
	gateway = new Gateway(output, statusItem);
	await gateway.start();
	const addr = (gateway as any).server.address() as AddressInfo;
	baseUrl = `http://127.0.0.1:${addr.port}`;
}

function post(path: string, body: unknown, key = API_KEY): Promise<Response> {
	return fetch(`${baseUrl}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
		body: JSON.stringify(body),
	});
}

function get(path: string, key = API_KEY): Promise<Response> {
	return fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${key}` } });
}

/** Parse an SSE body into its decoded data frames. */
function sseFrames(body: string): any[] {
	return body
		.split('\n\n')
		.map(b => b.trim())
		.filter(b => b.startsWith('data: '))
		.map(b => b.slice(6))
		.filter(b => b !== '[DONE]')
		.map(b => JSON.parse(b));
}

afterEach(async () => {
	await gateway?.stop();
	gateway?.dispose();
	gateway = undefined;
});

describe('auth and routing', () => {
	beforeEach(() => startGateway());

	it('rejects a missing API key', async () => {
		const res = await fetch(`${baseUrl}/health`);
		expect(res.status).toBe(401);
	});

	it('rejects a wrong API key', async () => {
		expect((await get('/health', 'nope')).status).toBe(401);
	});

	it('serves health', async () => {
		const res = await get('/health');
		expect(res.status).toBe(200);
		expect((await res.json() as any).status).toBe('ok');
	});

	it('lists models', async () => {
		const body = await (await get('/v1/models')).json() as any;
		expect(body.object).toBe('list');
		expect(body.data[0].id).toBe('test-model');
	});

	it('404s an unknown endpoint', async () => {
		expect((await get('/v1/nope')).status).toBe(404);
	});

	it('404s an unknown model', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'missing', messages: [{ role: 'user', content: 'hi' }],
		});
		expect(res.status).toBe(404);
	});
});

describe('capabilities', () => {
	beforeEach(() => startGateway());

	it('reports what the build honours', async () => {
		const body = await (await get('/v1/capabilities')).json() as any;
		expect(body.object).toBe('openwire.capabilities');
		expect(body.honoured_params).toContain('temperature');
		expect(body.honoured_params).toContain('response_format');
		expect(body.unsupported_params).toContain('logprobs');
		expect(body.response_format.supported).toContain('json_schema');
		expect(body.image_input.supported).toBe(true);
	});

	it('reports image support as false when DataPart is unavailable', async () => {
		enableDataPart(false);
		const body = await (await get('/v1/capabilities')).json() as any;
		expect(body.image_input.supported).toBe(false);
	});
});

describe('chat completions', () => {
	beforeEach(() => startGateway());

	it('returns assistant content', async () => {
		queueText('hello there');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'hi' }],
		})).json() as any;

		expect(body.object).toBe('chat.completion');
		expect(body.choices[0].message.content).toBe('hello there');
		expect(body.choices[0].finish_reason).toBe('stop');
		expect(body.usage.total_tokens).toBeGreaterThan(0);
	});

	it('returns native tool calls', async () => {
		queueTurns([new LanguageModelToolCallPart('call_1', 'lookup', { q: 'x' })]);
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'hi' }],
			tools: [{ type: 'function', function: { name: 'lookup' } }],
		})).json() as any;

		expect(body.choices[0].finish_reason).toBe('tool_calls');
		expect(body.choices[0].message.tool_calls[0].function.name).toBe('lookup');
		expect(body.choices[0].message.content).toBeNull();
	});

	it('converts an XML function_calls block into tool_calls', async () => {
		queueText('<function_calls>\n<invoke name="exec">\n<parameter name="cmd">ls</parameter>\n</invoke>\n</function_calls>');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'hi' }],
		})).json() as any;
		expect(body.choices[0].message.tool_calls[0].function.name).toBe('exec');
	});

	it('surfaces model failures as a 500', async () => {
		failNextRequest();
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'hi' }],
		});
		expect(res.status).toBe(500);
	});

	it('rejects invalid JSON bodies', async () => {
		const res = await fetch(`${baseUrl}/v1/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
			body: '{not json',
		});
		expect(res.status).toBe(400);
	});
});

describe('sampling parameters', () => {
	beforeEach(() => startGateway());

	it('forwards sampling params to the model via modelOptions', async () => {
		queueText('ok');
		await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'hi' }],
			temperature: 0.1,
			top_p: 0.5,
			max_tokens: 64,
			stop: ['END'],
			seed: 42,
		});

		const options = recordedRequests()[0].options;
		expect(options.modelOptions).toEqual({
			temperature: 0.1, top_p: 0.5, max_tokens: 64, stop: ['END'], seed: 42,
		});
	});

	it('maps max_completion_tokens onto max_tokens', async () => {
		queueText('ok');
		await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'hi' }],
			max_completion_tokens: 128,
		});
		expect(recordedRequests()[0].options.modelOptions).toEqual({ max_tokens: 128 });
	});

	it('rejects an out-of-range temperature instead of ignoring it', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'hi' }], temperature: 9,
		});
		expect(res.status).toBe(400);
		expect((await res.json() as any).error.message).toMatch(/temperature must be between/);
	});

	it('rejects n > 1', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'hi' }], n: 4,
		});
		expect(res.status).toBe(400);
	});
});

describe('parameter honesty', () => {
	it('reports unsupported params instead of silently ignoring them', async () => {
		await startGateway();
		queueText('ok');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'hi' }],
			logprobs: true,
			wibble: 1,
		})).json() as any;

		expect(body.x_openwire.unsupported_params).toEqual(['logprobs']);
		expect(body.x_openwire.unknown_params).toEqual(['wibble']);
	});

	it('omits the report when everything was honoured', async () => {
		await startGateway();
		queueText('ok');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5,
		})).json() as any;
		expect(body.x_openwire).toBeUndefined();
	});

	it('rejects unsupported params when strictParams is on', async () => {
		await startGateway({ strictParams: true });
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'hi' }], logprobs: true,
		});
		expect(res.status).toBe(400);
		expect((await res.json() as any).error.message).toMatch(/Unsupported parameter/);
	});
});

describe('response_format enforcement', () => {
	beforeEach(() => startGateway());

	it('recovers JSON from a fenced block with leading prose', async () => {
		queueText('I\'ll analyze that now.\n\n```json\n{"findings": [], "ok": true}\n```');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'audit this' }],
			response_format: { type: 'json_object' },
		})).json() as any;

		expect(body.choices[0].message.content).toBe('{"findings":[],"ok":true}');
		expect(JSON.parse(body.choices[0].message.content)).toEqual({ findings: [], ok: true });
	});

	it('recovers a raw JSON object preceded by prose', async () => {
		queueText('Here is my assessment:\n{"severity":"low"}');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: { type: 'json_object' },
		})).json() as any;
		expect(JSON.parse(body.choices[0].message.content)).toEqual({ severity: 'low' });
	});

	it('appends a strict instruction to the conversation', async () => {
		queueText('{"a":1}');
		await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: { type: 'json_object' },
		});
		const sent = recordedRequests()[0].messages;
		expect(String(sent[sent.length - 1].content)).toMatch(/single valid JSON value/);
	});

	it('retries once when the first reply has no JSON at all', async () => {
		queueText('I am unable to comply.', '{"ok":true}');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: { type: 'json_object' },
		})).json() as any;

		expect(recordedRequests()).toHaveLength(2);
		expect(JSON.parse(body.choices[0].message.content)).toEqual({ ok: true });
		const retryMessages = recordedRequests()[1].messages;
		expect(String(retryMessages[retryMessages.length - 1].content)).toMatch(/ONLY the corrected JSON/);
	});

	it('fails with 502 rather than returning prose that is not JSON', async () => {
		queueText('nope', 'still nope');
		const res = await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: { type: 'json_object' },
		});
		expect(res.status).toBe(502);
		expect((await res.json() as any).error.message).toMatch(/did not return valid JSON/);
	});

	it('honours a jsonModeMaxRetries of 0', async () => {
		await gateway!.stop();
		await startGateway({ jsonModeMaxRetries: 0 });
		queueText('nope', '{"ok":true}');
		const res = await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: { type: 'json_object' },
		});
		expect(res.status).toBe(502);
		expect(recordedRequests()).toHaveLength(1);
	});

	it('enforces a json_schema', async () => {
		queueText('{"ok":"yes"}', '{"ok":true}');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: 'r',
					schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
				},
			},
		})).json() as any;

		expect(recordedRequests()).toHaveLength(2);
		expect(JSON.parse(body.choices[0].message.content)).toEqual({ ok: true });
	});

	it('rejects a schema with keywords it cannot enforce', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'r', schema: { type: 'object', oneOf: [] } },
			},
		});
		expect(res.status).toBe(400);
		expect((await res.json() as any).error.message).toMatch(/Unsupported JSON Schema keyword/);
	});

	it('rejects an unsupported response_format type', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			response_format: { type: 'yaml' },
		});
		expect(res.status).toBe(400);
	});

	it('does not apply JSON validation when the model returns a tool call', async () => {
		queueTurns([new LanguageModelToolCallPart('c1', 'lookup', {})]);
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{ role: 'user', content: 'x' }],
			tools: [{ type: 'function', function: { name: 'lookup' } }],
			response_format: { type: 'json_object' },
		})).json() as any;
		expect(body.choices[0].finish_reason).toBe('tool_calls');
		expect(recordedRequests()).toHaveLength(1);
	});
});

describe('tool_choice', () => {
	beforeEach(() => startGateway());

	const tools = [
		{ type: 'function', function: { name: 'alpha' } },
		{ type: 'function', function: { name: 'beta' } },
	];

	it('drops tools entirely for "none"', async () => {
		queueText('ok');
		await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			tools, tool_choice: 'none',
		});
		expect(recordedRequests()[0].options.tools).toBeUndefined();
	});

	it('narrows to a single named tool and marks it required', async () => {
		queueText('ok');
		await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			tools, tool_choice: { type: 'function', function: { name: 'beta' } },
		});
		const options = recordedRequests()[0].options;
		expect(options.tools.map((t: any) => t.name)).toEqual(['beta']);
		expect(options.toolMode).toBe(2);
	});

	it('forwards all tools in auto mode', async () => {
		queueText('ok');
		await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }], tools,
		});
		expect(recordedRequests()[0].options.toolMode).toBe(1);
		expect(recordedRequests()[0].options.tools).toHaveLength(2);
	});

	it('rejects a named tool that was not supplied', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			tools, tool_choice: { type: 'function', function: { name: 'gamma' } },
		});
		expect(res.status).toBe(400);
	});

	it('rejects required tool choice when no tools were supplied', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			tool_choice: 'required',
		});
		expect(res.status).toBe(400);
		expect((await res.json() as any).error.message).toMatch(/at least one tool/);
	});

	it('rejects a malformed tools value instead of silently dropping it', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			tools: { type: 'function', function: { name: 'alpha' } },
		});
		expect(res.status).toBe(400);
		expect((await res.json() as any).error.message).toMatch(/tools must be an array/);
	});
});

describe('images', () => {
	const imageMessage = {
		role: 'user',
		content: [
			{ type: 'text', text: 'what is this?' },
			{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
		],
	};

	it('forwards image parts to the model', async () => {
		await startGateway();
		queueText('a pixel');
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [imageMessage],
		});
		expect(res.status).toBe(200);

		const sent = recordedRequests()[0].messages[0].content;
		expect(Array.isArray(sent)).toBe(true);
		expect(sent.some((p: any) => p.mimeType === 'image/png')).toBe(true);
	});

	it('returns 501 when the running VS Code lacks image support', async () => {
		await startGateway();
		enableDataPart(false);
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [imageMessage],
		});
		expect(res.status).toBe(501);
		expect((await res.json() as any).error.message).toMatch(/1\.125/);
	});

	it('rejects remote image URLs', async () => {
		await startGateway();
		const res = await post('/v1/chat/completions', {
			model: 'test-model',
			messages: [{
				role: 'user',
				content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
			}],
		});
		expect(res.status).toBe(400);
		expect((await res.json() as any).error.message).toMatch(/Remote image URLs/);
	});
});

describe('streaming', () => {
	beforeEach(() => startGateway());

	it('streams text deltas and terminates cleanly', async () => {
		queueTurns([new LanguageModelTextPart('Hel'), new LanguageModelTextPart('lo')]);
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }], stream: true,
		});
		const body = await res.text();

		expect(res.headers.get('content-type')).toContain('text/event-stream');
		expect(body.endsWith('data: [DONE]\n\n')).toBe(true);

		const frames = sseFrames(body);
		expect(frames.map(f => f.choices[0]?.delta?.content).filter(Boolean).join('')).toBe('Hello');
		expect(frames[frames.length - 1].choices[0].finish_reason).toBe('stop');
	});

	it('streams tool calls', async () => {
		queueTurns([new LanguageModelToolCallPart('c1', 'lookup', { a: 1 })]);
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			tools: [{ type: 'function', function: { name: 'lookup' } }], stream: true,
		})).text();

		const frames = sseFrames(body);
		expect(frames[0].choices[0].delta.tool_calls[0].function.name).toBe('lookup');
		expect(frames[frames.length - 1].choices[0].finish_reason).toBe('tool_calls');
	});

	it('emits a usage chunk when include_usage is set', async () => {
		queueText('hello');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			stream: true, stream_options: { include_usage: true },
		})).text();

		const usageFrame = sseFrames(body).find(f => f.usage);
		expect(usageFrame.usage.total_tokens).toBeGreaterThan(0);
		expect(usageFrame.choices).toEqual([]);
	});

	it('omits usage by default', async () => {
		queueText('hello');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }], stream: true,
		})).text();
		expect(sseFrames(body).some(f => f.usage)).toBe(false);
	});

	// stream: true must not become a way to lose the capability report.
	it('reports unsupported params in a metadata frame', async () => {
		queueText('hello');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			stream: true, logprobs: true, wibble: 1,
		})).text();

		const frames = sseFrames(body);
		const meta = frames.find(f => f.x_openwire);
		expect(meta.x_openwire.unsupported_params).toEqual(['logprobs']);
		expect(meta.x_openwire.unknown_params).toEqual(['wibble']);
		expect(meta.choices).toEqual([]);
		// It must arrive before any content, so a client sees it up front.
		expect(frames.indexOf(meta)).toBe(0);
	});

	it('omits the metadata frame when everything was honoured', async () => {
		queueText('hello');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }], stream: true,
		})).text();
		expect(sseFrames(body).some(f => f.x_openwire)).toBe(false);
	});

	it('buffers JSON mode into a single valid delta', async () => {
		queueText('Sure!\n```json\n{"a":1}\n```');
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			stream: true, response_format: { type: 'json_object' },
		})).text();

		const frames = sseFrames(body);
		const content = frames.map(f => f.choices[0]?.delta?.content).filter(Boolean).join('');
		expect(content).toBe('{"a":1}');
		expect(body.endsWith('data: [DONE]\n\n')).toBe(true);
	});

	it('reports a validation failure as a real status code, not a 200 stream', async () => {
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
			stream: true, temperature: 99,
		});
		expect(res.status).toBe(400);
	});

	it('emits mid-stream errors as a well-formed SSE frame', async () => {
		failNextRequest();
		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }], stream: true,
		})).text();

		const frames = sseFrames(body);
		expect(frames[0].error.message).toMatch(/model exploded/);
		expect(body.endsWith('data: [DONE]\n\n')).toBe(true);
	});
});

describe('request timeout', () => {
	it('terminates an open SSE stream without corrupting it', async () => {
		await startGateway({ requestTimeoutSeconds: 0.15 });
		setResponseDelay(2000);

		const body = await (await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }], stream: true,
		})).text();

		// Every frame must still parse: the old code wrote a bare JSON body here.
		const frames = sseFrames(body);
		expect(frames.some(f => f.error?.message === 'Request timeout')).toBe(true);
		expect(body.endsWith('data: [DONE]\n\n')).toBe(true);
	});

	it('uses a normal status code when nothing has been sent yet', async () => {
		await startGateway({ requestTimeoutSeconds: 0.15 });
		setResponseDelay(2000);
		const res = await post('/v1/chat/completions', {
			model: 'test-model', messages: [{ role: 'user', content: 'x' }],
		});
		expect(res.status).toBe(504);
	});
});

describe('legacy completions', () => {
	beforeEach(() => startGateway());

	it('returns the text_completion shape', async () => {
		queueText('legacy reply');
		const body = await (await post('/v1/completions', {
			model: 'test-model', prompt: 'hello',
		})).json() as any;

		expect(body.object).toBe('text_completion');
		expect(body.choices[0].text).toBe('legacy reply');
		expect(body.choices[0].message).toBeUndefined();
	});

	it('joins an array prompt', async () => {
		queueText('ok');
		await post('/v1/completions', { model: 'test-model', prompt: ['a', 'b'] });
		expect(String(recordedRequests()[0].messages[0].content)).toContain('a\nb');
	});

	// The legacy endpoint consumes `prompt`, so it must not be reported there.
	it('does not report prompt as unknown on the legacy endpoint', async () => {
		queueText('ok');
		const body = await (await post('/v1/completions', {
			model: 'test-model', prompt: 'hello',
		})).json() as any;
		expect(body.x_openwire).toBeUndefined();
	});

	it('streams in the legacy shape', async () => {
		queueTurns([new LanguageModelTextPart('one'), new LanguageModelTextPart('two')]);
		const body = await (await post('/v1/completions', {
			model: 'test-model', prompt: 'hello', stream: true,
		})).text();

		const frames = sseFrames(body);
		expect(frames.every(f => f.object === 'text_completion')).toBe(true);
		expect(frames.map(f => f.choices[0].text).join('')).toBe('onetwo');
		expect(body.endsWith('data: [DONE]\n\n')).toBe(true);
	});
});
