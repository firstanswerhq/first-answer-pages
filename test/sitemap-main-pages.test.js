/**
 * The main pages in the sitemap (Feature D, task F11; Requirement 22.1). No network beyond the local test server.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { generateSitemap } from '../server/lib/sitemap.js';
import { configFromEnv } from '../server/lib/config.js';
import { MAIN_PAGES, GRADE_PAGES, GRADE_PAGES_OPEN, mainPages } from '../server/routes/sitemap.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const BASE = 'https://firstanswer.example';
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const LISTINGS = [
  { id: 'zephyr-plumbing-nashville', category: 'plumbers' },
  { id: 'aster-electric-nashville', category: 'electricians' },
];
const locs = xml => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);

// ---- generateSitemap ---------------------------------------------------------------------------------

test('F11: without extra pages the output is byte-for-byte what it was', () => {
  const before = generateSitemap(LISTINGS, BASE, categories);
  assert.equal(generateSitemap(LISTINGS, BASE, categories, []), before);
  assert.equal(generateSitemap(LISTINGS, BASE, categories, undefined), before);
  assert.equal(generateSitemap(LISTINGS, BASE, undefined), generateSitemap(LISTINGS, BASE));
  assert.equal(locs(before).length, 1 + 2 + LISTINGS.length);
});

test('F11: extra pages come right after the home page, once each, with the base address', () => {
  const xml = generateSitemap(LISTINGS, BASE, categories, ['/about', '/verified', '/privacy', '/rise', '/about']);
  const urls = locs(xml);
  assert.deepEqual(urls.slice(0, 5), [`${BASE}/`, `${BASE}/about`, `${BASE}/verified`, `${BASE}/privacy`, `${BASE}/rise`]);
  assert.equal(urls.length, 1 + 4 + 2 + LISTINGS.length);
  assert.ok(urls.every(u => u.startsWith(BASE)));
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'));
});

test('F11: only plain site paths are used, and they are escaped', () => {
  const xml = generateSitemap([], BASE, categories, ['about', '//evil.example/x', 'https://evil.example/', '/', '/a b', 5, null, '/x?a=1&b=2']);
  const urls = locs(xml);
  assert.deepEqual(urls, [`${BASE}/`, `${BASE}/x?a=1&amp;b=2`]);
  assert.equal(xml.includes('evil.example'), false);
});

test('M1: a path holding a control character is refused', () => {
  const xml = generateSitemap([], BASE, categories, ['/about\u0000', '/a\u0007b', '/x\u007f', '/y\u0085', '/privacy']);
  assert.deepEqual(locs(xml), [`${BASE}/`, `${BASE}/privacy`]);
  assert.equal(/[\u0000-\u001f\u007f-\u009f]/.test(xml.replace(/\n/g, '')), false);
});

// ---- which pages the route lists ----------------------------------------------------------------------------

const ALWAYS = ['/about', '/privacy', '/rise'];
const WITH_VERIFIED = ['/about', '/verified', '/privacy', '/rise'];

test('F11 (V89): the route lists /about, /privacy and /rise, /verified only when verification is on, and none in demo mode', () => {
  assert.deepEqual(MAIN_PAGES, WITH_VERIFIED);
  assert.deepEqual(GRADE_PAGES, ['/grade', '/grade/about']);
  assert.deepEqual(mainPages({ demoMode: true }), []);
  assert.deepEqual(mainPages({ demoMode: true }, { verificationOn: true }), []);
  assert.deepEqual(mainPages({ demoMode: false, graderEnabled: false }), ALWAYS);
  assert.deepEqual(mainPages({ demoMode: false, graderEnabled: false }, { verificationOn: true }), WITH_VERIFIED);
  assert.deepEqual(mainPages({ demoMode: false }), GRADE_PAGES_OPEN ? [...ALWAYS, ...GRADE_PAGES] : ALWAYS);
  assert.deepEqual(mainPages({ demoMode: false }, { verificationOn: true }), GRADE_PAGES_OPEN ? [...WITH_VERIFIED, ...GRADE_PAGES] : WITH_VERIFIED);
  // No config: verification counts as off, and the grader counts as on (it is off only when graderEnabled is false).
  assert.deepEqual(mainPages(), GRADE_PAGES_OPEN ? [...ALWAYS, ...GRADE_PAGES] : ALWAYS, 'verification off, grader on by default');
});

/** Fake trust providers, built the way test/trust.test.js builds them: nothing here is ever called by a page view. */
function fakeTrust() {
  return {
    payments: {
      name: 'fake', testMode: false, webhookEnabled: true,
      async createCheckout() { return { id: 'cs_1', url: 'https://pay.example/cs_1' }; },
      async getCheckout() { return { paid: false, open: true, url: 'https://pay.example/cs_1' }; },
      async expireCheckout() { return true; },
      async cancelIdCheck() { return true; },
      async createIdCheck() { return { id: 'vs_1', url: 'https://id.example/vs_1' }; },
      async getIdCheck() { return { status: '', failed: false }; },
      parseWebhook() { throw new Error('bad_signature'); },
    },
    phone: { name: 'fake', async send() {}, async check() { return false; } },
  };
}

