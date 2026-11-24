/**
 * Owner decision D2 (task O2, Requirement 27): the AI check's row says "Partly", not "Pass", when AI named the
 * business in only some answers. A display label only: the stored result, the points, the score and the count of
 * checks that need work do not change. Pure rendering of hand-built Grades.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { reportPage } from '../server/lib/grade-html.js';
import { scoreGrade } from '../server/lib/grade-score.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };

const pass = (id, extra = {}) => ({ id, result: 'pass', detail: 'ok', ...extra });
// Nine website checks (44 points available), so the score is a number.
const WEBSITE_ONLY = [
  'ai-bots-allowed', 'business-labeled', 'info-sheet', 'title-city-service', 'one-headline', 'summary',
  'image-descriptions', 'share-picture', 'tap-to-call',
].map(id => pass(id));

/** A Grade with no stored answers, so the stored `ai-named` result is what the page shows. */
function grade(aiNamed) {
  const results = [...WEBSITE_ONLY, aiNamed];
  return {
    id: 'partlyAAAAAAAAAAAAAAAAAA', status: 'done', input: INPUT, createdAt: AT, finishedAt: AT, steps: [], facts: null,
    found: { phone: '(615) 555-0100', hours: [], address: '', website: INPUT.website, reviewsLink: '' },
    results, ai: [], aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: scoreGrade(results),
  };
}

const full = g => reportPage(g, { now: NOW, unlocked: true });
const AI_LABEL = 'What AI says about your business';

/** The `ai-named` row of the full report. */
const rowOf = html => new RegExp(`<li class="grade-check [a-z_]+">(?:(?!</li>)[^])*?<strong>${AI_LABEL}</strong>(?:(?!</li>)[^])*</li>`).exec(html)?.[0] ?? '';

const ALL = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 3 of 3 answers.', earned: 30 };
const SOME = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 1 of 3 answers.', earned: 10 };
const NONE = { id: 'ai-named', result: 'fail', detail: 'No. Claude named your business in none of its 3 answers.', earned: 0 };

test('D2: every counted answer named the business: "Pass" with all 30 points, and the detail as stored', () => {
  const row = rowOf(full(grade(ALL)));
  assert.ok(row.startsWith('<li class="grade-check pass">'));
  assert.ok(row.includes('<span class="grade-result">Pass</span>'));
  assert.ok(row.includes('30 of 30 points'));
  assert.ok(row.includes('<p>Yes. Claude named your business in 3 of 3 answers.</p>'));
});

test('D2: some answers named the business: "Partly", the points as the rule gives them, and no leading "Yes. "', () => {
  const row = rowOf(full(grade(SOME)));
  assert.ok(row.startsWith('<li class="grade-check partly">'));
  assert.ok(row.includes('<span class="grade-result">Partly</span>'));
  assert.ok(row.includes('10 of 30 points'));
  assert.ok(row.includes('<p>Claude named your business in 1 of 3 answers.</p>'));
  assert.equal(row.includes('Yes.'), false);
  assert.equal(row.includes('Pass'), false);
  assert.equal(row.includes('Needs work'), false);
  assert.equal(row.includes('Fix:'), false, 'a partial result is not a failed check');
});

test('D2: no answer named the business: "Needs work", with its fix, as before', () => {
  const row = rowOf(full(grade(NONE)));
  assert.ok(row.startsWith('<li class="grade-check fail">'));
  assert.ok(row.includes('<span class="grade-result">Needs work</span>'));
  assert.ok(row.includes('0 of 30 points'));
  assert.ok(row.includes('<p>No. Claude named your business in none of its 3 answers.</p>'));
  // V205: the advice for the AI row reads "What you can do:", and it makes no promise.
  assert.ok(row.includes('<strong>What you can do:</strong>'));
  assert.ok(row.includes('No one can make an AI assistant name a business.'));
  assert.equal(row.includes('<strong>Fix:</strong>'), false);
});

test('D2: a result stored without "earned" (an older Grade) stays "Pass"', () => {
  const row = rowOf(full(grade({ id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business.' })));
  assert.ok(row.startsWith('<li class="grade-check pass">'));
  assert.ok(row.includes('<span class="grade-result">Pass</span>'));
  assert.ok(row.includes('30 of 30 points'));
  assert.ok(row.includes('<p>Yes. Claude named your business.</p>'), 'the detail keeps its "Yes."');
});

test('D2: one answer that named the business is all of them: "Pass"', () => {
  const row = rowOf(full(grade({ id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business.', earned: 30 })));
  assert.ok(row.includes('<span class="grade-result">Pass</span>'));
});

test('D2: only the AI check can be "Partly": another check with fewer points than its worth stays "Pass"', () => {
  const g = grade(ALL);
  g.results = g.results.map(r => (r.id === 'tap-to-call' ? { ...r, earned: 1 } : r));
  const html = full(g);
  assert.equal(html.includes('grade-check partly'), false);
});

test('D2: the label changes nothing else: the stored Grade, the score, the points and the failed-checks line', () => {
  const g = grade(SOME);
  const before = JSON.stringify(g);
  const html = full(g);
  assert.equal(JSON.stringify(g), before, 'nothing is written or changed in the stored Grade');
  assert.equal(g.results.find(r => r.id === 'ai-named').result, 'pass', 'the stored result is still pass');
  assert.equal(g.results.find(r => r.id === 'ai-named').detail, 'Yes. Claude named your business in 1 of 3 answers.', 'the stored text keeps its "Yes."');
  const s = scoreGrade(g.results);
  assert.equal(s.failed, 0, 'Partly is not counted as a check that needs work');
  assert.ok(html.includes(`<span class="num">${s.score}</span>`));
  assert.ok(html.includes(`${s.failed} of ${s.counted} checks need work`));
  assert.ok(html.includes(`${s.earned} of ${s.available}.`), 'the points line under "Score by area"');
  // The same Grade with all three answers named has the same count of checks that need work.
  const all = scoreGrade(grade(ALL).results);
  assert.equal(all.failed, s.failed);
  assert.equal(all.counted, s.counted);
});

test('D2: the locked report has no check rows, so no "Partly"', () => {
  const html = reportPage(grade(SOME), { now: NOW });
  assert.equal(html.includes('grade-check partly'), false);
});

test('D2: "Partly" has its own style in every layer that styles the other rows, and works at 390px', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  // Its own left border and tint, and its own icon.
  assert.ok(/\.grade-check\.partly\s*\{[^}]*border-left-color/.test(css), 'border');
  assert.ok(/\.grade-check\.partly\s*\{[^}]*background-image: url\(/.test(css), 'icon');
  // The word's color (it also reads without color: the row says "Partly").
  assert.ok(/\.grade-check\.partly \.grade-result\s*\{[^}]*color:/.test(css), 'pill color');
  // Everywhere the pass and fail rows are laid out, "partly" is laid out the same way: the shared row rule,
  // the pill's float, its pinned position and the narrowest-phone rule.
  assert.ok(/\.grade-check\.pass,\s*\.grade-check\.partly,\s*\.grade-check\.fail,/.test(css), 'row layout');
  const pillSelectors = css.match(/\.grade-check\.partly \.grade-result/g) ?? [];
  assert.ok(pillSelectors.length >= 4, `the pill is styled in each layer (found ${pillSelectors.length})`);
  assert.ok(/@media \(max-width: 359px\)[^@]*\.grade-check\.partly \.grade-result/.test(css), 'narrowest phones');
});
