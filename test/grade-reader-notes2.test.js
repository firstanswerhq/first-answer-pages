/**
 * The second human-style read and the code review of the first (V225, V205b, V240 to V251): the extra questions'
 * done marker and the notes that depend on it, a way to ask AI again on every report, plain-text hours that are
 * not copied, noindex on empty searches, and the small wording fixes. Hand-made Grades, plus a few small apps.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { reportPage, aboutPage, gradeFormPage } from '../server/lib/grade-html.js';
import { HOURS_HINT } from '../server/lib/rise-html.js';
import { emptyTradeInCityText } from '../server/routes/home.js';
import { runWebsiteChecks, CHECKS } from '../server/lib/grade-checks.js';
import { readPageFacts } from '../server/lib/page-facts.js';
import { freeQuestion, extraQuestions, AI_LIMIT_REACHED, AI_FAILED } from '../server/lib/grader.js';
import { scoreGrade } from '../server/lib/grade-score.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const ID = 'readerTwoAAAAAAAAAAAAA';
const FREE = freeQuestion(INPUT);
const [EXTRA_1, EXTRA_2] = extraQuestions(INPUT);
const NAMED = '1. Zephyr Plumbing\n2. Other Co';
const NOT_NAMED = '1. Other Co\n2. Another Co';

const entry = (prompt, named, extra = {}) => ({
  prompt, provider: 'anthropic', model: 'stub', webSearch: true, answer: named ? NAMED : NOT_NAMED, named,
  position: named ? 1 : null, total: 2, competitors: ['Other Co'], ms: 5, at: AT, ...extra,
});
const second = prompt => entry(prompt, false, { provider: 'chatgpt', second: true });
const pass = (id, extra = {}) => ({ id, result: 'pass', detail: 'ok', ...extra });
const notChecked = detail => ({ id: 'ai-named', result: 'not_checked', detail });
const WEBSITE_ONLY = [
  'ai-bots-allowed', 'business-labeled', 'info-sheet', 'title-city-service', 'one-headline', 'summary',
  'image-descriptions', 'share-picture', 'tap-to-call',
].map(id => pass(id));

function grade({
  ai = [], results = [...WEBSITE_ONLY, notChecked(AI_FAILED)], state = 'failed', steps = [], input = INPUT,
  extraAiStartedAt = AT, extraAiDoneAt, hours = [],
} = {}) {
  return {
    id: ID, status: 'done', input, createdAt: AT, finishedAt: AT, steps, facts: null,
    found: { phone: '(615) 555-0100', hours, address: '', website: input.website, reviewsLink: '' },
    results, ai, aiMain: { provider: 'anthropic', label: 'Claude', state }, score: scoreGrade(results),
    previousScore: null, recheckedAt: null, extraAiStartedAt, ...(extraAiDoneAt === undefined ? {} : { extraAiDoneAt }),
  };
}
const open = (g, opts = {}) => reportPage(g, { now: NOW, unlocked: true, ...opts });
const locked = (g, opts = {}) => reportPage(g, { now: NOW, ...opts });
const okResults = (extra = {}) => [...WEBSITE_ONLY, pass('ai-named', { earned: 30, ...extra })];

// ---- V243, V225-2: the note shows only while the questions really run -----------------------------------------------

test('V243: with Claude failed and ChatGPT answering, a stopped run says it could not get every answer, and does not refresh', () => {
  const g = grade({
    state: 'failed', ai: [second(FREE), second(EXTRA_1), second(EXTRA_2)], extraAiStartedAt: AT, extraAiDoneAt: AT,
  });
  const html = open(g);
  assert.ok(html.includes("We couldn't get answers to every question this time. The ones we got are below."));
  assert.equal(html.includes('still being answered'), false);
  assert.equal(html.includes('http-equiv="refresh"'), false, 'the page does not refresh');
});

test('V225-2: while the run has not ended the note says so and the page refreshes; ended runs and finished runs do not', () => {
  const note = 'The other questions are still being answered. This page updates by itself.';
  const base = { state: 'ok', results: okResults() };
  const running = open(grade({ ...base, ai: [entry(FREE, true)], extraAiStartedAt: new Date(NOW - 30 * 1000).toISOString() }));
  assert.ok(running.includes(note));
  assert.ok(running.includes('http-equiv="refresh"'), 'the page refreshes while the note shows');
  // The run ended early (the marker is there): the other note, no refresh.
  const stopped = open(grade({ ...base, ai: [entry(FREE, true), entry(EXTRA_1, false, { extra: true })], extraAiDoneAt: AT }));
  assert.equal(stopped.includes(note), false);
  assert.ok(stopped.includes("We couldn't get answers to every question this time."));
  assert.equal(stopped.includes('http-equiv="refresh"'), false);
  // Both questions answered: neither note.
  const done = open(grade({ ...base, ai: [entry(FREE, true), entry(EXTRA_1, false, { extra: true }), entry(EXTRA_2, false, { extra: true })], extraAiDoneAt: AT }));
  assert.equal(done.includes(note), false);
  assert.equal(done.includes("We couldn't get answers"), false);
  // A second opinion's answer to an extra question does not count as Claude's.
  const onlySecond = open(grade({ ...base, ai: [entry(FREE, true), second(EXTRA_1), second(EXTRA_2)], extraAiDoneAt: AT }));
  assert.ok(onlySecond.includes("We couldn't get answers to every question this time."));
  // An older report with no marker: shown as running for 5 minutes, then as stopped.
  const recent = open(grade({ ...base, ai: [entry(FREE, true)], extraAiStartedAt: new Date(NOW - 4 * 60 * 1000).toISOString() }));
  assert.ok(recent.includes(note));
  const old = open(grade({ ...base, ai: [entry(FREE, true)], extraAiStartedAt: new Date(NOW - 6 * 60 * 1000).toISOString() }));
  assert.equal(old.includes(note), false);
  assert.ok(old.includes("We couldn't get answers to every question this time."));
  // Never started (for example the daily limit): neither note.
  const never = open(grade({ ...base, ai: [entry(FREE, true)], extraAiStartedAt: null }));
  assert.equal(never.includes('still being answered'), false);
  assert.equal(never.includes("We couldn't get answers"), false);
});

// ---- the app: the run writes its done marker -----------------------------------------------------------------------

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const SITE_HTML = '<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv(assistant) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-reader2-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 100000, gradeLimit: 100000 });
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: assistant,
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { return { status: 200, text: SITE_HTML, contentType: 'text/html' }; } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `rt${String(++n).padStart(20, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: false, graderSecret: 'test-secret', adminToken: 'reader2-token',
      gradeAiCallsPerDay: 100000, gradeMainAsks: 1, demoMode: false,
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

test('V225-2: the extra-question run writes extraAiDoneAt when it ends, also when it stops early', async () => {
  // Claude answers the first question and fails on the others, so the run stops after the first extra question.
  const claude = {
    name: 'anthropic',
    async ask({ prompt }) {
      if (!prompt.startsWith('Who are the best ')) throw new Error('down');
      return { answer: NOT_NAMED, provider: 'anthropic', model: 'stub', webSearch: true };
    },
  };
  const env = await startEnv(claude);
  const id = await env.ctx.grader.start({ ...INPUT, website: '' });
  await until(async () => (await env.ctx.grader.get(id))?.status === 'done', 'the check');
  assert.ok(!(await env.ctx.grader.get(id)).extraAiDoneAt, 'not before the questions run');
  assert.equal(await env.ctx.grader.startExtraQuestions(id), true);
  const grade = await until(async () => {
    const g = await env.ctx.grader.get(id);
    return g.extraAiDoneAt ? g : null;
  }, 'the extra questions to end');
  assert.ok(Date.parse(grade.extraAiDoneAt) > 0);
  assert.ok(grade.extraAiStartedAt);
  assert.equal(grade.ai.filter(a => a.extra === true).length, 0, 'no extra answer came back');
  const html = reportPage(grade, { now: env.clock.now(), unlocked: true });
  assert.ok(html.includes("We couldn't get answers to every question this time. The ones we got are below."));
  assert.equal(html.includes('still being answered'), false);
});

// ---- V251, V244: a way to ask AI again on every report --------------------------------------------------------------

test('V251: every report says how to ask AI again, as a link, and the footer says to run a new check', () => {
  const link = `<a href="/grade?from=${ID}">run a new check</a>`;
  const ok = grade({ ai: [entry(FREE, true)], state: 'ok', results: okResults() });
  const failed = grade({ state: 'failed' });
  for (const g of [ok, failed]) {
    const html = open(g);
    assert.ok(html.includes(`To ask AI again after your changes, ${link}.`));
    assert.ok(html.includes(`so ${link} after you make fixes.`), 'the footer');
    assert.equal(html.includes('look again after you make fixes'), false);
    assert.ok(html.includes("doesn't ask AI again"));
  }
  // The locked report has the footer too.
  assert.ok(locked(ok).includes(`so ${link} after you make fixes.`));
  // A report with no website has no recheck button, and still says how to ask AI again.
  const none = open(grade({ input: { ...INPUT, website: '' }, ai: [entry(FREE, true)], state: 'ok', results: [pass('ai-named', { earned: 30 })] }));
  assert.ok(none.includes(`To ask AI again after your changes, ${link}.`));
});

test('V244: every mention of "Run a new check" is a link, and none says "at the top of this page"', () => {
  const failed = open(grade({ state: 'failed', ai: [second(FREE)] }));
  const limit = open(grade({ state: 'limit', results: [...WEBSITE_ONLY, notChecked(AI_LIMIT_REACHED)] }));
  for (const html of [failed, limit]) {
    const outsideLinks = html.replace(/<a [^>]*>[^<]*<\/a>/g, '');
    assert.equal(/run a new check/i.test(outsideLinks), false, 'every mention is inside a link');
    assert.equal(html.includes('at the top of this page'), false);
    assert.equal(/\bpress\b/.test(html.replace(/<[^>]*>/g, ' ').replace(/press (?:and|release)/g, '')), false, 'tap, not press');
  }
});

// ---- V225-4 -----------------------------------------------------------------------------------------------------

test('V225-4: an old report saved by the rescue line (state "ok" but partial) shows "Recheck my website only"', () => {
  const stored = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 2 of 2 answers.', earned: 30 };
  const g = grade({ ai: [entry(EXTRA_1, true), entry(EXTRA_2, true)], results: [...WEBSITE_ONLY, stored], state: 'ok' });
  const html = open(g);
  assert.ok(html.includes('>Recheck my website only</button>'));
  assert.equal(html.includes('>Check again</button>'), false);
  // Not connected: nothing to ask again, so the plain button stays.
  const off = open(grade({ state: 'not_connected', results: [...WEBSITE_ONLY, notChecked("AI check isn't connected")] }));
  assert.ok(off.includes('>Check again</button>'));
});

// ---- V241 -------------------------------------------------------------------------------------------------------

test('V241: hours found as plain text only are not copied, and the row and the preview say so', () => {
  const results = [...WEBSITE_ONLY, pass('hours-shown'), notChecked(AI_FAILED)];
  const html = open(grade({ results, hours: [] }));
  const row = /<li class="grade-check pass">(?:(?!<\/li>)[^])*?<strong>Hours on the home page<\/strong>(?:(?!<\/li>)[^])*<\/li>/.exec(html)?.[0] ?? '';
  assert.ok(row.includes('<p>Your home page shows your hours in plain text.</p>'));
  assert.ok(html.includes("Hours: <span class=\"blank\">Add your hours (we saw them on your website but couldn&#39;t copy them)</span>"));
  // Hours that were copied are shown as before; no hours and no pass say only "Add your hours".
  const copied = open(grade({ results, hours: ['Mo-Fr 08:00-17:00'] }));
  assert.equal(copied.includes('in plain text'), false);
  assert.ok(copied.includes('Monday to Friday, 8:00 am to 5:00 pm'));
  const none = open(grade({ results: [...WEBSITE_ONLY, { id: 'hours-shown', result: 'fail', detail: 'x' }, notChecked(AI_FAILED)], hours: [] }));
  assert.ok(none.includes('<span class="blank">Add your hours</span>'));
});

// ---- V245, V225-6, V240 --------------------------------------------------------------------------------------------

test('V245: when one answer named the business the list is "the one that named you"; when several did, "the first one"', () => {
  const one = locked(grade({ ai: [entry(FREE, false), entry(FREE, true), entry(FREE, false)], state: 'ok', results: okResults({ earned: 10 }) }));
  assert.ok(one.includes('This list is from answer 2, the one that named you.'));
  const several = locked(grade({ ai: [entry(FREE, true), entry(FREE, true), entry(FREE, false)], state: 'ok', results: okResults({ earned: 20 }) }));
  assert.ok(several.includes('This list is from answer 1, the first one that named you.'));
});

test('V225-6: two of three named: "In 1 answer, Claude didn\'t name you."; one of three: "In the other 2 answers ..."', () => {
  const two = locked(grade({ ai: [entry(FREE, true), entry(FREE, true), entry(FREE, false)], state: 'ok', results: okResults({ earned: 20 }) }));
  assert.ok(two.includes('In the first answer that named you, you were 1st of 2. In 1 answer, Claude didn&#39;t name you.'));
  const one = locked(grade({ ai: [entry(FREE, true), entry(FREE, false), entry(FREE, false)], state: 'ok', results: okResults({ earned: 10 }) }));
  assert.ok(one.includes('In that answer you were 1st of 2. In the other 2 answers, Claude didn&#39;t name you.'));
});

test('V240: "Every answer" says each fact once, in order, and leaves out the ChatGPT sentence when there is none', () => {
  const ai = [entry(FREE, true), entry(FREE, false), entry(FREE, false), entry(EXTRA_1, false, { extra: true }), entry(EXTRA_2, false, { extra: true }), second(FREE)];
  const html = open(grade({ ai, state: 'ok', results: okResults({ earned: 10 }) }));
  assert.ok(html.includes("<p>We asked Claude 3 questions, and asked the first one 3 times. Only those first 3 answers count toward your score. Claude named you in 1 of them. On the 2 other questions, Claude didn't name you. ChatGPT's answers are here to compare.</p>"));
  assert.equal(html.includes('Only Claude&#39;s answers'), false);
  assert.equal(html.includes('We asked Claude and ChatGPT the same'), false);
});

// ---- V242 -------------------------------------------------------------------------------------------------------------

test('V242: the AI row of a failed check has no "Not counted" badge, like the daily-limit row', () => {
  const html = open(grade({ state: 'failed' }));
  const row = /<li class="grade-check not_checked">(?:(?!<\/li>)[^])*?<strong>What AI says about your business<\/strong>(?:(?!<\/li>)[^])*<\/li>/.exec(html)?.[0] ?? '';
  assert.ok(row.includes('<span class="grade-result">Not checked</span>'));
  assert.equal(row.includes('Not counted'), false);
});

// ---- V225-5 ---------------------------------------------------------------------------------------------------------

test('V225-5: a sentence that starts with the assistant\'s name starts with a capital, also for the demo assistant', () => {
  const g = grade({ state: 'failed' });
  g.aiMain = { provider: 'mock', label: 'The demo assistant', state: 'failed' };
  const html = open(g);
  assert.ok(html.includes("The demo assistant didn&#39;t answer this time, so this part has no score."));
  assert.equal(html.includes('>the demo assistant'), false);
});

// ---- V247, V248, V249 --------------------------------------------------------------------------------------------------

test('V247, V248, V249: the about page, the hours hint and the form hint read plainly', () => {
  const about = aboutPage();
  assert.ok(about.includes("When it's switched on, we use Google's Gemini as a checker to see whether each answer names the business."));
  assert.ok(about.includes('Otherwise we look for the name in the answer ourselves.'));
  assert.equal(HOURS_HINT, "Type Closed for days you're closed. Leave a day blank only if your hours that day vary from week to week.");
  assert.ok(gradeFormPage().includes("Leave it empty if you don't have one."));
});

// ---- V250 ----------------------------------------------------------------------------------------------------------------

test('V250, V225-3: the typed city is shown with a capital for each word and is cut at 60 characters', () => {
  assert.equal(emptyTradeInCityText('Plumbers', 'nashville'), 'No plumbers in Nashville yet. Own one?');
  assert.equal(emptyTradeInCityText('', 'st. louis'), 'No businesses in St. Louis yet. Own one?');
  const long = emptyTradeInCityText('Plumbers', 'a'.repeat(100));
  assert.equal(long, `No plumbers in A${'a'.repeat(59)} yet. Own one?`);
});

// ---- V225-3: the home page ------------------------------------------------------------------------------------------------

test('V225-3: a filtered home page with no results is noindex; a page with results and the plain home page are not', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-reader2-home-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  // Demo mode off: demo mode adds its own noindex to every page, which is not what this test looks at.
  // One published plumber in Nashville, so a search the data answers can be told apart from one it cannot (V255).
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify([{
    id: 'zephyr-plumbing-nashville', name: 'Zephyr Plumbing', category: 'plumbers', phone: '(615) 555-0142',
    description: 'We fix pipes and drains in Nashville.', city: 'Nashville', state: 'TN', services: ['Drain cleaning'],
    serviceArea: 'Nashville', hours: { monday: '8am-5pm' }, address: '12 Main Street, Nashville, TN 37203',
  }]));
  const app = createApp({ dataDir: dir, config: { baseUrl: 'http://example.test', graderSecret: 'test-secret', gradeMainAsks: 1, demoMode: false } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const empty = await fetch(`${base}/?category=plumbers&city=Atlantis`);
  assert.equal(empty.headers.get('x-robots-tag'), 'noindex');
  const text = await empty.text();
  assert.ok(text.includes('No plumbers in Atlantis yet. Own one?'));
  const unknown = await fetch(`${base}/?category=no-such-category&city=Nashville`);
  assert.equal(unknown.headers.get('x-robots-tag'), 'noindex');
  await unknown.text();
  const longPage = await (await fetch(`${base}/?city=${'z'.repeat(200)}`)).text();
  const line = /<p class="no-results">[^]*?<\/p>/.exec(longPage)?.[0] ?? '';
  assert.ok(line.includes('yet. Own one?'), 'the empty-search line is shown');
  assert.equal(line.includes('z'.repeat(61)), false, 'the typed city is cut in that line');
  const plain = await fetch(`${base}/`);
  assert.equal(plain.headers.get('x-robots-tag'), null);
  await plain.text();
  // V255: a search the data answers is a real page: no noindex header and no robots tag.
  const answered = await fetch(`${base}/?category=plumbers&city=Nashville`);
  assert.equal(answered.headers.get('x-robots-tag'), null);
  const answeredText = await answered.text();
  assert.ok(answeredText.includes('Zephyr Plumbing'), 'the search found the listing');
  assert.equal(/name="robots"/.test(answeredText), false);
  // V256: for an empty search, the title and the description show the typed city cut at 60 characters, never the whole.
  const longCityPage = await (await fetch(`${base}/?category=plumbers&city=${'z'.repeat(200)}`)).text();
  const title = /<title>([^<]*)<\/title>/.exec(longCityPage)?.[1] ?? '';
  const description = /<meta name="description" content="([^"]*)"/.exec(longCityPage)?.[1] ?? '';
  const zs = text => (text.match(/z/gi) ?? []).length;
  assert.ok(zs(title) > 0 && zs(title) <= 60, `the title shows at most 60 characters of the city (${zs(title)})`);
  assert.ok(zs(description) > 0 && zs(description) <= 60, `the description does too (${zs(description)})`);
});

// ---- V225-7 -----------------------------------------------------------------------------------------------------------------

test('V253: in demo mode the assistant\'s name is lower case in the middle of a sentence and capital at its start', () => {
  const demo = prompt => entry(prompt, false, { provider: 'mock' });
  const g = grade({
    state: 'ok', results: okResults({ earned: 0 }),
    ai: [demo(FREE), demo(EXTRA_1), demo(EXTRA_2)].map((a, i) => ({ ...a, extra: i > 0 })),
  });
  g.aiMain = { provider: 'mock', label: 'The demo assistant', state: 'ok' };
  const html = open(g);
  assert.ok(html.includes('We asked the demo assistant 3 questions.'));
  assert.ok(html.includes("On the 2 other questions, the demo assistant didn't name you."));
  assert.ok(html.includes("The demo assistant didn't name you."), 'a sentence that starts with the name has a capital');
  assert.equal(html.includes('We asked The demo assistant'), false);
  assert.equal(html.includes('questions, The demo assistant'), false);
});

test('V252: with several questions, "that answer" says which answer counts; with one question it stays "that answer"', () => {
  const many = open(grade({ ai: [entry(FREE, true), entry(EXTRA_1, false, { extra: true }), entry(EXTRA_2, false, { extra: true })], state: 'ok', results: okResults() }));
  assert.ok(many.includes('Only its answer to the first question counts toward your score.'));
  assert.equal(many.includes('Only that answer counts toward your score.'), false);
  const one = open(grade({ ai: [entry(FREE, true), second(FREE)], state: 'ok', results: okResults() }));
  assert.ok(one.includes('Only that answer counts toward your score.'));
});

test('V225-7: GET /grade?from= shows the "We filled this in" note, and the plain form does not', async () => {
  const claude = { name: 'anthropic', async ask() { return { answer: NOT_NAMED, provider: 'anthropic', model: 'stub', webSearch: true }; } };
  const env = await startEnv(claude);
  const id = await env.ctx.grader.start({ ...INPUT, website: '' });
  await until(async () => (await env.ctx.grader.get(id))?.status === 'done', 'the check');
  const filled = await (await fetch(`${env.base}/grade?from=${id}`)).text();
  assert.ok(filled.includes("We filled this in from your last check. Change anything that's wrong, then press Check my business."));
  assert.ok(filled.includes('value="Zephyr Plumbing"'));
  const plain = await (await fetch(`${env.base}/grade`)).text();
  assert.equal(plain.includes('We filled this in'), false);
});

test('V225-7: the hours check passes for plain-text hours in 24-hour time after a day', () => {
  const page = text => `<title>Acme Roofing | Roof Repair in Nashville, TN</title><h1>Roof Repair</h1><p>${text} ${'We fix roofs. '.repeat(20)}</p>`;
  const run = html => runWebsiteChecks({
    facts: readPageFacts(html),
    robots: { status: 200, text: 'User-agent: *\nAllow: /' },
    llms: { status: 200, contentType: 'text/plain', text: '# Acme' },
    input: { city: 'Nashville', service: 'roof repair', website: 'https://example.com/' },
  }).find(r => r.id === 'hours-shown');
  assert.equal(run(page('Hours: Mon-Fri 07:00-18:00')).result, 'pass');
  assert.equal(run(page('Call us at 10:30')).result, 'fail');
  assert.equal(run(page('Posted 07:00-18:00 on the blog')).result, 'fail');
  assert.equal(CHECKS.find(c => c.id === 'hours-shown').points, 3);
});

// ---- V205b ---------------------------------------------------------------------------------------------------------------

test('V205b: the AI row\'s advice puts the timing in its own sentence about AI assistants', () => {
  const fix = CHECKS.find(c => c.id === 'ai-named').fix;
  assert.equal(fix, 'Claim your free listing and work through the fixes below. AI assistants pick up changes over days to weeks. No one can make AI name a business.');
  assert.ok(Array.from(fix).length <= 160);
  assert.equal(fix.includes('Changes take'), false);
});
