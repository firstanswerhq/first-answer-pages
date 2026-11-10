/**
 * Tests for the header "List your business free" link, the small
 * unconfirmed-listing note, and the "See what AI says" Séance link.
 *
 * Runs against an in-process server on a temporary DATA_DIR (copies of the
 * seed files plus a generated published.json / verified.json). The real data/
 * directory is never written to.
 *
 * Property: every public listing page links to its own Séance report
 * **Validates: Requirements docs/launch-fixes.md (header link, unconfirmed note, Séance link)**
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const FIXED_NOW = Date.UTC(2025, 0, 15, 12, 0, 0);
const SEED_IDS = ['nashville-pipe-pros', 'honky-tonk-plumbing', 'stone-river-legal'];
const UNCONFIRMED_ID = 'nashville-pipe-pros';
const CONFIRMED_ID = 'confirmed-test-shop';
const ADMIN_TOKEN = 'test-admin-token-17-9';

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const slugArb = fc
  .stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'), { minLength: 1, maxLength: 12 })
  .map(s => `x-${s}`);

const generatedIds = [...new Set(fc.sample(slugArb, 6))];

const publishedListing = id => ({
  id,
  name: `Test Business ${id}`,
  category: 'plumbers',
  phone: '(555) 555-0199',
  hours: { monday: '9am-5pm' },
  services: ['pipe repair'],
  serviceArea: 'Nashville',
  description: 'We fix pipes.',
  city: 'Nashville',
  state: 'TN',
});

// ---- environment ------------------------------------------------------------

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-nav-'));
for (const name of ['listings.json', 'categories.json']) {
  await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
}
await fs.writeFile(
  path.join(dir, 'published.json'),
  JSON.stringify([CONFIRMED_ID, ...generatedIds].map(publishedListing)),
);
// The Séance link shows only for listings with at least one run: give these one each.
const NO_RUNS_ID = 'no-runs-test-shop';
await fs.writeFile(
  path.join(dir, 'published.json'),
  JSON.stringify([CONFIRMED_ID, NO_RUNS_ID, ...generatedIds].map(publishedListing)),
);
await fs.writeFile(
  path.join(dir, 'seance.json'),
  JSON.stringify([...SEED_IDS, CONFIRMED_ID, ...generatedIds].map((listingId, i) => ({
    id: `run-${i}`,
    listingId,
    prompt: 'best plumbers in Nashville',
    provider: 'fake',
    timestamp: '2025-01-01T00:00:00.000Z',
    answer: 'An answer.',
    named: false,
  }))),
);
await fs.writeFile(
  path.join(dir, 'verified.json'),
  JSON.stringify({
    [CONFIRMED_ID]: { verifiedDate: '2025-01-10', verifiedAt: '2025-01-10T12:00:00.000Z' },
  }),
);

const app = createApp({
  dataDir: dir,
  clock: { now: () => FIXED_NOW },
  rateLimiter: permissiveLimiter,
  config: { baseUrl: 'http://example.test', adminToken: ADMIN_TOKEN },
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

// ---- helpers ------------------------------------------------------------------

async function get(url, headers) {
  const res = await fetch(base + url, headers ? { headers } : undefined);
  return { res, html: await res.text() };
}

const HEADER_LINK = /<a class="nav-cta" href="\/rise">List your business free<\/a>/;
const seanceHref = id => `href="/seance/${encodeURIComponent(id)}">See what AI says about this business</a>`;
const unconfirmedAside = html => /<aside class="stamp stamp-unconfirmed">[\s\S]*?<\/aside>/.exec(html)?.[0];

// ---- header link ------------------------------------------------------------------

const pages = [
  ['/', 200],
  [`/listings/${UNCONFIRMED_ID}`, 200],
  ['/rise', 200],
  [`/seance/${UNCONFIRMED_ID}`, 200],
  ['/no-such-page-at-all', 404],
  ['/admin/pending', 200, { Authorization: `Bearer ${ADMIN_TOKEN}` }],
];

for (const [url, status, headers] of pages) {
  test(`header "List your business free" links to /rise on ${url} (${status})`, async () => {
    const { res, html } = await get(url, headers);
    assert.equal(res.status, status);
    assert.match(html, HEADER_LINK);
  });
}

// ---- unconfirmed note --------------------------------------------------------------

test('unconfirmed listing shows the small note and the confirm button', async () => {
  const { res, html } = await get(`/listings/${UNCONFIRMED_ID}`);
  assert.equal(res.status, 200);
  const aside = unconfirmedAside(html);
  assert.ok(aside, 'unconfirmed aside is present');
  assert.match(aside, /<p class="unconfirmed-note">Not yet confirmed by the owner\.<\/p>/);
  assert.match(aside, /<a class="button confirm-cta" href="\/rise">Is this your business\? Confirm it free →<\/a>/);
  assert.doesNotMatch(html, /Owner-confirmed/);
});

test('unconfirmed listing has none of the old big-box markup', async () => {
  const { html } = await get(`/listings/${UNCONFIRMED_ID}`);
  const aside = unconfirmedAside(html);
  assert.ok(aside);
  assert.doesNotMatch(aside, /stamp-title/);
  assert.doesNotMatch(aside, /<h[1-6]/);
});

// ---- confirmed listing ---------------------------------------------------------------

test('confirmed listing shows Owner-confirmed and neither the note nor the button', async () => {
  const { res, html } = await get(`/listings/${CONFIRMED_ID}`);
  assert.equal(res.status, 200);
  assert.match(html, /Owner-confirmed/);
  assert.doesNotMatch(html, /unconfirmed-note/);
  assert.doesNotMatch(html, /Not yet confirmed by the owner/);
  assert.doesNotMatch(html, /Is this your business\?/);
  assert.doesNotMatch(html, /confirm-cta/);
  assert.doesNotMatch(html, /stamp-unconfirmed/);
});

// ---- Séance link -----------------------------------------------------------------------

for (const id of [UNCONFIRMED_ID, CONFIRMED_ID]) {
  test(`"See what AI says about this business" links to /seance/${id} and the target loads`, async () => {
    const { html } = await get(`/listings/${id}`);
    assert.ok(html.includes(seanceHref(id)), 'Séance link present with exact href');
    const target = await get(`/seance/${id}`);
    assert.equal(target.res.status, 200);
  });
}

test('a listing with no Séance runs has no Séance link', async () => {
  const { res, html } = await get(`/listings/${NO_RUNS_ID}`);
  assert.equal(res.status, 200);
  assert.ok(!html.includes('See what AI says about this business'));
  assert.ok(!html.includes('seance-link'));
});

test('Property: every public listing page with runs links to /seance/<its id>', async () => {
  const ids = [...SEED_IDS, CONFIRMED_ID, ...generatedIds];
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...ids), async id => {
      const { res, html } = await get(`/listings/${id}`);
      assert.equal(res.status, 200);
      const hrefs = [...html.matchAll(/<p class="seance-link"><a href="([^"]*)">/g)].map(m => m[1]);
      assert.deepEqual(hrefs, [`/seance/${id}`]);
    }),
    { numRuns: 15 },
  );
});
