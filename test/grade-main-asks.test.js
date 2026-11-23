/**
 * Ask Claude three times, with the reserve rule (Feature E, task E2; Requirement 23). Every number is pinned in
 * its own test. Fake assistants, a fake budget size and a fake clock; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { freeQuestion, AI_LIMIT_REACHED } from '../server/lib/grader.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 22, 18, 0, 0);
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' };
const WITH_SITE = { ...INPUT, website: 'https://zephyr.example/' };
const NAMED = '1. Zephyr Plumbing\n2. Other Co\n3. Another Co';
const NOT_NAMED = '1. Other Co\n2. Another Co\n3. Third Co';
const PREAMBLE = "I'll search for the best plumbers in Nashville.";

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A fake Claude. `script[i]` is what call i does: a string answer, an Error to throw, a function of
 * `{ consumeExtra }` (to fake a reply that needs a resend), or nothing (NOT_NAMED).
 */
function fakeClaude(script = [], name = 'anthropic') {
  const fake = {
    name,
    calls: [],
    async ask({ prompt, consumeExtra }) {
      const i = fake.calls.length;
      fake.calls.push({ prompt });
      const step = script[i];
      if (step instanceof Error) throw step;
      const answer = typeof step === 'function' ? await step({ consumeExtra }) : (step ?? NOT_NAMED);
      return { answer, provider: name, model: 'stub', webSearch: true };
    },
  };
  return fake;
}

/** A reply that paused mid-search: it resends when the allowance lets it, else it returns the preamble. */
const pausing = answer => async ({ consumeExtra }) => ((await consumeExtra?.()) === true ? answer : PREAMBLE);

const busy = () => Object.assign(new Error('busy'), { status: 429, retryAfterSeconds: 0 });

const SITE_HTML = `<!doctype html><html><head><title>Zephyr Plumbing | Plumbers in Nashville, TN</title>
  <meta name="description" content="Zephyr Plumbing fixes pipes, drains and water heaters across Nashville. Call today."></head>
  <body><h1>Plumbers in Nashville</h1><p>${'We fix pipes and drains. '.repeat(20)}</p></body></html>`;

