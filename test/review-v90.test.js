/**
 * The code review of V90 to V97 (V98, V99): a website host may hold only letters, digits, dots and hyphens, and a
 * canonical link is built only from a plain base address. No network beyond the local test server.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { normalizeWebsite, reviewsLinkHost } from '../server/lib/listing-fields.js';
import { canonicalUrl } from '../server/lib/base-url.js';
import { ownerWebsite } from '../server/routes/rise.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

// ---- V98 ----------------------------------------------------------------------------------------------

test('V98: a host holding punctuation is left out, typed in full or the short way', () => {
  for (const value of ['https://"x.com/', "https://a'b.com/", 'https://a`b.com/', 'https://a{b}.com/', 'https://a&b.com/', 'https://a;b.com/', 'https://a!b.com/', 'https://a$b.com/']) {
    assert.equal(normalizeWebsite(value), '', value);
  }
  for (const typed of ['"=a.b', '"=A.9KMCY', "a'b.com", 'a{b}.com']) {
    assert.equal(normalizeWebsite(ownerWebsite(typed)), '', typed);
  }
});

test('V98: international names (as xn--) and hyphenated names are kept', () => {
  assert.equal(normalizeWebsite('https://xn--caf-dma.fr/'), 'https://xn--caf-dma.fr/');
  assert.equal(normalizeWebsite('https://café.fr/'), 'https://xn--caf-dma.fr/', 'the parser turns it into xn--');
  assert.equal(normalizeWebsite('https://my-shop.example.com/'), 'https://my-shop.example.com/');
});

test('V98: every kept website has a host of letters, digits, dots and hyphens only', () => {
  fc.assert(fc.property(fc.oneof(fc.string(), fc.fullUnicodeString(), fc.webUrl()), value => {
    for (const out of [normalizeWebsite(value), normalizeWebsite(ownerWebsite(value))]) {
      if (out !== '') assert.match(new URL(out).hostname, /^[a-z0-9.-]+$/);
    }
  }), { numRuns: 500 });
});

test('V98: reviewsLinkHost already refuses such hosts, since it accepts only a fixed list of hosts', () => {
  for (const value of ['https://"yelp.com/biz/x', 'https://yelp.com"/biz/x', "https://www.yelp'.com/biz/x", 'https://ya{b}.yelp.com/biz/x', 'https://www.goo;gle.com/maps']) {
    assert.equal(reviewsLinkHost(value), '', value);
  }
});

// ---- V99 ----------------------------------------------------------------------------------------------

test('V99: a canonical link is built only from a plain base address', () => {
  assert.equal(canonicalUrl({ baseUrl: 'https://firstanswer.example' }, '/rise'), 'https://firstanswer.example/rise');
  assert.equal(canonicalUrl({ baseUrl: 'https://firstanswer.example/' }, '/grade'), 'https://firstanswer.example/grade');
  assert.equal(canonicalUrl({ baseUrl: 'http://localhost:3000' }, '/grade/about'), 'http://localhost:3000/grade/about');
  assert.equal(canonicalUrl({ baseUrl: 'https://my-site.example:8443' }, '/rise'), 'https://my-site.example:8443/rise');
  for (const bad of ['http://x.test"><b>', 'https://x.test/sub', 'https://x.test//', 'ftp://x.test', 'x.test', 'https://user@x.test',
    'https://x.test?a=1', 'https://x.test#a', 'https://[::1]', 'https://x test', 'javascript:x', '', undefined, 42]) {
    assert.equal(canonicalUrl({ baseUrl: bad }, '/rise'), '', String(bad));
  }
  assert.equal(canonicalUrl(undefined, '/rise'), '');
});

async function startEnv(baseUrl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-review-v90-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const app = createApp({
    dataDir: dir,
    config: { adminToken: 'v90-token', baseUrl, demoMode: false, production: false, graderSecret: 'test-secret', gradeMainAsks: 1 },
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

const canonicalOf = html => /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1];

test('V99: an odd base address gives no canonical link on /rise, /grade and /grade/about', async () => {
  const env = await startEnv('http://x.test"><b>');
  for (const p of ['/rise', '/grade', '/grade/about']) {
    const html = await (await fetch(`${env.base}${p}`)).text();
    assert.equal(canonicalOf(html), undefined, p);
    assert.equal(html.includes('<b>'), false, p);
  }
});

test('V99: a normal base address, and one with a port, still give the canonical link on all three pages', async () => {
  for (const base of ['https://firstanswer.example', 'https://firstanswer.example:8443']) {
    const env = await startEnv(base);
    for (const p of ['/rise', '/grade', '/grade/about']) {
      const html = await (await fetch(`${env.base}${p}`)).text();
      assert.equal(canonicalOf(html), `${base}${p}`, `${base}${p}`);
    }
  }
});
