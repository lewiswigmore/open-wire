import type { ServerResponse } from 'http';

/**
 * The legacy `/v1/completions` endpoint is served by the chat pipeline, so its
 * responses have to be mapped back to the `text_completion` shape. Clients that
 * still use this endpoint read `choices[].text`, not `choices[].message`.
 */

/**
 * Map chat choices onto the legacy choice shape: message/delta content
 * collapses to a text string, and a missing finish_reason falls back to
 * `stop` for final completions or null for stream chunks.
 */
function mapLegacyChoices(
	choices: any[],
	pickText: (choice: any) => unknown,
	fallbackFinish: string | null,
): any[] {
	return choices.map((c: any) => {
		const raw = pickText(c);
		return {
			index: c?.index ?? 0,
			text: typeof raw === 'string' ? raw : '',
			logprobs: null,
			finish_reason: c?.finish_reason ?? fallbackFinish,
		};
	});
}

/** Map a non-streaming chat.completion object onto the legacy shape. */
export function toLegacyCompletion(result: any): any {
	const choices = Array.isArray(result?.choices) ? result.choices : [];
	return {
		...result,
		object: 'text_completion',
		choices: mapLegacyChoices(choices, c => c?.message?.content, 'stop'),
	};
}

/** Map a streaming chat.completion.chunk onto the legacy streaming shape. */
export function toLegacyChunk(chunk: any): any {
	const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
	return {
		...chunk,
		object: 'text_completion',
		choices: mapLegacyChoices(choices, c => c?.delta?.content, null),
	};
}

/** Rewrite one raw SSE payload string, leaving comments and [DONE] untouched. */
export function rewriteSseLine(raw: string): string {
	if (!raw.startsWith('data: ')) return raw;

	const body = raw.slice(6).trim();
	if (!body || body === '[DONE]') return raw;

	try {
		const parsed = JSON.parse(body);
		if (parsed?.error) return raw;
		return `data: ${JSON.stringify(toLegacyChunk(parsed))}\n\n`;
	} catch {
		return raw;
	}
}

/**
 * Wrap a response so SSE frames written through it are converted to the legacy
 * shape. Every other member is bound to the real response, so stream state such
 * as `writableEnded` stays accurate.
 */
export function legacyStreamResponse(res: ServerResponse): ServerResponse {
	const write = res.write.bind(res);

	return new Proxy(res, {
		get(target, prop, receiver) {
			if (prop === 'write') {
				return (chunk: any, ...rest: any[]) => {
					if (typeof chunk === 'string') {
						return (write as any)(rewriteSseLine(chunk), ...rest);
					}
					return (write as any)(chunk, ...rest);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}
