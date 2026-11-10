/**
 * tool-validator.test.js — tests for server/lib/tool-validator.js
 *
 * Property 15: Tool validator accepts exactly what the schema allows
 * Property 18 (helper side): validateQuoteArgs accepts iff the oracle accepts,
 *   and its sanitized output is clean.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  SEARCH_LISTINGS_SCHEMA,
  GET_LISTING_SCHEMA,
  REQUEST_QUOTE_SCHEMA,
  validateAgainstSchema,
  validateQuoteArgs,
} from '../server/lib/tool-validator.js';

// ---------------------------------------------------------------------------
// Independent oracle for the schema subset
// ---------------------------------------------------------------------------

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function stringOk(spec, v) {
  if (typeof v !== 'string') return false;
  if (typeof spec.minLength === 'number' && v.length < spec.minLength) return false;
  if (typeof spec.maxLength === 'number' && v.length > spec.maxLength) return false;
  return true;
}

function oracle(schema, value) {
  if (schema.type === 'string') return stringOk(schema, value);
  if (!isObj(value)) return false;
  const props = schema.properties ?? {};
  const required = schema.required ?? [];
  if (!required.every((k) => has(value, k))) return false;
  for (const [k, v] of Object.entries(value)) {
    if (!has(props, k)) {
      if (schema.additionalProperties === false) return false;
      continue;
    }
    if (props[k].type === 'string' && !stringOk(props[k], v)) return false;
  }
  return true;
}

/** A failing result must name "arguments" or an argument key. */
function namesAnArgument(schema, value, result) {
  if (typeof result.argument !== 'string') return false;
  if (typeof result.message !== 'string') return false;
  if (isObj(value) && has(value, result.argument)) return true;
  if (result.argument.length === 0) return false;
  if (result.argument === 'arguments') return true;
  return Array.isArray(schema.required) && schema.required.includes(result.argument);
}

