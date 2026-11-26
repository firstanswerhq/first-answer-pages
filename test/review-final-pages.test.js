/**
 * The final page read of the whole branch (V134 to V145): page text and small display fixes only. Scoring, points
 * and what is counted do not change. Pure rendering of hand-built Grades, plus one small server for the pages
 * that need the app (a second "Check again", tab titles, the privacy page).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import {
  reportPage, aboutPage, gradeFormPage, FORM_SEARCH_DESCRIPTION,
} from '../server/lib/grade-html.js';
import {
  stepNames, foundOf, HOME_UNREADABLE, WEBSITE_UNREACHED, AI_LIMIT_REACHED, freeQuestion,
} from '../server/lib/grader.js';
import { CHECKS, checkById, runWebsiteChecks } from '../server/lib/grade-checks.js';
import { readPageFacts } from '../server/lib/page-facts.js';
import { scoreGrade } from '../server/lib/grade-score.js';
import { jsonLdBlock, PHONE_PLACEHOLDER } from '../server/lib/fix-kit.js';
import { usAddressStyle } from '../server/lib/address-style.js';
import { applyTitleSuffix } from '../server/lib/html.js';

const NOW = Date.UTC(2026, 10, 23, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const NAMES = stepNames(INPUT);

const pass = (id, extra = {}) => ({ id, result: 'pass', detail: 'ok', ...extra });
const fail = id => ({ id, result: 'fail', detail: 'no' });
const notChecked = (id, detail) => ({ id, result: 'not_checked', detail });

// 30 + 8 + 8 points available: 38 earned, a score of 83.
const SCORED = [pass('ai-named', { earned: 30 }), pass('ai-bots-allowed'), fail('business-labeled')];
// Nine website checks: 44 points available, so there is a score even without the AI part.
const WEBSITE_ONLY = [
  'ai-bots-allowed', 'business-labeled', 'info-sheet', 'title-city-service', 'one-headline', 'summary',
  'image-descriptions', 'share-picture', 'tap-to-call',
].map(id => pass(id));

function grade(extra = {}) {
  const results = extra.results ?? SCORED;
  return {
    id: 'finalAAAAAAAAAAAAAAAAAA', status: 'done', input: INPUT, createdAt: AT, finishedAt: AT, steps: [], facts: null,
    found: { phone: '(615) 555-0100', hours: [], address: '', website: INPUT.website, reviewsLink: '' },
    ai: [], aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: scoreGrade(results),
    ...extra, results,
  };
}

const locked = (g, opts = {}) => reportPage(g, { now: NOW, ...opts });
const open = (g, opts = {}) => reportPage(g, { now: NOW, unlocked: true, ...opts });
const step = (index, state, finding) => ({ name: NAMES[index], state, ms: 5, finding });

// ---- V134: a website we could not read ----------------------------------------------------------------------

const BLOCKED = "Partial score: we couldn&#39;t read your home page, so most website checks aren&#39;t counted. Your website may be blocking automated visitors.";
const CUT_SHORT = "Partial score: we couldn&#39;t read your home page, so most website checks aren&#39;t counted.";

test('V134: a site that answered but could not be read: the notice sits under the score on the locked and the unlocked report', () => {
  const g = grade({ steps: [step(0, 'failed', HOME_UNREADABLE), step(1, 'skipped', 'Nothing to read')] });
  for (const html of [locked(g), open(g)]) {
    assert.ok(html.includes(BLOCKED));
    assert.ok(html.includes('class="hint grade-partial"'));
    assert.ok(html.indexOf('grade-score-number') < html.indexOf(BLOCKED), 'under the number');
    assert.ok(html.indexOf(BLOCKED) < html.indexOf('<h1>Zephyr Plumbing</h1>'));
    assert.equal(html.includes('We couldn&#39;t reach'), false, 'it was reached');
  }
});

test('V134: a home page that was reached but would not parse gives the same notice', () => {
  const g = grade({ steps: [step(0, 'done', 'Reached your website'), step(1, 'failed', HOME_UNREADABLE)] });
  assert.ok(locked(g).includes(BLOCKED));
});

test('V134: an address we could not reach adds "We couldn\'t reach <host>…"; the host is only the host', () => {
  const g = grade({ steps: [step(0, 'failed', WEBSITE_UNREACHED), step(1, 'skipped', 'Nothing to read')] });
  for (const html of [locked(g), open(g)]) {
    assert.ok(html.includes(CUT_SHORT));
    assert.equal(html.includes(BLOCKED), false, 'a site we could not reach is not "blocking" us');
    assert.ok(html.includes('We couldn&#39;t reach zephyr.example. Check the spelling and run the check again.'));
  }
  const withQuery = grade({
    input: { ...INPUT, website: 'https://zephyr.example/path?secret=1' },
    steps: [step(0, 'failed', WEBSITE_UNREACHED)],
  });
  const html = locked(withQuery);
  assert.ok(html.includes('We couldn&#39;t reach zephyr.example. Check'));
  // Only the reach sentence is checked: the listing preview's "Website:" line prints the test's made-up address as
  // typed, and a real check form keeps only the site's front address (V150).
  const reach = /<p class="hint grade-partial">We couldn&#39;t reach[^<]*<\/p>/.exec(html)?.[0] ?? '';
  assert.ok(reach.includes('zephyr.example'), 'the reach sentence is there');
  assert.equal(reach.includes('secret=1'), false, 'never the typed address with a query');
  assert.equal(reach.includes('/path'), false);
});

test('V134: with no number for the score, only the reach line is shown', () => {
  const g = grade({
    results: [pass('ai-named', { earned: 30 })],
    steps: [step(0, 'failed', WEBSITE_UNREACHED), step(1, 'skipped', 'Nothing to read')],
  });
  const html = locked(g);
  assert.ok(html.includes('Not enough to score yet'));
  assert.ok(html.includes('We couldn&#39;t reach zephyr.example. Check the spelling and run the check again.'));
  assert.equal(html.includes('Partial score: we couldn&#39;t read'), false);
});

test('V134: a slow or too large site gets only the first sentence, and no reach line', () => {
  for (const finding of ['Your website took too long to answer.', 'Your home page is too large to check.']) {
    const html = locked(grade({ steps: [step(0, 'failed', finding)] }));
    assert.ok(html.includes(CUT_SHORT), finding);
    assert.equal(html.includes('may be blocking'), false, finding);
    assert.equal(html.includes('We couldn&#39;t reach'), false, finding);
  }
});

test('V134: no notice for a readable site, a Grade with no website, or a hand-built Grade with no steps', () => {
  const read = grade({ steps: [step(0, 'done', 'Reached your website'), step(1, 'done', 'Found 1 main headline')] });
  const noSite = grade({ input: { ...INPUT, website: '' }, steps: [step(0, 'skipped', 'No website given')] });
  for (const g of [read, noSite, grade()]) {
    for (const html of [locked(g), open(g)]) {
      assert.equal(html.includes('Partial score: we couldn&#39;t read'), false);
      assert.equal(html.includes('We couldn&#39;t reach'), false);
    }
  }
  // An odd address never throws and shows no host.
  assert.doesNotThrow(() => locked(grade({ input: { ...INPUT, website: 'javascript:alert(1)' }, steps: [step(0, 'failed', WEBSITE_UNREACHED)] })));
});

test('V134: the score itself is unchanged by the notice', () => {
  const g = grade({ steps: [step(0, 'failed', HOME_UNREADABLE)] });
  const plain = grade();
  assert.deepEqual(scoreGrade(g.results), scoreGrade(plain.results));
  assert.ok(locked(g).includes('<span class="num">83</span>'));
});

// ---- V135 ----------------------------------------------------------------------------------------------------

test('V135: one hint under "Score by area" says how the score relates to the points', () => {
  const g = grade();
  const s = scoreGrade(g.results);
  const hint = `You earned ${s.earned} of the ${s.available} points we checked. That is ${s.score} out of 100.`;
  assert.equal(s.score, 83);
  for (const html of [locked(g), open(g)]) {
    assert.ok(html.includes(`<p class="hint">${hint}</p>`));
    assert.ok(html.indexOf('Score by area') < html.indexOf(hint));
    assert.equal(html.split(hint).length - 1, 1, 'said once');
  }
  const none = locked(grade({ results: [pass('ai-named', { earned: 30 })] }));
  assert.equal(none.includes('You earned'), false, 'no number, no hint');
});

// ---- V136 ----------------------------------------------------------------------------------------------------

test('V136: the labels read right for a pass and for a fail', () => {
  const labels = Object.fromEntries(CHECKS.map(c => [c.id, c.label]));
  assert.equal(labels['ai-bots-allowed'], 'Can AI assistants get in?');
  assert.equal(labels['business-labeled'], 'Business label for AI');
  assert.equal(labels['title-city-service'], 'Page title');
  assert.equal(labels['one-headline'], 'Main headline on the home page');
  assert.equal(labels.summary, 'Page summary');
  // high-tech-look J7: a plain label like the others, not a question.
  assert.equal(labels['reviews-visible'], 'Reviews on your website');
  assert.equal(checkById('reviews-visible').label, 'Reviews on your website');
  assert.equal(new Set(CHECKS.map(c => c.label)).size, CHECKS.length, 'every label is different');
});

test('V136: a stored Grade shows the new labels (labels are read when the page is drawn, never stored)', () => {
  const g = grade({ results: [pass('ai-bots-allowed'), fail('business-labeled'), fail('title-city-service'), fail('reviews-visible')] });
  for (const result of g.results) assert.equal(Object.hasOwn(result, 'label'), false);
  const html = open(g);
  // Batch 5 K10: the report's one name per check (the health map's name), read when the page is drawn.
  for (const label of [
    'Your website lets AI assistants read it (robots.txt)', 'Name, phone and address tagged for AI (business label)',
    'Page title names your city and service', 'Reviews shown on your website',
  ]) {
    assert.ok(html.includes(`<strong>${label}</strong>`), label);
  }
});

// ---- V137 ----------------------------------------------------------------------------------------------------

test('V137: with no phone found the business label holds a placeholder and the help says to replace it', () => {
  const block = jsonLdBlock({ name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', phone: '' });
  assert.ok(block.includes(`"telephone": "${PHONE_PLACEHOLDER}"`));
  assert.equal(PHONE_PLACEHOLDER, 'ADD YOUR PHONE NUMBER');
  const withPhone = jsonLdBlock({ name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', phone: '(615) 555-0100' });
  assert.ok(withPhone.includes('"telephone": "(615) 555-0100"'));
  assert.equal(withPhone.includes('ADD YOUR PHONE NUMBER'), false);

  const none = open(grade({ found: { phone: '', hours: [], address: '', website: INPUT.website, reviewsLink: '' } }));
  assert.ok(none.includes('Put your phone number in before you paste.'));
  assert.ok(none.includes('ADD YOUR PHONE NUMBER'));
  const some = open(grade());
  assert.equal(some.includes('Put your phone number in before you paste.'), false);
  assert.equal(some.includes('ADD YOUR PHONE NUMBER'), false);
});

// ---- V139, V140 ----------------------------------------------------------------------------------------------

test('V139: no website and the daily limit: one clear line, and "tomorrow" in place of "later"', () => {
  const g = grade({
    input: { ...INPUT, website: '' },
    results: [notChecked('ai-named', AI_LIMIT_REACHED)],
    aiMain: { provider: 'anthropic', label: 'Claude', state: 'limit' },
    steps: [step(0, 'skipped', 'No website given')],
  });
  const html = locked(g);
  assert.ok(html.includes("We couldn't run any checks this time. Please try again tomorrow."));
  assert.equal(html.includes('We could only run the AI check'), false);
  assert.ok(html.includes("We couldn't ask AI this time. Today's limit for AI questions was reached. You can run the check again tomorrow."));
  assert.equal(html.includes('check again later'), false);
});

test('V139: with a website, the partial line says "tomorrow" for the daily limit and "later" otherwise', () => {
  const results = [...WEBSITE_ONLY, notChecked('ai-named', AI_LIMIT_REACHED)];
  const limit = locked(grade({ results, aiMain: { provider: 'anthropic', label: 'Claude', state: 'limit' } }));
  assert.ok(limit.includes('Partial score: today&#39;s limit for AI questions was reached, so the AI part isn&#39;t counted. Come back tomorrow and tap <a href="/grade?from=finalAAAAAAAAAAAAAAAAAA">Run a new check</a> to get your full score.'));
  const failed = locked(grade({ results, aiMain: { provider: 'anthropic', label: 'Claude', state: 'failed' } }));
  assert.ok(failed.includes('Partial score: Claude didn&#39;t answer this time, so the AI part isn&#39;t counted. Come back later and tap <a href="/grade?from=finalAAAAAAAAAAAAAAAAAA">Run a new check</a> to get your full score.'));
});

test('V139: with no website and no limit, the sentence is as before', () => {
  const g = grade({ input: { ...INPUT, website: '' }, results: [pass('ai-named', { earned: 0 })], steps: [] });
  const html = locked(g);
  assert.ok(html.includes('We could only run the AI check. Add a website to get a score.'));
  assert.equal(html.includes('try again tomorrow'), false);
});

test('V140: Claude did not answer: one sentence, not three that repeat each other', () => {
  const g = grade({
    input: { ...INPUT, website: '' },
    results: [notChecked('ai-named', "AI didn't answer this time")],
    aiMain: { provider: 'anthropic', label: 'Claude', state: 'failed' },
  });
  const html = locked(g);
  assert.ok(html.includes("<p>Claude didn't answer this time. Please run the check again later.</p>"));
  assert.equal(html.includes("We couldn't ask AI this time"), false);
  assert.equal(html.includes('You can run the check again later'), false);
  // Not connected keeps its sentence.
  const off = locked(grade({ ...g, aiMain: { provider: 'anthropic', label: 'Claude', state: 'not_connected' } }));
  assert.ok(off.includes("We couldn't ask AI this time. The AI check is not connected yet."));
});

// ---- V141 ----------------------------------------------------------------------------------------------------

test('V141: "Free. No account needed." replaces "Free, no sign-up."', () => {
  assert.ok(FORM_SEARCH_DESCRIPTION.endsWith('Free. No account needed.'));
  assert.equal(/no sign-?up/i.test(FORM_SEARCH_DESCRIPTION), false);
  assert.equal(/no sign-?up/i.test(gradeFormPage({ indexable: true, canonical: 'https://example.test/grade' })), false);
});

// ---- V142 ----------------------------------------------------------------------------------------------------

test('V142: one picture reads "Your 1 picture has no description."; more pictures keep "N of M"', () => {
  const run = html => runWebsiteChecks({ facts: readPageFacts(html), robots: null, llms: null, input: INPUT })
    .find(r => r.id === 'image-descriptions');
  assert.equal(run('<title>x</title><img src="a.jpg">').detail, 'Your 1 picture has no description.');
  const five = run(`<title>x</title>${'<img src="a.jpg">'.repeat(3)}${'<img src="b.jpg" alt="b">'.repeat(2)}`);
  assert.equal(five.detail, '3 of 5 pictures have no description.');
});

const mainEntry = (ask, extra = {}) => ({
  prompt: freeQuestion(INPUT), provider: 'anthropic', model: 'stub', webSearch: true, answer: '1. Other Co\n2. Another Co',
  named: false, position: null, total: 2, competitors: ['Other Co', 'Another Co'], ms: 5, at: AT, ask, ...extra,
});

test('V142: "none of its 3 answers", never "0 of its 3 answers"', () => {
  const g = grade({ ai: [mainEntry(1), mainEntry(2), mainEntry(3)] });
  const html = open(g);
  assert.ok(html.includes("<p>Claude didn't name your business in any of its 3 answers.</p>"));
  assert.equal(html.includes('0 of its'), false);
  const some = open(grade({ ai: [mainEntry(1, { named: true, position: 1 }), mainEntry(2), mainEntry(3)] }));
  assert.ok(some.includes('<p>Claude named your business in 1 of its 3 answers.</p>'));
});

test('V142: Claude\'s answers come first under every question', () => {
  const second = { ...mainEntry(undefined), provider: 'chatgpt', second: true };
  const html = open(grade({ ai: [second, mainEntry(undefined)] }));
  const claude = html.indexOf('<p>Claude: ');
  const chatgpt = html.indexOf('<p>ChatGPT (for comparison only): ');
  assert.ok(claude !== -1 && chatgpt !== -1, 'both are shown');
  assert.ok(claude < chatgpt, 'Claude first');
});

test('V142: the robots.txt help says to replace the lines that block, not to add', () => {
  const blocked = { id: 'ai-bots-allowed', result: 'fail', detail: 'Blocked: ChatGPT (GPTBot)', blocked: ['GPTBot'] };
  const html = open(grade({ results: [blocked, pass('ai-named', { earned: 30 })] }));
  assert.ok(html.includes('Replace the lines that block these assistants with these lines in your robots.txt file, so they can read your website.'));
  assert.equal(html.includes('Add these lines'), false);
});

test('V142: the about page and the form intro', () => {
  assert.ok(aboutPage().includes('Each is read at most once per check.'));
  const form = gradeFormPage();
  assert.ok(form.includes('We ask AI assistants to name the best businesses like yours in your city, and see if they name you.'));
  assert.equal(form.includes('who it would name'), false);
});

test('V142: form error text is in sentence case: the error style has no text-transform', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const rule = /\.missing-note\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the rule exists');
  assert.equal(/text-transform/.test(rule[1]), false);
});

// ---- V144 ----------------------------------------------------------------------------------------------------

test('V144: an address is one line in US style, with no comma before the ZIP', () => {
  assert.equal(usAddressStyle('410 Woodland St, Nashville, TN, 37206'), '410 Woodland St, Nashville, TN 37206');
  assert.equal(usAddressStyle('410 Woodland St, Nashville, TN, 37206-1234'), '410 Woodland St, Nashville, TN 37206-1234');
  assert.equal(usAddressStyle('410 Woodland St, Nashville, TN 37206'), '410 Woodland St, Nashville, TN 37206');
  assert.equal(usAddressStyle('12 Main Street'), '12 Main Street');
  assert.equal(usAddressStyle(undefined), '');
  // A Grade stored before the rule shows the new style.
  const old = { found: { phone: '', hours: [], address: '410 Woodland St, Nashville, TN, 37206', website: '', reviewsLink: '' } };
  assert.equal(foundOf(old).address, '410 Woodland St, Nashville, TN 37206');
  const html = locked(grade({ found: { ...old.found, phone: '(615) 555-0100' } }));
  assert.ok(html.includes('410 Woodland St, Nashville, TN 37206'));
  assert.equal(html.includes('TN, 37206'), false);
});

test('V144: in the business label only the street is streetAddress; the city, state and ZIP have their own fields', () => {
  const body = block => JSON.parse(block.replace(/^<script[^>]*>\n/, '').replace(/\n<\/script>$/, ''));
  const base = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', phone: '(615) 555-0100' };
  for (const address of ['410 Woodland St, Nashville, TN 37206', '410 Woodland St, Nashville, TN, 37206']) {
    const a = body(jsonLdBlock({ ...base, address })).address;
    assert.equal(a.streetAddress, '410 Woodland St', address);
    assert.equal(a.addressLocality, 'Nashville');
    assert.equal(a.addressRegion, 'TN');
    assert.equal(a.postalCode, '37206');
  }
  const street = body(jsonLdBlock({ ...base, address: '12 Main Street' })).address;
  assert.equal(street.streetAddress, '12 Main Street');
  assert.equal(Object.hasOwn(street, 'postalCode'), false);
  assert.equal(Object.hasOwn(body(jsonLdBlock({ ...base, address: '' })).address, 'streetAddress'), false);
  // No storefront: no address at all, as before.
  assert.equal(Object.hasOwn(body(jsonLdBlock({ ...base, address: '12 Main Street', noStorefront: true })), 'address'), false);
});

// ---- V143: one title style --------------------------------------------------------------------------------------

test('V143: a title without the site name gets " | First Answer Pages"; the others are left as they are', () => {
  assert.equal(applyTitleSuffix('<title>Thanks!</title>'), '<title>Thanks! | First Answer Pages</title>');
  assert.equal(applyTitleSuffix('<title>About the AI Visibility Check</title>'), '<title>About the AI Visibility Check | First Answer Pages</title>');
  assert.equal(applyTitleSuffix('<title>First Answer Pages: Local Business Directory</title>'), '<title>First Answer Pages: Local Business Directory</title>');
  assert.equal(applyTitleSuffix('<title>Plumbers in Nashville | First Answer Pages</title>'), '<title>Plumbers in Nashville | First Answer Pages</title>');
  assert.equal(
    applyTitleSuffix('<title>A</title><p>&lt;title&gt;B</p><title>C</title>'),
    '<title>A | First Answer Pages</title><p>&lt;title&gt;B</p><title>C</title>',
    'only the first title',
  );
  assert.equal(applyTitleSuffix('no title here'), 'no title here');
  assert.equal(applyTitleSuffix(42), 42);
});

// ---- the pages that need the app: V138, V143 and the privacy page ----------------------------------------------

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-final-pages-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 1000, gradeLimit: 500 });
  let n = 0;
  const assistant = {
    name: 'anthropic',
    async ask() { return { answer: '1. Other Co\n2. Another Co', provider: 'anthropic', model: 'stub', webSearch: true }; },
  };
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: assistant,
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { return { status: 404, text: '', contentType: 'text/plain' }; } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `final${String(++n).padStart(17, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: false, graderSecret: 'test-secret', adminToken: 'final-token',
      gradeAiCallsPerDay: 500, gradeMainAsks: 1,
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

const get = (env, p) => fetch(env.base + p, { redirect: 'manual' });
const post = (env, p) => fetch(env.base + p, { method: 'POST', redirect: 'manual', body: new URLSearchParams({}) });

async function doneGrade(env, input = INPUT) {
  const id = await env.ctx.grader.start(input);
  for (let i = 0; i < 400; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (g && g.status !== 'running') break;
    await sleep(10);
  }
  return id;
}

/** Wait until a recheck that was started has ended, so nothing writes after the test. */
async function settled(env, id) {
  for (let i = 0; i < 400; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (!g || !g.recheckRunning) return;
    await sleep(10);
  }
}

