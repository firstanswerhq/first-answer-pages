/**
 * Tests for the Seance history: append-only storage, round trip, the
 * before/after report, and the /seance routes.
 *
 * Runs against in-process servers on temporary DATA_DIRs (copies of
 * listings.json and categories.json). The real data/ directory is never written.
 *
 * Property 23: Seance history is append-only and ordered
 * **Validates: Requirements 11.5, 11.6, 11.8**
 *
 * Property 24: Seance run round trip
 * **Validates: Requirements 11.4, 11.5, 11.7**
 *
 * Examples cover Requirements 12 (report) and 13 (routes, auth, rate limits).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createRateLimiter } from '../server/lib/rate-limiter.js';
import { createSeanceStore, runSeance } from '../server/lib/seance.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2025, 0, 15, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const TOKEN = 'test-admin-token';

// data/listings.json[0] may be a _comment entry without an id.
const seedListings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'));
const LISTING_IDS = seedListings.filter(l => l && l.id).map(l => l.id);
const LISTING_NAME = Object.fromEntries(seedListings.filter(l => l && l.id).map(l => [l.id, l.name]));

// ---- environment ------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/** Fake assistant provider whose behavior each test can change. */
function makeProvider() {
  const p = {
    name: 'fake',
    answer: 'Nobody in particular.',
    fail: false,
    calls: 0,
    async ask() {
      p.calls++;
      if (p.fail) throw new Error('boom');
      return p.answer;
    },
  };
  return p;
}

async function startEnv({ adminToken = TOKEN } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-seance-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now: () => clock.t };
  const provider = makeProvider();
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `run-${++n}`,
    rateLimiter: createRateLimiter({ clock }),
    assistantProvider: provider,
    config: { adminToken, providerTimeoutMs: 2000, baseUrl: 'http://example.test' },
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
  return {
    dir,
    clock,
    provider,
    ctx: app.locals.ctx,
    store: app.locals.ctx.store,
    base: `http://127.0.0.1:${server.address().port}`,
  };
}

async function readSeanceFile(env) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, 'seance.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

let runCounter = 0;
function makeRun(listingId, extra = {}) {
  return {
    id: `fixture-${++runCounter}`,
    listingId,
    prompt: 'best plumbers in Nashville',
    provider: 'fake',
    timestamp: '2025-01-01T00:00:00.000Z',
    answer: 'An answer.',
    named: false,
    ...extra,
  };
}