function checkAgainstOracle(schema, value) {
  let result;
  assert.doesNotThrow(() => {
    result = validateAgainstSchema(schema, value);
  });
  const expected = oracle(schema, value);
  assert.equal(result.ok, expected, `schema=${JSON.stringify(schema)} value=${JSON.stringify(value)}`);
  if (result.ok) {
    assert.equal(result.value, value);
  } else {
    assert.ok(namesAnArgument(schema, value, result), `bad failure result ${JSON.stringify(result)}`);
  }
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const lenStringArb = fc
  .tuple(fc.constantFrom(0, 1, 2, 100, 200, 201, 1000, 1001, 2000, 10000, 10001), fc.constantFrom('a', ' ', 'é'))
  .map(([n, ch]) => ch.repeat(n));

/** Object values keyed from a fixed pool (includes __proto__ as an OWN key). */
function objectValueArb(keys, strArb) {
  const cell = fc.oneof({ weight: 8, arbitrary: strArb }, { weight: 1, arbitrary: fc.jsonValue() });
  return fc
    .uniqueArray(fc.tuple(fc.constantFrom(...keys), cell), { selector: (t) => t[0], maxLength: keys.length })
    .map((entries) => Object.fromEntries(entries));
}

function valueArb(keys, strArb) {
  return fc.oneof(
    { weight: 9, arbitrary: objectValueArb(keys, strArb) },
    { weight: 1, arbitrary: fc.jsonValue() }
  );
}

const TOOL_SCHEMAS = [SEARCH_LISTINGS_SCHEMA, GET_LISTING_SCHEMA, REQUEST_QUOTE_SCHEMA];
const TOOL_KEYS = ['category', 'city', 'query', 'id', 'name', 'contact', 'details', 'extra', '__proto__'];

const SCHEMA_KEYS = ['a', 'b', 'id', '__proto__', 'constructor', 'toString'];
const VALUE_KEYS = [...SCHEMA_KEYS, 'zzz'];

const optLen = (max) => fc.option(fc.nat(max), { nil: undefined });

const stringSpecArb = fc.record({ minLength: optLen(4), maxLength: optLen(6) }).map((s) => {
  const spec = { type: 'string' };
  if (s.minLength !== undefined) spec.minLength = s.minLength;
  if (s.maxLength !== undefined) spec.maxLength = s.maxLength;
  return spec;
});

const objectSchemaArb = fc
  .record({
    props: fc.uniqueArray(fc.tuple(fc.constantFrom(...SCHEMA_KEYS), stringSpecArb), {
      selector: (t) => t[0],
      maxLength: 4,
    }),
    required: fc.subarray(SCHEMA_KEYS),
    additional: fc.constantFrom('false', 'true', 'absent'),
  })
  .map(({ props, required, additional }) => {
    const schema = { type: 'object', properties: Object.fromEntries(props), required };
    if (additional === 'false') schema.additionalProperties = false;
    if (additional === 'true') schema.additionalProperties = true;
    return schema;
  });

const schemaArb = fc.oneof({ weight: 5, arbitrary: objectSchemaArb }, { weight: 1, arbitrary: stringSpecArb });

const smallStringArb = fc.string({ maxLength: 7 });

// ---------------------------------------------------------------------------
// Property 15
// ---------------------------------------------------------------------------

test('Property 15: tool schemas accept exactly what the oracle accepts', () => {
  // **Validates: Requirements 5.8, 5.9, 5.16**
  for (const schema of TOOL_SCHEMAS) {
    fc.assert(
      fc.property(valueArb(TOOL_KEYS, lenStringArb), (value) => {
        checkAgainstOracle(schema, value);
      }),
      { numRuns: 300 }
    );
  }
});

test('Property 15: random schemas accept exactly what the oracle accepts', () => {
  // **Validates: Requirements 5.8, 5.9, 5.16**
  fc.assert(
    fc.property(schemaArb, valueArb(VALUE_KEYS, smallStringArb), (schema, value) => {
      checkAgainstOracle(schema, value);
    }),
    { numRuns: 500 }
  );
});

test('Property 15: random string-typed values against random schemas', () => {
  // **Validates: Requirements 5.8, 5.9, 5.16**
  fc.assert(
    fc.property(schemaArb, fc.oneof(smallStringArb, fc.jsonValue()), (schema, value) => {
      checkAgainstOracle(schema, value);
    }),
    { numRuns: 300 }
  );
});

test('Property 15: never throws for arbitrary schema-like and value inputs', () => {
  // **Validates: Requirements 5.8, 5.9, 5.16**
  fc.assert(
    fc.property(fc.oneof(fc.jsonValue(), fc.constant(undefined)), fc.oneof(fc.jsonValue(), fc.constant(undefined)), (schema, value) => {
      assert.doesNotThrow(() => validateAgainstSchema(schema, value));
    }),
    { numRuns: 200 }
  );
});

test('Property 15 examples: accepts well-formed arguments', () => {
  assert.equal(validateAgainstSchema(SEARCH_LISTINGS_SCHEMA, {}).ok, true);
  assert.equal(validateAgainstSchema(SEARCH_LISTINGS_SCHEMA, { city: 'Nashville', query: 'plumber' }).ok, true);
  assert.equal(validateAgainstSchema(GET_LISTING_SCHEMA, { id: 'abc' }).ok, true);
  assert.equal(
    validateAgainstSchema(REQUEST_QUOTE_SCHEMA, { id: 'a', name: 'b', contact: 'c', details: 'd' }).ok,
    true
  );
});

test('Property 15 examples: names the offending argument', () => {
  let r = validateAgainstSchema(GET_LISTING_SCHEMA, {});
  assert.deepEqual([r.ok, r.argument], [false, 'id']);
  r = validateAgainstSchema(GET_LISTING_SCHEMA, { id: 5 });
  assert.deepEqual([r.ok, r.argument], [false, 'id']);
  r = validateAgainstSchema(GET_LISTING_SCHEMA, { id: '' });
  assert.deepEqual([r.ok, r.argument], [false, 'id']);
  r = validateAgainstSchema(GET_LISTING_SCHEMA, { id: 'a', extra: 'x' });
  assert.deepEqual([r.ok, r.argument], [false, 'extra']);
  r = validateAgainstSchema(SEARCH_LISTINGS_SCHEMA, { city: 'x'.repeat(201) });
  assert.deepEqual([r.ok, r.argument], [false, 'city']);
});

test('Property 15 examples: non-object values are refused', () => {
  for (const v of [null, undefined, 1, true, 'x', [], [{ id: 'a' }]]) {
    for (const schema of TOOL_SCHEMAS) {
      const r = validateAgainstSchema(schema, v);
      assert.equal(r.ok, false);
      assert.equal(r.argument, 'arguments');
    }
  }
});

test('Property 15 examples: __proto__ keys parsed from JSON are treated as ordinary keys', () => {
  const extra = JSON.parse('{"id":"a","__proto__":{"x":1}}');
  let r = validateAgainstSchema(GET_LISTING_SCHEMA, extra);
  assert.deepEqual([r.ok, r.argument], [false, '__proto__']);

  const onlyProto = JSON.parse('{"__proto__":"x"}');
  r = validateAgainstSchema(SEARCH_LISTINGS_SCHEMA, onlyProto);
  assert.deepEqual([r.ok, r.argument], [false, '__proto__']);

  // Prototype pollution through the validator must not happen.
  assert.equal(({}).x, undefined);
});

// ---------------------------------------------------------------------------
// validateQuoteArgs: oracle
// ---------------------------------------------------------------------------

const IDS = ['abc', 'def'];
const store = { findById: (id) => (IDS.includes(id) ? { id } : undefined) };

const codeOf = (ch) => ch.codePointAt(0);
const isControl = (ch) => {
  const c = codeOf(ch);
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f);
};

