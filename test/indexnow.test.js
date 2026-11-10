/**
 * Tests for IndexNow (task 22): the Bing ping on approve and unpublish.
 *
 * Every network call goes to a stubbed fetch; nothing leaves the machine.
 * Each app runs on its own temporary DATA_DIR.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import {
  createIndexNow, indexNowOffReason, indexNowNote, newIndexNowKey, INDEXNOW_ENDPOINT, INDEXNOW_KEY_FILE,
} from '../server/lib/indexnow.js';
import { configFromEnv } from '../server/lib/config.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'indexnow-test-admin-token';
const LIVE = 'https://pages.example.com';
const KEY_RE = /^[a-z0-9]{32}$/;

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const dirs = [];
async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-indexnow-'));
  dirs.push(dir);
  return dir;
}

const servers = [];
after(async () => {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise(resolve => s.close(resolve));
  }
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
});

/** A fetch stub that records calls and answers with `status` (or runs `impl`). */
function stubFetch({ status = 200, impl } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (impl) return impl(url, init);
    return new Response('', { status });
  };
  fn.calls = calls;
  return fn;
}

const liveConfig = (extra = {}) => ({
  production: true, demoMode: false, baseUrl: LIVE, testRun: true, indexNow: 'on', ...extra,
});

function draft(i, provider = 'anthropic') {
  return {
    id: `d${i}`,
    status: 'pending',
    provider,
    fields: {
      name: `Zephyrine Plumbing ${i}`,
      category: 'plumbers',
      phone: `(615) 555-010${i}`,
      services: ['Leak repair'],
      serviceArea: 'Springfield',
      description: 'We fix pipes.',
      city: 'Springfield',
      state: 'TN',
    },
    missingFields: [],
    createdAt: '2026-11-10T12:00:00.000Z',
    reservedId: `zephyrine-${i}`,
  };
}

