/**
 * Tests for tappable phone numbers (tel: links).
 *
 * Pure tests exercise telLink(); integration tests run an in-process server
 * on a temporary DATA_DIR (copies of the seed files). The real data/
 * directory is never written to.
 *
 * Property: every rendered phone is a tel: link whose href holds only digits
 * and an optional leading plus
 * **Validates: Requirements docs/launch-fixes.md section 17 (tappable phone numbers)**
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { telLink, escapeHtml } from '../server/lib/html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const HREF_RE = /^tel:\+?[0-9]+$/;

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

// ---- pure: telLink ------------------------------------------------------------

const digitsArb = n => fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n }).map(a => a.join(''));

const validPhoneArb = fc
  .tuple(digitsArb(3), digitsArb(3), digitsArb(4))
  .map(([a, b, c]) => ({ display: `(${a}) ${b}-${c}`, digits: `${a}${b}${c}` }));

test('property: valid phones render as tel: links with exactly the 10 digits', () => {
  fc.assert(
    fc.property(validPhoneArb, ({ display, digits }) => {
      const out = telLink(display);
      assert.equal(out, `<a class="tel" href="tel:${digits}">${display}</a>`);
      const href = /href="([^"]*)"/.exec(out)[1];
      assert.match(href, HREF_RE);
      assert.equal(href, `tel:${digits}`);
    }),
    { numRuns: 100 },
  );
});

function checkArbitrary(s) {
  const out = telLink(s);
  const hasDigit = /[0-9]/.test(s);
  if (!hasDigit) {
    assert.ok(!out.includes('<a'), 'no digits means no anchor');
    assert.equal(out, escapeHtml(s));
    return;
  }
  const m = /^<a class="tel" href="([^"]*)">([\s\S]*)<\/a>$/.exec(out);
  assert.ok(m, 'anchor expected when digits present');
  assert.match(m[1], HREF_RE);
  assert.equal(m[2], escapeHtml(s));
  // No raw '<' or '"' from the input leaks into the text content.
  assert.ok(!m[2].includes('<'));
  assert.ok(!m[2].includes('"'));
  // Only one anchor, with exactly the expected attributes.
  assert.equal(out.split('<').length, 3);
}

test('property: arbitrary strings never yield an unsafe href or raw markup', () => {
  fc.assert(fc.property(fc.string(), checkArbitrary), { numRuns: 100 });
  fc.assert(fc.property(fc.fullUnicodeString(), checkArbitrary), { numRuns: 100 });
});

test('property: strings with injected markup stay escaped', () => {
  fc.assert(
    fc.property(fc.string(), fc.string(), (a, b) => {
      checkArbitrary(`${a}<"1${b}`);
    }),
    { numRuns: 100 },
  );
});

test('examples: formats and edge cases', () => {
  assert.match(telLink('+1 (615) 555-0100'), /href="tel:\+16155550100"/);
  assert.match(telLink(' +44 20 7946 0958'), /href="tel:\+442079460958"/);
  assert.match(telLink('615.555.0100'), /href="tel:6155550100"/);
  // A plus in the middle is dropped.
  assert.match(telLink('615+555 0100'), /href="tel:6155550100"/);
  assert.match(telLink('(615) 555-0100 ext. +5'), /href="tel:61555501005"/);
  // No digits: plain escaped text, no anchor.
  assert.equal(telLink('call <us>'), 'call &lt;us&gt;');
  assert.equal(telLink(''), '');
  assert.equal(telLink(undefined), '');
});

// ---- integration --------------------------------------------------------------

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-tel-'));
for (const name of ['listings.json', 'categories.json']) {
  await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
}

const seed = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8')).filter(
  l => l && typeof l.id === 'string' && typeof l.phone === 'string',
);

const app = createApp({
  dataDir: dir,
  rateLimiter: permissiveLimiter,
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

async function getHtml(url) {
  const res = await fetch(base + url);
  assert.equal(res.status, 200);
  return res.text();
}

const telHrefs = html => [...html.matchAll(/<a class="tel" href="([^"]*)"/g)].map(m => m[1]);
const telAnchor = phone => `<a class="tel" href="tel:${phone.replace(/\D/g, '')}">${escapeHtml(phone)}</a>`;

function assertTelLinks(html, listings) {
  assert.ok(listings.length > 0, 'expected at least one listing on the page');
  for (const l of listings) {
    assert.ok(html.includes(telAnchor(l.phone)), `missing tel link for ${l.id}`);
  }
  const hrefs = telHrefs(html);
  assert.ok(hrefs.length >= listings.length);
  for (const h of hrefs) assert.match(h, HREF_RE);
}

test('listing page has a tel link for its phone', async () => {
  const listing = seed.find(l => l.id === 'nashville-pipe-pros');
  assert.ok(listing);
  const html = await getHtml(`/listings/${listing.id}`);
  assertTelLinks(html, [listing]);
});

test('home page has a tel link for each shown listing', async () => {
  const html = await getHtml('/');
  const shown = seed.filter(l => html.includes(`href="/listings/${encodeURIComponent(l.id)}"`));
  assert.ok(shown.length > 1);
  assertTelLinks(html, shown);
});

test('category-filtered page has a tel link for each plumber', async () => {
  const html = await getHtml('/?category=plumbers');
  const plumbers = seed.filter(l => l.category === 'plumbers');
  const shown = seed.filter(l => html.includes(`href="/listings/${encodeURIComponent(l.id)}"`));
  assert.ok(plumbers.length > 0);
  assert.deepEqual(
    shown.map(l => l.id).sort(),
    plumbers.map(l => l.id).sort(),
  );
  assertTelLinks(html, shown);
});
