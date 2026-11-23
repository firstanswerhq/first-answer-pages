/**
 * The question reads naturally (Feature F, task W1; Requirement 24, as revised by V111 to V117): the cleaned
 * service phrase, the three questions and the scan step built from it, and the typed service kept on the Grade.
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

const named = service => servicePhrase(service).named;

// ---- every row of the design's first table -------------------------------------------------------------------

const TABLE = [
  ['plumbers', 'plumbers'],
  ['Window cleaning and pressure cleaning', 'window cleaning and pressure cleaning businesses'],
  ['HVAC repair', 'HVAC repair businesses'],
  ['hair salons', 'hair salons'],
  ['Pressure washing companies', 'pressure washing companies'],
  ['roofing company', 'roofing companies'],
  ['cleaning business', 'cleaning businesses'],
  ['dentist', 'dentists'],
  ['auto glass', 'auto glass businesses'],
  ['bakery', 'bakeries'],
  ['handyman', 'handymen'],
  ['iPhone repair', 'iPhone repair businesses'],
  ['A/C repair', 'A/C repair businesses'],
  ['Mexican restaurants', 'Mexican restaurants'],
  ['Pressure Washing Companies', 'pressure washing companies'],
];

for (const [typed, phrase] of TABLE) {
  test(`W1: "${typed}" gives "${phrase}"`, () => {
    assert.deepEqual(servicePhrase(typed), { named: phrase });
  });
}

// ---- the 30 services of the W1 review, with their exact three questions (V111 to V117) -----------------------

const THIRTY = [
  ['dentist', 'dentists'],
  ['car wash', 'car washes'],
  ['CPA', 'CPAs'],
  ['DJ', 'DJs'],
  ['gym', 'gyms'],
  ['med spa', 'med spas'],
  ['daycare', 'daycares'],
  ['church', 'churches'],
  ['24 hour locksmith', '24 hour locksmiths'],
  ['bakery', 'bakeries'],
  ['law firm', 'law firms'],
  ['Roofing Company', 'roofing companies'],
  ['Mexican restaurants', 'Mexican restaurants'],
  ['Italian', 'Italian restaurants'], // V123
  ['martial arts', 'martial arts businesses'],
  ['Heating & Air', 'heating & air businesses'],
  ['a/c repair', 'A/C repair businesses'],
  ['PLUMBERS', 'plumbers'],
  ['plumbers.', 'plumbers'],
  ['Plumbers and Electricians', 'plumbers and electricians'],
  ['Window cleaning and pressure cleaning', 'window cleaning and pressure cleaning businesses'],
  ['HVAC repair', 'HVAC repair businesses'],
  ['handyman', 'handymen'],
  ['tree service', 'tree services'],
  ['pet grooming', 'pet grooming businesses'],
  ['real estate agent', 'real estate agents'],
  ['IT support', 'IT support businesses'],
  ['Thai food', 'Thai restaurants'], // V123
  ['nail salon', 'nail salons'],
  ['photographer', 'photographers'],
];

const TALLAHASSEE = { name: 'Capital City Window & Pressure Cleaning', city: 'Tallahassee', state: 'FL', service: 'Window cleaning and pressure cleaning', website: null };

test('V111-V117: the 30 services give their exact three questions', () => {
  assert.equal(THIRTY.length, 30);
  for (const [service, phrase] of THIRTY) {
    const input = { ...TALLAHASSEE, service };
    assert.deepEqual([freeQuestion(input), ...extraQuestions(input)], [
      `Who are the best ${phrase} in Tallahassee, FL? Name your top 5.`,
      `I'm looking for ${phrase} in Tallahassee, FL. Which ones would you recommend?`,
      `Which ${phrase} in Tallahassee, FL do people recommend most?`,
    ], service);
  }
  // The note's example, word for word.
  const dentist = { ...TALLAHASSEE, service: 'dentist' };
  assert.deepEqual([freeQuestion(dentist), ...extraQuestions(dentist)], [
    'Who are the best dentists in Tallahassee, FL? Name your top 5.',
    "I'm looking for dentists in Tallahassee, FL. Which ones would you recommend?",
    'Which dentists in Tallahassee, FL do people recommend most?',
  ]);
});

// ---- capitals (V115) -----------------------------------------------------------------------------------------

test('W1: the first letter is made lower case unless the first word keeps its capitals', () => {
  assert.equal(named('Window cleaning'), 'window cleaning businesses');
  assert.equal(named('A/C repair'), 'A/C repair businesses', 'a slash');
  assert.equal(named('HVAC repair'), 'HVAC repair businesses', '4 letters');
  assert.equal(named('iPhone repair'), 'iPhone repair businesses', 'a capital inside it');
  for (const word of ['Mexican', 'Italian', 'Chinese', 'Thai', 'Japanese', 'Indian', 'Greek', 'French', 'Korean',
    'Vietnamese', 'Cuban', 'Cajun', 'Caribbean', 'Mediterranean', 'American', 'Spanish', 'German', 'Irish']) {
    assert.equal(named(`${word} restaurants`), `${word} restaurants`, word);
  }
});

test('V115: all-capitals words of 5 or more letters are lowered; shorter ones and ones with marks are kept', () => {
  assert.equal(named('PLUMBERS'), 'plumbers');
  assert.equal(named('ROOFING'), 'roofing businesses');
  assert.equal(named('ELECTRICIANS'), 'electricians');
  for (const [typed, phrase] of [['HVAC', 'HVAC businesses'], ['A/C', 'A/C businesses'], ['CPA', 'CPAs'], ['DJ', 'DJs'],
    ['IT support', 'IT support businesses'], ['BBQ', 'BBQ restaurants'], ['RV park', 'RV parks'], ['B&B', 'B&B businesses'],
    ['BBQ catering', 'BBQ catering businesses'], ['A1 TOWING', 'A1 towing businesses']]) { // BBQ: V123; A1 TOWING: V126
    assert.equal(named(typed), phrase, typed);
  }
});

test('V115: a phrase in Title Case is lowered word by word, except the words that keep their capitals', () => {
  assert.equal(named('Plumbers and Electricians'), 'plumbers and electricians');
  assert.equal(named('Heating & Air'), 'heating & air businesses');
  assert.equal(named('Mobile Detailing'), 'mobile detailing businesses');
  assert.equal(named('Pressure Washing Companies'), 'pressure washing companies');
  assert.equal(named('Mexican Restaurants'), 'Mexican restaurants');
  assert.equal(named('HVAC Repair Shop'), 'HVAC repair shops');
});

test('V115: a fixed list of abbreviations typed in lower case is raised', () => {
  for (const [typed, phrase] of [['a/c repair', 'A/C repair businesses'], ['hvac repair', 'HVAC repair businesses'],
    ['cpa', 'CPAs'], ['cpas', 'CPAs'], ['dj', 'DJs'], ['djs', 'DJs'], ['bbq', 'BBQ restaurants'], ['rv park', 'RV parks'], // bbq: V123
    ['it support', 'IT support businesses'], ['it services', 'IT services']]) {
    assert.equal(named(typed), phrase, typed);
  }
  // "it" is raised only as the first word before "support" or "services".
  assert.equal(named('fix it shop'), 'fix it shops');
  assert.equal(named('it repair'), 'it repair businesses');
});

test('W1: the owner\'s other words are kept as typed; "24 hour" and "Dr." are left as typed', () => {
  assert.equal(named('window cleaning in Downtown'), 'window cleaning in Downtown businesses');
  assert.equal(named('Tree removal and Stump grinding'), 'tree removal and Stump grinding businesses');
  assert.equal(named('24 hour plumber'), '24 hour plumbers');
  assert.equal(named('dentist Dr. Lee office'), 'dentist Dr. Lee offices');
});

// ---- spaces and punctuation (V116) ----------------------------------------------------------------------------

test('W1: spaces are trimmed and collapsed', () => {
  assert.deepEqual(servicePhrase('  hair    salons  '), { named: 'hair salons' });
  assert.deepEqual(servicePhrase('\tauto \n glass '), { named: 'auto glass businesses' });
});

test('V116: trailing punctuation is removed; "A/C" and "B&B" are untouched', () => {
  for (const typed of ['plumbers.', 'plumbers,', 'plumbers!', 'plumbers?', 'plumbers:', 'plumbers;', 'plumbers...', 'plumbers. ']) {
    assert.equal(named(typed), 'plumbers', typed);
  }
  assert.equal(named('dentist.'), 'dentists');
  assert.equal(named('A/C'), 'A/C businesses');
  assert.equal(named('B&B'), 'B&B businesses');
});

// ---- the last word (V112 to V114) ------------------------------------------------------------------------------

test('W1: "water heater", "garage door" and "computer" are not made plural by a general rule', () => {
  assert.equal(named('water heater'), 'water heater businesses');
  assert.equal(named('garage door'), 'garage door businesses');
  assert.equal(named('computer'), 'computer businesses');
});

test('V112: a nationality, cuisine or other "-ian" word is never given a plural "s"', () => {
  // None of them is ever made plural. A cuisine word last gets " restaurants" (V122, V123); "vegetarian" is not a
  // cuisine word and gets " businesses".
  for (const word of ['Italian', 'Indian', 'Asian', 'Hawaiian', 'Brazilian', 'vegetarian', 'Mexican', 'Thai']) {
    assert.equal(named(word).toLowerCase().includes(`${word.toLowerCase()}s`), false, word);
  }
  assert.equal(named('vegetarian'), 'vegetarian businesses');
  for (const word of ['Italian', 'Indian', 'Asian', 'Hawaiian', 'Brazilian', 'Mexican', 'Thai']) assert.equal(named(word), `${word} restaurants`, word);
  assert.equal(named('Italian restaurants'), 'Italian restaurants');
  for (const word of ['electrician', 'technician', 'beautician', 'optician', 'veterinarian', 'pediatrician', 'dietitian',
    'librarian', 'guardian']) {
    assert.equal(named(word), `${word}s`, word);
  }
});

test('V113: last words that end in "s" but are not plurals get "businesses"', () => {
  for (const word of ['arts', 'gas', 'bus', 'lens', 'glass', 'fitness', 'wellness', 'logistics', 'analytics',
    'electronics', 'cosmetics', 'aesthetics', 'graphics', 'news', 'sales']) {
    assert.equal(named(word), `${word} businesses`, word);
  }
  assert.equal(named('martial arts'), 'martial arts businesses');
  assert.equal(named('car rentals'), 'car rentals', 'a plural stays');
  assert.equal(named('tree services'), 'tree services', 'a plural stays');
});

test('V114: the fixed lists for "s", "es" and "ies", and capitals follow the word', () => {
  for (const word of ['contractor', 'shop', 'service', 'crew', 'store', 'salon', 'studio', 'clinic', 'restaurant',
    'cafe', 'firm', 'lawyer', 'doctor', 'plumber', 'roofer', 'painter', 'cleaner', 'landscaper', 'mechanic', 'barber',
    'photographer', 'realtor', 'agent', 'groomer', 'inspector', 'attorney', 'locksmith', 'chiropractor', 'tutor',
    'tailor', 'jeweler', 'bookkeeper', 'vet', 'trainer', 'walker', 'builder', 'gym', 'spa', 'bar', 'hotel', 'motel',
    'daycare', 'preschool', 'boutique', 'barbershop', 'place', 'truck', 'home', 'school', 'park', 'diner', 'pub',
    'mover', 'caterer', 'office', 'center', 'garage', 'dealership', 'florist', 'therapist', 'dentist']) {
    assert.equal(named(word), `${word}s`, word);
  }
  for (const [typed, phrase] of [['dog walker', 'dog walkers'], ['dog trainer', 'dog trainers'],
    ['personal trainer', 'personal trainers'], ['home builder', 'home builders'], ['pizza place', 'pizza places'],
    ['food truck', 'food trucks'], ['funeral home', 'funeral homes'], ['driving school', 'driving schools'],
    ['RV park', 'RV parks'], ['cleaning crew', 'cleaning crews'], ['repair shop', 'repair shops']]) {
    assert.equal(named(typed), phrase, typed);
  }
  for (const [typed, phrase] of [['church', 'churches'], ['car wash', 'car washes'], ['coach', 'coaches']]) {
    assert.equal(named(typed), phrase, typed);
  }
  for (const [typed, phrase] of [['company', 'companies'], ['agency', 'agencies'], ['bakery', 'bakeries'],
    ['brewery', 'breweries'], ['winery', 'wineries'], ['notary', 'notaries'], ['pharmacy', 'pharmacies'],
    ['nursery', 'nurseries'], ['laundry', 'laundries'], ['grocery store', 'grocery stores'], ['distillery', 'distilleries'], // grocery: V124
    ['creamery', 'creameries']]) {
    assert.equal(named(typed), phrase, typed);
  }
  assert.equal(named('handyman'), 'handymen');
  assert.equal(named('cleaning business'), 'cleaning businesses');
  assert.equal(named('CPA'), 'CPAs');
  assert.equal(named('DJ'), 'DJs');
  assert.equal(named('travel agency'), 'travel agencies');
  assert.equal(named('divorce attorney'), 'divorce attorneys');
});

// ---- the three questions and the scan step -------------------------------------------------------------------

test('V111: all three questions and the scan step use the named phrase', () => {
  assert.equal(freeQuestion(TALLAHASSEE), 'Who are the best window cleaning and pressure cleaning businesses in Tallahassee, FL? Name your top 5.');
  assert.deepEqual(extraQuestions(TALLAHASSEE), [
    "I'm looking for window cleaning and pressure cleaning businesses in Tallahassee, FL. Which ones would you recommend?",
    'Which window cleaning and pressure cleaning businesses in Tallahassee, FL do people recommend most?',
  ]);
  assert.equal(stepNames(TALLAHASSEE)[3], 'Asking AI to name the best window cleaning and pressure cleaning businesses in Tallahassee');
});

test('W1: already clean services give exactly today\'s free question and scan step; the extra questions read as V111', () => {
  for (const service of ['plumbers', 'roofers', 'accountants']) {
    const input = { name: 'Zephyr', city: 'Nashville', state: 'TN', service, website: null };
    assert.equal(freeQuestion(input), `Who are the best ${service} in Nashville, TN? Name your top 5.`);
    assert.deepEqual(extraQuestions(input), [
      `I'm looking for ${service} in Nashville, TN. Which ones would you recommend?`,
      `Which ${service} in Nashville, TN do people recommend most?`,
    ]);
    assert.equal(stepNames(input)[3], `Asking AI to name the best ${service} in Nashville`);
  }
});

// ---- N2 (E2 code review) and V117: a repeat check typed differently asks the same questions -------------------

const questionsFor = service => {
  const input = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service, website: null };
  return [freeQuestion(input), ...extraQuestions(input)];
};

test('N2/V117: "Plumbers", "plumbers", " plumbers ", "PLUMBERS" and "plumbers." give exactly the same three questions', () => {
  const today = questionsFor('plumbers');
  for (const service of ['Plumbers', ' plumbers ', 'PLUMBERS', 'plumbers.']) {
    assert.deepEqual(questionsFor(service), today, JSON.stringify(service));
  }
});

test('V117: "ROOFING" and "Plumbers and Electricians" come out in lower case; HVAC, A/C, CPA, DJ, IT support and BBQ keep their capitals', () => {
  assert.equal(named('ROOFING'), 'roofing businesses');
  assert.equal(named('Plumbers and Electricians'), 'plumbers and electricians');
  assert.ok(named('HVAC').startsWith('HVAC'));
  assert.ok(named('A/C').startsWith('A/C'));
  assert.ok(named('CPA').startsWith('CPA'));
  assert.ok(named('DJ').startsWith('DJ'));
  assert.ok(named('IT support').startsWith('IT support'));
  assert.ok(named('BBQ').startsWith('BBQ'));
});

// ---- V119 to V124 (review of V111 to V118) --------------------------------------------------------------------

const CUISINE = ['Mexican', 'Italian', 'Chinese', 'Thai', 'Japanese', 'Indian', 'Greek', 'French', 'Korean', 'Vietnamese',
  'Cuban', 'Cajun', 'Caribbean', 'Mediterranean', 'American', 'Spanish', 'German', 'Irish', 'Asian', 'Hawaiian',
  'Brazilian', 'Ethiopian', 'Lebanese', 'Turkish', 'Peruvian', 'Tex-Mex'];

const V119_V124 = [
  // V119: a plural abbreviation typed in capitals.
  ['CPAs', 'CPAs'], ['cpas', 'CPAs'], ['Cpas', 'CPAs'], ['DJs', 'DJs'], ['djs', 'DJs'], ['Djs', 'DJs'],
  ['RVs', 'RVs'], ['rvs', 'RVs'], ['B&Bs', 'B&Bs'], ['b&bs', 'B&Bs'], ['wedding DJs', 'wedding DJs'], ['tax CPAs', 'tax CPAs'],
  // V120: joining words are always lower case.
  ['PLUMBERS AND ELECTRICIANS', 'plumbers and electricians'], ['Plumbers AND Electricians', 'plumbers and electricians'],
  ['heating OR cooling', 'heating or cooling businesses'], ['Doctors Of Chiropractic', 'doctors of chiropractic businesses'],
  // V121: a phrase of two or more words typed all in capitals.
  ['LAWN CARE', 'lawn care businesses'], ['HVAC REPAIR', 'HVAC repair businesses'], ['MEXICAN RESTAURANT', 'Mexican restaurants'],
  ['IT SUPPORT', 'IT support businesses'], ['CPA FIRM', 'CPA firms'], ['ROOF REPAIR', 'roof repair businesses'],
  // A single all-capitals word keeps the 4-letters-or-fewer rule.
  ['HVAC', 'HVAC businesses'], ['CPA', 'CPAs'], ['BBQ', 'BBQ restaurants'], ['PLUMBERS', 'plumbers'],
  // V122: keep-capital words get their capital whatever was typed.
  ['mexican restaurants', 'Mexican restaurants'], ['MEXICAN RESTAURANTS', 'Mexican restaurants'], ['asian restaurants', 'Asian restaurants'],
  ['tex-mex restaurants', 'Tex-Mex restaurants'], ['TEX-MEX', 'Tex-Mex restaurants'],
  // V123: food typed without "restaurant".
  ['Italian', 'Italian restaurants'], ['authentic Thai', 'authentic Thai restaurants'], ['Thai food', 'Thai restaurants'],
  ['Mexican food', 'Mexican restaurants'], ['italian food', 'Italian restaurants'], ['BBQ', 'BBQ restaurants'],
  ['barbecue', 'barbecue restaurants'], ['sushi', 'sushi restaurants'], ['seafood', 'seafood restaurants'],
  ['tacos', 'taco restaurants'], ['burgers', 'burger restaurants'], ['wings', 'wing restaurants'], // V125
  ['taco', 'taco restaurants'], ['burger', 'burger restaurants'], ['wing', 'wing restaurants'],
  ['best tacos', 'best taco restaurants'], ['Tacos', 'taco restaurants'],
  // V126: a word that holds a digit keeps its capitals in a phrase typed all in capitals.
  ['A1 TOWING', 'A1 towing businesses'], ['24 HOUR LOCKSMITH', '24 hour locksmiths'], ['A1', 'A1 businesses'], ['a1 towing', 'a1 towing businesses'],
  // V127: any phrase ending in "food" without a cuisine word before it adds " restaurants".
  ['soul food', 'soul food restaurants'], ['health food', 'health food restaurants'], ['FAST FOOD', 'fast food restaurants'],
  ['ramen', 'ramen restaurants'], ['pho', 'pho restaurants'], ['steak', 'steak restaurants'], ['pizza', 'pizza places'],
  ['Bar & Grill', 'bar and grill restaurants'], ['bar and grill', 'bar and grill restaurants'],
  ['fast food', 'fast food restaurants'], ['pizza place', 'pizza places'], // fast food: V127
  // V124: grocery.
  ['grocery', 'grocery businesses'], ['grocery store', 'grocery stores'],
];

test('V119-V124: every case gives its phrase', () => {
  for (const [typed, phrase] of V119_V124) assert.equal(named(typed), phrase, typed);
});

test('V122: every keep-capital word gets its capital, typed in lower case, in capitals or as a cuisine on its own', () => {
  for (const word of CUISINE) {
    assert.equal(named(`${word.toLowerCase()} restaurants`), `${word} restaurants`, word);
    assert.equal(named(`${word.toUpperCase()} RESTAURANTS`), `${word} restaurants`, word);
    assert.equal(named(word.toLowerCase()), `${word} restaurants`, word);
    assert.equal(named(`${word.toLowerCase()} food`), `${word} restaurants`, word);
  }
});

test('V119-V124: the three questions for a few of the new cases', () => {
  for (const [service, phrase] of [['CPAs', 'CPAs'], ['LAWN CARE', 'lawn care businesses'], ['Thai food', 'Thai restaurants'], ['pizza', 'pizza places']]) {
    const input = { ...TALLAHASSEE, service };
    assert.deepEqual([freeQuestion(input), ...extraQuestions(input)], [
      `Who are the best ${phrase} in Tallahassee, FL? Name your top 5.`,
      `I'm looking for ${phrase} in Tallahassee, FL. Which ones would you recommend?`,
      `Which ${phrase} in Tallahassee, FL do people recommend most?`,
    ], service);
  }
});

// ---- odd input -------------------------------------------------------------------------------------------------

test('W1: servicePhrase never throws on odd input', () => {
  const odd = ['', '   ', '!!!', '...', '&<>"\'', '🔧🔧', 'plumbers 🔧', '\u0000x', 'x'.repeat(10000), 'ÉLECTRICIENS', 'ß',
    '\ud800', 'IT', 'it', 'a b c d e f g h i j k l m n o p'.repeat(50), null, undefined, 42, {}, [], Symbol('s')];
  for (const value of odd) {
    let out;
    assert.doesNotThrow(() => { out = servicePhrase(value); }, String(typeof value));
    assert.equal(typeof out.named, 'string');
    assert.equal(Object.hasOwn(out, 'plain'), false, 'one form only (V111)');
  }
  assert.deepEqual(servicePhrase(''), { named: '' });
  assert.deepEqual(servicePhrase(null), { named: '' });
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
