/**
 * listing-fields.test.js — tests for server/lib/listing-fields.js
 *
 * Property 7:  Phone normalization
 * Property 8:  Category mapping yields a known slug or nothing
 * Property 9:  Extraction output always satisfies the Listing model
 * Property 10: Extraction normalization is idempotent
 * Property 11: Listing slugs are URL-safe and unique
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import {
  DAYS,
  normalizePhone,
  mapCategory,
  normalizeFields,
  validateFields,
  makeSlug,
} from '../server/lib/listing-fields.js';

const categories = JSON.parse(
  readFileSync(new URL('../data/categories.json', import.meta.url), 'utf8')
);
const slugs = categories.map((c) => c.slug);

const PHONE_RE = /^\(\d{3}\) \d{3}-\d{4}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MODEL_KEYS = [
  'name', 'category', 'phone', 'hours', 'services',
  'serviceArea', 'description', 'city', 'state', 'address', 'ownerEmail',
];
const STRING_KEYS = MODEL_KEYS.filter((k) => k !== 'hours' && k !== 'services');

// ---------------------------------------------------------------------------
// Property 7: Phone normalization
// ---------------------------------------------------------------------------

const digitArb = fc.constantFrom(...'0123456789'.split(''));
const sepArb = fc.stringOf(fc.constantFrom(...' -().+/x_abc'.split('')), { maxLength: 3 });

/** Interleaves digits with arbitrary non-digit separators. */
function embed(digits, seps) {
  let out = seps[0] ?? '';
  digits.forEach((d, i) => {
    out += d + (seps[i + 1] ?? '');
  });
  return out;
}

const sepsArb = fc.array(sepArb, { minLength: 12, maxLength: 12 });

test('Property 7: phone with 10 digits keeps those digits in order', () => {
  // **Validates: Requirements 3.2**
  fc.assert(
    fc.property(fc.array(digitArb, { minLength: 10, maxLength: 10 }), sepsArb, (digits, seps) => {
      const out = normalizePhone(embed(digits, seps));
      assert.match(out, PHONE_RE);
      assert.equal(out.replace(/\D/g, ''), digits.join(''));
    })
  );
});

test('Property 7: phone with 11 digits starting with 1 drops the leading 1', () => {
  // **Validates: Requirements 3.2**
  fc.assert(
    fc.property(fc.array(digitArb, { minLength: 10, maxLength: 10 }), sepsArb, (digits, seps) => {
      const out = normalizePhone(embed(['1', ...digits], seps));
      assert.match(out, PHONE_RE);
      assert.equal(out.replace(/\D/g, ''), digits.join(''));
    })
  );
});

test('Property 7: other digit counts yield the empty string', () => {
  // **Validates: Requirements 3.2**
  const badDigits = fc.oneof(
    fc.array(digitArb, { minLength: 0, maxLength: 9 }),
    fc.array(digitArb, { minLength: 12, maxLength: 16 }),
    fc
      .tuple(fc.constantFrom(...'023456789'.split('')), fc.array(digitArb, { minLength: 10, maxLength: 10 }))
      .map(([first, rest]) => [first, ...rest])
  );
  fc.assert(
    fc.property(badDigits, sepsArb, (digits, seps) => {
      assert.equal(normalizePhone(embed(digits, seps)), '');
    })
  );
});

test('Property 7: any input yields empty or a formatted phone, and output is stable', () => {
  // **Validates: Requirements 3.2**
  fc.assert(
    fc.property(fc.oneof(fc.string(), fc.anything()), (input) => {
      const out = normalizePhone(input);
      if (out !== '') {
        assert.match(out, PHONE_RE);
        assert.equal(normalizePhone(out), out);
      }
    })
  );
});

// ---------------------------------------------------------------------------
// Property 8: Category mapping
// ---------------------------------------------------------------------------

const categoryListArb = fc.array(
  fc.record({ slug: fc.string({ maxLength: 8 }), label: fc.string({ maxLength: 8 }) }),
  { maxLength: 6 }
);

