/**
 * app.test.js — the A2A seam (Requirement 8).
 * Express 4.19.2 is pinned, so the router stack lives at app._router.stack.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import defaultApp, { createApp } from '../server/app.js';
import { mountA2A, AGENT_CARD_PATH } from '../server/routes/a2a.js';

const DATA_SRC = fileURLToPath(new URL('../data/', import.meta.url));

let tmpDir;
const servers = [];

/** Start an app on an ephemeral loopback port; returns the base URL. */
async function start(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

/** True when a top-level route layer matches the given path. */
function hasRoute(app, routePath) {
  return (app._router?.stack ?? []).some((layer) => layer.route?.path === routePath);
}

before(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'fap-app-'));
  await copyFile(path.join(DATA_SRC, 'listings.json'), path.join(tmpDir, 'listings.json'));
  await copyFile(path.join(DATA_SRC, 'categories.json'), path.join(tmpDir, 'categories.json'));
});

after(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await rm(tmpDir, { recursive: true, force: true });
});

test('without an a2a dep the card path is 404 and no route is registered', async () => {
  const app = createApp({ dataDir: tmpDir });
  assert.equal(hasRoute(app, AGENT_CARD_PATH), false);

  const base = await start(app);
  const res = await fetch(`${base}${AGENT_CARD_PATH}`);
  assert.equal(res.status, 404);
});

test('the default exported app returns 404 for the card path', async () => {
  assert.equal(hasRoute(defaultApp, AGENT_CARD_PATH), false);

  const base = await start(defaultApp);
  const res = await fetch(`${base}${AGENT_CARD_PATH}`);
  assert.equal(res.status, 404);
});

test('with a stub a2a dep the card and the endpoint exist together', async () => {
  const card = { name: 'x', url: 'http://example.test/a2a' };
  const a2a = { card, path: '/a2a', handler: (req, res) => res.json({ ok: true }) };
  const app = createApp({ dataDir: tmpDir, a2a });

  assert.equal(hasRoute(app, AGENT_CARD_PATH), true);
  assert.equal(hasRoute(app, '/a2a'), true);

  const base = await start(app);

  const cardRes = await fetch(`${base}${AGENT_CARD_PATH}`);
  assert.equal(cardRes.status, 200);
  assert.deepEqual(await cardRes.json(), card);

  const postRes = await fetch(`${base}/a2a`, { method: 'POST' });
  assert.equal(postRes.status, 200);
  assert.deepEqual(await postRes.json(), { ok: true });
});

test('mountA2A throws when card, path or handler is missing', () => {
  const good = { card: { name: 'x' }, path: '/a2a', handler: () => {} };
  const mk = () => ({ get() {}, post() {} });

  assert.throws(() => mountA2A(mk(), undefined));
  assert.throws(() => mountA2A(mk(), { ...good, card: undefined }));
  assert.throws(() => mountA2A(mk(), { ...good, card: null }));
  assert.throws(() => mountA2A(mk(), { ...good, path: undefined }));
  assert.throws(() => mountA2A(mk(), { ...good, path: 'a2a' }));
  assert.throws(() => mountA2A(mk(), { ...good, handler: undefined }));

  // A failed mount registers nothing, so card and endpoint are never split.
  const calls = [];
  const spy = { get: (...a) => calls.push(a), post: (...a) => calls.push(a) };
  assert.throws(() => mountA2A(spy, { ...good, handler: undefined }));
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// README quote limit (task 15.8)
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { RULES, createRateLimiter } from '../server/lib/rate-limiter.js';

test('README documents the quote limit as per client per listing', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('3 per hour per client per listing'));
  assert.ok(!readme.includes('Quote requests for one listing | 3 per hour per listing'));
});

test('README says TRUST_PROXY accepts only a whole-number hop count', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes('hop count'));
});

test('quote-listing rule matches the README (3 per hour)', () => {
  assert.deepEqual({ ...RULES['quote-listing'] }, { limit: 3, windowMs: 3600000 });
});

