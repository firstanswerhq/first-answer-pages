/**
 * Integration tests for Rise from the Grave.
 *
 * Every test builds its own app on a temporary DATA_DIR (copies of the real
 * listings.json and categories.json), a fake clock, a counter for draft ids,
 * and the deterministic mock vision provider. The real data/ directory is
 * never written to.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createDataStore } from '../server/data.js';
import { runSeance } from '../server/lib/seance.js';
import { createMockVisionProvider } from '../server/lib/vision.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FIXTURE_COUNT = 6; // number of fixtures in server/lib/vision.js
const COMPLETE_FIXTURE = 0; // Copper Kettle Plumbing, every field present
const INCOMPLETE_FIXTURE = 3; // Four Corners Auto Repair, no description

const MARKER = Buffer.from('FAP-RISE-TEST-IMAGE-MARKER-9f3a');

const HEADERS = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: Buffer.concat([
    Buffer.from('RIFF', 'latin1'),
    Buffer.from([0x20, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP', 'latin1'),
  ]),
};
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Tiny image of `kind` whose SHA-256 first byte selects fixture `index`. */
function makeImage(kind, index) {
  for (let n = 0; n < 65536; n++) {
    const bytes = Buffer.concat([HEADERS[kind], MARKER, Buffer.from([n >> 8, n & 255])]);
    if (createHash('sha256').update(bytes).digest()[0] % FIXTURE_COUNT === index) return bytes;
  }
  throw new Error('no padding found for fixture ' + index);
}

const completeJpeg = makeImage('jpeg', COMPLETE_FIXTURE);
const incompleteJpeg = makeImage('jpeg', INCOMPLETE_FIXTURE);

const COMPLETE_FIELDS = Object.freeze({
  name: 'Copper Kettle Plumbing',
  category: 'plumbers',
  phone: '(615) 555-0101',
  services: ['Leak repair', 'Water heaters', 'Drain cleaning'],
  serviceArea: 'Greater Springfield',
  description: 'We fix pipes, leaks, and water heaters. Call for same-day service.',
  city: 'Springfield',
  state: 'TN',
  address: '12 Mill Street',
  hours: { monday: '7:00 AM - 5:00 PM', tuesday: '7:00 AM - 5:00 PM' },
});
const COMPLETE_ID = 'copper-kettle-plumbing-springfield';

/** Urlencoded body for the review form. */
function reviewForm(fields) {
  const p = new URLSearchParams();
  for (const key of ['name', 'category', 'phone', 'serviceArea', 'description', 'city', 'state', 'address']) {
    p.set(key, fields[key] ?? '');
  }
  p.set('services', (fields.services ?? []).join('\n'));
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    p.set(`hours_${day}`, fields.hours?.[day] ?? '');
  }
  return p;
}

// ---- environment helpers ----------------------------------------------------

const envs = [];
const TOKEN = 'rise-test-admin-token';
const PENDING_MESSAGE = /We(?:'|&#39;)ll review your listing, usually within one business day\./;

/** POST /admin/pending/:id/approve with the admin bearer token. */
function approve(env, id, token = TOKEN) {
  return fetch(`${env.base}/admin/pending/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    redirect: 'manual',
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * @param {{ files?: Record<string, string>, visionProvider?: object }} [opts]
 */
async function makeEnv({ files = {}, visionProvider } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-rise-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), text);
  }
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  let counter = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `draft-${++counter}`,
    visionProvider: visionProvider ?? createMockVisionProvider(),
    config: { adminToken: TOKEN },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = { dir, clock, server, base: `http://127.0.0.1:${server.address().port}` };
  envs.push(env);
  return env;
}

after(async () => {
  for (const env of envs) {
    env.server.closeAllConnections?.();
    await new Promise(resolve => env.server.close(resolve));
    await fs.rm(env.dir, { recursive: true, force: true });
  }
});

const get = (env, p) => fetch(env.base + p, { redirect: 'manual' });

function postRaw(env, type, body) {
  return fetch(env.base + '/rise', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': type },
    body,
  });
}

function postForm(env, p, params) {
  return fetch(env.base + p, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params instanceof URLSearchParams ? params.toString() : params,
  });
}

const upload = (env, bytes, kind = 'jpeg') => postRaw(env, MIME[kind], bytes);