test('V138: "Check again" pressed twice says so and goes back to the report; the limits are unchanged', async () => {
  const env = await startEnv();
  const id = await doneGrade(env);
  const first = await post(env, `/grade/${id}/recheck`);
  assert.equal(first.status, 303);
  const second = await post(env, `/grade/${id}/recheck`);
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get('retry-after')) >= 1);
  const text = await second.text();
  assert.ok(text.includes('You just checked again. Please wait two minutes.'));
  assert.ok(text.includes(`<a href="/grade/${id}">Back to the report</a>`));
  assert.equal(text.includes('Please slow down'), false);
  assert.equal(text.includes('Back to the check'), false);
  await settled(env, id);

  // After the two minutes the same press works again.
  env.clock.t += 3 * 60 * 1000;
  assert.equal((await post(env, `/grade/${id}/recheck`)).status, 303);
  await settled(env, id);
});

test('V138: the per-client limit of 10 an hour still shows the old page', async () => {
  const env = await startEnv();
  const ids = [];
  for (let i = 0; i < 11; i += 1) ids.push(await doneGrade(env));
  for (const id of ids.slice(0, 10)) {
    assert.equal((await post(env, `/grade/${id}/recheck`)).status, 303);
    await settled(env, id);
  }
  const eleventh = await post(env, `/grade/${ids[10]}/recheck`);
  assert.equal(eleventh.status, 429);
  const text = await eleventh.text();
  assert.ok(text.includes('We have had a lot of checks from your internet connection.'));
  assert.equal(text.includes('You just checked again'), false);
});

