/**
 * The review of G3 (V63, V64) and the heads-up emails (Feature G, task G4): the budget file's coalesced
 * writes, a watch() that never throws into a request, and the 50% and 90% emails and the "human check may
 * be set up wrong" email. Fake clock, fake notifiers, fake verifier and fake assistant; no network.
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
import { updateJsonFile } from '../server/lib/json-file.js';
import {
  createMockNotifier, createNoneNotifier, createConsoleNotifier, createResendNotifier,
} from '../server/lib/notifier.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 9, 18, 0, 0); // noon on Nov 9 in Chicago
const DAY = 24 * 60 * 60 * 1000;
const GOOD = 'good-token-111';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function tempDir(prefix = 'fap-grade-alerts-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {}));
  return dir;
}

const fakeClock = (t = START) => ({ t, now() { return this.t; } });
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tick = () => sleep(10);

/** Everything written to stderr while `fn` runs. */
async function captureStderr(fn) {
  const original = process.stderr.write;
  let text = '';
  process.stderr.write = (chunk, ...rest) => {
    text += String(chunk);
    const cb = rest.find(r => typeof r === 'function');
    if (cb) cb();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return text;
}

// ---- V63: the budget file's writes are coalesced -------------------------------------------------

test('V63: 1,000 note() calls make only a few writes, the file ends right, and a consume after them is on disk', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  let writes = 0;
  const save = async (target, snapshot) => {
    writes += 1;
    await sleep(5);
    return updateJsonFile(target, () => snapshot, { fallback: {} });
  };
  const budget = createAiBudget({ clock: fakeClock(), limit: 200, gradeLimit: 60, file, save });
  for (let i = 0; i < 1000; i += 1) budget.note('human');
  budget.consume({ kind: 'grade' });
  await budget.flush();
  assert.ok(writes >= 1 && writes <= 3, `${writes} writes`);
  const saved = await readJson(file);
  assert.equal(saved.notes.human, 1000);
  assert.equal(saved.total, 1);
  assert.equal(saved.grade, 1);
});

test('V63: while one write runs only one more waits, and it writes the state as it is when it starts', async () => {
  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  const seen = [];
  const save = async (target, snapshot) => {
    seen.push(structuredClone(snapshot));
    await sleep(30);
    return updateJsonFile(target, () => snapshot, { fallback: {} });
  };
  const budget = createAiBudget({ clock: fakeClock(), limit: 200, gradeLimit: 60, file, save });
  budget.note('human');
  await sleep(5); // the first write is running
  for (let i = 0; i < 50; i += 1) budget.note('human');
  await budget.flush();
  assert.equal(seen.length, 2);
  assert.equal(seen[0].notes.human, 1);
  assert.equal(seen[1].notes.human, 51, 'the waiting write carried every count made meanwhile');
  assert.equal((await readJson(file)).notes.human, 51);
});

test('V63: nothing is written for a budget with no file, and a failed write does not stop the next one', async () => {
  let writes = 0;
  const quiet = createAiBudget({ clock: fakeClock(), limit: 200, save: async () => { writes += 1; } });
  quiet.note('human');
  await quiet.flush();
  assert.equal(writes, 0);

  const dir = await tempDir();
  const file = path.join(dir, 'ai-budget.json');
  let calls = 0;
  const save = async (target, snapshot) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('disk full'), { name: 'FakeDiskError' });
    return updateJsonFile(target, () => snapshot, { fallback: {} });
  };
  const budget = createAiBudget({ clock: fakeClock(), limit: 200, gradeLimit: 60, file, save });
  const log = await captureStderr(async () => {
    budget.note('a');
    await budget.flush();
    budget.note('b');
    await budget.flush();
  });
  assert.ok(log.includes('[ai-budget] save failed: FakeDiskError'));
  assert.equal(log.includes('disk full'), false, 'the name only');
  assert.deepEqual((await readJson(file)).notes, { a: 1, b: 1 });
});

