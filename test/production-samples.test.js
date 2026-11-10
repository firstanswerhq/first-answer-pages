/**
 * Tests for "no sample listings in production" and the empty states.
 *
 * In production (config { production: true, demoMode: false }) the store loads
 * no sample (seed) listings, so every public surface behaves as if the
 * directory is empty until an owner listing is approved. In demo mode the
 * samples still show (control).
 *
 * Every app runs on a temporary DATA_DIR holding copies of listings.json and
 * categories.json. The real data/ directory is never written to. fetch is
 * only used against the in-process servers.
 *
 * Property: no sample listing is reachable in production
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createDataStore } from '../server/data.js';
import { escapeHtml } from '../server/lib/html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const BASE_URL = 'https://pages.example.test';

// listings.json[0] is a _comment entry without an id.
const sampleListings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'))
  .filter(l => l && typeof l === 'object' && typeof l.id === 'string');
const SAMPLE_IDS = sampleListings.map(l => l.id);
const SAMPLE_NAMES = sampleListings.map(l => l.name);
const SEED_ID = 'nashville-pipe-pros';
assert.ok(SAMPLE_IDS.includes(SEED_ID), 'fixture: sample id missing from data/listings.json');

const permissiveLimiter = () => ({
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
});

const PRODUCTION = Object.freeze({ production: true, demoMode: false });
const DEMO = Object.freeze({ production: false, demoMode: true });

// ---- environment ------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function makeDataDir(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-prodsamples-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  for (const [name, value] of Object.entries(extra)) {
    await fs.writeFile(path.join(dir, name), JSON.stringify(value));
  }
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function startEnv({ config, files } = {}) {
  const dir = await makeDataDir(files);
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `q-${++n}`,
    rateLimiter: permissiveLimiter(),
    config: { baseUrl: BASE_URL, providerTimeoutMs: 1000, ...config },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });
  return { dir, store: app.locals.ctx.store, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p) => fetch(env.base + p, { redirect: 'manual' });

const postJson = (env, p, body) => fetch(env.base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const postForm = (env, p, params) => fetch(env.base + p, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params).toString(),
});

let rpcId = 0;
async function callTool(env, name, args) {
  const res = await postJson(env, '/mcp', {
    jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.error, undefined, JSON.stringify(json.error));
  return json.result;
}

async function readQuotes(env) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, 'quotes.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const QUOTE = Object.freeze({
  name: 'Pat Jones',
  contact: 'pat@example.com',
  details: 'Kitchen sink is leaking.',
});

// ---- production: store and pages --------------------------------------------

test('production: the store holds no sample listings, even with the sample data present', async () => {
  const env = await startEnv({ config: PRODUCTION });
  assert.deepEqual([...env.store.getListings()], []);
  assert.equal(env.store.findById(SEED_ID), undefined);
  assert.ok(env.store.getCategories().length > 0, 'categories are still loaded');

  // Same result straight from the data store.
  const direct = createDataStore({ dataDir: env.dir, includeSamples: false });
  assert.deepEqual([...direct.getListings()], []);
});

test('production: home page shows the empty state with a link to /rise', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await get(env, '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('No businesses listed yet'));
  assert.ok(html.includes('List your business free'));
  assert.ok(html.includes('href="/rise"'));
  for (const name of SAMPLE_NAMES) assert.ok(!html.includes(name), `sample "${name}" leaked on /`);
});

test('production: a category page says "No plumbers listed yet. Are you one?"', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await get(env, '/?category=plumbers');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('No plumbers listed yet. Are you one?'));
  assert.ok(html.includes('href="/rise"'));
});

test('production: a sample listing page is 404', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await get(env, `/listings/${SEED_ID}`);
  assert.equal(res.status, 404);
  const html = await res.text();
  assert.ok(!html.includes('Nashville Pipe Pros'));
});

test('production: sitemap.xml has no /listings/ URLs but keeps the home URL', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await get(env, '/sitemap.xml');
  assert.equal(res.status, 200);
  const xml = await res.text();
  assert.ok(!xml.includes('/listings/'));
  assert.ok(xml.includes(`<loc>${BASE_URL}/</loc>`));
});

test('production: llms.txt names no sample business and says none are listed', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await get(env, '/llms.txt');
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('No businesses are listed yet.'));
  assert.ok(text.includes('# Total listings: 0'));
  for (const name of SAMPLE_NAMES) assert.ok(!text.includes(name), `sample "${name}" leaked in llms.txt`);
  for (const id of SAMPLE_IDS) assert.ok(!text.includes(`/listings/${id}`), `sample id ${id} leaked in llms.txt`);
});

test('production: /api/listings/:id is 404 for a sample id', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await get(env, `/api/listings/${SEED_ID}`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'Listing not found' });
});

// ---- production: MCP and quotes ---------------------------------------------

test('production: MCP search_listings returns nothing and get_listing errors for a sample id', async () => {
  const env = await startEnv({ config: PRODUCTION });

  const all = await callTool(env, 'search_listings', {});
  assert.notEqual(all.isError, true);
  assert.deepEqual(all.structuredContent, { listings: [], count: 0 });

  const byCategory = await callTool(env, 'search_listings', { category: 'plumbers', query: 'pipe' });
  assert.equal(byCategory.structuredContent.count, 0);

  const one = await callTool(env, 'get_listing', { id: SEED_ID });
  assert.equal(one.isError, true);
  assert.equal(one.content[0].text, 'Listing not found');
});

test('production: POST /api/quotes for a sample id is refused and stores nothing', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await postJson(env, '/api/quotes', { id: SEED_ID, ...QUOTE });
  // The API reports an id that matches no published listing as a 422 on "id"
  // (the HTML form route answers 404, see the next test).
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.argument, 'id');
  assert.equal(body.error, 'id does not match a published listing');
  assert.deepEqual(await readQuotes(env), []);
});

test('production: the quote form post for a sample id is 404 and stores nothing', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await postForm(env, `/listings/${SEED_ID}/quote`, QUOTE);
  assert.equal(res.status, 404);
  assert.deepEqual(await readQuotes(env), []);
});

test('production: MCP request_quote for a sample id is refused and stores nothing', async () => {
  const env = await startEnv({ config: PRODUCTION });
  const res = await postJson(env, '/mcp', {
    jsonrpc: '2.0', id: ++rpcId, method: 'tools/call',
    params: { name: 'request_quote', arguments: { id: SEED_ID, ...QUOTE } },
  });
  const json = await res.json();
  assert.ok(json.error, 'expected a JSON-RPC error');
  assert.equal(json.error.code, -32602);
  assert.deepEqual(await readQuotes(env), []);
});

// ---- production still shows approved owner listings ---------------------------

test('production: an approved owner listing is public while samples stay hidden', async () => {
  const owner = {
    id: 'quillfeather-plumbing',
    name: 'Quillfeather Plumbing',
    category: 'plumbers',
    phone: '(615) 555-0142',
    services: ['Leak repair'],
    serviceArea: 'Greater Springfield',
    description: 'We fix pipes and leaks.',
    city: 'Springfield',
    state: 'TN',
  };
  const env = await startEnv({ config: PRODUCTION, files: { 'published.json': [owner] } });

  assert.deepEqual(env.store.getListings().map(l => l.id), [owner.id]);
  assert.equal((await get(env, `/listings/${owner.id}`)).status, 200);
  assert.equal((await get(env, `/listings/${SEED_ID}`)).status, 404);

  const home = await (await get(env, '/')).text();
  assert.ok(home.includes('Quillfeather Plumbing'));
  assert.ok(!home.includes('No businesses listed yet'));

  const xml = await (await get(env, '/sitemap.xml')).text();
  assert.ok(xml.includes(`${BASE_URL}/listings/${owner.id}`));
  assert.ok(!xml.includes(`/listings/${SEED_ID}`));

  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(llms.includes('Quillfeather Plumbing'));
  assert.ok(!llms.includes('No businesses are listed yet.'));
});

// ---- demo mode (control) -------------------------------------------------------

test('demo mode: all sample listings are still shown everywhere', async () => {
  const env = await startEnv({ config: DEMO });
  assert.equal(env.store.getListings().length, SAMPLE_IDS.length);

  const home = await (await get(env, '/')).text();
  assert.ok(!home.includes('No businesses listed yet'));
  for (const name of SAMPLE_NAMES) assert.ok(home.includes(escapeHtml(name)), `${name} missing on /`);

  assert.equal((await get(env, `/listings/${SEED_ID}`)).status, 200);
  assert.equal((await get(env, `/api/listings/${SEED_ID}`)).status, 200);

  const xml = await (await get(env, '/sitemap.xml')).text();
  for (const id of SAMPLE_IDS) assert.ok(xml.includes(`/listings/${id}`), `${id} missing from sitemap`);

  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(!llms.includes('No businesses are listed yet.'));

  const found = await callTool(env, 'get_listing', { id: SEED_ID });
  assert.notEqual(found.isError, true);
});

// ---- property -------------------------------------------------------------------

test('Property: in production a sample id is 404 on the page and the API, and no quote is accepted', async () => {
  const env = await startEnv({ config: PRODUCTION });
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...SAMPLE_IDS), async id => {
      const page = await get(env, `/listings/${id}`);
      assert.equal(page.status, 404);
      await page.arrayBuffer();

      const api = await get(env, `/api/listings/${id}`);
      assert.equal(api.status, 404);
      await api.arrayBuffer();

      const quote = await postJson(env, '/api/quotes', { id, ...QUOTE });
      assert.equal(quote.status, 422);
      assert.equal((await quote.json()).argument, 'id');

      const form = await postForm(env, `/listings/${id}/quote`, QUOTE);
      assert.equal(form.status, 404);
      await form.arrayBuffer();

      assert.deepEqual(await readQuotes(env), []);
    }),
    { numRuns: 20 },
  );
});
