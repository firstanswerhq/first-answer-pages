/**
 * Old Grades and the new points (Feature B, task F3; Requirements 19.8 and 19.9). A Grade stored before the
 * reviews-visible Check existed shows one score everywhere, worked out from its stored results with the
 * current points, and is never compared with a score from before the change. Fake assistant, fake fetcher,
 * fake clock; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { freeQuestion } from '../server/lib/grader.js';
import { scoreGrade } from '../server/lib/grade-score.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/grade/', import.meta.url));
const START = Date.UTC(2026, 10, 20, 18, 0, 0);
const TOKEN = 'old-grades-test-token';
const INPUT = { name: 'The Corner Table', city: 'Nashville', state: 'TN', service: 'restaurants', website: 'https://cornertable.example/' };

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The restaurant fixture's results as a Grade made before reviews-visible existed stored them. */
const OLD_RESULTS = [
  ['ai-bots-allowed', 'pass'], ['business-labeled', 'fail'], ['info-sheet', 'fail'], ['title-city-service', 'pass'],
  ['one-headline', 'fail'], ['summary', 'pass'], ['image-descriptions', 'fail'], ['share-picture', 'pass'],
  ['tap-to-call', 'pass'], ['hours-shown', 'pass'], ['address-shown', 'pass'], ['call-button', 'pass'],
  ['ai-named', 'fail'], ['google-profile', 'not_checked'],
].map(([id, result]) => ({ id, result, detail: `${id} ${result}` }));

const NEW_RESULTS = [
  ...OLD_RESULTS.filter(r => r.id !== 'google-profile'),
  { id: 'reviews-visible', result: 'fail', detail: 'We found no customer reviews on your home page.' },
  { id: 'google-profile', result: 'not_checked', detail: 'Google check coming soon' },
];

function storedGrade(id, { results = OLD_RESULTS, score, extraAiStartedAt = null, previousScore = null } = {}) {
  const at = new Date(START - 60 * 60 * 1000).toISOString();
  return {
    id,
    status: 'done',
    input: INPUT,
    key: `old|${id}`,
    createdAt: at,
    finishedAt: at,
    steps: [],
    facts: null,
    found: { phone: '(615) 555-0123', hours: [], address: '123 Main Street', website: INPUT.website },
    results,
    ai: [{
      prompt: freeQuestion(INPUT), provider: 'anthropic', model: 'stub', webSearch: true, answer: '1. Other Co',
      named: false, position: null, total: 1, competitors: ['Other Co'], ms: 5, at,
    }],
    aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' },
    score,
    previousScore,
    draftId: null,
    draftIds: [],
    recheckedAt: null,
    recheckRunning: false,
    recheckFailedAt: null,
    extraAiStartedAt,
  };
}

