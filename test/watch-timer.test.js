/**
 * addon-monthly-watch task 9: the hourly timer. It starts only with WATCH_ENABLED=on and never in a test run; it is
 * unref'd; a tick runs nothing while GRADE_MAX_RUNNING checks are running and never rejects; each tick prunes pending
 * watches older than 7 days. No real timer runs here: `runDue` and the tick are called with a fake clock.
 * The log test: a full run (start, confirm, a confirmed change with an email, stop) writes no business, email,
 * question or answer to stderr.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createMockNotifier } from '../server/lib/notifier.js';
import {
  shouldStartWatchTimer, startWatchTimer, watchTick, WATCH_TICK_MS,
} from '../server/lib/watch-service.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 18, 18, 0, 0);
const DAY = 86400000;
const NAME = 'Quillfeather Drain Works';
const EMAIL = 'secret-owner@quillfeather.example';
const ABOUT = 'unclog brass gutters';

const dirs = [];
after(async () => {
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

// ---- the timer ----------------------------------------------------------------------------------------------------

test('the timer starts only with WATCH_ENABLED=on and never in a test run', () => {
  assert.equal(shouldStartWatchTimer({ watchEnabled: true, testRun: false }), true);
  assert.equal(shouldStartWatchTimer({ watchEnabled: true, testRun: true }), false);
  assert.equal(shouldStartWatchTimer({ watchEnabled: false, testRun: false }), false);
  assert.equal(shouldStartWatchTimer({}), false);
});

test('startWatchTimer ticks once an hour and is unref\'d', async () => {
  const calls = [];
  let unrefs = 0;
  let ticks = 0;
  const fake = (fn, ms) => {
    calls.push({ fn, ms });
    return { unref() { unrefs += 1; } };
  };
  startWatchTimer({ tick: async () => { ticks += 1; }, setIntervalFn: fake });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ms, WATCH_TICK_MS);
  assert.equal(WATCH_TICK_MS, 3600000);
  assert.equal(unrefs, 1);
  calls[0].fn();
  await new Promise(r => setImmediate(r));
  assert.equal(ticks, 1);
  // A tick that throws never escapes the timer.
  startWatchTimer({ tick: async () => { throw new Error('boom'); }, setIntervalFn: fake });
  calls[1].fn();
  await new Promise(r => setImmediate(r));
});

test('a tick runs nothing while GRADE_MAX_RUNNING checks are running', async () => {
  let runs = 0;
  const lines = [];
  const service = { async runDue() { runs += 1; return {}; } };
  assert.equal(await watchTick({ service, grader: { busy: () => true }, log: l => lines.push(l) }), null);
  assert.equal(runs, 0);
  assert.deepEqual(lines, ['watch-tick-skipped reason=busy']);
  await watchTick({ service, grader: { busy: () => false } });
  assert.equal(runs, 1);
});

test('a tick that fails resolves and logs a step name only', async () => {
  const lines = [];
  const service = { async runDue() { throw new Error(`secret ${NAME}`); } };
  assert.equal(await watchTick({ service, grader: { busy: () => false }, log: l => lines.push(l) }), null);
  assert.deepEqual(lines, ['watch-tick-failed']);
});

// ---- through createApp ------------------------------------------------------------------------------------------

async function makeApp({ answer }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-timer-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  const clock = { t: START, now() { return this.t; } };
  const notifier = createMockNotifier();
  const stub = { answer, asks: 0 };
  const app = createApp({
    dataDir: dir,
    clock,
    notifier,
    assistantProvider: {
      name: 'anthropic',
      async ask() { stub.asks += 1; return { answer: stub.answer, provider: 'anthropic', model: 'stub', webSearch: true }; },
    },
    extraAssistants: [],
    nameChecker: null,
    placesLookup: null,
    bingLookup: null,
    safeFetcher: { async fetchText() { throw Object.assign(new Error('no network in tests'), { code: 'timeout' }); } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => 'timergrade000000000001',
    config: {
      baseUrl: 'https://pages.example.test', graderSecret: 'test-secret', graderLeadGate: false, gradeMainAsks: 1,
      gradeAiCallsPerDay: 150, demoMode: false, watchEnabled: true, notifierName: 'resend',
    },
  });
  const ctx = app.locals.ctx;
  // A finished, claimed Grade, made by the real grader.
  const gradeId = await ctx.grader.start({ name: NAME, city: 'Nashville', state: 'TN', service: 'plumbers', website: '', about: ABOUT });
  for (let i = 0; i < 500; i += 1) {
    if ((await ctx.grader.get(gradeId))?.status === 'done') break;
    await new Promise(r => setTimeout(r, 10));
  }
  await ctx.store.collection('grades').update(list => { list.find(g => g.id === gradeId).draftId = 'draft-1'; });
  return { ctx, clock, notifier, stub, gradeId };
}

test('createApp in a test run builds the service and its tick, and the grader is not busy at rest', async () => {
  const { ctx } = await makeApp({ answer: '1. Other Co' });
  assert.equal(typeof ctx.watch.runDue, 'function');
  assert.equal(typeof ctx.watchTick, 'function');
  assert.equal(ctx.grader.busy(), false);
});

test('each tick deletes pending watches older than 7 days', async () => {
  const { ctx, clock, gradeId } = await makeApp({ answer: '1. Other Co' });
  const started = await ctx.watch.start({ gradeId, email: EMAIL });
  assert.equal(started.watch.status, 'pending');
  clock.t += 7 * DAY;
  const out = await ctx.watchTick();
  assert.equal(out.pruned, 1);
  assert.equal(await ctx.watch.get(started.watch.id), undefined);
});

test('logs: a full run writes no business, email, question or answer to stderr', async () => {
  const { ctx, clock, notifier, stub, gradeId } = await makeApp({ answer: '1. Other Co\n2. Rival Pipes' });
  const written = [];
  const original = process.stderr.write;
  process.stderr.write = function capture(chunk, ...rest) {
    written.push(String(chunk));
    return original.call(process.stderr, chunk, ...rest);
  };
  let wid;
  try {
    const started = await ctx.watch.start({ gradeId, email: EMAIL });
    assert.equal(started.ok, true);
    wid = started.watch.id;
    assert.equal((await ctx.watch.confirm(wid, started.watch.confirmToken)).ok, true);
    // A month later AI names the business, twice: a confirmed change and an email.
    stub.answer = `1. ${NAME}\n2. Other Co`;
    clock.t += 30 * DAY;
    const out = await ctx.watchTick();
    assert.equal(out.changes, 1);
    assert.equal(notifier.owners.length, 2, 'the confirm email and the alert');
    // A month after that the assistant fails: a retry.
    stub.answer = '';
    clock.t += 30 * DAY;
    await ctx.watchTick();
    await ctx.watch.stop(wid, (await ctx.watch.get(wid)).stopToken);
  } finally {
    process.stderr.write = original;
  }
  const text = written.join('');
  assert.ok(text.includes('[watch]'), 'the watch logs');
  assert.ok(text.includes(wid), 'by watch id');
  for (const secret of [NAME, 'Quillfeather', EMAIL, 'secret-owner', ABOUT, 'Who are the best', 'Other Co', 'Rival Pipes']) {
    assert.equal(text.includes(secret), false, `no "${secret}" in stderr`);
  }
});
