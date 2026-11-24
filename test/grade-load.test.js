/**
 * Launch-day load fixes (V45 to V49): one retry after a 429 or 529 that is not charged, second opinions that
 * never hold up the report, a partial-score mark, at most GRADE_MAX_RUNNING checks at once with a line, and the
 * lead email sent in the background. Fake providers, a fake clock and a fake pause: no real AI, no real network,
 * and no real waiting except short timers.
 */

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createSafeFetcher } from '../server/lib/safe-fetch.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/grade/', import.meta.url));
const EXPECTED = JSON.parse(await fs.readFile(path.join(FIXTURES, 'expected.json'), 'utf8'));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);
const ADMIN = 'grade-load-test-token';
const DAILY = 40; // the Grader's daily AI calls in these tests, so "used" is DAILY minus what is left

const realHttp = http.request;
const realHttps = https.request;
before(() => {
  http.request = () => { throw new Error('real http.request called'); };
  https.request = () => { throw new Error('real https.request called'); };
});
after(() => {
  http.request = realHttp;
  https.request = realHttps;
});

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

// ---- fake websites (same as grade-flow.test.js) ------------------------------------

const SITES = {};
for (const exp of Object.values(EXPECTED)) {
  SITES[new URL(exp.input.website).hostname] = { exp, html: await fs.readFile(path.join(FIXTURES, exp.file), 'utf8') };
}

function routeFor(href) {
  const u = new URL(href);
  const site = SITES[u.hostname];
  if (!site) return { status: 404, headers: {}, body: Buffer.alloc(0) };
  if (u.pathname === '/') {
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(site.html) };
  }
  const file = u.pathname === '/robots.txt' ? site.exp.robots : u.pathname === '/llms.txt' ? site.exp.llms : null;
  if (!file || file.status !== 200) return { status: file?.status ?? 404, headers: {}, body: Buffer.alloc(0) };
  return { status: 200, headers: { 'content-type': file.contentType ?? 'text/plain' }, body: Buffer.from(file.text) };
}

function fixtureFetcher() {
  const fn = (url, opts, cb) => {
    const u = new URL(url);
    const req = new EventEmitter();
    req.end = () => {
      opts.lookup(u.hostname, { all: true }, (err) => {
        if (err) return req.emit('error', err);
        const route = routeFor(u.href);
        const res = Readable.from([route.body]);
        res.statusCode = route.status;
        res.headers = route.headers;
        return cb(res);
      });
    };
    return req;
  };
  return createSafeFetcher({
    request: { http: fn, https: fn },
    lookup: (host, opts, cb) => setImmediate(() => cb(null, [{ address: '93.184.216.34', family: 4 }])),
  });
}

// ---- environment ---------------------------------------------------------------------

