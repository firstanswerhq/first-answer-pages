/**
 * Tests for the Grader's lead gate and unlock, claim the free page, check again,
 * admin pages, and the lead notifier. Same setup as grade-flow.test.js: the real
 * safe fetcher on a fake transport, the mock or a stub AI, and a fake clock.
 */

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createSafeFetcher } from '../server/lib/safe-fetch.js';
import { hoursToObject } from '../server/lib/grader.js';
import { createResendNotifier, createConsoleNotifier } from '../server/lib/notifier.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/grade/', import.meta.url));
const EXPECTED = JSON.parse(await fs.readFile(path.join(FIXTURES, 'expected.json'), 'utf8'));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);
const ADMIN = 'grade-admin-test-token';

const realHttp = http.request;
const realHttps = https.request;
before(() => {
  http.request = () => { throw new Error('real http.request called'); };
  https.request = () => { throw new Error('real https.request called'); };
});
after(() => {
  http.request = realHttp;
  https.request = realHttps;
});

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

// ---- fake websites (same as grade-flow.test.js) ------------------------------------

const SITES = {};
for (const exp of Object.values(EXPECTED)) {
  SITES[new URL(exp.input.website).hostname] = { exp, html: await fs.readFile(path.join(FIXTURES, exp.file), 'utf8') };
}

function routeFor(href) {
  const u = new URL(href);
  const site = SITES[u.hostname];
  if (!site) return { status: 404, headers: {}, body: Buffer.alloc(0) };
  if (u.pathname === '/') {
    return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(site.html) };
  }
  const file = u.pathname === '/robots.txt' ? site.exp.robots : u.pathname === '/llms.txt' ? site.exp.llms : null;
  if (!file || file.status !== 200) return { status: file?.status ?? 404, headers: {}, body: Buffer.alloc(0) };
  return { status: 200, headers: { 'content-type': file.contentType ?? 'text/plain' }, body: Buffer.from(file.text) };
}

function fixtureFetcher() {
  const fn = (url, opts, cb) => {
    const u = new URL(url);
    const req = new EventEmitter();
    req.end = () => {
      opts.lookup(u.hostname, { all: true }, (err) => {
        if (err) return req.emit('error', err);
        const route = routeFor(u.href);
        const res = Readable.from([route.body]);
        res.statusCode = route.status;
        res.headers = route.headers;
        return cb(res);
      });
    };
    return req;
  };
  return createSafeFetcher({
    request: { http: fn, https: fn },
    lookup: (host, opts, cb) => setImmediate(() => cb(null, [{ address: '93.184.216.34', family: 4 }])),
  });
}

// ---- environment ---------------------------------------------------------------------

