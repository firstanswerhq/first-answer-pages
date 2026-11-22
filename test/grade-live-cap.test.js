/**
 * Google's live answer is capped at 3 per Grade in total (Feature G, task G7). The count is kept on the stored
 * Grade (`liveAnswers`), checked and raised in one stored update after the budget accepts the call.
 * Fake Google, fake assistant, fake clock; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);
const HOUR = 60 * 60 * 1000;
const IP = '203.0.113.5';
const MESSAGE = "You've seen Google's live answer 3 times for this report. Run a new check to see it again.";
const ESCAPED_MESSAGE = MESSAGE.replace(/'/g, '&#39;');

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A fake Google that counts its calls. `fail` makes every call throw. */
function fakeGoogle({ fail = false } = {}) {
  const google = {
    calls: 0,
    async ask() {
      google.calls += 1;
      if (fail) throw new Error('Google is down');
      return { text: 'Live text answer', sources: [] };
    },
  };
  return google;
}

async function startEnv({
  dir: givenDir, googleLive, gradeGuard, aiBudget, config = {}, clockStart = START,
} = {}) {
  let dir = givenDir;
  if (!dir) {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-live-cap-'));
    for (const name of ['listings.json', 'categories.json']) {
      await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
    }
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {}));
  }
  const clock = { t: clockStart, now() { return this.t; } };
  let n = 0;
  const assistant = {
    name: 'anthropic',
    async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; },
  };
  const deps = {
    dataDir: dir,
    clock,
    assistantProvider: assistant,
    extraAssistants: [],
    safeFetcher: { async fetchText() { throw new Error('no network in tests'); } },
    newGradeId: () => `live${String(++n).padStart(18, '0')}`,
    googleLive,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'live-cap-token',
      trustProxy: 1, gradeAiCallsPerDay: 150, ...config,
    },
  };
  if (gradeGuard !== undefined) deps.gradeGuard = gradeGuard;
  if (aiBudget !== undefined) deps.aiBudget = aiBudget;
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
  return { dir, clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

let service = 0;

/** Run one check to the end and return its id and the cookie that lets this browser ask for the live answer. */
async function runGrade(env) {
  const page = await (await fetch(`${env.base}/grade`, { headers: { 'x-forwarded-for': IP } })).text();
  const t = /name="t" value="([^"]+)"/.exec(page)[1];
  env.clock.t += 5000;
  service += 1;
  const res = await fetch(`${env.base}/grade`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': IP },
    body: new URLSearchParams({
      nickname: '', t, name: `Shop ${service}`, city: 'Nashville', state: 'TN', service: 'accountants', website: '',
    }),
  });
  assert.equal(res.status, 303);
  const id = /\/grade\/([A-Za-z0-9_-]{22})/.exec(res.headers.get('location'))[1];
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  for (let i = 0; i < 250; i += 1) {
    const reply = await (await fetch(`${env.base}/grade/${id}/status.json`)).json();
    if (reply.done) {
      assert.equal(reply.status, 'done');
      await sleep(30); // let the background work settle
      return { id, cookie };
    }
    await sleep(20);
  }
  throw new Error('the check did not finish');
}

const live = (env, { id, cookie }) => fetch(`${env.base}/grade/${id}/google-live`, {
  method: 'POST', headers: { cookie, 'x-forwarded-for': IP },
});

const report = async (env, { id, cookie }) => (await fetch(`${env.base}/grade/${id}`, { headers: { cookie, 'x-forwarded-for': IP } })).text();
const stored = async (env, id) => (await env.ctx.grader.get(id)).liveAnswers ?? 0;
const buttonShown = (text, id) => text.includes(`action="/grade/${id}/google-live"`);

// ---- the cap ------------------------------------------------------------------------------------

