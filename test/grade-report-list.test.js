// V38 and V39: the report shows the whole list in the AI's order, and shows answers as clean reading text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPage, readableAnswer } from '../server/lib/grade-html.js';

const INPUT = {
  name: 'Capital City Window Cleaning', city: 'Tallahassee', state: 'FL', service: 'window cleaners', website: null,
};

const ANSWER = [
  "1. **Joe Pogo's Window Cleaning**: Joe has cleaned windows for years.",
  '2. **Cleanscapes Exterior Cleaning**: Big jobs.',
  '3. **Capital City Window Cleaning**: Local crew.',
  '4. **College Cleaning Crew**: Student crew.',
  '5. **Premier Pressure Washing**: Pressure washing.',
].join('\n');

const entry = extra => ({
  provider: 'anthropic', prompt: 'best window cleaners in Tallahassee, FL', answer: ANSWER,
  named: true, position: 3, total: 5,
  competitors: ["Joe Pogo's Window Cleaning", 'Cleanscapes Exterior Cleaning', 'College Cleaning Crew', 'Premier Pressure Washing'],
  at: '2026-11-18T12:00:00.000Z',
  ...extra,
});

const gradeWith = (...ai) => ({
  id: 'g1',
  input: INPUT,
  key: 'k',
  status: 'done',
  createdAt: '2026-11-18T12:00:00.000Z',
  finishedAt: '2026-11-18T12:01:00.000Z',
  steps: [],
  facts: null,
  results: [],
  ai,
  score: { score: 50, counted: 4, failed: 2 },
  previousScore: null,
  draftId: null,
  recheckedAt: null,
});

const render = (...ai) => reportPage(gradeWith(...ai), { leadGate: false });

const listOf = html => /<ol class="grade-competitors">([\s\S]*?)<\/ol>/.exec(html);