async function startEnv({ assistantProvider, extraAssistants, googleLive, nameChecker, dataDir, idStart = 0, config = {} } = {}) {
  const dir = dataDir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-lead-'));
  if (!dataDir) {
    for (const name of ['listings.json', 'categories.json']) {
      await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
    }
  }
  const clock = { t: START, now() { return this.t; } };
  let n = idStart;
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider,
    extraAssistants,
    ...(googleLive !== undefined && { googleLive }),
    ...(nameChecker !== undefined && { nameChecker }),
    safeFetcher: fixtureFetcher(),
    newGradeId: () => `grade${String(++n).padStart(17, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: ADMIN, ...config,
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
    await app.locals.ctx.aiBudget?.flush?.();
    // A report view can leave a background AI question still saving; retry instead of failing the cleanup.
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { dir, clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });
const post = (env, p, fields = {}, headers = {}) => fetch(env.base + p, {
  method: 'POST', redirect: 'manual', headers, body: new URLSearchParams(fields),
});

/** Start a Grade and also return the cookie the requesting browser got. */
async function startGradeWithCookie(env, input) {
  const html = await (await get(env, '/grade')).text();
  const t = /name="t" value="([^"]+)"/.exec(html)[1];
  env.clock.t += 5000;
  const res = await post(env, '/grade', {
    nickname: '', t, name: input.name, city: input.city, state: input.state, service: input.service, website: input.website ?? '',
  });
  const id = /^\/grade\/([A-Za-z0-9_-]{22})$/.exec(res.headers.get('location'))[1];
  const cookie = cookieOf(res);
  for (let i = 0; i < 300; i += 1) {
    const status = await (await get(env, `/grade/${id}/status.json`)).json();
    if (status.done) return { id, cookie };
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('grade did not finish');
}

async function startGrade(env, input) {
  const html = await (await get(env, '/grade')).text();
  const t = /name="t" value="([^"]+)"/.exec(html)[1];
  env.clock.t += 5000;
  const res = await post(env, '/grade', {
    nickname: '', t, name: input.name, city: input.city, state: input.state, service: input.service, website: input.website ?? '',
  });
  assert.equal(res.status, 303);
  const id = /^\/grade\/([A-Za-z0-9_-]{22})$/.exec(res.headers.get('location'))[1];
  for (let i = 0; i < 300; i += 1) {
    const status = await (await get(env, `/grade/${id}/status.json`)).json();
    if (status.done) return id;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('grade did not finish');
}

async function readJson(env, name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function until(fn, label) {
  for (let i = 0; i < 300; i += 1) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

const cookieOf = res => (res.headers.get('set-cookie') ?? '').split(';')[0];

const NO_SITE = { name: 'Ace Accounting', city: 'Nashville', state: 'TN', service: 'accountants', website: '' };
const LEAD = { name: 'Pat Example', email: 'pat@example.com', phone: '(615) 555-0100', okToContact: '1' };

function stubAssistant(answer) {
  const stub = {
    name: 'anthropic',
    calls: 0,
    async ask() {
      stub.calls += 1;
      return { answer, provider: 'anthropic', model: 'stub-model', webSearch: true };
    },
  };
  return stub;
}

// ---- lead form and unlock -------------------------------------------------------------

test('gate on: the report shows the Lead_Form; a valid form stores one Lead, sets the cookie and opens the report', async () => {
  const assistant = stubAssistant('1. Other Co\n2. Another Co');
  const env = await startEnv({ assistantProvider: assistant });
  const id = await startGrade(env, NO_SITE);

  const locked = await (await get(env, `/grade/${id}`)).text();
  assert.ok(locked.includes('See every check and the fixes'));
  assert.ok(locked.includes(`action="/grade/${id}/unlock"`));
  assert.equal(locked.includes('Your fix kit'), false);
  assert.ok(locked.includes('OK for First Answer Pages to call, text or email me about my report'));
  assert.equal(assistant.calls, 1, 'the extra questions wait for the form');

  const bad = await post(env, `/grade/${id}/unlock`, { name: '', email: 'nope', phone: '12' });
  assert.equal(bad.status, 422);
  const badHtml = await bad.text();
  assert.ok(badHtml.includes('Type your name.'));
  assert.ok(badHtml.includes('Type a real email address'));
  assert.ok(badHtml.includes('Type a 10-digit phone number'));
  assert.deepEqual(await readJson(env, 'leads.json', []), []);
  // The form says something went wrong, and the cursor goes to the first bad field only.
  assert.ok(badHtml.includes('Please fix the highlighted fields.'));
  assert.equal(badHtml.split(' autofocus').length - 1, 1);
  assert.match(badHtml, /id="l-name"[^>]* aria-invalid="true" aria-describedby="l-err-name"[^>]* autofocus/);
  assert.ok(badHtml.includes('id="l-err-phone"'));

  const ok = await post(env, `/grade/${id}/unlock`, LEAD);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `/grade/${id}?opened=1#full-report`);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, new RegExp(`^g_${id}=`));
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, new RegExp(`Path=/grade/${id}`));

  const leads = await readJson(env, 'leads.json', []);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].gradeId, id);
  assert.equal(leads[0].business, 'Ace Accounting');
  assert.equal(leads[0].email, 'pat@example.com');
  assert.equal(leads[0].phone, '(615) 555-0100');
  assert.equal(leads[0].okToContact, true);

  const notice = env.ctx.notifier.leads;
  assert.equal(notice.length, 1);
  assert.equal(notice[0].business, 'Ace Accounting');
  assert.equal(notice[0].reportUrl, `http://example.test/grade/${id}`);
  assert.equal(notice[0].lead.email, 'pat@example.com');

  const cookie = cookieOf(ok);
  // The "report is open" note shows once: only with ?opened=1 and the unlock cookie.
  const NOTE = 'Your full report is open.';
  assert.ok((await (await get(env, `/grade/${id}?opened=1`, { cookie })).text()).includes(NOTE));
  assert.equal((await (await get(env, `/grade/${id}`, { cookie })).text()).includes(NOTE), false);
  assert.equal((await (await get(env, `/grade/${id}?opened=1`)).text()).includes(NOTE), false);
  const open = await (await get(env, `/grade/${id}`, { cookie })).text();
  assert.ok(open.includes('Your fix kit'));
  assert.equal(open.includes('Check again'), false, 'nothing to read again without a website');
  assert.ok(open.includes('You did not give a website'));
  const stillLocked = await (await get(env, `/grade/${id}`)).text();
  assert.equal(stillLocked.includes('Your fix kit'), false, 'another visitor still sees the form');

  // Sending the form again from the same browser stores no second Lead.
  const again = await post(env, `/grade/${id}/unlock`, LEAD, { cookie });
  assert.equal(again.status, 303);
  assert.equal((await readJson(env, 'leads.json', [])).length, 1);

  // The two extra AI questions run in the background and the Score uses all three answers.
  const grade = await until(async () => {
    const g = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
    return g.ai.length === 3 ? g : null;
  }, 'the extra AI answers');
  assert.equal(assistant.calls, 3);
  assert.ok(grade.extraAiStartedAt);
  assert.match(grade.results.find(r => r.id === 'ai-named').detail, /Claude did not name your business in any of 3 answers/);
  const after = await (await get(env, `/grade/${id}`, { cookie })).text();
  assert.ok(after.includes('Named in 0 of 3 answers.'));
});

test('a forged unlock cookie does not open the report', async () => {
  const env = await startEnv();
  const id = await startGrade(env, NO_SITE);
  const html = await (await get(env, `/grade/${id}`, { cookie: `g_${id}=${'0'.repeat(64)}` })).text();
  assert.equal(html.includes('Your fix kit'), false);
});

