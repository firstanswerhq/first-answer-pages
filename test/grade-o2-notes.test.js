/**
 * The notes of the O2 and V157 to V163 code review (V164 to V171), applied before O4:
 * V164 the daily-limit reason is found by the AI step's finding, not its name; V165 a null in a stored answer list
 * never stops a repeat check or an unlock; V166 no sentence blames Claude when the limit was the reason; V168 the
 * form is filled only from a finished Grade; V169 a gate-off view does not start extras after the limit; V170 the
 * "Partly" color tokens; V171 "Partly" through real answers. (V167 is spec only.)
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
  freeQuestion, extraQuestions, AI_LIMIT_REACHED, AI_FAILED,
} from '../server/lib/grader.js';
import { scoreGrade } from '../server/lib/grade-score.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const FREE = freeQuestion(INPUT);
const [EXTRA_1, EXTRA_2] = extraQuestions(INPUT);
const ID = 'notes2AAAAAAAAAAAAAAAAA';

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
const RUN_NEW = `Come back tomorrow and tap <a href="/grade?from=${ID}">Run a new check</a> to get your full score.`;

// ---- V164 ---------------------------------------------------------------------------------------------------------

test('V164: the daily-limit reason is found by the step\'s finding, whatever the step was named', () => {
  const stored = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 2 of 2 answers.', earned: 30 };
  const ai = [entry(EXTRA_1, true), entry(EXTRA_2, true)];
  // A Grade saved before the question was reworded names the step with the service as it was typed.
  for (const name of ['Asking AI to name the best plumber in Nashville', 'Asking AI to name the best Plumbers in Nashville', 'Asking the AI']) {
    const steps = [{ name, state: 'skipped', ms: 5, finding: AI_LIMIT_REACHED }];
    const html = locked(grade({ ai, results: [...WEBSITE_ONLY, stored], state: 'ok', steps }));
    assert.ok(html.includes(RUN_NEW), name);
    assert.equal(html.includes('Claude didn&#39;t answer this time'), false, name);
  }
  // Another step with some other finding is not the limit.
  const other = [{ name: 'Asking the AI', state: 'failed', ms: 5, finding: "AI didn't answer this time" }];
  const html = locked(grade({ ai, results: [...WEBSITE_ONLY, stored], state: 'ok', steps: other }));
  assert.ok(html.includes('Partial score: Claude didn&#39;t answer this time'));
  assert.equal(html.includes('Come back tomorrow'), false);
});

// ---- V166 ---------------------------------------------------------------------------------------------------------

test('V166: when the limit was the reason, no sentence blames Claude (extras answered)', () => {
  const g = grade({
    ai: [entry(EXTRA_1, true, { extra: true }), entry(EXTRA_2, false, { extra: true })],
    results: [...WEBSITE_ONLY, notChecked(AI_LIMIT_REACHED)], state: 'limit',
  });
  const html = open(g);
  assert.ok(html.includes("<p>We couldn't ask Claude the first question because today's limit for AI questions was reached, so this check has no AI score. The other answers are shown below but not counted toward your score.</p>"));
  assert.equal(html.includes('did not answer the first question'), false);
});

test('V166: when the limit was the reason, second opinions alone read the same way, in the full report and the free part', () => {
  const g = grade({ ai: [second(FREE), second(EXTRA_1)], results: [...WEBSITE_ONLY, notChecked(AI_LIMIT_REACHED)], state: 'limit' });
  const html = open(g);
  assert.ok(html.includes("<p>We couldn't ask Claude because today's limit for AI questions was reached, so this check has no AI score. The answers from ChatGPT are here so you can compare.</p>"));
  assert.ok(html.includes("<p>We couldn't ask Claude this time because today's limit for AI questions was reached, so this check has no AI score.</p>"));
  assert.equal(html.includes('did not answer'), false);
});

test('V166: for any other reason the sentences are as before', () => {
  const g = grade({ ai: [second(FREE), second(EXTRA_1)] });
  const html = open(g);
  assert.ok(html.includes("<p>Claude didn't answer, so this check has no AI score. The answers from ChatGPT are here so you can compare.</p>"));
  assert.ok(html.includes("<p>Claude didn't answer this time, so this check has no AI score.</p>"));
  assert.equal(html.includes("We couldn't ask Claude"), false);
});

// ---- V171 ---------------------------------------------------------------------------------------------------------

test('V171: "Partly", "10 of 30 points" and the detail without "Yes. " come from the recompute of real answers', () => {
  // The stored result says all three answers named the business; the stored answers say one did.
  const stale = { id: 'ai-named', result: 'pass', detail: 'Yes. Claude named your business in 3 of 3 answers.', earned: 30 };
  const g = grade({
    ai: [entry(FREE, true), entry(FREE, false), entry(FREE, false)], results: [...WEBSITE_ONLY, stale], state: 'ok',
  });
  const html = open(g);
  const row = new RegExp('<li class="grade-check [a-z_]+">(?:(?!</li>)[^])*?<strong>What AI says about your business</strong>(?:(?!</li>)[^])*</li>').exec(html)?.[0] ?? '';
  assert.ok(row.startsWith('<li class="grade-check partly">'));
  assert.ok(row.includes('<span class="grade-result">Partly</span>'));
  assert.ok(row.includes('10 of 30 points'));
  assert.ok(row.includes('<p>Claude named your business in 1 of 3 answers.</p>'));
  assert.equal(row.includes('Yes.'), false);
  assert.equal(g.results.at(-1).detail, 'Yes. Claude named your business in 3 of 3 answers.', 'the stored text is not touched');
});

// ---- V170 ---------------------------------------------------------------------------------------------------------

test('V170: the amber of "Partly" is in color tokens beside the others, and the rules use them', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  // high-tech-look Step 1A: the screen tokens are the dark theme's; the light values of V170 are the paper (print)
  // values of the same tokens. The amber itself (#B7791F, also written into the icon) is the same on screen and paper.
  const first = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));
  assert.ok(/--color-partly:\s*#B7791F/i.test(first));
  assert.ok(/--color-partly-bg:\s*#2A2108/i.test(first));
  assert.ok(/--color-partly-text:\s*#FFD27A/i.test(first));
  assert.ok(/--color-partly-pill:\s*rgba\(251, 191, 36, 0\.16\)/.test(first));
  const paper = /@media print \{\n  :root \{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? '';
  assert.ok(/--color-partly:\s*#B7791F/i.test(paper));
  assert.ok(/--color-partly-bg:\s*#FBF1DC/i.test(paper));
  assert.ok(/--color-partly-text:\s*#8A5300/i.test(paper));
  assert.ok(/--color-partly-pill:\s*rgba\(183, 121, 31, 0\.14\)/.test(paper));
  // Beside the other status tokens, in the first :root block.
  assert.ok(css.indexOf('--color-partly:') > css.indexOf('--color-warn-bg:'));
  assert.ok(css.indexOf('--color-partly:') < css.indexOf('/* Surfaces */'));
  assert.ok(css.indexOf('/* Surfaces */') < css.indexOf('\n}', css.indexOf(':root {')), 'all in the first :root block');
  // The rules use the tokens; the icon's picture is the one place the amber is written out.
  const rules = [...css.matchAll(/\.grade-check\.partly(?: \.grade-result)?\s*\{[^}]*\}/g)].map(m => m[0]);
  assert.ok(rules.length >= 3, `the three rules (found ${rules.length})`);
  for (const rule of rules) {
    const bare = rule.replace(/\/\*[^]*?\*\//g, '').replace(/url\([^)]*\)/g, 'url()');
    assert.equal(/#B7791F|#8A5300|#FBF1DC|183, 121, 31/i.test(bare), false, rule);
  }
  assert.ok(rules.some(r => r.includes('var(--color-partly)')));
  assert.ok(rules.some(r => r.includes('var(--color-partly-bg)')));
  assert.ok(rules.some(r => r.includes('var(--color-partly-text)') && r.includes('var(--color-partly-pill)')));
});

