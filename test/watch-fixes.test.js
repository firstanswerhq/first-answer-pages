/**
 * Monthly watch fixes of 2026-11-27: the reader (wording) list and the code list. Each item has its test here, except
 * the wording already pinned in watch-html.test.js. Fake clock, fake reader, mock notifier; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createDataStore } from '../server/data.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { createMockNotifier, EMAIL_RE } from '../server/lib/notifier.js';
import { configFromEnv } from '../server/lib/config.js';
import { setCookieHeader } from '../server/lib/grade-stamp.js';
import {
  createWatchService, MAX_CONFIRM_EMAILS, PAUSED_DAYS, WATCH_RUNS_NOTE,
} from '../server/lib/watch-service.js';
import { SENT_BY, ALREADY_WATCHING_TEXT, RATE_LIMIT_TEXT } from '../server/lib/watch-html.js';
import { EMAIL_LIMIT_TEXT } from '../server/routes/watch.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const README = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
const START = Date.UTC(2026, 10, 18, 18, 0, 0);
const DAY = 86400000;
const EMAIL = 'owner@zephyr.example';
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' };

const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise(r => s.close(r));
  }
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

const answer = (extra = {}) => ({
  prompt: 'Who are the best plumbers in Nashville, TN? Name your top 5.', provider: 'anthropic',
  named: true, position: 2, total: 5, competitors: ['Other Co'], at: new Date(START).toISOString(), ...extra,
});
const grade = (id, extra = {}) => ({
  id, status: 'done', input: INPUT, createdAt: new Date(START).toISOString(), ai: [answer()], draftId: 'd1', ...extra,
});
const named = () => ({ named: true, position: 1, total: 5, competitors: ['Other Co'], state: 'ok' });
const notNamed = () => ({ named: false, position: null, total: 5, competitors: ['Other Co'], state: 'ok' });

async function makeEnv({ reads = [], config = {}, grades = ['g1', 'g2', 'g3', 'g4'].map(id => grade(id)), aiBudget } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-fixes-'));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'listings.json'), '[]');
  await fs.writeFile(path.join(dir, 'categories.json'), '[]');
  const store = createDataStore({ dataDir: dir });
  for (const g of grades) await store.collection('grades').append(g);
  const clock = { t: START, now() { return this.t; } };
  const budget = aiBudget ? aiBudget(clock) : createAiBudget({ clock, limit: 1000, gradeLimit: 100 });
  const notifier = createMockNotifier();
  const reader = {
    calls: 0,
    queue: [...reads],
    delayMs: 0,
    async readFree() {
      this.calls += 1;
      if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
      return this.queue.length > 0 ? this.queue.shift() : named();
    },
    async get(id) { return (await store.collection('grades').read()).find(g => g.id === id); },
    async watchEligible(id) { const g = await this.get(id); return Boolean(g && g.status === 'done' && g.draftId); },
  };
  const logs = [];
  let n = 0;
  const service = createWatchService({
    store, grader: reader, aiBudget: budget, notifier, clock,
    newId: () => `watch${String(++n).padStart(17, '0')}`,
    config: { baseUrl: 'https://pages.example.test', graderSecret: 'test-secret', gradeAiRepeatDays: 0, watchMaxPerDay: 10, watchMaxActive: 200, ...config },
    log: line => logs.push(line),
  });
  return { dir, store, clock, aiBudget: budget, notifier, reader, logs, service };
}

// ================================ the reader (wording) list ======================================================

test('reader 1: NOTIFY_POSTAL_ADDRESS is read from the environment; unset or blank means no line', () => {
  assert.equal(configFromEnv({ NOTIFY_POSTAL_ADDRESS: 'PO Box 1, Nashville, TN 37203' }, { warn: () => {} }).notifyPostalAddress, 'PO Box 1, Nashville, TN 37203');
  assert.equal(configFromEnv({}, { warn: () => {} }).notifyPostalAddress, '');
  assert.equal(configFromEnv({ NOTIFY_POSTAL_ADDRESS: '   ' }, { warn: () => {} }).notifyPostalAddress, '');
});

test('reader 1: the README lists NOTIFY_POSTAL_ADDRESS', () => {
  assert.match(README, /\| `NOTIFY_POSTAL_ADDRESS` \| \(none\) \|/);
});

test('reader 1: the app puts the postal address and the sender line in the watch emails', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-postal-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  const notifier = createMockNotifier();
  const app = createApp({
    dataDir: dir, notifier, nameChecker: null, placesLookup: null, bingLookup: null,
    clock: { t: START, now() { return this.t; } },
    config: {
      baseUrl: 'https://pages.example.test', graderSecret: 'test-secret', demoMode: false, watchEnabled: true,
      notifyPostalAddress: 'PO Box 1, Nashville, TN 37203', contactEmail: 'help@pages.example.test',
    },
  });
  const { ctx } = app.locals;
  await ctx.store.collection('grades').append(grade('postalAAAAAAAAAAAAAAAA'));
  const res = await ctx.watch.start({ gradeId: 'postalAAAAAAAAAAAAAAAA', email: EMAIL });
  assert.equal(res.ok, true);
  const lines = notifier.owners[0].text.split('\n');
  assert.deepEqual(lines.slice(-3), [SENT_BY, 'PO Box 1, Nashville, TN 37203', 'Questions: help@pages.example.test']);
});

test('reader 6 and 11: the README watch paragraphs', () => {
  const at = README.indexOf('**Monthly watch (off by default).**');
  assert.ok(at > 0);
  const part = README.slice(at, README.indexOf('**Privacy.**', at));
  assert.ok(part.startsWith('**Monthly watch (off by default).** When it is on, the full report offers a free monthly check. Once a month we ask Claude the same question about the business. If the answer changes, we check once more and email the owner only if both answers agree.\n'));
  assert.ok(part.includes('\nEvery email has a Stop watching link, and stopping deletes the watch and the email address.\n'));
  assert.ok(part.includes('Changes to your listing may take days or weeks to show up, and we cannot promise they will.'));
  assert.equal(part.includes('AI assistants pick up changes over days to weeks.'), false);
  assert.equal(/\btools?\b/iu.test(part), false);
  for (const key of ['WATCH_MAX_PER_DAY', 'WATCH_MAX_ACTIVE']) {
    const row = README.split('\n').find(l => l.startsWith(`| \`${key}\` |`));
    assert.ok(row, key);
    assert.equal(/reading/iu.test(row), false, `${key} says "check", not "reading"`);
  }
  assert.ok(README.split('\n').find(l => l.startsWith('| `WATCH_MAX_PER_DAY` |')).includes('monthly watch checks a day'));
});

// ================================ the code list ==================================================================

test('code 1: a second start for the same email and Grade sends no new email and returns the watch there', async () => {
  const env = await makeEnv();
  const first = await env.service.start({ gradeId: 'g1', email: EMAIL });
  assert.equal(env.notifier.owners.length, 1);
  const again = await env.service.start({ gradeId: 'g1', email: EMAIL });
  assert.equal(again.ok, true);
  assert.equal(again.existing, true);
  assert.equal(again.watch.id, first.watch.id);
  assert.equal(env.notifier.owners.length, 1, 'no new email');
  assert.equal((await env.store.collection('watches').read()).length, 1);
});

test('code 1: at most 2 confirm emails per address in 24 hours, counted by a hashed key', async () => {
  const env = await makeEnv();
  assert.equal(MAX_CONFIRM_EMAILS, 2);
  assert.equal((await env.service.start({ gradeId: 'g1', email: EMAIL })).ok, true);
  assert.equal((await env.service.start({ gradeId: 'g2', email: EMAIL.toUpperCase() })).ok, true, 'any case is the same address');
  assert.deepEqual(await env.service.start({ gradeId: 'g3', email: EMAIL }), { ok: false, reason: 'email_limit' });
  assert.equal(env.notifier.owners.length, 2);
  assert.equal((await env.store.collection('watches').read()).length, 2, 'the refused start made no watch');
  // Another address is not held back, and a start with no email is never limited.
  assert.equal((await env.service.start({ gradeId: 'g3', email: 'other@zephyr.example' })).ok, true);
  assert.equal((await env.service.start({ gradeId: 'g4' })).ok, true);
  // A day later the address may get a confirm email again.
  const later = await makeEnv();
  await later.service.start({ gradeId: 'g1', email: EMAIL });
  await later.service.start({ gradeId: 'g2', email: EMAIL });
  later.clock.t += DAY + 1000;
  assert.equal((await later.service.start({ gradeId: 'g3', email: EMAIL })).ok, true);
  assert.equal(later.notifier.owners.length, 3);
  // The address is never in a log line.
  for (const line of [...env.logs, ...later.logs]) assert.equal(line.toLowerCase().includes('zephyr.example'), false, line);
});

test('code 1: a stopped address gets no new confirm email for 24 hours', async () => {
  const env = await makeEnv();
  const { watch } = await env.service.start({ gradeId: 'g1', email: EMAIL });
  assert.deepEqual(await env.service.stop(watch.id, watch.stopToken), { ok: true });
  env.clock.t += 60 * 60 * 1000;
  assert.deepEqual(await env.service.start({ gradeId: 'g2', email: EMAIL }), { ok: false, reason: 'email_limit' });
  assert.equal(env.notifier.owners.length, 1);
  env.clock.t += DAY;
  assert.equal((await env.service.start({ gradeId: 'g2', email: EMAIL })).ok, true);
  assert.equal(env.notifier.owners.length, 2);
});

test('code 2: one watch per Grade, with and without an email', async () => {
  const env = await makeEnv();
  const first = await env.service.start({ gradeId: 'g1' });
  for (const email of [null, EMAIL]) {
    const again = await env.service.start({ gradeId: 'g1', email });
    assert.equal(again.existing, true);
    assert.equal(again.watch.id, first.watch.id);
  }
  assert.equal(env.notifier.owners.length, 0, 'no confirm email for the second start');
  assert.equal((await env.store.collection('watches').read()).length, 1);
  // Two starts at the same moment make one watch.
  const both = await Promise.all([env.service.start({ gradeId: 'g2' }), env.service.start({ gradeId: 'g2' })]);
  assert.equal(both[0].watch.id, both[1].watch.id);
  assert.equal((await env.store.collection('watches').read()).filter(w => w.gradeId === 'g2').length, 1);
});

test('code 3: with the aiBudget\'s 50 notes already used, the cap fails closed and nothing is asked', async () => {
  const env = await makeEnv();
  await env.service.start({ gradeId: 'g1' });
  env.clock.t = START + 30 * DAY;
  for (let i = 0; i < 50; i += 1) env.aiBudget.note(`other${i}`);
  assert.equal(env.aiBudget.note(WATCH_RUNS_NOTE), 0, 'the note cannot be written');
  const out = await env.service.runDue();
  assert.equal(out.stopped, 'cap');
  assert.equal(env.reader.calls, 0);
});

test('code 3: a changed reading counts as 2, and the cap stops runDue', async () => {
  const env = await makeEnv({ config: { watchMaxPerDay: 3 }, reads: [notNamed(), notNamed(), notNamed(), notNamed()] });
  const a = (await env.service.start({ gradeId: 'g1' })).watch;
  env.clock.t += 60000;
  const b = (await env.service.start({ gradeId: 'g2' })).watch;
  const out = await env.service.runDue(START + 31 * DAY);
  assert.equal(out.changes, 1, 'the first watch changed: 2 asks');
  assert.equal(out.stopped, 'cap', 'the second watch\'s confirm ask would be the 4th');
  assert.equal(env.reader.calls, 3);
  assert.equal(env.aiBudget.notes()[WATCH_RUNS_NOTE], 3);
  assert.equal((await env.service.get(a.id)).readings.length, 2);
  assert.equal((await env.service.get(b.id)).readings.length, 1, 'nothing saved for the half-done check');
  assert.equal((await env.service.get(b.id)).retries, 0, 'the cap is not a failure');

  const two = await makeEnv({ config: { watchMaxPerDay: 2 }, reads: [notNamed(), notNamed()] });
  await two.service.start({ gradeId: 'g1' });
  two.clock.t += 60000;
  await two.service.start({ gradeId: 'g2' });
  const stopped = await two.service.runDue(START + 31 * DAY);
  assert.equal(two.reader.calls, 2, 'the change used the whole day');
  assert.equal(stopped.stopped, 'cap');
});

test('code 4: a watch paused for more than 14 days is deleted, with its email address', async () => {
  const env = await makeEnv({ reads: [notNamed(), notNamed(), named(), named()] });
  env.notifier.failOwnerSends = 3;
  const started = await env.service.start({ gradeId: 'g1', email: EMAIL });
  await env.service.confirm(started.watch.id, started.watch.confirmToken);
  env.clock.t = START + 30 * DAY;
  await env.service.runDue();
  const at = START + 60 * DAY;
  env.clock.t = at;
  await env.service.runDue();
  const paused = await env.service.get(started.watch.id);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pausedAt, new Date(at).toISOString());
  assert.equal(PAUSED_DAYS, 14);
  assert.equal((await env.service.runDue(at + 14 * DAY)).pruned, 0, 'not yet at 14 days');
  assert.ok(await env.service.get(started.watch.id));
  assert.equal((await env.service.runDue(at + 14 * DAY + 3600000)).pruned, 1);
  assert.equal(await env.service.get(started.watch.id), undefined);
  assert.equal((await fs.readFile(path.join(env.dir, 'watches.json'), 'utf8')).includes(EMAIL), false);
});

test('code 5: the watch reader makes one assistant call and no name-check call', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-namecheck-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  const calls = { ask: 0, check: 0 };
  const app = createApp({
    dataDir: dir,
    clock: { t: START, now() { return this.t; } },
    assistantProvider: { name: 'anthropic', async ask() { calls.ask += 1; return { answer: '1. Other Co\n2. Another Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: { name: 'gemini-decisions', async check() { calls.check += 1; return null; } },
    placesLookup: null,
    bingLookup: null,
    config: { baseUrl: 'http://example.test', graderSecret: 'test-secret', gradeAiCallsPerDay: 150, demoMode: false },
  });
  const read = await app.locals.ctx.watchReader.readFree(INPUT);
  assert.equal(read.state, 'ok');
  assert.equal(calls.ask, 1);
  assert.equal(calls.check, 0);
});

test('code 6: an address the notifier would refuse is refused at start', async () => {
  const env = await makeEnv();
  for (const email of ['a,b@x.com', 'a;b@x.com', 'a<b@x.com', 'nodomain@x']) {
    assert.equal(EMAIL_RE.test(email), false, email);
    assert.deepEqual(await env.service.start({ gradeId: 'g1', email }), { ok: false, reason: 'email' }, email);
  }
  assert.equal(env.notifier.owners.length, 0);
  assert.deepEqual(await env.store.collection('watches').read(), []);
});

test('code 7: two overlapping runDue calls read a watch once (the watch-run lock)', async () => {
  const env = await makeEnv();
  const { watch } = await env.service.start({ gradeId: 'g1' });
  env.reader.delayMs = 30;
  const at = START + 30 * DAY;
  const [a, b] = await Promise.all([env.service.runDue(at), env.service.runDue(at)]);
  assert.equal(env.reader.calls, 1);
  assert.equal(a.asked + b.asked, 1);
  assert.equal((await env.service.get(watch.id)).readings.length, 2);
});

// ---- through the routes ------------------------------------------------------------------------------------------

let ipCounter = 20;
const freshIp = () => `203.0.113.${ipCounter++ % 250}`;

async function startRoutes({ config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-fixes-routes-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir, clock, notifier: createMockNotifier(),
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [], nameChecker: null, placesLookup: null, bingLookup: null,
    safeFetcher: { async fetchText() { throw Object.assign(new Error('no network in tests'), { code: 'timeout' }); } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `fx${String(++n).padStart(20, '0')}`,
    config: {
      baseUrl: 'https://pages.example.test', graderSecret: 'test-secret', graderLeadGate: false, gradeMainAsks: 1,
      gradeAiCallsPerDay: 150, demoMode: false, trustProxy: 1, watchEnabled: true, notifierName: 'resend', ...config,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(r => server.once('listening', r));
  const env = { clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
  // A finished, claimed Grade made by a real check.
  const form = await (await fetch(`${env.base}/grade`, { headers: { 'x-forwarded-for': freshIp() } })).text();
  const t = /name="t" value="([^"]+)"/u.exec(form)[1];
  clock.t += 5000;
  const made = await fetch(`${env.base}/grade`, {
    method: 'POST', redirect: 'manual', headers: { 'x-forwarded-for': freshIp() },
    body: new URLSearchParams({ nickname: '', t, name: 'Quillfeather Drain Works', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' }),
  });
  env.gradeId = /\/grade\/([^/?#]+)$/u.exec(made.headers.get('location'))[1];
  for (let i = 0; i < 500 && (await env.ctx.grader.get(env.gradeId))?.status !== 'done'; i += 1) await new Promise(r => setTimeout(r, 10));
  await env.ctx.store.collection('grades').update(list => { list.find(g => g.id === env.gradeId).draftId = 'draft-1'; });
  return env;
}

const stampOf = html => /action="\/grade\/[^"]+\/watch">\s*<input type="hidden" name="t" value="([^"]+)"/u.exec(html)?.[1];

async function postStart(env, fields = {}, headers = {}) {
  const report = await (await fetch(`${env.base}/grade/${env.gradeId}`, { headers: { 'x-forwarded-for': freshIp(), ...headers } })).text();
  const t = stampOf(report);
  assert.ok(t, 'the report has the watch form');
  env.clock.t += 5000;
  return fetch(`${env.base}/grade/${env.gradeId}/watch`, {
    method: 'POST', redirect: 'manual', headers: { 'x-forwarded-for': freshIp(), ...headers }, body: new URLSearchParams({ t, ...fields }),
  });
}

test('code 2 (route): a second start on the same report goes to the existing watch page, which says so', async () => {
  const env = await startRoutes();
  const first = await postStart(env);
  assert.equal(first.status, 303);
  const wid = /^\/watch\/([A-Za-z0-9_-]{22})$/u.exec(first.headers.get('location'))[1];
  for (const fields of [{}, { email: EMAIL }]) {
    const again = await postStart(env, fields);
    assert.equal(again.status, 303);
    assert.equal(again.headers.get('location'), `/watch/${wid}?already=1`);
  }
  const page = await (await fetch(`${env.base}/watch/${wid}?already=1`)).text();
  assert.ok(page.includes(ALREADY_WATCHING_TEXT));
  assert.equal((await (await fetch(`${env.base}/watch/${wid}`)).text()).includes(ALREADY_WATCHING_TEXT), false);
});

test('code 1 (route): the address limit shows one plain message', async () => {
  const env = await startRoutes();
  // Make the address hit its limit through two other reports' watches.
  for (const id of ['fxAAAAAAAAAAAAAAAAAAAA', 'fxBBBBBBBBBBBBBBBBBBBB']) {
    const g = await env.ctx.grader.get(env.gradeId);
    await env.ctx.store.collection('grades').append({ ...structuredClone(g), id });
    assert.equal((await env.ctx.watch.start({ gradeId: id, email: EMAIL })).ok, true);
  }
  const res = await postStart(env, { email: EMAIL });
  assert.equal(res.status, 429);
  assert.ok((await res.text()).includes(EMAIL_LIMIT_TEXT.replace(/'/gu, '&#39;')));
});

test('reader 10 (route): the rate-limit page has a next step', async () => {
  const env = await startRoutes();
  const ip = '198.51.100.44';
  let last;
  for (let i = 0; i < 21; i += 1) {
    last = await fetch(`${env.base}/watch/abcdefghijklmnopqrstuv/confirm`, { method: 'POST', headers: { 'x-forwarded-for': ip }, body: new URLSearchParams({ t: 'x' }) });
  }
  assert.equal(last.status, 429);
  assert.ok((await last.text()).includes(RATE_LIMIT_TEXT));
});

test('code 7 (route): a start with the lead gate on and a valid unlock cookie', async () => {
  const env = await startRoutes({ config: { graderLeadGate: true } });
  const cookie = setCookieHeader('test-secret', 'unlock', env.gradeId).split(';')[0];
  const locked = await (await fetch(`${env.base}/grade/${env.gradeId}`)).text();
  assert.equal(stampOf(locked), undefined, 'no form without the cookie');
  const res = await postStart(env, {}, { cookie });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/watch\/[A-Za-z0-9_-]{22}$/u);
  assert.equal((await env.ctx.store.collection('watches').read()).length, 1);
});

test('code 8: the README says the start limits need TRUST_PROXY behind a proxy', () => {
  assert.ok(README.includes('The limits on starting a watch count per client address, so behind a proxy they work only when `TRUST_PROXY` is set to the right hop count.'));
});