test('gate off: everyone sees the full report and the first view starts the extra AI questions once', async () => {
  const assistant = stubAssistant('1. Other Co\n2. Another Co');
  const env = await startEnv({ assistantProvider: assistant, config: { graderLeadGate: false } });
  const id = await startGrade(env, NO_SITE);
  const html = await (await get(env, `/grade/${id}`)).text();
  assert.ok(html.includes('Your fix kit'));
  await get(env, `/grade/${id}`);
  await until(async () => (await readJson(env, 'grades.json', [])).find(x => x.id === id).ai.length === 3, 'extra answers');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(assistant.calls, 3, 'asked once each, never twice');
});

// ---- claim the free page ---------------------------------------------------------------

test('claim: one Draft per browser, filled from the scan, not published, other visitors get their own', async () => {
  const exp = EXPECTED.roofer;
  const env = await startEnv({ config: { graderLeadGate: false } });
  const id = await startGrade(env, exp.input);

  const first = await post(env, `/grade/${id}/claim`);
  assert.equal(first.status, 303);
  const where = first.headers.get('location');
  assert.match(where, /^\/rise\/drafts\/[^/]+$/);
  assert.match(first.headers.get('set-cookie'), new RegExp(`^gc_${id}=`));

  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts.length, 1);
  const draft = drafts[0];
  assert.equal(draft.status, 'draft');
  assert.equal(draft.provider, 'grader');
  assert.equal(draft.fields.name, 'Ridgeline Roofing LLC');
  assert.equal(draft.fields.phone, '(615) 555-0142');
  assert.equal(draft.fields.category, 'roofers');
  assert.deepEqual(draft.fields.services, ['roofers']);
  assert.equal(draft.fields.city, 'Nashville');
  assert.equal(draft.fields.state, 'TN');
  assert.equal(draft.fields.ownerEmail, '', 'no email is filled in');
  assert.ok(draft.missingFields.includes('description'));
  assert.equal(draft.missingFields.includes('phone'), false);
  assert.equal((await readJson(env, 'grades.json', []))[0].draftId, draft.id);
  assert.deepEqual(await readJson(env, 'published.json', []), [], 'nothing is published');
  assert.deepEqual(await readJson(env, 'pending.json', []), [], 'nothing is sent for review');

  const page = await get(env, where);
  assert.equal(page.status, 200);
  await page.arrayBuffer();

  // The same browser claims again: back to the same Draft.
  const cookie = cookieOf(first);
  const again = await post(env, `/grade/${id}/claim`, {}, { cookie });
  assert.equal(again.headers.get('location'), where);
  assert.equal((await readJson(env, 'drafts.json', [])).length, 1);

  // A different visitor gets a new Draft, never this one.
  const other = await post(env, `/grade/${id}/claim`);
  assert.notEqual(other.headers.get('location'), where);
  assert.equal((await readJson(env, 'drafts.json', [])).length, 2);

  assert.equal((await post(env, `/grade/${'A'.repeat(22)}/claim`)).status, 404);
});

test('claim fills address, phone and hours from a business label', async () => {
  const env = await startEnv({ config: { graderLeadGate: false } });
  const id = await startGrade(env, EXPECTED.largeCompany.input);
  assert.equal((await post(env, `/grade/${id}/claim`)).status, 303);
  const [draft] = await readJson(env, 'drafts.json', []);
  assert.equal(draft.fields.category, 'hvac');
  assert.equal(draft.fields.phone, '(615) 555-0188');
  assert.equal(draft.fields.address, '400 Church Street, Franklin, TN, 37064');
  assert.equal(draft.fields.hours.monday, '07:00-18:00');
  assert.equal(draft.fields.hours.friday, '07:00-18:00');
  assert.equal(draft.fields.hours.saturday, undefined);
  assert.equal(draft.missingFields.includes('phone'), false);
});

test('hoursToObject reads day lists, ranges and codes; anything else is left out', () => {
  assert.deepEqual(hoursToObject(['Mo-Fr 08:00-17:00']), {
    monday: '08:00-17:00', tuesday: '08:00-17:00', wednesday: '08:00-17:00', thursday: '08:00-17:00', friday: '08:00-17:00',
  });
  assert.deepEqual(hoursToObject(['Monday, Wednesday 9am-5pm', 'Sat 10:00-14:00']), {
    monday: '9am-5pm', wednesday: '9am-5pm', saturday: '10:00-14:00',
  });
  assert.deepEqual(hoursToObject(['Call for hours', '', 'Mo-Fr']), {});
  assert.deepEqual(hoursToObject(undefined), {});
});

// ---- check again ---------------------------------------------------------------------------

test('check again: website checks run again, AI results stay, the old score is kept, and it is limited', async () => {
  const exp = EXPECTED.largeCompany;
  const env = await startEnv({ config: { graderLeadGate: false } });
  const id = await startGrade(env, exp.input);
  const first = (await readJson(env, 'grades.json', []))[0];
  assert.equal(first.score.score, exp.score.score);

  const res = await post(env, `/grade/${id}/recheck`);
  assert.equal(res.status, 303);
  const grade = await until(async () => {
    const g = (await readJson(env, 'grades.json', []))[0];
    return g.recheckedAt ? g : null;
  }, 'the recheck');
  assert.equal(grade.status, 'done', 'a recheck never sets the Grade back to running');
  assert.equal(grade.recheckRunning, false);
  assert.equal(grade.previousScore, exp.score.score);
  assert.equal(grade.score.score, exp.score.score);
  assert.equal(grade.steps.length, first.steps.length, 'no new Scan_Steps');
  assert.deepEqual(grade.ai, first.ai, 'the AI answers are kept');
  assert.deepEqual(
    Object.fromEntries(grade.results.map(r => [r.id, r.result])),
    exp.results,
  );

  const limited = await post(env, `/grade/${id}/recheck`);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  await limited.arrayBuffer();

  env.clock.t += 3 * 60 * 1000;
  assert.equal((await post(env, `/grade/${id}/recheck`)).status, 303);
  // Let the second recheck finish before the test ends.
  await until(async () => {
    const g = (await readJson(env, 'grades.json', []))[0];
    return g.recheckRunning === false && g.recheckedAt !== grade.recheckedAt;
  }, 'the second recheck');
});

