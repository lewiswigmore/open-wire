import { describe, expect, it } from 'vitest';
import {
	DEFAULT_API_KEY,
	DEFAULT_CORS_ALLOWED_ORIGINS,
	isOriginAllowed,
	normalizeApiKey,
	normalizeCorsAllowedOrigins,
} from './security';

describe('normalizeApiKey', () => {
	it('falls back to secure default when value is empty', () => {
		expect(normalizeApiKey('')).toBe(DEFAULT_API_KEY);
		expect(normalizeApiKey('   ')).toBe(DEFAULT_API_KEY);
		expect(normalizeApiKey(undefined)).toBe(DEFAULT_API_KEY);
	});

	it('trims and returns explicit API keys', () => {
		expect(normalizeApiKey('  my-key  ')).toBe('my-key');
	});
});

describe('normalizeCorsAllowedOrigins', () => {
	it('uses default local origins when no valid values are provided', () => {
		expect(normalizeCorsAllowedOrigins(undefined)).toEqual(DEFAULT_CORS_ALLOWED_ORIGINS);
		expect(normalizeCorsAllowedOrigins([])).toEqual(DEFAULT_CORS_ALLOWED_ORIGINS);
	});

	it('normalizes and deduplicates configured origins', () => {
		expect(
			normalizeCorsAllowedOrigins([' http://localhost ', 'http://localhost', 'https://example.com']),
		).toEqual(['http://localhost', 'https://example.com']);
	});
});

describe('isOriginAllowed', () => {
	const defaults = DEFAULT_CORS_ALLOWED_ORIGINS;

	it('allows configured localhost origins across ports', () => {
		expect(isOriginAllowed('http://localhost:3000', defaults)).toBe(true);
		expect(isOriginAllowed('http://127.0.0.1:8080', defaults)).toBe(true);
	});

	it('blocks non-local and invalid origins', () => {
		expect(isOriginAllowed('https://example.com', defaults)).toBe(false);
		expect(isOriginAllowed('not-a-url', defaults)).toBe(false);
	});
});
