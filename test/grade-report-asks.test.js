/**
 * The report when Claude answered the free question more than once (Feature E, task E3; Requirement 23).
 * Pure rendering of hand-built Grades: no network, no AI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reportPage, aboutPage } from '../server/lib/grade-html.js';
import { freeQuestion, extraQuestions } from '../server/lib/grader.js';

const NOW = Date.UTC(2026, 10, 22, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: null };
const FREE = freeQuestion(INPUT);

const NAMED_TEXT = '1. Zephyr Plumbing\n2. Other Co\n3. Another Co';
// The later list is a bullet list, as AI answers write it (a bare line is not a list item; see V52's test).
const NAMED_SECOND_TEXT = '1. Other Co\n2. Zephyr Plumbing\n\nOther names to check:\n- Third Co Plumbing has a 5.0 rating from 2 reviews.';
const NOT_NAMED_TEXT = '1. Other Co\n2. Another Co\n3. Third Co';

function answer(text, { named, position = null, total = 3, competitors = ['Other Co', 'Another Co'], ask, prompt = FREE, provider = 'anthropic', extra = {} } = {}) {
  return {
    prompt, provider, model: 'stub', webSearch: true, answer: text, named: Boolean(named), position, total, competitors, ms: 5, at: AT,
    ...(ask ? { ask } : {}), ...extra,
  };
}

const ANSWER_1 = answer(NAMED_TEXT, { named: true, position: 1, ask: 1 });
const ANSWER_2 = answer(NAMED_TEXT, { named: true, position: 1, ask: 2 });
const ANSWER_3 = answer(NOT_NAMED_TEXT, { named: false, competitors: ['Other Co', 'Another Co', 'Third Co'], ask: 3 });

function grade(ai, extra = {}) {
  return {
    id: 'asksAAAAAAAAAAAAAAAAAA', status: 'done', input: INPUT, createdAt: AT, finishedAt: AT, steps: [], facts: null,
    found: { phone: '', hours: [], address: '', website: '', reviewsLink: '' },
    results: [], ai, aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: null, ...extra,
  };
}

const render = (ai, opts = {}) => reportPage(grade(ai), { now: NOW, ...opts });

// ---- the free part ------------------------------------------------------------------------------------

test('E3: the lead line says how many times Claude was asked and in how many answers it named the business', () => {
  const html = render([ANSWER_1, ANSWER_2, ANSWER_3]);
  assert.ok(html.includes('<p>We just asked Claude 3 times. Claude named your business in 2 of 3 answers.</p>'));
  const none = render([
    answer(NOT_NAMED_TEXT, { ask: 1 }), answer(NOT_NAMED_TEXT, { ask: 2 }), answer(NOT_NAMED_TEXT, { ask: 3 }),
  ]);
  assert.ok(none.includes('<p>We just asked Claude 3 times. Claude didn\'t name your business in any of its 3 answers.</p>'));
});

test('E3: the list and outcome come from the first answer that named the business, with "This list is from answer 1, the first one that named you."', () => {
  const html = render([ANSWER_1, ANSWER_2, ANSWER_3]);
  assert.ok(html.includes('<p class="hint">AI answers change from one time to the next, so we ask the same question 3 times. This list is from answer 1, the first one that named you.</p>'));
  assert.ok(html.includes('It listed 3 businesses, and yours was 1st.'));
  assert.ok(html.includes('<li class="grade-you"><strong>Zephyr Plumbing</strong> (you)</li>'));

  // Only the second answer named it: that one is shown, with the later list read as in V52.
  const second = answer(NAMED_SECOND_TEXT, { named: true, position: 2, total: 2, competitors: ['Other Co'], ask: 2 });
  const shown = render([answer(NOT_NAMED_TEXT, { ask: 1 }), second, answer(NOT_NAMED_TEXT, { ask: 3 })]);
  assert.ok(shown.includes('<p class="hint">AI answers change from one time to the next, so we ask the same question 3 times. This list is from answer 2, the first one that named you.</p>'));
  assert.ok(shown.includes('It listed 2 businesses, and yours was 2nd.'));
  assert.ok(shown.includes('Also mentioned:'));
  assert.ok(shown.includes('<li>Third Co Plumbing</li>'));

  // None named it: the first answer is shown.
  const none = render([answer(NOT_NAMED_TEXT, { ask: 1, competitors: ['Other Co'] }), answer(NOT_NAMED_TEXT, { ask: 2 })]);
  assert.ok(none.includes('<p class="hint">AI answers change from one time to the next, so we ask the same question 2 times. This list is from answer 1.</p>'));
  assert.equal(none.includes('the first one that named you'), false);
});

test('E3: every answer opens in one closed "See Claude\'s answers" block, each labeled', () => {
  const html = render([ANSWER_1, ANSWER_2, ANSWER_3]);
  const block = /<details><summary>See Claude&#39;s answers<\/summary>([\s\S]*?)<\/details>/.exec(html);
  assert.ok(block, 'one closed block');
  assert.equal((html.match(/<details><summary>See Claude&#39;s answers<\/summary>/g) ?? []).length, 1);
  for (const n of [1, 2, 3]) assert.ok(block[1].includes(`<p>Answer ${n}</p>`), `Answer ${n}`);
  assert.equal((block[1].match(/<blockquote class="grade-answer seance-answer">/g) ?? []).length, 3);
  assert.ok(block[1].includes('Third Co'), 'the third answer is in it');
  assert.equal(/<details open/.test(html), false, 'closed');
});

test('E3: with ask 1 failed, the answers that came back are numbered among themselves', () => {
  const two = answer(NAMED_TEXT, { named: true, position: 1, ask: 2 });
  const three = answer(NOT_NAMED_TEXT, { ask: 3 });
  const html = render([two, three], { leadGate: false });
  assert.ok(html.includes('<p>We just asked Claude 3 times and got 2 answers. Claude named your business in 1 of the 2.</p>'));
  assert.ok(html.includes('<p class="hint">AI answers change from one time to the next, so we ask the same question 3 times. This list is from answer 1, the first one that named you.</p>'));
  assert.ok(html.includes('<p>Answer 1</p>') && html.includes('<p>Answer 2</p>'));
  assert.equal(html.includes('<p>Answer 3</p>'), false);
  assert.ok(html.includes('Claude, answer 1 of 2:'));
  assert.ok(html.includes('Claude, answer 2 of 2:'));
});

test('E3: a carried group says when Claude was asked: "We asked Claude 3 times on …"', () => {
  const carried = [ANSWER_1, ANSWER_2, ANSWER_3].map(a => ({ ...a, reusedFrom: '2026-11-19T15:00:00.000Z' }));
  const html = render(carried);
  assert.match(html, /<p>We asked Claude 3 times on [^<]*Nov[^<]*19[^<]*\. Claude named your business in 2 of 3 answers\.<\/p>/);
  assert.equal(html.includes('We just asked'), false);
});

test('E3: a Grade with one answer per question looks as before', () => {
  const one = answer(NAMED_TEXT, { named: true, position: 1 });
  const html = render([one]);
  assert.ok(html.includes('<p>We just asked Claude. It listed 3 businesses, and yours was 1st.</p>'));
  assert.ok(html.includes('<details><summary>See the full answer</summary>'));
  for (const newText of ['From answer', 'This list is from', 'AI answers change from one time', 'See Claude&#39;s answers', 'times.', '<p>Answer 1</p>']) {
    assert.equal(html.includes(newText), false, newText);
  }
});

test('E3: an older Grade asked with older wording still shows its answers', () => {
  const oldPrompt = 'Who are the best Plumbers in Nashville, TN? Name your top 5.';
  const html = render([
    answer(NAMED_TEXT, { named: true, position: 1, prompt: oldPrompt }),
    answer(NOT_NAMED_TEXT, { prompt: oldPrompt }),
  ]);
  assert.equal(html.includes("We couldn't ask AI"), false);
  assert.ok(html.includes('Claude named your business in 1 of 2 answers.'));
  const single = render([answer(NAMED_TEXT, { named: true, position: 1, prompt: oldPrompt })]);
  assert.equal(single.includes("We couldn't ask AI"), false);
  assert.ok(single.includes('It listed 3 businesses, and yours was 1st.'));
});

test('E3: the demo assistant\'s answers keep their label', () => {
  const demo = [1, 2].map(ask => answer(NOT_NAMED_TEXT, { provider: 'mock', ask }));
  const html = render(demo);
  assert.ok(html.includes('Demo answer (no AI connected)'));
});

// ---- the full report's "Every answer" -------------------------------------------------------------------

const [EXTRA_1, EXTRA_2] = extraQuestions(INPUT);
const chatgpt = (prompt, text = NOT_NAMED_TEXT) => answer(text, { prompt, provider: 'chatgpt', extra: { second: true } });

test('E3: the answers section counts questions, not answers, and says the first one was asked 3 times', () => {
  const ai = [
    ANSWER_1, ANSWER_2, ANSWER_3, chatgpt(FREE),
    answer(NOT_NAMED_TEXT, { prompt: EXTRA_1 }), chatgpt(EXTRA_1),
    answer(NOT_NAMED_TEXT, { prompt: EXTRA_2 }), chatgpt(EXTRA_2),
  ];
  const html = render(ai, { leadGate: false });
  assert.ok(html.includes('We asked Claude and ChatGPT the same 3 questions. Claude was asked the first one 3 times. ChatGPT\'s answers are below so you can compare.'));
  assert.equal(html.includes('the same 5 questions'), false);
  assert.ok(html.includes('Claude named your business in 2 of its 3 answers.'));
  assert.ok(html.includes("On the 2 other questions, Claude didn't name you. They are not counted toward your score."));
  assert.equal(html.includes('Named in 2 of 5 answers.'), false, 'the count is said once (V104)');
  assert.ok(html.includes('Claude, answer 1 of 3:') && html.includes('Claude, answer 3 of 3:'));
  assert.ok(html.includes('ChatGPT (for comparison only):'));
});

test('E3: with only the free question, "Claude was asked it 3 times."', () => {
  const html = render([ANSWER_1, ANSWER_2, ANSWER_3, chatgpt(FREE)], { leadGate: false });
  assert.ok(html.includes('We asked Claude and ChatGPT the same question. Claude was asked it 3 times.'));
});

test('E3: with one answer per question the answers section reads as before', () => {
  const ai = [
    answer(NOT_NAMED_TEXT, { prompt: FREE }), chatgpt(FREE),
    answer(NOT_NAMED_TEXT, { prompt: EXTRA_1 }), chatgpt(EXTRA_1),
    answer(NOT_NAMED_TEXT, { prompt: EXTRA_2 }), chatgpt(EXTRA_2),
  ];
  const html = render(ai, { leadGate: false });
  assert.ok(html.includes("We asked Claude and ChatGPT the same 3 questions. ChatGPT's answers are below so you can compare."));
  assert.equal(html.includes('was asked the first one'), false);
  assert.equal(/Claude, answer \d of \d/.test(html), false);
});

// ---- page-read fixes (review 2026-11-23, V100 to V106) -------------------------------------------------------

test('V100: fewer answers than asks: "and got 2 answers", counted "of the 2"', () => {
  const none = render([answer(NOT_NAMED_TEXT, { ask: 1 }), answer(NOT_NAMED_TEXT, { ask: 3 })]);
  assert.ok(none.includes('<p>We just asked Claude 3 times and got 2 answers. Claude didn\'t name your business in either.</p>'));
  const both = render([ANSWER_1, ANSWER_2].map(a => ({ ...a, ask: a.ask + 1 })));
  assert.ok(both.includes('<p>We just asked Claude 3 times and got 2 answers. Claude named your business in both.</p>'));
  const carried = render([answer(NAMED_TEXT, { named: true, position: 1, ask: 1 }), answer(NOT_NAMED_TEXT, { ask: 3 })]
    .map(a => ({ ...a, reusedFrom: '2026-11-19T15:00:00.000Z' })));
  assert.match(carried, /<p>We asked Claude 3 times on [^<]*Nov[^<]*19[^<]* and got 2 answers\. Claude named your business in 1 of the 2\.<\/p>/);
  // Every ask answered: the sentence is as before.
  const all = render([ANSWER_1, ANSWER_2, ANSWER_3]);
  assert.equal(all.includes('and got'), false);
  assert.equal(all.includes('of the 3'), false);
});

test('V101/V109: one hint paragraph under the lead line says why we ask more than once and which answer the list is from', () => {
  const html = render([ANSWER_1, ANSWER_2, ANSWER_3]);
  const hint = '<p class="hint">AI answers change from one time to the next, so we ask the same question 3 times. This list is from answer 1, the first one that named you.</p>';
  assert.equal(html.split(hint).length - 1, 1, 'shown once');
  assert.equal(html.split('AI answers change from one time to the next').length - 1, 1, 'no second hint line');
  const lead = html.indexOf('We just asked Claude 3 times.');
  assert.ok(lead !== -1 && lead < html.indexOf(hint));
  const two = render([answer(NAMED_TEXT, { named: true, position: 1, ask: 1 }), answer(NOT_NAMED_TEXT, { ask: 2 })]);
  assert.ok(two.includes('so we ask the same question 2 times. This list is from answer 1, the first one that named you.</p>'));
});

test('V107: when today\'s limit cut the asks short, the hint says how many we ask and how many we could', () => {
  const ai = [answer(NAMED_TEXT, { named: true, position: 1, ask: 1 }), answer(NOT_NAMED_TEXT, { ask: 2 })];
  const aiMain = { provider: 'anthropic', label: 'Claude', state: 'ok', asks: { planned: 3, asked: 2 } };
  const html = reportPage(grade(ai, { aiMain }), { now: NOW });
  assert.ok(html.includes('<p>We just asked Claude 2 times. Claude named your business in 1 of 2 answers.</p>'));
  assert.ok(html.includes('<p class="hint">AI answers change from one time to the next, so we ask the same question 3 times. Today we could ask only 2 times because we reached today&#39;s limit. This list is from answer 1, the first one that named you.</p>')
    || html.includes("<p class=\"hint\">AI answers change from one time to the next, so we ask the same question 3 times. Today we could ask only 2 times because we reached today's limit. This list is from answer 1, the first one that named you.</p>"));
  // All planned asks made (no stored cut, or a cut that does not match the answers): the sentence is as it was.
  const full = reportPage(grade(ai, { aiMain: { ...aiMain, asks: { planned: 3, asked: 3 } } }), { now: NOW });
  assert.ok(full.includes('so we ask the same question 2 times. This list is from'));
  assert.equal(full.includes('Today we could ask only'), false);
  const plain = render(ai);
  assert.equal(plain.includes('Today we could ask only'), false);
  // Hand-edited numbers are ignored.
  for (const asks of [{ planned: 99, asked: 2 }, { planned: 3, asked: 0 }, { planned: '3', asked: 2 }, null, 'x']) {
    const odd = reportPage(grade(ai, { aiMain: { ...aiMain, asks } }), { now: NOW });
    assert.equal(odd.includes('Today we could ask only'), false, JSON.stringify(asks));
  }
});

test('V104/V108: "Every answer" says the count once, in the full sentence form', () => {
  const withSeconds = render([ANSWER_1, ANSWER_2, ANSWER_3, chatgpt(FREE)], { leadGate: false });
  assert.ok(withSeconds.includes('Claude named your business in 2 of its 3 answers.'));
  assert.equal(withSeconds.includes('Named in 2 of 3 answers.'), false);
  const alone = render([ANSWER_1, ANSWER_2, ANSWER_3], { leadGate: false });
  assert.ok(alone.includes('<p>Claude named your business in 2 of its 3 answers.</p>'));
  assert.equal(alone.includes('Named in 2 of 3 answers.'), false);
  assert.equal(alone.split('named your business in 2 of its 3 answers').length - 1, 1, 'said once');
});

test('V100/V104: with ask 1 failed, "Every answer" also says Claude was asked 3 times', () => {
  const html = render([answer(NAMED_TEXT, { named: true, position: 1, ask: 2 }), answer(NOT_NAMED_TEXT, { ask: 3 }), chatgpt(FREE)], { leadGate: false });
  assert.ok(html.includes('We asked Claude and ChatGPT the same question. Claude was asked it 3 times.'));
});

test('V106: ask numbers that are not whole numbers from 1 to 3 are ignored', () => {
  for (const bad of [99, 0, -1, 2.5, '3']) {
    const html = render([answer(NOT_NAMED_TEXT, { extra: { ask: bad } }), answer(NOT_NAMED_TEXT, { ask: 1 })], { leadGate: false });
    assert.ok(html.includes("<p>We just asked Claude 2 times. Claude didn't name your business in any of its 2 answers.</p>"), String(bad));
    assert.equal(/asked Claude (99|3) times/.test(html), false, String(bad));
  }
});

// ---- the about page, escaping and wording ------------------------------------------------------------------

test('E3: the about page says the first question is asked up to 3 times', () => {
  assert.ok(aboutPage().includes('We ask Claude up to 3 questions. We ask the first question up to 3 times, because AI answers change.'));
});

test('E3: everything is escaped', () => {
  const odd = { ...INPUT, name: 'Zeph <b>Plumbing</b>' };
  const text = '1. <script>alert(1)</script>\n2. Other Co';
  const ai = [1, 2, 3].map(ask => ({ ...answer(text, { ask, prompt: freeQuestion(odd) }) }));
  const html = reportPage({ ...grade(ai), input: odd }, { now: NOW, leadGate: false });
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('<b>Plumbing</b>'), false);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('E3: no new sentence promises that AI will name the business', () => {
  const html = render([ANSWER_1, ANSWER_2, ANSWER_3, chatgpt(FREE)], { leadGate: false });
  assert.doesNotMatch(html, /will (name|recommend|mention) your business|guarantee/i);
  assert.doesNotMatch(aboutPage(), /will (name|recommend|mention)|guarantee/i);
});