async function startEnv(config = {}, { trust } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-sitemap-pages-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const base = configFromEnv({ ADMIN_TOKEN: 'sitemap-token', BASE_URL: 'http://example.test' }, { warn: () => {} });
  const app = createApp({
    dataDir: dir,
    config: { ...base, adminToken: 'sitemap-token', baseUrl: 'http://example.test', ...config },
    ...(trust ? { trust } : {}),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

const sitemap = async env => (await fetch(`${env.base}/sitemap.xml`)).text();

test('F11: the live sitemap lists the main pages, and no report, draft or admin address', async () => {
  const env = await startEnv({ demoMode: false, production: false });
  const urls = locs(await sitemap(env));
  for (const p of ALWAYS) assert.ok(urls.includes(`http://example.test${p}`), p);
  assert.ok(urls.includes('http://example.test/'));
  assert.equal(urls.some(u => /\/grade\/[A-Za-z0-9_-]{22}/.test(u)), false, 'no report');
  assert.equal(urls.some(u => u.includes('/rise/drafts')), false, 'no draft');
  assert.equal(urls.some(u => u.includes('/admin')), false, 'no admin page');
  assert.equal(urls.some(u => u.includes('/api/')), false);
});

/** Every page the sitemap lists (listings and category pages aside) must return 200 and not be noindex. */
async function assertListedPagesOpen(env) {
  const paths = locs(await sitemap(env))
    .filter(u => !u.includes('/listings/') && !u.includes('?category='))
    .map(u => u.replace('http://example.test', ''));
  for (const p of paths) {
    const res = await fetch(`${env.base}${p}`);
    assert.equal(res.status, 200, p);
    assert.doesNotMatch(res.headers.get('x-robots-tag') ?? '', /noindex/i, p);
    const html = await res.text();
    assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/i, p);
  }
  return paths;
}

test('V89: with verification off the sitemap has /about, /privacy and /rise and no /verified, and each listed page is open', async () => {
  const env = await startEnv({ demoMode: false, production: false });
  const paths = await assertListedPagesOpen(env);
  for (const p of ['/', ...ALWAYS]) assert.ok(paths.includes(p), p);
  assert.equal(paths.includes('/verified'), false);
  assert.equal((await fetch(`${env.base}/verified`)).status, 404, 'the page is not served, so it is not listed');
});

test('V89: with verification on the sitemap has /verified too, and each listed page is open', async () => {
  const env = await startEnv({ demoMode: false, production: false }, { trust: fakeTrust() });
  const paths = await assertListedPagesOpen(env);
  for (const p of ['/', ...WITH_VERIFIED]) assert.ok(paths.includes(p), p);
  const urls = locs(await sitemap(env));
  assert.ok(urls.indexOf('http://example.test/about') < urls.indexOf('http://example.test/verified'));
  assert.ok(urls.indexOf('http://example.test/verified') < urls.indexOf('http://example.test/privacy'));
});

test('F11: with the grader off the /grade pages are not listed, and in demo mode no extra pages are', async () => {
  const off = await startEnv({ demoMode: false, production: false, graderEnabled: false });
  const offUrls = locs(await sitemap(off));
  assert.equal(offUrls.some(u => u.includes('/grade')), false);
  for (const p of ALWAYS) assert.ok(offUrls.includes(`http://example.test${p}`), p);

  const demo = await startEnv({ demoMode: true, production: false });
  const demoUrls = locs(await sitemap(demo));
  for (const p of [...MAIN_PAGES, ...GRADE_PAGES]) assert.equal(demoUrls.includes(`http://example.test${p}`), false, p);
});