function cleanLine(s) {
  return [...s].filter((ch) => !isControl(ch)).join('').trim();
}

function cleanDetails(s) {
  return [...s.split('\r\n').join('\n')]
    .filter((ch) => ch === '\n' || ch === '\t' || !isControl(ch))
    .join('')
    .trim();
}

function oracleEmail(s) {
  if (s.length > 254 || /\s/.test(s)) return false;
  const parts = s.split('@');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) return false;
  const domain = parts[1];
  for (let i = 1; i < domain.length - 1; i++) {
    if (domain[i] === '.') return true;
  }
  return false;
}

function oraclePhone(s) {
  if (s.length === 0) return false;
  for (const ch of s) {
    if (!(/[0-9]/.test(ch) || /\s/.test(ch) || '().+-'.includes(ch))) return false;
  }
  const digits = [...s].filter((ch) => /[0-9]/.test(ch)).join('');
  return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
}

function quoteOracle(args) {
  const schemaLimits = {
    id: [1, 200],
    name: [1, 1000],
    contact: [1, 1000],
    details: [1, 10000],
  };
  if (!isObj(args)) return { ok: false };
  const keys = Object.keys(schemaLimits);
  if (Object.keys(args).length !== keys.length) return { ok: false };
  for (const k of keys) {
    if (!has(args, k) || typeof args[k] !== 'string') return { ok: false };
    if (args[k].length < schemaLimits[k][0] || args[k].length > schemaLimits[k][1]) return { ok: false };
  }
  const id = cleanLine(args.id);
  const name = cleanLine(args.name);
  const contact = cleanLine(args.contact);
  const details = cleanDetails(args.details);
  if (id.length === 0 || !store.findById(id)) return { ok: false };
  if (name.length < 1 || name.length > 100) return { ok: false };
  if (!oracleEmail(contact) && !oraclePhone(contact)) return { ok: false };
  if (details.length < 1 || details.length > 2000) return { ok: false };
  return { ok: true, value: { id, name, contact, details } };
}

// ---------------------------------------------------------------------------
// validateQuoteArgs: generators
// ---------------------------------------------------------------------------

const noiseArb = fc.stringOf(
  fc.constantFrom(' ', '\t', '\n', '\r', '\u0000', '\u0007', '\u007f', '\u0085', '\u009f', '\u00a0'),
  { maxLength: 3 }
);

const noisyLenArb = fc
  .tuple(noiseArb, fc.constantFrom(0, 1, 5, 99, 100, 101, 1999, 2000, 2001), noiseArb)
  .map(([a, n, b]) => a + 'x'.repeat(n) + b);

const wordArb = fc.stringOf(fc.constantFrom('a', 'b', '1', ' ', '\t', '\n', '\r', '\u0000', '\u0085', '@', '.'), {
  maxLength: 8,
});

const nameArb = fc.oneof(noisyLenArb, wordArb);
const detailsArb = fc.oneof(noisyLenArb, wordArb);

const emailArb = fc
  .tuple(fc.constantFrom('a', 'bob', ''), fc.constantFrom('@', '@@', ''), fc.constantFrom('x.com', 'x.', '.x', 'x', 'a.b.c'))
  .map(([l, at, d]) => l + at + d);

const phoneArb = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 8, maxLength: 12 }),
    fc.constantFrom('', '(', '+', ' ', '-', 'x')
  )
  .map(([digits, sep]) => sep + digits.slice(0, 3) + sep + digits.slice(3));

const longEmailArb = fc.constantFrom(240, 250, 251, 252).map((n) => 'a'.repeat(n - 6) + '@b.com');

const contactArb = fc.oneof(
  { weight: 3, arbitrary: emailArb },
  { weight: 3, arbitrary: phoneArb },
  { weight: 1, arbitrary: longEmailArb },
  { weight: 2, arbitrary: noiseArb.chain((n) => fc.constantFrom('a@b.co', '615-555-1234', '1 615 555 1234').map((c) => n + c + n)) },
  { weight: 1, arbitrary: wordArb }
);

const idArb = fc.constantFrom('abc', ' abc ', 'abc\u0000', 'def', '\tdef\n', 'zzz', '', '\n', 'ab\u0000c');