test('G7: the 1st to 3rd live answers are allowed and the 4th is refused with its own message, now and hours later', async () => {
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  for (let i = 1; i <= 3; i += 1) {
    const res = await live(env, grade);
    assert.equal(res.status, 200, `answer ${i}`);
    assert.ok((await res.text()).includes('Live text answer'));
    assert.equal(await stored(env, grade.id), i);
  }
  const usedBefore = env.ctx.aiBudget.usage({ kind: 'grade' }).used;

  const fourth = await live(env, grade);
  assert.equal(fourth.status, 429);
  const text = await fourth.text();
  assert.ok(text.includes(ESCAPED_MESSAGE));
  assert.equal(text.includes('a lot of checks'), false, 'not the hourly message');
  assert.equal(fourth.headers.get('retry-after'), null, 'waiting would not help');
  assert.equal(google.calls, 3, 'Google was not asked');
  assert.equal(env.ctx.aiBudget.usage({ kind: 'grade' }).used, usedBefore, 'nothing was spent');
  assert.equal(await stored(env, grade.id), 3);

  // Hours later (the hourly rules are long over): still refused, and the count never goes above 3.
  env.clock.t += 5 * HOUR;
  const later = await live(env, grade);
  assert.equal(later.status, 429);
  assert.ok((await later.text()).includes(ESCAPED_MESSAGE));
  env.clock.t += 24 * HOUR;
  assert.equal((await live(env, grade)).status, 429);
  assert.equal(google.calls, 3);
  assert.equal(await stored(env, grade.id), 3);
});

test('G7: the cap survives a new app on the same data directory', async () => {
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  for (let i = 0; i < 3; i += 1) assert.equal((await live(env, grade)).status, 200);

  const google2 = fakeGoogle();
  const again = await startEnv({ dir: env.dir, googleLive: google2, clockStart: env.clock.t + 6 * HOUR });
  const refused = await live(again, grade);
  assert.equal(refused.status, 429);
  assert.ok((await refused.text()).includes(ESCAPED_MESSAGE));
  assert.equal(google2.calls, 0);
  assert.equal(await stored(again, grade.id), 3);
});

test('G7: two requests at the same moment with the count at 2 give one 200 and one 429', async () => {
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  assert.equal((await live(env, grade)).status, 200);
  assert.equal((await live(env, grade)).status, 200);
  env.clock.t += 2 * HOUR; // a fresh hour, so only the cap can refuse
  const before = env.ctx.aiBudget.usage({ kind: 'grade' }).used;

  const both = await Promise.all([live(env, grade), live(env, grade)]);
  const statuses = both.map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 429]);
  const refused = both.find(r => r.status === 429);
  assert.ok((await refused.text()).includes(ESCAPED_MESSAGE));
  assert.equal(await stored(env, grade.id), 3, 'never 4');
  assert.equal(google.calls, 3);
  // Both calls were counted by the budget; the one that was not made was given back.
  assert.equal(env.ctx.aiBudget.usage({ kind: 'grade' }).used, before + 1);
});

test('G7: several requests at once from a fresh Grade make exactly 3', async () => {
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  // Per-Grade hourly rule is 3, so spread the requests over fresh hours, two at a time.
  const statuses = [];
  for (let round = 0; round < 3; round += 1) {
    env.clock.t += 2 * HOUR;
    for (const r of await Promise.all([live(env, grade), live(env, grade)])) statuses.push(r.status);
  }
  assert.equal(statuses.filter(s => s === 200).length, 3);
  assert.equal(statuses.filter(s => s === 429).length, 3);
  assert.equal(await stored(env, grade.id), 3);
  assert.equal(google.calls, 3);
});

// ---- what uses one of the 3 and what does not -------------------------------------------------------------------

test('G7: a request the budget refuses does not use one of the 3', async () => {
  const real = createAiBudget({ clock: { now: () => START }, limit: 200, gradeLimit: 150 });
  let refuse = false;
  const aiBudget = {
    ...real,
    peek: opts => ({ ...real.peek(opts), remaining: refuse ? 100 : real.peek(opts).remaining }),
    consume: opts => (refuse ? { allowed: false, remaining: 0 } : real.consume(opts)),
  };
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google, aiBudget });
  const grade = await runGrade(env);

  refuse = true;
  const refused = await live(env, grade);
  assert.equal(refused.status, 429);
  assert.ok((await refused.text()).includes('keeping the rest of today'));
  assert.equal(await stored(env, grade.id), 0, 'not counted');
  assert.equal(google.calls, 0);

  refuse = false;
  env.clock.t += 2 * HOUR; // the refused request used one of the hourly rule's 3
  for (let i = 1; i <= 3; i += 1) assert.equal((await live(env, grade)).status, 200, `answer ${i}`);
  assert.equal(await stored(env, grade.id), 3);
  assert.equal((await live(env, grade)).status, 429);
  assert.equal(google.calls, 3);
});

