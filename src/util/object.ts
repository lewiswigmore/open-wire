/**
 * Object helpers shared across modules. Plain `in` walks the prototype chain,
 * so a key named "constructor" or "toString" would appear to exist on every
 * object; `hasOwn` keeps user-supplied keys behaving as ordinary data.
 */

/** Own-property check that ignores the prototype chain. */
export function hasOwn(value: Record<string, any>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

/** True for non-null, non-array objects: the shapes this codebase treats as maps. */
export function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