test('check again needs the full report: with the gate on and no cookie nothing is rechecked', async () => {
  const env = await startEnv();
  const id = await startGrade(env, NO_SITE);
  const res = await post(env, `/grade/${id}/recheck`);
  assert.equal(res.status, 303);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await readJson(env, 'grades.json', []))[0].recheckedAt, null);
});

// ---- admin ---------------------------------------------------------------------------------------

test('admin: grades and leads need the admin token; delete removes the Grade, its Lead and the report', async () => {
  const env = await startEnv();
  const id = await startGrade(env, NO_SITE);
  const unlock = await post(env, `/grade/${id}/unlock`, LEAD);
  assert.equal(unlock.status, 303);

  for (const p of ['/admin/grades', '/admin/leads']) {
    assert.equal((await get(env, p)).status, 401, `${p} without a token`);
  }
  const bearer = { authorization: `Bearer ${ADMIN}` };

  const grades = await get(env, '/admin/grades', { ...bearer, accept: 'text/html' });
  assert.equal(grades.status, 200);
  const gradesHtml = await grades.text();
  assert.ok(gradesHtml.includes('Ace Accounting'));
  assert.ok(gradesHtml.includes('Lead: yes'));
  assert.ok(gradesHtml.includes(`/admin/grades/${id}/delete`));

  const leadsHtml = await (await get(env, '/admin/leads', { ...bearer, accept: 'text/html' })).text();
  assert.ok(leadsHtml.includes('pat@example.com'));
  assert.ok(leadsHtml.includes('(615) 555-0100'));

  const del = await post(env, `/admin/grades/${id}/delete`, {}, bearer);
  assert.equal(del.status, 200);
  assert.deepEqual(await del.json(), { ok: true });
  assert.equal((await get(env, `/grade/${id}`)).status, 404);
  assert.deepEqual(await readJson(env, 'leads.json', []), []);
  assert.equal((await post(env, `/admin/grades/${id}/delete`, {}, bearer)).status, 404);
});

// ---- notifier ---------------------------------------------------------------------------------------

test('Resend lead email goes to the admin only and never throws', async () => {
  const sent = [];
  const notifier = createResendNotifier({
    apiKey: 'key', from: 'Grader <g@example.com>', adminEmail: 'admin@example.com',
    fetch: async (url, init) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 200 };
    },
  });
  const result = await notifier.notifyLead({
    business: 'Ace Accounting', score: 42, reportUrl: 'http://example.test/grade/x', lead: LEAD,
  });
  assert.deepEqual(result, { notifier: 'resend', sent: true });
  assert.deepEqual(sent[0].to, ['admin@example.com']);
  assert.equal(sent[0].subject, 'New grader lead: Ace Accounting');
  assert.ok(sent[0].text.includes('pat@example.com'));
  assert.ok(sent[0].text.includes('http://example.test/grade/x'));
  assert.equal(JSON.stringify(result).includes('key'), false);

  const broken = createResendNotifier({
    apiKey: 'key', from: 'g@example.com', adminEmail: 'admin@example.com',
    fetch: async () => { throw new Error('network down'); },
  });
  const failed = await broken.notifyLead({ business: 'X', score: null, reportUrl: 'u', lead: LEAD });
  assert.equal(failed.sent, false);
});

test('the console lead notice has the business, score and link, and never the visitor details', async () => {
  const lines = [];
  const notifier = createConsoleNotifier({ write: line => lines.push(line) });
  await notifier.notifyLead({ business: 'Ace Accounting', score: 42, reportUrl: 'http://example.test/grade/x', lead: LEAD });
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('Ace Accounting'));
  assert.ok(lines[0].includes('http://example.test/grade/x'));
  for (const secret of ['pat@example.com', '(615) 555-0100', 'Pat Example']) {
    assert.equal(lines[0].includes(secret), false);
  }
});

// ---- ChatGPT as a second opinion -----------------------------------------------------

function stubChatGpt(answer, { fail = false } = {}) {
  const stub = {
    name: 'chatgpt',
    calls: 0,
    async ask() {
      stub.calls += 1;
      if (fail) throw new Error('boom sk-secret-should-never-be-logged');
      return { answer, provider: 'chatgpt', model: 'stub-gpt', webSearch: true };
    },
  };
  return stub;
}

