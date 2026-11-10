/**
 * Tests for task 21.2 (Séance part 2): no mock Séance in production, the
 * Séance link on a listing only when it has runs, and the gray demo headline.
 *
 * Apps run on temporary DATA_DIR copies of listings.json and categories.json
 * (plus small fixture files); the repo data/ folder is never written.
 * Providers are stubs and nothing touches the network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { createMockAssistantProvider } from '../server/lib/assistant.js';
import { seanceReportPage } from '../server/lib/seance-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'seance-production-test-token';
const START = Date.UTC(2025, 0, 15, 12, 0, 0);
const LINK_TEXT = 'See what AI says about this business';
const SEED_ID = 'nashville-pipe-pros';
const OTHER_ID = 'honky-tonk-plumbing';

// ---- environment ------------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/** A rate limiter that always allows and counts how often it was asked. */
function countingLimiter() {
  const limiter = {
    calls: 0,
    consume() { limiter.calls += 1; return { allowed: true }; },
    consumeAll() { limiter.calls += 1; return { allowed: true }; },
    peek() { return { allowed: true }; },
  };
  return limiter;
}

function stubAssistant(name = 'fake') {
  const stub = {
    name,
    calls: 0,
    async ask() {
      stub.calls += 1;
      return { answer: 'Try someone else.', provider: name };
    },
  };
  return stub;
}

/**
 * @param {{ files?: Record<string, string>, config?: object, assistantProvider?: object,
 *   rateLimiter?: object, aiBudget?: object }} [opts]
 */
async function startEnv({ files = {}, config = {}, assistantProvider, rateLimiter, aiBudget } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-seance-prod-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `run-${++n}`,
    assistantProvider,
    rateLimiter,
    aiBudget,
    config: { adminToken: TOKEN, baseUrl: 'http://example.test', ...config },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const postRun = (env, id, token = TOKEN) => fetch(`${env.base}/seance/run`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ id }),
});

async function readSeanceFile(env) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, 'seance.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const exists = async (file) => fs.access(file).then(() => true, () => false);

/** One approved owner listing: production has no sample listings. */
const PUBLISHED = JSON.stringify([{
  id: 'owner-plumbing-springfield',
  name: 'Owner Plumbing',
  category: 'plumbers',
  phone: '(615) 555-0177',
  services: ['Leak repair'],
  serviceArea: 'Greater Springfield',
  description: 'We fix pipes.',
  city: 'Springfield',
  state: 'TN',
  hours: {},
}]);
const PRODUCTION = { production: true, demoMode: false };

// ---- 4. no mock Séance in production ----------------------------------------------

test('production with the mock assistant: POST /seance/run is 503 and nothing is stored or consumed', async () => {
  const limiter = countingLimiter();
  const clock = { t: START, now() { return this.t; } };
  const budget = createAiBudget({ clock, limit: 5 });
  const env = await startEnv({
    files: { 'published.json': PUBLISHED },
    config: PRODUCTION,
    assistantProvider: createMockAssistantProvider(),
    rateLimiter: limiter,
    aiBudget: budget,
  });
  assert.ok(env.ctx.store.findById('owner-plumbing-springfield'), 'the fixture listing is public');

  const res = await postRun(env, 'owner-plumbing-springfield');
  assert.equal(res.status, 503);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await res.json(), { error: 'Séance is not connected' });

  assert.deepEqual(await readSeanceFile(env), [], 'nothing stored');
  assert.equal(limiter.calls, 0, 'no rate limit consumed');
  assert.equal(budget.peek().remaining, 5, 'no AI budget consumed');
});

test('production still needs the admin token before anything else', async () => {
  const env = await startEnv({
    files: { 'published.json': PUBLISHED },
    config: PRODUCTION,
    assistantProvider: createMockAssistantProvider(),
  });
  assert.equal((await postRun(env, 'owner-plumbing-springfield', 'wrong-token')).status, 401);
});

test('production with a real (non-mock) assistant still runs and uses the budget', async () => {
  const clock = { t: START, now() { return this.t; } };
  const budget = createAiBudget({ clock, limit: 5 });
  const assistant = stubAssistant('fake');
  const env = await startEnv({
    files: { 'published.json': PUBLISHED },
    config: PRODUCTION,
    assistantProvider: assistant,
    aiBudget: budget,
  });
  const res = await postRun(env, 'owner-plumbing-springfield');
  assert.equal(res.status, 201);
  assert.equal(assistant.calls, 1);
  assert.equal(budget.peek().remaining, 4);
  assert.equal((await readSeanceFile(env)).length, 1);
});

test('not production: the mock assistant works as before (201, stored, rate limited, no budget)', async () => {
  const limiter = countingLimiter();
  const clock = { t: START, now() { return this.t; } };
  const budget = createAiBudget({ clock, limit: 5 });
  const env = await startEnv({
    config: { production: false, demoMode: true },
    assistantProvider: createMockAssistantProvider(),
    rateLimiter: limiter,
    aiBudget: budget,
  });
  const res = await postRun(env, SEED_ID);
  assert.equal(res.status, 201);
  const { run } = await res.json();
  assert.equal(run.provider, 'mock');
  assert.equal(run.listingId, SEED_ID);
  const stored = await readSeanceFile(env);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0], run);
  assert.equal(limiter.calls, 1, 'the rate limit was consumed');
  assert.equal(budget.peek().remaining, 5, 'the mock never uses the AI budget');
});

// ---- 7. the Séance link on a listing page ------------------------------------------

