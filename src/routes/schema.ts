import { badRequest } from './errors';

/**
 * A deliberately small JSON Schema subset validator.
 *
 * OpenWire is zero-dependency by design, so this implements the keywords that
 * cover the overwhelming majority of structured-output schemas. Anything
 * outside the subset is rejected at request time rather than silently ignored:
 * accepting a constraint we do not enforce is the exact failure mode this
 * release exists to remove.
 */

/** Keywords whose semantics are enforced below. */
const ENFORCED_KEYWORDS = new Set([
	'type',
	'enum',
	'const',
	'required',
	'properties',
	'additionalProperties',
	'items',
	'minimum',
	'maximum',
	'minLength',
	'maxLength',
	'minItems',
	'maxItems',
]);

/** Annotation-only keywords: carry no constraint, safe to ignore. */
const ANNOTATION_KEYWORDS = new Set([
	'title',
	'description',
	'default',
	'examples',
	'$schema',
	'$id',
	'$comment',
]);

export const SUPPORTED_SCHEMA_KEYWORDS: string[] = [...ENFORCED_KEYWORDS].sort();

const VALID_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/**
 * Walk a schema and collect keywords we do not enforce.
 * Returns dotted paths so the caller can report precisely what to remove.
 */
export function findUnsupportedKeywords(schema: unknown, path = ''): string[] {
	if (!isPlainObject(schema)) return [];
	const found: string[] = [];

	for (const key of Object.keys(schema)) {
		if (ENFORCED_KEYWORDS.has(key) || ANNOTATION_KEYWORDS.has(key)) continue;
		found.push(path ? `${path}.${key}` : key);
	}

	if (isPlainObject(schema.properties)) {
		for (const [name, sub] of Object.entries(schema.properties)) {
			found.push(...findUnsupportedKeywords(sub, joinPath(path, `properties.${name}`)));
		}
	}
	if (isPlainObject(schema.additionalProperties)) {
		found.push(...findUnsupportedKeywords(
			schema.additionalProperties,
			joinPath(path, 'additionalProperties'),
		));
	}
	if (Array.isArray(schema.items)) {
		// Tuple validation is not implemented, so it must not be accepted.
		found.push(joinPath(path, 'items (tuple form)'));
	} else if (schema.items !== undefined) {
		found.push(...findUnsupportedKeywords(schema.items, joinPath(path, 'items')));
	}

	return found;
}

/** Throws a 400 when the schema uses keywords outside the supported subset. */
export function assertSchemaSupported(schema: unknown): void {
	if (!isPlainObject(schema)) {
		throw badRequest('response_format.json_schema.schema must be an object');
	}
	const unsupported = findUnsupportedKeywords(schema);
	if (unsupported.length > 0) {
		throw badRequest(
			`Unsupported JSON Schema keyword(s): ${unsupported.join(', ')}. ` +
			`OpenWire enforces a documented subset: ${SUPPORTED_SCHEMA_KEYWORDS.join(', ')}. ` +
			`Remove the unsupported keyword(s) or use response_format {"type":"json_object"}.`,
		);
	}
}

/** Validate a parsed value against the schema subset. Returns error strings. */
export function validateAgainstSchema(value: unknown, schema: unknown, path = 'root'): string[] {
	if (!isPlainObject(schema)) return [];
	const errors: string[] = [];

	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		for (const t of types) {
			if (typeof t !== 'string' || !VALID_TYPES.has(t)) {
				return [`${path}: schema declares unknown type "${String(t)}"`];
			}
		}
		if (!types.some(t => matchesType(value, t as string))) {
			return [`${path}: expected ${types.join(' or ')}, got ${describeType(value)}`];
		}
	}

	if (Array.isArray(schema.enum) && !schema.enum.some(v => deepEqual(v, value))) {
		errors.push(`${path}: value is not one of the permitted enum values`);
	}
	if ('const' in schema && !deepEqual(schema.const, value)) {
		errors.push(`${path}: value does not match the required const`);
	}

	if (typeof value === 'number') {
		if (typeof schema.minimum === 'number' && value < schema.minimum) {
			errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
		}
		if (typeof schema.maximum === 'number' && value > schema.maximum) {
			errors.push(`${path}: ${value} is above maximum ${schema.maximum}`);
		}
	}

	if (typeof value === 'string') {
		if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
			errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
		}
		if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
			errors.push(`${path}: string longer than maxLength ${schema.maxLength}`);
		}
	}

	if (Array.isArray(value)) {
		if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
			errors.push(`${path}: array shorter than minItems ${schema.minItems}`);
		}
		if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
			errors.push(`${path}: array longer than maxItems ${schema.maxItems}`);
		}
		if (schema.items !== undefined && !Array.isArray(schema.items)) {
			value.forEach((item, i) => {
				errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`));
			});
		}
	}

	if (isPlainObject(value)) {
		if (Array.isArray(schema.required)) {
			for (const key of schema.required) {
				if (typeof key === 'string' && !hasOwn(value, key)) {
					errors.push(`${path}: missing required property "${key}"`);
				}
			}
		}

		const properties = isPlainObject(schema.properties) ? schema.properties : undefined;
		if (properties) {
			for (const [key, sub] of Object.entries(properties)) {
				if (hasOwn(value, key)) {
					errors.push(...validateAgainstSchema(value[key], sub, `${path}.${key}`));
				}
			}
		}

		// additionalProperties applies whether or not `properties` is present.
		if (schema.additionalProperties === false || isPlainObject(schema.additionalProperties)) {
			const declared = new Set(properties ? Object.keys(properties) : []);
			for (const key of Object.keys(value)) {
				if (declared.has(key)) continue;
				if (schema.additionalProperties === false) {
					errors.push(`${path}: unexpected additional property "${key}"`);
				} else {
					errors.push(...validateAgainstSchema(
						value[key], schema.additionalProperties, `${path}.${key}`,
					));
				}
			}
		}
	}

	return errors;
}

// ── helpers ───────────────────────────────────────────────

/**
 * Own-property check. Plain `in` walks the prototype chain, so a schema
 * property named `constructor` or `toString` would appear to exist on every
 * object and could never be satisfied.
 */
function hasOwn(value: Record<string, any>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function joinPath(base: string, segment: string): string {
	return base ? `${base}.${segment}` : segment;
}

function matchesType(value: unknown, type: string): boolean {
	switch (type) {
		case 'object': return isPlainObject(value);
		case 'array': return Array.isArray(value);
		case 'string': return typeof value === 'string';
		case 'number': return typeof value === 'number' && Number.isFinite(value);
		case 'integer': return typeof value === 'number' && Number.isInteger(value);
		case 'boolean': return typeof value === 'boolean';
		case 'null': return value === null;
		default: return false;
	}
}

function describeType(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	return typeof value;
}

export function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		return ka.length === kb.length && ka.every(k => hasOwn(b, k) && deepEqual(a[k], b[k]));
	}
	return false;
}