test('ChatGPT is asked the same questions as Claude, and both show in the report', async () => {
  const assistant = stubAssistant('1. Bluebird Books\n2. Ledger Lane\n3. Tally Ho Tax');
  const chatgpt = stubChatGpt('1. Ace Accounting\n2. Ledger Lane');
  const env = await startEnv({ assistantProvider: assistant, extraAssistants: [chatgpt] });
  const id = await startGrade(env, NO_SITE);
  let grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  assert.deepEqual(grade.ai.map(a => a.provider), ['anthropic', 'chatgpt']);
  assert.equal(grade.ai[0].prompt, grade.ai[1].prompt);
  assert.equal(grade.ai[0].named, false);
  assert.equal(grade.ai[1].named, true);

  const page = await (await get(env, `/grade/${id}`)).text();
  assert.match(page, /We just asked Claude\. It named these 3 businesses, not yours\./);
  assert.match(page, /ChatGPT, asked the same question: It listed 2 businesses, and yours was 1st\./);
  assert.match(page, /Other AI assistants, for comparison only \(not scored\):/);

  // After the report is opened, each extra question also goes to both.
  const ok = await post(env, `/grade/${id}/unlock`, LEAD);
  const cookie = cookieOf(ok);
  await get(env, `/grade/${id}`, { cookie });
  grade = await until(async () => {
    const g = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
    return g.ai.length === 6 ? g : null;
  }, 'both assistants on all three questions');
  assert.equal(assistant.calls, 3);
  assert.equal(chatgpt.calls, 3);
  assert.equal(grade.ai.filter(a => a.provider === 'chatgpt').length, 3);
  const after = await (await get(env, `/grade/${id}`, { cookie })).text();
  assert.ok(after.includes('Claude named your business in 0 of its 3 answers.'));
  assert.ok(after.includes("We asked Claude and ChatGPT the same 3 questions. Only Claude's answers count toward your score, so your score stays steady from check to check. ChatGPT's answers are below so you can compare."));
  // Only Claude's answers are scored, so ChatGPT naming the business does not change the score.
  assert.equal(grade.results.find(r => r.id === 'ai-named').detail, 'No. Claude did not name your business in any of 3 answers.');
});

test('turning ChatGPT on later: a repeat check keeps Claude\'s stored answer and asks only ChatGPT', async () => {
  const assistant = stubAssistant('1. Bluebird Books\n2. Ledger Lane');
  const first = await startEnv({ assistantProvider: assistant });
  const id1 = await startGrade(first, NO_SITE);
  const saved = (await readJson(first, 'grades.json', [])).find(x => x.id === id1);
  assert.equal(assistant.calls, 1);

  // A new server on the same day, with ChatGPT now switched on and the earlier Grade on file.
  const chatgpt = stubChatGpt('1. Ace Accounting');
  const env = await startEnv({ assistantProvider: assistant, extraAssistants: [chatgpt] });
  await fs.writeFile(path.join(env.dir, 'grades.json'), JSON.stringify([{ ...saved, id: 'earlierGrade0000000001' }]));
  const id2 = await startGrade(env, NO_SITE);
  const grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id2);
  assert.equal(assistant.calls, 1, 'Claude is not asked again');
  assert.equal(chatgpt.calls, 1);
  assert.deepEqual(grade.ai.map(a => a.provider), ['anthropic', 'chatgpt']);
  assert.ok(grade.ai[0].reusedFrom);
  assert.equal(grade.ai[1].reusedFrom, undefined);
});

test('when Claude fails and ChatGPT answers, the report says there is no AI score', async () => {
  const claude = { name: 'anthropic', async ask() { throw new Error('down'); } };
  const chatgpt = stubChatGpt('1. Ace Accounting');
  const env = await startEnv({ assistantProvider: claude, extraAssistants: [chatgpt] });
  const id = await startGrade(env, NO_SITE);
  const grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  assert.equal(grade.results.find(r => r.id === 'ai-named').result, 'not_checked');
  const page = await (await get(env, `/grade/${id}`)).text();
  assert.match(page, /Claude did not answer this time, so this check has no AI score\./);
  assert.match(page, /for comparison only \(not scored\)/);
  assert.doesNotMatch(page, /AI named your business\./);
});

test('with ChatGPT and Gemini on, all three answer; only Claude is scored', async () => {
  const assistant = stubAssistant('1. Bluebird Books');
  const chatgpt = stubChatGpt('1. Ace Accounting');
  const gemini = { name: 'gemini', calls: 0, async ask() { gemini.calls += 1; return { answer: '1. Ace Accounting', provider: 'gemini', model: 'stub-gem', webSearch: false }; } };
  const env = await startEnv({ assistantProvider: assistant, extraAssistants: [chatgpt, gemini] });
  const id = await startGrade(env, NO_SITE);
  let grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  assert.deepEqual(grade.ai.map(a => a.provider), ['anthropic', 'chatgpt', 'gemini']);
  assert.equal(grade.results.find(r => r.id === 'ai-named').result, 'fail');
  const ok = await post(env, `/grade/${id}/unlock`, LEAD);
  const cookie = cookieOf(ok);
  await get(env, `/grade/${id}`, { cookie });
  grade = await until(async () => {
    const g = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
    return g.ai.length === 9 ? g : null;
  }, 'three assistants on three questions');
  const page = await (await get(env, `/grade/${id}`, { cookie })).text();
  assert.match(page, /Gemini, asked the same question:/);
  assert.ok(page.includes("We asked Claude, ChatGPT and Gemini the same 3 questions. Only Claude's answers count toward your score, so your score stays steady from check to check. The other assistants' answers are below so you can compare."));
  assert.match(page, /Gemini answered without a live web search\./);
  assert.match(page, /for comparison only \(not scored\)/);
});

