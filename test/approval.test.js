/**
 * Tests for the approval queue.
 *
 * Owner confirmation only queues a listing for review; an admin (bearer token)
 * approves, rejects, or unpublishes. Every test builds its own app on a
 * temporary DATA_DIR (copies of listings.json and categories.json plus seeded
 * drafts.json / pending.json). The real data/ directory is never written to.
 *
 * Property: Only approved listings are public
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { configFromEnv } from '../server/lib/config.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'approval-test-admin-token';
const BASE_URL = 'http://example.test';
const SUBMITTED_AT = '2025-01-14T00:00:00.000Z';

const seedListings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'))
  .filter(l => l && typeof l === 'object' && typeof l.id === 'string');
const SEED_IDS = new Set(seedListings.map(l => l.id));
const SEED_ID = seedListings.find(l => l.id).id;

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

// ---- fixtures -------------------------------------------------------------------

/** Draft `i`: listing id zephyrine-<i> once published. */
function draftEntry(i, { status = 'draft', name } = {}) {
  return {
    id: `d${i}`,
    status,
    fields: {
      name: name ?? `Zephyrine Plumbing ${i}`,
      category: 'plumbers',
      phone: `(615) 555-010${i}`,
      services: ['Leak repair', 'Drain cleaning'],
      serviceArea: 'Greater Springfield',
      description: 'We fix pipes and leaks.',
      city: 'Springfield',
      state: 'TN',
    },
    missingFields: [],
    createdAt: SUBMITTED_AT,
    reservedId: `zephyrine-${i}`,
  };
}

const draftId = i => `d${i}`;
const listingId = i => `zephyrine-${i}`;

function pendingQueueEntry(i) {
  return { id: draftId(i), draftId: draftId(i), submittedAt: SUBMITTED_AT, status: 'pending' };
}

// ---- environment ------------------------------------------------------------------

const envs = new Set();

/**
 * @param {{ drafts?: object[], pending?: object[], adminToken?: string }} [opts]
 *   Pass `adminToken: undefined` explicitly to run with no token configured.
 */
async function makeEnv(opts = {}) {
  const { drafts = [], pending = [] } = opts;
  const adminToken = 'adminToken' in opts ? opts.adminToken : TOKEN;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-approval-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify(drafts));
  await fs.writeFile(path.join(dir, 'pending.json'), JSON.stringify(pending));

  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const app = createApp({
    dataDir: dir,
    clock,
    rateLimiter: permissiveLimiter,
    config: { adminToken, baseUrl: BASE_URL },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = {
    dir,
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    closed: false,
    async close() {
      if (env.closed) return;
      env.closed = true;
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
      envs.delete(env);
    },
  };
  envs.add(env);
  return env;
}

after(async () => {
  for (const env of [...envs]) await env.close();
});

// ---- requests ---------------------------------------------------------------------

const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });

const bearer = token => (token === undefined ? {} : { authorization: `Bearer ${token}` });

const adminPost = (env, p, token = TOKEN) =>
  fetch(env.base + p, { method: 'POST', redirect: 'manual', headers: bearer(token) });

const approve = (env, i, token) => adminPost(env, `/admin/pending/${draftId(i)}/approve`, token);
const reject = (env, i, token) => adminPost(env, `/admin/pending/${draftId(i)}/reject`, token);
const unpublish = (env, id, token) => adminPost(env, `/admin/listings/${encodeURIComponent(id)}/unpublish`, token);

const confirm = (env, i) =>
  fetch(`${env.base}/rise/drafts/${draftId(i)}/confirm`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: '',
  });

let rpcId = 0;
async function callTool(env, name, args) {
  const res = await fetch(env.base + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args },
    }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.error, undefined, JSON.stringify(json.error));
  return json.result;
}