test('V38: with a position, the list shows every name in the AI order with the business in its place', () => {
  const m = listOf(render(entry()));
  assert.ok(m, 'numbered list present');
  const items = [...m[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(x => x[1]);
  assert.equal(items.length, 5);
  assert.equal(items[2], '<strong>Capital City Window Cleaning</strong> (you)');
  assert.equal(items[0], 'Joe Pogo&#39;s Window Cleaning');
  assert.equal(items[3], 'College Cleaning Crew');
  assert.ok(m[1].includes('<li class="grade-you">'));
});

test('V38: the business is shown as the AI wrote it, or as typed when the answer is not available', () => {
  const written = render(entry({ answer: ANSWER.replace('Capital City Window Cleaning', 'Capital City Window &amp; Pressure Cleaning') }));
  assert.ok(listOf(written));
  const typed = render(entry({ answer: '' }));
  assert.ok(listOf(typed)[1].includes('<strong>Capital City Window Cleaning</strong> (you)'));
});

test('V38: a named business with no position gets a plain list under a short heading, with no numbers', () => {
  const html = render(entry({ position: null, total: null }));
  assert.ok(!listOf(html), 'no numbered list');
  assert.ok(html.includes('Other businesses it named'));
  assert.match(html, /<ul class="grade-competitors grade-competitors-plain">/);
  assert.ok(!html.includes('(you)'));
});

test('V38: a business that was not named gets the plain list, not a numbered one', () => {
  const html = render(entry({ named: false, position: null, total: 4, answer: 'x' }));
  assert.ok(!listOf(html));
  assert.ok(html.includes('Other businesses it named'));
  assert.ok(html.includes('College Cleaning Crew'));
});

test('V38: names in the list are escaped', () => {
  const html = render(entry({
    competitors: ['<script>alert(1)</script> Roofing', 'B', 'C', 'D'],
    answer: '',
  }));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt; Roofing'));
});

test('V39: readableAnswer removes bold, links, headings, bullets and citation marks', () => {
  assert.equal(readableAnswer("1. **Joe Pogo's Window Cleaning**: Joe Pogorzelski has..."), "1. Joe Pogo's Window Cleaning: Joe Pogorzelski has...");
  assert.equal(readableAnswer('__Bold__ and *soft* and _soft_ words'), 'Bold and soft and soft words');
  assert.equal(readableAnswer('See [Acme Plumbing](https://acme.example) today'), 'See Acme Plumbing today');
  assert.equal(readableAnswer('## Top picks\n### Why'), 'Top picks\nWhy');
  assert.equal(readableAnswer('- one\n* two\n  - three'), '\u2022 one\n\u2022 two\n  \u2022 three');
  assert.equal(readableAnswer('Great crew [1] and fast [web:3] and good [[2]](https://x.example).'), 'Great crew and fast and good.');
  assert.equal(readableAnswer('1. First\n2. Second\n\nEnd'), '1. First\n2. Second\n\nEnd');
  assert.equal(readableAnswer(undefined), '');
});

test('V39: the answer on the page has no formatting symbols, and is still escaped', () => {
  const html = render(entry({ answer: '**Bold** name <b>raw</b>\n- item [1]' }));
  const m = /<blockquote class="grade-answer seance-answer">([\s\S]*?)<\/blockquote>/.exec(html);
  assert.ok(m);
  assert.equal(m[1], 'Bold name &lt;b&gt;raw&lt;/b&gt;\n\u2022 item');
});

test('V39: second opinions are cleaned the same way', () => {
  const html = render(
    entry(),
    entry({ provider: 'openai', answer: '**Bright Windows** is a pick.', named: false, position: null, total: 1, competitors: ['Bright Windows'] }),
  );
  assert.ok(html.includes('Bright Windows is a pick.'));
  assert.ok(!html.includes('**Bright Windows**'));
});

test('V39: the stored answer is not changed', () => {
  const e = entry();
  const before = e.answer;
  render(e);
  assert.equal(e.answer, before);
});

test('V42: a very long line of broken link marks is read quickly, and normal links still become the name', () => {
  const started = Date.now();
  const out = readableAnswer('[a'.repeat(60000));
  assert.ok(Date.now() - started < 1000, 'finishes in under 1 second');
  assert.equal(typeof out, 'string');
  assert.equal(readableAnswer('[Parlour](https://parlournashville.com)'), 'Parlour');
});

// ---- V52: the count and the numbered rows come from the main list only ------------------------------------

const CAPITAL = {
  name: 'Capital city window and pressure cleaning', city: 'Tallahassee', state: 'FL',
  service: 'Window cleaning and pressure cleaning', website: null,
};

// Claude's real answer from the owner's live check, with the two names that follow "Other names to check:".
const CAPITAL_ANSWER = [
  "This is my top 5 for businesses that do both window cleaning and pressure washing in Tallahassee. I built it from what's offered and from Yelp and directory listings, not from my own testing.",
  '',
  "1. **Joe Pogo's Window Cleaning.** Joe Pogorzelski has provided residential and commercial pressure washing and window cleaning in Tallahassee for more than 16 years. It has a 5.0 rating on Yelp from 3 reviews.",
  '',
  '2. **Cleanscapes Exterior Cleaning.** It specializes in pressure washing, soft washing, window cleaning and gutter cleaning. It has a 4.4 rating from 5 reviews on Yelp.',
  '',
  "3. **Capital City Window & Pressure Cleaning.** It's locally owned and operated and says it will beat or match prices. I couldn't see its star rating in the results.",
  '',
  "4. **College Cleaning Crew.** It leads Yelp's window-washing and pressure-washing lists. Its Yelp rating is 4.3 from 6 reviews.",
  '',
  '5. **Premier Pressure Washing & Window Cleaning Services.** It offers house washing, roof cleaning, window cleaning and driveway cleaning. I found little independent review data for it.',
  '',
  '**Other names to check:**',
  '- Get It Done Window Washing has a 5.0 rating from 1 review.',
  '- Cloud Nine Window Cleaning has a 5.0 rating from 2 reviews.',
  '- Fish Window Cleaning is a national franchise with a Tallahassee location.',
].join('\n');

const capitalEntry = extra => ({
  provider: 'anthropic', prompt: 'Who are the best window cleaning and pressure cleaning in Tallahassee, FL? Name your top 5.',
  answer: CAPITAL_ANSWER, named: true, position: 3, total: 8,
  competitors: [
    "Joe Pogo's Window Cleaning", 'Cleanscapes Exterior Cleaning', 'College Cleaning Crew',
    'Premier Pressure Washing & Window Cleaning Services', 'Get It Done Window Washing',
  ],
  at: '2026-11-18T12:00:00.000Z',
  ...extra,
});

const capitalGrade = (...ai) => ({ ...gradeWith(...ai), input: CAPITAL });
const itemsOf = html => [...(/<ol class="grade-competitors">([\s\S]*?)<\/ol>/.exec(html)?.[1] ?? '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(x => x[1]);

test('V52: the count and the rows are the main list; names from the later list go under "Also mentioned:"', () => {
  const html = reportPage(capitalGrade(capitalEntry()), { leadGate: false });
  assert.ok(html.includes('It listed 5 businesses, and yours was 3rd.'));
  const rows = itemsOf(html);
  assert.equal(rows.length, 5, 'exactly the five ranked names');
  assert.equal(rows[0], 'Joe Pogo&#39;s Window Cleaning');
  assert.equal(rows[2], '<strong>Capital City Window &amp; Pressure Cleaning</strong> (you)');
  assert.equal(rows[4], 'Premier Pressure Washing &amp; Window Cleaning Services');
  assert.ok(/<li class="grade-you">/.test(html));

  const at = html.indexOf('Also mentioned:');
  assert.ok(at > html.indexOf('</ol>'), 'listed under the numbered rows');
  const also = [...html.slice(at, html.indexOf('</ul>', at)).matchAll(/<li>([\s\S]*?)<\/li>/g)].map(x => x[1]);
  assert.deepEqual(also, ['Get It Done Window Washing', 'Cloud Nine Window Cleaning', 'Fish Window Cleaning']);
});

test('V52: an answer with one list renders as before, with no "Also mentioned:"', () => {
  const html = render(entry());
  assert.ok(html.includes('It listed 5 businesses, and yours was 3rd.'));
  assert.equal(listOf(html)[1].match(/<li/g).length, 5);
  assert.equal(html.includes('Also mentioned:'), false);
});

test('V52: a not-named answer with an extra list numbers nothing and shows the plain list as before', () => {
  const answer = [
    '1. **Hiller Plumbing** - big jobs',
    '2. **Radiant Plumbing & Air** - upfront pricing',
    '',
    '**Other names to check:**',
    '- Mr. Rooter Plumbing is a national brand.',
  ].join('\n');
  const html = render(entry({
    answer, named: false, position: null, total: 3,
    competitors: ['Hiller Plumbing', 'Radiant Plumbing & Air', 'Mr. Rooter Plumbing'],
  }));
  assert.equal(listOf(html), null, 'nothing is numbered');
  assert.ok(html.includes('Other businesses it named:'));
  assert.equal(html.includes('Also mentioned:'), false);
  assert.ok(html.includes('Mr. Rooter Plumbing'));
});
