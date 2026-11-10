/**
 * Tests for DEMO_MODE.
 *
 * Covers config parsing, the layout/markDemo helpers, the app middleware
 * (noindex meta, footer line, X-Robots-Tag), production seed filtering in
 * /sitemap.xml and /llms.txt, and a property over public HTML routes.
 * Every server runs on a temporary copy of the data files.
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
import { layout, markDemo, DEMO_FOOTER_TEXT } from '../server/lib/html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'demo-mode-test-admin-token';
const BASE_URL = 'http://example.test';
const META = '<meta name="robots" content="noindex">';
const OWNER_ID = 'owner-plumbing-1';

const seedListings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'))
  .filter(l => l && typeof l === 'object' && typeof l.id === 'string');
const SEED_IDS = seedListings.map(l => l.id);
const SEED_ID = SEED_IDS[0];

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const count = (text, needle) => text.split(needle).length - 1;

// ---- environment ------------------------------------------------------------------

const envs = new Set();

/**
 * @param {{ config?: object, withOwner?: boolean }} [opts]
 */
async function makeEnv({ config = {}, withOwner = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-demo-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  if (withOwner) {
    const owner = { ...structuredClone(seedListings[0]), id: OWNER_ID, name: 'Owner Plumbing One' };
    await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify([owner]));
    await fs.writeFile(path.join(dir, 'verified.json'), JSON.stringify({ [OWNER_ID]: '2025-01-15' }));
  }
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const app = createApp({
    dataDir: dir,
    clock,
    rateLimiter: permissiveLimiter,
    config: { adminToken: TOKEN, baseUrl: BASE_URL, ...config },
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

const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });
const adminHeaders = { authorization: `Bearer ${TOKEN}` };

// ---- config -----------------------------------------------------------------------

test('configFromEnv demoMode: unset defaults to true outside production, false in production', () => {
  assert.equal(configFromEnv({}, { warn() {} }).demoMode, true);
  assert.equal(configFromEnv({ NODE_ENV: 'development' }, { warn() {} }).demoMode, true);
  assert.equal(configFromEnv({ NODE_ENV: 'production' }, { warn() {} }).demoMode, false);
});

test('configFromEnv demoMode: true/1/TRUE enable it', () => {
  for (const value of ['true', '1', 'TRUE']) {
    assert.equal(configFromEnv({ DEMO_MODE: value }, { warn() {} }).demoMode, true, value);
  }
});

test('configFromEnv demoMode: false/0 disable it, even outside production', () => {
  for (const value of ['false', '0']) {
    assert.equal(configFromEnv({ DEMO_MODE: value }, { warn() {} }).demoMode, false, value);
    assert.equal(
      configFromEnv({ DEMO_MODE: value, NODE_ENV: 'development' }, { warn() {} }).demoMode,
      false,
      value,
    );
  }
});

test('configFromEnv demoMode: production with DEMO_MODE=true is on', () => {
  const config = configFromEnv({ NODE_ENV: 'production', DEMO_MODE: 'true' }, { warn() {} });
  assert.equal(config.production, true);
  assert.equal(config.demoMode, true);
});

test('configFromEnv demoMode: unrecognized values fall back to the default', () => {
  assert.equal(configFromEnv({ DEMO_MODE: 'maybe' }, { warn() {} }).demoMode, true);
  assert.equal(configFromEnv({ DEMO_MODE: 'maybe', NODE_ENV: 'production' }, { warn() {} }).demoMode, false);
});

// ---- layout / markDemo ------------------------------------------------------------

test('layout without demo has no noindex meta and no footer text', () => {
  const html = layout({ title: 'T', body: '<p>x</p>' });
  assert.equal(count(html, META), 0);
  assert.equal(count(html, DEMO_FOOTER_TEXT), 0);
});

test('layout with demo:true has the meta and footer text exactly once', () => {
  const html = layout({ title: 'T', body: '<p>x</p>', demo: true });
  assert.equal(count(html, META), 1);
  assert.equal(count(html, DEMO_FOOTER_TEXT), 1);
});

test('markDemo is idempotent', () => {
  const page = layout({ title: 'T', body: '<p>x</p>' });
  const once = markDemo(page);
  assert.equal(markDemo(once), once);
  assert.equal(markDemo(markDemo(page)), once);
});

// ---- server: DEMO_MODE on ---------------------------------------------------------

test('demo mode on: public and admin HTML pages carry the footer line and noindex meta once', async () => {
  const env = await makeEnv({ config: { demoMode: true, production: false } });
  const paths = [
    ['/', {}],
    [`/listings/${SEED_ID}`, {}],
    ['/rise', {}],
    [`/seance/${SEED_ID}`, {}],
    ['/admin/pending', adminHeaders],
    ['/no-such-page', {}],
    ['/listings/no-such-listing', {}],
  ];
  for (const [p, headers] of paths) {
    const res = await get(env, p, headers);
    const body = await res.text();
    assert.match(res.headers.get('content-type') ?? '', /html/, p);
    assert.equal(count(body, DEMO_FOOTER_TEXT), 1, `footer text once on ${p}`);
    assert.equal(count(body, META), 1, `noindex meta once on ${p}`);
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/, p);
  }
});