async function startEnv({ assistantProvider, extraAssistants, notifier, config = {}, graderTiming } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-load-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider,
    extraAssistants: extraAssistants ?? [],
    ...(notifier !== undefined && { notifier }),
    ...(graderTiming !== undefined && { graderTiming }),
    safeFetcher: fixtureFetcher(),
    newGradeId: () => `load${String(++n).padStart(18, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: ADMIN,
      gradeAiCallsPerDay: DAILY, gradeMainAsks: 1, ...config,
    },
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
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { dir, clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });
const post = (env, p, fields = {}, headers = {}) => fetch(env.base + p, {
  method: 'POST', redirect: 'manual', headers, body: new URLSearchParams(fields),
});

/** Post the form and return the Grade_Id without waiting for the check to finish. */
async function begin(env, input) {
  const html = await (await get(env, '/grade')).text();
  const t = /name="t" value="([^"]+)"/.exec(html)[1];
  env.clock.t += 5000;
  const res = await post(env, '/grade', {
    nickname: '', t, name: input.name, city: input.city, state: input.state, service: input.service, website: input.website ?? '',
  });
  assert.equal(res.status, 303);
  return /^\/grade\/([A-Za-z0-9_-]{22})$/.exec(res.headers.get('location'))[1];
}

async function until(fn, label) {
  for (let i = 0; i < 300; i += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const waitDone = (env, id) => until(async () => (await (await get(env, `/grade/${id}/status.json`)).json()).done, 'the grade');
const storedGrade = (env, id) => env.ctx.grader.get(id);
const used = env => DAILY - env.ctx.aiBudget.peek({ kind: 'grade' }).remaining;

const NO_SITE = { name: 'Ace Accounting', city: 'Nashville', state: 'TN', service: 'accountants', website: '' };
const ROOFER = EXPECTED.roofer.input;

const answerOf = (text, provider = 'anthropic') => ({ answer: text, provider, model: 'stub-model', webSearch: true });
const busy = (status, retryAfterSeconds) => Object.assign(new Error('busy'), { status, retryAfterSeconds });

/** A main assistant that follows a script: each entry is an error to throw or an answer text to return. */
function scripted(steps) {
  const stub = {
    name: 'anthropic',
    calls: 0,
    async ask() {
      const step = steps[Math.min(stub.calls, steps.length - 1)];
      stub.calls += 1;
      if (step instanceof Error) throw step;
      return answerOf(step);
    },
  };
  return stub;
}

// ---- V45: one retry after 429 or 529, and no charge ----------------------------------------------

test('V45: a 429 with retry-after 2 waits 2 seconds, tries once more, and charges one call', async () => {
  const slept = [];
  const assistant = scripted([busy(429, 2), '1. Other Co\n2. Another Co']);
  const env = await startEnv({ assistantProvider: assistant, graderTiming: { sleep: async ms => { slept.push(ms); } } });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  const grade = await storedGrade(env, id);
  assert.equal(grade.ai.length, 1, 'a normal answer');
  assert.equal(grade.results.find(r => r.id === 'ai-named').result, 'fail');
  assert.equal(assistant.calls, 2);
  assert.deepEqual(slept, [2000]);
  assert.equal(used(env), 1, 'the retry is not charged again');
});

test('V45: a 529 is retried too; no retry-after waits 5 seconds and a long one waits at most 20', async () => {
  const slept = [];
  const timing = { sleep: async ms => { slept.push(ms); } };
  const none = await startEnv({ assistantProvider: scripted([busy(529), '1. Other Co']), graderTiming: timing });
  await waitDone(none, await begin(none, NO_SITE));
  const long = await startEnv({ assistantProvider: scripted([busy(429, 90), '1. Other Co']), graderTiming: timing });
  await waitDone(long, await begin(long, NO_SITE));
  assert.deepEqual(slept, [5000, 20000]);
});

test('V45: a 429 twice gives "did not answer" and no charge', async () => {
  const slept = [];
  const assistant = scripted([busy(429, 2), busy(429, 2)]);
  const env = await startEnv({ assistantProvider: assistant, graderTiming: { sleep: async ms => { slept.push(ms); } } });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  const grade = await storedGrade(env, id);
  assert.equal(assistant.calls, 2, 'one retry, no more');
  assert.deepEqual(slept, [2000]);
  assert.equal(grade.ai.length, 0);
  assert.equal(grade.results.find(r => r.id === 'ai-named').result, 'not_checked');
  assert.equal(used(env), 0, 'a call that ends in 429 or 529 is not charged');
});

test('V45: a 500 error is not retried and is charged as before', async () => {
  const slept = [];
  const assistant = scripted([busy(500)]);
  const env = await startEnv({ assistantProvider: assistant, graderTiming: { sleep: async ms => { slept.push(ms); } } });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  assert.equal(assistant.calls, 1);
  assert.deepEqual(slept, []);
  assert.equal(used(env), 1);
});

// ---- V46: second opinions never hold up the report -------------------------------------------------

/** A second opinion that answers only when the test lets it. */
function heldChatGpt() {
  const stub = {
    name: 'chatgpt',
    calls: 0,
    release: () => {},
    ask() {
      stub.calls += 1;
      return new Promise(resolve => {
        stub.release = () => resolve(answerOf('1. Ace Accounting', 'chatgpt'));
      });
    },
  };
  return stub;
}

test('V46: a second opinion that is still thinking does not delay the finished report, and shows when it arrives', async () => {
  const chatgpt = heldChatGpt();
  const env = await startEnv({
    assistantProvider: scripted(['1. Bluebird Books']),
    extraAssistants: [chatgpt],
    graderTiming: { secondOpinionTimeoutMs: 60 * 1000 },
  });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  assert.equal(chatgpt.calls, 1, 'it was asked');
  let grade = await storedGrade(env, id);
  assert.equal(grade.status, 'done');
  assert.deepEqual(grade.ai.map(a => a.provider), ['anthropic'], 'the report did not wait for it');

  chatgpt.release();
  grade = await until(async () => {
    const g = await storedGrade(env, id);
    return g.ai.some(a => a.provider === 'chatgpt') ? g : null;
  }, 'the second opinion');
  assert.equal(grade.ai.find(a => a.provider === 'chatgpt').second, true);
  assert.equal((await get(env, `/grade/${id}`)).status, 200);
});

test('V46: a second opinion that takes too long shows "didn\'t answer in time"', async () => {
  const chatgpt = heldChatGpt();
  const env = await startEnv({
    assistantProvider: scripted(['1. Bluebird Books']),
    extraAssistants: [chatgpt],
    graderTiming: { secondOpinionTimeoutMs: 100 },
  });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  const grade = await until(async () => {
    const g = await storedGrade(env, id);
    return Array.isArray(g.secondMissed) && g.secondMissed.length > 0 ? g : null;
  }, 'the time limit');
  assert.equal(grade.secondMissed[0].provider, 'chatgpt');
  assert.deepEqual(grade.ai.map(a => a.provider), ['anthropic']);
  const html = await (await get(env, `/grade/${id}`)).text();
  assert.ok(html.includes("ChatGPT didn't answer in time."));
  chatgpt.release();
});

// ---- V47: a check without Claude's answer is marked partial ------------------------------------------------

const PARTIAL_LINE = "Partial score: Claude didn&#39;t answer this time, so the AI part isn&#39;t counted. Come back later and press <a href=\"/grade?from=__ID__\">Run a new check</a> to get your full score.";

test('V47: a Grade with no AI answer shows the partial line, the admin list says partial, and a Recheck shows no "before" line', async () => {
  const claude = { name: 'anthropic', async ask() { throw new Error('down'); } };
  // The lead gate is off so the full report (and "Check again") is open without the unlock cookie.
  const env = await startEnv({ assistantProvider: claude, config: { graderLeadGate: false } });
  const id = await begin(env, ROOFER);
  await waitDone(env, id);
  const grade = await storedGrade(env, id);
  assert.equal(grade.results.find(r => r.id === 'ai-named').result, 'not_checked');
  assert.ok(Number.isInteger(grade.score.score), 'the website points still give a number');

  const html = await (await get(env, `/grade/${id}`)).text();
  assert.ok(html.includes(PARTIAL_LINE.replace('__ID__', id)));
  assert.ok(html.includes(`<span class="num">${grade.score.score}</span>`), 'the number is kept');

  const admin = await (await get(env, '/admin/grades', { authorization: `Bearer ${ADMIN}`, accept: 'text/html' })).text();
  assert.ok(admin.includes(`Score: ${grade.score.score} (partial)`));

  assert.equal((await post(env, `/grade/${id}/recheck`)).status, 303);
  const again = await until(async () => {
    const g = await storedGrade(env, id);
    return g.recheckedAt && !g.recheckRunning ? g : null;
  }, 'the recheck');
  assert.equal(again.previousScore, null, 'a partial score is never kept as the "before" score');
  const page = await (await get(env, `/grade/${id}`)).text();
  assert.equal(page.includes('Your score was'), false);
  assert.ok(page.includes(PARTIAL_LINE.replace('__ID__', id)));
});

test('V47: a normal Grade shows no partial line and keeps its "before" line after a Recheck', async () => {
  const env = await startEnv({ assistantProvider: scripted(['1. Other Co\n2. Another Co']), config: { graderLeadGate: false } });
  const id = await begin(env, ROOFER);
  await waitDone(env, id);
  const html = await (await get(env, `/grade/${id}`)).text();
  assert.equal(html.includes('Partial score'), false);
  const admin = await (await get(env, '/admin/grades', { authorization: `Bearer ${ADMIN}`, accept: 'text/html' })).text();
  assert.equal(admin.includes('(partial)'), false);

  assert.equal((await post(env, `/grade/${id}/recheck`)).status, 303);
  const again = await until(async () => {
    const g = await storedGrade(env, id);
    return g.recheckedAt && !g.recheckRunning ? g : null;
  }, 'the recheck');
  assert.ok(Number.isInteger(again.previousScore));
  assert.ok((await (await get(env, `/grade/${id}`)).text()).includes('Your score was'));
});

// ---- V48: at most GRADE_MAX_RUNNING checks at once ------------------------------------------------------------

test('V48: with a limit of 2 and 5 checks started, 2 run, 3 wait in line, and all 5 finish in order', async () => {
  const waiters = [];
  const order = [];
  let active = 0;
  let most = 0;
  const assistant = {
    name: 'anthropic',
    ask({ businessName }) {
      order.push(businessName);
      active += 1;
      most = Math.max(most, active);
      return new Promise(resolve => {
        waiters.push(() => {
          active -= 1;
          resolve(answerOf('1. Other Co'));
        });
      });
    },
  };
  const env = await startEnv({ assistantProvider: assistant, config: { gradeMaxRunning: 2 } });
  const names = ['Shop A', 'Shop B', 'Shop C', 'Shop D', 'Shop E'];
  const ids = [];
  for (const name of names) ids.push(await begin(env, { ...NO_SITE, name }));

  await until(() => order.length === 2, 'two checks running');
  // Give the line a moment: nothing else may start while two are running.
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(order, ['Shop A', 'Shop B']);

  const statusOf = async id => (await get(env, `/grade/${id}/status.json`)).json();
  assert.equal((await statusOf(ids[0])).queued, undefined);
  assert.equal((await statusOf(ids[1])).queued, undefined);
  for (const id of ids.slice(2)) {
    const s = await statusOf(id);
    assert.equal(s.queued, true);
    assert.equal(s.done, false);
    const page = await (await get(env, `/grade/${id}`)).text();
    assert.ok(page.includes("You're in line. Your check starts in a moment."));
    assert.ok(page.includes('<noscript><meta http-equiv="refresh"'), 'works without JavaScript');
  }
  assert.equal((await (await get(env, `/grade/${ids[0]}`)).text()).includes("You're in line"), false);

  // Let them finish, one at a time; the next in line starts as a place frees up.
  for (let i = 0; i < 40 && !(await Promise.all(ids.map(async id => (await statusOf(id)).done))).every(Boolean); i += 1) {
    while (waiters.length > 0) waiters.shift()();
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  for (const id of ids) assert.equal((await statusOf(id)).done, true);
  assert.deepEqual(order, names, 'first in, first out');
  assert.ok(most <= 2, `at most 2 ran at once (saw ${most})`);
  const afterRun = await (await get(env, `/grade/${ids[4]}`)).text();
  assert.equal(afterRun.includes("You're in line"), false);
});

// ---- V49: the lead email goes out in the background ---------------------------------------------------------------

test('V49: the lead form answers at once while a slow email is still being sent, and the email is sent once', async () => {
  let release = () => {};
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  const notifier = {
    name: 'slow',
    async notify() { return { notifier: 'slow', sent: false }; },
    async notifyLead(notice) {
      sent.push({ start: true, business: notice.business });
      await gate;
      sent.push({ end: true });
      return { notifier: 'slow', sent: true };
    },
  };
  const env = await startEnv({ assistantProvider: scripted(['1. Other Co']), notifier });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);

  const LEAD = { name: 'Pat Example', email: 'pat@example.com', phone: '(615) 555-0100', okToContact: '1' };
  const answered = await Promise.race([
    post(env, `/grade/${id}/unlock`, LEAD),
    new Promise((_, reject) => setTimeout(() => reject(new Error('the form waited for the email')), 3000)),
  ]);
  assert.equal(answered.status, 303);
  assert.deepEqual(sent, [{ start: true, business: 'Ace Accounting' }], 'sent once, not finished yet');

  release();
  await until(() => sent.length === 2, 'the email to finish');
  assert.equal(sent.filter(s => s.start).length, 1, 'the email is sent once');
  assert.equal((await env.ctx.store.collection('leads').read()).length, 1, 'the lead is stored');
});

// ---- after the first run of fixes: waiting in line, the "still answering" note, and the second-opinion pause -------

test('V48: a check that waited in line is not failed for the time it waited; its clock starts when it starts', async () => {
  const waiters = [];
  let calls = 0;
  const assistant = {
    name: 'anthropic',
    ask() {
      calls += 1;
      return new Promise(resolve => { waiters.push(() => resolve(answerOf('1. Other Co'))); });
    },
  };
  const env = await startEnv({ assistantProvider: assistant, config: { gradeMaxRunning: 1 } });
  const first = await begin(env, { ...NO_SITE, name: 'Shop A' });
  const second = await begin(env, { ...NO_SITE, name: 'Shop B' });
  await until(() => calls === 1, 'the first check to start');

  // Ten minutes pass while the second check waits behind the first.
  env.clock.t += 10 * 60 * 1000;
  const waiting = await (await get(env, `/grade/${second}/status.json`)).json();
  assert.equal(waiting.status, 'running', 'a check still in line is not failed');
  assert.equal(waiting.queued, true);
  const waitingPage = await (await get(env, `/grade/${second}`)).text();
  assert.ok(waitingPage.includes("You're in line. Your check starts in a moment."));

  // The first finishes; the second starts now and is counted from now, not from when it was created.
  waiters.shift()();
  await until(() => calls === 2, 'the second check to start');
  const started = await (await get(env, `/grade/${second}/status.json`)).json();
  assert.equal(started.status, 'running', 'counted from when it started');
  assert.equal(started.queued, undefined);
  const stored = await storedGrade(env, second);
  assert.ok(stored.startedAt, 'startedAt is stored');
  assert.ok(Date.parse(stored.startedAt) > Date.parse(stored.createdAt) + 9 * 60 * 1000);

  waiters.shift()();
  await waitDone(env, first);
  await waitDone(env, second);
});

test('V48: a check left over from before a restart (no place in line, no start time) still goes stale', async () => {
  const env = await startEnv({ assistantProvider: scripted(['1. Other Co']) });
  const old = { id: 'leftover0000000000001', status: 'running', createdAt: new Date(START).toISOString(), steps: [] };
  env.clock.t += 5 * 60 * 1000;
  assert.equal(env.ctx.grader.isStale(old, env.clock.now()), true);
  assert.equal(env.ctx.grader.isStale({ ...old, startedAt: new Date(env.clock.now() - 60 * 1000).toISOString() }, env.clock.now()), false);
});

test('V46: while a second opinion is still answering the report says so and refreshes; the note goes when it arrives', async () => {
  const chatgpt = heldChatGpt();
  const env = await startEnv({
    assistantProvider: scripted(['1. Bluebird Books']),
    extraAssistants: [chatgpt],
    graderTiming: { secondOpinionTimeoutMs: 60 * 1000 },
  });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);

  const waiting = await (await get(env, `/grade/${id}`)).text();
  assert.ok(waiting.includes('ChatGPT is still answering. This page updates by itself.'));
  assert.ok(waiting.includes('data-grade-rechecking'), 'the script reloads the report while the note shows');
  assert.ok(waiting.includes('<noscript><meta http-equiv="refresh"'), 'and so does the page without JavaScript');

  chatgpt.release();
  const done = await until(async () => {
    const html = await (await get(env, `/grade/${id}`)).text();
    return html.includes('still answering') ? null : html;
  }, 'the note to go');
  assert.equal(done.includes('<noscript><meta http-equiv="refresh"'), false);
  assert.ok((await storedGrade(env, id)).ai.some(a => a.provider === 'chatgpt'));
});

test('V46: when a second opinion runs out of time the "still answering" note is replaced by "didn\'t answer in time"', async () => {
  const chatgpt = heldChatGpt();
  const env = await startEnv({
    assistantProvider: scripted(['1. Bluebird Books']),
    extraAssistants: [chatgpt],
    graderTiming: { secondOpinionTimeoutMs: 100 },
  });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  const html = await until(async () => {
    const page = await (await get(env, `/grade/${id}`)).text();
    return page.includes("ChatGPT didn't answer in time.") && !page.includes('still answering') ? page : null;
  }, 'the time limit to replace the note');
  assert.ok(html.includes("ChatGPT didn't answer in time."));
  chatgpt.release();
});

test('V45: a second opinion never pauses more than 5 seconds before its one retry (Claude may wait up to 20)', async () => {
  const slept = [];
  let tries = 0;
  const chatgpt = {
    name: 'chatgpt',
    async ask() {
      tries += 1;
      if (tries === 1) throw busy(429, 90);
      return answerOf('1. Ace Accounting', 'chatgpt');
    },
  };
  const env = await startEnv({
    assistantProvider: scripted(['1. Bluebird Books']),
    extraAssistants: [chatgpt],
    graderTiming: { sleep: async ms => { slept.push(ms); } },
  });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  await until(async () => (await storedGrade(env, id)).ai.some(a => a.provider === 'chatgpt'), 'the second opinion');
  assert.deepEqual(slept, [5000]);
  assert.equal(tries, 2);
});

test('V53: a provider stays on the "still answering" list until all of its pending answers have arrived', async () => {
  // The free question is answered at once; during the extra questions ChatGPT takes 600 ms on one and 1,200 ms on the other.
  const delays = [0, 600, 1200];
  let asked = 0;
  const chatgpt = {
    name: 'chatgpt',
    async ask() {
      const wait = delays[Math.min(asked, delays.length - 1)];
      asked += 1;
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      return answerOf('1. Ace Accounting', 'chatgpt');
    },
  };
  const env = await startEnv({
    assistantProvider: scripted(['1. Bluebird Books']),
    extraAssistants: [chatgpt],
    config: { graderLeadGate: false },
    graderTiming: { secondOpinionTimeoutMs: 60 * 1000 },
  });
  const id = await begin(env, NO_SITE);
  await waitDone(env, id);
  await get(env, `/grade/${id}`); // with the gate off, the first view starts the extra questions

  // The first extra answer is saved (the free one and this one are on the Grade), but the second is still coming.
  await until(async () => (await storedGrade(env, id)).ai.filter(a => a.provider === 'chatgpt').length >= 2, 'the first extra answer');
  assert.deepEqual(env.ctx.grader.secondPending(id), ['chatgpt'], 'still listed while its other answer is coming');
  const waiting = await (await get(env, `/grade/${id}`)).text();
  assert.ok(waiting.includes('ChatGPT is still answering. This page updates by itself.'));
  assert.ok(waiting.includes('<noscript><meta http-equiv="refresh"'));

  // After the last answer arrives the list is empty and every answer is on the report.
  await until(() => env.ctx.grader.secondPending(id).length === 0, 'the last answer');
  const grade = await storedGrade(env, id);
  assert.equal(grade.ai.filter(a => a.provider === 'chatgpt').length, 3);
  const done = await (await get(env, `/grade/${id}`)).text();
  assert.equal(done.includes('still answering'), false);
});