async function readJson(env, name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Every regular file under dir, as { file, bytes }. */
async function allFiles(dir) {
  const out = [];
  for (const rel of await fs.readdir(dir, { recursive: true })) {
    const full = path.join(dir, rel);
    if ((await fs.stat(full)).isFile()) out.push({ file: rel, bytes: await fs.readFile(full) });
  }
  return out;
}

/** Asserts the unconfirmed draft is invisible on every public route. */
async function assertNotPublic(env, id, name) {
  const home = await (await get(env, '/')).text();
  assert.ok(!home.includes(name), 'draft name must not be on /');
  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(!llms.includes(name) && !llms.includes(`/listings/${id}`), 'draft must not be in /llms.txt');
  const sitemap = await (await get(env, '/sitemap.xml')).text();
  assert.ok(!sitemap.includes(`/listings/${id}`), 'draft must not be in /sitemap.xml');
  assert.equal((await get(env, `/listings/${id}`)).status, 404);
  assert.equal((await get(env, `/api/listings/${id}`)).status, 404);
}

// ---- full flow ----------------------------------------------------------------

test('upload, review, edit, confirm, approve: listing appears on every public route only after approval', async () => {
  const env = await makeEnv();
  const realBefore = await fs.readFile(path.join(REPO_DATA, 'listings.json'));
  const tempBefore = await fs.readFile(path.join(env.dir, 'listings.json'));

  const form = await get(env, '/rise');
  assert.equal(form.status, 200);
  assert.match(await form.text(), /id="rise-form"/);

  await assertNotPublic(env, COMPLETE_ID, 'Copper Kettle');

  const up = await upload(env, completeJpeg);
  assert.equal(up.status, 303);
  assert.equal(up.headers.get('location'), '/rise/drafts/draft-1');

  const review = await get(env, '/rise/drafts/draft-1');
  assert.equal(review.status, 200);
  assert.equal(review.headers.get('cache-control'), 'no-store');
  assert.equal(review.headers.get('x-robots-tag'), 'noindex');
  assert.equal(review.headers.get('referrer-policy'), 'no-referrer');
  const reviewHtml = await review.text();
  assert.ok(reviewHtml.includes('value="Copper Kettle Plumbing"'));
  assert.ok(!reviewHtml.includes('need your input'), 'complete fixture has no missing fields');

  // Still a draft: not public anywhere.
  await assertNotPublic(env, COMPLETE_ID, 'Copper Kettle');

  // Edit the description.
  const newDescription = 'We fix pipes and leaks. Call anytime.';
  const edit = await postForm(env, '/rise/drafts/draft-1',
    reviewForm({ ...COMPLETE_FIELDS, description: newDescription }));
  assert.equal(edit.status, 303);
  assert.equal(edit.headers.get('location'), '/rise/drafts/draft-1?saved=1');
  assert.ok((await (await get(env, '/rise/drafts/draft-1')).text()).includes(newDescription));
  await assertNotPublic(env, COMPLETE_ID, 'Copper Kettle');

  // Confirm: goes to pending, not public.
  const confirm = await postForm(env, '/rise/drafts/draft-1/confirm', '');
  assert.equal(confirm.status, 303);
  assert.equal(confirm.headers.get('location'), '/rise/drafts/draft-1');
  const pendingPage = await get(env, '/rise/drafts/draft-1');
  assert.equal(pendingPage.status, 200);
  assert.match(await pendingPage.text(), PENDING_MESSAGE);
  await assertNotPublic(env, COMPLETE_ID, 'Copper Kettle');
  assert.deepEqual(await readJson(env, 'published.json', []), []);
  assert.equal((await readJson(env, 'drafts.json', []))[0].status, 'pending');

  // Confirming a pending draft again is idempotent: one pending entry.
  const reconfirm = await postForm(env, '/rise/drafts/draft-1/confirm', '');
  assert.equal(reconfirm.status, 303);
  assert.equal(reconfirm.headers.get('location'), '/rise/drafts/draft-1');
  const queue = await readJson(env, 'pending.json', []);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, 'pending');
  await assertNotPublic(env, COMPLETE_ID, 'Copper Kettle');

  // Admin approval publishes.
  const approved = await approve(env, 'draft-1');
  assert.equal(approved.status, 200);
  assert.deepEqual(await approved.json(), { ok: true, listingId: COMPLETE_ID });

  const home = await (await get(env, '/')).text();
  assert.ok(home.includes('Copper Kettle Plumbing'));

  const page = await get(env, `/listings/${COMPLETE_ID}`);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.ok(pageHtml.includes('Copper Kettle Plumbing'));
  assert.ok(pageHtml.includes(newDescription));

  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(llms.includes('### Copper Kettle Plumbing'));
  assert.ok(llms.includes(`/listings/${COMPLETE_ID}`));

  const sitemap = await (await get(env, '/sitemap.xml')).text();
  assert.ok(sitemap.includes(`/listings/${COMPLETE_ID}</loc>`));

  const api = await get(env, `/api/listings/${COMPLETE_ID}`);
  assert.equal(api.status, 200);

  // Storage: published.json and verified.json changed; seed files did not.
  const published = await readJson(env, 'published.json', []);
  assert.equal(published.filter(l => l.id === COMPLETE_ID).length, 1);
  const verified = await readJson(env, 'verified.json', {});
  assert.equal(verified[COMPLETE_ID].verifiedDate, '2025-01-15');
  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts[0].status, 'published');
  assert.equal(drafts[0].listingId, COMPLETE_ID);
  assert.deepEqual(await fs.readFile(path.join(env.dir, 'listings.json')), tempBefore);
  assert.deepEqual(await fs.readFile(path.join(REPO_DATA, 'listings.json')), realBefore);

  assert.equal((await readJson(env, 'pending.json', []))[0].status, 'approved');

  // Confirm again after approval is idempotent: still exactly one listing.
  const again = await postForm(env, '/rise/drafts/draft-1/confirm', '');
  assert.equal(again.status, 303);
  assert.equal((await readJson(env, 'published.json', [])).filter(l => l.id === COMPLETE_ID).length, 1);

  // Approving twice is refused (entry no longer pending).
  assert.equal((await approve(env, 'draft-1')).status, 409);
});