test('V63: flush resolves at once when nothing is being written', async () => {
  const budget = createAiBudget({ clock: fakeClock(), limit: 200 });
  await budget.flush();
});

// ---- the heads-up emails, from the guard on a real budget ---------------------------------------

function setup({ limit = 200, gradeLimit = 10, notifier = createMockNotifier(), ...rest } = {}) {
  const clock = fakeClock();
  const budget = createAiBudget({ clock, limit, gradeLimit });
  const lines = [];
  const guard = createGradeGuard({ aiBudget: budget, notifier, log: line => lines.push(line), ...rest });
  return { clock, budget, notifier, guard, lines };
}

/** One counted AI call, then the look at the day's use that follows it. */
async function call({ budget, guard }) {
  budget.consume({ kind: 'grade' });
  guard.watch();
  await tick();
}

test('G4: the 50% email goes at half the Grader share and the 90% email at nine tenths, once each', async () => {
  const env = setup();
  for (let i = 0; i < 3; i += 1) env.guard.started();
  for (let i = 0; i < 4; i += 1) await call(env);
  assert.deepEqual(env.notifier.allowances, []);
  await call(env); // 5 of 10
  assert.deepEqual(env.notifier.allowances, [{ percent: 50, used: 5, left: 5, limit: 10, checks: 3 }]);
  for (let i = 0; i < 3; i += 1) await call(env);
  assert.equal(env.notifier.allowances.length, 1);
  await call(env); // 9 of 10
  assert.deepEqual(env.notifier.allowances[1], { percent: 90, used: 9, left: 1, limit: 10, checks: 3 });
  await call(env);
  await call(env); // the 10th is refused; nothing more is sent
  env.guard.watch();
  await tick();
  assert.equal(env.notifier.allowances.length, 2);
  assert.deepEqual(env.lines, []);
});

test('G4: both emails can go on the same call, and each goes again the next Chicago day', async () => {
  const env = setup({ gradeLimit: 2 });
  await call(env); // 1 of 2: 50%
  await call(env); // 2 of 2: 100%, so the 90% email
  assert.deepEqual(env.notifier.allowances.map(a => a.percent), [50, 90]);
  env.clock.t += DAY;
  await call(env);
  await call(env);
  assert.deepEqual(env.notifier.allowances.map(a => a.percent), [50, 90, 50, 90]);

  // One call that jumps over both thresholds sends both.
  const jump = setup({ gradeLimit: 1 });
  await call(jump);
  assert.deepEqual(jump.notifier.allowances.map(a => a.percent), [50, 90]);
});

test('G4: the share is used / (used + left), so shared caps that hold left down still send the 90% email', async () => {
  // A total of 8 leaves 6 for photos and the Grader together; the Grader setting (60) is never near.
  const env = setup({ limit: 8, gradeLimit: 60 });
  for (let i = 0; i < 2; i += 1) await call(env);
  assert.deepEqual(env.notifier.allowances, []);
  await call(env); // used 3, left 3
  assert.deepEqual(env.notifier.allowances, [{ percent: 50, used: 3, left: 3, limit: 6, checks: 0 }]);
  await call(env);
  await call(env); // used 5, left 1: 83%
  assert.equal(env.notifier.allowances.length, 1);
  await call(env); // used 6, left 0
  assert.deepEqual(env.notifier.allowances[1], { percent: 90, used: 6, left: 0, limit: 6, checks: 0 });
});

test('G4: with the allowance at 0 (used + left is 0) nothing is sent', async () => {
  const off = setup({ gradeLimit: 0 });
  off.guard.watch();
  await call(off);
  assert.deepEqual(off.notifier.allowances, []);

  const stub = {
    usage: () => ({ used: 0, left: 0, limit: 0 }), notes: () => ({}), once: () => true, note() {},
  };
  const notifier = createMockNotifier();
  createGradeGuard({ aiBudget: stub, notifier }).watch();
  await tick();
  assert.deepEqual(notifier.allowances, []);
});