const recordArb = fc.record({ id: idArb, name: nameArb, contact: contactArb, details: detailsArb });

const quoteArgsArb = fc
  .tuple(
    recordArb,
    fc.constantFrom('none', 'none', 'none', 'none', 'drop', 'extra', 'nonstring'),
    fc.constantFrom('id', 'name', 'contact', 'details')
  )
  .map(([rec, mutation, key]) => {
    const out = { ...rec };
    if (mutation === 'drop') delete out[key];
    if (mutation === 'extra') out.extra = 'x';
    if (mutation === 'nonstring') out[key] = 42;
    return out;
  });

const anyQuoteInputArb = fc.oneof({ weight: 9, arbitrary: quoteArgsArb }, { weight: 1, arbitrary: fc.jsonValue() });

// ---------------------------------------------------------------------------
// validateQuoteArgs: properties
// ---------------------------------------------------------------------------

test('Property 18 (helper): validateQuoteArgs accepts iff the oracle accepts', () => {
  // **Validates: Requirements 6.2, 6.3, 6.11**
  fc.assert(
    fc.property(anyQuoteInputArb, (args) => {
      let result;
      assert.doesNotThrow(() => {
        result = validateQuoteArgs(args, store);
      });
      const expected = quoteOracle(args);
      assert.equal(result.ok, expected.ok, JSON.stringify(args));
      if (expected.ok) {
        assert.deepEqual(result.value, expected.value);
      } else {
        assert.equal(typeof result.argument, 'string');
        assert.ok(result.argument.length > 0);
        assert.equal(typeof result.message, 'string');
      }
    }),
    { numRuns: 1000 }
  );
});

test('Property 18 (helper): sanitized output is trimmed and free of control characters', () => {
  // **Validates: Requirements 6.2, 6.3, 6.11**
  const wellFormed = fc.record({
    id: idArb.filter((id) => IDS.includes(id.replace(/[\u0000-\u001f]/g, '').trim())),
    name: fc.tuple(noiseArb, fc.constantFrom(1, 10, 100), noiseArb).map(([a, n, b]) => a + 'n'.repeat(n) + b),
    contact: noiseArb.map((n) => n + '615-555-1234' + n),
    details: fc.tuple(noiseArb, fc.constantFrom(1, 20, 2000), noiseArb).map(([a, n, b]) => a + 'd\r\n'.repeat(1) + 'e'.repeat(n - 1) + b),
  });
  let accepted = 0;
  fc.assert(
    fc.property(wellFormed, (args) => {
      const result = validateQuoteArgs(args, store);
      if (!result.ok) return;
      accepted++;
      const { id, name, contact, details } = result.value;
      for (const v of [id, name, contact]) {
        assert.equal(v, v.trim());
        assert.ok(![...v].some(isControl), 'control character left in single-line field');
      }
      assert.equal(details, details.trim());
      assert.ok(![...details].some((ch) => isControl(ch) && ch !== '\n' && ch !== '\t'));
      assert.ok(!details.includes('\r'));
    }),
    { numRuns: 300 }
  );
  assert.ok(accepted > 0, 'generator never produced an accepted quote');
});

test('Property 18 examples: accepts and sanitizes a normal quote', () => {
  const r = validateQuoteArgs(
    { id: 'abc', name: ' Pat\u0000 ', contact: ' (615) 555-1234 ', details: ' Leaky\r\nsink\tunder\u0007 ' },
    store
  );
  assert.deepEqual(r, {
    ok: true,
    value: { id: 'abc', name: 'Pat', contact: '(615) 555-1234', details: 'Leaky\nsink\tunder' },
  });
});

test('Property 18 examples: refuses bad quotes and names the argument', () => {
  const good = { id: 'abc', name: 'Pat', contact: 'pat@example.com', details: 'Need a quote' };
  assert.equal(validateQuoteArgs(good, store).ok, true);
  assert.equal(validateQuoteArgs({ ...good, id: 'nope' }, store).argument, 'id');
  assert.equal(validateQuoteArgs({ ...good, name: ' \u0000 ' }, store).argument, 'name');
  assert.equal(validateQuoteArgs({ ...good, name: 'n'.repeat(101) }, store).argument, 'name');
  assert.equal(validateQuoteArgs({ ...good, contact: 'not a contact' }, store).argument, 'contact');
  assert.equal(validateQuoteArgs({ ...good, details: 'd'.repeat(2001) }, store).argument, 'details');
  assert.equal(validateQuoteArgs({ ...good, details: '   ' }, store).argument, 'details');
  assert.equal(validateQuoteArgs({ ...good, extra: 1 }, store).argument, 'extra');
  assert.equal(validateQuoteArgs(null, store).ok, false);
});
