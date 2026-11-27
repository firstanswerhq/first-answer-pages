/**
 * The human-style read of the pages (V203 to V220): the sentences people read when a check goes wrong, plain counts,
 * the AI row's advice, the form help, and the two "check first" notes (24-hour hours on a home page, extra questions
 * still being answered). Built from hand-made Grades, so nothing is asked and nothing is fetched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reportPage, aboutPage, gradeFormPage } from '../server/lib/grade-html.js';
import { reviewPage, HOURS_HINT, CATEGORY_GUESSED_OTHER, DESCRIPTION_PLACEHOLDER, SERVICES_PLACEHOLDER } from '../server/lib/rise-html.js';
import { emptyTradeInCityText } from '../server/routes/home.js';
import { HOURS_PATTERN } from '../server/lib/page-facts.js';
import { freeQuestion, extraQuestions, AI_LIMIT_REACHED, AI_FAILED } from '../server/lib/grader.js';
import { scoreGrade } from '../server/lib/grade-score.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const ID = 'readerAAAAAAAAAAAAAAAA';
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

function grade({ ai = [], results = [...WEBSITE_ONLY, notChecked(AI_FAILED)], state = 'failed', steps = [], input = INPUT, extraAiStartedAt = AT } = {}) {
  return {
    id: ID, status: 'done', input, createdAt: AT, finishedAt: AT, steps, facts: null,
    found: { phone: '(615) 555-0100', hours: [], address: '', website: input.website, reviewsLink: '' },
    results, ai, aiMain: { provider: 'anthropic', label: 'Claude', state }, score: scoreGrade(results),
    previousScore: null, recheckedAt: null, extraAiStartedAt,
  };
}
const open = (g, opts = {}) => reportPage(g, { now: NOW, unlocked: true, ...opts });
const locked = (g, opts = {}) => reportPage(g, { now: NOW, ...opts });
const aiRow = html => new RegExp('<li class="grade-check [a-z_]+">(?:(?!</li>)[^])*?<strong>What AI says about your business</strong>(?:(?!</li>)[^])*</li>').exec(html)?.[0] ?? '';

// ---- V203, V204, V211 -------------------------------------------------------------------------------------------

test('V203: one instruction, "Come back ... and press Run a new check", and a bottom button that says what it does', () => {
  const failed = open(grade({ state: 'failed' }));
  assert.ok(failed.includes(`Come back later and tap <a href="/grade?from=${ID}">Run a new check</a> to get your full score.`));
  assert.ok(failed.includes(`Come back later and tap <a href="/grade?from=${ID}">Run a new check</a>.`));
  assert.ok(failed.includes('>Recheck my website only</button>'));
  const limit = open(grade({ state: 'limit', results: [...WEBSITE_ONLY, notChecked(AI_LIMIT_REACHED)] }));
  assert.ok(limit.includes(`Come back tomorrow and tap <a href="/grade?from=${ID}">Run a new check</a> to get your full score.`));
  assert.ok(limit.includes(`Come back tomorrow and tap <a href="/grade?from=${ID}">Run a new check</a>.`));
  assert.ok(limit.includes('>Recheck my website only</button>'));
  for (const html of [failed, limit]) {
    assert.equal(/run the check again (tomorrow|later)/i.test(html), false, 'no second, different instruction');
    // Batch 5 K14: the plain button's new name, so this still checks that it is not shown.
  assert.equal(html.includes('>Check again (website only, fast)</button>'), false);
  }
});

test('V204: with Claude failed and ChatGPT answering, the AI row names Claude, not "AI"', () => {
  const html = open(grade({ state: 'failed', ai: [second(FREE)] }));
  const row = aiRow(html);
  assert.ok(row.includes(`Claude didn&#39;t answer this time, so this part has no score. Come back later and tap <a href="/grade?from=${ID}">Run a new check</a>.`));
  assert.equal(html.includes('AI didn&#39;t answer this time'), false);
  // V242: no "Not counted" badge on this row, as on the daily-limit row.
  assert.equal(row.includes('Not counted'), false);
});

test('V211: the daily-limit AI row keeps "Not checked", says why in one sentence, and has no "Not counted"', () => {
  const row = aiRow(open(grade({ state: 'limit', results: [...WEBSITE_ONLY, notChecked(AI_LIMIT_REACHED)] })));
  assert.ok(row.includes('<span class="grade-result">Not checked</span>'));
  assert.ok(row.includes("We hit today&#39;s limit for AI questions, so this part has no score yet."));
  assert.equal(row.includes('Not counted'), false);
});

// ---- V205 -------------------------------------------------------------------------------------------------------

test('V205: the advice under a failed AI row is "What you can do:" and promises nothing', () => {
  const g = grade({
    ai: [entry(FREE, false), entry(FREE, false), entry(FREE, false)], state: 'ok',
    results: [...WEBSITE_ONLY, { id: 'ai-named', result: 'fail', detail: "No. Claude didn't name your business in any of its 3 answers.", earned: 0 }],
  });
  const row = aiRow(open(g));
  assert.ok(row.includes('<strong>What you can do:</strong>'));
  assert.ok(row.includes('Claim your free listing and work through the fixes below. AI assistants pick up changes over days to weeks. No one can make AI name a business.'));
  assert.equal(row.includes('Fix:'), false);
  assert.equal(row.includes("can&#39;t promise"), false);
});

// ---- V206, V207 -------------------------------------------------------------------------------------------------

test('V206: a 1-in-3 result says so before the list, and where the business stood in that answer', () => {
  const ai = [entry(FREE, true), entry(FREE, false), entry(FREE, false)];
  const html = locked(grade({ ai, state: 'ok', results: [...WEBSITE_ONLY, pass('ai-named', { earned: 10 })] }));
  const lead = html.indexOf('Claude named your business in 1 of 3 answers.');
  const where = html.indexOf('In that answer you were 1st of 2. In the other 2 answers, Claude didn&#39;t name you.');
  const list = html.indexOf('<ol class="grade-competitors">');
  assert.ok(lead !== -1 && where !== -1 && list !== -1);
  assert.ok(lead < where && where < list, 'the count, then the position, then the list');
});

test('V207: counts read as plain words: all, any of, both', () => {
  const all = open(grade({ ai: [entry(FREE, true), entry(FREE, true), entry(FREE, true)], state: 'ok', results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })] }));
  assert.ok(all.includes('<p>Claude named your business in all 3 answers.</p>'));
  assert.equal(all.includes('in 3 of 3 answers'), false);
  assert.equal(all.includes('in 3 of its 3 answers'), false);
  const none = open(grade({ ai: [entry(FREE, false), entry(FREE, false), entry(FREE, false)], state: 'ok', results: [...WEBSITE_ONLY, pass('ai-named', { earned: 0 })] }));
  assert.ok(none.includes("<p>Claude didn't name your business in any of its 3 answers.</p>"));
  assert.equal(none.includes('none of'), false);
  const extrasBoth = open(grade({
    ai: [entry(FREE, true), entry(EXTRA_1, true, { extra: true }), entry(EXTRA_2, true, { extra: true })], state: 'ok',
    results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })],
  }));
  assert.ok(extrasBoth.includes('On the 2 other questions, Claude named you both times.'));
  const extrasNone = open(grade({
    ai: [entry(FREE, true), entry(EXTRA_1, false, { extra: true }), entry(EXTRA_2, false, { extra: true })], state: 'ok',
    results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })],
  }));
  assert.ok(extrasNone.includes("On the 2 other questions, Claude didn't name you."));
});

// ---- V208, V209, V210 -------------------------------------------------------------------------------------------

test('V208: the two numbers are tied together, and a partial score says "could check today"', () => {
  const ok = grade({ ai: [entry(FREE, true)], state: 'ok', results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })] });
  const s = scoreGrade(ok.results);
  assert.ok(locked(ok).includes(`You earned ${s.earned} of the ${s.available} points we checked. That is ${s.score} out of 100.`));
  const failed = grade({ state: 'failed' });
  const p = scoreGrade(failed.results);
  assert.ok(locked(failed).includes(`You earned ${p.earned} of the ${p.available} points we could check today. That is ${p.score} out of 100.`));
});

test('V209, V240: one paragraph says what was asked, which answers count and what the others are for', () => {
  const ai = [entry(FREE, true), second(FREE)];
  const html = open(grade({ ai, state: 'ok', results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })] }));
  assert.ok(html.includes("<p>We asked Claude the question. Only that answer counts toward your score. Claude named you. ChatGPT's answers are here to compare.</p>"));
  assert.equal(html.includes('Your score counts only'), false);
  // The ChatGPT sentence is left out when no other assistant answered.
  const alone = open(grade({ ai: [entry(FREE, true), entry(EXTRA_1, false, { extra: true })], state: 'ok', results: [...WEBSITE_ONLY, pass('ai-named', { earned: 30 })] }));
  assert.ok(alone.includes("<p>We asked Claude 2 questions. Only its answer to the first question counts toward your score. Claude named you. On the other question, Claude didn't name you.</p>"));
  assert.equal(alone.includes("answers are here to compare"), false);
});

test('V210: the listing text says who sends it and who approves it', () => {
  const html = locked(grade({ state: 'failed' }));
  assert.ok(html.includes('Next, check the details and send it to us. Nothing goes live until you send it and we approve it.'));
});

// ---- V212 -------------------------------------------------------------------------------------------------------

test('V212: the about page says plainly what is asked and who sees Google\'s live answer', () => {
  const html = aboutPage();
  assert.ok(html.includes('We ask Claude up to 3 questions. We ask the first question up to 3 times, because AI answers change.'));
  assert.ok(html.includes("When it's switched on, we use Google's Gemini as a checker to see whether each answer names the business."));
  assert.ok(html.includes("The person who ran the check can also see what Google's AI says right now. It is private to them, and we never save it, score it or share it."));
});

// ---- V213, V214, V216 -------------------------------------------------------------------------------------------

test('V213: the draft form help reads plainly, and says when the category was guessed as Other', () => {
  assert.equal(HOURS_HINT, "Type Closed for days you're closed. Leave a day blank only if your hours that day vary from week to week.");
  const draft = (provider, category) => ({
    id: 'draftAAAAAAAAAAAAAAAAAAAAA', status: 'draft', provider, missingFields: ['services'],
    fields: { name: 'Zephyr Plumbing', category, phone: '(615) 555-0100', services: [], city: 'Nashville', state: 'TN', hours: {} },
  });
  const categories = [{ slug: 'plumbers', label: 'Plumbers' }, { slug: 'other', label: 'Other' }];
  const guessed = reviewPage(draft('grader', 'other'), categories, { missingFields: ['services'] });
  assert.ok(guessed.includes(CATEGORY_GUESSED_OTHER));
  assert.equal(CATEGORY_GUESSED_OTHER, 'We picked Other. Choose a better fit if there is one.');
  assert.ok(guessed.includes(`placeholder="${DESCRIPTION_PLACEHOLDER}"`));
  assert.equal(DESCRIPTION_PLACEHOLDER, 'One or two sentences about your business, like who you are and what you do.');
  assert.ok(guessed.includes(`placeholder="${SERVICES_PLACEHOLDER}"`));
  assert.equal(SERVICES_PLACEHOLDER, 'List what you offer, like: repairs, new installs');
  assert.ok(guessed.includes('One per line, or separate with commas.'));
  const typed = reviewPage(draft('manual', 'other'), categories, { missingFields: [] });
  assert.equal(typed.includes(CATEGORY_GUESSED_OTHER), false, 'only a guessed category says so');
  const better = reviewPage(draft('grader', 'plumbers'), categories, { missingFields: [] });
  assert.equal(better.includes(CATEGORY_GUESSED_OTHER), false);
});

test('V214: a form filled in from an earlier check says so, and the plain form does not', () => {
  const note = "We filled this in from your last check. Change anything that's wrong, then press Check my business.";
  const filled = gradeFormPage({ values: { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers' }, prefilled: true });
  assert.ok(filled.includes(note));
  assert.ok(filled.includes('>Check my business</button>'), 'the note names the real button');
  assert.equal(gradeFormPage({ values: {} }).includes('We filled this in'), false);
  assert.equal(gradeFormPage({ values: { name: 'X' }, prefilled: true, errors: { city: 'City is required.' } }).includes('We filled this in'), false);
});

test('V216: a report page uses "didn\'t" in plain sentences and not "did not"', () => {
  const html = open(grade({ state: 'failed', ai: [second(FREE), second(EXTRA_1)] }));
  assert.equal(/\bdid not\b/.test(html.replace(/<script[^]*?<\/script>/g, '')), false);
});

// ---- V217, V218 -------------------------------------------------------------------------------------------------

test('V217: an empty search for a city says what was searched for', () => {
  assert.equal(emptyTradeInCityText('Plumbers', 'Nashville'), 'No plumbers in Nashville yet. Own one?');
  assert.equal(emptyTradeInCityText('Pressure washing', 'Nashville'), 'No pressure washing businesses in Nashville yet. Own one?');
  assert.equal(emptyTradeInCityText('', 'Nashville'), 'No businesses in Nashville yet. Own one?');
});

test('V218: the service in "Your free listing in our directory" starts with a capital letter', () => {
  const html = locked(grade({ state: 'failed' }));
  assert.ok(html.includes('<p>Plumbers in Nashville, TN</p>'));
});

// ---- V219 -------------------------------------------------------------------------------------------------------

test('V219: hours written in 24-hour time after a day count as hours on the home page; a lone time does not', () => {
  for (const text of ['Hours: Mon-Fri 07:00-18:00', 'Open Monday to Friday 8:00 - 17:30', 'Sat 09:00 to 13:00']) {
    assert.ok(HOURS_PATTERN.test(text), text);
  }
  for (const text of ['Call us at 10:30', 'Posted 07:00-18:00 on the blog', 'Our phone is 615-555-0100']) {
    assert.equal(HOURS_PATTERN.test(text), false, text);
  }
  // As before.
  assert.ok(HOURS_PATTERN.test('Mon-Fri 7am-5pm'));
  assert.ok(HOURS_PATTERN.test('Open 24 hours'));
});

// ---- V220 -------------------------------------------------------------------------------------------------------

test('V220: while the other questions are still being answered, the full report says so; later it does not', () => {
  const ai = [entry(FREE, false), entry(EXTRA_1, false, { extra: true })];
  const base = { ai, state: 'ok', results: [...WEBSITE_ONLY, pass('ai-named', { earned: 0 })] };
  const note = 'The other questions are still being answered. This page updates by itself.';
  const recent = new Date(NOW - 30 * 1000).toISOString();
  assert.ok(open(grade({ ...base, extraAiStartedAt: recent })).includes(note));
  // Both extra questions answered: nothing to wait for.
  const done = [...ai, entry(EXTRA_2, false, { extra: true })];
  assert.equal(open(grade({ ...base, ai: done, extraAiStartedAt: recent })).includes(note), false);
  // Started long ago: the note is not shown for ever.
  const old = new Date(NOW - 10 * 60 * 1000).toISOString();
  assert.equal(open(grade({ ...base, extraAiStartedAt: old })).includes(note), false);
  // Never started: nothing to say.
  assert.equal(open(grade({ ...base, extraAiStartedAt: null })).includes(note), false);
});
