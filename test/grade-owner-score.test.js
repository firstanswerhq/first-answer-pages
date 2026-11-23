/**
 * Owner decision D1 (task O1, Requirement 26): the score never drops when the full report opens. The AI part is
 * scored from Claude's answers to the free question only; the two extra questions and every second opinion are
 * asked and shown, labeled, and never counted. Also V151 (an extra answer is never taken for the free answer) and
 * V152 (the admin list and a Recheck's "before" number use the same rule as the report).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { reportPage } from '../server/lib/grade-html.js';
import {
  freeAnswersOf, isExtraAnswer, scoredResults, shownScore, freeQuestion, extraQuestions,
} from '../server/lib/grader.js';
import { scoreGrade } from '../server/lib/grade-score.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const FREE = freeQuestion(INPUT);
const [EXTRA_1, EXTRA_2] = extraQuestions(INPUT);

const NAMED = '1. Zephyr Plumbing\n2. Other Co';
const NOT_NAMED = '1. Other Co\n2. Another Co';
const SITE_HTML = `<!doctype html><html><head><title>Zephyr Plumbing | Plumbers in Nashville, TN</title>
  <meta name="description" content="Zephyr Plumbing fixes pipes, drains and water heaters across Nashville. Call today."></head>
  <body><h1>Plumbers in Nashville</h1><p>${'We fix pipes and drains. '.repeat(20)}</p></body></html>`;

// ---- hand-built answers ----------------------------------------------------------------------------------------

const entry = (prompt, named, extra = {}) => ({
  prompt, provider: 'anthropic', model: 'stub', webSearch: true, answer: named ? NAMED : NOT_NAMED, named,
  position: named ? 1 : null, total: 2, competitors: ['Other Co'], ms: 5, at: AT, ...extra,
});
const second = (prompt, named = false) => entry(prompt, named, { provider: 'chatgpt', second: true });

const pass = (id, extra = {}) => ({ id, result: 'pass', detail: 'ok', ...extra });
const fail = id => ({ id, result: 'fail', detail: 'no' });
// Nine website checks (44 points available), so the score is a number even before the AI part is counted.
const WEBSITE_ONLY = [
  'ai-bots-allowed', 'business-labeled', 'info-sheet', 'title-city-service', 'one-headline', 'summary',
  'image-descriptions', 'share-picture', 'tap-to-call',
].map(id => pass(id));

/** A Grade stored while the extra questions still counted: `ai-named` is worked out from every main answer. */
function oldGrade(id, name, ai, stored) {
  const results = [...WEBSITE_ONLY, fail('reviews-visible'), stored];
  return {
    id, status: 'done', input: { ...INPUT, name }, key: `old|${id}`, createdAt: AT, finishedAt: AT, steps: [],
    facts: null, found: { phone: '(615) 555-0100', hours: [], address: '', website: INPUT.website, reviewsLink: '' },
    results, ai, aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: scoreGrade(results),
    previousScore: null, recheckedAt: null, extraAiStartedAt: AT,
  };
}

// An old unlocked Grade whose free answers were named 2 of 3 and whose two extra answers were not: the old rule
// said 2 of 5 (12 of 30), the new one says 2 of 3 (20 of 30), so the score goes up.
const UP_AI = [entry(FREE, true), entry(FREE, true), entry(FREE, false), entry(EXTRA_1, false), entry(EXTRA_2, false)];
const UP_STORED = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 2 of 5 answers.', earned: 12 };
// The other way round: the free answer did not name the business and the extras did. The old rule said 2 of 3
// (20 of 30); the new one says 0 of 1, so the score goes down and the Check turns from pass to fail.
const DOWN_AI = [entry(FREE, false), entry(EXTRA_1, true), entry(EXTRA_2, true)];
const DOWN_STORED = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 2 of 3 answers.', earned: 20 };

const numberOf = html => /<span class="num">(\d+)<\/span>/.exec(html)?.[1];

// ---- the helpers -----------------------------------------------------------------------------------------------

test('D1: freeAnswersOf is the main assistant\'s answers to the free question, never an extra or a second opinion', () => {
  assert.deepEqual(freeAnswersOf(UP_AI).map(a => a.prompt), [FREE, FREE, FREE]);
  assert.deepEqual(freeAnswersOf([second(FREE), ...UP_AI]).length, 3, 'a second opinion is not a free answer');
  assert.deepEqual(freeAnswersOf([]), []);
  assert.deepEqual(freeAnswersOf(undefined), []);
  assert.deepEqual(freeAnswersOf([null, 'x', 5]), []);
});

