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
