/**
 * canonical.test.js — tests for server/lib/canonical.js
 *
 * Property 1: Canonical form is independent of key order
 * Property 2: Canonical form round trip
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { canonicalize } from '../server/lib/canonical.js';

// ---------------------------------------------------------------------------
// Generators (JSON-safe only: no undefined, no NaN/Infinity, no -0, no
// "__proto__" keys, no non-plain objects)
// ---------------------------------------------------------------------------

// Strings may contain astral characters (full Unicode, no lone surrogates).
const strArb = fc.fullUnicodeString({ maxLength: 6 });

const keyArb = strArb.filter((k) => k !== '__proto__');

const numArb = fc.oneof(
  fc.integer({ min: -1000000, max: 1000000 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (Object.is(n, -0) ? 0 : n))
);

const leafArb = fc.oneof(fc.constant(null), fc.boolean(), numArb, strArb);

/** Builds a plain object from entries; later duplicate keys are dropped. */
function toObject(entries) {
  const obj = {};
  for (const [k, v] of entries) {
    if (!Object.hasOwn(obj, k)) obj[k] = v;
  }
  return obj;
}

const valueArb = fc.memo((depth) => {
  if (depth <= 1) return leafArb;
  const inner = valueArb(depth - 1);
  return fc.oneof(
    leafArb,
    fc.array(inner, { maxLength: 4 }),
    fc.array(fc.tuple(keyArb, inner), { maxLength: 4 }).map(toObject)
  );
});

// Listing-like top-level value: always an object.
const listingArb = fc
  .array(fc.tuple(keyArb, valueArb(3)), { maxLength: 6 })
  .map(toObject);