test('PNG and WebP uploads are accepted', async () => {
  const env = await makeEnv();
  const png = await upload(env, makeImage('png', COMPLETE_FIXTURE), 'png');
  assert.equal(png.status, 303);
  const webp = await upload(env, makeImage('webp', COMPLETE_FIXTURE), 'webp');
  assert.equal(webp.status, 303);
  assert.equal(webp.headers.get('location'), '/rise/drafts/draft-2');
});

// ---- no-JS path ---------------------------------------------------------------

test('no-JS form path: base64 field creates a draft', async () => {
  const env = await makeEnv();
  const b64 = completeJpeg.toString('base64');
  const res = await postForm(env, '/rise', new URLSearchParams({ imageBase64: b64 }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/rise/drafts/draft-1');
  assert.ok((await (await get(env, '/rise/drafts/draft-1')).text()).includes('Copper Kettle Plumbing'));

  // A data URL prefix is accepted too.
  const prefixed = await postForm(env, '/rise', new URLSearchParams({
    imageBase64: `data:image/jpeg;base64,${b64}`,
  }));
  assert.equal(prefixed.status, 303);

  // Neither the bytes nor the base64 text were written under the data dir.
  for (const { file, bytes } of await allFiles(env.dir)) {
    assert.ok(!bytes.includes(b64), `base64 image text found in ${file}`);
    assert.ok(!bytes.includes(MARKER), `image marker found in ${file}`);
  }
});

// ---- draft exclusion and field gaps -----------------------------------------

test('confirm with missing fields returns 422, publishes nothing, then succeeds after the fix', async () => {
  const env = await makeEnv();
  const up = await upload(env, incompleteJpeg);
  assert.equal(up.status, 303);

  const review = await (await get(env, '/rise/drafts/draft-1')).text();
  assert.ok(review.includes('class="field missing"'));
  assert.ok(review.includes('Short description'));

  const fixture = {
    name: 'Four Corners Auto Repair',
    category: 'auto-repair',
    phone: '(512) 555-0147',
    services: ['Brakes', 'Oil changes'],
    serviceArea: 'Oakdale County',
    city: 'Oakdale',
    state: 'TX',
  };
  const id = 'four-corners-auto-repair-oakdale';

  const bad = await postForm(env, '/rise/drafts/draft-1/confirm', '');
  assert.equal(bad.status, 422);
  assert.ok((await bad.text()).includes('need your input'));
  await assertNotPublic(env, id, 'Four Corners');
  assert.deepEqual(await readJson(env, 'published.json', []), []);
  assert.equal((await readJson(env, 'drafts.json', []))[0].status, 'draft');
  assert.deepEqual(await readJson(env, 'pending.json', []), []);

  const edit = await postForm(env, '/rise/drafts/draft-1',
    reviewForm({ ...fixture, description: 'Brakes, oil, and engine checks.' }));
  assert.equal(edit.status, 303);
  const ok = await postForm(env, '/rise/drafts/draft-1/confirm', '');
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/rise/drafts/draft-1');
  await assertNotPublic(env, id, 'Four Corners');
  assert.equal((await approve(env, 'draft-1')).status, 200);
  assert.equal((await get(env, `/listings/${id}`)).status, 200);
});

test('discarding an unpublished draft removes it; discarding or editing after confirm or publish returns 409', async () => {
  const env = await makeEnv();
  await upload(env, completeJpeg);
  const discard = await postForm(env, '/rise/drafts/draft-1/discard', '');
  assert.equal(discard.status, 303);
  assert.equal((await get(env, '/rise/drafts/draft-1')).status, 404);

  await upload(env, completeJpeg); // draft-2
  const confirm = await postForm(env, '/rise/drafts/draft-2/confirm', '');
  assert.equal(confirm.status, 303);

  // Pending: discard and edit are refused, listing is not public.
  assert.equal((await postForm(env, '/rise/drafts/draft-2/discard', '')).status, 409);
  assert.equal((await postForm(env, '/rise/drafts/draft-2', reviewForm(COMPLETE_FIELDS))).status, 409);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 404);

  // Published: still refused.
  assert.equal((await approve(env, 'draft-2')).status, 200);
  const late = await postForm(env, '/rise/drafts/draft-2/discard', '');
  assert.equal(late.status, 409);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 200);
  const edit = await postForm(env, '/rise/drafts/draft-2', reviewForm(COMPLETE_FIELDS));
  assert.equal(edit.status, 409);
});

