/**
 * Tests for the owner-confirmed stamp, JSON-LD fields and GET /api/verify/:id.
 *
 * Runs against an in-process server on a temporary DATA_DIR (copies of
 * listings.json and categories.json plus generated drafts). The real data/
 * directory is never written to. The hash is a tamper check, never proof of
 * ownership.
 *
 * Property 6: Stamp hash verifies until the listing changes
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.11, 10.12**
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
const UNCONFIRMED_ID = 'nashville-pipe-pros'; // seed listing, no verified.json entry

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
};

// ---- environment ------------------------------------------------------------

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-verify-'));
for (const name of ['listings.json', 'categories.json']) {
  await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
}
await fs.writeFile(path.join(dir, 'drafts.json'), '[]');

const app = createApp({
  dataDir: dir,
  clock: { now: () => FIXED_NOW },
  rateLimiter: permissiveLimiter,
  config: { baseUrl: 'http://example.test' },
});
const store = app.locals.ctx.store;
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

let draftCounter = 0;

/** Seeds a draft with the given fields and publishes it. Returns the listing. */
async function publish(fields) {
  const draftId = `draft-${++draftCounter}`;
  const file = path.join(dir, 'drafts.json');
  const drafts = JSON.parse(await fs.readFile(file, 'utf8'));
  drafts.push({ id: draftId, status: 'draft', fields });
  await fs.writeFile(file, JSON.stringify(drafts));
  const result = await store.publishDraft(draftId);
  assert.equal(result.status, 200, JSON.stringify(result));
  return result.listing;
}

const getPage = async id => {
  const res = await fetch(`${base}/listings/${id}`);
  return { res, html: await res.text() };
};

const getJson = async url => {
  const res = await fetch(base + url);
  return { res, json: await res.json() };
};

const stampHash = html => /<code data-hash="([0-9a-f]{64})"/.exec(html)?.[1];
const stampBlock = html => /<aside class="stamp[^"]*">[\s\S]*?<\/aside>/.exec(html)?.[0];

function ldBlocks(html) {
  const out = [];
  const re = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(JSON.parse(m[1]));
  return out;
}

// ---- generators -----------------------------------------------------------------

// Text with no leading/trailing whitespace so normalization leaves it unchanged.
const text = fc
  .stringOf(fc.constantFrom(...'abcdefg HIJKL12'), { minLength: 0, maxLength: 20 })
  .map(s => `X${s.trim()}y`);

const phone = fc
  .tuple(fc.integer({ min: 200, max: 999 }), fc.integer({ min: 200, max: 999 }), fc.integer({ min: 1000, max: 9999 }))
  .map(([a, b, c]) => `(${a}) ${b}-${c}`);

const categorySlugs = store.getCategories().map(c => c.slug);

const validFields = fc.record({
  name: text,
  category: fc.constantFrom(...categorySlugs),
  phone,
  services: fc.array(text, { minLength: 1, maxLength: 4 }),
  serviceArea: text,
  description: text,
  city: text,
  state: fc.constantFrom('TN', 'KY', 'GA', 'AL'),
  hours: fc.constantFrom({}, { monday: '9:00 AM - 5:00 PM' }),
});

const editableField = fc.constantFrom('name', 'description', 'city', 'serviceArea');

// ---- Property 6 ------------------------------------------------------------------

test('Property 6: stamp hash verifies until the listing changes', async () => {
  await fc.assert(
    fc.asyncProperty(validFields, editableField, async (fields, field) => {
      const listing = await publish(fields);
      const id = listing.id;

      const { res, html } = await getPage(id);
      assert.equal(res.status, 200);
      const hash = stampHash(html);
      assert.match(hash, /^[0-9a-f]{64}$/);

      const q = h => `/api/verify/${id}?hash=${encodeURIComponent(h)}`;
      for (const supplied of [hash, hash.toUpperCase(), `  ${hash}\t `]) {
        const { json } = await getJson(q(supplied));
        assert.equal(json.match, true);
        assert.equal(json.verified, true);
        assert.equal(json.hash, hash);
      }

      await store.updatePublished(id, { [field]: `${listing[field]}Q` });

      const after = await getJson(q(hash));
      assert.equal(after.json.match, false);
      assert.notEqual(after.json.hash, hash);

      // The re-rendered stamp carries the new hash, and that one matches.
      const fresh = stampHash((await getPage(id)).html);
      assert.equal(fresh, after.json.hash);
      assert.equal((await getJson(q(fresh))).json.match, true);
    }),
    { numRuns: 20 },
  );
});

// ---- examples: confirmed listing ---------------------------------------------------

