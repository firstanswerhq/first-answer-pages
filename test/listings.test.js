import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  getListings,
  getCategories,
  findById,
  filterListings,
  groupByCategory,
} from '../server/data.js';

// filterListings works on the in-memory seed data, so the properties below
// generate filter values (known and unknown) and compare against an oracle.
const arbCategory = fc.oneof(
  fc.constantFrom(...getCategories().map(c => c.slug)),
  fc.constant('no-such-category'),
  fc.string({ minLength: 1, maxLength: 20 }),
);

const arbCity = fc.oneof(
  fc.constantFrom('Nashville', 'nashville', 'NASHVILLE', 'nAsHvIlLe'),
  fc.constant('Memphis'),
  fc.string({ minLength: 1, maxLength: 20 }),
);


test('findById returns the listing for a known id', () => {
  const listing = findById('nashville-pipe-pros');
  assert.ok(listing);
  assert.equal(listing.id, 'nashville-pipe-pros');
  assert.equal(listing.name, 'Nashville Pipe Pros');
});

test('findById returns undefined for an unknown id', () => {
  assert.equal(findById('does-not-exist'), undefined);
});

test('groupByCategory orders categories as defined in categories.json', () => {
  // Pass listings in reverse so input order differs from canonical order
  const reversed = [...getListings()].reverse();
  const keys = [...groupByCategory(reversed).keys()];
  const canonical = getCategories().map(c => c.slug).filter(slug => keys.includes(slug));
  assert.deepEqual(keys, canonical);
});

test('filterListings with no filters returns all listings', () => {
  assert.deepEqual(filterListings(), getListings());
  assert.deepEqual(filterListings({}), getListings());
});

test('filterListings with a filter that matches nothing returns an empty array', () => {
  assert.deepEqual(filterListings({ category: 'no-such-category' }), []);
  assert.deepEqual(filterListings({ city: 'Atlantis' }), []);
});

test('filterListings properties', async t => {
  await t.test('Property 12: category filtering returns only matching listings', () => {
    // Feature: listings-and-ai-readable-pages, Property 12: Category filtering returns only matching listings
    fc.assert(fc.property(arbCategory, category => {
      const result = filterListings({ category });
      const expected = getListings().filter(l => l.category === category);
      assert.ok(result.every(l => l.category === category));
      assert.deepEqual(result, expected);
    }));
  });

  await t.test('Property 13: city filtering is case-insensitive', () => {
    // Feature: listings-and-ai-readable-pages, Property 13: City filtering is case-insensitive
    fc.assert(fc.property(arbCity, city => {
      const result = filterListings({ city });
      const expected = getListings().filter(l => l.city.toLowerCase() === city.toLowerCase());
      assert.deepEqual(result, expected);
    }));
  });

  await t.test('Property 14: combined filtering is a logical intersection', () => {
    // Feature: listings-and-ai-readable-pages, Property 14: Combined filtering is a logical intersection
    fc.assert(fc.property(arbCategory, arbCity, (category, city) => {
      const result = filterListings({ category, city });
      const expected = getListings().filter(
        l => l.category === category && l.city.toLowerCase() === city.toLowerCase(),
      );
      assert.deepEqual(result, expected);
    }));
  });

  await t.test('Property 15 (added): an empty-string filter is the same as omitting it', () => {
    // Feature: listings-and-ai-readable-pages, Property 15: Empty-string filter equals omitted filter
    fc.assert(fc.property(arbCategory, arbCity, (category, city) => {
      assert.deepEqual(filterListings({ category: '' }), filterListings({}));
      assert.deepEqual(filterListings({ city: '' }), filterListings({}));
      assert.deepEqual(filterListings({ category: '', city }), filterListings({ city }));
      assert.deepEqual(filterListings({ category, city: '' }), filterListings({ category }));
      assert.deepEqual(filterListings({ category: '', city: '' }), getListings());
    }));
  });
});
