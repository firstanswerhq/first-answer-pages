/**
 * Tests for the daily AI cap: unit tests for createAiBudget, and integration
 * tests that /rise and POST /seance/run share one budget. Providers are stubs;
 * nothing touches the network. Temp DATA_DIR copies keep data/ untouched.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'ai-budget-test-token';
const LISTING_ID = 'nashville-pipe-pros';
const LIMIT_MESSAGE = "We have reached today's limit for AI help. Try again tomorrow.";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOON = Date.UTC(2025, 0, 15, 12, 0, 0);
const CHICAGO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });

function fakeClock(t = NOON) {
  return { t, now() { return this.t; } };
}

// ---- unit tests ---------------------------------------------------------------

test('consume() allows up to the limit, then denies without counting', () => {
  const budget = createAiBudget({ clock: fakeClock(), limit: 3 });
  assert.deepEqual(
    [budget.consume().remaining, budget.consume().remaining, budget.consume().remaining],
    [2, 1, 0],
  );
  const denied = budget.consume();
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(budget.consume().allowed, false);
});

test('peek() reports state without consuming', () => {
  const budget = createAiBudget({ clock: fakeClock(), limit: 1 });
  assert.equal(budget.peek().allowed, true);
  assert.equal(budget.peek().remaining, 1);
  assert.equal(budget.consume().allowed, true);
  const peeked = budget.peek();
  assert.equal(peeked.allowed, false);
  assert.equal(peeked.remaining, 0);
});

// NOON is 6:00 AM CST on Jan 15, so Chicago midnight is 18 hours away (06:00 UTC).
test('resetsAt and retryAfterSeconds point at the next Chicago midnight', () => {
  const budget = createAiBudget({ clock: fakeClock(), limit: 1 });
  const r = budget.consume();
  assert.equal(r.resetsAt, '2025-01-16T06:00:00.000Z');
  assert.equal(r.retryAfterSeconds, 18 * 60 * 60);
});

test('Chicago midnight follows daylight saving time (CDT is UTC-5)', () => {
  // 12:00 UTC on Jul 15 is 7:00 AM CDT; midnight CDT is 05:00 UTC the next day.
  const budget = createAiBudget({ clock: fakeClock(Date.UTC(2025, 6, 15, 12, 0, 0)), limit: 1 });
  const r = budget.consume();
  assert.equal(r.resetsAt, '2025-07-16T05:00:00.000Z');
  assert.equal(r.retryAfterSeconds, 17 * 60 * 60);
});

test('retryAfterSeconds is at least 1 right before midnight', () => {
  const budget = createAiBudget({ clock: fakeClock(Date.UTC(2025, 0, 16, 5, 59, 59, 999)), limit: 1 });
  assert.equal(budget.peek().retryAfterSeconds, 1);
});

test('the count resets at Chicago midnight', () => {
  const clock = fakeClock(Date.UTC(2025, 0, 16, 5, 59, 0));
  const budget = createAiBudget({ clock, limit: 2 });
  assert.equal(budget.consume().allowed, true);
  assert.equal(budget.consume().allowed, true);
  assert.equal(budget.consume().allowed, false);
  clock.t = Date.UTC(2025, 0, 16, 6, 0, 0);
  assert.equal(budget.peek().remaining, 2);
  assert.equal(budget.consume().allowed, true);
});

test('photo uploads are held to min(150, limit) and never block Séance runs', () => {
  const budget = createAiBudget({ clock: fakeClock(), limit: 4, photoLimit: 2 });
  assert.equal(budget.consume({ kind: 'photo' }).allowed, true);
  assert.equal(budget.consume({ kind: 'photo' }).allowed, true);
  assert.equal(budget.consume({ kind: 'photo' }).allowed, false);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, true);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, true);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, false);
  assert.equal(createAiBudget({ clock: fakeClock(), limit: 1000 }).photoLimit, 150);
  assert.equal(createAiBudget({ clock: fakeClock(), limit: 10 }).photoLimit, 10);
});

test('the day count is saved to the file and restored; a corrupt file starts at zero', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-budget-file-'));
  try {
    const file = path.join(dir, 'ai-budget.json');
    const clock = fakeClock();
    const first = createAiBudget({ clock, limit: 3, file });
    first.consume({ kind: 'photo' });
    first.consume({ kind: 'seance' });
    await first.flush();
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { day: '2025-01-15', total: 2, photo: 1 });

    const restarted = createAiBudget({ clock, limit: 3, file });
    assert.equal(restarted.peek().remaining, 1);
    clock.t += DAY_MS; // a new Chicago day ignores yesterday's saved count
    assert.equal(restarted.peek().remaining, 3);

    await fs.writeFile(file, '{not json');
    assert.equal(createAiBudget({ clock: fakeClock(), limit: 3, file }).peek().remaining, 3);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('invalid limit falls back to the default', () => {
  const budget = createAiBudget({ clock: fakeClock(), limit: 0 });
  assert.equal(budget.limit, 200);
});

test('Property: never more than `limit` calls allowed per Chicago day', () => {
  // **Validates: daily AI cap**
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 10 }),
      fc.array(fc.integer({ min: 0, max: 2 * DAY_MS }), { minLength: 1, maxLength: 60 }),
      (limit, offsets) => {
        const clock = fakeClock(NOON);
        const budget = createAiBudget({ clock, limit });
        const allowedPerDay = new Map();
        let t = NOON;
        for (const step of offsets) {
          t += step % (DAY_MS / 2); // time only moves forward
          clock.t = t;
          const day = CHICAGO_DAY.format(new Date(t));
          if (budget.consume().allowed) {
            allowedPerDay.set(day, (allowedPerDay.get(day) ?? 0) + 1);
          }
        }
        for (const n of allowedPerDay.values()) assert.ok(n <= limit);
      },
    ),
    { numRuns: 100 },
  );
});

// ---- integration --------------------------------------------------------------

const envs = [];

const permissiveLimiter = {
  consume: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  consumeAll: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
  peek: () => ({ allowed: true, remaining: 999, retryAfterSeconds: 0 }),
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

/** Stubs that count calls; `name` decides whether the route treats them as real. */
function makeEnvStubs(name) {
  const calls = { vision: 0, assistant: 0 };
  return {
    calls,
    visionProvider: {
      name,
      async extract() {
        calls.vision += 1;
        return {
          name: 'Stub Plumbing', category: 'plumbers', phone: '(615) 555-0101',
          services: ['Leak repair'], serviceArea: 'Springfield',
          description: 'We fix pipes.', city: 'Springfield', state: 'TN',
          hours: { monday: '7:00 AM - 5:00 PM' },
        };
      },
    },
    assistantProvider: {
      name,
      async ask() {
        calls.assistant += 1;
        return { answer: 'Try Nashville Pipe Pros.' };
      },
    },
  };
}

