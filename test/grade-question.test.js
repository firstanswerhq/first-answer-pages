/**
 * The question reads naturally (Feature F, task W1; Requirement 24): the cleaned service phrase, the three
 * questions and the scan step built from it, and the typed service kept on the Grade.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { servicePhrase, freeQuestion, extraQuestions, stepNames } from '../server/lib/grader.js';
import { scanPage, reportPage } from '../server/lib/grade-html.js';

// ---- every row of the design's table, in both forms ----------------------------------------------------------

const TABLE = [
  ['plumbers', 'plumbers', 'plumbers'],
  ['Window cleaning and pressure cleaning', 'window cleaning and pressure cleaning businesses', 'window cleaning and pressure cleaning'],
  ['HVAC repair', 'HVAC repair businesses', 'HVAC repair'],
  ['hair salons', 'hair salons', 'hair salons'],
  ['Pressure washing companies', 'pressure washing companies', 'pressure washing companies'],
  ['roofing company', 'roofing companies', 'roofing companies'],
  ['cleaning business', 'cleaning businesses', 'cleaning businesses'],
  ['dentist', 'dentists', 'dentists'],
  ['auto glass', 'auto glass businesses', 'auto glass'],
  ['bakery', 'bakeries', 'bakeries'],
  ['handyman', 'handymen', 'handymen'],
  ['iPhone repair', 'iPhone repair businesses', 'iPhone repair'],
  ['A/C repair', 'A/C repair businesses', 'A/C repair'],
  ['Mexican restaurants', 'Mexican restaurants', 'Mexican restaurants'],
  ['Pressure Washing Companies', 'pressure washing companies', 'pressure washing companies'],
];

for (const [typed, named, plain] of TABLE) {
  test(`W1: "${typed}" gives named "${named}" and plain "${plain}"`, () => {
    assert.deepEqual(servicePhrase(typed), { plain, named });
  });
}

// ---- each rule on its own -------------------------------------------------------------------------------------

test('W1: the first letter is made lower case unless the first word keeps its capitals', () => {
  assert.equal(servicePhrase('Window cleaning').plain, 'window cleaning');
  assert.equal(servicePhrase('A/C repair').plain, 'A/C repair', 'all capitals');
  assert.equal(servicePhrase('HVAC repair').plain, 'HVAC repair', 'all capitals');
  assert.equal(servicePhrase('iPhone repair').plain, 'iPhone repair', 'a capital inside it');
  for (const word of ['Mexican', 'Italian', 'Chinese', 'Thai', 'Japanese', 'Indian', 'Greek', 'French', 'Korean',
    'Vietnamese', 'Cuban', 'Cajun', 'Caribbean', 'Mediterranean', 'American', 'Spanish', 'German', 'Irish']) {
    assert.equal(servicePhrase(`${word} restaurants`).plain, `${word} restaurants`, word);
  }
});

test('W1: an all-capitalized phrase is made lower case, except the words that keep their capitals', () => {
  assert.equal(servicePhrase('Pressure Washing Companies').plain, 'pressure washing companies');
  assert.equal(servicePhrase('Mexican Restaurants').plain, 'Mexican restaurants');
  assert.equal(servicePhrase('HVAC Repair').named, 'HVAC repair businesses');
  assert.equal(servicePhrase('HVAC Repair Shop').plain, 'HVAC repair shops');
});

test('W1: the owner\'s other words are kept as typed', () => {
  assert.equal(servicePhrase('window cleaning in Downtown').named, 'window cleaning in Downtown businesses');
  assert.equal(servicePhrase('Tree removal and Stump grinding').plain, 'tree removal and Stump grinding');
});

test('W1: spaces are trimmed and collapsed', () => {
  assert.deepEqual(servicePhrase('  hair    salons  '), { plain: 'hair salons', named: 'hair salons' });
  assert.deepEqual(servicePhrase('\tauto \n glass '), { plain: 'auto glass', named: 'auto glass businesses' });
});

test('W1: "water heater" and "garage door" are not made plural by a general rule; they get "businesses"', () => {
  assert.deepEqual(servicePhrase('water heater'), { plain: 'water heater', named: 'water heater businesses' });
  assert.deepEqual(servicePhrase('garage door'), { plain: 'garage door', named: 'garage door businesses' });
  assert.deepEqual(servicePhrase('computer'), { plain: 'computer', named: 'computer businesses' });
});

test('W1: a phrase ending in "crew" or "shop" is made plural and gets no "businesses"', () => {
  assert.deepEqual(servicePhrase('cleaning crew'), { plain: 'cleaning crews', named: 'cleaning crews' });
  assert.deepEqual(servicePhrase('repair shop'), { plain: 'repair shops', named: 'repair shops' });
});

test('W1: the last word follows the fixed list', () => {
  assert.equal(servicePhrase('fitness').named, 'fitness businesses', 'a word ending in "ss" is not a plural');
  assert.equal(servicePhrase('travel agency').named, 'travel agencies');
  assert.equal(servicePhrase('divorce attorney').named, 'divorce attorneys');
  for (const word of ['contractor', 'shop', 'service', 'crew', 'store', 'salon', 'studio', 'clinic', 'restaurant',
    'cafe', 'firm', 'lawyer', 'doctor', 'plumber', 'roofer', 'painter', 'cleaner', 'landscaper', 'mechanic', 'barber',
    'photographer', 'realtor', 'agent', 'groomer', 'inspector']) {
    assert.deepEqual(servicePhrase(word), { plain: `${word}s`, named: `${word}s` }, word);
  }
  for (const word of ['florist', 'therapist', 'electrician', 'technician']) {
    assert.deepEqual(servicePhrase(word), { plain: `${word}s`, named: `${word}s` }, word);
  }
});

// ---- the three questions and the scan step -------------------------------------------------------------------

const TALLAHASSEE = { name: 'Capital City Window & Pressure Cleaning', city: 'Tallahassee', state: 'FL', service: 'Window cleaning and pressure cleaning', website: null };

test('W1: the free question and the second extra question use the named form; "I need … in" uses the plain form', () => {
  assert.equal(freeQuestion(TALLAHASSEE), 'Who are the best window cleaning and pressure cleaning businesses in Tallahassee, FL? Name your top 5.');
  assert.deepEqual(extraQuestions(TALLAHASSEE), [
    'I need window cleaning and pressure cleaning in Tallahassee, FL. Which companies would you recommend?',
    'Which window cleaning and pressure cleaning businesses in Tallahassee, FL do people say are the most reliable?',
  ]);
  assert.equal(stepNames(TALLAHASSEE)[3], 'Asking AI to name the best window cleaning and pressure cleaning businesses in Tallahassee');
});

test('W1: already clean services give exactly today\'s three questions and scan step', () => {
  for (const service of ['plumbers', 'roofers', 'accountants']) {
    const input = { name: 'Zephyr', city: 'Nashville', state: 'TN', service, website: null };
    assert.equal(freeQuestion(input), `Who are the best ${service} in Nashville, TN? Name your top 5.`);
    assert.deepEqual(extraQuestions(input), [
      `I need ${service} in Nashville, TN. Which companies would you recommend?`,
      `Which ${service} in Nashville, TN do people say are the most reliable?`,
    ]);
    assert.equal(stepNames(input)[3], `Asking AI to name the best ${service} in Nashville`);
  }
});

// ---- N2 (E2 code review): a repeat check typed with other capitals asks the same questions -------------------

const questionsFor = service => {
  const input = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service, website: null };
  return [freeQuestion(input), ...extraQuestions(input)];
};

test('N2: "Plumbers", "plumbers" and " plumbers " give exactly the same three questions', () => {
  const today = questionsFor('plumbers');
  for (const service of ['Plumbers', ' plumbers ']) assert.deepEqual(questionsFor(service), today, JSON.stringify(service));
});

test('N2: "PLUMBERS" keeps its capitals under the design\'s rules, so its questions differ (reported, not bent)', () => {
  // The rules keep an all-capitals word as typed (it could be HVAC or A/C), so "PLUMBERS" is not lowered.
  assert.equal(servicePhrase('PLUMBERS').named, 'PLUMBERS');
  assert.equal(questionsFor('PLUMBERS')[0], 'Who are the best PLUMBERS in Nashville, TN? Name your top 5.');
  assert.notDeepEqual(questionsFor('PLUMBERS'), questionsFor('plumbers'));
});

// ---- odd input -------------------------------------------------------------------------------------------------

test('W1: servicePhrase never throws on odd input', () => {
  const odd = ['', '   ', '!!!', '&<>"\'', '🔧🔧', 'plumbers 🔧', '\u0000x', 'x'.repeat(10000), 'ÉLECTRICIENS', 'ß',
    '\ud800', 'a b c d e f g h i j k l m n o p'.repeat(50), null, undefined, 42, {}, [], Symbol('s')];
  for (const value of odd) {
    let out;
    assert.doesNotThrow(() => { out = servicePhrase(value); }, String(typeof value));
    assert.equal(typeof out.plain, 'string');
    assert.equal(typeof out.named, 'string');
  }
  assert.deepEqual(servicePhrase(''), { plain: '', named: '' });
  assert.deepEqual(servicePhrase(null), { plain: '', named: '' });
});

test('W1: the phrase is still escaped where it is shown', () => {
  const input = { name: 'Zeph', city: 'Nashville', state: 'TN', service: '<b>pipe</b> & "drain" repair', website: null };
  const html = scanPage({ id: 'escAAAAAAAAAAAAAAAAAAA', input, steps: [] });
  assert.equal(html.includes('<b>pipe</b>'), false);
  assert.ok(html.includes('Asking AI to name the best &lt;b&gt;pipe&lt;/b&gt; &amp;'));
});

// ---- a real Grade: the stored input keeps the typed service ---------------------------------------------------

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startEnv(assistant) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-question-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: Date.UTC(2026, 10, 23, 18, 0, 0), now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 1000, gradeLimit: 150 });
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: assistant,
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { return { status: 404, text: '', contentType: 'text/plain' }; } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `ques${String(++n).padStart(18, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'question-token',
      gradeAiCallsPerDay: 150, gradeMainAsks: 1,
    },
  });
  cleanups.push(async () => {
    await aiBudget.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { ctx: app.locals.ctx, clock };
}

async function runGrade(env, input) {
  const id = await env.ctx.grader.start(input);
  for (let i = 0; i < 400; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (g && g.status !== 'running') break;
    await sleep(10);
  }
  return env.ctx.grader.get(id);
}

test('W1: a Grade asks the cleaned question, names the step with it, and keeps and shows the typed service', async () => {
  const calls = [];
  const claude = {
    name: 'anthropic',
    async ask({ prompt }) {
      calls.push(prompt);
      return { answer: '1. Other Co\n2. Another Co', provider: 'anthropic', model: 'stub', webSearch: true };
    },
  };
  const env = await startEnv(claude);
  const grade = await runGrade(env, { ...TALLAHASSEE, website: '' });
  assert.equal(grade.status, 'done');
  assert.equal(grade.input.service, 'Window cleaning and pressure cleaning', 'stored as typed');
  assert.deepEqual(calls, ['Who are the best window cleaning and pressure cleaning businesses in Tallahassee, FL? Name your top 5.']);
  assert.ok(grade.steps.some(s => s.name === 'Asking AI to name the best window cleaning and pressure cleaning businesses in Tallahassee'));
  const html = reportPage(grade, { now: env.clock.now() });
  assert.ok(html.includes('Window cleaning and pressure cleaning in Tallahassee, FL'), 'the report shows the typed service');
});
