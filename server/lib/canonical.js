/**
 * canonical.js — canonical JSON text for hashing
 *
 * Keys are sorted by Unicode code point (not UTF-16 code unit), there is no
 * whitespace, array order is kept, and object values that are `undefined`
 * are omitted. Non-finite numbers and non-JSON types throw TypeError.
 */

/**
 * Compares two strings by code point.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareCodePoints(a, b) {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i);
    const cb = b.codePointAt(j);
    if (ca !== cb) return ca < cb ? -1 : 1;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}

/**
 * @param {unknown} value
 * @param {unknown[]} stack objects currently being serialized (cycle guard)
 * @returns {string}
 */
function serialize(value, stack) {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('canonicalize: non-finite number');
      }
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      // undefined at top level or in arrays is handled by the caller
      throw new TypeError(`canonicalize: unsupported type ${typeof value}`);
  }

  if (stack.includes(value)) {
    throw new TypeError('canonicalize: circular structure');
  }
  stack.push(value);
  try {
    if (Array.isArray(value)) {
      const parts = [];
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        parts.push(item === undefined ? 'null' : serialize(item, stack));
      }
      return `[${parts.join(',')}]`;
    }

    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError('canonicalize: unsupported object type');
    }

    const keys = Object.keys(value).sort(compareCodePoints);
    const parts = [];
    for (const key of keys) {
      const item = value[key];
      if (item === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${serialize(item, stack)}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    stack.pop();
  }
}

/**
 * Returns the canonical JSON text of a JSON-compatible value.
 * @param {unknown} value
 * @returns {string}
 * @throws {TypeError} for undefined, non-finite numbers, or non-JSON types
 */
export function canonicalize(value) {
  return serialize(value, []);
}