async function startEnv({ assistant, extras = [], gradeLeft = 150, asks = 3 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-main-asks-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  // The Grader's share is exactly `gradeLeft` calls (the shared caps are far above it).
  const aiBudget = createAiBudget({ clock, limit: 1000, gradeLimit: gradeLeft });
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: assistant,
    extraAssistants: extras,
    nameChecker: null,
    safeFetcher: {
      async fetchText(url) {
        if (new URL(url).pathname === '/') return { status: 200, text: SITE_HTML, contentType: 'text/html', finalUrl: url };
        return { status: 404, text: '', contentType: 'text/plain' };
      },
    },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `asks${String(++n).padStart(18, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'asks-token',
      gradeAiCallsPerDay: gradeLeft, gradeMainAsks: asks,
    },
  });
  cleanups.push(async () => {
    await aiBudget.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { ctx: app.locals.ctx, aiBudget, clock };
}

/** Start a Grade and wait for it to finish (and for any second opinion to settle). */
async function runGrade(env, input = INPUT) {
  const id = await env.ctx.grader.start(input);
  for (let i = 0; i < 400; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (g && g.status !== 'running') break;
    await sleep(10);
  }
  await sleep(30);
  const grade = await env.ctx.grader.get(id);
  assert.equal(grade.status, 'done');
  return grade;
}

const mainAnswers = grade => grade.ai.filter(a => a.provider === 'anthropic' || a.provider === 'mock');
const aiNamed = grade => grade.results.find(r => r.id === 'ai-named');
const aiFinding = grade => grade.steps.find(s => s.name.startsWith('Asking AI')).finding;
const used = env => env.aiBudget.usage({ kind: 'grade' }).used;

// ---- the score from several answers ---------------------------------------------------------------------

test('E2: "named, named, not named" gives 20 of 30 points and "named your business in 2 of 3 answers"', async () => {
  const claude = fakeClaude([NAMED, NAMED, NOT_NAMED]);
  const env = await startEnv({ assistant: claude });
  const grade = await runGrade(env);
  assert.equal(claude.calls.length, 3);
  assert.ok(claude.calls.every(c => c.prompt === freeQuestion(INPUT)), 'the same free question each time');
  assert.equal(mainAnswers(grade).length, 3);
  assert.equal(aiNamed(grade).earned, 20);
  assert.equal(aiNamed(grade).detail, 'Yes. Claude named your business in 2 of 3 answers.');
});

test('E2: one ask that fails is simply missing: "1 of 2 answers" and 15 of 30, with no penalty', async () => {
  const claude = fakeClaude([NAMED, new Error('provider failed'), NOT_NAMED]);
  const env = await startEnv({ assistant: claude });
  const grade = await runGrade(env);
  assert.equal(mainAnswers(grade).length, 2);
  assert.equal(aiNamed(grade).earned, 15);
  assert.equal(aiNamed(grade).detail, 'Yes. Claude named your business in 1 of 2 answers.');
  assert.equal(aiFinding(grade), 'Asked Claude 3 times and got 2 answers.');
});

test('E2: when all three asks fail the AI part is not checked and the score is partial', async () => {
  const claude = fakeClaude([new Error('a'), new Error('b'), new Error('c')]);
  const env = await startEnv({ assistant: claude });
  const grade = await runGrade(env, WITH_SITE);
  assert.equal(claude.calls.length, 3);
  assert.equal(aiNamed(grade).result, 'not_checked');
  assert.equal(grade.aiMain.state, 'failed');
  assert.ok(Number.isInteger(grade.score.score), 'the website part still scores');
  assert.equal(grade.steps.find(s => s.name.startsWith('Asking AI')).state, 'failed');
});

// ---- GRADE_MAIN_ASKS=1 is today ---------------------------------------------------------------------------

test('E2: with GRADE_MAIN_ASKS=1 it is exactly as today: one call, one entry, no ask field, the old finding', async () => {
  const claude = fakeClaude([NAMED]);
  const env = await startEnv({ assistant: claude, asks: 1 });
  const grade = await runGrade(env);
  assert.equal(claude.calls.length, 1);
  const answers = mainAnswers(grade);
  assert.equal(answers.length, 1);
  assert.equal(Object.hasOwn(answers[0], 'ask'), false);
  assert.equal(aiFinding(grade), 'Claude listed 3 businesses');
  assert.equal(aiNamed(grade).detail, 'Yes. Claude named your business.');
  assert.equal(used(env), 1);
});

test('E2: each entry carries its ask number only when more than one ask was planned', async () => {
  const claude = fakeClaude([NAMED, NOT_NAMED, NOT_NAMED]);
  const env = await startEnv({ assistant: claude });
  const grade = await runGrade(env);
  assert.deepEqual(mainAnswers(grade).map(a => a.ask).sort(), [1, 2, 3]);
});

// ---- the allowance and the reserve ------------------------------------------------------------------------

test('E2: the allowance is charged once per ask: 3 for 3 asks', async () => {
  const env = await startEnv({ assistant: fakeClaude(), gradeLeft: 100 });
  await runGrade(env);
  assert.equal(used(env), 3);
});

test('E2: with 0 calls left the check still runs, the AI part is skipped and the score is partial', async () => {
  const claude = fakeClaude();
  const env = await startEnv({ assistant: claude, gradeLeft: 0 });
  const grade = await runGrade(env, WITH_SITE);
  assert.equal(claude.calls.length, 0);
  assert.equal(aiNamed(grade).result, 'not_checked');
  assert.equal(grade.aiMain.state, 'limit');
  assert.equal(aiFinding(grade), AI_LIMIT_REACHED);
  assert.equal(AI_LIMIT_REACHED, 'AI check limit reached for today');
  assert.ok(Number.isInteger(grade.score.score));
});

test('E2: with 13 calls left 1 ask is made', async () => {
  const claude = fakeClaude([NAMED]);
  const env = await startEnv({ assistant: claude, gradeLeft: 13 });
  const grade = await runGrade(env);
  assert.equal(claude.calls.length, 1);
  assert.equal(used(env), 1);
  assert.equal(aiFinding(grade), "Asked Claude 1 time, not 3, because we reached today's limit. Got 1 answer.");
});

test('E2: with 14 calls left 2 asks are made, and the finding says the limit cut it short', async () => {
  const claude = fakeClaude([NAMED, NOT_NAMED]);
  const env = await startEnv({ assistant: claude, gradeLeft: 14 });
  const grade = await runGrade(env);
  assert.equal(claude.calls.length, 2);
  assert.equal(used(env), 2);
  assert.equal(aiFinding(grade), "Asked Claude 2 times, not 3, because we reached today's limit. Got 2 answers.");
});

test('E2: with 15 calls left 3 asks are made', async () => {
  const claude = fakeClaude([NAMED, NOT_NAMED, NOT_NAMED]);
  const env = await startEnv({ assistant: claude, gradeLeft: 15 });
  const grade = await runGrade(env);
  assert.equal(claude.calls.length, 3);
  assert.equal(aiFinding(grade), 'Asked Claude 3 times and got 3 answers.');
});

test('E2: with more than 15 calls left 3 asks are made, never more', async () => {
  const claude = fakeClaude();
  const env = await startEnv({ assistant: claude, gradeLeft: 150 });
  await runGrade(env);
  assert.equal(claude.calls.length, 3);
});

test('E2: with 15 or fewer calls left the second opinions are skipped; with 16 they are asked', async () => {
  for (const [left, expected] of [[15, 0], [14, 0], [13, 0], [16, 1]]) {
    const second = fakeClaude([], 'chatgpt');
    const env = await startEnv({ assistant: fakeClaude(), extras: [second], gradeLeft: left });
    await runGrade(env);
    assert.equal(second.calls.length, expected, `${left} left`);
  }
});

// ---- resends inside an ask -----------------------------------------------------------------------------------

test('E2: with plenty left, a reply that needs a resend resends for every ask', async () => {
  const claude = fakeClaude([pausing(NAMED), pausing(NAMED), pausing(NOT_NAMED)]);
  const env = await startEnv({ assistant: claude, gradeLeft: 40 });
  const grade = await runGrade(env);
  assert.equal(used(env), 6, '3 asks and 3 resends');
  assert.equal(mainAnswers(grade).length, 3);
  assert.equal(grade.ai.some(a => a.answer.includes("I'll search")), false);
  assert.equal(aiNamed(grade).detail, 'Yes. Claude named your business in 2 of 3 answers.');
});

test('E2: with 12 or fewer left, ask 1 resends as today but a refused resend drops asks 2 and 3 as not run', async () => {
  // 15 left: three asks leave 12; ask 1's resend is allowed (11 left); asks 2 and 3 may not resend.
  const claude = fakeClaude([pausing(NAMED), pausing(NOT_NAMED), pausing(NOT_NAMED)]);
  const env = await startEnv({ assistant: claude, gradeLeft: 15 });
  const grade = await runGrade(env);
  assert.equal(claude.calls.length, 3);
  assert.equal(used(env), 4, '3 asks and ask 1 resend');
  const answers = mainAnswers(grade);
  assert.equal(answers.length, 1, 'only the ask that ran is kept');
  assert.equal(answers[0].ask, 1);
  assert.equal(grade.ai.some(a => a.answer.includes("I'll search")), false, 'no preamble is stored');
  // The dropped asks do not lower the score: named in 1 of 1.
  assert.equal(aiNamed(grade).earned, 30);
  assert.equal(aiNamed(grade).detail, 'Yes. Claude named your business.');
  assert.equal(aiFinding(grade), 'Asked Claude 3 times and got 1 answer.');
});

test('E2: a refused resend on ask 1 keeps today\'s rule (the answer it has is used)', async () => {
  // 13 left: one ask (12 left); its resend is allowed by today's rule (11 left).
  const claude = fakeClaude([pausing(NAMED)]);
  const env = await startEnv({ assistant: claude, gradeLeft: 13 });
  const grade = await runGrade(env);
  assert.equal(used(env), 2);
  assert.equal(mainAnswers(grade).length, 1);
  assert.equal(aiNamed(grade).earned, 30);
});

// ---- retries, refunds and starting together -------------------------------------------------------------------

test('E2: an ask that gets a 429 is retried once; one that ends in 429 is refunded and not charged', async () => {
  // Call order: asks 1, 2, 3 start together; then ask 2's retry. Ask 2 is busy twice, so it is refunded.
  const claude = fakeClaude([NAMED, busy(), NOT_NAMED, busy()]);
  const env = await startEnv({ assistant: claude, gradeLeft: 100 });
  const grade = await runGrade(env);
  assert.equal(claude.calls.length, 4, 'three asks and one retry');
  assert.equal(used(env), 2, 'the busy ask was given back');
  assert.equal(mainAnswers(grade).length, 2);

  // A 429 followed by an answer: retried, charged once.
  const again = fakeClaude([busy(), NAMED, NAMED, NAMED]);
  const env2 = await startEnv({ assistant: again, gradeLeft: 100 });
  const grade2 = await runGrade(env2);
  assert.equal(again.calls.length, 4);
  assert.equal(used(env2), 3);
  assert.equal(mainAnswers(grade2).length, 3);
});

test('E2: all planned asks start together', async () => {
  let open = 0;
  let most = 0;
  const claude = {
    name: 'anthropic',
    calls: [],
    async ask() {
      claude.calls.push(1);
      open += 1;
      most = Math.max(most, open);
      await sleep(30);
      open -= 1;
      return { answer: NOT_NAMED, provider: 'anthropic', model: 'stub', webSearch: true };
    },
  };
  const env = await startEnv({ assistant: claude });
  await runGrade(env);
  assert.equal(claude.calls.length, 3);
  assert.equal(most, 3, 'all three were waiting at the same time');
});

test('E2: the demo assistant is asked once, not three times', async () => {
  const demo = fakeClaude([NOT_NAMED], 'mock');
  const env = await startEnv({ assistant: demo });
  const grade = await runGrade(env);
  assert.equal(demo.calls.length, 1);
  const answers = mainAnswers(grade);
  assert.equal(answers.length, 1);
  assert.equal(Object.hasOwn(answers[0], 'ask'), false);
});

// ---- reuse -------------------------------------------------------------------------------------------------------

test('E2: carried-over answers to the same question mean no new asks', async () => {
  const claude = fakeClaude([NAMED, NAMED, NOT_NAMED]);
  const env = await startEnv({ assistant: claude });
  await runGrade(env);
  assert.equal(claude.calls.length, 3);
  const second = await runGrade(env);
  assert.equal(claude.calls.length, 3, 'Claude is not asked again');
  assert.equal(mainAnswers(second).length, 3);
  assert.equal(aiFinding(second), "Used Claude's answers from earlier this week.");
  assert.equal(aiNamed(second).detail, 'Yes. Claude named your business in 2 of 3 answers.');
});

test('V103: one carried answer keeps today\'s sentence', async () => {
  const claude = fakeClaude([NAMED]);
  const env = await startEnv({ assistant: claude, asks: 1 });
  await runGrade(env);
  const second = await runGrade(env);
  assert.equal(claude.calls.length, 1, 'Claude is not asked again');
  assert.equal(aiFinding(second), 'Used an answer from earlier this week');
});

test('E2: answers to a differently worded question are not carried over, and only the new asks count', async () => {
  const claude = fakeClaude([NAMED, NAMED, NAMED, NAMED, NOT_NAMED, NOT_NAMED]);
  const env = await startEnv({ assistant: claude });
  const first = await runGrade(env);
  // The earlier Grade asked an older wording of the question.
  await env.ctx.store.collection('grades').update(list => {
    const g = list.find(x => x.id === first.id);
    for (const a of g.ai) a.prompt = a.prompt.replace('plumbers', 'Plumbers');
  });
  const second = await runGrade(env);
  assert.equal(claude.calls.length, 6, 'Claude is asked again');
  assert.ok(mainAnswers(second).every(a => a.prompt === freeQuestion(INPUT)));
  assert.equal(mainAnswers(second).length, 3);
  assert.equal(aiNamed(second).detail, 'Yes. Claude named your business in 1 of 3 answers.');
});