test('admin approve: wrong token is 401, unknown entry is 404, invalid draft is 422', async () => {
  const env = await makeEnv();
  await upload(env, completeJpeg);
  await postForm(env, '/rise/drafts/draft-1/confirm', '');

  assert.equal((await approve(env, 'draft-1', 'wrong')).status, 401);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 404);
  assert.equal((await approve(env, 'no-such-entry')).status, 404);

  // A pending entry whose draft fields are invalid cannot be approved.
  const drafts = await readJson(env, 'drafts.json', []);
  drafts.push({
    id: 'bad-1', status: 'pending', fields: { name: 'No Details Co' }, missingFields: [],
    createdAt: '2025-01-14T00:00:00.000Z',
  });
  await fs.writeFile(path.join(env.dir, 'drafts.json'), JSON.stringify(drafts));
  const queue = await readJson(env, 'pending.json', []);
  queue.push({ id: 'bad-1', draftId: 'bad-1', submittedAt: '2025-01-14T00:00:00.000Z', status: 'pending' });
  await fs.writeFile(path.join(env.dir, 'pending.json'), JSON.stringify(queue));
  const bad = await approve(env, 'bad-1');
  assert.equal(bad.status, 422);
  assert.ok(Array.isArray((await bad.json()).missingFields));
});

test('unknown draft ids return 404 on every draft route', async () => {
  const env = await makeEnv();
  assert.equal((await get(env, '/rise/drafts/nope')).status, 404);
  assert.equal((await postForm(env, '/rise/drafts/nope', reviewForm(COMPLETE_FIELDS))).status, 404);
  assert.equal((await postForm(env, '/rise/drafts/nope/confirm', '')).status, 404);
  assert.equal((await postForm(env, '/rise/drafts/nope/discard', '')).status, 404);
});

// ---- upload rejections ----------------------------------------------------------

test('413 for an image over 5 MiB', async () => {
  const env = await makeEnv();
  const big = Buffer.concat([HEADERS.jpeg, Buffer.alloc(MAX_IMAGE_BYTES + 1 - HEADERS.jpeg.length)]);
  assert.equal(big.length, MAX_IMAGE_BYTES + 1);
  const res = await postRaw(env, 'image/jpeg', big);
  assert.equal(res.status, 413);
  assert.deepEqual(await readJson(env, 'drafts.json', []), []);
});

test('415 for unsupported content types and signature mismatches', async () => {
  const env = await makeEnv();
  assert.equal((await postRaw(env, 'text/plain', 'hello')).status, 415);
  assert.equal((await postRaw(env, 'application/json', '{"a":1}')).status, 415);
  assert.equal((await postRaw(env, 'image/gif', completeJpeg)).status, 415);
  // Declared PNG, JPEG bytes.
  assert.equal((await postRaw(env, 'image/png', completeJpeg)).status, 415);
  // Declared JPEG, not an image at all.
  assert.equal((await postRaw(env, 'image/jpeg', Buffer.from('plain text, not an image'))).status, 415);
  // Form path: valid base64 of non-image bytes.
  const text = Buffer.from('hello world').toString('base64');
  assert.equal((await postForm(env, '/rise', new URLSearchParams({ imageBase64: text }))).status, 415);
  assert.deepEqual(await readJson(env, 'drafts.json', []), []);
});

test('400 for an empty body, bad base64, and a missing or blank field', async () => {
  const env = await makeEnv();
  assert.equal((await postRaw(env, 'image/jpeg', Buffer.alloc(0))).status, 400);
  assert.equal((await postForm(env, '/rise', new URLSearchParams({ imageBase64: 'not*base64!' }))).status, 400);
  assert.equal((await postForm(env, '/rise', new URLSearchParams({ imageBase64: 'abc' }))).status, 400);
  assert.equal((await postForm(env, '/rise', new URLSearchParams({ other: 'x' }))).status, 400);
  assert.equal((await postForm(env, '/rise', new URLSearchParams({ imageBase64: '   ' }))).status, 400);
  assert.deepEqual(await readJson(env, 'drafts.json', []), []);
});

// ---- rate limit -----------------------------------------------------------------

test('429 with Retry-After on the 11th upload in the window; allowed again after it', async () => {
  const env = await makeEnv();
  for (let i = 1; i <= 10; i++) {
    const res = await upload(env, completeJpeg);
    assert.equal(res.status, 303, `upload ${i}`);
  }
  const blocked = await upload(env, completeJpeg);
  assert.equal(blocked.status, 429);
  const retry = blocked.headers.get('retry-after');
  assert.match(retry, /^\d+$/);
  assert.equal(Number(retry), 600); // clock has not moved: full 10-minute window

  env.clock.t += 10 * 60 * 1000 + 1;
  const allowed = await upload(env, completeJpeg);
  assert.equal(allowed.status, 303);
});