test('V151: an answer flagged extra, or one whose question starts like an extra question, is never the free answer', () => {
  // Free asks all failed and the extras answered: the first main answer is an extra answer.
  const flagged = [entry(EXTRA_1, true, { extra: true }), entry(EXTRA_2, false, { extra: true })];
  assert.deepEqual(freeAnswersOf(flagged), []);
  // A Grade stored before the flag: told apart by how the question starts, in every wording the extras have had.
  const unflagged = [entry(EXTRA_1, true), entry(EXTRA_2, true)];
  assert.deepEqual(freeAnswersOf(unflagged), []);
  for (const prompt of ['I need plumbers in Nashville, TN. Which companies would you recommend?',
    'Which plumbers in Nashville, TN do people say are the most reliable?',
    "I'm looking for plumbers in Nashville, TN. Which ones would you recommend?",
    'Which plumbers in Nashville, TN do people recommend most?']) {
    assert.equal(isExtraAnswer(entry(prompt, true)), true, prompt);
  }
  for (const prompt of [FREE, 'Who are the best Plumbers in Nashville, TN? Name your top 5.', 'best window cleaners in Tallahassee, FL']) {
    assert.equal(isExtraAnswer(entry(prompt, true)), false, prompt);
  }
  // The free answer still comes first when the extras are stored first (a repeat check that carries them).
  assert.deepEqual(freeAnswersOf([...unflagged, entry(FREE, true)]).map(a => a.prompt), [FREE]);
});

test('D1: scoredResults works the ai-named result out again, and changes nothing else or anything stored', () => {
  const g = oldGrade('oldUpAAAAAAAAAAAAAAAAAA', 'Up Plumbing', UP_AI, UP_STORED);
  const before = JSON.stringify(g);
  const out = scoredResults(g);
  assert.equal(out.find(r => r.id === 'ai-named').earned, 20);
  assert.equal(out.find(r => r.id === 'ai-named').detail, 'Yes. Claude named your business in 2 of 3 answers.');
  assert.deepEqual(out.filter(r => r.id !== 'ai-named'), g.results.filter(r => r.id !== 'ai-named'));
  assert.equal(JSON.stringify(g), before, 'the stored Grade is not written');
  // No stored ai-named result, or no main answer at all: the results are used as they are.
  const bare = { ...g, results: WEBSITE_ONLY };
  assert.equal(scoredResults(bare), bare.results);
  const noAnswers = { ...g, ai: [second(FREE)] };
  assert.equal(scoredResults(noAnswers), noAnswers.results);
});

// ---- old Grades: the same number everywhere, up and down ---------------------------------------------------------

test('V152: an old unlocked Grade goes up, and the report, the headline and the rows agree', () => {
  const g = oldGrade('oldUpAAAAAAAAAAAAAAAAAA', 'Up Plumbing', UP_AI, UP_STORED);
  const stored = scoreGrade(g.results).score;
  const expected = scoreGrade([...WEBSITE_ONLY, fail('reviews-visible'), { id: 'ai-named', result: 'pass', earned: 20 }]).score;
  assert.ok(expected > stored);
  assert.equal(shownScore(g), expected);
  for (const opts of [{}, { unlocked: true }]) {
    const html = reportPage(g, { now: NOW, ...opts });
    assert.equal(numberOf(html), String(expected), 'the headline');
    assert.equal(html.includes(`<span class="num">${stored}</span>`), false, 'never the stored number');
  }
  const full = reportPage(g, { now: NOW, unlocked: true });
  assert.ok(full.includes('20 of 30 points'));
  assert.ok(full.includes('Claude named your business in 2 of its 3 answers.'));
  assert.equal(full.includes('of its 5 answers'), false);
});

test('V152: an old unlocked Grade goes down when only the extra answers named the business, and the Check shows "Needs work"', () => {
  const g = oldGrade('oldDownAAAAAAAAAAAAAAAA', 'Down Plumbing', DOWN_AI, DOWN_STORED);
  const stored = scoreGrade(g.results).score;
  const recomputed = scoredResults(g).find(r => r.id === 'ai-named');
  assert.equal(recomputed.result, 'fail');
  assert.equal(recomputed.earned, 0);
  assert.equal(recomputed.detail, 'No. Claude did not name your business.');
  const expected = scoreGrade([...WEBSITE_ONLY, fail('reviews-visible'), recomputed]).score;
  assert.ok(expected < stored);
  assert.equal(shownScore(g), expected);
  const full = reportPage(g, { now: NOW, unlocked: true });
  assert.equal(numberOf(full), String(expected));
  assert.ok(full.includes('Needs work'));
  assert.ok(full.includes('On the 2 other questions, Claude named your business in 2 of 2. They are not counted toward your score.'));
});