test('G4: with no email service nothing is sent and no flag is used up', async () => {
  for (const notifier of [createNoneNotifier(), null, {}, { name: 'test' }]) {
    const env = setup({ gradeLimit: 2, notifier });
    await call(env);
    await call(env);
    for (let i = 0; i < 12; i += 1) env.guard.turnedAway('human');
    await tick();
    // "once" was never called, so the emails can still go if a service is set up later that day.
    assert.equal(env.budget.once('email50'), true);
    assert.equal(env.budget.once('email90'), true);
    assert.equal(env.budget.once('humanSetup'), true);
    assert.deepEqual(env.lines, []);
  }
});

test('G4: the heads-up emails read only the budget, never the grades file', async () => {
  const hands = new Proxy({}, { get() { throw new Error('the store was read'); }, has() { throw new Error('the store was read'); } });
  const env = setup({ gradeLimit: 2, store: hands });
  await call(env);
  await call(env);
  env.guard.started();
  for (let i = 0; i < 10; i += 1) env.guard.turnedAway('human');
  await tick();
  assert.deepEqual(env.notifier.allowances.map(a => a.percent), [50, 90]);
  assert.equal(env.notifier.humanChecks.length, 1);
  assert.deepEqual(env.lines, []);
});

// ---- "the human check may be set up wrong" --------------------------------------------------------

test('G4: ten checks turned away by the human check and none passed send one email a day, with no AI call and no Grade', async () => {
  const env = setup();
  for (let i = 0; i < 9; i += 1) env.guard.turnedAway('human');
  await tick();
  assert.deepEqual(env.notifier.humanChecks, []);
  env.guard.turnedAway('human');
  await tick();
  assert.deepEqual(env.notifier.humanChecks, [{ human: 10 }]);
  for (let i = 0; i < 5; i += 1) env.guard.turnedAway('human');
  env.guard.watch();
  await tick();
  assert.equal(env.notifier.humanChecks.length, 1, 'once a day');
  assert.deepEqual(env.notifier.allowances, []);
  assert.equal(env.guard.summary().counts.checks, 0);
  assert.equal(env.guard.summary().usage.used, 0);

  // A day with a pass is not a lockout.
  env.clock.t += DAY;
  env.guard.passed();
  for (let i = 0; i < 12; i += 1) env.guard.turnedAway('human');
  env.guard.watch();
  await tick();
  assert.equal(env.notifier.humanChecks.length, 1);

  // The next day with no pass sends it again.
  env.clock.t += DAY;
  for (let i = 0; i < 10; i += 1) env.guard.turnedAway('human');
  await tick();
  assert.equal(env.notifier.humanChecks.length, 2);
});

test('G4: other refusals do not count toward the human-check email, and watch() sends it too', async () => {
  const env = setup();
  for (let i = 0; i < 20; i += 1) {
    env.guard.turnedAway('limit');
    env.guard.turnedAway('network');
  }
  await tick();
  assert.deepEqual(env.notifier.humanChecks, []);
  for (let i = 0; i < 10; i += 1) env.budget.note('human'); // counted some other way
  env.guard.watch();
  await tick();
  assert.deepEqual(env.notifier.humanChecks, [{ human: 10 }]);
});

// ---- what the emails say -------------------------------------------------------------------------

