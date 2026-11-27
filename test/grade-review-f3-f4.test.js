/**
 * The F3 review (V77, V78) and the F4 review (V79): an old Grade's lead score, junk entries in `results`, and
 * the service-area window that runs to the end of the sentence. Fake assistant, fake notifier, fake clock.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { freeQuestion, shownScore } from '../server/lib/grader.js';
import { reportPage } from '../server/lib/grade-html.js';
import { runWebsiteChecks } from '../server/lib/grade-checks.js';
import { readPageFacts, serviceAreaPattern, serviceAreaSource } from '../server/lib/page-facts.js';
import { createMockNotifier } from '../server/lib/notifier.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 22, 18, 0, 0);
const INPUT = { name: 'The Corner Table', city: 'Nashville', state: 'TN', service: 'restaurants', website: 'https://cornertable.example/' };
const MB = 1024 * 1024;

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The restaurant fixture's results from before reviews-visible existed: 40 now, 42 when stored. */
const OLD_RESULTS = [
  ['ai-bots-allowed', 'pass'], ['business-labeled', 'fail'], ['info-sheet', 'fail'], ['title-city-service', 'pass'],
  ['one-headline', 'fail'], ['summary', 'pass'], ['image-descriptions', 'fail'], ['share-picture', 'pass'],
  ['tap-to-call', 'pass'], ['hours-shown', 'pass'], ['address-shown', 'pass'], ['call-button', 'pass'],
  ['ai-named', 'fail'], ['google-profile', 'not_checked'],
].map(([id, result]) => ({ id, result, detail: `${id} ${result}` }));
const OLD_SCORE = { score: 42, earned: 36, available: 85, failed: 5, counted: 13 };

function storedGrade(id, extra = {}) {
  const at = new Date(START - 60 * 60 * 1000).toISOString();
  return {
    id, status: 'done', input: INPUT, key: `old|${id}`, createdAt: at, finishedAt: at, steps: [], facts: null,
    found: { phone: '(615) 555-0123', hours: [], address: '123 Main Street', website: INPUT.website },
    results: OLD_RESULTS,
    ai: [{
      prompt: freeQuestion(INPUT), provider: 'anthropic', model: 'stub', webSearch: true, answer: '1. Other Co',
      named: false, position: null, total: 1, competitors: ['Other Co'], ms: 5, at,
    }],
    aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' },
    score: OLD_SCORE, previousScore: null, draftId: null, draftIds: [], recheckedAt: null,
    recheckRunning: false, recheckFailedAt: null, extraAiStartedAt: at,
    ...extra,
  };
}