test('demo mode on: the 404 page is marked', async () => {
  const env = await makeEnv({ config: { demoMode: true, production: false } });
  const res = await get(env, '/no-such-page');
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.equal(count(body, DEMO_FOOTER_TEXT), 1);
  assert.equal(count(body, META), 1);
});

test('demo mode on: JSON, plain text and XML endpoints are not modified', async () => {
  const env = await makeEnv({ config: { demoMode: true, production: false } });
  for (const p of [`/api/listings/${SEED_ID}`, '/llms.txt', '/sitemap.xml']) {
    const res = await get(env, p);
    assert.equal(res.status, 200, p);
    const body = await res.text();
    assert.equal(count(body, META), 0, `no meta in ${p}`);
    assert.equal(count(body, DEMO_FOOTER_TEXT), 0, `no footer text in ${p}`);
  }
  const json = await (await get(env, `/api/listings/${SEED_ID}`)).json();
  assert.equal(json.id, SEED_ID);
});

// ---- server: DEMO_MODE off --------------------------------------------------------

test('demo mode off: no footer text, no noindex meta', async () => {
  const env = await makeEnv({ config: { demoMode: false, production: false } });
  const paths = [
    ['/', {}],
    [`/listings/${SEED_ID}`, {}],
    ['/rise', {}],
    [`/seance/${SEED_ID}`, {}],
    ['/admin/pending', adminHeaders],
    ['/no-such-page', {}],
  ];
  for (const [p, headers] of paths) {
    const res = await get(env, p, headers);
    const body = await res.text();
    assert.equal(count(body, DEMO_FOOTER_TEXT), 0, `no footer text on ${p}`);
    assert.equal(count(body, META), 0, `no noindex meta on ${p}`);
  }
});

// ---- production seed filtering ----------------------------------------------------

test('production: seed listings are left out of sitemap and llms.txt; owner listing is present', async () => {
  const env = await makeEnv({
    config: { production: true, demoMode: false },
    withOwner: true,
  });
  const sitemap = await (await get(env, '/sitemap.xml')).text();
  const llms = await (await get(env, '/llms.txt')).text();

  for (const id of SEED_IDS) {
    assert.ok(!sitemap.includes(`/listings/${id}<`), `sitemap omits seed ${id}`);
    assert.ok(!llms.includes(`/listings/${id}`), `llms.txt omits seed ${id}`);
  }
  assert.ok(sitemap.includes(`${BASE_URL}/listings/${OWNER_ID}<`), 'sitemap has owner listing');
  assert.ok(llms.includes(`/listings/${OWNER_ID}`), 'llms.txt has owner listing');

  const page = await get(env, `/listings/${SEED_ID}`);
  assert.equal(page.status, 200);
});

test('outside production: seed listings appear in sitemap and llms.txt', async () => {
  const env = await makeEnv({
    config: { production: false, demoMode: false },
    withOwner: true,
  });
  const sitemap = await (await get(env, '/sitemap.xml')).text();
  const llms = await (await get(env, '/llms.txt')).text();
  for (const id of SEED_IDS) {
    assert.ok(sitemap.includes(`/listings/${id}<`), `sitemap has seed ${id}`);
    assert.ok(llms.includes(`/listings/${id}`), `llms.txt has seed ${id}`);
  }
  assert.ok(sitemap.includes(`/listings/${OWNER_ID}<`));
});

// ---- property ---------------------------------------------------------------------

test('property: with DEMO_MODE on every public HTML route has the footer line and noindex meta once', async () => {
  const env = await makeEnv({ config: { demoMode: true, production: false } });
  const seedId = fc.constantFrom(...SEED_IDS);
  const route = fc.oneof(
    fc.constant('/'),
    fc.constant('/rise'),
    fc.constant('/no-such-page'),
    seedId.map(id => `/listings/${id}`),
    seedId.map(id => `/seance/${id}`),
    fc.stringMatching(/^[a-z0-9]{6,12}$/).map(s => `/listings/unknown-${s}`),
  );

  await fc.assert(
    fc.asyncProperty(fc.array(route, { minLength: 1, maxLength: 4 }), async routes => {
      for (const p of routes) {
        const res = await get(env, p);
        const body = await res.text();
        assert.match(res.headers.get('content-type') ?? '', /html/, p);
        assert.equal(count(body, DEMO_FOOTER_TEXT), 1, `footer text once on ${p}`);
        assert.equal(count(body, META), 1, `noindex meta once on ${p}`);
      }
    }),
    { numRuns: 20 },
  );
});