test('G4: the mock and console notifiers keep only the numbers, whatever else is passed in', async () => {
  const mock = createMockNotifier();
  await mock.notifyAllowance({
    percent: 50, used: 5, left: 5, limit: 10, checks: 3, business: 'Sam\'s Plumbing', name: 'Sam Jones', email: 'sam@example.com', phone: '615-555-0100', answer: 'Sam is great',
  });
  await mock.notifyHumanCheck({ human: 12, business: 'Sam\'s Plumbing', email: 'sam@example.com' });
  assert.deepEqual(mock.allowances, [{ percent: 50, used: 5, left: 5, limit: 10, checks: 3 }]);
  assert.deepEqual(mock.humanChecks, [{ human: 12 }]);

  const lines = [];
  const consoleNotifier = createConsoleNotifier({ write: line => lines.push(line) });
  await consoleNotifier.notifyAllowance({ percent: 90, used: 9, left: 1, limit: 10, checks: 4, business: 'Sam\'s Plumbing' });
  await consoleNotifier.notifyHumanCheck({ human: 11, email: 'sam@example.com' });
  assert.deepEqual(JSON.parse(lines[0]), { event: 'grader-allowance', percent: 90, used: 9, left: 1, limit: 10, checks: 4 });
  assert.deepEqual(JSON.parse(lines[1]), { event: 'grader-human-check', human: 11 });
  assert.deepEqual(await createNoneNotifier().notifyAllowance({}), { notifier: 'none', sent: false });
  assert.deepEqual(await createNoneNotifier().notifyHumanCheck({}), { notifier: 'none', sent: false });
});

function resendWith(fetchImpl) {
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return fetchImpl(url, init);
  };
  const notifier = createResendNotifier({
    apiKey: 'resend-secret-key', from: 'checks@example.test', adminEmail: 'admin@example.test', fetch, timeoutMs: 1000,
  });
  return { notifier, sent };
}