const post = (env, body, { token = TOKEN, raw = false } = {}) =>
  fetch(`${env.base}/seance/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: raw ? body : JSON.stringify(body),
  });

// ---- generators -----------------------------------------------------------------

const runFields = fc.record({
  prompt: fc.fullUnicodeString({ maxLength: 40 }),
  provider: fc.constantFrom('mock', 'openai', 'anthropic'),
  timestamp: fc.date({ min: new Date('2024-01-01T00:00:00Z'), max: new Date('2026-01-01T00:00:00Z') })
    .filter(d => !Number.isNaN(d.getTime()))
    .map(d => d.toISOString()),
  answer: fc.fullUnicodeString({ maxLength: 200 }),
  named: fc.boolean(),
});

// ---- Property 23 ------------------------------------------------------------------

test('Property 23: sequential appends are all stored, in append order', async () => {
  const env = await startEnv();
  const history = createSeanceStore(env.store);
  let lane = 0;

  await fc.assert(
    fc.asyncProperty(fc.array(runFields, { maxLength: 12 }), async list => {
      const listingId = `prop-seq-${++lane}`;
      const before = (await readSeanceFile(env)).length;
      const runs = list.map(f => makeRun(listingId, f));
      for (const run of runs) await history.append(run);

      const stored = await history.list(listingId);
      assert.equal(stored.length, runs.length);
      assert.deepEqual(stored.map(r => r.id), runs.map(r => r.id));

      const file = await readSeanceFile(env);
      assert.equal(file.length, before + runs.length);
    }),
    { numRuns: 25 },
  );
});

test('Property 23: concurrent appends keep every run exactly once', async () => {
  const env = await startEnv();
  const history = createSeanceStore(env.store);
  let lane = 0;

  await fc.assert(
    fc.asyncProperty(fc.array(runFields, { minLength: 1, maxLength: 12 }), async list => {
      const listingId = `prop-par-${++lane}`;
      const runs = list.map(f => makeRun(listingId, f));
      await Promise.all(runs.map(run => history.append(run)));

      const stored = await history.list(listingId);
      assert.equal(stored.length, runs.length);
      assert.deepEqual(stored.map(r => r.id).sort(), runs.map(r => r.id).sort());
      assert.equal(new Set(stored.map(r => r.id)).size, runs.length);
      for (const run of runs) {
        assert.deepEqual(stored.find(r => r.id === run.id), run);
      }
    }),
    { numRuns: 25 },
  );
});

test('Property 23: the store exposes no update or delete', async () => {
  const env = await startEnv();
  const history = createSeanceStore(env.store);
  assert.deepEqual(Object.keys(history).sort(), ['append', 'list']);
  for (const key of Object.keys(history)) {
    assert.doesNotMatch(key, /update|delete|remove|clear|set|replace/i);
  }
});

// ---- Property 24 ------------------------------------------------------------------

test('Property 24: a run written then read from data/seance.json deep-equals the run', async () => {
  const env = await startEnv();
  const history = createSeanceStore(env.store);
  let lane = 0;

  await fc.assert(
    fc.asyncProperty(fc.fullUnicodeString({ maxLength: 4000 }), runFields, async (answer, fields) => {
      const run = makeRun(`prop-rt-${++lane}`, { ...fields, answer });
      await history.append(run);
      const file = await readSeanceFile(env);
      assert.deepEqual(file.find(r => r.id === run.id), run);
      assert.deepEqual((await history.list(run.listingId))[0], run);
    }),
    { numRuns: 20 },
  );
});

test('Property 24: runSeance truncates to 4000 code points and the stored run round-trips', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  const piece = fc.constantFrom('a', 'é', '😀', '𝒳', ' ');

  await fc.assert(
    fc.asyncProperty(fc.array(piece, { maxLength: 4100 }).map(a => a.join('')), async raw => {
      env.provider.answer = raw;
      const run = await runSeance(env.ctx, id);
      const expected = Array.from(raw).slice(0, 4000).join('');
      assert.equal(run.answer, expected);
      assert.ok(Array.from(run.answer).length <= 4000);

      const file = await readSeanceFile(env);
      assert.deepEqual(file.find(r => r.id === run.id), run);
    }),
    { numRuns: 15 },
  );
});

test('runSeance truncates an astral-only answer at exactly 4000 code points', async () => {
  const env = await startEnv();
  env.provider.answer = '😀'.repeat(4005);
  const run = await runSeance(env.ctx, LISTING_IDS[0]);
  assert.equal(Array.from(run.answer).length, 4000);
  assert.equal(run.answer, '😀'.repeat(4000));
});

// ---- report (Requirement 12) -------------------------------------------------------

test('report lists runs oldest to newest regardless of append order', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  const history = createSeanceStore(env.store);
  await history.append(makeRun(id, { timestamp: '2025-03-01T00:00:00.000Z', answer: 'answer-third' }));
  await history.append(makeRun(id, { timestamp: '2025-01-01T00:00:00.000Z', answer: 'answer-first' }));
  await history.append(makeRun(id, { timestamp: '2025-02-01T00:00:00.000Z', answer: 'answer-second' }));

  const html = await (await fetch(`${env.base}/seance/${id}`)).text();
  const all = html.slice(html.indexOf('All runs, oldest first'));
  const a = all.indexOf('answer-first');
  const b = all.indexOf('answer-second');
  const c = all.indexOf('answer-third');
  assert.ok(a >= 0 && a < b && b < c, 'runs are in timestamp order');

  const json = await (await fetch(`${env.base}/api/seance/${id}`)).json();
  assert.deepEqual(json.runs.map(r => r.answer), ['answer-first', 'answer-second', 'answer-third']);
});

test('report shows before/after labels and the changed statement for groups with 2+ runs', async () => {
  const env = await startEnv();
  const changedId = LISTING_IDS[0];
  const sameId = LISTING_IDS[1];
  const singleId = LISTING_IDS[2];
  const history = createSeanceStore(env.store);

  await history.append(makeRun(changedId, { timestamp: '2025-01-01T00:00:00.000Z', named: false }));
  await history.append(makeRun(changedId, { timestamp: '2025-02-01T00:00:00.000Z', named: true }));
  await history.append(makeRun(sameId, { timestamp: '2025-01-01T00:00:00.000Z', named: true }));
  await history.append(makeRun(sameId, { timestamp: '2025-02-01T00:00:00.000Z', named: true }));
  await history.append(makeRun(singleId, { timestamp: '2025-01-01T00:00:00.000Z' }));

  const changed = await (await fetch(`${env.base}/seance/${changedId}`)).text();
  assert.match(changed, /Before:/);
  assert.match(changed, /After:/);
  assert.match(changed, /The answer changed/);
  assert.match(changed, /did not name the business/);

  const same = await (await fetch(`${env.base}/seance/${sameId}`)).text();
  assert.match(same, /Before:/);
  assert.match(same, /No change/);
  assert.doesNotMatch(same, /The answer changed/);

  const single = await (await fetch(`${env.base}/seance/${singleId}`)).text();
  assert.doesNotMatch(single, /Before:/);
  assert.match(single, /nothing to compare yet/);

  const json = await (await fetch(`${env.base}/api/seance/${changedId}`)).json();
  assert.equal(json.groups.length, 1);
  assert.equal(json.groups[0].runCount, 2);
  assert.equal(json.groups[0].namedChanged, true);
  assert.equal(json.groups[0].before.named, false);
  assert.equal(json.groups[0].after.named, true);
});

test('report tags runs before/after owner confirmation by UTC date', async () => {
  const env = await startEnv();
  const confirmedId = LISTING_IDS[0];
  const plainId = LISTING_IDS[1];
  await fs.writeFile(path.join(env.dir, 'verified.json'), JSON.stringify({ [confirmedId]: '2025-01-10' }));
  env.store.reload();
  assert.equal(env.store.getVerifiedDate(confirmedId), '2025-01-10');

  const history = createSeanceStore(env.store);
  const stamps = ['2025-01-09T23:59:59.000Z', '2025-01-10T00:00:00.000Z', '2025-01-10T23:59:59.000Z', '2025-01-11T08:00:00.000Z'];
  for (const [i, timestamp] of stamps.entries()) {
    await history.append(makeRun(confirmedId, { timestamp, answer: `tagged-${i}` }));
    await history.append(makeRun(plainId, { timestamp, answer: `plain-${i}` }));
  }

  const json = await (await fetch(`${env.base}/api/seance/${confirmedId}`)).json();
  assert.deepEqual(
    json.runs.map(r => r.ownerConfirmation),
    ['before owner confirmation', 'after owner confirmation', 'after owner confirmation', 'after owner confirmation'],
  );

  const html = await (await fetch(`${env.base}/seance/${confirmedId}`)).text();
  assert.equal((html.match(/before owner confirmation/g) ?? []).length, 1);
  assert.equal((html.match(/after owner confirmation/g) ?? []).length, 3);

  const plainJson = await (await fetch(`${env.base}/api/seance/${plainId}`)).json();
  assert.ok(plainJson.runs.every(r => r.ownerConfirmation === null));
  const plainHtml = await (await fetch(`${env.base}/seance/${plainId}`)).text();
  assert.doesNotMatch(plainHtml, /owner confirmation/);
  assert.doesNotMatch(plainHtml, /class="seance-tag"/);
});

test('report shows the empty state when no runs are recorded', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  const html = await (await fetch(`${env.base}/seance/${id}`)).text();
  assert.match(html, /No runs have been recorded yet\./);
  const json = await (await fetch(`${env.base}/api/seance/${id}`)).json();
  assert.deepEqual(json, { id, runs: [], groups: [] });
});

test('the JSON history matches the HTML history', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  const history = createSeanceStore(env.store);
  await history.append(makeRun(id, { timestamp: '2025-01-02T00:00:00.000Z', answer: 'json-b', named: true }));
  await history.append(makeRun(id, { timestamp: '2025-01-01T00:00:00.000Z', answer: 'json-a', named: false }));
  await history.append(makeRun(id, { timestamp: '2025-01-03T00:00:00.000Z', answer: 'json-c', named: true }));
  await history.append(makeRun(LISTING_IDS[1], { answer: 'json-other' }));

  const html = await (await fetch(`${env.base}/seance/${id}`)).text();
  const json = await (await fetch(`${env.base}/api/seance/${id}`)).json();

  assert.equal(json.id, id);
  assert.deepEqual(json.runs.map(r => r.answer), ['json-a', 'json-b', 'json-c']);
  const all = html.slice(html.indexOf('All runs, oldest first'));
  const positions = json.runs.map(r => all.indexOf(r.answer));
  assert.ok(positions.every(p => p >= 0));
  assert.deepEqual([...positions].sort((x, y) => x - y), positions);
  assert.ok(!html.includes('json-other'));
  assert.equal((html.match(/class="seance-run"/g) ?? []).length, json.runs.length);
  assert.ok(json.runs.every(r => html.includes(r.timestamp)));
});

test('GET /seance/:id and /api/seance/:id return 404 for an unknown id', async () => {
  const env = await startEnv();
  const html = await fetch(`${env.base}/seance/no-such-listing`);
  assert.equal(html.status, 404);
  const api = await fetch(`${env.base}/api/seance/no-such-listing`);
  assert.equal(api.status, 404);
  assert.ok(typeof (await api.json()).error === 'string');
});

// ---- POST /seance/run (Requirement 13) ------------------------------------------------

test('POST /seance/run returns 403 when no admin token is configured', async () => {
  const env = await startEnv({ adminToken: '' });
  const res = await post(env, { id: LISTING_IDS[0] });
  assert.equal(res.status, 403);
  const withAnyToken = await post(env, { id: LISTING_IDS[0] }, { token: 'anything' });
  assert.equal(withAnyToken.status, 403);
  assert.equal(env.provider.calls, 0);
  assert.deepEqual(await readSeanceFile(env), []);
});

test('POST /seance/run returns 401 with WWW-Authenticate for a missing or wrong token', async () => {
  const env = await startEnv();
  for (const token of [null, 'wrong-token', '']) {
    const res = await post(env, { id: LISTING_IDS[0] }, { token });
    assert.equal(res.status, 401);
    assert.ok(res.headers.get('www-authenticate'));
  }
  assert.equal(env.provider.calls, 0);
});

test('POST /seance/run returns 400 for a bad body and 404 for an unknown id', async () => {
  const env = await startEnv();
  for (const body of [{}, { id: 5 }, { id: '' }, []]) {
    assert.equal((await post(env, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await post(env, '{not json', { raw: true })).status, 400);

  const unknown = await post(env, { id: 'no-such-listing' });
  assert.equal(unknown.status, 404);
  assert.equal(env.provider.calls, 0);
  assert.deepEqual(await readSeanceFile(env), []);
});

test('POST /seance/run returns 201 with the run and stores it', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  env.provider.answer = `Try ${LISTING_NAME[id]} first.`;
  const res = await post(env, { id });
  assert.equal(res.status, 201);
  const { run } = await res.json();
  assert.equal(run.listingId, id);
  assert.equal(run.provider, 'fake');
  assert.equal(run.named, true);
  assert.equal(run.answer, env.provider.answer);
  assert.equal(run.timestamp, new Date(START).toISOString());

  const file = await readSeanceFile(env);
  assert.equal(file.length, 1);
  assert.deepEqual(file[0], run);
});

test('POST /seance/run returns 429 with Retry-After for a second run on the same listing within 10 minutes', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  assert.equal((await post(env, { id })).status, 201);

  env.clock.t += 60 * 1000;
  const second = await post(env, { id });
  assert.equal(second.status, 429);
  const retry = Number(second.headers.get('retry-after'));
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 600, `retry-after ${retry}`);
  assert.equal((await readSeanceFile(env)).length, 1);

  env.clock.t += 10 * 60 * 1000;
  assert.equal((await post(env, { id })).status, 201);
});

test('POST /seance/run returns 429 with Retry-After for the 11th run per ip in an hour', async () => {
  const env = await startEnv();
  assert.ok(LISTING_IDS.length >= 11, 'seed data has enough listings');
  for (const id of LISTING_IDS.slice(0, 10)) {
    assert.equal((await post(env, { id })).status, 201);
  }
  const eleventh = await post(env, { id: LISTING_IDS[10] });
  assert.equal(eleventh.status, 429);
  const retry = Number(eleventh.headers.get('retry-after'));
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 3600, `retry-after ${retry}`);
  assert.equal((await readSeanceFile(env)).length, 10);

  env.clock.t += HOUR + 1000;
  assert.equal((await post(env, { id: LISTING_IDS[10] })).status, 201);
});

test('POST /seance/run returns 502 and stores nothing when the provider throws', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  env.provider.fail = true;
  const res = await post(env, { id });
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.doesNotMatch(text, /boom/);
  assert.equal(env.provider.calls, 1);
  assert.deepEqual(await readSeanceFile(env), []);
  const json = await (await fetch(`${env.base}/api/seance/${id}`)).json();
  assert.deepEqual(json.runs, []);
});

test('an assistant answer containing <script> is escaped in the HTML report', async () => {
  const env = await startEnv();
  const id = LISTING_IDS[0];
  env.provider.answer = '<script>alert(1)</script> & "quotes"';
  assert.equal((await post(env, { id })).status, 201);

  const html = await (await fetch(`${env.base}/seance/${id}`)).text();
  assert.ok(!html.includes('<script>alert(1)'), 'raw script tag is not present');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script tag is escaped');
});
