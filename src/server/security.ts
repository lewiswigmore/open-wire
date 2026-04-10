export const DEFAULT_API_KEY = 'change-me-openwire-key';
export const DEFAULT_CORS_ALLOWED_ORIGINS = ['http://localhost', 'http://127.0.0.1', 'http://[::1]'];

export function normalizeApiKey(rawApiKey: string | undefined): string {
	const value = rawApiKey?.trim() ?? '';
	return value.length > 0 ? value : DEFAULT_API_KEY;
}

export function normalizeCorsAllowedOrigins(rawOrigins: unknown): string[] {
	let values: string[] = [];

	if (Array.isArray(rawOrigins)) {
		values = rawOrigins
			.filter((item): item is string => typeof item === 'string')
			.map(item => item.trim())
			.filter(item => item.length > 0);
	}

	if (values.length === 0) {
		values = [...DEFAULT_CORS_ALLOWED_ORIGINS];
	}

	return Array.from(new Set(values));
}

export function isOriginAllowed(origin: string, allowedOrigins: string[]): boolean {
	let requestOrigin: URL;
	try {
		requestOrigin = new URL(origin);
	} catch {
		return false;
	}

	if (!['http:', 'https:'].includes(requestOrigin.protocol)) {
		return false;
	}

	for (const allowedOrigin of allowedOrigins) {
		const value = allowedOrigin.trim();
		if (!value) {
			continue;
		}
		if (value === '*') {
			return true;
		}

		try {
			const allowed = new URL(value);
			if (allowed.protocol !== requestOrigin.protocol) {
				continue;
			}
			if (allowed.hostname !== requestOrigin.hostname) {
				continue;
			}
			if (allowed.port && allowed.port !== requestOrigin.port) {
				continue;
			}
			return true;
		} catch {
			continue;
		}
	}

	return false;
}
