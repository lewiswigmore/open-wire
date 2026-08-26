import { badRequest } from './errors';

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface TextPart {
	kind: 'text';
	text: string;
}

export interface ImagePart {
	kind: 'image';
	mimeType: string;
	/** Raw base64 payload, without the data: URI prefix. */
	base64: string;
}

export type ContentPart = TextPart | ImagePart;

export interface NormalizedMessage {
	role: Role;
	parts: ContentPart[];
	/** Flattened text, for token counting and text-only transports. */
	text: string;
	tool_calls?: unknown[];
	tool_call_id?: string;
}

const SUPPORTED_IMAGE_TYPES = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
]);

export const SUPPORTED_IMAGE_MIME_TYPES: string[] = [...SUPPORTED_IMAGE_TYPES].sort();

/**
 * Parse a data: URI into a mime type and base64 payload.
 * Returns null when the input is not a data: URI.
 */
export function parseDataUri(url: string): { mimeType: string; base64: string } | null {
	if (!url.startsWith('data:')) return null;

	const comma = url.indexOf(',');
	if (comma === -1) {
		throw badRequest('Malformed data: URI in image_url (missing comma separator)');
	}

	const meta = url.slice(5, comma);
	const payload = url.slice(comma + 1);

	if (!/;base64$/i.test(meta)) {
		throw badRequest('Only base64-encoded data: URIs are supported for image_url');
	}

	const mimeType = meta.replace(/;base64$/i, '').trim().toLowerCase() || 'image/png';
	if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
		throw badRequest(
			`Unsupported image type "${mimeType}". Supported: ${[...SUPPORTED_IMAGE_TYPES].join(', ')}`,
		);
	}

	const base64 = payload.replace(/\s/g, '');
	if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
		throw badRequest('image_url data: URI does not contain valid base64 data');
	}

	return { mimeType, base64 };
}

/** Convert one OpenAI content part into our internal representation. */
function toContentPart(part: unknown): ContentPart | null {
	if (typeof part === 'string') {
		return { kind: 'text', text: part };
	}
	if (typeof part !== 'object' || part === null) return null;

	const p = part as Record<string, any>;

	if (p.type === 'text') {
		return { kind: 'text', text: typeof p.text === 'string' ? p.text : '' };
	}

	if (p.type === 'image_url') {
		const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
		if (typeof url !== 'string' || !url) {
			throw badRequest('image_url part is missing a url');
		}
		if (/^https?:/i.test(url)) {
			// Fetching remote URLs would let a caller drive requests from the user's
			// machine into their own network. Callers must inline the bytes instead.
			throw badRequest(
				'Remote image URLs are not supported. Inline the image as a base64 data: URI.',
			);
		}
		const parsed = parseDataUri(url);
		if (!parsed) {
			throw badRequest('image_url must be a base64 data: URI');
		}
		return { kind: 'image', mimeType: parsed.mimeType, base64: parsed.base64 };
	}

	if (p.type === 'input_audio' || p.type === 'file') {
		throw badRequest(`Content part type "${p.type}" is not supported by OpenWire`);
	}

	return null;
}

/** Normalise message content into ordered parts. */
export function normalizeContentParts(content: unknown): ContentPart[] {
	if (typeof content === 'string') {
		return content ? [{ kind: 'text', text: content }] : [];
	}
	if (Array.isArray(content)) {
		const parts: ContentPart[] = [];
		for (const raw of content) {
			const part = toContentPart(raw);
			if (part) parts.push(part);
		}
		return parts;
	}
	if (content == null) return [];
	return [{ kind: 'text', text: String(content) }];
}

/** Flatten parts to plain text, preserving a placeholder for images. */
export function partsToText(parts: ContentPart[]): string {
	return parts.map(p => (p.kind === 'text' ? p.text : '')).join('');
}

/** Extract text from content that is a string, an array of text parts, or something else. */
export function normalizeContent(content: unknown): string {
	return partsToText(normalizeContentParts(content));
}

/** True when any message carries an image part. */
export function hasImageParts(messages: NormalizedMessage[]): boolean {
	return messages.some(m => m.parts.some(p => p.kind === 'image'));
}

/** Normalise incoming messages to a flat role + parts array. */
export function normalizeMessages(raw: unknown): NormalizedMessage[] {
	if (!Array.isArray(raw)) return [];
	return raw.map(m => {
		const parts = normalizeContentParts(m?.content);
		return {
			role: (m?.role === 'developer' ? 'system' : m?.role) as Role,
			parts,
			text: partsToText(parts),
			tool_calls: m?.tool_calls,
			tool_call_id: m?.tool_call_id,
		};
	});
}

/** Inject a default system prompt when the request has no system message. */
export function injectSystemPrompt(
	msgs: NormalizedMessage[],
	prompt: string,
): NormalizedMessage[] {
	if (!prompt) return msgs;
	if (msgs.some(m => m.role === 'system')) return msgs;
	return [
		{ role: 'system', parts: [{ kind: 'text', text: prompt }], text: prompt },
		...msgs,
	];
}

/** Append a trailing instruction as its own user turn. */
export function appendInstruction(
	msgs: NormalizedMessage[],
	instruction: string,
): NormalizedMessage[] {
	if (!instruction) return msgs;
	return [
		...msgs,
		{ role: 'user', parts: [{ kind: 'text', text: instruction }], text: instruction },
	];
}