async function startEnv(grades) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-review-f3-f4-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'grades.json'), JSON.stringify(grades));
  const notifier = createMockNotifier();
  const app = createApp({
    dataDir: dir,
    clock: { now: () => START },
    notifier,
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { throw new Error('no network in tests'); } },
    config: { baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'f3f4-token', gradeAiCallsPerDay: 150 },
  });
  cleanups.push(async () => {
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { ctx: app.locals.ctx, notifier };
}

const LEAD = { name: 'Dana Ray', email: 'dana@example.com', phone: '(615) 555-0199', okToContact: true };

// ---- V77 -------------------------------------------------------------------------------------------

test('V77: a lead from an old Grade stores the score its report shows (40), not the stored 42', async () => {
  const id = 'leadOldAAAAAAAAAAAAAAA';
  const env = await startEnv([storedGrade(id)]);
  const lead = await env.ctx.grader.unlock(id, LEAD);
  assert.equal(lead.score, 40);
  for (let i = 0; i < 100 && env.notifier.leads.length === 0; i += 1) await sleep(10);
  assert.equal(env.notifier.leads[0].score, 40, 'the lead email agrees with the report');
  const saved = await env.ctx.store.collection('leads').read();
  assert.equal(saved.find(l => l.gradeId === id).score, 40);
});

test('V77: a Grade stored with no results keeps its stored score on the lead, like the report', async () => {
  const id = 'leadOldBBBBBBBBBBBBBBB';
  const env = await startEnv([storedGrade(id, { results: [] })]);
  assert.equal((await env.ctx.grader.unlock(id, LEAD)).score, 42);
  assert.equal(shownScore({ results: [], score: { score: 42 } }), 42);
  assert.equal(shownScore({ results: OLD_RESULTS, score: OLD_SCORE }), 40);
  assert.equal(shownScore({}), null);
  assert.equal(shownScore(undefined), null);
  assert.equal(shownScore({ results: [null, 'x'], score: { score: 7 } }), 7, 'junk only counts as no results');
});

// ---- V78 -------------------------------------------------------------------------------------------

test('V78: junk entries in results are left out and the report still renders', () => {
  const junk = [null, undefined, 5, 'x', [], { result: 'pass' }, { id: 7, result: 'pass' }, { id: null }];
  const grade = storedGrade('junkCCCCCCCCCCCCCCCCCC', { results: [...junk, ...OLD_RESULTS] });
  let html;
  assert.doesNotThrow(() => { html = reportPage(grade, { leadGate: false }); });
  assert.ok(html.includes('<span class="num">40</span>'), 'the score comes from the real results');
  assert.ok(html.includes('Tap-to-call phone number'));
  // Only junk: the stored score stays, as for a Grade with no results.
  let onlyJunk;
  assert.doesNotThrow(() => { onlyJunk = reportPage(storedGrade('junkDDDDDDDDDDDDDDDDDD', { results: junk }), { leadGate: false }); });
  assert.ok(onlyJunk.includes('<span class="num">42</span>'));
  assert.doesNotThrow(() => reportPage(storedGrade('junkEEEEEEEEEEEEEEEEEE', { results: 'not a list' })));
});

// ---- V79 -------------------------------------------------------------------------------------------

const nashville = serviceAreaPattern('Nashville');
const FILLER = `<p>${'We clean windows and gutters for homes and shops. '.repeat(8)}</p>`;

function serviceAreaResult(body) {
  const facts = readPageFacts(`<title>Capital City Window</title><h1>Window cleaning</h1>${FILLER}${body}`);
  const input = { name: 'Capital City Window', city: 'Nashville', state: 'TN', service: 'window cleaning', website: 'https://example.com/', noStorefront: true };
  return runWebsiteChecks({ facts, robots: { status: 404 }, llms: { status: 404 }, input }).find(r => r.id === 'address-shown').result;
}

test('V79: town lists and longer "serving" lines that end in the city pass', () => {
  for (const line of [
    'Serving Franklin, Brentwood, Murfreesboro, Hendersonville and Nashville',
    'Serving homeowners and businesses throughout Middle Tennessee, including Nashville',
    'Proudly serving residential and commercial customers in Nashville',
  ]) {
    assert.equal(nashville.test(line), true, line);
    assert.equal(serviceAreaResult(`<p>${line}</p>`), 'pass', line);
  }
});

test('V79: the window stops at the end of a sentence, so the breakfast line still fails', () => {
  for (const line of [
    'We serve breakfast all day. Visit us at 12 Main St, Nashville, TN',
    'Now serving pancakes! Find us in Nashville.',
    'Are we serving brunch? Ask anyone in Nashville.',
  ]) {
    assert.equal(nashville.test(line), false, line);
    assert.equal(serviceAreaResult(`<p>${line}</p>`), 'fail', line);
  }
  // A line break ends the window too.
  assert.equal(nashville.test('Serving breakfast\nNashville'), false);
});

test('V79: the designed examples still pass on the page text', () => {
  const cases = [
    ['Our service area covers all of Davidson County.', 'Nashville'],
    ['Service Areas', 'Nashville'],
    ['Areas we serve: Nashville, Franklin and Brentwood.', 'Nashville'],
    ['Serving Nashville and nearby areas.', 'Nashville'],
    ['We serve Nashville, Franklin and Brentwood.', 'Nashville'],
    ['We proudly serve the greater Nashville area.', 'Nashville'],
    ['Proudly serving homeowners across Williamson County.', 'Nashville'],
    ['Serving the surrounding communities since 1998.', 'Nashville'],
    ['Nashville and the surrounding areas.', 'Nashville'],
    ['Tallahassee and neighboring counties', 'Tallahassee'],
    ['Serving St. Louis and nearby areas', 'St. Louis'],
    ['We serve all of St. Louis.', 'St. Louis'],
    ['Serving Winston-Salem and the Triad', 'Winston-Salem'],
  ];
  for (const [line, city] of cases) {
    assert.equal(serviceAreaPattern(city).test(serviceAreaSource({ text: line })), true, line);
  }
  // Still not a service area.
  for (const line of ['Serving biscuits every morning.', 'We serve breakfast all day.', '12 Main Street, Nashville, TN 37201']) {
    assert.equal(nashville.test(line), false, line);
  }
});

test('V79: the window is at most 120 characters', () => {
  assert.equal(nashville.test(`Serving ${'x'.repeat(118)} Nashville`), true);
  assert.equal(nashville.test(`Serving ${'x'.repeat(125)} Nashville`), false);
});

test('V79: a 1 MB page of "serving " and other hard pages stay under 200 ms', () => {
  const area = serviceAreaPattern('Nash|ville St. Louis A++');
  const pages = {
    'serving, repeated': 'serving '.repeat(Math.ceil(MB / 8)).slice(0, MB),
    'serving Nashville, no end': 'serving nashville '.repeat(Math.ceil(MB / 18)).slice(0, MB),
    'Nashville, repeated': 'Nashville '.repeat(Math.ceil(MB / 10)).slice(0, MB),
    'area words, repeated': 'nearby areas '.repeat(Math.ceil(MB / 13)).slice(0, MB),
    'St. Louis, repeated': 'St. Louis '.repeat(Math.ceil(MB / 10)).slice(0, MB),
  };
  for (const [name, text] of Object.entries(pages)) {
    for (const re of [nashville, area]) {
      const source = serviceAreaSource({ text });
      const start = performance.now();
      re.test(source);
      const ms = performance.now() - start;
      assert.ok(ms < 200, `${name} took ${Math.round(ms)} ms`);
    }
  }
});
