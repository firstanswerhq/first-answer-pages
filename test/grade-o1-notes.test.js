/**
 * The notes of the O1 code review (V157 to V163), applied before O3:
 * V157 the partial line links to a new check, not to "Check again"; V158 the free question got no answer but the
 * extras did; V159 the free question is listed first; V160 the score sentence fits every setup; V161 old Grades
 * saved by the removed rescue line; V162 no extra questions after the daily limit; V163 empty entries.
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
  stepNames, freeQuestion, extraQuestions, shownScore, AI_LIMIT_REACHED, AI_FAILED,
} from '../server/lib/grader.js';
import { scoreGrade } from '../server/lib/grade-score.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const FREE = freeQuestion(INPUT);
const [EXTRA_1, EXTRA_2] = extraQuestions(INPUT);
const ID = 'notesAAAAAAAAAAAAAAAAAA';

const NAMED = '1. Zephyr Plumbing\n2. Other Co';
const NOT_NAMED = '1. Other Co\n2. Another Co';
const SITE_HTML = `<!doctype html><html><head><title>Zephyr Plumbing | Plumbers in Nashville, TN</title>
  <meta name="description" content="Zephyr Plumbing fixes pipes, drains and water heaters across Nashville. Call today."></head>
  <body><h1>Plumbers in Nashville</h1><p>${'We fix pipes and drains. '.repeat(20)}</p></body></html>`;

const entry = (prompt, named, extra = {}) => ({
  prompt, provider: 'anthropic', model: 'stub', webSearch: true, answer: named ? NAMED : NOT_NAMED, named,
  position: named ? 1 : null, total: 2, competitors: ['Other Co'], ms: 5, at: AT, ...extra,
});
const second = (prompt, named = false) => entry(prompt, named, { provider: 'chatgpt', second: true });

const pass = (id, extra = {}) => ({ id, result: 'pass', detail: 'ok', ...extra });
const notChecked = detail => ({ id: 'ai-named', result: 'not_checked', detail });
// Nine website checks (44 points available), so the score is a number without the AI part.
const WEBSITE_ONLY = [
  'ai-bots-allowed', 'business-labeled', 'info-sheet', 'title-city-service', 'one-headline', 'summary',
  'image-descriptions', 'share-picture', 'tap-to-call',
].map(id => pass(id));

function grade({ ai = [], results = [...WEBSITE_ONLY, notChecked(AI_FAILED)], state = 'failed', steps = [], input = INPUT } = {}) {
  return {
    id: ID, status: 'done', input, createdAt: AT, finishedAt: AT, steps, facts: null,
    found: { phone: '(615) 555-0100', hours: [], address: '', website: input.website, reviewsLink: '' },
    results, ai, aiMain: { provider: 'anthropic', label: 'Claude', state }, score: scoreGrade(results),
    previousScore: null, recheckedAt: null, extraAiStartedAt: AT,
  };
}

const locked = (g, opts = {}) => reportPage(g, { now: NOW, ...opts });
const open = (g, opts = {}) => reportPage(g, { now: NOW, unlocked: true, ...opts });
const esc = s => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
const answersOf = html => /<section class="grade-all-answers">[^]*?<\/section>/.exec(html)?.[0] ?? '';

// ---- V157: the partial line points at a new check ---------------------------------------------------------------

test('V157: the partial line says "Run a new check", linked to the form with this business filled in', () => {
  const failed = locked(grade({ state: 'failed' }));
  assert.ok(failed.includes(`Partial score: Claude didn&#39;t answer this time, so the AI part isn&#39;t counted. Come back later and press <a href="/grade?from=${ID}">Run a new check</a> to get your full score.</p>`));
  const limit = locked(grade({ state: 'limit', results: [...WEBSITE_ONLY, notChecked(AI_LIMIT_REACHED)] }));
  assert.ok(limit.includes(`Partial score: the daily limit for AI checks was reached, so the AI part isn&#39;t counted. Come back tomorrow and press <a href="/grade?from=${ID}">Run a new check</a> to get your full score.</p>`));
  for (const html of [failed, limit]) {
    assert.equal(/Check again (later|tomorrow) for your full score/.test(html), false, 'no "Check again" in that line');
  }
});

test('V157, V203: "Check again" stays for a Grade with a website; when the AI part is missing the button says what it does', () => {
  const normal = open(grade({ ai: [entry(FREE, true)], results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })], state: 'ok' }));
  assert.ok(normal.includes('>Check again</button>'));
  assert.equal(normal.includes('Recheck my website only'), false);
  for (const state of ['failed', 'limit']) {
    const html = open(grade({ state, results: [...WEBSITE_ONLY, notChecked(state === 'limit' ? AI_LIMIT_REACHED : AI_FAILED)] }));
    assert.ok(html.includes('>Recheck my website only</button>'), state);
    assert.equal(html.includes('>Check again</button>'), false, state);
    assert.ok(html.includes('To ask AI again, press Run a new check at the top of this page.'), state);
  }
});

// ---- the pages that need the app ----------------------------------------------------------------------------------

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeClaude() {
  const fake = {
    name: 'anthropic',
    calls: [],
    async ask({ prompt }) {
      fake.calls.push(prompt);
      return { answer: NOT_NAMED, provider: 'anthropic', model: 'stub', webSearch: true };
    },
  };
  return fake;
}

async function startEnv(assistant, { gradeLeft = 1000 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-o1-notes-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 2000, gradeLimit: gradeLeft });
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
    newGradeId: () => `nts${String(++n).padStart(19, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'notes-token',
      gradeAiCallsPerDay: gradeLeft, gradeMainAsks: 1,
      // Demo mode (on by default in tests) adds a plain `noindex` to every page, which the open /grade page must not have.
      demoMode: false,
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

async function doneGrade(env, input = INPUT) {
  const id = await env.ctx.grader.start(input);
  for (let i = 0; i < 600; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (g && g.status !== 'running') return id;
    await sleep(10);
  }
  throw new Error('the check did not finish');
}

test('V157: the form opens with the business filled in from "?from=", noindex, and nothing is spent', async () => {
  const claude = fakeClaude();
  const env = await startEnv(claude);
  const id = await doneGrade(env, { ...INPUT, noStorefront: true });
  const callsBefore = claude.calls.length;

  const res = await fetch(`${env.base}/grade?from=${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  const html = await res.text();
  for (const value of ['Zephyr Plumbing', 'Nashville', 'TN', 'plumbers', 'https://zephyr.example/']) {
    assert.ok(html.includes(`value="${value}"`), value);
  }
  assert.ok(html.includes('name="noStorefront" value="1" checked'), 'the box is ticked as it was');
  assert.equal(html.includes('rel="canonical"'), false);
  assert.equal(claude.calls.length, callsBefore, 'opening the form asks nothing');

  // A Grade_Id that is not there, or not an id at all: the plain empty form.
  for (const from of ['x'.repeat(22), 'nope', '..%2F..%2Fx', '']) {
    const plain = await (await fetch(`${env.base}/grade?from=${from}`)).text();
    assert.equal(plain.includes('value="Zephyr Plumbing"'), false, from);
    assert.ok(plain.includes('Can AI find your business?'), from);
  }
  // The first plain render is still the open page.
  const bare = await fetch(`${env.base}/grade`);
  assert.equal(bare.headers.get('x-robots-tag'), null);
});

test('V157: what was typed is escaped when the form is filled in', async () => {
  const env = await startEnv(fakeClaude());
  const id = await doneGrade(env, { ...INPUT, name: 'Zeph <b>X</b> Plumbing' });
  const html = await (await fetch(`${env.base}/grade?from=${id}`)).text();
  assert.equal(html.includes('<b>X</b>'), false);
  assert.ok(html.includes('Zeph &lt;b&gt;X&lt;/b&gt; Plumbing'));
});

// ---- V158 -------------------------------------------------------------------------------------------------------

test('V158: the free question got no answer but the extras did, and ChatGPT answered all three', () => {
  const ai = [
    entry(EXTRA_1, true, { extra: true }), entry(EXTRA_2, false, { extra: true }),
    second(FREE), second(EXTRA_1), second(EXTRA_2),
  ];
  const html = open(grade({ ai }));
  const section = answersOf(html);
  assert.ok(section.includes("<p>Claude didn't answer the first question, so this check has no AI score. The other answers are shown below but not counted toward your score.</p>"));
  assert.ok(section.includes("<p>We asked Claude and ChatGPT the same 3 questions. ChatGPT's answers are below so you can compare.</p>"), 'ChatGPT answered 3, not 2');
  assert.ok(section.includes('<p>On the 2 other questions, Claude named your business in 1 of 2. They are not counted toward your score.</p>'));
  assert.equal(section.includes('Your score counts only'), false, 'the first sentence already says it');
  assert.ok(section.includes('Claude (not counted toward your score): '));
});

test('V158: without ChatGPT the same plain sentence is there', () => {
  const html = open(grade({ ai: [entry(EXTRA_1, true, { extra: true }), entry(EXTRA_2, true, { extra: true })] }));
  const section = answersOf(html);
  assert.ok(section.includes("Claude didn't answer the first question, so this check has no AI score."));
  assert.equal(section.includes('We asked'), false);
});

test('V158: when nothing answered at all, the older sentence stays', () => {
  const html = open(grade({ ai: [second(FREE), second(EXTRA_1)] }));
  assert.ok(answersOf(html).includes("Claude didn't answer, so this check has no AI score. The answers from ChatGPT are here so you can compare."));
});

// ---- V159 -------------------------------------------------------------------------------------------------------

test('V159: the free question is listed first, even when carried extra answers were stored before it', () => {
  const ai = [
    entry(EXTRA_1, false, { extra: true }), entry(EXTRA_2, false, { extra: true }),
    entry(FREE, true), entry(FREE, true), entry(FREE, false),
  ];
  const section = answersOf(open(grade({ ai, results: [...WEBSITE_ONLY, pass('ai-named', { earned: 20 })], state: 'ok' })));
  const at = p => section.indexOf(`<strong>${esc(p)}</strong>`);
  assert.ok(at(FREE) !== -1 && at(EXTRA_1) !== -1 && at(EXTRA_2) !== -1);
  assert.ok(at(FREE) < at(EXTRA_1), 'the free question first');
  assert.ok(at(EXTRA_1) < at(EXTRA_2), 'the others keep their order');
});

test('V159: with the free question first already, the order is as it was', () => {
  const ai = [entry(FREE, true), entry(EXTRA_2, false, { extra: true }), entry(EXTRA_1, false, { extra: true })];
  const section = answersOf(open(grade({ ai, results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })], state: 'ok' })));
  const at = p => section.indexOf(`<strong>${esc(p)}</strong>`);
  assert.ok(at(FREE) < at(EXTRA_2) && at(EXTRA_2) < at(EXTRA_1));
});

// ---- V160 -------------------------------------------------------------------------------------------------------

const THREE = [entry(FREE, true), entry(EXTRA_1, false, { extra: true }), entry(EXTRA_2, false, { extra: true })];
const OK = { results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })], state: 'ok' };

test('V160: with the gate on, the ending says it does not change when the report opens', () => {
  const html = open(grade({ ai: THREE, ...OK }));
  assert.ok(html.includes("<p>Only Claude's answers to the first question count toward your score. The other answers are here to compare.</p>"));
});

test('V160: with the gate off, the ending says it stays the same as more answers come in', () => {
  const html = open(grade({ ai: THREE, ...OK }), { leadGate: false });
  assert.ok(html.includes("<p>Only Claude's answers to the first question count toward your score. The other answers are here to compare.</p>"));
  assert.equal(html.includes('when you open this report'), false);
});

test('V160: while only one question has been asked, it says "this question"', () => {
  const ai = [entry(FREE, true), second(FREE)];
  const on = open(grade({ ai, ...OK }));
  assert.ok(on.includes("<p>Only Claude's answers to this question count toward your score. The other answers are here to compare.</p>"));
  const off = open(grade({ ai, ...OK }), { leadGate: false });
  assert.ok(off.includes("<p>Only Claude's answers to this question count toward your score. The other answers are here to compare.</p>"));
});

// ---- V161 -------------------------------------------------------------------------------------------------------

test('V161: an old Grade saved by the rescue line takes its reason from the AI step\'s note', () => {
  // The old line overwrote the state with "ok" once an extra answered, and the extras' answers were scored.
  const stepName = stepNames(INPUT)[3];
  const steps = [{ name: stepName, state: 'skipped', ms: 5, finding: AI_LIMIT_REACHED }];
  const stored = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 2 of 2 answers.', earned: 30 };
  const old = grade({
    ai: [entry(EXTRA_1, true), entry(EXTRA_2, true)], results: [...WEBSITE_ONLY, stored], state: 'ok', steps,
  });
  const html = locked(old);
  assert.ok(html.includes(`Partial score: the daily limit for AI checks was reached, so the AI part isn&#39;t counted. Come back tomorrow and press <a href="/grade?from=${ID}">Run a new check</a> to get your full score.</p>`));
  assert.equal(html.includes('Claude didn&#39;t answer this time'), false);
  assert.ok(Number.isInteger(shownScore(old)), 'the website points still give a number');
  assert.ok(open(old).includes('On the 2 other questions, Claude named you both times.'));
  // Without that note the reason is the plain one.
  const plain = locked(grade({ ai: [entry(EXTRA_1, true), entry(EXTRA_2, true)], results: [...WEBSITE_ONLY, stored], state: 'ok' }));
  assert.ok(plain.includes('Partial score: Claude didn&#39;t answer this time'));
});

// ---- V162 -------------------------------------------------------------------------------------------------------

const LEAD = { name: 'Pat Zephyr', email: 'pat@example.com', phone: '(615) 555-0100', okToContact: false };

test('V162: the free question hit the daily limit, so the extra questions are not asked, and the report says so', async () => {
  const claude = fakeClaude();
  const env = await startEnv(claude, { gradeLeft: 0 });
  const id = await doneGrade(env);
  const before = await env.ctx.grader.get(id);
  assert.equal(before.aiMain.state, 'limit');
  assert.equal(claude.calls.length, 0);

  await env.ctx.grader.unlock(id, LEAD);
  assert.equal(await env.ctx.grader.startExtraQuestions(id), false, 'a repeat call starts nothing either');
  await sleep(100);
  const grade = await env.ctx.grader.get(id);
  assert.equal(claude.calls.length, 0, 'not one paid call');
  assert.ok(!grade.extraAiStartedAt);
  assert.deepEqual(grade.ai, []);
  assert.equal(shownScore(grade), shownScore(before), 'the score does not move');

  const html = open(grade);
  assert.ok(html.includes("The other questions were not asked because today's limit for AI checks was reached."));
  assert.ok(html.includes('Run a new check</a> to get your full score.'));
});

test('V162: a free question that failed (not the limit) still has its extra questions asked', async () => {
  const claude = {
    name: 'anthropic',
    calls: [],
    async ask({ prompt }) {
      claude.calls.push(prompt);
      if (prompt.startsWith('Who are the best ')) throw new Error('down');
      return { answer: NOT_NAMED, provider: 'anthropic', model: 'stub', webSearch: true };
    },
  };
  const env = await startEnv(claude);
  const id = await doneGrade(env);
  await env.ctx.grader.unlock(id, LEAD);
  for (let i = 0; i < 600; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (g.ai.length >= 2) break;
    await sleep(10);
  }
  const grade = await env.ctx.grader.get(id);
  assert.equal(grade.ai.length, 2);
  assert.ok(grade.extraAiStartedAt);
});

// ---- V163 -------------------------------------------------------------------------------------------------------

test('V163: empty entries in the stored answers never crash the report', () => {
  const ai = [null, undefined, 'x', 5, [], entry(FREE, true), entry(EXTRA_1, false, { extra: true })];
  const g = grade({ ai, ...OK });
  let html;
  assert.doesNotThrow(() => { html = open(g); });
  assert.ok(html.includes("On the other question, Claude didn't name your business."));
  assert.doesNotThrow(() => locked(g));
  assert.doesNotThrow(() => open(grade({ ai: [null], ...OK })));
  assert.doesNotThrow(() => open(grade({ ai: [null], state: 'limit' })));
  assert.doesNotThrow(() => open(grade({ ai: 'not a list' })));
});
