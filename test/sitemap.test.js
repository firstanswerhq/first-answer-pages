import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { generateSitemap } from '../server/lib/sitemap.js';

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

const arbListings = fc.array(arbListing, { minLength: 1, maxLength: 20 });
const BASE_URL = 'https://example.test';

test('Sitemap Generator', async t => {
  await t.test('Property 9: contains every listing page URL', () => {
    // Feature: listings-and-ai-readable-pages, Property 9: Sitemap contains every listing's page URL
    fc.assert(fc.property(arbListings, listings => {
      const xml = generateSitemap(listings, BASE_URL);
      for (const l of listings) assert.ok(xml.includes(`${BASE_URL}/listings/${l.id}`));
    }));
  });

  await t.test('Property 10: well-formed XML structure', () => {
    // Feature: listings-and-ai-readable-pages, Property 10: Sitemap has well-formed XML structure
    fc.assert(fc.property(arbListings, listings => {
      const xml = generateSitemap(listings, BASE_URL);
      assert.ok(xml.includes('<urlset'));
      assert.ok(xml.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
    }));
  });

  await t.test('Property 11: URL count equals listing count plus one', () => {
    // Feature: listings-and-ai-readable-pages, Property 11: Sitemap URL count equals listing count plus one
    fc.assert(fc.property(arbListings, listings => {
      const xml = generateSitemap(listings, BASE_URL);
      const count = (xml.match(/<url>/g) ?? []).length;
      assert.equal(count, listings.length + 1);
    }));
  });
});
