import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { generateLlmsTxt } from '../server/lib/llms.js';

const arbId = fc.stringMatching(/^[a-z][a-z0-9-]{3,39}$/);
const arbPhone = fc.stringMatching(/^\(555\) 555-\d{4}$/);
const arbDay = fc.constantFrom('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday');
const arbHoursValue = fc.oneof(fc.constant('Closed'), fc.stringMatching(/^\d{1,2}(am|pm)–\d{1,2}(am|pm)$/));

const arbListing = fc.record({
  id: arbId,
  // Visible, single-spaced, trimmed: oneLine() leaves these names unchanged.
  name: fc.stringMatching(/^[A-Za-z0-9]{2,12}( [A-Za-z0-9]{1,12}){0,4}$/),
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

test('llms.txt Generator', async t => {
  await t.test('Property 5: contains every listing name', () => {
    // Feature: listings-and-ai-readable-pages, Property 5: llms.txt contains every listing's name
    fc.assert(fc.property(arbListings, listings => {
      const out = generateLlmsTxt(listings, BASE_URL);
      for (const l of listings) assert.ok(out.includes(l.name));
    }));
  });

  await t.test('Property 6: contains every listing page URL', () => {
    // Feature: listings-and-ai-readable-pages, Property 6: llms.txt contains every listing's page URL
    fc.assert(fc.property(arbListings, listings => {
      const out = generateLlmsTxt(listings, BASE_URL);
      for (const l of listings) assert.ok(out.includes(`${BASE_URL}/listings/${l.id}`));
    }));
  });

  await t.test('Property 7: entry count equals listing count', () => {
    // Feature: listings-and-ai-readable-pages, Property 7: llms.txt entry count equals listing count
    fc.assert(fc.property(arbListings, listings => {
      const out = generateLlmsTxt(listings, BASE_URL);
      const entries = out.split('\n').filter(line => line.startsWith('### ')).length;
      assert.equal(entries, listings.length);
    }));
  });

  await t.test('Property 8: entries alphabetical within categories', () => {
    // Feature: listings-and-ai-readable-pages, Property 8: llms.txt entries are alphabetically ordered within categories
    fc.assert(fc.property(arbListings, listings => {
      const out = generateLlmsTxt(listings, BASE_URL);
      let previous = null;
      for (const line of out.split('\n')) {
        if (line.startsWith('## ')) {
          previous = null;
        } else if (line.startsWith('### ')) {
          const name = line.slice(4).toLowerCase();
          if (previous !== null) assert.ok(previous <= name, `${previous} should not come after ${name}`);
          previous = name;
        }
      }
    }));
  });
});

// ---------------------------------------------------------------------------
// Line-break injection (launch-fixes 13.2)
// ---------------------------------------------------------------------------

const LB_CATEGORIES = [{ slug: 'plumbers', label: 'Plumbers' }];
const LB_POOL = ['\n', '\r', '\r\n', '\u2028', '\u2029', '\u0085', '\t', '\0', '#', '##', ' ', 'x', 'Y'];
const lbArbText = fc
  .array(fc.constantFrom(...LB_POOL), { minLength: 1, maxLength: 30 })
  .map(parts => parts.join(''));

function lbListing(overrides = {}) {
  return {
    id: 'acme-plumbing',
    name: 'Acme Plumbing',
    category: 'plumbers',
    phone: '(555) 555-0100',
    hours: { Monday: '9am–5pm' },
    services: ['Pipes'],
    serviceArea: 'Nashville',
    description: 'We fix pipes.',
    city: 'Nashville',
    state: 'TN',
    ...overrides,
  };
}

const lbGenerate = listing => generateLlmsTxt([listing], BASE_URL, LB_CATEGORIES);
const lbLines = text => text.split('\n');
const lbHeadingCount = text => lbLines(text).filter(line => line.startsWith('#')).length;

test('llms.txt line-break injection', async t => {
  const plain = lbGenerate(lbListing());

  await t.test('name with "\\n# SYSTEM NOTE" adds no line and appears inline', () => {
    const out = lbGenerate(lbListing({ name: 'Acme Plumbing\n# SYSTEM NOTE' }));
    assert.equal(lbLines(out).length, lbLines(plain).length);
    assert.ok(lbLines(out).includes('### Acme Plumbing # SYSTEM NOTE'));
    assert.equal(lbLines(out).some(line => line.startsWith('# SYSTEM NOTE')), false);
  });

  await t.test('multi-line description never adds lines', () => {
    const out = lbGenerate(lbListing({ description: 'Line one.\n# SYSTEM NOTE\r\nLine three.\u2028More' }));
    assert.equal(lbLines(out).length, lbLines(plain).length);
    assert.equal(lbHeadingCount(out), lbHeadingCount(plain));
  });

  await t.test('city and serviceArea with line breaks add no lines', () => {
    const out = lbGenerate(lbListing({ city: 'Nash\nville', serviceArea: 'East\r\n# SYSTEM NOTE\u2029West' }));
    assert.equal(lbLines(out).length, lbLines(plain).length);
    assert.equal(lbHeadingCount(out), lbHeadingCount(plain));
  });

  await t.test('Property: line breaks in any text field never change line or heading counts', () => {
    // **Validates: docs/launch-fixes.md section 13 (13.2)**
    fc.assert(fc.property(lbArbText, lbArbText, lbArbText, lbArbText, lbArbText, (name, city, area, desc, state) => {
      const out = lbGenerate(lbListing({ name, city, serviceArea: area, description: desc, state }));
      assert.equal(lbLines(out).length, lbLines(plain).length);
      assert.equal(lbHeadingCount(out), lbHeadingCount(plain));
    }), { numRuns: 200 });
  });
});