test('V143: pages across the site end their tab title with the site name', async () => {
  const env = await startEnv();
  const titleOf = async p => /<title>([^<]*)<\/title>/.exec(await (await get(env, p)).text())?.[1];
  assert.equal(await titleOf('/grade/about'), 'About the AI Visibility Check | First Answer Pages');
  assert.equal(await titleOf('/rise'), 'List your business free | First Answer Pages');
  assert.equal(await titleOf('/'), 'First Answer Pages: Local Business Directory');
  assert.equal(await titleOf('/about'), 'About | First Answer Pages');
  assert.equal(await titleOf('/no-such-page-here'), 'Page not found | First Answer Pages');
  // Never added twice.
  for (const p of ['/grade/about', '/rise', '/', '/about', '/privacy', '/no-such-page-here']) {
    const title = await titleOf(p);
    assert.equal(title.split('First Answer Pages').length - 1, 1, p);
  }
});

test('V142: the privacy page writes "AI Visibility Check" with capitals', async () => {
  const env = await startEnv();
  const text = await (await get(env, '/privacy')).text();
  assert.ok(text.includes('<strong>AI Visibility Check:</strong>'));
  assert.ok(text.includes('AI Visibility Check reports, and the contact details'));
  assert.equal(text.includes('AI visibility check'), false);
});
