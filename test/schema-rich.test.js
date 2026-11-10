/**
 * Tests for the richer JSON-LD (task 21.2): url, +1 telephone, areaServed,
 * openingHoursSpecification, a clean streetAddress, and a specific @type per
 * category with LocalBusiness as the fallback.
 *
 * The page test runs on a temporary DATA_DIR whose listings.json is a modified
 * copy of the real one; the repo data/ folder is never written.
 *
 * Property: toE164 of any formatting of 10 digits is '+1' plus the digits.
 * Property: buildSchema output always serializes and has an allowed @type.
 * **Validates: task 21.2 (richer JSON-LD)**
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import {
  buildSchema,
  schemaTypeFor,
  SCHEMA_TYPES,
  toE164,
  parseHoursRange,
  stripAddressTail,
} from '../server/lib/schema.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const BASE_URL = 'http://example.test';
const PLUMBER_ID = 'nashville-pipe-pros';

// ---- helpers ---------------------------------------------------------------------

const baseListing = (extra = {}) => ({
  id: 'acme-plumbing-springfield',
  name: 'Acme Plumbing',
  category: 'plumbers',
  phone: '(615) 555-0177',
  description: 'We fix pipes.',
  city: 'Springfield',
  state: 'TN',
  services: ['Leak repair'],
  serviceArea: 'Greater Springfield',
  address: '123 Main St, Springfield, TN 37172',
  hours: { monday: '7:00 AM - 5:00 PM', sunday: 'Closed' },
  ...extra,
});

function parseJsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)];
  assert.equal(blocks.length, 1, 'exactly one JSON-LD block');
  return JSON.parse(blocks[0][1]);
}

// ---- unit tables ------------------------------------------------------------------

test('category -> @type table, with LocalBusiness as the fallback', () => {
  const table = {
    plumbers: 'Plumber',
    electricians: 'Electrician',
    hvac: 'HVACBusiness',
    roofers: 'RoofingContractor',
    landscapers: 'HomeAndConstructionBusiness',
    cleaners: 'HomeAndConstructionBusiness',
    restaurants: 'Restaurant',
    shops: 'Store',
  };
  for (const [slug, type] of Object.entries(table)) {
    assert.equal(schemaTypeFor(slug), type, slug);
    assert.equal(buildSchema(baseListing({ category: slug }), null, { baseUrl: BASE_URL })['@type'], type, slug);
  }
  for (const unknown of ['other', 'zebra', '', undefined, null, 5, 'constructor', '__proto__', 'toString']) {
    assert.equal(schemaTypeFor(unknown), 'LocalBusiness', String(unknown));
  }
});

test('toE164: common formats give +1 and ten digits; anything else is returned as given', () => {
  const table = [
    ['(615) 555-0177', '+16155550177'],
    ['615-555-0177', '+16155550177'],
    ['615.555.0177', '+16155550177'],
    ['6155550177', '+16155550177'],
    ['1-615-555-0177', '+16155550177'],
    ['+1 (615) 555-0177', '+16155550177'],
    ['555-0177', '555-0177'],
    ['call us', 'call us'],
    ['+44 20 7946 0958', '+44 20 7946 0958'],
    ['', ''],
  ];
  for (const [input, expected] of table) assert.equal(toE164(input), expected, input);
  assert.equal(toE164(undefined), '');
  assert.equal(toE164(null), '');
});

test('parseHoursRange: 12-hour ranges become 24-hour HH:MM; closed and garbage give null', () => {
  const ok = [
    ['7:00 AM - 5:00 PM', '07:00', '17:00'],
    ['12:00 AM - 12:00 PM', '00:00', '12:00'],
    ['12:30 PM - 11:45 PM', '12:30', '23:45'],
    ['7am-5pm', '07:00', '17:00'],
    ['9 a.m. to 5 p.m.', '09:00', '17:00'],
    ['6:30 PM \u2013 11:00 PM', '18:30', '23:00'],
  ];
  for (const [text, opens, closes] of ok) assert.deepEqual(parseHoursRange(text), { opens, closes }, text);
  const none = ['Closed', 'closed', 'garbage', '', '   ', '7:00 AM', '13:00 AM - 5:00 PM', '0:30 AM - 5:00 PM',
    '7:60 AM - 5:00 PM', 'By appointment', undefined, null, 700, {}];
  for (const text of none) assert.equal(parseHoursRange(text), null, String(text));
});

test('stripAddressTail removes a repeated city, state and ZIP and leaves other text alone', () => {
  assert.equal(stripAddressTail('123 Main St, Nashville, TN 37203', 'Nashville', 'TN'), '123 Main St');
  assert.equal(stripAddressTail('123 Main St, Nashville, TN', 'Nashville', 'TN'), '123 Main St');
  assert.equal(stripAddressTail('123 Main St, TN 37203', 'Nashville', 'TN'), '123 Main St');
  assert.equal(stripAddressTail('150 4th Ave N, Suite 800, Nashville, TN 37219', 'Nashville', 'TN'), '150 4th Ave N, Suite 800');
  assert.equal(stripAddressTail('123 Main St', 'Nashville', 'TN'), '123 Main St');
});

test('buildSchema with baseUrl adds the rich fields', () => {
  const schema = buildSchema(baseListing(), null, { baseUrl: `${BASE_URL}/` });
  assert.equal(schema['@type'], 'Plumber');
  assert.equal(schema.url, `${BASE_URL}/listings/acme-plumbing-springfield`);
  assert.equal(schema.telephone, '+16155550177');
  assert.equal(schema.areaServed, 'Greater Springfield');
  assert.deepEqual(schema.openingHoursSpecification, [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '07:00', closes: '17:00' },
  ]);
  assert.equal(schema.address.streetAddress, '123 Main St');
  assert.equal(schema.address.addressLocality, 'Springfield');
  assert.equal(schema.address.addressRegion, 'TN');
});

test('buildSchema without options.baseUrl is unchanged', () => {
  const listing = baseListing();
  for (const options of [undefined, {}, { baseUrl: '' }, { baseUrl: '   ' }, { baseUrl: 5 }]) {
    const schema = buildSchema(listing, null, options);
    assert.equal(schema['@type'], 'LocalBusiness');
    assert.equal(schema.telephone, listing.phone);
    assert.equal(schema.address.streetAddress, listing.address, 'street address is as stored');
    assert.ok(!('url' in schema));
    assert.ok(!('areaServed' in schema));
    assert.ok(!('openingHoursSpecification' in schema));
  }
  assert.deepEqual(buildSchema(listing), buildSchema(listing, null, {}));
});

test('buildSchema leaves out areaServed, hours and street address when the listing has none', () => {
  const listing = baseListing({ serviceArea: '  ', hours: { monday: 'Closed' }, address: undefined });
  const schema = buildSchema(listing, null, { baseUrl: BASE_URL });
  assert.ok(!('areaServed' in schema));
  assert.ok(!('openingHoursSpecification' in schema));
  assert.ok(!('streetAddress' in schema.address));
  assert.equal(schema.telephone, '+16155550177');
});

// ---- the listing page ----------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-schema-rich-'));
  await fs.copyFile(path.join(REPO_DATA, 'categories.json'), path.join(dir, 'categories.json'));
  const listings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'));
  const modified = listings.map(l => (l && l.id === PLUMBER_ID
    ? {
      ...l,
      address: '123 Main St, Nashville, TN 37203',
      hours: { monday: '7:00 AM - 5:00 PM', tuesday: '12:00 AM - 12:00 PM', sunday: 'Closed' },
    }
    : l));
  await fs.writeFile(path.join(dir, 'listings.json'), JSON.stringify(modified));
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const app = createApp({
    dataDir: dir,
    clock,
    config: { demoMode: true, production: false, baseUrl: BASE_URL },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

test('GET /listings/:id for a plumber has the rich JSON-LD', async () => {
  const env = await startEnv();
  const res = await fetch(`${env.base}/listings/${PLUMBER_ID}`);
  assert.equal(res.status, 200);
  const ld = parseJsonLd(await res.text());

  assert.equal(ld['@context'], 'https://schema.org');
  assert.equal(ld['@type'], 'Plumber');
  assert.equal(ld.url, `${BASE_URL}/listings/${PLUMBER_ID}`);
  assert.match(ld.telephone, /^\+1\d{10}$/);
  assert.equal(ld.areaServed, 'Nashville and surrounding Davidson County');

  assert.ok(Array.isArray(ld.openingHoursSpecification) && ld.openingHoursSpecification.length > 0);
  for (const spec of ld.openingHoursSpecification) {
    assert.equal(spec['@type'], 'OpeningHoursSpecification');
    assert.match(spec.dayOfWeek, /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/);
    assert.match(spec.opens, /^\d{2}:\d{2}$/);
    assert.match(spec.closes, /^\d{2}:\d{2}$/);
  }
  const byDay = Object.fromEntries(ld.openingHoursSpecification.map(s => [s.dayOfWeek, s]));
  assert.deepEqual([byDay.Monday.opens, byDay.Monday.closes], ['07:00', '17:00']);
  assert.deepEqual([byDay.Tuesday.opens, byDay.Tuesday.closes], ['00:00', '12:00']);
  assert.equal(byDay.Sunday, undefined, 'a closed day is left out');

  assert.equal(ld.address.streetAddress, '123 Main St');
  assert.equal(ld.address.addressLocality, 'Nashville');
  assert.equal(ld.address.addressRegion, 'TN');
});

test('GET /listings/:id uses the specific @type for other categories', async () => {
  const env = await startEnv();
  const expected = { 'volt-brothers-electric': 'Electrician', 'the-griddle-house': 'Restaurant' };
  for (const [id, type] of Object.entries(expected)) {
    const ld = parseJsonLd(await (await fetch(`${env.base}/listings/${id}`)).text());
    assert.equal(ld['@type'], type, id);
    assert.equal(ld.url, `${BASE_URL}/listings/${id}`);
    assert.match(ld.telephone, /^\+1\d{10}$/);
  }
});

// ---- properties -------------------------------------------------------------------------

test('Property: toE164 of any formatting of ten digits is +1 and the digits', () => {
  // **Validates: task 21.2 (telephone in +1 format)**
  const digitsArb = fc.stringMatching(/^[0-9]{10}$/);
  fc.assert(
    fc.property(digitsArb, (d) => {
      const a = d.slice(0, 3);
      const b = d.slice(3, 6);
      const c = d.slice(6);
      const forms = [
        `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`, `${a} ${b} ${c}`, d,
        `+1 (${a}) ${b}-${c}`, ` (${a})${b}-${c} `,
      ];
      for (const form of forms) assert.equal(toE164(form), `+1${d}`, form);
    }),
    { numRuns: 200 },
  );
});

test('Property: buildSchema(listing, null, { baseUrl }) serializes and has an allowed @type', () => {
  // **Validates: task 21.2 (richer JSON-LD)**
  const allowed = new Set([...Object.values(SCHEMA_TYPES), 'LocalBusiness']);
  const text = fc.fullUnicodeString({ minLength: 1, maxLength: 30 });
  const listingArb = fc.record({
    id: text,
    name: text,
    phone: fc.oneof(text, fc.stringMatching(/^\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}$/)),
    description: text,
    city: text,
    state: fc.stringMatching(/^[A-Z]{2}$/),
    services: fc.array(text, { minLength: 1, maxLength: 4 }),
    category: fc.oneof(fc.constantFrom(...Object.keys(SCHEMA_TYPES)), fc.constantFrom('other', '__proto__', 'constructor'), text),
    serviceArea: fc.option(text, { nil: undefined }),
    address: fc.option(text, { nil: undefined }),
    hours: fc.option(
      fc.record({
        monday: fc.oneof(text, fc.constantFrom('7:00 AM - 5:00 PM', 'Closed', '9am-5pm')),
        sunday: fc.oneof(text, fc.constantFrom('7:00 AM - 5:00 PM', 'Closed')),
      }),
      { nil: undefined },
    ),
  });
  fc.assert(
    fc.property(listingArb, (listing) => {
      const schema = buildSchema(listing, null, { baseUrl: BASE_URL });
      const json = JSON.stringify(schema);
      assert.equal(typeof json, 'string');
      assert.ok(allowed.has(schema['@type']), schema['@type']);
      assert.deepEqual(JSON.parse(json), schema);
      assert.ok(schema.url.startsWith(`${BASE_URL}/listings/`));
    }),
    { numRuns: 200 },
  );
});
