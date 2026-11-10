/**
 * category-page.test.js — heading and layout of filtered home pages (GET /).
 *
 * Covers the "<Label> in <City>" heading, the single-heading layout for one
 * category, escaping of the city, and the unfiltered grouped layout.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { createMockNotifier } from '../server/lib/notifier.js';
import { escapeHtml } from '../server/lib/html.js';

const repoData = fileURLToPath(new URL('../data/', import.meta.url));
const seedCategories = JSON.parse(await fs.readFile(path.join(repoData, 'categories.json'), 'utf8'));
const seedListings = JSON.parse(await fs.readFile(path.join(repoData, 'listings.json'), 'utf8'))
  .filter(l => l && typeof l === 'object' && l.id);

const labelOf = slug => seedCategories.find(c => c.slug === slug).label;
const PLUMBERS = seedListings.filter(l => l.category === 'plumbers');
const slugsWithListings = [...new Set(seedListings.map(l => l.category))];

// Extra plumber listings whose city holds characters that need escaping.
const HOSTILE_CITIES = [
  '<b>x</b>',
  '<script>alert(1)</script>',
  `"quoted" & 'single'`,
  '100% &amp; more',
];

let dir;
let server;
let base;
let baselineScriptCount;

const get = async (query = '') => {
  const res = await fetch(`${base}/${query}`);
  return { status: res.status, html: await res.text() };
};
const q = (category, city) => {
  const parts = [];
  if (category !== undefined) parts.push(`category=${encodeURIComponent(category)}`);
  if (city !== undefined) parts.push(`city=${encodeURIComponent(city)}`);
  return `?${parts.join('&')}`;
};
const titles = html => [...html.matchAll(/<h2 class="category-title">([\s\S]*?)<\/h2>/g)].map(m => m[1]);
const count = (haystack, needle) => haystack.split(needle).length - 1;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-catpage-'));
  for (const file of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(repoData, file), path.join(dir, file));
  }
  const extra = HOSTILE_CITIES.map((city, i) => ({
    ...PLUMBERS[0],
    id: `hostile-plumber-${i}`,
    name: `Hostile Plumber ${i}`,
    city,
  }));
  await fs.writeFile(
    path.join(dir, 'listings.json'),
    JSON.stringify([...seedListings, ...extra], null, 2),
  );

  const app = createApp({
    dataDir: dir,
    config: { providerTimeoutMs: 1000 },
    notifier: createMockNotifier(),
    rateLimiter: { consume: () => ({ allowed: true }), consumeAll: () => ({ allowed: true }), size: () => 0 },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  baselineScriptCount = count((await get()).html, '<script');
});

after(async () => {
  server?.closeAllConnections?.();
  if (server) await new Promise(resolve => server.close(resolve));
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test('category + city: one "Plumbers in Nashville" heading above the grid with every plumber', async () => {
  const { status, html } = await get(q('plumbers', 'Nashville'));
  assert.equal(status, 200);
  assert.deepEqual(titles(html), [`${labelOf('plumbers')} in Nashville`]);
  assert.ok(html.includes('<div class="directory-single">'));
  assert.ok(!html.includes('class="category-head"'));
  assert.ok(!html.includes('<div class="directory">'));

  const headingAt = html.indexOf('<h2 class="category-title">');
  const gridAt = html.indexOf('<div class="category-grid">');
  assert.ok(headingAt > -1 && gridAt > headingAt, 'heading comes before the grid');

  const grid = html.slice(gridAt);
  const nashvillePlumbers = PLUMBERS.filter(l => l.city.toLowerCase() === 'nashville');
  assert.ok(nashvillePlumbers.length > 0);
  for (const l of nashvillePlumbers) {
    assert.ok(grid.includes(escapeHtml(l.name)), `${l.name} is in the grid`);
  }
  assert.equal(count(html, 'class="listing-card"'), nashvillePlumbers.length);
});

test('category only: heading is the category label alone', async () => {
  const { status, html } = await get(q('electricians'));
  assert.equal(status, 200);
  assert.deepEqual(titles(html), [labelOf('electricians')]);
  assert.ok(html.includes('<div class="directory-single">'));
  assert.ok(!html.includes('class="category-head"'));
});

test('city only: heading is "Businesses in Nashville" with per-category h3 headings', async () => {
  const { status, html } = await get(q(undefined, 'Nashville'));
  assert.equal(status, 200);
  assert.deepEqual(titles(html), ['Businesses in Nashville']);
  assert.ok(html.includes('<div class="directory">'));
  assert.ok(html.indexOf('class="category-title"') < html.indexOf('<h3 class="category-head">'));
  assert.ok(count(html, '<h3 class="category-head">') >= 2);
  assert.ok(!html.includes('<h2 class="category-head">'));
});

test('unknown category slug: no category part, no crash', async () => {
  const { status, html } = await get(q('no-such-category', 'Nashville'));
  assert.equal(status, 200);
  assert.ok(html.includes('No results found'));
  assert.deepEqual(titles(html), []);
  assert.ok(!html.includes('no-such-category in'));
  assert.ok(!html.includes('<div class="directory-single">'));
});

test('city containing HTML is escaped in the heading', async () => {
  for (const city of HOSTILE_CITIES) {
    const { status, html } = await get(q('plumbers', city));
    assert.equal(status, 200);
    assert.deepEqual(titles(html), [`${labelOf('plumbers')} in ${escapeHtml(city)}`]);
    assert.ok(!html.includes(`in ${city}</h2>`) || city === escapeHtml(city));
  }
  const { html } = await get(q('plumbers', '<b>x</b>'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

test('no filters: no category-title, grouped category-head headings remain', async () => {
  const { status, html } = await get();
  assert.equal(status, 200);
  assert.deepEqual(titles(html), []);
  assert.ok(!html.includes('class="category-title"'));
  assert.ok(!html.includes('<h3 class="category-head">'));
  for (const slug of slugsWithListings) {
    assert.ok(html.includes(`<h2 class="category-head">${escapeHtml(labelOf(slug))}</h2>`), slug);
  }
});

test('no matching results: shows the "No results found" message', async () => {
  const { status, html } = await get(q('plumbers', 'Atlantis'));
  assert.equal(status, 200);
  assert.ok(html.includes('No results found'));
  assert.deepEqual(titles(html), []);
});

test('Property: arbitrary city strings are escaped and the heading (when shown) is single and correct', async () => {
  // Validates: category page heading escaping and single-heading layout
  const hostile = fc.constantFrom('<script>', '"', "'", '&', '%', '%3Cscript%3E', '<img src=x onerror=1>', '</h2><script>');
  const cityArb = fc.oneof(fc.string(), fc.tuple(fc.string(), hostile, fc.string()).map(t => t.join('')));
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom(...seedCategories.map(c => c.slug)),
      cityArb,
      async (slug, city) => {
        const { status, html } = await get(q(slug, city));
        assert.equal(status, 200);

        const trimmed = city.trim();
        const label = labelOf(slug);
        // The filter form always echoes the trimmed city, escaped.
        assert.ok(html.includes(`name="city" value="${escapeHtml(trimmed)}"`));
        assert.ok(count(html, '<script>') <= baselineScriptCount);

        const expected = escapeHtml(trimmed ? `${label} in ${trimmed}` : label);
        const found = titles(html);
        assert.ok(found.length <= 1);
        for (const t of found) assert.equal(t, expected);
        if (found.length === 0) assert.ok(html.includes('No results found'));
      },
    ),
    { numRuns: 25 },
  );
});

test('Property: every category with listings gets one heading with the escaped, trimmed city', async () => {
  // Validates: category page heading for matching category and city
  const cityArb = fc.tuple(
    fc.constantFrom('', ' ', '\t', '  '),
    fc.constantFrom('Nashville', 'nashville', 'NASHVILLE', 'NashVille'),
    fc.constantFrom('', ' ', '\t'),
  ).map(t => t.join(''));
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...slugsWithListings), cityArb, async (slug, city) => {
      const { status, html } = await get(q(slug, city));
      assert.equal(status, 200);
      const trimmed = city.trim();
      assert.deepEqual(titles(html), [escapeHtml(`${labelOf(slug)} in ${trimmed}`)]);
      assert.ok(!html.includes('class="category-head"'));
      const grid = html.slice(html.indexOf('<div class="category-grid">'));
      for (const l of seedListings.filter(x => x.category === slug)) {
        assert.ok(grid.includes(escapeHtml(l.name)));
      }
    }),
    { numRuns: 25 },
  );
});