// ---- provider failure -----------------------------------------------------------

test('provider failure returns 502 and stores no draft', async () => {
  const failing = {
    name: 'failing',
    async extract() { throw new Error('provider exploded'); },
  };
  const env = await makeEnv({ visionProvider: failing });
  const tempBefore = await fs.readFile(path.join(env.dir, 'listings.json'));

  const res = await upload(env, completeJpeg);
  assert.equal(res.status, 502);
  assert.deepEqual(await readJson(env, 'drafts.json', []), []);
  assert.deepEqual(await fs.readFile(path.join(env.dir, 'listings.json')), tempBefore);
  assert.equal((await get(env, '/rise/drafts/draft-1')).status, 404);
});

// ---- crash resume -----------------------------------------------------------------

function publishingDraft() {
  return {
    id: 'crash-1',
    status: 'publishing',
    fields: { ...COMPLETE_FIELDS, services: [...COMPLETE_FIELDS.services], hours: { ...COMPLETE_FIELDS.hours } },
    missingFields: [],
    createdAt: '2025-01-14T00:00:00.000Z',
    reservedId: COMPLETE_ID,
  };
}

async function assertSingleListing(env) {
  const published = await readJson(env, 'published.json', []);
  assert.equal(published.filter(l => l.id === COMPLETE_ID).length, 1);
  const sitemap = await (await get(env, '/sitemap.xml')).text();
  assert.equal(sitemap.split(`/listings/${COMPLETE_ID}</loc>`).length - 1, 1);
  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts[0].status, 'published');
  assert.equal(drafts[0].listingId, COMPLETE_ID);
  const verified = await readJson(env, 'verified.json', {});
  assert.equal(verified[COMPLETE_ID].verifiedDate, '2025-01-15');
}

/** pending.json entry left behind by a crash during approval. */
function crashPending() {
  return { id: 'crash-1', draftId: 'crash-1', submittedAt: '2025-01-14T00:00:00.000Z', status: 'pending' };
}

test('crash resume: a publishing draft with a reserved id publishes exactly once', async () => {
  const env = await makeEnv({
    files: {
      'drafts.json': JSON.stringify([publishingDraft()]),
      'pending.json': JSON.stringify([crashPending()]),
    },
  });

  // The owner confirm route does not touch a draft that is already publishing.
  const confirm = await postForm(env, '/rise/drafts/crash-1/confirm', '');
  assert.equal(confirm.status, 409);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 404);

  // Re-running the admin approval completes the publish exactly once.
  const first = await approve(env, 'crash-1');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true, listingId: COMPLETE_ID });
  const second = await approve(env, 'crash-1');
  assert.equal(second.status, 409);

  await assertSingleListing(env);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 200);
});

test('crash resume: listing already in published.json is not duplicated', async () => {
  const already = { id: COMPLETE_ID, ...COMPLETE_FIELDS };
  const env = await makeEnv({
    files: {
      'drafts.json': JSON.stringify([publishingDraft()]),
      'published.json': JSON.stringify([already]),
      'pending.json': JSON.stringify([crashPending()]),
    },
  });

  const res = await approve(env, 'crash-1');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, listingId: COMPLETE_ID });

  await assertSingleListing(env);
});

// ---- nothing but JSON text on disk -------------------------------------------------

test('no image bytes are written under the data directory', async () => {
  const env = await makeEnv();
  assert.equal((await upload(env, completeJpeg)).status, 303);
  assert.equal((await upload(env, makeImage('png', COMPLETE_FIXTURE), 'png')).status, 303);
  assert.equal((await upload(env, makeImage('webp', COMPLETE_FIXTURE), 'webp')).status, 303);
  assert.equal((await postForm(env, '/rise/drafts/draft-1/confirm', '')).status, 303);
  assert.equal((await approve(env, 'draft-1')).status, 200);

  const signatures = [HEADERS.jpeg.subarray(0, 3), HEADERS.png.subarray(0, 4), MARKER];
  for (const { file, bytes } of await allFiles(env.dir)) {
    for (const sig of signatures) {
      assert.ok(!bytes.includes(sig), `image bytes found in ${file}`);
    }
  }
});

// ---- provider record and mock-draft blocking ---------------------------------------

const DEMO_BANNER = 'Demo: no photo reader is connected, so this is a sample business, not your photo.';

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

/**
 * Like makeEnv, but with a permissive rate limiter and an explicit production flag.
 * @param {{ production?: boolean, files?: Record<string, string>, visionProvider?: object }} [opts]
 */