// ---- the report's words -----------------------------------------------------------------------------------------

test('D1: the full report counts the free answers, gives the other questions a line, labels each answer and says which count', () => {
  const ai = [entry(FREE, true), entry(FREE, true), entry(FREE, false), entry(EXTRA_1, true, { extra: true }), entry(EXTRA_2, false, { extra: true }),
    second(FREE), second(EXTRA_1), second(EXTRA_2)];
  const g = { ...oldGrade('mixAAAAAAAAAAAAAAAAAAA', 'Mix Plumbing', ai, UP_STORED) };
  const html = reportPage(g, { now: NOW, unlocked: true });
  assert.ok(html.includes('<p>Claude named your business in 2 of its 3 answers.</p>'));
  assert.ok(html.includes('<p>On the 2 other questions, Claude named your business in 1 of 2. They are not counted toward your score.</p>'));
  assert.ok(html.includes("<p>We asked Claude and ChatGPT the same 3 questions. Claude was asked the first one 3 times. ChatGPT's answers are below so you can compare.</p>"));
  assert.ok(html.includes("<p>Your score counts only Claude's answers to the first question, so it does not change when you open this report.</p>"));
  assert.ok(html.includes('Claude (not counted toward your score): '));
  assert.ok(html.includes('ChatGPT (for comparison only): '));
  assert.ok(html.includes('Claude, answer 1 of 3: '));
  assert.equal(html.includes("Only Claude's answers count toward your score"), false);
  assert.equal(html.includes('stays steady from check to check'), false);
});

test('D1: one other question reads in the singular; none named reads "none of"', () => {
  const one = reportPage(oldGrade('oneAAAAAAAAAAAAAAAAAAA', 'One', [entry(FREE, true), entry(EXTRA_1, true, { extra: true })], UP_STORED), { now: NOW, unlocked: true });
  assert.ok(one.includes('<p>On the other question, Claude named your business. It is not counted toward your score.</p>'));
  const none = reportPage(oldGrade('noneAAAAAAAAAAAAAAAAAA', 'None', [entry(FREE, true), entry(EXTRA_1, false, { extra: true })], UP_STORED), { now: NOW, unlocked: true });
  assert.ok(none.includes('<p>On the other question, Claude did not name your business. It is not counted toward your score.</p>'));
  const zero = reportPage(oldGrade('zeroAAAAAAAAAAAAAAAAAA', 'Zero', [entry(FREE, true), entry(EXTRA_1, false), entry(EXTRA_2, false)], UP_STORED), { now: NOW, unlocked: true });
  assert.ok(zero.includes('On the 2 other questions, Claude named your business in none of 2.'));
  // Only the free question: no line about other questions, and no "does not change" sentence.
  const alone = reportPage(oldGrade('aloneAAAAAAAAAAAAAAAAAA', 'Alone', [entry(FREE, true), entry(FREE, false)], UP_STORED), { now: NOW, unlocked: true });
  assert.equal(alone.includes('other question'), false);
  assert.equal(alone.includes('does not change when you open this report'), false);
});

test('D1: the about page and the Google live line say "to the first question"', async () => {
  const { aboutPage } = await import('../server/lib/grade-html.js');
  assert.ok(aboutPage().includes("Only Claude's answers to the first question count toward the score."));
  const g = oldGrade('liveAAAAAAAAAAAAAAAAAAA', 'Live', [entry(FREE, true)], UP_STORED);
  const html = reportPage(g, { now: NOW, googleLive: true, requester: true, unlocked: true });
  assert.ok(html.includes("Your score comes from Claude's answers to the first question only."));
});

// ---- the pages that need the app --------------------------------------------------------------------------------

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A fake Claude. `free` gives what each free ask answers (an array used in order, or one value for all), `extra`
 * what each extra question answers; an Error is thrown.
 */
function fakeClaude({ free = [NOT_NAMED], extra = NOT_NAMED } = {}) {
  let freeAt = 0;
  const fake = {
    name: 'anthropic',
    calls: [],
    async ask({ prompt }) {
      fake.calls.push(prompt);
      let what;
      if (prompt.startsWith('Who are the best ')) what = free[Math.min(freeAt++, free.length - 1)];
      else what = extra;
      if (what instanceof Error) throw what;
      return { answer: what, provider: 'anthropic', model: 'stub', webSearch: true };
    },
  };
  return fake;
}

