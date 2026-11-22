/**
 * The day's counts for the bot protection (Feature G, task G3): the counters in the AI budget, the guard that
 * names them, and where POST /grade counts. Fake clock, fake verifier, fake assistant; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { createGradeGuard } from '../server/lib/grade-guard.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 9, 18, 0, 0); // noon on Nov 9 in Chicago
const DAY = 24 * 60 * 60 * 1000;
const TODAY = '2026-11-09';
const GOOD = 'good-token-111';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function tempDir(prefix = 'fap-grade-counts-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {}));
  return dir;
}

const fakeClock = (t = START) => ({ t, now() { return this.t; } });
const budgetFor = (clock, file) => createAiBudget({ clock, limit: 200, gradeLimit: 60, file });
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

// ---- the counters in the AI budget --------------------------------------------------------------

test('G3: note counts by name, notes() lists them, and a name that is not a plain word counts nothing', async () => {
  const dir = await tempDir();
  const budget = budgetFor(fakeClock(), path.join(dir, 'ai-budget.json'));
  assert.deepEqual(budget.notes(), {});
  assert.equal(budget.note('checks'), 1);
  assert.equal(budget.note('human'), 1);
  assert.equal(budget.note('human'), 2);
  assert.deepEqual(budget.notes(), { checks: 1, human: 2 });
  for (const bad of ['', ' ', 'a b', '__proto__', 'once:x', '1abc', 'x'.repeat(41), undefined, null, 5, {}]) {
    assert.equal(budget.note(bad), 0, String(bad));
  }
  assert.deepEqual(budget.notes(), { checks: 1, human: 2 });
  assert.equal(Object.getPrototypeOf(budget.notes()), Object.prototype);
  assert.equal({}.x, undefined, 'nothing leaked onto Object.prototype');
});

test('G3: usage gives used, left and limit for the Grader share, and follows the shared caps', () => {
  const clock = fakeClock();
  const budget = createAiBudget({ clock, limit: 8, gradeLimit: 60 }); // shared cap is 8 - 2 = 6
  assert.deepEqual(budget.usage({ kind: 'grade' }), { used: 0, left: 6, limit: 60 });
  assert.deepEqual(budget.usage(), { used: 0, left: 6, limit: 60 }, 'grade is the default kind');
  budget.consume({ kind: 'grade' });
  budget.consume({ kind: 'grade' });
  budget.consume({ kind: 'photo' });
  const u = budget.usage({ kind: 'grade' });
  assert.equal(u.used, 2);
  assert.equal(u.left, 3, 'held down by the shared cap, not by the setting');
  assert.ok(u.used + u.left < u.limit);
  assert.equal(budget.usage({ kind: 'photo' }).used, 1);
  assert.equal(budget.usage({ kind: 'seance' }).used, 3);
});

test('G3: the counters survive a restart the same day and reset on a new Chicago day', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  const clock = fakeClock();
  const first = budgetFor(clock, file);
  first.consume({ kind: 'grade' });
  first.note('checks');
  first.note('human');
  first.note('human');
  first.note('network');
  await first.flush();
  assert.deepEqual((await readJson(file)).notes, { checks: 1, human: 2, network: 1 });

  // A restart the same day: a new budget on the same file.
  const second = budgetFor(clock, file);
  assert.deepEqual(second.notes(), { checks: 1, human: 2, network: 1 });
  assert.equal(second.usage({ kind: 'grade' }).used, 1);
  second.note('human');
  assert.equal(second.notes().human, 3);

  // The next Chicago day starts at zero, and the spending counts do too.
  clock.t += DAY;
  assert.deepEqual(second.notes(), {});
  assert.equal(second.usage({ kind: 'grade' }).used, 0);
  second.note('checks');
  await second.flush();
  const saved = await readJson(file);
  assert.equal(saved.day, '2026-11-10');
  assert.deepEqual(saved.notes, { checks: 1 });
  // A restart on the new day keeps the new day's counter.
  const third = budgetFor(clock, file);
  assert.deepEqual(third.notes(), { checks: 1 });
});

test('G3: a file saved on an earlier day loads, and its counters are gone on the new day', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  await fs.writeFile(file, JSON.stringify({ day: '2026-11-08', total: 7, photo: 2, grade: 3, notes: { human: 4, 'once:email50': 1 } }));
  const budget = budgetFor(fakeClock(), file);
  assert.deepEqual(budget.notes(), {});
  assert.equal(budget.usage({ kind: 'seance' }).used, 0);
  assert.equal(budget.once('email50'), true, 'yesterday\'s flag does not count today');
});

test('G3: once is true the first time on a day, false after, also after a restart, and true again the next day', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  const clock = fakeClock();
  const budget = budgetFor(clock, file);
  assert.equal(budget.once('email50'), true);
  assert.equal(budget.once('email50'), false);
  assert.equal(budget.once('email90'), true, 'each name has its own flag');
  assert.equal(budget.once('email90'), false);
  assert.deepEqual(budget.notes(), {}, 'flags are not counters');
  await budget.flush();

  const restarted = budgetFor(clock, file);
  assert.equal(restarted.once('email50'), false);
  assert.equal(restarted.once('email90'), false);
  assert.equal(restarted.once('humanSetup'), true);

  clock.t += DAY;
  assert.equal(restarted.once('email50'), true);
  assert.equal(restarted.once('email50'), false);
  for (const bad of ['', 'a b', '__proto__', undefined, 7]) assert.equal(restarted.once(bad), false, String(bad));
});

test('G3: an old budget file without notes loads, and stays without notes until a counter is used', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  await fs.writeFile(file, JSON.stringify({ day: TODAY, total: 5, photo: 1 }));
  const budget = budgetFor(fakeClock(), file);
  assert.deepEqual(budget.notes(), {});
  assert.equal(budget.usage({ kind: 'seance' }).used, 5);
  budget.consume({ kind: 'seance' });
  await budget.flush();
  const saved = await readJson(file);
  assert.deepEqual(saved, { day: TODAY, total: 6, photo: 1 }, 'no notes key');
  assert.equal(Object.hasOwn(saved, 'notes'), false);
});

test('G3: a notes value that is a string, an array or not made of counts is ignored and the day\'s counts are kept', async () => {
  const bad = [
    'a string', ['checks', 'human'], 5, true, null,
    { checks: '3' }, { checks: -1 }, { checks: 1.5 }, { checks: null }, { checks: [1] },
  ];
  for (const notes of bad) {
    const dir = await tempDir();
    const file = path.join(dir, 'ai-budget.json');
    await fs.writeFile(file, JSON.stringify({ day: TODAY, total: 9, photo: 2, grade: 4, notes }));
    const budget = budgetFor(fakeClock(), file);
    assert.deepEqual(budget.notes(), {}, JSON.stringify(notes));
    assert.equal(budget.usage({ kind: 'seance' }).used, 9, `total kept for ${JSON.stringify(notes)}`);
    assert.equal(budget.usage({ kind: 'photo' }).used, 2, `photo kept for ${JSON.stringify(notes)}`);
    assert.equal(budget.usage({ kind: 'grade' }).used, 4, `grade kept for ${JSON.stringify(notes)}`);
    // The file was not thrown away: a new counter is added to it.
    budget.note('checks');
    await budget.flush();
    const saved = await readJson(file);
    assert.deepEqual([saved.total, saved.photo, saved.grade], [9, 2, 4]);
    assert.deepEqual(saved.notes, { checks: 1 });
  }
});

test('G3: good entries in notes are kept next to bad ones, and odd names never reach Object.prototype', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  await fs.writeFile(file, '{"day":"2026-11-09","total":3,"photo":0,"notes":{"human":2,"checks":"x","__proto__":{"polluted":1},"a b":3,"once:email50":1}}');
  const budget = budgetFor(fakeClock(), file);
  assert.deepEqual(budget.notes(), { human: 2 });
  assert.equal(budget.once('email50'), false, 'a saved flag is kept');
  assert.equal({}.polluted, undefined);
  assert.equal(budget.usage({ kind: 'seance' }).used, 3);
});

test('G3: only a bad day, total or photo drops the file, as before', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  await fs.writeFile(file, JSON.stringify({ day: TODAY, total: 'x', photo: 1, notes: { human: 2 } }));
  const budget = budgetFor(fakeClock(), file);
  assert.deepEqual(budget.notes(), {});
  assert.equal(budget.usage({ kind: 'seance' }).used, 0);
});

// ---- the guard ----------------------------------------------------------------------------------

test('G3: the guard names the counters and gives today\'s numbers', async () => {
  const dir = await tempDir();
  const budget = budgetFor(fakeClock(), path.join(dir, 'ai-budget.json'));
  const guard = createGradeGuard({ aiBudget: budget });
  assert.deepEqual(guard.summary(), {
    usage: { used: 0, left: 60, limit: 60 },
    counts: { checks: 0, humanPass: 0, human: 0, limit: 0, network: 0 },
    misconfigured: false,
  });
  guard.turnedAway('human');
  guard.turnedAway('human');
  guard.turnedAway('limit');
  guard.turnedAway('network');
  guard.passed();
  guard.started();
  guard.started();
  guard.started();
  guard.turnedAway('something-else');
  guard.turnedAway(undefined);
  budget.consume({ kind: 'grade' });
  const s = guard.summary();
  assert.deepEqual(s.counts, { checks: 3, humanPass: 1, human: 2, limit: 1, network: 1 });
  assert.equal(s.usage.used, 1);
  assert.equal(s.misconfigured, false);
  guard.misconfigured();
  assert.equal(guard.summary().misconfigured, true);
  assert.equal(guard.watch(), undefined, 'the heads-up emails come later; watching does nothing yet');
});

test('G3: the guard never throws, even without a budget or with one that fails', () => {
  const boom = () => { throw new Error('disk gone'); };
  const lines = [];
  for (const aiBudget of [undefined, {}, { note: boom, usage: boom, notes: boom }]) {
    const guard = createGradeGuard({ aiBudget, log: line => lines.push(line) });
    guard.turnedAway('human');
    guard.passed();
    guard.started();
    guard.misconfigured();
    guard.watch();
    assert.deepEqual(guard.summary().counts, { checks: 0, humanPass: 0, human: 0, limit: 0, network: 0 });
  }
  assert.ok(lines.every(l => /^guard-[a-z-]+$/.test(l)), 'a log line holds no detail');
});

// ---- where POST /grade counts -------------------------------------------------------------------

function fakeVerifier(answer = token => (token === GOOD ? 'ok' : 'failed')) {
  return {
    siteKey: 'site-key-ABC123',
    async verify(token) {
      return typeof answer === 'function' ? answer(token) : answer;
    },
  };
}

async function startEnv({ turnstile, gradeGuard, config = {} } = {}) {
  const dir = await tempDir('fap-grade-counts-env-');
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = fakeClock();
  let n = 0;
  const counts = { asked: 0 };
  const assistant = {
    name: 'anthropic',
    async ask() { counts.asked += 1; return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; },
  };
  const deps = {
    dataDir: dir,
    clock,
    assistantProvider: assistant,
    extraAssistants: [],
    safeFetcher: { async fetchText() { throw new Error('no network in tests'); } },
    newGradeId: () => `count${String(++n).padStart(17, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'counts-test-token',
      trustProxy: 1, gradeAiCallsPerDay: 150, ...config,
    },
  };
  if (turnstile !== undefined) deps.turnstile = turnstile;
  if (gradeGuard !== undefined) deps.gradeGuard = gradeGuard;
  const app = createApp(deps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await app.locals.ctx.aiBudget?.flush?.();
  });
  return { dir, clock, counts, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

let service = 0;

async function startCheck(env, ip, extra = {}, { skipStamp = false, waitSeconds = 5 } = {}) {
  const page = await (await fetch(`${env.base}/grade`, { headers: { 'x-forwarded-for': ip } })).text();
  const t = skipStamp ? 'not-a-stamp' : /name="t" value="([^"]+)"/.exec(page)[1];
  env.clock.t += waitSeconds * 1000;
  service += 1;
  return fetch(`${env.base}/grade`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': ip },
    body: new URLSearchParams({
      nickname: '', t, name: `Shop ${service}`, city: 'Nashville', state: 'TN', service: 'accountants', website: '', ...extra,
    }),
  });
}

const withToken = token => ({ 'cf-turnstile-response': token });
const zero = { checks: 0, humanPass: 0, human: 0, limit: 0, network: 0 };
const counted = env => env.ctx.gradeGuard.summary().counts;

test('G3: a started Grade counts checks, and a check with no human check on counts no pass', async () => {
  const env = await startEnv({ turnstile: null });
  assert.equal((await startCheck(env, '203.0.113.5')).status, 303);
  assert.equal((await startCheck(env, '203.0.113.6')).status, 303);
  assert.deepEqual(counted(env), { ...zero, checks: 2 });
});

test('G3: an ok from the human check counts a pass; a failed one counts human and nothing else', async () => {
  const env = await startEnv({ turnstile: fakeVerifier() });
  assert.equal((await startCheck(env, '203.0.113.5', withToken(GOOD))).status, 303);
  assert.deepEqual(counted(env), { ...zero, humanPass: 1, checks: 1 });
  for (let i = 0; i < 3; i += 1) assert.equal((await startCheck(env, '203.0.113.5', withToken('bad'))).status, 422);
  assert.equal((await startCheck(env, '203.0.113.5')).status, 422, 'no token at all');
  assert.deepEqual(counted(env), { ...zero, humanPass: 1, checks: 1, human: 4 });
  assert.equal(env.ctx.gradeGuard.summary().misconfigured, false);
});

test('G3: a check let through because Cloudflare could not be asked is not a pass', async () => {
  for (const verdict of ['unreachable', 'misconfigured']) {
    const env = await startEnv({ turnstile: fakeVerifier(verdict) });
    assert.equal((await startCheck(env, '203.0.113.5', withToken(GOOD))).status, 303);
    assert.deepEqual(counted(env), { ...zero, checks: 1 }, verdict);
    assert.equal(env.ctx.gradeGuard.summary().misconfigured, verdict === 'misconfigured', verdict);
  }
});

test('G3: a per-address refusal counts limit and a per-network refusal counts network, and neither counts a Grade', async () => {
  const env = await startEnv({ turnstile: null, config: { gradeNetworkPerDay: 6 } });
  for (let i = 0; i < 5; i += 1) assert.equal((await startCheck(env, '203.0.113.7')).status, 303);
  assert.equal((await startCheck(env, '203.0.113.7')).status, 429);
  assert.equal((await startCheck(env, '203.0.113.7')).status, 429);
  assert.deepEqual(counted(env), { ...zero, checks: 5, limit: 2 });
  // One more from a neighbor fills the network (6); the next one from it is refused by the network.
  assert.equal((await startCheck(env, '203.0.113.8')).status, 303);
  assert.equal((await startCheck(env, '203.0.113.9')).status, 429);
  assert.deepEqual(counted(env), { ...zero, checks: 6, limit: 2, network: 1 });
});

test('G3: the honeypot, the form timer and a form with a mistake are not counted', async () => {
  const env = await startEnv({ turnstile: fakeVerifier() });
  assert.equal((await startCheck(env, '203.0.113.5', { ...withToken(GOOD), nickname: 'bot' })).status, 422);
  assert.equal((await startCheck(env, '203.0.113.5', withToken(GOOD), { waitSeconds: 0 })).status, 422, 'sent too fast');
  assert.equal((await startCheck(env, '203.0.113.5', withToken(GOOD), { skipStamp: true })).status, 422);
  assert.equal((await startCheck(env, '203.0.113.5', { ...withToken(GOOD), city: '' })).status, 422);
  assert.deepEqual(counted(env), zero);
  assert.deepEqual(env.ctx.aiBudget.notes(), {});
});

test('G3: the counts are in the budget file, so a restart the same day keeps them', async () => {
  const env = await startEnv({ turnstile: fakeVerifier() });
  await startCheck(env, '203.0.113.5', withToken('bad'));
  await startCheck(env, '203.0.113.5', withToken(GOOD));
  await env.ctx.aiBudget.flush();
  const saved = await readJson(path.join(env.dir, 'ai-budget.json'));
  assert.equal(saved.notes.human, 1);
  assert.equal(saved.notes.humanPass, 1);
  assert.equal(saved.notes.checks, 1);
  const again = createAiBudget({ clock: env.clock, limit: 200, gradeLimit: 150, file: path.join(env.dir, 'ai-budget.json') });
  assert.deepEqual(again.notes(), { human: 1, humanPass: 1, checks: 1 });
});

test('G3: watch runs after a Grade starts and after each counted AI call', async () => {
  const calls = [];
  const gradeGuard = {
    turnedAway: kind => calls.push(`away:${kind}`),
    passed: () => calls.push('passed'),
    started: () => calls.push('started'),
    misconfigured: () => calls.push('misconfigured'),
    watch: () => calls.push('watch'),
    summary: () => ({ usage: { used: 0, left: 0, limit: 0 }, counts: zero, misconfigured: false }),
  };
  const env = await startEnv({ turnstile: null, gradeGuard });
  assert.equal((await startCheck(env, '203.0.113.5')).status, 303);
  assert.ok(calls.includes('started'), 'a started Grade is counted through the guard');
  // The Grade runs in the background; its AI call is counted, then watched, before the assistant is asked.
  for (let i = 0; i < 250 && env.counts.asked === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(env.counts.asked >= 1, 'the assistant was asked');
  assert.ok(calls.includes('watch'), 'the counted call was watched');
});