test('the listing page has no Séance link without runs, and a missing seance.json does not crash it', async () => {
  const env = await startEnv({ config: { production: false, demoMode: true } });
  assert.equal(await exists(path.join(env.dir, 'seance.json')), false, 'no seance.json yet');
  const res = await fetch(`${env.base}/listings/${SEED_ID}`);
  assert.equal(res.status, 200);
  assert.ok(!(await res.text()).includes(LINK_TEXT));
});

test('the Séance link appears after a run is stored, only for that listing', async () => {
  const env = await startEnv({
    config: { production: false, demoMode: true },
    assistantProvider: stubAssistant('fake'),
  });
  assert.ok(!(await (await fetch(`${env.base}/listings/${SEED_ID}`)).text()).includes(LINK_TEXT));

  assert.equal((await postRun(env, SEED_ID)).status, 201);

  const html = await (await fetch(`${env.base}/listings/${SEED_ID}`)).text();
  assert.ok(html.includes(LINK_TEXT));
  assert.ok(html.includes(`<a href="/seance/${SEED_ID}">${LINK_TEXT}</a>`));
  const other = await (await fetch(`${env.base}/listings/${OTHER_ID}`)).text();
  assert.ok(!other.includes(LINK_TEXT), 'another listing has no runs');
});

test('the Séance link shows when seance.json already holds a run at startup', async () => {
  const run = {
    id: 'fixture-1', listingId: OTHER_ID, prompt: 'best plumbers in Nashville', provider: 'fake',
    timestamp: '2025-01-01T00:00:00.000Z', answer: 'An answer.', named: false,
  };
  const env = await startEnv({ files: { 'seance.json': JSON.stringify([run]) } });
  assert.ok((await (await fetch(`${env.base}/listings/${OTHER_ID}`)).text()).includes(LINK_TEXT));
  assert.ok(!(await (await fetch(`${env.base}/listings/${SEED_ID}`)).text()).includes(LINK_TEXT));
});

// ---- 7. the demo headline ------------------------------------------------------------

const listing = { id: 'demo-listing', name: 'Demo Plumbing' };
let counter = 0;
const makeRun = (extra = {}) => ({
  id: `r-${++counter}`,
  listingId: listing.id,
  prompt: 'best plumbers in Nashville',
  provider: 'openai',
  timestamp: '2025-01-01T00:00:00.000Z',
  answer: 'An answer.',
  named: false,
  ...extra,
});
const page = runs => seanceReportPage(listing, runs, null);

test('a mock run shows the gray demo headline, named or not', () => {
  const named = page([makeRun({ provider: 'mock', named: true })]);
  assert.ok(named.includes('<p class="seance-result seance-demo">Demo answer: AI named this business</p>'));
  assert.ok(!named.includes('seance-named') && !named.includes('seance-not-named'));

  const notNamed = page([makeRun({ provider: 'mock', named: false })]);
  assert.ok(notNamed.includes('<p class="seance-result seance-demo">Demo answer: AI didn&#39;t name this business yet</p>'));
  assert.ok(!notNamed.includes('seance-named') && !notNamed.includes('seance-not-named'));
  assert.ok(!notNamed.includes('class="seance-result seance-demo">AI '), 'the plain wording is not used for demo runs');
});

test('a real-provider run keeps the green and amber headlines', () => {
  const named = page([makeRun({ provider: 'anthropic', named: true })]);
  assert.ok(named.includes('<p class="seance-result seance-named">AI named this business</p>'));
  assert.ok(!named.includes('seance-demo'));
  assert.ok(!named.includes('Demo answer: AI'));

  const notNamed = page([makeRun({ provider: 'anthropic', named: false })]);
  assert.ok(notNamed.includes('<p class="seance-result seance-not-named">AI didn&#39;t name this business yet</p>'));
  assert.ok(!notNamed.includes('seance-demo'));
});

test('the headline follows the latest run: demo after real is gray, real after demo is not', () => {
  const demoLast = page([
    makeRun({ provider: 'openai', named: true, timestamp: '2025-01-01T00:00:00.000Z' }),
    makeRun({ provider: 'mock', named: true, timestamp: '2025-02-01T00:00:00.000Z' }),
  ]);
  assert.ok(demoLast.includes('class="seance-result seance-demo"'));

  const realLast = page([
    makeRun({ provider: 'mock', named: true, timestamp: '2025-01-01T00:00:00.000Z' }),
    makeRun({ provider: 'openai', named: true, timestamp: '2025-02-01T00:00:00.000Z' }),
  ]);
  assert.ok(realLast.includes('class="seance-result seance-named"'));
  assert.ok(!realLast.includes('class="seance-result seance-demo"'));
});

test('the details line never says mock for a mock run', () => {
  // The mock provider reports model 'mock' and runSeance stores it, so a real stored
  // mock run carries model: 'mock'. The details line must still read "demo" only.
  const html = page([
    makeRun({ provider: 'mock', model: 'mock', named: true, timestamp: '2025-01-01T00:00:00.000Z' }),
    makeRun({ provider: 'mock', model: 'mock', named: false, timestamp: '2025-02-01T00:00:00.000Z' }),
  ]);
  const details = [...html.matchAll(/<p class="seance-meta">([\s\S]*?)<\/p>/g)].map(m => m[1]);
  assert.equal(details.length, 2);
  for (const line of details) {
    assert.ok(!/mock/i.test(line), line);
    assert.ok(line.startsWith('demo'), line);
  }
  assert.ok(!/mock/i.test(html), 'the word mock appears nowhere on the page');
});