/** Small deterministic string hash used to permute key order. */
function hashKey(key, salt) {
  let h = salt | 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Returns a deep copy whose objects have their keys inserted in a different
 * order (permuted by a salted hash, optionally reversed). Arrays keep order.
 */
function reorderKeys(value, salt, reverse) {
  if (Array.isArray(value)) return value.map((v) => reorderKeys(v, salt, reverse));
  if (value !== null && typeof value === 'object') {
    let keys = Object.keys(value).sort((a, b) => hashKey(a, salt) - hashKey(b, salt));
    if (reverse) keys = keys.reverse();
    const out = {};
    for (const k of keys) out[k] = reorderKeys(value[k], salt, reverse);
    return out;
  }
  return value;
}

/** Independent code point comparison, via arrays of code points. */
function cmpCodePoints(a, b) {
  const pa = Array.from(a, (c) => c.codePointAt(0));
  const pb = Array.from(b, (c) => c.codePointAt(0));
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return pa.length - pb.length;
}

// ---------------------------------------------------------------------------
// Known vectors
// ---------------------------------------------------------------------------

test('canonicalize: known vectors', () => {
  assert.equal(canonicalize({}), '{}');
  assert.equal(canonicalize([]), '[]');
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize(true), 'true');
  assert.equal(canonicalize('hi'), '"hi"');
  assert.equal(canonicalize(42), '42');
  assert.equal(canonicalize(1.5), '1.5');
  assert.equal(canonicalize({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.equal(
    canonicalize({ z: { y: 2, x: 1 }, a: [{ d: 4, c: 3 }] }),
    '{"a":[{"c":3,"d":4}],"z":{"x":1,"y":2}}'
  );
  // Array order is kept.
  assert.equal(canonicalize([3, 1, 2]), '[3,1,2]');
  // Prefix sorts first.
  assert.equal(canonicalize({ ab: 1, a: 2 }), '{"a":2,"ab":1}');
  // Whitespace inside strings is preserved, escapes follow JSON.stringify.
  assert.equal(canonicalize({ k: 'a b\n"c"' }), '{"k":"a b\\n\\"c\\""}');
});

test('canonicalize: undefined object values are omitted, undefined array items become null', () => {
  assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalize([undefined, 1]), '[null,1]');
});

test('canonicalize: unsupported values throw TypeError', () => {
  assert.throws(() => canonicalize(NaN), TypeError);
  assert.throws(() => canonicalize(Infinity), TypeError);
  assert.throws(() => canonicalize({ a: -Infinity }), TypeError);
  assert.throws(() => canonicalize(undefined), TypeError);
  assert.throws(() => canonicalize(() => 1), TypeError);
  assert.throws(() => canonicalize(Symbol('s')), TypeError);
  assert.throws(() => canonicalize(10n), TypeError);
  assert.throws(() => canonicalize(new Date(0)), TypeError);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalize(cyclic), TypeError);
});

// ---------------------------------------------------------------------------
// Astral characters: code point order, not UTF-16 code unit order
// ---------------------------------------------------------------------------

test('canonicalize: keys sort by code point, not UTF-16 code unit', () => {
  // U+10000 is the surrogate pair D800 DC00, so UTF-16 order puts it before
  // U+FFFF. Code point order puts U+FFFF first.
  const bmp = '\uFFFF';
  const astral = '\u{10000}';
  assert.ok(astral < bmp, 'sanity: default string comparison is UTF-16 order');

  const expected = `{${JSON.stringify(bmp)}:1,${JSON.stringify(astral)}:2}`;
  assert.equal(canonicalize({ [astral]: 2, [bmp]: 1 }), expected);
  assert.equal(canonicalize({ [bmp]: 1, [astral]: 2 }), expected);

  // U+E000 (private use, BMP) versus U+1F600 (emoji, astral).
  const pua = '\uE000';
  const emoji = '\u{1F600}';
  assert.equal(
    canonicalize({ [emoji]: 2, [pua]: 1 }),
    `{${JSON.stringify(pua)}:1,${JSON.stringify(emoji)}:2}`
  );

  // Two astral keys order by code point.
  const a1 = '\u{10000}';
  const a2 = '\u{1F600}';
  assert.equal(
    canonicalize({ [a2]: 2, [a1]: 1 }),
    `{${JSON.stringify(a1)}:1,${JSON.stringify(a2)}:2}`
  );
});

// ---------------------------------------------------------------------------
// Property 1: Canonical form is independent of key order
// ---------------------------------------------------------------------------

test('Property 1: canonical form is independent of key order', () => {
  // **Validates: Requirements 9.1, 9.6**
  fc.assert(
    fc.property(listingArb, fc.integer(), fc.boolean(), (listing, salt, reverse) => {
      const reordered = reorderKeys(listing, salt, reverse);
      assert.equal(canonicalize(reordered), canonicalize(listing));
    }),
    { numRuns: 200 }
  );
});

test('Property 1: output has no whitespace outside string values', () => {
  // **Validates: Requirements 9.1, 9.6**
  fc.assert(
    fc.property(listingArb, (listing) => {
      const out = canonicalize(listing);
      const withoutStrings = out.replace(/"(?:[^"\\]|\\.)*"/g, '""');
      assert.doesNotMatch(withoutStrings, /\s/);
    }),
    { numRuns: 200 }
  );
});

test('Property 1: keys appear in code point order, including astral keys', () => {
  // **Validates: Requirements 9.1, 9.6**
  // Flat objects with integer values, compared against an independent oracle.
  const flatArb = fc
    .array(fc.tuple(keyArb, fc.integer({ min: 0, max: 1000 })), { maxLength: 8 })
    .map(toObject);

  fc.assert(
    fc.property(flatArb, fc.integer(), (obj, salt) => {
      const keys = Object.keys(obj).sort(cmpCodePoints);
      const expected = `{${keys.map((k) => `${JSON.stringify(k)}:${obj[k]}`).join(',')}}`;
      assert.equal(canonicalize(obj), expected);
      assert.equal(canonicalize(reorderKeys(obj, salt, false)), expected);
    }),
    { numRuns: 200 }
  );
});

// ---------------------------------------------------------------------------
// Property 2: Canonical form round trip
// ---------------------------------------------------------------------------

test('Property 2: canonicalize(JSON.parse(canonicalize(x))) equals canonicalize(x)', () => {
  // **Validates: Requirements 9.1, 9.6, 9.9**
  fc.assert(
    fc.property(listingArb, (listing) => {
      const once = canonicalize(listing);
      assert.equal(canonicalize(JSON.parse(once)), once);
    }),
    { numRuns: 200 }
  );
});
