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

async function startEnv({ assistantProvider, config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-lead-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider,
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

  const ok = await post(env, `/grade/${id}/unlock`, LEAD);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `/grade/${id}#full-report`);
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
  assert.match(grade.results.find(r => r.id === 'ai-named').detail, /We asked 3 questions and AI did not name your business in any of them/);
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