const sampleFields = {
  name: 'Example Pipe Works',
  category: 'plumbers',
  phone: '(615) 555-0142',
  services: ['Drain cleaning'],
  serviceArea: 'Nashville',
  description: 'We fix pipes.',
  city: 'Nashville',
  state: 'TN',
  hours: {},
};

test('confirmed listing page shows the stamp and JSON-LD identifier and dateModified', async () => {
  const listing = await publish(sampleFields);
  const { html } = await getPage(listing.id);

  const stamp = stampBlock(html);
  assert.ok(stamp, 'stamp present');
  assert.ok(stamp.includes('Owner-confirmed 2025-01-15'));
  assert.ok(!/verified/i.test(stamp), 'no "Verified" wording in the stamp markup');

  const hash = stampHash(html);
  const blocks = ldBlocks(html);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].identifier, hash);
  assert.equal(blocks[0].dateModified, '2025-01-15');
});

test('GET /api/verify/:id for a confirmed listing without hash returns match null and the hash', async () => {
  const listing = await publish(sampleFields);
  const { res, json } = await getJson(`/api/verify/${listing.id}`);
  assert.equal(res.status, 200);
  assert.equal(json.id, listing.id);
  assert.equal(json.verified, true);
  assert.equal(json.verifiedDate, '2025-01-15');
  assert.match(json.hash, /^[0-9a-f]{64}$/);
  assert.equal(json.match, null);
});

test('a wrong hash and a repeated hash parameter are non-matches', async () => {
  const listing = await publish(sampleFields);
  const { json: current } = await getJson(`/api/verify/${listing.id}`);

  const wrong = await getJson(`/api/verify/${listing.id}?hash=${'0'.repeat(64)}`);
  assert.equal(wrong.json.match, false);

  const repeated = await getJson(`/api/verify/${listing.id}?hash=${current.hash}&hash=${current.hash}`);
  assert.equal(repeated.json.match, false);
  assert.equal(repeated.json.hash, current.hash);
});

test('/api/listings/:id adds verifiedDate and verificationHash for confirmed listings only', async () => {
  const listing = await publish(sampleFields);
  const { res, json } = await getJson(`/api/listings/${listing.id}`);
  assert.equal(res.status, 200);
  assert.equal(json.verifiedDate, '2025-01-15');
  const verify = (await getJson(`/api/verify/${listing.id}`)).json;
  assert.equal(json.verificationHash, verify.hash);

  const { verifiedDate, verificationHash, ...rest } = json;
  assert.deepEqual(rest, JSON.parse(JSON.stringify(store.findById(listing.id))));

  const seed = await getJson(`/api/listings/${UNCONFIRMED_ID}`);
  assert.deepEqual(seed.json, JSON.parse(JSON.stringify(store.findById(UNCONFIRMED_ID))));
  assert.ok(!('verifiedDate' in seed.json));
  assert.ok(!('verificationHash' in seed.json));
});

// ---- examples: unconfirmed listing ---------------------------------------------------

test('unconfirmed listing page says so and has no identifier or dateModified', async () => {
  const { res, html } = await getPage(UNCONFIRMED_ID);
  assert.equal(res.status, 200);

  const stamp = stampBlock(html);
  assert.ok(stamp, 'unconfirmed notice present');
  assert.ok(stamp.includes('Not yet confirmed by the owner'));
  assert.ok(!stamp.includes('Owner-confirmed'));
  assert.ok(!/verified/i.test(stamp));
  assert.equal(stampHash(html), undefined);

  const blocks = ldBlocks(html);
  assert.equal(blocks.length, 1, 'exactly one ld+json block');
  assert.ok(!('identifier' in blocks[0]));
  assert.ok(!('dateModified' in blocks[0]));
});

test('GET /api/verify/:id for an unconfirmed listing', async () => {
  const none = await getJson(`/api/verify/${UNCONFIRMED_ID}`);
  assert.equal(none.res.status, 200);
  assert.deepEqual(none.json, {
    id: UNCONFIRMED_ID, verified: false, verifiedDate: null, hash: null, match: null,
  });

  const withHash = await getJson(`/api/verify/${UNCONFIRMED_ID}?hash=${'a'.repeat(64)}`);
  assert.equal(withHash.json.verified, false);
  assert.equal(withHash.json.hash, null);
  assert.equal(withHash.json.match, false);
});

test('GET /api/verify/:id for an unknown id is 404 with an error', async () => {
  const { res, json } = await getJson('/api/verify/no-such-listing?hash=abc');
  assert.equal(res.status, 404);
  assert.equal(typeof json.error, 'string');
  assert.ok(json.error.length > 0);
});
