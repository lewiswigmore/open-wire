import { describe, it, expect } from 'vitest';
import {
	assertSchemaSupported,
	findUnsupportedKeywords,
	validateAgainstSchema,
} from './schema';

describe('findUnsupportedKeywords', () => {
	it('accepts the documented subset', () => {
		const schema = {
			type: 'object',
			required: ['name'],
			additionalProperties: false,
			properties: {
				name: { type: 'string', minLength: 1 },
				tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
				level: { type: 'integer', minimum: 0, maximum: 10 },
			},
		};
		expect(findUnsupportedKeywords(schema)).toEqual([]);
	});

	it('ignores annotation keywords', () => {
		expect(findUnsupportedKeywords({ type: 'string', title: 'T', description: 'd' })).toEqual([]);
	});

	it('reports unsupported keywords with a path', () => {
		const schema = { type: 'object', properties: { a: { oneOf: [{ type: 'string' }] } } };
		expect(findUnsupportedKeywords(schema)).toEqual(['properties.a.oneOf']);
	});

	it('reports unsupported keywords inside items', () => {
		expect(findUnsupportedKeywords({ type: 'array', items: { $ref: '#/x' } }))
			.toEqual(['items.$ref']);
	});
});

describe('assertSchemaSupported', () => {
	it('throws a helpful error for unsupported keywords', () => {
		expect(() => assertSchemaSupported({ allOf: [] })).toThrow(/Unsupported JSON Schema keyword/);
	});

	it('rejects non-object schemas', () => {
		expect(() => assertSchemaSupported('nope')).toThrow(/must be an object/);
	});

	it('accepts a supported schema', () => {
		expect(() => assertSchemaSupported({ type: 'object' })).not.toThrow();
	});
});

describe('validateAgainstSchema', () => {
	const schema = {
		type: 'object',
		required: ['name', 'score'],
		properties: {
			name: { type: 'string', minLength: 2 },
			score: { type: 'integer', minimum: 0, maximum: 100 },
			tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
			status: { enum: ['open', 'closed'] },
		},
	};

	it('accepts a conforming value', () => {
		expect(validateAgainstSchema(
			{ name: 'abc', score: 50, tags: ['x'], status: 'open' }, schema,
		)).toEqual([]);
	});

	it('reports missing required properties', () => {
		const errors = validateAgainstSchema({ name: 'abc' }, schema);
		expect(errors.join(' ')).toMatch(/missing required property "score"/);
	});

	it('reports a type mismatch', () => {
		const errors = validateAgainstSchema({ name: 1, score: 5 }, schema);
		expect(errors.join(' ')).toMatch(/expected string, got number/);
	});

	it('rejects a float where an integer is required', () => {
		const errors = validateAgainstSchema({ name: 'ab', score: 1.5 }, schema);
		expect(errors.join(' ')).toMatch(/expected integer/);
	});

	it('enforces numeric bounds', () => {
		expect(validateAgainstSchema({ name: 'ab', score: 200 }, schema).join(' '))
			.toMatch(/above maximum 100/);
		expect(validateAgainstSchema({ name: 'ab', score: -1 }, schema).join(' '))
			.toMatch(/below minimum 0/);
	});

	it('enforces string length', () => {
		expect(validateAgainstSchema({ name: 'a', score: 1 }, schema).join(' '))
			.toMatch(/shorter than minLength/);
	});

	it('enforces array bounds and item types', () => {
		expect(validateAgainstSchema({ name: 'ab', score: 1, tags: ['a', 'b', 'c'] }, schema).join(' '))
			.toMatch(/longer than maxItems/);
		expect(validateAgainstSchema({ name: 'ab', score: 1, tags: [1] }, schema).join(' '))
			.toMatch(/expected string/);
	});

	it('enforces enum membership', () => {
		expect(validateAgainstSchema({ name: 'ab', score: 1, status: 'other' }, schema).join(' '))
			.toMatch(/not one of the permitted enum values/);
	});

	it('enforces additionalProperties: false', () => {
		const strict = {
			type: 'object',
			properties: { a: { type: 'string' } },
			additionalProperties: false,
		};
		expect(validateAgainstSchema({ a: 'x', b: 'y' }, strict).join(' '))
			.toMatch(/unexpected additional property "b"/);
	});

	it('allows extra properties by default', () => {
		const loose = { type: 'object', properties: { a: { type: 'string' } } };
		expect(validateAgainstSchema({ a: 'x', b: 'y' }, loose)).toEqual([]);
	});

	it('validates nested objects', () => {
		const nested = {
			type: 'object',
			properties: { inner: { type: 'object', required: ['x'], properties: { x: { type: 'number' } } } },
		};
		expect(validateAgainstSchema({ inner: {} }, nested).join(' '))
			.toMatch(/root.inner: missing required property "x"/);
	});

	it('supports union types', () => {
		const union = { type: ['string', 'null'] };
		expect(validateAgainstSchema('a', union)).toEqual([]);
		expect(validateAgainstSchema(null, union)).toEqual([]);
		expect(validateAgainstSchema(1, union).join(' ')).toMatch(/expected string or null/);
	});

	it('distinguishes arrays from objects', () => {
		expect(validateAgainstSchema([], { type: 'object' }).join(' ')).toMatch(/got array/);
		expect(validateAgainstSchema(null, { type: 'object' }).join(' ')).toMatch(/got null/);
	});

	it('enforces const', () => {
		expect(validateAgainstSchema('b', { const: 'a' }).join(' ')).toMatch(/does not match the required const/);
		expect(validateAgainstSchema('a', { const: 'a' })).toEqual([]);
	});
});