async function readJson(env, name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// ---- surface checks ------------------------------------------------------------------

/** Listing ids named in the sitemap, minus the seed listings. */
async function sitemapIds(env) {
  const xml = await (await get(env, '/sitemap.xml')).text();
  return [...xml.matchAll(/\/listings\/([^<\s]+)<\/loc>/g)].map(m => m[1]).filter(id => !SEED_IDS.has(id));
}

/** Listing ids named in llms.txt, minus the seed listings. */
async function llmsIds(env) {
  const text = await (await get(env, '/llms.txt')).text();
  return [...text.matchAll(/^Page: .*\/listings\/(\S+)$/gm)].map(m => m[1]).filter(id => !SEED_IDS.has(id));
}

/** Ids returned by the MCP search for the test name token. */
async function mcpIds(env) {
  const result = await callTool(env, 'search_listings', { query: 'zephyrine' });
  assert.notEqual(result.isError, true);
  return result.structuredContent.listings.map(l => l.id);
}

/** Asserts the listing is invisible on every public surface. */
async function assertHidden(env, i) {
  const id = listingId(i);
  const name = `Zephyrine Plumbing ${i}`;

  const home = await (await get(env, '/')).text();
  assert.ok(!home.includes(name), `${name} must not be on /`);
  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(!llms.includes(name) && !llms.includes(`/listings/${id}`), 'must not be in /llms.txt');
  const sitemap = await (await get(env, '/sitemap.xml')).text();
  assert.ok(!sitemap.includes(`/listings/${id}`), 'must not be in /sitemap.xml');

  const page = await get(env, `/listings/${id}`);
  assert.equal(page.status, 404);
  const pageHtml = await page.text();
  assert.ok(!pageHtml.includes('application/ld+json'), 'no JSON-LD for a hidden listing');
  assert.ok(!pageHtml.includes(name));
  assert.equal((await get(env, `/api/listings/${id}`)).status, 404);

  assert.ok(!(await mcpIds(env)).includes(id), 'must not be in MCP search_listings');
  const one = await callTool(env, 'get_listing', { id });
  assert.equal(one.isError, true, 'MCP get_listing must report not found');
}

/** Asserts the listing is public everywhere and carries the Owner-confirmed stamp. */
async function assertVisible(env, i) {
  const id = listingId(i);
  const name = `Zephyrine Plumbing ${i}`;

  assert.ok((await (await get(env, '/')).text()).includes(name));
  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(llms.includes(`### ${name}`) && llms.includes(`/listings/${id}`));
  assert.ok((await (await get(env, '/sitemap.xml')).text()).includes(`/listings/${id}</loc>`));

  const page = await get(env, `/listings/${id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(name));
  assert.ok(html.includes('application/ld+json'));
  assert.ok(html.includes('Owner-confirmed'), 'page shows the Owner-confirmed stamp');
  assert.equal((await get(env, `/api/listings/${id}`)).status, 200);

  assert.ok((await mcpIds(env)).includes(id));
  const one = await callTool(env, 'get_listing', { id });
  assert.notEqual(one.isError, true);
  assert.equal(one.structuredContent.listing.id, id);
  assert.equal(one.structuredContent.verification.verified, true);
}

// ---- examples ----------------------------------------------------------------------------

test('confirm queues the listing for review and leaves it off every public surface', async () => {
  const env = await makeEnv({ drafts: [draftEntry(1)] });
  await assertHidden(env, 1);

  const res = await confirm(env, 1);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/rise/drafts/d1');

  assert.equal((await readJson(env, 'drafts.json', []))[0].status, 'pending');
  const queue = await readJson(env, 'pending.json', []);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, 'pending');
  assert.deepEqual(await readJson(env, 'published.json', []), []);
  await assertHidden(env, 1);

  // Confirming again is idempotent: still one queue entry.
  assert.equal((await confirm(env, 1)).status, 303);
  assert.equal((await readJson(env, 'pending.json', [])).length, 1);
  await assertHidden(env, 1);
});

test('GET /admin/pending lists pending entries and escapes their values', async () => {
  const dangerous = '<b id="x">Evil</b> & Sons';
  const env = await makeEnv({
    drafts: [draftEntry(1, { status: 'pending', name: dangerous }), draftEntry(2, { status: 'rejected' })],
    pending: [pendingQueueEntry(1), { ...pendingQueueEntry(2), status: 'rejected' }],
  });

  const res = await get(env, '/admin/pending', bearer(TOKEN));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  const html = await res.text();

  assert.ok(html.includes('&lt;b id=&quot;x&quot;&gt;Evil&lt;/b&gt; &amp; Sons'), 'name is HTML-escaped');
  assert.ok(!html.includes('<b id="x">'), 'raw markup must not appear');
  assert.ok(html.includes('/admin/pending/d1/approve'));
  assert.ok(!html.includes('Zephyrine Plumbing 2'), 'rejected entries are not listed');
});

test('GET /admin/pending says so when nothing is waiting', async () => {
  const env = await makeEnv();
  const res = await get(env, '/admin/pending', bearer(TOKEN));
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Nothing is waiting for review/);
});

test('approve publishes the listing everywhere and writes the Owner-confirmed stamp', async () => {
  const env = await makeEnv({ drafts: [draftEntry(1)] });
  assert.equal((await confirm(env, 1)).status, 303);
  await assertHidden(env, 1);

  const res = await approve(env, 1);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, listingId: listingId(1) });

  await assertVisible(env, 1);
  assert.equal((await readJson(env, 'verified.json', {}))[listingId(1)], '2025-01-15');
  const published = await readJson(env, 'published.json', []);
  assert.deepEqual(published.map(l => l.id), [listingId(1)]);
  assert.equal((await readJson(env, 'pending.json', []))[0].status, 'approved');
  assert.equal((await readJson(env, 'drafts.json', []))[0].status, 'published');
});

test('a second approve is refused with 409 and the listing exists exactly once', async () => {
  const env = await makeEnv({ drafts: [draftEntry(1)] });
  await confirm(env, 1);
  assert.equal((await approve(env, 1)).status, 200);
  assert.equal((await approve(env, 1)).status, 409);

  const published = await readJson(env, 'published.json', []);
  assert.equal(published.filter(l => l.id === listingId(1)).length, 1);
  assert.deepEqual(await sitemapIds(env), [listingId(1)]);
});

test('approve and reject of an unknown entry return 404', async () => {
  const env = await makeEnv();
  assert.equal((await adminPost(env, '/admin/pending/nope/approve')).status, 404);
  assert.equal((await adminPost(env, '/admin/pending/nope/reject')).status, 404);
  assert.equal((await unpublish(env, 'nope')).status, 404);
});

test('reject keeps the listing off every surface and marks the draft rejected', async () => {
  const env = await makeEnv({ drafts: [draftEntry(1)] });
  await confirm(env, 1);

  const res = await reject(env, 1);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  assert.equal((await readJson(env, 'drafts.json', []))[0].status, 'rejected');
  assert.equal((await readJson(env, 'pending.json', []))[0].status, 'rejected');
  assert.deepEqual(await readJson(env, 'published.json', []), []);
  await assertHidden(env, 1);

  // A rejected entry cannot be approved, rejected again, or re-confirmed.
  assert.equal((await approve(env, 1)).status, 409);
  assert.equal((await reject(env, 1)).status, 409);
  assert.equal((await confirm(env, 1)).status, 409);
  await assertHidden(env, 1);
});

test('unpublish removes an approved listing from every surface', async () => {
  const env = await makeEnv({ drafts: [draftEntry(1)] });
  await confirm(env, 1);
  await approve(env, 1);
  await assertVisible(env, 1);

  const res = await unpublish(env, listingId(1));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  await assertHidden(env, 1);
  assert.deepEqual(await readJson(env, 'published.json', []), []);
  assert.equal((await readJson(env, 'pending.json', []))[0].status, 'unpublished');

  // Gone: a second unpublish finds nothing, and the entry cannot be approved again.
  assert.equal((await unpublish(env, listingId(1))).status, 404);
  assert.equal((await approve(env, 1)).status, 409);
});

test('unpublish of a seed listing is 409 and the listing stays public', async () => {
  const env = await makeEnv();
  const res = await unpublish(env, SEED_ID);
  assert.equal(res.status, 409);
  assert.equal((await get(env, `/listings/${SEED_ID}`)).status, 200);
  assert.equal((await get(env, `/api/listings/${SEED_ID}`)).status, 200);
});

// ---- authentication ------------------------------------------------------------------------

test('401 with WWW-Authenticate for a missing or wrong token, and nothing changes', async () => {
  const env = await makeEnv({ drafts: [draftEntry(1, { status: 'pending' }), draftEntry(2)], pending: [pendingQueueEntry(1)] });

  const attempts = [
    token => get(env, '/admin/pending', bearer(token)),
    token => approve(env, 1, token),
    token => reject(env, 1, token),
    token => unpublish(env, SEED_ID, token),
  ];
  for (const attempt of attempts) {
    for (const token of [undefined, 'wrong-token']) {
      const res = await attempt(token);
      assert.equal(res.status, 401);
      assert.equal(res.headers.get('www-authenticate'), 'Bearer');
    }
  }

  // The token must be a Bearer credential; other schemes do not count.
  const basic = await get(env, '/admin/pending', { authorization: `Basic ${TOKEN}` });
  assert.equal(basic.status, 401);

  assert.equal((await readJson(env, 'pending.json', []))[0].status, 'pending');
  assert.deepEqual(await readJson(env, 'published.json', []), []);
  await assertHidden(env, 1);
});

test('403 on every admin route when no token is configured', async () => {
  const env = await makeEnv({ adminToken: undefined, drafts: [draftEntry(1, { status: 'pending' })], pending: [pendingQueueEntry(1)] });

  for (const token of [undefined, TOKEN]) {
    assert.equal((await get(env, '/admin/pending', bearer(token))).status, 403);
    assert.equal((await approve(env, 1, token)).status, 403);
    assert.equal((await reject(env, 1, token)).status, 403);
    assert.equal((await unpublish(env, SEED_ID, token)).status, 403);
  }
  assert.equal((await readJson(env, 'pending.json', []))[0].status, 'pending');
  await assertHidden(env, 1);
});

test('the admin token comes from ADMIN_TOKEN, falling back to SEANCE_ADMIN_TOKEN', () => {
  assert.equal(configFromEnv({ ADMIN_TOKEN: 'a' }).adminToken, 'a');
  assert.equal(configFromEnv({ SEANCE_ADMIN_TOKEN: 'b' }).adminToken, 'b');
  assert.equal(configFromEnv({ ADMIN_TOKEN: 'a', SEANCE_ADMIN_TOKEN: 'b' }).adminToken, 'a');
  assert.equal(configFromEnv({}).adminToken, undefined);
});

// ---- property: only approved listings are public ----------------------------------------------

/**
 * Model of one entry's state:
 *   draft -> pending (confirm) -> approved (approve) | rejected (reject)
 *   approved -> unpublished (unpublish)
 * Returns the HTTP status the operation must give and the state afterwards.
 */
function step(state, op) {
  switch (op) {
    case 'confirm':
      if (state === 'draft' || state === 'pending') return { status: 303, next: 'pending' };
      if (state === 'approved') return { status: 303, next: 'approved' };
      return { status: 409, next: state }; // rejected or unpublished
    case 'approve':
      if (state === 'pending') return { status: 200, next: 'approved' };
      if (state === 'draft') return { status: 404, next: state }; // not in the queue
      return { status: 409, next: state };
    case 'reject':
      if (state === 'pending') return { status: 200, next: 'rejected' };
      if (state === 'draft') return { status: 404, next: state };
      return { status: 409, next: state };
    case 'unpublish':
      if (state === 'approved') return { status: 200, next: 'unpublished' };
      return { status: 404, next: state }; // nothing published under that id
    default:
      throw new Error(`unknown op ${op}`);
  }
}

function runOp(env, op, i) {
  switch (op) {
    case 'confirm': return confirm(env, i);
    case 'approve': return approve(env, i);
    case 'reject': return reject(env, i);
    case 'unpublish': return unpublish(env, listingId(i));
    default: throw new Error(`unknown op ${op}`);
  }
}

test('Property: only approved listings are public (sitemap, llms.txt, MCP search)', async () => {
  const opArb = fc.record({
    op: fc.constantFrom('confirm', 'approve', 'reject', 'unpublish'),
    idx: fc.integer({ min: 0, max: 2 }),
  });
  const startArb = fc.array(fc.constantFrom('draft', 'pending'), { minLength: 3, maxLength: 3 });

  await fc.assert(
    fc.asyncProperty(startArb, fc.array(opArb, { minLength: 1, maxLength: 10 }), async (start, ops) => {
      const env = await makeEnv({
        drafts: start.map((status, i) => draftEntry(i, { status })),
        pending: start.flatMap((status, i) => (status === 'pending' ? [pendingQueueEntry(i)] : [])),
      });
      try {
        const model = [...start];
        const expectPublic = async () => {
          const expected = model.flatMap((s, i) => (s === 'approved' ? [listingId(i)] : [])).sort();
          assert.deepEqual((await sitemapIds(env)).sort(), expected, 'sitemap ids');
          assert.deepEqual((await llmsIds(env)).sort(), expected, 'llms.txt ids');
          assert.deepEqual((await mcpIds(env)).sort(), expected, 'MCP search ids');
        };

        await expectPublic();
        for (const { op, idx } of ops) {
          const { status, next } = step(model[idx], op);
          const res = await runOp(env, op, idx);
          assert.equal(res.status, status, `${op} on ${idx} while ${model[idx]}`);
          model[idx] = next;
          await expectPublic();
        }
      } finally {
        await env.close();
      }
    }),
    { numRuns: 15 },
  );
});