test('Property 8: result is always a listed slug or empty', () => {
  // **Validates: Requirements 3.3**
  fc.assert(
    fc.property(fc.oneof(fc.string(), fc.anything()), categoryListArb, (input, list) => {
      const out = mapCategory(input, list);
      assert.equal(typeof out, 'string');
      if (out !== '') assert.ok(list.some((c) => c.slug === out));
    })
  );
  fc.assert(
    fc.property(fc.string(), (input) => {
      const out = mapCategory(input, categories);
      assert.ok(out === '' || slugs.includes(out));
    })
  );
});

test('Property 8: every real slug and label maps back to its slug in any letter case', () => {
  // **Validates: Requirements 3.3**
  const caseArb = fc.array(fc.boolean(), { minLength: 40, maxLength: 40 });
  const recase = (text, flags) =>
    text
      .split('')
      .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
      .join('');
  fc.assert(
    fc.property(fc.constantFrom(...categories), caseArb, caseArb, (cat, f1, f2) => {
      assert.equal(mapCategory(recase(cat.slug, f1), categories), cat.slug);
      assert.equal(mapCategory(recase(cat.label, f2), categories), cat.slug);
    })
  );
});

// ---------------------------------------------------------------------------
// Property 9 and 10: extraction output satisfies the model; idempotence
// ---------------------------------------------------------------------------

const longStr = fc.string({ minLength: 501, maxLength: 1500 });
const looseStr = fc.oneof(fc.string({ maxLength: 40 }), longStr, fc.constant('  padded  '));

const fieldValue = (good) => fc.oneof({ weight: 4, arbitrary: good }, { weight: 2, arbitrary: fc.anything() });

const stateGood = fc.oneof(
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
    minLength: 2,
    maxLength: 2,
  }),
  fc.string({ maxLength: 5 })
);

const phoneGood = fc.oneof(
  fc.tuple(fc.array(digitArb, { minLength: 10, maxLength: 10 }), sepsArb).map(([d, s]) => embed(d, s)),
  fc.string({ maxLength: 20 })
);

const categoryGood = fc.oneof(
  fc.constantFrom(...slugs),
  fc.constantFrom(...categories.map((c) => c.label)),
  fc.constantFrom(...categories.map((c) => c.label.toUpperCase())),
  fc.string({ maxLength: 20 })
);

const hoursGood = fc.dictionary(
  fc.oneof(
    fc.constantFrom(...DAYS),
    fc.constantFrom(...DAYS.map((d) => d.toUpperCase())),
    fc.string({ maxLength: 10 }).filter((k) => k !== '__proto__')
  ),
  looseStr
);

const servicesGood = fc.array(looseStr, { maxLength: 60 });