async function makeProdEnv({ production = true, files = {}, visionProvider } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-rise-prod-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), text);
  }
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  let counter = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `draft-${++counter}`,
    visionProvider: visionProvider ?? createMockVisionProvider(),
    rateLimiter: permissiveLimiter,
    config: { adminToken: TOKEN, production },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = { dir, clock, server, base: `http://127.0.0.1:${server.address().port}` };
  envs.push(env);
  return env;
}

/** Stub vision provider named 'openai' that returns a complete fixture object. */
function stubOpenAiProvider() {
  return {
    name: 'openai',
    async extract() {
      return structuredClone(COMPLETE_FIELDS);
    },
  };
}

test('a draft from the mock provider records provider "mock"', async () => {
  const env = await makeEnv();
  assert.equal((await upload(env, completeJpeg)).status, 303);
  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].provider, 'mock');
});

test('a draft from a provider named "openai" records provider "openai"', async () => {
  const env = await makeProdEnv({ production: false, visionProvider: stubOpenAiProvider() });
  assert.equal((await upload(env, completeJpeg)).status, 303);
  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].provider, 'openai');
});

test('mock-draft review page shows the demo banner text exactly', async () => {
  const env = await makeEnv();
  assert.equal((await upload(env, completeJpeg)).status, 303);
  const html = await (await get(env, '/rise/drafts/draft-1')).text();
  assert.ok(html.includes(DEMO_BANNER));
});

test('real-provider draft review page shows no demo banner', async () => {
  const env = await makeProdEnv({ production: false, visionProvider: stubOpenAiProvider() });
  assert.equal((await upload(env, completeJpeg)).status, 303);
  const res = await get(env, '/rise/drafts/draft-1');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('value="Copper Kettle Plumbing"'));
  assert.ok(!html.includes('Demo: no photo reader'));
  assert.ok(!html.includes('demo-banner'));
});

test('in production with the mock provider, GET /rise shows only the type-it-in option', async () => {
  const env = await makeProdEnv();
  const res = await get(env, '/rise');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('List your business free'));
  assert.ok(html.includes('action="/rise/manual"'));
  assert.ok(!html.includes('Photo listing is coming soon'));
  assert.ok(!html.includes('id="rise-form"'));
});

test('in production with the mock provider, POST /rise is 503 and stores no draft', async () => {
  const env = await makeProdEnv();
  const res = await upload(env, completeJpeg);
  assert.equal(res.status, 503);
  assert.ok((await res.text()).includes('Photo listing is coming soon'));
  assert.deepEqual(await readJson(env, 'drafts.json', []), []);
});

test('in production a mock draft cannot be confirmed (409) and nothing is queued', async () => {
  const mockDraft = { ...publishingDraft(), id: 'mock-1', status: 'draft', provider: 'mock' };
  const env = await makeProdEnv({ files: { 'drafts.json': JSON.stringify([mockDraft]) } });
  const res = await postForm(env, '/rise/drafts/mock-1/confirm', '');
  assert.equal(res.status, 409);
  assert.equal((await readJson(env, 'drafts.json', []))[0].status, 'draft');
  assert.deepEqual(await readJson(env, 'pending.json', []), []);
});

test('outside production a mock draft can still be confirmed and approved', async () => {
  const env = await makeProdEnv({ production: false });
  assert.equal((await upload(env, completeJpeg)).status, 303);
  assert.equal((await postForm(env, '/rise/drafts/draft-1/confirm', '')).status, 303);
  assert.equal((await approve(env, 'draft-1')).status, 200);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 200);
});

// ---- Seance runs carry the provider -----------------------------------------------

/** Builds a hand-made Seance context on a temp data dir. */
async function makeSeanceCtx(assistantProvider) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-rise-seance-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const store = createDataStore({ dataDir: dir, clock });
  let counter = 0;
  const ctx = {
    store,
    assistantProvider,
    config: { providerTimeoutMs: 1000 },
    clock,
    newId: () => `run-${++counter}`,
  };
  return { ctx, dir, listingId: store.getListings()[0].id };
}