// ---- the pages that need the app --------------------------------------------------------------------------------

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

async function startEnv(assistant, { gradeLeft = 1000, config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-o2-notes-'));
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
    newGradeId: () => `nt2${String(++n).padStart(19, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'notes2-token',
      gradeAiCallsPerDay: gradeLeft, gradeMainAsks: 1, demoMode: false, ...config,
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

async function doneGrade(env, input = { ...INPUT, website: '' }) {
  const id = await env.ctx.grader.start(input);
  await until(async () => {
    const g = await env.ctx.grader.get(id);
    return g && g.status !== 'running';
  }, 'the check');
  return id;
}

const LEAD = { name: 'Pat Zephyr', email: 'pat@example.com', phone: '(615) 555-0100', okToContact: false };
const putAi = (env, id, ai) => env.ctx.store.collection('grades').update(list => {
  const g = list.find(x => x && x.id === id);
  g.ai = ai;
});

// ---- V165 ---------------------------------------------------------------------------------------------------------

test('V165: POST /grade succeeds, and carries the good answers, when an earlier Grade has null entries in its answers', async () => {
  const claude = fakeClaude();
  const env = await startEnv(claude);
  const first = await doneGrade(env);
  const earlier = await env.ctx.grader.get(first);
  await putAi(env, first, [null, 'x', 5, [], ...earlier.ai]);
  const callsBefore = claude.calls.length;

  // The same business, through the form, as "Run a new check" would send it.
  const form = await (await fetch(`${env.base}/grade`)).text();
  const stamp = /name="t" value="([^"]+)"/.exec(form)?.[1];
  assert.ok(stamp);
  env.clock.t += 5000;
  const res = await fetch(`${env.base}/grade`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ name: INPUT.name, city: INPUT.city, state: INPUT.state, service: INPUT.service, website: '', nickname: '', t: stamp }),
  });
  assert.equal(res.status, 303);
  const id = /\/grade\/([A-Za-z0-9_-]+)/.exec(res.headers.get('location') ?? '')?.[1];
  assert.ok(id);
  const grade = await until(async () => {
    const g = await env.ctx.grader.get(id);
    return g && g.status !== 'running' ? g : null;
  }, 'the new check');
  assert.equal(grade.status, 'done');
  assert.equal(claude.calls.length, callsBefore, 'Claude is not asked again');
  assert.ok(grade.ai.length > 0 && grade.ai.every(a => a !== null && typeof a === 'object' && !Array.isArray(a)), 'only real answers were carried');
});

test('V165: unlocking a Grade with null entries in its answers still runs its extra questions', async () => {
  const claude = fakeClaude();
  const env = await startEnv(claude);
  const id = await doneGrade(env);
  const earlier = await env.ctx.grader.get(id);
  await putAi(env, id, [null, 'x', ...earlier.ai]);
  const callsBefore = claude.calls.length;
  await env.ctx.grader.unlock(id, LEAD);
  const grade = await until(async () => {
    const g = await env.ctx.grader.get(id);
    return g.ai.filter(a => a && a.extra === true).length >= 2 ? g : null;
  }, 'the extra questions');
  assert.equal(claude.calls.length, callsBefore + 2, 'both extra questions were asked');
  assert.ok(grade.extraAiStartedAt);
});

// ---- V168 ---------------------------------------------------------------------------------------------------------

test('V168: the form is filled only from a finished Grade (done or failed), not from one still running', async () => {
  const env = await startEnv(fakeClaude());
  const base = { input: INPUT, key: 'k', createdAt: new Date(NOW).toISOString(), steps: [], facts: null, results: [], ai: [] };
  // Grade_Ids are 22 characters.
  const running = { ...base, id: 'running'.padEnd(22, 'A'), status: 'running' };
  const failed = { ...base, id: 'failed'.padEnd(22, 'A'), status: 'failed' };
  await env.ctx.store.collection('grades').update(list => { list.push(running, failed); });
  const fromRunning = await (await fetch(`${env.base}/grade?from=${running.id}`)).text();
  assert.equal(fromRunning.includes('value="Zephyr Plumbing"'), false, 'a running Grade gives the plain form');
  assert.ok(fromRunning.includes('Can AI find your business?'));
  const fromFailed = await (await fetch(`${env.base}/grade?from=${failed.id}`)).text();
  assert.ok(fromFailed.includes('value="Zephyr Plumbing"'), 'a failed Grade fills the form');
  const id = await doneGrade(env, INPUT);
  assert.ok((await (await fetch(`${env.base}/grade?from=${id}`)).text()).includes('value="Zephyr Plumbing"'), 'a done Grade fills it');
});

// ---- V169 ---------------------------------------------------------------------------------------------------------

test('V169: with the gate off, a report view after the daily limit does not start the extra questions', async () => {
  const claude = fakeClaude();
  const env = await startEnv(claude, { gradeLeft: 0, config: { graderLeadGate: false } });
  const id = await doneGrade(env);
  assert.equal((await env.ctx.grader.get(id)).aiMain.state, 'limit');
  let starts = 0;
  const original = env.ctx.grader.startExtraQuestions.bind(env.ctx.grader);
  env.ctx.grader.startExtraQuestions = (...args) => { starts += 1; return original(...args); };
  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`${env.base}/grade/${id}`);
    assert.equal(res.status, 200);
    await res.text();
  }
  assert.equal(starts, 0, 'not called at all');
  assert.equal(claude.calls.length, 0);
});

test('V169: with the gate off and no limit, the first view still starts the extra questions', async () => {
  const claude = fakeClaude();
  const env = await startEnv(claude, { config: { graderLeadGate: false } });
  const id = await doneGrade(env);
  let starts = 0;
  const original = env.ctx.grader.startExtraQuestions.bind(env.ctx.grader);
  env.ctx.grader.startExtraQuestions = (...args) => { starts += 1; return original(...args); };
  await (await fetch(`${env.base}/grade/${id}`)).text();
  assert.equal(starts, 1);
  await until(async () => (await env.ctx.grader.get(id)).ai.filter(a => a && a.extra === true).length >= 2, 'the extra questions');
});
