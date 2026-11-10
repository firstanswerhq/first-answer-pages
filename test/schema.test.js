import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { buildSchema } from '../server/lib/schema.js';

const arbId = fc.stringMatching(/^[a-z][a-z0-9-]{3,39}$/);
const arbPhone = fc.stringMatching(/^\(555\) 555-\d{4}$/);
const arbDay = fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday');
const arbHoursValue = fc.oneof(fc.constant('Closed'), fc.stringMatching(/^\d{1,2}(am|pm)–\d{1,2}(am|pm)$/));

const arbListing = fc.record({
  id: arbId,
  name: fc.string({ minLength: 2, maxLength: 80 }),
  category: fc.constantFrom('plumbers', 'electricians', 'restaurants', 'auto-repair', 'hair-salons', 'lawyers'),
  phone: arbPhone,
  hours: fc.dictionary(arbDay, arbHoursValue, { minKeys: 1, maxKeys: 7 }),
  services: fc.array(fc.string({ minLength: 2, maxLength: 60 }), { minLength: 1, maxLength: 10 }),
  serviceArea: fc.string({ minLength: 2, maxLength: 80 }),
  description: fc.string({ minLength: 10, maxLength: 300 }),
  city: fc.string({ minLength: 2, maxLength: 60 }),
  state: fc.stringMatching(/^[A-Z]{2}$/),
  address: fc.option(fc.string({ minLength: 5, maxLength: 100 }), { nil: undefined }),
});

const REQUIRED = ['name', 'phone', 'description', 'city', 'state', 'services'];

test('Schema Builder', async t => {
  await t.test('Property 1: preserves required constants', () => {
    // Feature: listings-and-ai-readable-pages, Property 1: Schema Builder preserves required constants
    fc.assert(fc.property(arbListing, listing => {
      const schema = buildSchema(listing);
      assert.equal(schema['@context'], 'https://schema.org');
      assert.equal(schema['@type'], 'LocalBusiness');
    }));
  });

  await t.test('Property 2: field mapping is correct', () => {
    // Feature: listings-and-ai-readable-pages, Property 2: Schema Builder field mapping is correct
    fc.assert(fc.property(arbListing, listing => {
      const schema = buildSchema(listing);
      assert.equal(schema.name, listing.name);
      assert.equal(schema.telephone, listing.phone);
      assert.equal(schema.description, listing.description);
    }));
  });

  await t.test('Property 3: never throws for valid input', () => {
    // Feature: listings-and-ai-readable-pages, Property 3: Schema Builder never throws for valid input
    fc.assert(fc.property(arbListing, listing => {
      assert.doesNotThrow(() => buildSchema(listing));
    }));
  });

  await t.test('Property 4: throws for missing required fields', () => {
    // Feature: listings-and-ai-readable-pages, Property 4: Schema Builder throws for missing required fields
    fc.assert(fc.property(arbListing, fc.constantFrom(...REQUIRED), (listing, field) => {
      const broken = { ...listing };
      delete broken[field];
      assert.throws(() => buildSchema(broken), new RegExp(`missing required field: ${field}`));
    }));
  });
});