test('when Claude fails, every second opinion is shown and none is scored', async () => {
  const claude = { name: 'anthropic', async ask() { throw new Error('down'); } };
  const chatgpt = stubChatGpt('1. Ace Accounting');
  const gemini = { name: 'gemini', async ask() { return { answer: '1. Birch Books', provider: 'gemini', model: 'g', webSearch: false }; } };
  const env = await startEnv({ assistantProvider: claude, extraAssistants: [chatgpt, gemini] });
  const id = await startGrade(env, NO_SITE);
  const page = await (await get(env, `/grade/${id}`)).text();
  assert.match(page, /We just asked ChatGPT\./);
  assert.match(page, /We just asked Gemini\./);
  assert.match(page, /Claude did not answer this time/);
  const ok = await post(env, `/grade/${id}/unlock`, LEAD);
  const full = await (await get(env, `/grade/${id}`, { cookie: cookieOf(ok) })).text();
  assert.ok(full.includes("Claude did not answer, so this check has no AI score. The answers from ChatGPT and Gemini are here so you can compare."));
});

test('with the demo assistant in charge, ChatGPT is never asked', async () => {
  const chatgpt = stubChatGpt('1. Ace Accounting');
  const env = await startEnv({ extraAssistants: [chatgpt] });
  const id = await startGrade(env, NO_SITE);
  const grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  assert.equal(chatgpt.calls, 0);
  assert.deepEqual(grade.ai.map(a => a.provider), ['mock']);
});

test('ChatGPT never spends the last of the day\'s AI calls', async () => {
  const assistant = stubAssistant('1. Bluebird Books');
  const chatgpt = stubChatGpt('1. Ace Accounting');
  // 12 calls are held back for the main assistant, so a cap of 12 leaves ChatGPT none.
  const env = await startEnv({ assistantProvider: assistant, extraAssistants: [chatgpt], config: { gradeAiCallsPerDay: 12 } });
  const id = await startGrade(env, NO_SITE);
  const grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  assert.equal(chatgpt.calls, 0);
  assert.deepEqual(grade.ai.map(a => a.provider), ['anthropic']);
});

test('after three ChatGPT failures in a row it is left out for a while', async () => {
  const assistant = stubAssistant('1. Bluebird Books');
  const chatgpt = stubChatGpt('', { fail: true });
  const env = await startEnv({ assistantProvider: assistant, extraAssistants: [chatgpt] });
  const names = ['Ace Accounting', 'Birch Books', 'Cedar Ledgers', 'Dogwood Tax'];
  for (const name of names) await startGrade(env, { ...NO_SITE, name, service: `${name} services` });
  assert.equal(assistant.calls, 4);
  assert.equal(chatgpt.calls, 3, 'the fourth check does not try ChatGPT');
  // Fifteen minutes later it is tried again.
  env.clock.t += 16 * 60 * 1000;
  await startGrade(env, { ...NO_SITE, name: 'Elm Audit', service: 'elm audit services' });
  assert.equal(chatgpt.calls, 4);
});

test('a ChatGPT failure never blocks the check: Claude\'s answer still counts', async () => {
  const assistant = stubAssistant('1. Bluebird Books\n2. Ledger Lane');
  const chatgpt = stubChatGpt('', { fail: true });
  const env = await startEnv({ assistantProvider: assistant, extraAssistants: [chatgpt] });
  const id = await startGrade(env, NO_SITE);
  const grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  assert.deepEqual(grade.ai.map(a => a.provider), ['anthropic']);
  const page = await (await get(env, `/grade/${id}`)).text();
  assert.match(page, /We just asked Claude/);
  assert.doesNotMatch(page, /ChatGPT/);
});

test('without a ChatGPT key nothing changes', async () => {
  const assistant = stubAssistant('1. Bluebird Books');
  const env = await startEnv({ assistantProvider: assistant });
  const id = await startGrade(env, NO_SITE);
  const grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  assert.equal(grade.ai.length, 1);
});

// ---- Google's live answer (Gemini with Google Search) ------------------------------------

function stubGoogleLive() {
  const stub = {
    name: 'gemini-live',
    calls: [],
    async ask({ prompt }) {
      stub.calls.push(prompt);
      return {
        text: '1. Frog Heating & Plumbing <b>bold?</b>',
        sources: [{ url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'example.com' }],
        suggestionsHtml: '<div class="container"><a class="chip" href="https://www.google.com/search?q=plumbers">plumbers nashville</a></div>',
      };
    },
  };
  return stub;
}