/** Adds an own, enumerable "__proto__" key without touching the prototype. */
function withOwnProto(obj, value) {
  Object.defineProperty(obj, '__proto__', {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return obj;
}

const objectOutputArb = fc
  .record({
    name: fieldValue(looseStr),
    category: fieldValue(categoryGood),
    phone: fieldValue(phoneGood),
    hours: fieldValue(hoursGood),
    services: fieldValue(servicesGood),
    serviceArea: fieldValue(looseStr),
    description: fieldValue(looseStr),
    city: fieldValue(looseStr),
    state: fieldValue(stateGood),
    address: fieldValue(looseStr),
    extra: fc.anything(),
    includeProto: fc.boolean(),
    protoValue: fc.oneof(
      fc.constant({ name: 'polluted', services: ['x'] }),
      fc.anything()
    ),
  }, { requiredKeys: [] })
  .map(({ includeProto, protoValue, ...rest }) => {
    const obj = { ...rest };
    return includeProto ? withOwnProto(obj, protoValue) : obj;
  });

const visionOutputArb = fc.oneof(
  { weight: 5, arbitrary: objectOutputArb },
  { weight: 2, arbitrary: fc.anything() },
  { weight: 1, arbitrary: fc.array(fc.anything()) },
  { weight: 1, arbitrary: fc.constantFrom(null, undefined, 0, 'text', true) }
);

/** Whether `fields[key]` satisfies the model rule for that key. */
function ruleHolds(key, fields) {
  const v = fields[key];
  switch (key) {
    case 'name':
    case 'serviceArea':
    case 'description':
    case 'city':
      return typeof v === 'string' && v !== '';
    case 'phone':
      return typeof v === 'string' && PHONE_RE.test(v);
    case 'category':
      return slugs.includes(v);
    case 'services':
      return Array.isArray(v) && v.length >= 1;
    case 'state':
      return typeof v === 'string' && /^[A-Z]{2}$/.test(v);
    default:
      return true;
  }
}

const RULE_KEYS = ['name', 'category', 'phone', 'services', 'serviceArea', 'description', 'city', 'state'];

test('Property 9: validated extraction output always satisfies the Listing model', () => {
  // **Validates: Requirements 3.4, 3.5, 3.7, 3.8, 3.9**
  fc.assert(
    fc.property(visionOutputArb, (raw) => {
      const normalized = normalizeFields(raw, categories);
      const { fields, missingFields } = validateFields(normalized, categories);

      // Only model keys, no prototype pollution.
      for (const key of Object.keys(fields)) assert.ok(MODEL_KEYS.includes(key), `unexpected key ${key}`);
      assert.equal(Object.getPrototypeOf(fields), Object.prototype);
      assert.equal(({}).name, undefined);
      assert.equal(({}).services, undefined);

      // Size limits.
      for (const key of STRING_KEYS) {
        assert.equal(typeof fields[key], 'string');
        assert.ok(fields[key].length <= 500);
      }
      assert.ok(Array.isArray(fields.services));
      assert.ok(fields.services.length <= 20);
      for (const s of fields.services) {
        assert.equal(typeof s, 'string');
        assert.ok(s.length <= 500);
      }

      // Hours: lowercase day names only, string values.
      assert.equal(typeof fields.hours, 'object');
      for (const [day, text] of Object.entries(fields.hours)) {
        assert.ok(DAYS.includes(day));
        assert.equal(typeof text, 'string');
        assert.ok(text.length <= 500);
      }

      // missingFields: unique, known names only.
      assert.equal(new Set(missingFields).size, missingFields.length);
      for (const key of missingFields) assert.ok(RULE_KEYS.includes(key));

      // Passing fields satisfy their rule; failing fields are empty and listed.
      for (const key of RULE_KEYS) {
        const listed = missingFields.includes(key);
        if (listed) {
          assert.deepEqual(fields[key], key === 'services' ? [] : '');
        } else {
          assert.ok(ruleHolds(key, fields), `${key} should satisfy its rule`);
        }
        assert.equal(ruleHolds(key, fields), !listed, `${key} listed iff it fails`);
      }
    })
  );
});

test('Property 9: __proto__ keys in vision output are discarded', () => {
  // **Validates: Requirements 3.4, 3.9**
  const raw = JSON.parse('{"__proto__": {"name": "Evil", "services": ["x"]}, "name": "Joe"}');
  const { fields } = validateFields(raw, categories);
  assert.equal(fields.name, 'Joe');
  assert.equal(Object.getPrototypeOf(fields), Object.prototype);
  assert.equal(({}).name, undefined);
  const { fields: onlyProto } = validateFields(JSON.parse('{"__proto__": {"name": "Evil"}}'), categories);
  assert.equal(onlyProto.name, '');
});

test('Property 10: normalizing and validating again changes nothing', () => {
  // **Validates: Requirements 3.10**
  fc.assert(
    fc.property(visionOutputArb, (raw) => {
      const first = validateFields(raw, categories);
      const second = validateFields(first.fields, categories);
      assert.deepEqual(second.fields, first.fields);
      assert.deepEqual(second.missingFields, first.missingFields);
    })
  );
});

// ---------------------------------------------------------------------------
// Property 11: Listing slugs
// ---------------------------------------------------------------------------

const slugishArb = fc.oneof(
  fc.stringOf(fc.constantFrom(...'abc-0123'.split('')), { minLength: 1, maxLength: 8 }),
  fc.constantFrom('listing', 'listing-2', 'joes-plumbing-nashville', 'joes-plumbing-nashville-2', 'a', 'a-2', 'a-3')
);
const takenArb = fc.array(slugishArb, { maxLength: 12 }).map((a) => new Set(a));
const textArb = fc.oneof(
  fc.fullUnicodeString({ maxLength: 80 }),
  fc.string({ maxLength: 120 }),
  fc.constantFrom('Joe\'s Plumbing', 'A', '!!!', '', 'Ünïcödé Café'),
  fc.anything()
);

test('Property 11: slug is URL-safe, non-empty and not already taken', () => {
  // **Validates: Requirements 3.6**
  fc.assert(
    fc.property(textArb, textArb, takenArb, (name, city, taken) => {
      const slug = makeSlug(name, city, taken);
      assert.match(slug, SLUG_RE);
      assert.ok(!taken.has(slug));
    })
  );
});

test('Property 11: repeated slugging never returns a duplicate', () => {
  // **Validates: Requirements 3.6**
  fc.assert(
    fc.property(textArb, textArb, takenArb, fc.integer({ min: 2, max: 8 }), (name, city, taken, n) => {
      const seen = new Set(taken);
      for (let i = 0; i < n; i++) {
        const slug = makeSlug(name, city, seen);
        assert.match(slug, SLUG_RE);
        assert.ok(!seen.has(slug), `duplicate slug ${slug}`);
        seen.add(slug);
      }
    })
  );
});

// ---------------------------------------------------------------------------
// Single-line fields: no line breaks or control characters (launch-fixes 13.2)
// ---------------------------------------------------------------------------

const SL_BREAKS_AND_CONTROLS = /[\n\r\u2028\u2029\u0085]|\p{Cc}/u;
const SL_DISALLOWED_IN_DESCRIPTION = /(?![\n\t])\p{Cc}/u;

const SL_POOL = [
  '\n', '\r', '\r\n', '\u2028', '\u2029', '\u0085', '\t', '\0', '\u0001', '\u001b', '\u007f',
  '\u0090', ' ', 'a', 'B', '7', '-', '#',
];
const slPoolString = fc
  .array(fc.constantFrom(...SL_POOL), { maxLength: 40 })
  .map((parts) => parts.join(''));

const slArbText = fc.oneof(fc.string(), fc.fullUnicodeString(), slPoolString);

const slArbRaw = fc.record({
  name: slArbText,
  category: slArbText,
  phone: slArbText,
  serviceArea: slArbText,
  description: slArbText,
  city: slArbText,
  state: slArbText,
  address: slArbText,
  services: fc.array(slArbText, { maxLength: 25 }),
  hours: fc.dictionary(fc.constantFrom(...DAYS), slArbText),
});

test('Property: single-line normalizeFields output has no line breaks or control characters', () => {
  // **Validates: docs/launch-fixes.md section 13 (13.2)**
  fc.assert(
    fc.property(slArbRaw, (raw) => {
      const out = normalizeFields(raw, categories);
      for (const key of ['name', 'category', 'phone', 'serviceArea', 'city', 'state', 'address']) {
        assert.equal(SL_BREAKS_AND_CONTROLS.test(out[key]), false, `${key} has a break or control char`);
      }
      for (const s of out.services) {
        assert.equal(SL_BREAKS_AND_CONTROLS.test(s), false, 'service has a break or control char');
      }
      for (const v of Object.values(out.hours)) {
        assert.equal(SL_BREAKS_AND_CONTROLS.test(v), false, 'hours value has a break or control char');
      }
    }),
    { numRuns: 200 }
  );
});

test('Property: description keeps line breaks, drops other control characters', () => {
  // **Validates: docs/launch-fixes.md section 13 (13.2)**
  fc.assert(
    fc.property(slArbText, (text) => {
      const { description } = normalizeFields({ description: text }, categories);
      assert.equal(SL_DISALLOWED_IN_DESCRIPTION.test(description), false);
      assert.equal(/[\r\u2028\u2029\u0085]/.test(description), false);
    }),
    { numRuns: 200 }
  );
});

test('Property: normalization with control characters stays idempotent', () => {
  // **Validates: docs/launch-fixes.md section 13 (13.2)**
  fc.assert(
    fc.property(slArbRaw, (raw) => {
      const once = normalizeFields(raw, categories);
      const twice = normalizeFields(once, categories);
      assert.deepEqual(twice, once);
    }),
    { numRuns: 200 }
  );
});

test('description "a\\nb" keeps its line break in storage', () => {
  assert.ok(normalizeFields({ description: 'a\nb' }, categories).description.includes('\n'));
  assert.equal(normalizeFields({ description: 'a\r\nb\u2028c' }, categories).description, 'a\nb\nc');
  assert.equal(normalizeFields({ description: 'a\0b\tc' }, categories).description, 'ab\tc');
});

test('single-line fields turn line breaks into one space', () => {
  const out = normalizeFields(
    { name: 'Acme\n# SYSTEM NOTE', city: 'Nash\r\nville', services: ['fix\npipes'], hours: { monday: '9am\n5pm' } },
    categories
  );
  assert.equal(out.name, 'Acme # SYSTEM NOTE');
  assert.equal(out.city, 'Nash ville');
  assert.deepEqual(out.services, ['fix pipes']);
  assert.equal(out.hours.monday, '9am 5pm');
});

// ---------------------------------------------------------------------------
// Categories file (task 17.11)
// ---------------------------------------------------------------------------

const NEW_CATEGORIES = [
  { slug: 'cleaners', label: 'Cleaners' },
  { slug: 'landscapers', label: 'Landscapers' },
  { slug: 'pressure-washing', label: 'Pressure Washing' },
  { slug: 'pools-and-concrete', label: 'Pools and Concrete' },
  { slug: 'shops-and-restaurants', label: 'Shops and Restaurants' },
  { slug: 'other', label: 'Other' },
];
const ORIGINAL_SLUGS = ['plumbers', 'electricians', 'auto-repair', 'hair-salons', 'lawyers'];

test('categories.json has the six new categories with the expected labels', () => {
  const onDisk = JSON.parse(
    readFileSync(new URL('../data/categories.json', import.meta.url), 'utf8')
  );
  for (const expected of NEW_CATEGORIES) {
    const found = onDisk.find((c) => c.slug === expected.slug);
    assert.ok(found, `missing category ${expected.slug}`);
    assert.equal(found.label, expected.label);
  }
});

test('categories.json slugs are unique and URL-safe, and the original categories remain (restaurants merged into shops-and-restaurants)', () => {
  const onDisk = JSON.parse(
    readFileSync(new URL('../data/categories.json', import.meta.url), 'utf8')
  );
  const all = onDisk.map((c) => c.slug);
  assert.equal(new Set(all).size, all.length, 'slugs are unique');
  for (const s of all) assert.match(s, SLUG_RE);
  for (const s of ORIGINAL_SLUGS) assert.ok(all.includes(s), `original slug ${s} still present`);
});

test('mapCategory resolves each new slug and label in any letter case', () => {
  for (const { slug, label } of NEW_CATEGORIES) {
    assert.equal(mapCategory(slug, categories), slug);
    assert.equal(mapCategory(slug.toUpperCase(), categories), slug);
    assert.equal(mapCategory(label, categories), slug);
    assert.equal(mapCategory(label.toLowerCase(), categories), slug);
    assert.equal(mapCategory(label.toUpperCase(), categories), slug);
  }
  assert.equal(mapCategory('pressure washing', categories), 'pressure-washing');
  assert.equal(mapCategory('Pools and Concrete', categories), 'pools-and-concrete');
});

test('makeSlug appends the city only when the name does not already contain it', () => {
  assert.equal(makeSlug('Bellevue Plumbing Co', 'Bellevue'), 'bellevue-plumbing-co');
  assert.equal(makeSlug('Joe\'s Plumbing', 'Nashville'), 'joe-s-plumbing-nashville');
  assert.equal(makeSlug('Nashville Pipe Pros', 'Nashville'), 'nashville-pipe-pros');
  assert.equal(makeSlug('Bellevue Plumbing Co', 'Bellevue', new Set(['bellevue-plumbing-co'])), 'bellevue-plumbing-co-2');
  // Whole words only: "Nash" is not in "Nashville Pipe Pros".
  assert.equal(makeSlug('Nashville Pipe Pros', 'Nash'), 'nashville-pipe-pros-nash');
});