test('a Seance run records the assistant provider name', async () => {
  const { ctx, dir, listingId } = await makeSeanceCtx({ name: 'fake', async ask() { return 'Nobody in particular.'; } });
  try {
    const run = await runSeance(ctx, listingId);
    assert.equal(run.provider, 'fake');
    const stored = await ctx.store.collection('seance').read();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].provider, 'fake');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a Seance run from an unnamed assistant records provider "unknown"', async () => {
  const { ctx, dir, listingId } = await makeSeanceCtx({ async ask() { return 'Nobody in particular.'; } });
  try {
    const run = await runSeance(ctx, listingId);
    assert.equal(run.provider, 'unknown');
    const stored = await ctx.store.collection('seance').read();
    assert.equal(stored[0].provider, 'unknown');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---- property: uploads on a non-production app always record "mock" ----------------------

test('Property: every draft stored from a mock-provider upload records provider "mock"', async () => {
  const env = await makeProdEnv({ production: false });
  const imageArb = fc.record({
    kind: fc.constantFrom('jpeg', 'png', 'webp'),
    tail: fc.uint8Array({ minLength: 0, maxLength: 16 }),
  });

  await fc.assert(
    fc.asyncProperty(imageArb, async ({ kind, tail }) => {
      const before = (await readJson(env, 'drafts.json', [])).length;
      const res = await upload(env, Buffer.concat([HEADERS[kind], Buffer.from(tail)]), kind);
      assert.equal(res.status, 303);
      const drafts = await readJson(env, 'drafts.json', []);
      assert.equal(drafts.length, before + 1);
      assert.equal(drafts[drafts.length - 1].provider, 'mock');
    }),
    { numRuns: 10 },
  );
});

// ---- curl example uses the configured public URL --------------------------------

import { readFileSync } from 'node:fs';

/** Like makeEnv, but with a configured public baseUrl. */
async function makeEnvWithBaseUrl(baseUrl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-rise-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  let counter = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `draft-${++counter}`,
    visionProvider: createMockVisionProvider(),
    config: { adminToken: TOKEN, baseUrl },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = { dir, clock, server, base: `http://127.0.0.1:${server.address().port}` };
  envs.push(env);
  return env;
}

test('GET /rise with a configured baseUrl shows no curl example and no localhost', async () => {
  const env = await makeEnvWithBaseUrl('https://pages.example.test/');
  const res = await get(env, '/rise');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes('curl'));
  assert.ok(!html.includes('localhost'));
});

test('rise-html.js source never hardcodes localhost', () => {
  const src = readFileSync(new URL('../server/lib/rise-html.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('localhost'));
});

test('GET /rise never echoes an unsafe baseUrl', async () => {
  const env = await makeEnvWithBaseUrl('https://x.test/<b>');
  const html = await (await get(env, '/rise')).text();
  assert.ok(!html.includes('<b>'));
});

// ---- /rise page: photo-first upload form -----------------------------------------

test('GET /rise leads with the photo picker and has no Advanced or base64 box', async () => {
  const env = await makeEnv();
  const res = await get(env, '/rise');
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('<h1>List your business free</h1>'));
  assert.ok(!html.includes('Rise from the Grave'));
  assert.ok(html.includes('Take or choose a photo'));
  assert.ok(!html.includes('Advanced'));
  assert.ok(!html.includes('imageBase64'));
  assert.ok(!html.includes('curl'));
  assert.ok(html.includes('Photo upload needs JavaScript. You can still type your listing in below.'));

  assert.ok(html.includes('5 MB'));
  assert.ok(!html.includes('5 MiB'));
  assert.ok(html.includes('a business card, flyer, sign or storefront'));
});

test('GET /rise form still posts urlencoded to /rise and the file input accepts the three image types', async () => {
  const env = await makeEnv();
  const html = await (await get(env, '/rise')).text();

  const form = html.match(/<form[^>]*id="rise-form"[^>]*>/);
  assert.ok(form, 'form with id rise-form');
  assert.ok(form[0].includes('method="POST"'));
  assert.ok(form[0].includes('action="/rise"'));
  assert.ok(form[0].includes('enctype="application/x-www-form-urlencoded"'));

  const file = html.match(/<input[^>]*id="imageFile"[^>]*>/);
  assert.ok(file, 'file input with id imageFile');
  assert.ok(file[0].includes('type="file"'));
  assert.ok(file[0].includes('accept="image/jpeg,image/png,image/webp"'));
});

test('no-JS path: POSTing the form with a valid tiny image in imageBase64 redirects with 303', async () => {
  const env = await makeEnv();
  const res = await postForm(env, '/rise', new URLSearchParams({
    imageBase64: completeJpeg.toString('base64'),
  }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/rise/drafts/draft-1');
});

test('GET /rise loads /js/rise.js as a module script and the script is served', async () => {
  const env = await makeEnv();
  const html = await (await get(env, '/rise')).text();
  assert.ok(html.includes('<script type="module" src="/js/rise.js"></script>'));
  const js = await get(env, '/js/rise.js');
  assert.equal(js.status, 200);
});

test('user-facing size text says MB, never MiB, in rise-html.js and public/js/rise.js', () => {
  for (const rel of ['../server/lib/rise-html.js', '../public/js/rise.js']) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.ok(!src.includes('MiB'), `${rel} must not mention MiB`);
  }
});

// ---- confirm saves submitted edits (task 17.11) ----------------------------------------

import { validateFields } from '../server/lib/listing-fields.js';

const EDITED_DESCRIPTION = 'Edited before confirm.';

test('confirm with an edited body saves the edits, queues the draft, and approval publishes the edited text', async () => {
  const env = await makeEnv();
  assert.equal((await upload(env, completeJpeg)).status, 303);

  const confirm = await postForm(env, '/rise/drafts/draft-1/confirm',
    reviewForm({ ...COMPLETE_FIELDS, description: EDITED_DESCRIPTION }));
  assert.equal(confirm.status, 303);
  assert.equal(confirm.headers.get('location'), '/rise/drafts/draft-1');

  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts[0].status, 'pending');
  assert.equal(drafts[0].fields.description, EDITED_DESCRIPTION);
  assert.equal((await readJson(env, 'pending.json', [])).length, 1);

  const page = await get(env, '/rise/drafts/draft-1');
  assert.equal(page.status, 200);
  assert.match(await page.text(), PENDING_MESSAGE);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 404);

  assert.equal((await approve(env, 'draft-1')).status, 200);
  const published = (await readJson(env, 'published.json', [])).find(l => l.id === COMPLETE_ID);
  assert.equal(published.description, EDITED_DESCRIPTION);
  const listing = await get(env, `/listings/${COMPLETE_ID}`);
  assert.equal(listing.status, 200);
  assert.ok((await listing.text()).includes(EDITED_DESCRIPTION));
});

test('review page is one form with Save changes and Confirm buttons using the right formaction values', async () => {
  const env = await makeEnv();
  assert.equal((await upload(env, completeJpeg)).status, 303);
  const html = await (await get(env, '/rise/drafts/draft-1')).text();

  // The separate discard form is the only other form.
  const editForms = html.match(/<form\b(?![^>]*\bdiscard\b)[^>]*>/g) ?? [];
  assert.equal(editForms.length, 1, 'exactly one edit form');
  const formStart = html.indexOf(editForms[0]);
  const formEnd = html.indexOf('</form>', formStart);
  const formHtml = html.slice(formStart, formEnd);

  const save = formHtml.match(/<button[^>]*formaction="([^"]*)"[^>]*>\s*Save changes\s*<\/button>/);
  const send = formHtml.match(/<button[^>]*formaction="([^"]*)"[^>]*>\s*Confirm and send for review\s*<\/button>/);
  assert.ok(save, 'Save changes button inside the form');
  assert.ok(send, 'Confirm button inside the same form');
  assert.equal(save[1], '/rise/drafts/draft-1');
  assert.equal(send[1], '/rise/drafts/draft-1/confirm');
});