test('G7: a call that fails at Google still counts', async () => {
  const google = fakeGoogle({ fail: true });
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  for (let i = 1; i <= 3; i += 1) {
    assert.equal((await live(env, grade)).status, 502, `failure ${i}`);
    assert.equal(await stored(env, grade.id), i);
  }
  const fourth = await live(env, grade);
  assert.equal(fourth.status, 429);
  assert.ok((await fourth.text()).includes(ESCAPED_MESSAGE));
  assert.equal(google.calls, 3);
});

test('G7: a count that is damaged on the stored Grade is read as 0', async () => {
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  for (const bad of ['3', -1, 1.5, null, [3]]) {
    await env.ctx.store.collection('grades').update(list => {
      const g = list.find(x => x && x.id === grade.id);
      g.liveAnswers = bad;
    });
    env.clock.t += 2 * HOUR;
    assert.equal((await live(env, grade)).status, 200, JSON.stringify(bad));
    assert.equal(await stored(env, grade.id), 1);
  }
});

// ---- the button -----------------------------------------------------------------------------------------------

test('G7: the button shows until 3 live answers are used, then it is hidden', async () => {
  const env = await startEnv({ googleLive: fakeGoogle() });
  const grade = await runGrade(env);
  assert.ok(buttonShown(await report(env, grade), grade.id), 'before any');
  for (let i = 1; i <= 3; i += 1) {
    assert.equal((await live(env, grade)).status, 200);
    const text = await report(env, grade);
    assert.equal(buttonShown(text, grade.id), i < 3, `after ${i}`);
  }
  const text = await report(env, grade);
  assert.equal(text.includes('Show Google'), false);
});

// ---- watch() ---------------------------------------------------------------------------------------------------------

test('G7: a live answer that is allowed calls watch(), and a refused one does not', async () => {
  let watches = 0;
  const gradeGuard = {
    turnedAway() {}, passed() {}, started() {}, misconfigured() {}, watch() { watches += 1; },
    summary: () => ({ usage: { used: 0, left: 0, limit: 0 }, counts: {}, misconfigured: false }),
  };
  const env = await startEnv({ googleLive: fakeGoogle(), gradeGuard });
  const grade = await runGrade(env);
  await sleep(100);
  for (let i = 1; i <= 3; i += 1) {
    const before = watches;
    assert.equal((await live(env, grade)).status, 200);
    assert.equal(watches, before + 1, `answer ${i}`);
  }
  const before = watches;
  assert.equal((await live(env, grade)).status, 429);
  assert.equal(watches, before, 'a call that was not made is not watched');
});

// ---- the other limits stay ----------------------------------------------------------------------------------------

test('G7: the hourly rule per Grade is still there under the cap', async () => {
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  for (let i = 0; i < 3; i += 1) assert.equal((await live(env, grade)).status, 200);
  // Count lowered by hand so only the hourly rule is left to refuse.
  await env.ctx.store.collection('grades').update(list => {
    list.find(x => x && x.id === grade.id).liveAnswers = 0;
  });
  const res = await live(env, grade);
  assert.equal(res.status, 429);
  assert.ok((await res.text()).includes('a lot of checks'));
  assert.equal(google.calls, 3);
});

test('G7: without the ran cookie there is no live answer and nothing is counted', async () => {
  const google = fakeGoogle();
  const env = await startEnv({ googleLive: google });
  const grade = await runGrade(env);
  const res = await fetch(`${env.base}/grade/${grade.id}/google-live`, { method: 'POST', headers: { 'x-forwarded-for': IP } });
  assert.equal(res.status, 403);
  assert.equal(await stored(env, grade.id), 0);
  assert.equal(google.calls, 0);
});