async function startEnv(assistant) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-owner-score-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 2000, gradeLimit: 1000 });
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: assistant,
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: {
      async fetchText(url) {
        if (new URL(url).pathname === '/') return { status: 200, text: SITE_HTML, contentType: 'text/html', finalUrl: url };
        return { status: 404, text: '', contentType: 'text/plain' };
      },
    },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `own${String(++n).padStart(19, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'owner-token',
      gradeAiCallsPerDay: 1000, gradeMainAsks: 3,
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
    await aiBudget.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { ctx: app.locals.ctx, clock, base: `http://127.0.0.1:${server.address().port}` };
}

async function until(fn, what) {
  for (let i = 0; i < 600; i += 1) {
    const value = await fn();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function doneGrade(env, input = INPUT) {
  const id = await env.ctx.grader.start(input);
  await until(async () => {
    const g = await env.ctx.grader.get(id);
    return g && g.status !== 'running';
  }, 'the check');
  return id;
}

const LEAD = { name: 'Pat Zephyr', email: 'pat@example.com', phone: '(615) 555-0100', okToContact: false };

/** Open the report as the owner does: store the lead, then wait for the two extra questions to finish. */
async function unlocked(env, id) {
  const lead = await env.ctx.grader.unlock(id, LEAD);
  const grade = await until(async () => {
    const g = await env.ctx.grader.get(id);
    return g.ai.filter(isExtraAnswer).length >= 2 ? g : null;
  }, 'the extra questions');
  return { lead, grade };
}

test('D1: the score is the same before and after the report opens (named 2 of 3, extras not named)', async () => {
  const claude = fakeClaude({ free: [NAMED, NAMED, NOT_NAMED], extra: NOT_NAMED });
  const env = await startEnv(claude);
  const id = await doneGrade(env);
  const before = await env.ctx.grader.get(id);
  const scoreBefore = shownScore(before);
  assert.ok(Number.isInteger(scoreBefore));
  assert.equal(before.results.find(r => r.id === 'ai-named').earned, 20);

  const { lead, grade } = await unlocked(env, id);
  assert.equal(claude.calls.length, 5, 'the extra questions are still asked');
  assert.equal(shownScore(grade), scoreBefore, 'shown score');
  assert.equal(grade.score.score, scoreBefore, 'stored score');
  assert.equal(lead.score, scoreBefore, 'the lead\'s score');
  const named = grade.results.find(r => r.id === 'ai-named');
  assert.equal(named.earned, 20);
  assert.equal(named.detail, 'Yes. Claude named your business in 2 of 3 answers.');
  assert.equal(grade.ai.filter(a => a.extra === true).length, 2, 'the two extra answers are flagged');
  assert.equal(freeAnswersOf(grade.ai).length, 3);

  const lockedHtml = reportPage(before, { now: NOW });
  const openHtml = reportPage(grade, { now: NOW, unlocked: true });
  assert.equal(numberOf(lockedHtml), String(scoreBefore));
  assert.equal(numberOf(openHtml), String(scoreBefore));
  assert.ok(openHtml.includes('<p>Claude named your business in 2 of its 3 answers.</p>'));
  assert.ok(openHtml.includes('On the 2 other questions, Claude named your business in none of 2. They are not counted toward your score.'));
  assert.ok(openHtml.includes('Claude (not counted toward your score): '));
});

test('D1: extras that name the business do not raise the score either', async () => {
  const claude = fakeClaude({ free: [NOT_NAMED], extra: NAMED });
  const env = await startEnv(claude);
  const id = await doneGrade(env);
  const scoreBefore = shownScore(await env.ctx.grader.get(id));
  const { grade } = await unlocked(env, id);
  assert.equal(shownScore(grade), scoreBefore);
  assert.equal(grade.results.find(r => r.id === 'ai-named').result, 'fail');
  const html = reportPage(grade, { now: NOW, unlocked: true });
  assert.ok(html.includes('On the 2 other questions, Claude named your business in 2 of 2.'));
});

test('V151: free asks all fail and the extras answer: the AI part stays not checked, the score partial, the extras shown but not counted', async () => {
  const claude = fakeClaude({ free: [new Error('down')], extra: NAMED });
  const env = await startEnv(claude);
  const id = await doneGrade(env);
  const before = await env.ctx.grader.get(id);
  assert.equal(before.results.find(r => r.id === 'ai-named').result, 'not_checked');
  assert.equal(before.aiMain.state, 'failed');
  const scoreBefore = shownScore(before);
  assert.ok(Number.isInteger(scoreBefore), 'the website points still give a number');

  const { grade } = await unlocked(env, id);
  assert.equal(grade.aiMain.state, 'failed', 'an extra answer no longer says the main assistant answered');
  assert.equal(grade.results.find(r => r.id === 'ai-named').result, 'not_checked');
  assert.equal(shownScore(grade), scoreBefore);
  assert.deepEqual(freeAnswersOf(grade.ai), []);

  const html = reportPage(grade, { now: NOW, unlocked: true });
  assert.ok(html.includes('Partial score: Claude didn&#39;t answer this time, so the AI part isn&#39;t counted.'));
  assert.ok(html.includes("<p>Claude didn't answer this time. Please run the check again later.</p>"), 'the reason in the free part');
  assert.equal(html.includes('We just asked Claude'), false, 'an extra answer is not shown as the free answer');
  assert.ok(html.includes('Claude (not counted toward your score): '));
  assert.ok(html.includes('On the 2 other questions, Claude named your business in 2 of 2.'));
});

test('V152: the admin Grades list shows the report\'s number for old Grades, up and down', async () => {
  const env = await startEnv(fakeClaude());
  const up = oldGrade('oldUpAAAAAAAAAAAAAAAAAA', 'Up Plumbing', UP_AI, UP_STORED);
  const down = oldGrade('oldDownAAAAAAAAAAAAAAAA', 'Down Plumbing', DOWN_AI, DOWN_STORED);
  await env.ctx.store.collection('grades').update(list => { list.push(up, down); });
  const res = await fetch(`${env.base}/admin/grades`, { headers: { authorization: 'Bearer owner-token', accept: 'text/html' } });
  assert.equal(res.status, 200);
  const text = await res.text();
  const shown = name => new RegExp(`${name}</h2>\\s*<p>Nashville, TN &middot; Score: (\\d+)`).exec(text)?.[1];
  assert.equal(shown('Up Plumbing'), String(shownScore(up)));
  assert.equal(shown('Down Plumbing'), String(shownScore(down)));
  assert.notEqual(shown('Up Plumbing'), String(scoreGrade(up.results).score), 'not the stored number');
  assert.notEqual(shown('Down Plumbing'), String(scoreGrade(down.results).score), 'not the stored number');
});

test('V152: a Recheck\'s "before" number is the one the report showed, not the stored score', async () => {
  const env = await startEnv(fakeClaude());
  const up = oldGrade('oldUpAAAAAAAAAAAAAAAAAA', 'Up Plumbing', UP_AI, UP_STORED);
  await env.ctx.store.collection('grades').update(list => { list.push(up); });
  const shownBefore = shownScore(up);
  assert.notEqual(shownBefore, up.score.score);
  assert.deepEqual(await env.ctx.grader.recheck(up.id), { started: true });
  const after = await until(async () => {
    const g = await env.ctx.grader.get(up.id);
    return g.recheckedAt && !g.recheckRunning ? g : null;
  }, 'the recheck');
  assert.equal(after.previousScore, shownBefore);
  assert.ok(Number.isInteger(after.score.score));
  assert.equal(shownScore(after), after.score.score, 'the stored score and the shown score agree after a Recheck');
});

test('D1: a repeat check that carries the extra answers still counts the free answers only', async () => {
  const claude = fakeClaude({ free: [NAMED, NAMED, NOT_NAMED], extra: NOT_NAMED });
  const env = await startEnv(claude);
  const first = await doneGrade(env);
  await unlocked(env, first);
  const callsBefore = claude.calls.length;
  const second = await doneGrade(env);
  const grade = await env.ctx.grader.get(second);
  assert.equal(claude.calls.length, callsBefore, 'Claude is not asked again');
  assert.equal(grade.ai.filter(a => a.extra === true).length, 2, 'the extra answers were carried, flagged');
  const named = grade.results.find(r => r.id === 'ai-named');
  assert.equal(named.earned, 20);
  assert.equal(named.detail, 'Yes. Claude named your business in 2 of 3 answers.');
});

test('D1: a second opinion still never counts', async () => {
  const g = oldGrade('secAAAAAAAAAAAAAAAAAAA', 'Second', [entry(FREE, false), second(FREE, true)], { id: 'ai-named', result: 'fail', detail: 'No. Claude did not name your business.', earned: 0 });
  const out = scoredResults(g).find(r => r.id === 'ai-named');
  assert.equal(out.result, 'fail');
  assert.equal(out.earned, 0);
});