test('G4: the Resend notifier emails the admin only, with the subject and counts the design gives', async () => {
  const { notifier, sent } = resendWith(() => ({ ok: true, status: 200 }));
  const result = await notifier.notifyAllowance({
    percent: 50, used: 5, left: 5, limit: 10, checks: 3, business: 'Sam\'s Plumbing', email: 'sam@example.com',
  });
  assert.deepEqual(result, { notifier: 'resend', sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(sent[0].body.to, ['admin@example.test']);
  assert.equal(sent[0].body.subject, "AI Visibility Check: 50% of today's AI calls used");
  assert.equal(sent[0].body.text, 'Used 5 of 10 calls, 5 left. 3 checks run today.');
  const everything = JSON.stringify(sent[0].body);
  for (const leak of ['Sam', 'sam@example.com', 'resend-secret-key']) assert.equal(everything.includes(leak), false, leak);

  await notifier.notifyAllowance({ percent: 90, used: 9, left: 1, limit: 10, checks: 1 });
  assert.equal(sent[1].body.subject, "AI Visibility Check: 90% of today's AI calls used");
  assert.equal(sent[1].body.text, 'Used 9 of 10 calls, 1 left. 1 check run today.');

  await notifier.notifyHumanCheck({ human: 12, email: 'sam@example.com' });
  assert.deepEqual(sent[2].body.to, ['admin@example.test']);
  assert.equal(sent[2].body.subject, 'AI Visibility Check: the human check may be set up wrong');
  assert.ok(sent[2].body.text.includes('turned away 12 checks and passed none'));
  assert.equal(JSON.stringify(sent[2].body).includes('sam@example.com'), false);
  assert.equal(sent[2].init.headers.Authorization, 'Bearer resend-secret-key');
});

test('G4: the Resend notifier never throws and never puts the key in its result', async () => {
  const cases = [
    () => { throw Object.assign(new Error('resend-secret-key leaked'), { name: 'TypeError' }); },
    () => ({ ok: false, status: 500 }),
    () => { throw Object.assign(new Error('late'), { name: 'AbortError' }); },
  ];
  const results = [];
  for (const make of cases) {
    const { notifier } = resendWith(make);
    results.push(await notifier.notifyAllowance({ percent: 50, used: 1, left: 1, limit: 2, checks: 1 }));
    results.push(await notifier.notifyHumanCheck({ human: 10 }));
  }
  assert.deepEqual(results.map(r => r.sent), [false, false, false, false, false, false]);
  assert.deepEqual(results.map(r => r.error), ['TypeError', 'TypeError', 'http_500', 'http_500', 'TimeoutError', 'TimeoutError']);
  assert.equal(JSON.stringify(results).includes('resend-secret-key'), false);
});

// ---- a notifier that throws, rejects or is slow never stops a check (V64) ---------------------------

const BOOM = 'boom SECRET-123';

const BAD_NOTIFIERS = {
  'throws': () => { throw new Error(BOOM); },
  'rejects': () => Promise.reject(new Error(BOOM)),
  'reports a failure': async () => ({ notifier: 'test', sent: false, error: 'http_500' }),
  'never answers': () => new Promise(() => {}),
};

function badNotifier(fn) {
  return { name: 'test', notify: async () => {}, notifyLead: async () => {}, notifyAllowance: fn, notifyHumanCheck: fn };
}

test('V64: watch() never throws or rejects, returns undefined, and logs one plain line per failed email', async () => {
  for (const [label, fn] of Object.entries(BAD_NOTIFIERS)) {
    const lines = [];
    const budget = createAiBudget({ clock: fakeClock(), limit: 200, gradeLimit: 2 });
    const guard = createGradeGuard({ aiBudget: budget, notifier: badNotifier(fn), log: line => lines.push(line) });
    budget.consume({ kind: 'grade' });
    const returned = guard.watch();
    assert.equal(returned, undefined, label);
    budget.consume({ kind: 'grade' });
    assert.equal(guard.watch(), undefined, label);
    for (let i = 0; i < 10; i += 1) guard.turnedAway('human');
    await tick();
    const expected = label === 'never answers' ? [] : ['allowance-email-50-failed', 'allowance-email-90-failed', 'human-check-email-failed'];
    assert.deepEqual(lines, expected, label);
    assert.equal(lines.join('\n').includes('SECRET-123'), false, label);
  }
});

test('V64: watch() catches a budget that throws, and a log that throws', () => {
  const boom = () => { throw new Error(BOOM); };
  for (const aiBudget of [{ usage: boom }, { usage: () => ({ used: 1, left: 1 }), notes: boom }, { usage: () => ({ used: 1, left: 1 }), notes: () => ({}), once: boom }]) {
    const guard = createGradeGuard({ aiBudget, notifier: createMockNotifier(), log: boom });
    assert.equal(guard.watch(), undefined);
    assert.equal(guard.started(), undefined);
    assert.equal(guard.turnedAway('human'), undefined);
  }
});

async function startEnv({ gradeGuard, notifier, turnstile, googleLive, config = {} } = {}) {
  const dir = await tempDir('fap-grade-alerts-env-');
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
    newGradeId: () => `alert${String(++n).padStart(17, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'alerts-test-token',
      trustProxy: 1, gradeAiCallsPerDay: 150, ...config,
    },
  };
  if (gradeGuard !== undefined) deps.gradeGuard = gradeGuard;
  if (notifier !== undefined) deps.notifier = notifier;
  if (turnstile !== undefined) deps.turnstile = turnstile;
  if (googleLive !== undefined) deps.googleLive = googleLive;
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

async function startCheck(env, ip, extra = {}) {
  const page = await (await fetch(`${env.base}/grade`, { headers: { 'x-forwarded-for': ip } })).text();
  const t = /name="t" value="([^"]+)"/.exec(page)[1];
  env.clock.t += 5000;
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

async function waitDone(env, id) {
  for (let i = 0; i < 250; i += 1) {
    const reply = await (await fetch(`${env.base}/grade/${id}/status.json`)).json();
    if (reply.done) return reply;
    await sleep(20);
  }
  throw new Error('the check did not finish');
}

/** A budget stand-in that is always at 50%, so every watch() has an email to send. */
const halfwayBudget = { usage: () => ({ used: 1, left: 1, limit: 2 }), notes: () => ({}), once: () => true, note() {} };

for (const [label, fn] of Object.entries(BAD_NOTIFIERS)) {
  test(`V64: with a notifier that ${label}, the check starts (303) and the live answer still shows`, async () => {
    const guard = createGradeGuard({
      aiBudget: halfwayBudget, notifier: badNotifier(fn), log: line => process.stderr.write(`[grader] ${line}\n`),
    });
    const googleLive = { async ask() { return { text: 'Live text answer', sources: [] }; } };
    const env = await startEnv({ gradeGuard: guard, googleLive });
    let status;
    let live;
    let liveText = '';
    const log = await captureStderr(async () => {
      const res = await startCheck(env, '203.0.113.5');
      status = res.status;
      const id = /\/grade\/([A-Za-z0-9_-]{22})/.exec(res.headers.get('location'))[1];
      const done = await waitDone(env, id);
      assert.equal(done.status, 'done');
      const cookie = res.headers.getSetCookie()[0].split(';')[0];
      live = await fetch(`${env.base}/grade/${id}/google-live`, {
        method: 'POST', headers: { cookie, 'x-forwarded-for': '203.0.113.5' },
      });
      liveText = await live.text();
      await tick();
    });
    assert.equal(status, 303);
    assert.equal(live.status, 200);
    assert.ok(liveText.includes('Live text answer'));
    const emailLines = log.split('\n').filter(l => l.includes('email'));
    for (const line of emailLines) assert.match(line, /^\[grader\] allowance-email-(50|90)-failed$/);
    assert.equal(emailLines.length > 0, label === 'throws' || label === 'rejects' || label === 'reports a failure');
    assert.equal(log.includes('SECRET-123'), false);
  });
}

// ---- the emails through the whole app ---------------------------------------------------------------

test('G4: ten failed human checks send one email with no AI call and no Grade started, through the route', async () => {
  const notifier = createMockNotifier();
  const turnstile = { siteKey: 'site-key-ABC123', async verify(token) { return token === GOOD ? 'ok' : 'failed'; } };
  const env = await startEnv({ notifier, turnstile });
  for (let i = 0; i < 9; i += 1) assert.equal((await startCheck(env, '203.0.113.5', { 'cf-turnstile-response': 'bad' })).status, 422);
  assert.deepEqual(notifier.humanChecks, []);
  assert.equal((await startCheck(env, '203.0.113.5', { 'cf-turnstile-response': 'bad' })).status, 422);
  await tick();
  assert.deepEqual(notifier.humanChecks, [{ human: 10 }]);
  for (let i = 0; i < 3; i += 1) assert.equal((await startCheck(env, '203.0.113.5')).status, 422);
  await tick();
  assert.equal(notifier.humanChecks.length, 1);
  assert.equal(env.counts.asked, 0, 'no AI call');
  assert.equal(env.ctx.gradeGuard.summary().counts.checks, 0, 'no Grade started');
  assert.deepEqual(notifier.allowances, []);
  // The check was not switched off by itself: a good token still gets in.
  assert.equal((await startCheck(env, '203.0.113.5', { 'cf-turnstile-response': GOOD })).status, 303);
});

test('G4: a real check that uses half the Grader share sends one email with counts only', async () => {
  const notifier = createMockNotifier();
  const env = await startEnv({ notifier, config: { gradeAiCallsPerDay: 2 } });
  const res = await startCheck(env, '203.0.113.5');
  assert.equal(res.status, 303);
  for (let i = 0; i < 250 && notifier.allowances.length === 0; i += 1) await sleep(20);
  assert.ok(notifier.allowances.length >= 1);
  const email = notifier.allowances[0];
  assert.deepEqual(Object.keys(email).sort(), ['checks', 'left', 'limit', 'percent', 'used']);
  assert.equal(email.percent, 50);
  assert.equal(email.used, 1);
  assert.equal(email.left, 1);
  assert.equal(email.limit, 2);
  assert.ok(email.checks === 0 || email.checks === 1);
  assert.equal(JSON.stringify(notifier.allowances).includes('Shop'), false, 'no business name');
  assert.deepEqual(notifier.humanChecks, []);
});