test('confirm with an edit that empties a required field returns 422, queues nothing, and keeps the saved values', async () => {
  const env = await makeEnv();
  assert.equal((await upload(env, completeJpeg)).status, 303);

  const submitted = { ...COMPLETE_FIELDS, description: '' };
  const res = await postForm(env, '/rise/drafts/draft-1/confirm', reviewForm(submitted));
  assert.equal(res.status, 422);
  assert.deepEqual(await readJson(env, 'pending.json', []), []);

  const categories = await readJson(env, 'categories.json', []);
  const expected = JSON.parse(JSON.stringify(validateFields(riseFieldsFromForm(reviewForm(submitted)), categories).fields));
  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts[0].status, 'draft');
  assert.equal(drafts[0].fields.description, '');
  assert.deepEqual(drafts[0].fields, expected);
  assert.equal((await get(env, `/listings/${COMPLETE_ID}`)).status, 404);
});

/** Mirrors fieldsFromForm in server/routes/rise.js for a URLSearchParams body. */
function riseFieldsFromForm(params) {
  const str = key => params.get(key) ?? '';
  const hours = {};
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    hours[day] = str(`hours_${day}`);
  }
  return {
    name: str('name'),
    category: str('category'),
    phone: str('phone'),
    services: str('services').split(/\r?\n/).map(s => s.trim()).filter(s => s !== ''),
    serviceArea: str('serviceArea'),
    description: str('description'),
    city: str('city'),
    state: str('state'),
    address: str('address'),
    ownerEmail: str('ownerEmail'),
    hours,
  };
}

test('Property: stored draft fields after confirm-with-edits equal validateFields of the submitted form', async () => {
  const env = await makeProdEnv({ production: false });
  const categories = await readJson(env, 'categories.json', []);
  const textArb = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 ]{0,30}[A-Za-z0-9]$/);

  await fc.assert(
    fc.asyncProperty(textArb, textArb, textArb, async (name, serviceArea, description) => {
      const before = (await readJson(env, 'drafts.json', [])).length;
      assert.equal((await upload(env, completeJpeg)).status, 303);
      const id = `draft-${before + 1}`;

      const submitted = reviewForm({ ...COMPLETE_FIELDS, name, serviceArea, description });
      const res = await postForm(env, `/rise/drafts/${id}/confirm`, submitted);
      assert.equal(res.status, 303);

      const stored = (await readJson(env, 'drafts.json', [])).find(d => d.id === id);
      const expected = JSON.parse(JSON.stringify(validateFields(riseFieldsFromForm(submitted), categories).fields));
      assert.deepEqual(stored.fields, expected);
    }),
    { numRuns: 10 },
  );
});