async function startEnv(grades) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-old-grades-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'grades.json'), JSON.stringify(grades));
  const restaurant = await fs.readFile(path.join(FIXTURES, 'restaurant.html'), 'utf8');
  const clock = { t: START, now() { return this.t; } };
  const counts = { asked: 0 };
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider: {
      name: 'anthropic',
      async ask() { counts.asked += 1; return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; },
    },
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: {
      async fetchText(url) {
        if (new URL(url).pathname === '/') {
          return { status: 200, text: restaurant, contentType: 'text/html; charset=utf-8', finalUrl: url };
        }
        return { status: 404, text: '', contentType: 'text/plain' };
      },
    },
    config: {
      baseUrl: 'http://example.test', graderLeadGate: false, graderSecret: 'test-secret', adminToken: TOKEN, gradeAiCallsPerDay: 150,
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
  return { dir, clock, counts, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const report = async (env, id) => {
  const res = await fetch(`${env.base}/grade/${id}`);
  assert.equal(res.status, 200);
  return res.text();
};

async function waitFor(fn, what) {
  for (let i = 0; i < 300; i += 1) {
    if (await fn()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Every number the report shows for the old restaurant Grade, all from one Score. */
function assertOldRestaurantNumbers(text) {
  assert.ok(text.includes('<span class="num">40</span>'), 'the headline is 40');
  assert.equal(text.includes('<span class="num">42</span>'), false, 'never the stored 42');
  assert.ok(text.includes('5 of 13 checks need work'));
  // Score by area: 8 + 13 + 12 + 0 = 33 of 20 + 20 + 12 + 30 = 82, which is 40.
  assert.ok(text.includes('<strong>Can AI read your website:</strong> 8 of 20 points'));
  assert.ok(text.includes('<strong>Search basics:</strong> 13 of 20 points'));
  assert.ok(text.includes('<strong>Customer basics:</strong> 12 of 12 points'));
  assert.ok(text.includes('<strong>AI answers:</strong> 0 of 30 points'));
  // The Check rows use the same points.
  assert.ok(text.includes('<strong>Tap-to-call phone number</strong><br><span class="grade-points">4 of 4 points</span>'));
  assert.ok(text.includes('<strong>Hours on the home page</strong><br><span class="grade-points">3 of 3 points</span>'));
  assert.ok(text.includes('<strong>Call or book button on the home page</strong><br><span class="grade-points">2 of 2 points</span>'));
  // A Grade stored without the Check simply has no row for it.
  assert.equal(text.includes('<strong>Reviews on your website</strong>'), false);
}

test('F3: the current points give an old restaurant Grade 40, not its stored 42', () => {
  const s = scoreGrade(OLD_RESULTS);
  assert.equal(s.score, 40);
  assert.equal(s.earned, 33);
  assert.equal(s.available, 82);
  assert.equal(s.counted, 13);
  assert.equal(s.failed, 5);
});

test('F3: an old Grade shows one score in the headline, the area lines and the rows, before and after the extra questions', async () => {
  const id = 'oldGradeAAAAAAAAAAAAAA';
  const env = await startEnv([storedGrade(id, { score: { score: 42, earned: 36, available: 85, failed: 5, counted: 13 } })]);
  // The first view (lead gate off) shows the full report and starts the two extra questions.
  assertOldRestaurantNumbers(await report(env, id));

  await waitFor(async () => (await env.ctx.grader.get(id)).ai.length >= 3, 'the extra questions');
  await sleep(50);
  const after = await env.ctx.grader.get(id);
  assert.ok(env.counts.asked >= 2, 'the extra questions were asked');
  assert.equal(after.results.some(r => r.id === 'reviews-visible'), false, 'the extra questions add no website Check');
  assertOldRestaurantNumbers(await report(env, id));
});

test('F3: the admin Grades list shows the same score as the report (40, not the stored 42)', async () => {
  const id = 'oldGradeBBBBBBBBBBBBBB';
  const env = await startEnv([storedGrade(id, {
    score: { score: 42, earned: 36, available: 85, failed: 5, counted: 13 }, extraAiStartedAt: new Date(START).toISOString(),
  })]);
  const res = await fetch(`${env.base}/admin/grades`, { headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/html' } });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('Score: 40'));
  assert.equal(text.includes('Score: 42'), false);
});

test('F3: a Recheck of an old Grade adds the Check and shows no "before" line', async () => {
  const id = 'oldGradeCCCCCCCCCCCCCC';
  const env = await startEnv([storedGrade(id, {
    score: { score: 42, earned: 36, available: 85, failed: 5, counted: 13 }, extraAiStartedAt: new Date(START).toISOString(),
  })]);
  assert.deepEqual(await env.ctx.grader.recheck(id), { started: true });
  await waitFor(async () => Boolean((await env.ctx.grader.get(id)).recheckedAt), 'the recheck');

  const stored = await env.ctx.grader.get(id);
  assert.equal(stored.previousScore, null, 'no score from before the change in points is kept');
  const reviews = stored.results.find(r => r.id === 'reviews-visible');
  assert.ok(reviews, 'the Recheck adds the result');
  assert.equal(reviews.result, 'fail');
  assert.equal(stored.score.score, 39, 'the restaurant page now scores 39');

  const text = await report(env, id);
  assert.equal(text.includes('Your score was'), false);
  assert.ok(text.includes('<span class="num">39</span>'));
  // Batch 5 K10: the card uses the health map's name for this check.
  assert.ok(text.includes('<strong>Reviews shown on your website</strong>'));
});

test('F3: a Grade that already had the Check still shows its "before" line after a Recheck', async () => {
  const id = 'newGradeDDDDDDDDDDDDDD';
  const before = scoreGrade(NEW_RESULTS);
  assert.equal(before.score, 39);
  const env = await startEnv([storedGrade(id, {
    results: NEW_RESULTS, score: before, extraAiStartedAt: new Date(START).toISOString(),
  })]);
  assert.deepEqual(await env.ctx.grader.recheck(id), { started: true });
  await waitFor(async () => Boolean((await env.ctx.grader.get(id)).recheckedAt), 'the recheck');

  const stored = await env.ctx.grader.get(id);
  assert.equal(stored.previousScore, 39);
  const text = await report(env, id);
  assert.ok(text.includes('Your score was 39 before. It is 39 now.'));
});

test('F3: a "before" line stored on an old Grade is not shown while its results lack the Check', async () => {
  const id = 'oldGradeEEEEEEEEEEEEEE';
  const grade = storedGrade(id, {
    score: { score: 42, earned: 36, available: 85, failed: 5, counted: 13 },
    extraAiStartedAt: new Date(START).toISOString(),
    previousScore: 30,
  });
  grade.recheckedAt = new Date(START - 1000).toISOString();
  const env = await startEnv([grade]);
  const text = await report(env, id);
  assert.equal(text.includes('Your score was'), false);
  assert.ok(text.includes('<span class="num">40</span>'));
});
