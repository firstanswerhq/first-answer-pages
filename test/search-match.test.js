/**
 * Tests for forgiving search (task 21.2): normalizeCategory and normalizeCity,
 * the MCP search_listings category enum and normalizing, and the home page
 * filters. Categories come from the real data/categories.json. The apps run on
 * temporary DATA_DIR copies; the repo data/ folder is never written.
 *
 * Property: every category matches its slug, label, singular, and any letter case.
 * **Validates: task 21.2 (forgiving category matching)**
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { normalizeCategory, normalizeCity } from '../server/lib/search-match.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const CATEGORIES = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const SLUGS = CATEGORIES.map(c => c.slug);

// ---- normalizeCategory ------------------------------------------------------------

test('normalizeCategory: forgiving forms map to the category slug', () => {
  const table = [
    ['plumber', 'plumbers'],
    ['Plumbers', 'plumbers'],
    ['plumbing', 'plumbers'],
    ['PLUMBERS', 'plumbers'],
    ['plumbers', 'plumbers'],
    ['hair salon', 'hair-salons'],
    ['Hair Salons', 'hair-salons'],
    ['auto repair', 'auto-repair'],
    ['Auto-Repair', 'auto-repair'],
    ['lawyer', 'lawyers'],
    ['  Lawyers  ', 'lawyers'],
    ['electrician', 'electricians'],
  ];
  for (const [input, slug] of table) assert.equal(normalizeCategory(input, CATEGORIES), slug, input);
});

test('normalizeCategory: unknown text and non-strings give undefined', () => {
  assert.equal(normalizeCategory('zebra', CATEGORIES), undefined);
  assert.equal(normalizeCategory('', CATEGORIES), undefined);
  assert.equal(normalizeCategory('   ', CATEGORIES), undefined);
  assert.equal(normalizeCategory('!!!', CATEGORIES), undefined);
  for (const bad of [undefined, null, 42, true, {}, [], ['plumbers'], () => 'plumbers']) {
    assert.equal(normalizeCategory(bad, CATEGORIES), undefined, String(bad));
  }
  assert.equal(normalizeCategory('plumbers', undefined), undefined);
  assert.equal(normalizeCategory('plumbers', null), undefined);
  assert.equal(normalizeCategory('plumbers', []), undefined);
});

test('Property: for every category its slug, label, singular, upper and lower case all match it', () => {
  // **Validates: task 21.2 (forgiving category matching)**
  const mixCase = (text, mask) => Array.from(text)
    .map((ch, i) => (mask[i % mask.length] ? ch.toUpperCase() : ch.toLowerCase()))
    .join('');
  // A label such as "Plumbers" has the singular "Plumber"; labels that do not end in s have none.
  const singular = label => (/s$/i.test(label) && !/ss$/i.test(label) ? label.slice(0, -1) : null);

  fc.assert(
    fc.property(
      fc.constantFrom(...CATEGORIES),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
      (category, mask) => {
        const forms = [category.slug, category.label];
        const one = singular(category.label);
        if (one) forms.push(one);
        for (const form of forms) {
          for (const variant of [form, form.toUpperCase(), form.toLowerCase(), mixCase(form, mask)]) {
            assert.equal(normalizeCategory(variant, CATEGORIES), category.slug, variant);
          }
        }
      },
    ),
    { numRuns: 100 },
  );
});

// ---- normalizeCity ------------------------------------------------------------------

test('normalizeCity: a trailing state is removed, everything else is kept', () => {
  const table = [
    ['Nashville, TN', 'Nashville'],
    ['nashville tn', 'nashville'],
    ['Nashville', 'Nashville'],
    ['TN', 'TN'],
    ['Bel Air', 'Bel Air'],
    ['  Nashville ,  tn ', 'Nashville'],
    ['Nashville,TN', 'Nashville'],
  ];
  for (const [input, expected] of table) assert.equal(normalizeCity(input), expected, JSON.stringify(input));
  for (const bad of [undefined, null, 5, {}, []]) assert.equal(normalizeCity(bad), '');
});

// ---- MCP and home page ----------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-search-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const permissive = {
    consume: () => ({ allowed: true }),
    consumeAll: () => ({ allowed: true }),
    peek: () => ({ allowed: true }),
  };
  const app = createApp({
    dataDir: dir,
    clock,
    rateLimiter: permissive,
    config: { demoMode: true, production: false, baseUrl: 'http://example.test' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

let rpcId = 0;
async function rpc(env, method, params) {
  const res = await fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.error, undefined, JSON.stringify(json.error));
  return json.result;
}

test('MCP tools/list: search_listings advertises the category slugs as an enum', async () => {
  const env = await startEnv();
  const { tools } = await rpc(env, 'tools/list', {});
  const search = tools.find(t => t.name === 'search_listings');
  assert.deepEqual(search.inputSchema.properties.category.enum, SLUGS);
  assert.equal(search.inputSchema.properties.category.type, 'string');
  // The other filters carry no enum.
  assert.equal(search.inputSchema.properties.city.enum, undefined);
  assert.equal(search.inputSchema.properties.query.enum, undefined);
  assert.deepEqual(tools.map(t => t.name), ['search_listings', 'get_listing', 'request_quote']);
});

test('MCP search_listings: "Plumber" and "nashville, tn" return the same listings as the slug and plain city', async () => {
  const env = await startEnv();
  const forgiving = await rpc(env, 'tools/call', {
    name: 'search_listings',
    arguments: { category: 'Plumber', city: 'nashville, tn' },
  });
  const strict = await rpc(env, 'tools/call', {
    name: 'search_listings',
    arguments: { category: 'plumbers', city: 'Nashville' },
  });
  assert.notEqual(forgiving.isError, true);
  const ids = result => result.structuredContent.listings.map(l => l.id);
  assert.ok(ids(strict).length >= 3, 'the samples include plumbers in Nashville');
  assert.deepEqual(ids(forgiving), ids(strict));
  assert.ok(forgiving.structuredContent.listings.every(l => l.category === 'plumbers'));
  assert.equal(forgiving.structuredContent.count, strict.structuredContent.count);

  // Other forgiving forms work the same way.
  for (const category of ['Plumbers', 'plumbing', 'PLUMBERS']) {
    const r = await rpc(env, 'tools/call', { name: 'search_listings', arguments: { category, city: 'Nashville, TN' } });
    assert.deepEqual(ids(r), ids(strict), category);
  }
});

test('MCP search_listings: an unknown category still returns no listings', async () => {
  const env = await startEnv();
  const r = await rpc(env, 'tools/call', { name: 'search_listings', arguments: { category: 'zebra' } });
  assert.deepEqual(r.structuredContent.listings, []);
});

test('home page: /?category=plumber&city=Nashville%2C+TN lists the plumbers', async () => {
  const env = await startEnv();
  const res = await fetch(`${env.base}/?category=plumber&city=Nashville%2C+TN`);
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const name of ['Nashville Pipe Pros', 'Honky Tonk Plumbing', 'Cumberland Drain Co.']) {
    assert.ok(html.includes(name), name);
  }
  assert.ok(!html.includes('Volt Brothers Electric'), 'electricians are not listed');
  assert.ok(html.includes('Plumbers in Nashville'), 'the heading uses the label and the city without the state');
  assert.ok(html.includes('<option value="plumbers" selected>'), 'the category select shows the slug as chosen');
  assert.ok(html.includes('name="city" value="Nashville"'));
});