async function startApp({ config = {}, fetch, drafts = [draft(1)] } = {}) {
  const dir = await tempDir();
  await fs.copyFile(path.join(REPO_DATA, 'categories.json'), path.join(dir, 'categories.json'));
  await fs.writeFile(path.join(dir, 'listings.json'), '[]');
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify(drafts));
  await fs.writeFile(path.join(dir, 'pending.json'), JSON.stringify(
    drafts.map(d => ({ id: d.id, draftId: d.id, submittedAt: d.createdAt, status: 'pending' })),
  ));
  const app = createApp({
    dataDir: dir,
    clock: { now: () => Date.UTC(2026, 10, 10, 20, 0, 0) },
    rateLimiter: permissiveLimiter,
    config: { adminToken: TOKEN, ...liveConfig(), ...config },
    ...(fetch ? { indexNowFetch: fetch } : {}),
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { app, dir, base: `http://127.0.0.1:${server.address().port}`, ctx: app.locals.ctx };
}

const admin = { authorization: `Bearer ${TOKEN}` };
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

// ---- who gets to send -------------------------------------------------------------

test('only a real live site may send', () => {
  assert.equal(indexNowOffReason(liveConfig({ testRun: false })), '');
  assert.equal(indexNowOffReason(liveConfig(), { hasStubFetch: true }), '');
  assert.equal(indexNowOffReason(liveConfig()), 'test run');
  assert.equal(indexNowOffReason(liveConfig({ production: false, testRun: false })), 'only on the live site');
  assert.equal(indexNowOffReason(liveConfig({ demoMode: true, testRun: false })), 'demo mode is on');
  assert.equal(indexNowOffReason(liveConfig({ indexNow: 'off', testRun: false })), 'turned off');
  for (const baseUrl of ['http://pages.example.com', 'https://localhost:3000', 'https://127.0.0.1', 'https://site.test', 'https://a.localhost']) {
    assert.notEqual(indexNowOffReason(liveConfig({ baseUrl, testRun: false })), '', baseUrl);
  }
  assert.equal(indexNowOffReason(liveConfig({ baseUrl: 'not a url', testRun: false })), 'BASE_URL is not set');
});

test('INDEXNOW=off is read from the environment', () => {
  assert.equal(configFromEnv({ INDEXNOW: 'off' }, { warn: () => {} }).indexNow, 'off');
  assert.equal(configFromEnv({ INDEXNOW: 'OFF' }, { warn: () => {} }).indexNow, 'off');
  assert.equal(configFromEnv({}, { warn: () => {} }).indexNow, 'on');
});

// ---- the key ----------------------------------------------------------------------

test('the key is 32 characters of a-z0-9, saved in DATA_DIR and stable across restarts', async () => {
  for (let i = 0; i < 50; i++) assert.match(newIndexNowKey(), KEY_RE);
  const dir = await tempDir();
  const a = createIndexNow({ baseUrl: LIVE, dataDir: dir, enabled: true, fetch: stubFetch() });
  assert.match(a.key, KEY_RE);
  assert.equal((await fs.readFile(path.join(dir, INDEXNOW_KEY_FILE), 'utf8')).trim(), a.key);
  const b = createIndexNow({ baseUrl: LIVE, dataDir: dir, enabled: true, fetch: stubFetch() });
  assert.equal(b.key, a.key);
});

test('when off there is no key and nothing is written', async () => {
  const dir = await tempDir();
  const n = createIndexNow({ baseUrl: LIVE, dataDir: dir, enabled: false, reason: 'demo mode is on' });
  assert.equal(n.enabled, false);
  assert.equal(n.key, '');
  assert.equal(n.reason, 'demo mode is on');
  await assert.rejects(fs.access(path.join(dir, INDEXNOW_KEY_FILE)));
});

// ---- the request ------------------------------------------------------------------

test('submit sends exactly the IndexNow request', async () => {
  const fetch = stubFetch({ status: 202 });
  const n = createIndexNow({ baseUrl: `${LIVE}/`, dataDir: await tempDir(), enabled: true, fetch });
  const entry = await n.submit([`${LIVE}/listings/a`, `${LIVE}/llms.txt`, `${LIVE}/listings/a`], 'a');
  assert.equal(fetch.calls.length, 1);
  const { url, init, body } = fetch.calls[0];
  assert.equal(url, INDEXNOW_ENDPOINT);
  assert.equal(url, 'https://api.indexnow.org/indexnow');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(Object.keys(body).sort(), ['host', 'key', 'keyLocation', 'urlList']);
  assert.equal(body.host, 'pages.example.com');
  assert.equal(body.key, n.key);
  assert.equal(body.keyLocation, `${LIVE}/${n.key}.txt`);
  assert.deepEqual(body.urlList, [`${LIVE}/listings/a`, `${LIVE}/llms.txt`]);
  assert.equal(entry.ok, true);
  assert.equal(indexNowNote(entry), 'Bing notified.');
  assert.equal(n.latestFor('a').status, 202);
});

test('URLs on other hosts are never sent', async () => {
  const fetch = stubFetch();
  const n = createIndexNow({ baseUrl: LIVE, dataDir: await tempDir(), enabled: true, fetch });
  const entry = await n.submit(['https://evil.example/x', 'javascript:alert(1)', 'not a url'], 't');
  assert.equal(fetch.calls.length, 0);
  assert.equal(entry.state, 'skipped');
});

test('a refused, broken or hanging endpoint resolves with a reason and never throws', async () => {
  for (const status of [400, 403, 422, 429]) {
    const n = createIndexNow({ baseUrl: LIVE, dataDir: await tempDir(), enabled: true, fetch: stubFetch({ status }) });
    const e = await n.submit([`${LIVE}/listings/a`], 'a');
    assert.equal(e.ok, false);
    assert.equal(indexNowNote(e), `Bing not notified (status ${status}).`);
  }
  const broken = createIndexNow({
    baseUrl: LIVE, dataDir: await tempDir(), enabled: true,
    fetch: stubFetch({ impl: () => { throw new Error('boom'); } }),
  });
  assert.equal((await broken.submit([`${LIVE}/x`], 'x')).reason, 'could not connect');

  const hang = stubFetch({
    impl: (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const slow = createIndexNow({ baseUrl: LIVE, dataDir: await tempDir(), enabled: true, fetch: hang, timeoutMs: 30 });
  const started = Date.now();
  const e = await slow.submit([`${LIVE}/x`], 'x');
  assert.equal(e.reason, 'timed out');
  assert.ok(Date.now() - started < 2000);
});

test('the log keeps the last 20 submissions, newest first', async () => {
  const n = createIndexNow({ baseUrl: LIVE, dataDir: await tempDir(), enabled: true, fetch: stubFetch() });
  for (let i = 0; i < 25; i++) await n.submit([`${LIVE}/listings/l${i}`], `l${i}`);
  const recent = n.recent();
  assert.equal(recent.length, 20);
  assert.equal(recent[0].tag, 'l24');
  assert.equal(n.latestFor('l0'), undefined);
});

// ---- in the app -------------------------------------------------------------------

test('the key file is served at the site root; other .txt files still 404', async () => {
  const env = await startApp({ fetch: stubFetch() });
  const key = env.ctx.indexNow.key;
  assert.match(key, KEY_RE);
  const res = await fetch(`${env.base}/${key}.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.equal(await res.text(), key);
  assert.equal((await fetch(`${env.base}/abcdefgh12345678.txt`)).status, 404);
  assert.equal((await fetch(`${env.base}/llms.txt`)).status, 200);
});

test('approve tells Bing about the listing, its category, llms.txt and the sitemap', async () => {
  const fetch = stubFetch();
  const env = await startApp({ fetch });
  const res = await globalThis.fetch(`${env.base}/admin/pending/d1/approve`, { method: 'POST', headers: admin });
  assert.equal(res.status, 200);
  const { listingId } = await res.json();
  await settle();
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual(fetch.calls[0].body.urlList, [
    `${LIVE}/listings/${listingId}`,
    `${LIVE}/?category=plumbers`,
    `${LIVE}/llms.txt`,
    `${LIVE}/sitemap.xml`,
  ]);

  // The queue page says Bing was told.
  const page = await globalThis.fetch(`${env.base}/admin/pending?note=approved&id=${listingId}`, { headers: admin });
  assert.match(await page.text(), /Bing notified\./);

  // Unpublish tells Bing the page is gone.
  const un = await globalThis.fetch(`${env.base}/admin/listings/${listingId}/unpublish`, { method: 'POST', headers: admin });
  assert.equal(un.status, 200);
  await settle();
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(fetch.calls[1].body.urlList, [`${LIVE}/listings/${listingId}`, `${LIVE}/llms.txt`, `${LIVE}/sitemap.xml`]);

  const log = await globalThis.fetch(`${env.base}/admin/indexnow`, { headers: admin });
  const html = await log.text();
  assert.equal(log.status, 200);
  assert.match(html, /Bing pings are on/);
  assert.ok(!html.includes(env.ctx.indexNow.key), 'the key is never shown on the admin page');
});

test('a hanging or failing endpoint never slows or breaks approve', async () => {
  const hang = stubFetch({ impl: () => new Promise(() => {}) });
  const env = await startApp({ fetch: hang });
  const started = Date.now();
  const res = await fetch(`${env.base}/admin/pending/d1/approve`, { method: 'POST', headers: admin });
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started < 2000, 'approve did not wait for Bing');
  const page = await fetch(`${env.base}/admin/pending?note=approved&id=${(await res.json()).listingId}`, { headers: admin });
  assert.match(await page.text(), /Telling Bing about it/);

  const failing = await startApp({ fetch: stubFetch({ impl: () => { throw new Error('down'); } }) });
  const res2 = await fetch(`${failing.base}/admin/pending/d1/approve`, { method: 'POST', headers: admin });
  assert.equal(res2.status, 200);
});

test('nothing is sent in demo mode, outside production, or for a local BASE_URL', async () => {
  for (const config of [
    { demoMode: true },
    { production: false },
    { baseUrl: 'https://localhost:3000' },
    { baseUrl: 'http://pages.example.com' },
    { indexNow: 'off' },
  ]) {
    const fetch = stubFetch();
    const env = await startApp({ config, fetch });
    assert.equal(env.ctx.indexNow.enabled, false, JSON.stringify(config));
    const res = await globalThis.fetch(`${env.base}/admin/pending/d1/approve`, { method: 'POST', headers: admin });
    // demo-reader drafts are fine here: provider is 'anthropic'
    assert.equal(res.status, 200, JSON.stringify(config));
    const { listingId } = await res.json();
    await settle();
    assert.equal(fetch.calls.length, 0, JSON.stringify(config));
    const page = await globalThis.fetch(`${env.base}/admin/pending?note=approved&id=${listingId}`, { headers: admin });
    assert.match(await page.text(), /Bing not notified \(/);
  }
});

test('a test run without its own fetch never sends', async () => {
  const env = await startApp({});
  assert.equal(env.ctx.indexNow.enabled, false);
  assert.equal(env.ctx.indexNow.reason, 'test run');
});

test('the key never appears in logs', async () => {
  const writes = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => { writes.push(String(chunk)); return original(chunk, ...rest); };
  try {
    const n = createIndexNow({ baseUrl: LIVE, dataDir: await tempDir(), enabled: true, fetch: stubFetch({ status: 403 }) });
    await n.submit([`${LIVE}/x`], 'x');
    const broken = createIndexNow({
      baseUrl: LIVE, dataDir: await tempDir(), enabled: true, fetch: stubFetch({ impl: () => { throw new Error('x'); } }),
    });
    await broken.submit([`${LIVE}/x`], 'x');
    for (const w of writes) {
      assert.ok(!w.includes(n.key) && !w.includes(broken.key), 'key leaked into stderr');
    }
    assert.ok(writes.some(w => w.includes('[indexnow] status=403')));
  } finally {
    process.stderr.write = original;
  }
});