async function makeEnv({ providerName, limit }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-budget-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = fakeClock();
  const stubs = makeEnvStubs(providerName);
  let counter = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `id-${++counter}`,
    rateLimiter: permissiveLimiter,
    visionProvider: stubs.visionProvider,
    assistantProvider: stubs.assistantProvider,
    config: { adminToken: TOKEN, maxAiCallsPerDay: limit },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = { dir, server, calls: stubs.calls, base: `http://127.0.0.1:${server.address().port}` };
  envs.push(env);
  return env;
}

after(async () => {
  for (const env of envs) {
    env.server.closeAllConnections?.();
    await new Promise(resolve => env.server.close(resolve));
    await fs.rm(env.dir, { recursive: true, force: true });
  }
});

const postRise = env => fetch(`${env.base}/rise`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'image/jpeg' },
  body: JPEG,
});

const postSeance = env => fetch(`${env.base}/seance/run`, {
  method: 'POST',
  headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify({ id: LISTING_ID }),
});

test('/rise and /seance/run share one budget; over the cap /rise returns a 429 page', async () => {
  const env = await makeEnv({ providerName: 'anthropic', limit: 2 });

  assert.equal((await postSeance(env)).status, 201);
  assert.equal((await postRise(env)).status, 303);

  const res = await postRise(env);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), String(18 * 60 * 60));
  assert.match(res.headers.get('content-type'), /html/);
  assert.match(await res.text(), /Try again tomorrow/);
  assert.equal(env.calls.vision, 1);
});

test('over the cap POST /seance/run returns 429 JSON with Retry-After', async () => {
  const env = await makeEnv({ providerName: 'anthropic', limit: 2 });

  assert.equal((await postRise(env)).status, 303);
  assert.equal((await postSeance(env)).status, 201);

  const res = await postSeance(env);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), String(18 * 60 * 60));
  assert.deepEqual(await res.json(), { error: LIMIT_MESSAGE });
  assert.equal(env.calls.assistant, 1);
});

test('mock-named providers never consume the budget', async () => {
  const env = await makeEnv({ providerName: 'mock', limit: 1 });

  for (let i = 0; i < 3; i++) {
    assert.equal((await postRise(env)).status, 303);
    assert.equal((await postSeance(env)).status, 201);
  }
  assert.equal(env.calls.vision, 3);
  assert.equal(env.calls.assistant, 3);
  assert.equal(env.server.listening, true);
});

test('no answer is produced once the cap is exhausted', async () => {
  const env = await makeEnv({ providerName: 'anthropic', limit: 1 });

  assert.equal((await postSeance(env)).status, 201);
  const res = await postSeance(env);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(body.run, undefined);
  assert.equal(env.calls.assistant, 1);

  const history = await (await fetch(`${env.base}/api/seance/${LISTING_ID}`)).json();
  assert.equal(history.runs.length, 1);
});