test('quote limit is per client per listing: 4th for same ip+listing is refused', () => {
  let t = 1_000_000;
  const limiter = createRateLimiter({ clock: { now: () => t } });
  const ip = '203.0.113.7';
  const quoteFor = (listing) => limiter.consumeAll([
    { key: `quote:${ip}`, ...RULES.quote },
    { key: `quote:${ip}:${listing}`, ...RULES['quote-listing'] },
  ]);

  assert.equal(quoteFor('listingA').allowed, true);
  t += 1000;
  assert.equal(quoteFor('listingA').allowed, true);
  t += 1000;
  assert.equal(quoteFor('listingA').allowed, true);
  t += 1000;
  assert.equal(quoteFor('listingA').allowed, false);
  // Same client, different listing is still allowed.
  assert.equal(quoteFor('listingB').allowed, true);
});

// ---------------------------------------------------------------------------
// README content checks (task 18.4)
// ---------------------------------------------------------------------------

import { readdirSync } from 'node:fs';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const README_TEXT = readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
const TEXT_EXTENSIONS = new Set(['.js', '.html', '.css', '.md', '.json']);

/** Every text file (relative to the repo root) under the given top-level folders. */
function textFilesUnder(folders) {
  const files = [];
  for (const folder of folders) {
    const base = path.join(ROOT_DIR, folder);
    let entries;
    try {
      entries = readdirSync(base, { recursive: true });
    } catch {
      continue; // folder missing: nothing to scan
    }
    for (const entry of entries) {
      const full = path.join(base, String(entry));
      if (!TEXT_EXTENSIONS.has(path.extname(full).toLowerCase())) continue;
      files.push({ rel: path.join(folder, String(entry)), full });
    }
  }
  return files;
}

const ENV_VARS_IN_README = [
  'PORT', 'BASE_URL', 'DATA_DIR', 'ADMIN_TOKEN', 'TRUST_PROXY', 'DEMO_MODE',
  'SITE_NAME', 'NODE_ENV', 'VISION_PROVIDER', 'VISION_API_KEY', 'VISION_MODEL',
  'VISION_BASE_URL', 'NOTIFIER', 'SEANCE_PROVIDER', 'SEANCE_API_KEY',
  'SEANCE_MODEL', 'SEANCE_BASE_URL', 'SEANCE_ADMIN_TOKEN',
];

test('README mentions every documented environment variable', () => {
  for (const name of ENV_VARS_IN_README) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(README_TEXT), `README is missing ${name}`);
  }
});

test('README does not use the old product name', () => {
  assert.ok(!/super\s*pages/i.test(README_TEXT), 'README contains "Super Pages"');
  assert.ok(!/superpages/i.test(README_TEXT), 'README contains "SUPERPAGES"');
});

test('README, server/, public/ and mcp/ have no trademarked phone-book names', () => {
  const files = [
    { rel: 'README.md', full: path.join(ROOT_DIR, 'README.md') },
    ...textFilesUnder(['server', 'public', 'mcp']),
  ];
  for (const { rel, full } of files) {
    const text = readFileSync(full, 'utf8');
    assert.ok(!/yellow\s*pages/i.test(text), `${rel} contains "Yellow Pages"`);
    assert.ok(!/\bYP\b/.test(text), `${rel} contains the word "YP"`);
    assert.ok(!/walking[\s-]*fingers/i.test(text), `${rel} mentions walking fingers`);
  }
});

test('server/ and public/ contain no "Super Pages" strings', () => {
  for (const { rel, full } of textFilesUnder(['server', 'public'])) {
    const text = readFileSync(full, 'utf8');
    assert.ok(!/super\s*pages/i.test(text), `${rel} contains "Super Pages"`);
    assert.ok(!/superpages/i.test(text), `${rel} contains "SuperPages"`);
  }
});

test('every environment variable read under server/ appears in the README', () => {
  const patterns = [
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
    /\benv\.([A-Z][A-Z0-9_]*)/g,
    /env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  ];
  const found = new Map(); // name -> first file that reads it
  for (const { rel, full } of textFilesUnder(['server'])) {
    if (path.extname(full) !== '.js') continue;
    const text = readFileSync(full, 'utf8');
    for (const re of patterns) {
      for (const match of text.matchAll(re)) {
        if (!found.has(match[1])) found.set(match[1], rel);
      }
    }
  }
  assert.ok(found.size > 0, 'scan found no environment variables under server/');
  const names = [...found.keys()].sort().join(', ');
  for (const [name, rel] of found) {
    assert.ok(
      new RegExp(`\\b${name}\\b`).test(README_TEXT),
      `README does not mention ${name} (read in ${rel}). Names found by scan: ${names}`,
    );
  }
});
