/**
 * addon-monthly-watch task 5: the grader's two additions for the monthly watch.
 * `readFree(input)` asks the main assistant the free question once, with no second opinion, and returns named,
 * position, total, competitors and a state. `watchEligible(id)` says whether a finished Grade's business has claimed a
 * listing (a Draft made from the Grade, or a published listing for the same business).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 18, 18, 0, 0);
const dirs = [];
after(async () => {
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

const ZEPHYR_LISTING = {
  id: 'zephyr-plumbing-nashville', name: 'Zephyr Plumbing', category: 'plumbers', phone: '(615) 555-0142',
  description: 'We fix pipes and drains in Nashville.', city: 'Nashville', state: 'TN', services: ['Drain cleaning'],
  serviceArea: 'Nashville', hours: { monday: '8am-5pm' }, address: '12 Main Street, Nashville, TN 37203',
};

async function makeEnv({ answer = '1. Other Co\n2. Another Co\n3. Zephyr Plumbing', published } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-grader-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  if (published) await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  const clock = { t: START, now() { return this.t; } };
  const calls = { main: 0, extra: 0, prompts: [] };
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider: {
      name: 'anthropic',
      async ask({ prompt }) {
        calls.main += 1;
        calls.prompts.push(prompt);
        return { answer, provider: 'anthropic', model: 'stub', webSearch: true };
      },
    },
    // A second-opinion assistant on the main grader: the watch's reader must never ask it.
    extraAssistants: [{
      name: 'openai',
      async ask() {
        calls.extra += 1;
        return { answer: '1. Zephyr Plumbing', provider: 'openai', model: 'stub', webSearch: true };
      },
    }],
    nameChecker: null,
    placesLookup: null,
    bingLookup: null,
    safeFetcher: { async fetchText() { throw Object.assign(new Error('no network in tests'), { code: 'timeout' }); } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => 'watchgrade000000000001',
    config: {
      baseUrl: 'http://example.test', graderSecret: 'test-secret', gradeAiCallsPerDay: 150, gradeMainAsks: 1,
      demoMode: false, gradeAiRepeatDays: 0,
    },
  });
  return { dir, clock, calls, ctx: app.locals.ctx };
}

const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' };

function doneGrade(id, input, extra = {}) {
  return {
    id, status: 'done', input, createdAt: new Date(START).toISOString(), finishedAt: new Date(START).toISOString(),
    answers: [], ...extra,
  };
}

test('readFree returns named, position, total, competitors and a state', async () => {
  const env = await makeEnv();
  const read = await env.ctx.watchReader.readFree(INPUT);
  assert.equal(read.state, 'ok');
  assert.equal(read.named, true);
  assert.equal(read.position, 3);
  assert.equal(read.total, 3);
  assert.ok(Array.isArray(read.competitors));
  assert.ok(read.competitors.includes('Other Co'));
  assert.ok(read.competitors.includes('Another Co'));
  assert.equal(read.competitors.includes('Zephyr Plumbing'), false, 'the business itself is not a competitor');
  assert.deepEqual(Object.keys(read).sort(), ['competitors', 'named', 'position', 'state', 'total']);
});

test('readFree: not named gives named false and no position', async () => {
  const env = await makeEnv({ answer: '1. Other Co\n2. Another Co' });
  const read = await env.ctx.watchReader.readFree(INPUT);
  assert.equal(read.state, 'ok');
  assert.equal(read.named, false);
  assert.equal(read.position, null);
  assert.equal(read.total, 2);
});

test('readFree asks the main assistant once, asks no second opinion and uses one AI call', async () => {
  const env = await makeEnv();
  const before = env.ctx.aiBudget.peek({ kind: 'grade' }).remaining;
  await env.ctx.watchReader.readFree(INPUT);
  // Let any stray background work settle before counting.
  await new Promise(r => setTimeout(r, 20));
  assert.equal(env.calls.main, 1, 'the main assistant is asked once');
  assert.equal(env.calls.extra, 0, 'no second opinion');
  assert.equal(env.ctx.aiBudget.peek({ kind: 'grade' }).remaining, before - 1, 'one call from the day');
  assert.ok(env.calls.prompts[0].includes('Nashville'), 'the free question is asked');
  assert.deepEqual(await env.ctx.store.collection('grades').read(), [], 'no Grade is made');
});

test('readFree: the owner\'s own words are used in the question', async () => {
  const env = await makeEnv();
  await env.ctx.watchReader.readFree({ ...INPUT, about: 'fix leaking water heaters' });
  assert.ok(env.calls.prompts[0].includes('"fix leaking water heaters"'));
});

test('readFree: a failed ask gives state failed and nothing named', async () => {
  const env = await makeEnv({ answer: '' });
  const read = await env.ctx.watchReader.readFree(INPUT);
  assert.deepEqual(read, { named: false, position: null, total: 0, competitors: [], state: 'failed' });
});

test('readFree: a bad input asks nothing', async () => {
  const env = await makeEnv();
  const read = await env.ctx.watchReader.readFree({ name: '', city: 'Nashville', state: 'TN', service: 'plumbers' });
  assert.equal(read.state, 'failed');
  assert.equal(env.calls.main, 0);
});

test('watchEligible: an unclaimed finished Grade is not eligible', async () => {
  const env = await makeEnv();
  const input = { name: 'Quillfeather Drain Works', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' };
  await env.ctx.store.collection('grades').append(doneGrade('g-unclaimed', input));
  assert.equal(await env.ctx.watchReader.watchEligible('g-unclaimed'), false);
  assert.equal(await env.ctx.grader.watchEligible('g-unclaimed'), false);
});

test('watchEligible: a claimed Grade (draftId or draftIds) is eligible', async () => {
  const env = await makeEnv();
  const input = { name: 'Quillfeather Drain Works', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' };
  await env.ctx.store.collection('grades').append(doneGrade('g-draft', input, { draftId: 'd1' }));
  await env.ctx.store.collection('grades').append(doneGrade('g-drafts', input, { draftIds: ['d2'] }));
  assert.equal(await env.ctx.watchReader.watchEligible('g-draft'), true);
  assert.equal(await env.ctx.watchReader.watchEligible('g-drafts'), true);
});

test('watchEligible: a Grade with a matching published listing is eligible', async () => {
  const env = await makeEnv({ published: [ZEPHYR_LISTING] });
  await env.ctx.store.collection('grades').append(doneGrade('g-listed', INPUT));
  assert.equal(await env.ctx.watchReader.watchEligible('g-listed'), true);
});

test('watchEligible: a running or missing Grade is not eligible', async () => {
  const env = await makeEnv({ published: [ZEPHYR_LISTING] });
  await env.ctx.store.collection('grades').append({ ...doneGrade('g-running', INPUT, { draftId: 'd1' }), status: 'running' });
  assert.equal(await env.ctx.watchReader.watchEligible('g-running'), false);
  assert.equal(await env.ctx.watchReader.watchEligible('no-such-grade'), false);
});