test("Google's live answer: only the browser that ran the check sees it, and it is never saved", async () => {
  const assistant = stubAssistant('1. Bluebird Books');
  const live = stubGoogleLive();
  const env = await startEnv({ assistantProvider: assistant, googleLive: live });
  const { id, cookie } = await startGradeWithCookie(env, NO_SITE);
  assert.match(cookie, new RegExp(`^gr_${id}=`));

  // The requester sees the button; anyone else sees why not.
  const mine = await (await get(env, `/grade/${id}`, { cookie })).text();
  assert.match(mine, /Show Google&#39;s live answer|Show Google's live answer/);
  const shared = await (await get(env, `/grade/${id}`)).text();
  assert.doesNotMatch(shared, /<form method="post" action="\/grade\/[^"]+\/google-live">/);
  assert.match(shared, /private to the person who ran the check/);

  // A shared link (no requester cookie) can't fetch it.
  const denied = await post(env, `/grade/${id}/google-live`, {});
  assert.equal(denied.status, 403);
  assert.equal(live.calls.length, 0);

  // The requester gets it: answer escaped, Google's suggestions unchanged, sources linked.
  const ok = await post(env, `/grade/${id}/google-live`, {}, { cookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
  const page = await ok.text();
  assert.equal(live.calls[0], 'Who are the best accountants in Nashville, TN? Name your top 5.');
  assert.match(page, /&lt;b&gt;bold\?&lt;\/b&gt;/);
  assert.ok(page.includes('<div class="container"><a class="chip" href="https://www.google.com/search?q=plumbers">plumbers nashville</a></div>'));
  assert.match(page, /href="https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/abc"/);

  // Nothing of it is stored anywhere in the data folder.
  await env.ctx.aiBudget?.flush?.();
  const files = await fs.readdir(env.dir, { recursive: true });
  for (const f of files) {
    const full = path.join(env.dir, f);
    if (!(await fs.stat(full)).isFile()) continue;
    const text = await fs.readFile(full, 'utf8');
    assert.doesNotMatch(text, /Frog Heating|plumbers nashville|grounding-api-redirect/, f);
  }
});

test("Google's live answer: limited per report, and off without a provider", async () => {
  const live = stubGoogleLive();
  const env = await startEnv({ assistantProvider: stubAssistant('1. Bluebird Books'), googleLive: live });
  const { id, cookie } = await startGradeWithCookie(env, NO_SITE);
  for (let i = 0; i < 3; i += 1) assert.equal((await post(env, `/grade/${id}/google-live`, {}, { cookie })).status, 200);
  assert.equal((await post(env, `/grade/${id}/google-live`, {}, { cookie })).status, 429);

  const off = await startEnv({ assistantProvider: stubAssistant('1. Bluebird Books'), googleLive: null });
  const g = await startGradeWithCookie(off, NO_SITE);
  assert.doesNotMatch(await (await get(off, `/grade/${g.id}`, { cookie: g.cookie })).text(), /What Google&#39;s AI says|What Google's AI says/);
  assert.equal((await post(off, `/grade/${g.id}/google-live`, {}, { cookie: g.cookie })).status, 404);
});

test("Google's live answer: a provider failure shows a plain message, not an error page", async () => {
  const live = { name: 'gemini-live', async ask() { throw new Error('boom AIza-secret'); } };
  const env = await startEnv({ assistantProvider: stubAssistant('1. Bluebird Books'), googleLive: live });
  const { id, cookie } = await startGradeWithCookie(env, NO_SITE);
  const res = await post(env, `/grade/${id}/google-live`, {}, { cookie });
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.match(text, /didn&#39;t answer this time|didn't answer this time/);
  assert.doesNotMatch(text, /AIza/);
});

test("Google's live answer never uses the day's last calls, which are kept for new checks", async () => {
  const live = stubGoogleLive();
  const env = await startEnv({ assistantProvider: stubAssistant('1. Bluebird Books'), googleLive: live, config: { gradeAiCallsPerDay: 13 } });
  const { id, cookie } = await startGradeWithCookie(env, NO_SITE);
  // One call used by the check: 12 left, all kept back.
  const res = await post(env, `/grade/${id}/google-live`, {}, { cookie });
  assert.equal(res.status, 429);
  assert.equal(live.calls.length, 0);
});

test("Google's live answer page blocks scripts in Google's HTML", async () => {
  const env = await startEnv({ assistantProvider: stubAssistant('1. Bluebird Books'), googleLive: stubGoogleLive() });
  const { id, cookie } = await startGradeWithCookie(env, NO_SITE);
  const res = await post(env, `/grade/${id}/google-live`, {}, { cookie });
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
});

// ---- Gemini Decisions as a second check on reading answers --------------------------

function stubChecker(fn) {
  const stub = { name: 'gemini-decisions', calls: [], async check(args) { stub.calls.push(args); return fn(args); } };
  return stub;
}

test('name check: a very sure "not a business" drops a name, and a very sure "same business" counts a near-miss spelling', async () => {
  const assistant = stubAssistant('1. Bluebird Books\n2. Before booking\n3. Acee Acounting Group');
  const checker = stubChecker(({ names }) => ({
    isBusiness: new Map(names.map(n => [n, n === 'Before booking' ? 0.04 : 0.97])),
    sameAs: new Map(names.map(n => [n, n === 'Acee Acounting Group' ? 0.98 : 0.02])),
  }));
  const env = await startEnv({ assistantProvider: assistant, nameChecker: checker });
  const id = await startGrade(env, NO_SITE);
  const grade = (await readJson(env, 'grades.json', [])).find(x => x.id === id);
  const a = grade.ai[0];
  assert.equal(checker.calls.length, 1);
  assert.equal(checker.calls[0].business.name, 'Ace Accounting');
  assert.deepEqual(a.competitors, ['Bluebird Books']);
  assert.equal(a.named, true);
  assert.equal(a.position, 2);
  assert.equal(a.total, 2);
  assert.deepEqual(a.nameCheck, { by: 'gemini-decisions', dropped: 1, addedNamed: true });
  const page = await (await get(env, `/grade/${id}`)).text();
  assert.match(page, /yours was 2nd, but it was spelled a little differently from how you wrote it\. We still counted it\./);
});

test('name check: a name our own reader matched is never sent or dropped (trade-word names)', async () => {
  const assistant = stubAssistant('1. Best Roofers\n2. Acme Roofing\n3. Zeta Roofing Co');
  const checker = stubChecker(({ names }) => ({ isBusiness: new Map(names.map(n => [n, 0.01])), sameAs: new Map() }));
  const env = await startEnv({ assistantProvider: assistant, nameChecker: checker });
  const id = await startGrade(env, { ...NO_SITE, name: 'Best Roofers', service: 'roofers' });
  const a = (await readJson(env, 'grades.json', [])).find(x => x.id === id).ai[0];
  assert.ok(!checker.calls[0].names.includes('Best Roofers'));
  assert.equal(a.named, true);
  assert.equal(a.position, 1);
});

test('name check: unsure replies change nothing', async () => {
  const assistant = stubAssistant('1. Bluebird Books\n2. Ledger Lane');
  const checker = stubChecker(({ names }) => ({ isBusiness: new Map(names.map(n => [n, 0.3])), sameAs: new Map(names.map(n => [n, 0.8])) }));
  const env = await startEnv({ assistantProvider: assistant, nameChecker: checker });
  const id = await startGrade(env, NO_SITE);
  const a = (await readJson(env, 'grades.json', [])).find(x => x.id === id).ai[0];
  assert.deepEqual(a.competitors, ['Bluebird Books', 'Ledger Lane']);
  assert.equal(a.named, false);
  assert.deepEqual(a.nameCheck, { by: 'gemini-decisions', dropped: 0, addedNamed: false });
});

for (const [label, fn] of [['returns nothing', () => null], ['throws', () => { throw new Error('boom'); }]]) {
  test(`name check: when the checker ${label}, our own reading stands`, async () => {
    const assistant = stubAssistant('1. Bluebird Books\n2. Before booking');
    const env = await startEnv({ assistantProvider: assistant, nameChecker: stubChecker(fn) });
    const id = await startGrade(env, NO_SITE);
    const a = (await readJson(env, 'grades.json', [])).find(x => x.id === id).ai[0];
    assert.equal(a.named, false);
    assert.equal(a.competitors.length, 2);
    assert.equal('nameCheck' in a, false);
  });
}

test('name check: Gemini cannot count a different business as yours (names must start alike)', async () => {
  const assistant = stubAssistant('1. Bluebird Books\n2. Ledger Lane');
  const checker = stubChecker(({ names }) => ({ isBusiness: new Map(names.map(n => [n, 0.99])), sameAs: new Map(names.map(n => [n, 0.99])) }));
  const env = await startEnv({ assistantProvider: assistant, nameChecker: checker });
  const id = await startGrade(env, NO_SITE);
  const a = (await readJson(env, 'grades.json', [])).find(x => x.id === id).ai[0];
  assert.equal(a.named, false);
  assert.deepEqual(a.competitors, ['Bluebird Books', 'Ledger Lane']);
  assert.equal(a.nameCheck.addedNamed, false);
});

test('name check: answers carried over from earlier this week are read again (no new AI question)', async () => {
  const assistant = stubAssistant('1. Bluebird Books\n2. Before booking');
  const first = await startEnv({ assistantProvider: assistant });
  const id1 = await startGrade(first, NO_SITE);
  const a1 = (await readJson(first, 'grades.json', [])).find(x => x.id === id1).ai[0];
  assert.equal(a1.competitors.length, 2);
  // Same data folder, now with the name check on.
  const checker = stubChecker(({ names }) => ({ isBusiness: new Map(names.map(n => [n, n === 'Before booking' ? 0.02 : 0.9])), sameAs: new Map() }));
  const before = assistant.calls;
  const second = await startEnv({ assistantProvider: assistant, nameChecker: checker, dataDir: first.dir, idStart: 100 });
  const id2 = await startGrade(second, NO_SITE);
  const a2 = (await readJson(second, 'grades.json', [])).find(x => x.id === id2).ai[0];
  assert.ok(a2.reusedFrom);
  assert.deepEqual(a2.competitors, ['Bluebird Books']);
  assert.equal(a2.nameCheck.dropped, 1);
  assert.equal(checker.calls.length, 1);
  assert.equal(assistant.calls, before);
});

test('name check: a carried answer that was cut short is not re-read, so a late mention is never lost', async () => {
  const filler = Array.from({ length: 300 }, (_, i) => `Tip ${i}: call around and compare quotes before you hire.`).join('\n');
  const assistant = stubAssistant(`1. Bluebird Books\n${filler}\nAlso consider Ace Accounting.`);
  const first = await startEnv({ assistantProvider: assistant });
  const id1 = await startGrade(first, NO_SITE);
  const a1 = (await readJson(first, 'grades.json', [])).find(x => x.id === id1).ai[0];
  assert.equal(a1.named, true);
  const checker = stubChecker(({ names }) => ({ isBusiness: new Map(names.map(n => [n, 0.9])), sameAs: new Map() }));
  const second = await startEnv({ assistantProvider: assistant, nameChecker: checker, dataDir: first.dir, idStart: 100 });
  const id2 = await startGrade(second, NO_SITE);
  const a2 = (await readJson(second, 'grades.json', [])).find(x => x.id === id2).ai[0];
  assert.equal(a2.named, true);
  assert.equal(checker.calls.length, 0);
});
