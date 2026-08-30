import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { resetMock } from '../test/vscode-mock';

describe('loadConfig numeric bounds', () => {
	it('clamps JSON repair retries to a small integer range', () => {
		resetMock({ jsonModeMaxRetries: 999.8 });
		expect(loadConfig().jsonModeMaxRetries).toBe(3);

		resetMock({ jsonModeMaxRetries: -2 });
		expect(loadConfig().jsonModeMaxRetries).toBe(0);
	});

	it('clamps request body limits to a bounded integer range', () => {
		resetMock({ maxRequestBodyMb: 999.8 });
		expect(loadConfig().maxRequestBodyMb).toBe(100);

		resetMock({ maxRequestBodyMb: 0.5 });
		expect(loadConfig().maxRequestBodyMb).toBe(1);
	});
});
