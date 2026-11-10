import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { hashListing, verificationFor, checkHash } from '../server/lib/verifier.js';

const DERIVED = ['verifiedDate', 'verificationHash'];

/** Independent oracle: SHA-256 hex of UTF-8 text. */
function sha256Hex(text) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

/**
 * Independent canonical form for flat listings: keys sorted (ASCII keys only,
 * so default sort equals code point order), built with plain JSON.stringify.
 */
function expectedDigest(listing, verifiedDate) {
  const sorted = {};
  for (const key of Object.keys(listing).sort()) sorted[key] = listing[key];
  return sha256Hex(JSON.stringify({ listing: sorted, verifiedDate }));
}

// Keys start with a letter, so they never collide with "__proto__".
const arbKey = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,9}$/)
  .filter((k) => !DERIVED.includes(k));
const arbValue = fc.oneof(
  fc.string({ maxLength: 30 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string({ maxLength: 10 }), { maxLength: 4 }),
);
const arbListing = fc.dictionary(arbKey, arbValue, { minKeys: 1, maxKeys: 8 });
const arbDate = fc
  .tuple(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('hashListing matches a hand-built canonical string', () => {
  const listing = { name: 'A', id: 'x' };
  const canonical = '{"listing":{"id":"x","name":"A"},"verifiedDate":"2024-01-02"}';
  assert.equal(hashListing(listing, '2024-01-02'), sha256Hex(canonical));
});

test('hashListing ignores derived keys in a hand-built example', () => {
  const canonical = '{"listing":{"id":"x","name":"A"},"verifiedDate":"2024-01-02"}';
  const listing = { name: 'A', id: 'x', verifiedDate: '1999-01-01', verificationHash: 'abc' };
  assert.equal(hashListing(listing, '2024-01-02'), sha256Hex(canonical));
});

test('Property 3: hash is deterministic, well formed, and equals an independent digest', () => {
  // Feature: super-pages, Property 3: Verification hash is deterministic and well formed
  // **Validates: Requirements 9.2, 9.7**
  fc.assert(
    fc.property(arbListing, arbDate, (listing, date) => {
      const h1 = hashListing(listing, date);
      const h2 = hashListing(listing, date);
      assert.equal(h1, h2);
      assert.match(h1, /^[0-9a-f]{64}$/);
      assert.equal(h1, expectedDigest(listing, date));
    }),
    { numRuns: 200 },
  );
});

/** Builds a mutated copy of a listing. */
const arbMutation = (listing) =>
  fc.oneof(
    // change one field value
    fc.tuple(fc.constantFrom(...Object.keys(listing)), arbValue).map(([key, value]) => ({ ...listing, [key]: value })),
    // add a field
    fc.tuple(fc.nat({ max: 1000 }), arbValue).map(([n, value]) => ({ ...listing, [`extra_${n}`]: value })),
    // remove a field
    fc.constantFrom(...Object.keys(listing)).map((key) => {
      const copy = { ...listing };
      delete copy[key];
      return copy;
    }),
  );

test('Property 4: hash changes when the listing or the date changes', () => {
  // Feature: super-pages, Property 4: Verification hash is sensitive to every change
  // **Validates: Requirements 9.5, 9.8**
  fc.assert(
    fc.property(
      arbListing.chain((listing) =>
        fc.tuple(
          fc.constant(listing),
          arbMutation(listing).filter((mutated) => !same(
            // compare as sorted JSON so key order alone is not a "change"
            Object.fromEntries(Object.entries(mutated).sort(([a], [b]) => (a < b ? -1 : 1))),
            Object.fromEntries(Object.entries(listing).sort(([a], [b]) => (a < b ? -1 : 1))),
          )),
        ),
      ),
      arbDate,
      ([listing, mutated], date) => {
        assert.notEqual(hashListing(mutated, date), hashListing(listing, date));
      },
    ),
    { numRuns: 200 },
  );

  fc.assert(
    fc.property(arbListing, arbDate, arbDate, (listing, d1, d2) => {
      fc.pre(d1 !== d2);
      assert.notEqual(hashListing(listing, d1), hashListing(listing, d2));
    }),
    { numRuns: 100 },
  );
});

test('Property 5: derived fields do not enter the hash', () => {
  // Feature: super-pages, Property 5: Derived fields do not enter the hash
  // **Validates: Requirements 9.3**
  fc.assert(
    fc.property(
      arbListing,
      arbDate,
      fc.string({ maxLength: 20 }),
      fc.string({ maxLength: 70 }),
      (listing, date, otherDate, otherHash) => {
        const base = hashListing(listing, date);
        const withDerived = { ...listing, verifiedDate: otherDate, verificationHash: otherHash };
        assert.equal(hashListing(withDerived, date), base);
        assert.equal(hashListing({ ...listing, verifiedDate: otherDate }, date), base);
        assert.equal(hashListing({ ...listing, verificationHash: otherHash }, date), base);
      },
    ),
    { numRuns: 100 },
  );
});

test('hashListing does not mutate its input', () => {
  const listing = { id: 'x', verifiedDate: 'd', verificationHash: 'h' };
  hashListing(listing, '2024-01-02');
  assert.deepEqual(listing, { id: 'x', verifiedDate: 'd', verificationHash: 'h' });
});

test('verificationFor returns null when the listing is unverified', () => {
  const listing = { id: 'a', name: 'A' };
  for (const value of [undefined, null, '']) {
    const store = { getVerifiedDate: () => value };
    assert.equal(verificationFor(store, listing), null);
  }
});

test('verificationFor returns the stored date and its hash', () => {
  const listing = { id: 'a', name: 'A' };
  const store = { getVerifiedDate: (id) => (id === 'a' ? '2024-01-02' : undefined) };
  assert.deepEqual(verificationFor(store, listing), {
    verifiedDate: '2024-01-02',
    hash: hashListing(listing, '2024-01-02'),
  });
});

test('checkHash returns null when the supplied hash is absent', () => {
  assert.equal(checkHash('abc', undefined), null);
  assert.equal(checkHash('abc', null), null);
});

test('checkHash returns false for non-string values', () => {
  for (const value of [123, true, {}, ['abc']]) {
    assert.equal(checkHash('abc', value), false);
  }
});

test('checkHash trims and ignores case', () => {
  const current = 'abcdef0123';
  assert.equal(checkHash(current, current), true);
  assert.equal(checkHash(current, '  ABCDEF0123\n'), true);
  assert.equal(checkHash(current, 'abcdef0124'), false);
  assert.equal(checkHash(current, ''), false);
});
