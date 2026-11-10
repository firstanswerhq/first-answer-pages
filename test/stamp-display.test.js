/**
 * Tests for the owner-confirmed stamp date (America/Chicago) and the
 * "Details for AI tools" toggle.
 *
 * Property 7: The stamp date is formatted in America/Chicago and matches an
 * independent oracle (hand-computed US daylight saving rule, no Intl).
 * **Validates: docs/launch-fixes.md section 17 (stamp display)**
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { formatStampDate, listingDetail } from '../server/lib/html.js';
import { hashListing } from '../server/lib/verifier.js';
import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOUR = 3600 * 1000;

// ---- independent oracle ---------------------------------------------------------

/** Day of month of the nth Sunday (1-based) of a UTC month. */
function nthSunday(year, month, n) {
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0 = Sunday
  const firstSunday = 1 + ((7 - firstDow) % 7);
  return firstSunday + 7 * (n - 1);
}

/** Chicago UTC offset in hours (-5 in daylight time, else -6). US rule, 2007 onward. */
function chicagoOffsetHours(ms) {
  const year = new Date(ms).getUTCFullYear();
  const start = Date.UTC(year, 2, nthSunday(year, 2, 2), 8); // 2:00 CST = 08:00Z
  const end = Date.UTC(year, 10, nthSunday(year, 10, 1), 7); // 2:00 CDT = 07:00Z
  return ms >= start && ms < end ? -5 : -6;
}

function oracle(ms) {
  const shifted = new Date(ms + chicagoOffsetHours(ms) * HOUR);
  return `${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}, ${shifted.getUTCFullYear()}`;
}

const isoOf = ms => new Date(ms).toISOString();
const stampFor = ms => formatStampDate({ verifiedDate: isoOf(ms).slice(0, 10), verifiedAt: isoOf(ms), hash: 'h' });

// ---- pure date tests --------------------------------------------------------------

test('Property 7: stamp date equals the independent Chicago oracle', () => {
  const instants = fc.integer({ min: Date.UTC(2007, 0, 1), max: Date.UTC(2100, 11, 31, 23, 59, 59) });
  fc.assert(
    fc.property(instants, ms => stampFor(ms) === oracle(ms)),
    { numRuns: 200 },
  );
});

test('Property 7: instants between 00:00 and 06:00 UTC fall on the previous Chicago day', () => {
  const instants = fc
    .tuple(
      fc.integer({ min: 2007, max: 2100 }),
      fc.integer({ min: 0, max: 11 }),
      fc.integer({ min: 1, max: 28 }),
      fc.integer({ min: 0, max: 4 * 3600 + 3599 }), // 00:00:00 to 04:59:59 UTC (previous day in CDT and CST)
    )
    .map(([y, m, d, s]) => Date.UTC(y, m, d) + s * 1000);
  fc.assert(
    fc.property(instants, ms => {
      const out = stampFor(ms);
      const utcDay = new Date(ms).getUTCDate();
      const chicagoDay = Number(/ (\d+),/.exec(out)[1]);
      // Never the same UTC day: offset of 5 or 6 hours pushes it back one day.
      return out === oracle(ms) && chicagoDay !== utcDay;
    }),
    { numRuns: 200 },
  );
});

test('daylight saving boundaries match the oracle', () => {
  const cases = [
    '2025-03-09T07:59:59Z', // still CST: 01:59:59 Mar 9
    '2025-03-09T08:00:00Z', // CDT begins: 03:00 Mar 9
    '2025-11-02T06:59:59Z', // CDT: 01:59:59 Nov 2
    '2025-11-02T07:00:00Z', // fall back: 01:00 CST Nov 2
  ];
  for (const iso of cases) {
    const ms = Date.parse(iso);
    assert.equal(stampFor(ms), oracle(ms), iso);
  }
  // Explicit values around the two transitions (hand-checked).
  assert.equal(stampFor(Date.parse('2025-03-09T05:59:59Z')), 'Mar 8, 2025');
  assert.equal(stampFor(Date.parse('2025-03-09T06:00:00Z')), 'Mar 9, 2025');
  assert.equal(stampFor(Date.parse('2025-11-02T04:59:59Z')), 'Nov 1, 2025');
  assert.equal(stampFor(Date.parse('2025-11-02T05:00:00Z')), 'Nov 2, 2025');
});

test('Property 7: legacy date-only values show the calendar date with no shift', () => {
  const ymd = fc
    .tuple(fc.integer({ min: 2000, max: 2100 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
    .map(([y, m, d]) => ({
      iso: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      expected: `${MONTHS[m - 1]} ${d}, ${y}`,
    }));
  fc.assert(
    fc.property(ymd, ({ iso, expected }) => formatStampDate({ verifiedDate: iso, hash: 'h' }) === expected),
    { numRuns: 200 },
  );
});

test('verifiedAt 2026-11-10T05:05:00.000Z shows Nov 9, 2026', () => {
  assert.equal(
    formatStampDate({ verifiedDate: '2026-11-10', verifiedAt: '2026-11-10T05:05:00.000Z', hash: 'h' }),
    'Nov 9, 2026',
  );
});

// ---- rendered stamp ---------------------------------------------------------------

const listing = {
  id: 'stamp-test-plumbing',
  name: 'Stamp Test Plumbing',
  category: 'plumbers',
  phone: '(555) 555-0199',
  hours: { monday: '8am-5pm' },
  services: ['leak repair'],
  serviceArea: 'Nashville',
  description: 'We fix pipes.',
  city: 'Nashville',
  state: 'TN',
};
const categories = [{ slug: 'plumbers', name: 'Plumbers' }];
const verifiedDate = '2026-11-10';
const verifiedAt = '2026-11-10T05:05:00.000Z';
const hash = hashListing(listing, verifiedDate);

const html = listingDetail(listing, undefined, {
  categories,
  verification: { verifiedDate, verifiedAt, hash },
});
const detailsBlock = /<details class="stamp-details">([\s\S]*?)<\/details>/.exec(html)?.[1];
const titleP = /<p class="stamp-title">([\s\S]*?)<\/p>/.exec(html)?.[1];

test('stamp title shows the Chicago date and sits outside the details block', () => {
  assert.ok(html.includes('Owner-confirmed Nov 9, 2026'));
  assert.equal(titleP, 'Owner-confirmed Nov 9, 2026');
  assert.ok(detailsBlock, 'details block present');
  assert.ok(!detailsBlock.includes('stamp-title'));
  assert.ok(!detailsBlock.includes('Owner-confirmed'));
});

test('hash and verify link are inside details after the summary, not in the title', () => {
  const href = `/api/verify/${listing.id}?hash=${hash}`;
  assert.ok(detailsBlock.startsWith('<summary>Details for AI tools</summary>'));
  assert.ok(detailsBlock.includes(`data-hash="${hash}"`));
  assert.ok(detailsBlock.includes(`href="${href}"`));
  assert.ok(!titleP.includes(hash));
  assert.ok(!titleP.includes('/api/verify/'));
  // Hash and link appear nowhere outside the details block.
  const outside = html.replace(/<details class="stamp-details">[\s\S]*?<\/details>/, '');
  assert.ok(!outside.includes(hash));
  assert.ok(!outside.includes('/api/verify/'));
});

test('tamper check note says it is not proof of ownership', () => {
  assert.match(detailsBlock, /Tamper check:[^<]*This is not proof of ownership\./);
});

test('displayed hash equals hashListing(listing, verifiedDate)', () => {
  assert.equal(/data-hash="([0-9a-f]{64})"/.exec(html)?.[1], hashListing(listing, verifiedDate));
  // The display timestamp does not enter the hash.
  assert.equal(hashListing(listing, verifiedDate), hashListing({ ...listing }, verifiedDate));
});

// ---- HTTP check ---------------------------------------------------------------------

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-stamp-'));
await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify([listing]));
await fs.writeFile(path.join(dir, 'verified.json'), JSON.stringify({ [listing.id]: { verifiedDate, verifiedAt } }));
await fs.writeFile(path.join(dir, 'drafts.json'), '[]');

const app = createApp({
  dataDir: dir,
  seedDir: REPO_DATA,
  rateLimiter: { consume: () => ({ allowed: true }), consumeAll: () => ({ allowed: true }) },
  config: { baseUrl: 'http://example.test' },
});
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});
const base = `http://127.0.0.1:${server.address().port}`;

after(async () => {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('HTTP: page shows the Chicago date while the API and JSON-LD keep verifiedDate', async () => {
  const page = await fetch(`${base}/listings/${listing.id}`);
  assert.equal(page.status, 200);
  const body = await page.text();
  assert.ok(body.includes('Owner-confirmed Nov 9, 2026'));
  assert.equal(/<code data-hash="([0-9a-f]{64})"/.exec(body)?.[1], hashListing(listing, verifiedDate));

  const ld = [];
  const re = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g;
  let m;
  while ((m = re.exec(body)) !== null) ld.push(JSON.parse(m[1]));
  const withDate = ld.find(b => b.dateModified !== undefined);
  assert.ok(withDate, 'JSON-LD with dateModified present');
  assert.equal(withDate.dateModified, '2026-11-10');

  const api = await fetch(`${base}/api/verify/${listing.id}`);
  const json = await api.json();
  assert.equal(json.verifiedDate, '2026-11-10');
  assert.equal(json.hash, hashListing(listing, verifiedDate));
});
