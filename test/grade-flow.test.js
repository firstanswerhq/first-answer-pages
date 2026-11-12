/**
 * End-to-end tests for the AI Visibility Grader through createApp: the form,
 * the scan, the report, limits, noindex headers and reuse. The network is never
 * touched: the real safe fetcher runs on a fake transport and fake DNS, the AI
 * provider is the mock or a stub, and the clock is fake.
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
import { createAiBudget } from '../server/lib/ai-budget.js';
import { STATE_ERROR } from '../server/lib/listing-fields.js';
import { AI_LIMIT_REACHED } from '../server/lib/grader.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/grade/', import.meta.url));
const EXPECTED = JSON.parse(await fs.readFile(path.join(FIXTURES, 'expected.json'), 'utf8'));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);

// The real network functions must never be called by this suite.
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

// ---- fake websites ---------------------------------------------------------------

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
  return {
    status: 200,
    headers: { 'content-type': file.contentType ?? 'text/plain; charset=utf-8' },
    body: Buffer.from(file.text),
  };
}

function fixtureFetcher() {
  const fn = (url, opts, cb) => {
    const u = new URL(url);
    const req = new EventEmitter();
    req.end = () => {
      opts.lookup(u.hostname, { all: true }, (err, list) => {
        if (err) return req.emit('error', err);
        assert.ok(list.every(a => a.address === '93.184.216.34'), 'only the checked address is used');
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

// ---- environment ------------------------------------------------------------------

async function startEnv({ assistantProvider, config = {}, aiBudget, safeFetcher } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider,
    aiBudget: typeof aiBudget === 'function' ? aiBudget(clock) : aiBudget,
    safeFetcher: safeFetcher ?? fixtureFetcher(),
    newGradeId: () => `grade${String(++n).padStart(17, '0')}`,
    config: { baseUrl: 'http://example.test', graderLeadGate: false, graderSecret: 'test-secret', ...config },
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
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p) => fetch(env.base + p, { redirect: 'manual' });

async function stampFor(env) {
  const html = await (await get(env, '/grade')).text();
  const stamp = /name="t" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(stamp, 'the form has a signed timer');
  env.clock.t += 5000; // the form must be at least 3 seconds old
  return stamp;
}

async function postGrade(env, fields, { stamp } = {}) {
  const t = stamp ?? await stampFor(env);
  return fetch(`${env.base}/grade`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ nickname: '', t, ...fields }),
  });
}

async function waitDone(env, id) {
  for (let i = 0; i < 300; i += 1) {
    const res = await get(env, `/grade/${id}/status.json`);
    const status = await res.json();
    if (status.done) return status;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('grade did not finish');
}

async function storedGrades(env) {
  return JSON.parse(await fs.readFile(path.join(env.dir, 'grades.json'), 'utf8'));
}

const idOf = res => /^\/grade\/([A-Za-z0-9_-]{22})$/.exec(res.headers.get('location') ?? '')?.[1];

const fieldsOf = input => ({
  name: input.name, city: input.city, state: input.state, service: input.service, website: input.website ?? '',
});

// "accountants" has no category, so the mock always gives a neutral answer that names no one.
const NO_SITE = { name: 'Ace Accounting', city: 'Nashville', state: 'TN', service: 'accountants', website: '' };

/** A stub assistant that is not the mock, so the daily budget counts its calls. */
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

// ---- the three fixtures, end to end -----------------------------------------------

for (const [label, exp] of Object.entries(EXPECTED)) {
  test(`fixture ${label}: grade runs end to end and matches the expected checks`, async () => {
    const env = await startEnv();
    const res = await postGrade(env, fieldsOf(exp.input));
    assert.equal(res.status, 303);
    const id = idOf(res);
    assert.ok(id, 'redirects to /grade/<22-character id>');
    await waitDone(env, id);

    const [grade] = await storedGrades(env);
    assert.equal(grade.id, id);
    assert.equal(grade.status, 'done');
    assert.equal(grade.steps.length, 5);
    assert.deepEqual(
      Object.fromEntries(grade.results.map(r => [r.id, r.result])),
      exp.results,
    );
    assert.equal(grade.score.score, exp.score.score);
    assert.equal(grade.score.failed, exp.score.failed);
    assert.equal(grade.score.counted, exp.score.counted);
    assert.equal(grade.facts.title, exp.facts.title);
    assert.equal(grade.facts.phone, exp.found.phone);
    assert.equal(grade.facts.address, exp.found.address);
    assert.equal(grade.facts.h1s.length, exp.facts.h1Count);
    if (exp.blocked) assert.deepEqual(grade.results.find(r => r.id === 'ai-bots-allowed').blocked, exp.blocked);
    assert.equal(grade.ai.length, 1);
    assert.equal(grade.ai[0].provider, 'mock');

    const page = await get(env, `/grade/${id}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes(`<span class="num">${exp.score.score}</span>`), 'score shown');
    assert.ok(html.includes(`${exp.score.failed} of ${exp.score.counted} checks failed`));
    assert.ok(html.includes('Claim my free page'));
    assert.ok(html.includes('Goes live after you check it and we approve it.'));
    assert.ok(html.includes('days to weeks'));
    assert.ok(html.includes('Automated check'));
    assert.ok(html.includes('Demo answer (no AI connected)'), 'the mock answer is labeled');
    assert.ok(html.includes('Your fix kit'), 'gate off shows the full report');
    assert.ok(html.includes(exp.input.name.replace(/&/g, '&amp;')));
    assert.equal(/\$\d/.test(html), false, 'no dollar figures');
  });
}

// ---- the AI part -------------------------------------------------------------------

test('a stub AI that names the business gives full AI points and a place in the list', async () => {
  const exp = EXPECTED.largeCompany;
  const assistant = stubAssistant('1. Summit Heating & Air Inc - fast and fair\n2. Other Co - also fine');
  const env = await startEnv({ assistantProvider: assistant });
  const id = idOf(await postGrade(env, fieldsOf(exp.input)));
  await waitDone(env, id);
  const [grade] = await storedGrades(env);
  const named = grade.results.find(r => r.id === 'ai-named');
  assert.equal(named.result, 'pass');
  assert.equal(named.earned, 30);
  assert.equal(grade.score.score, 100);
  assert.equal(grade.ai[0].position, 1);
  assert.deepEqual(grade.ai[0].competitors, ['Other Co']);
  const html = await (await get(env, `/grade/${id}`)).text();
  assert.ok(html.includes('We asked Claude once just now. It named your business 1st of 2.'));
  assert.equal(assistant.calls, 1);
});

test('AI answer text is escaped on the page', async () => {
  const assistant = stubAssistant('1. <script>alert(1)</script> Roofing\n2. Fine Roofing');
  const env = await startEnv({ assistantProvider: assistant });
  const id = idOf(await postGrade(env, NO_SITE));
  await waitDone(env, id);
  const html = await (await get(env, `/grade/${id}`)).text();
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('no website: website checks are not_checked and the report says Not enough to score yet', async () => {
  const env = await startEnv();
  const id = idOf(await postGrade(env, NO_SITE));
  await waitDone(env, id);
  const [grade] = await storedGrades(env);
  assert.equal(grade.status, 'done');
  assert.equal(grade.score.score, null);
  const states = Object.fromEntries(grade.results.map(r => [r.id, r.result]));
  assert.equal(states['tap-to-call'], 'not_checked');
  assert.equal(states['ai-named'], 'fail');
  assert.deepEqual(grade.steps.filter(s => s.state === 'skipped').length, 3);
  const html = await (await get(env, `/grade/${id}`)).text();
  assert.ok(html.includes('Not enough to score yet'));
});

test('an unreachable website gives not_checked checks and still a done Grade', async () => {
  const env = await startEnv({ safeFetcher: { fetchText: async () => { throw new Error('boom'); } } });
  const id = idOf(await postGrade(env, { ...NO_SITE, website: 'nowhere.example' }));
  await waitDone(env, id);
  const [grade] = await storedGrades(env);
  assert.equal(grade.status, 'done');
  assert.equal(grade.input.website, 'https://nowhere.example/');
  const tap = grade.results.find(r => r.id === 'tap-to-call');
  assert.equal(tap.result, 'not_checked');
  assert.match(tap.detail, /couldn't reach your website/);
});

test('when the daily AI share is used up, ai-named is not_checked and the Grade is still done', async () => {
  const assistant = stubAssistant('never used');
  const env = await startEnv({
    assistantProvider: assistant,
    aiBudget: clock => createAiBudget({ clock, limit: 200, gradeLimit: 0 }),
  });
  const id = idOf(await postGrade(env, NO_SITE));
  await waitDone(env, id);
  const [grade] = await storedGrades(env);
  const named = grade.results.find(r => r.id === 'ai-named');
  assert.equal(named.result, 'not_checked');
  assert.equal(named.detail, AI_LIMIT_REACHED);
  assert.equal(assistant.calls, 0);
  const html = await (await get(env, `/grade/${id}`)).text();
  assert.ok(html.includes("We couldn't ask AI this time"));
});

test('a second Grade with the same details reuses the AI answer and copies nothing else', async () => {
  const assistant = stubAssistant('1. Other Accounting\n2. Another Accounting');
  const env = await startEnv({ assistantProvider: assistant });
  const first = idOf(await postGrade(env, NO_SITE));
  await waitDone(env, first);
  const second = idOf(await postGrade(env, NO_SITE));
  await waitDone(env, second);
  const grades = await storedGrades(env);
  const [a, b] = [grades.find(g => g.id === first), grades.find(g => g.id === second)];
  assert.equal(assistant.calls, 1, 'no new AI question');
  assert.equal(b.ai.length, 1);
  assert.equal(b.ai[0].reusedFrom, a.ai[0].at);
  assert.equal(b.draftId, null);
  assert.equal(b.previousScore, null);
  const html = await (await get(env, `/grade/${second}`)).text();
  assert.ok(/We asked Claude on /.test(html), 'labeled with the original time');
});

// ---- form, limits, headers ----------------------------------------------------------

test('GET /grade: form with the five fields, honeypot, timer and no email or phone box', async () => {
  const env = await startEnv();
  const res = await get(env, '/grade');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Can AI find your business?'));
  for (const name of ['name', 'city', 'state', 'service', 'website', 'nickname', 't']) {
    assert.ok(html.includes(`name="${name}"`), name);
  }
  assert.equal(/type="(email|tel|password)"/.test(html), false);
  assert.match(html, /<form[^>]*method="POST"[^>]*action="\/grade"/);
  assert.ok(html.includes('<datalist id="service-suggestions">'));
  assert.equal(html.includes('value="Other"'), false, '"Other" is not suggested');
});

test('POST /grade: each bad field is named and the other entries are kept (422)', async () => {
  const env = await startEnv();
  const res = await postGrade(env, { name: '', city: 'Nashville', state: 'ZZ', service: '', website: 'ftp://x.example' });
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.ok(html.includes(STATE_ERROR));
  assert.ok(html.includes('Type your business name'));
  assert.ok(html.includes('Say what you do'));
  assert.ok(html.includes('Type your website like example.com'));
  assert.ok(html.includes('value="Nashville"'));
  assert.deepEqual(await fs.readdir(env.dir).then(f => f.filter(x => x === 'grades.json')), [], 'no Grade started');
});

test('POST /grade: a filled honeypot or a too-fast form starts no Grade (422)', async () => {
  const env = await startEnv();
  const stamp = await stampFor(env);
  const bot = await fetch(`${env.base}/grade`, {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...NO_SITE, nickname: 'spam', t: stamp }),
  });
  assert.equal(bot.status, 422);

  const html = await (await get(env, '/grade')).text();
  const fresh = /name="t" value="([^"]+)"/.exec(html)[1];
  const fast = await postGrade(env, NO_SITE, { stamp: fresh }); // no time has passed
  assert.equal(fast.status, 422);
  const forged = await postGrade(env, NO_SITE, { stamp: `${START - 10000}.${'0'.repeat(64)}` });
  assert.equal(forged.status, 422);
  assert.deepEqual(await fs.readdir(env.dir).then(f => f.filter(x => x === 'grades.json')), []);
});

test('POST /grade: a bare host name becomes https://<host>/ and the sixth Grade in an hour gets 429', async () => {
  const env = await startEnv();
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const res = await postGrade(env, { ...NO_SITE, name: `Ace Accounting ${i}`, website: i === 0 ? 'Example.COM' : '' });
    assert.equal(res.status, 303, `request ${i + 1}`);
    ids.push(idOf(res));
  }
  const limited = await postGrade(env, NO_SITE);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  for (const id of ids) await waitDone(env, id);
  const grades = await storedGrades(env);
  assert.equal(grades.find(g => g.id === ids[0]).input.website, 'https://example.com/');
});

test('every /grade page is not indexed and sends no referrer', async () => {
  const env = await startEnv();
  const id = idOf(await postGrade(env, NO_SITE));
  await waitDone(env, id);
  for (const p of ['/grade', '/grade/about', `/grade/${id}`, `/grade/${id}/status.json`, '/grade/nope']) {
    const res = await get(env, p);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow', p);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', p);
    if (res.headers.get('content-type')?.includes('html')) {
      assert.ok((await res.text()).includes('<meta name="robots" content="noindex, nofollow">'), p);
    } else {
      await res.arrayBuffer();
    }
  }
});

test('unknown and malformed ids are 404; /grade/about is not read as an id', async () => {
  const env = await startEnv();
  assert.equal((await get(env, '/grade/short')).status, 404);
  assert.equal((await get(env, `/grade/${'A'.repeat(22)}`)).status, 404);
  assert.equal((await get(env, `/grade/${'A'.repeat(22)}/status.json`)).status, 404);
  const about = await get(env, '/grade/about');
  assert.equal(about.status, 200);
  assert.ok((await about.text()).includes('robots.txt'));
});

test('GRADER_ENABLED=off: every /grade path is 404 and the home page has no link', async () => {
  const env = await startEnv({ config: { graderEnabled: false } });
  for (const p of ['/grade', '/grade/about', `/grade/${'A'.repeat(22)}`]) {
    assert.equal((await get(env, p)).status, 404, p);
  }
  assert.equal((await (await get(env, '/')).text()).includes('href="/grade"'), false);
  const on = await startEnv();
  assert.ok((await (await get(on, '/')).text()).includes('href="/grade"'));
});

test('a running Grade shows the steps with a refresh tag inside noscript; a stale one reads as failed', async () => {
  const env = await startEnv();
  const base = {
    input: { name: 'Slow Co', city: 'Nashville', state: 'TN', service: 'plumbers', website: null },
    key: 'k', finishedAt: null, steps: [], facts: null, results: [], ai: [], score: null,
    previousScore: null, draftId: null, recheckedAt: null,
  };
  const now = new Date(env.clock.t).toISOString();
  const freshId = `running${'0'.repeat(14)}1`; // 22 characters
  const oldId = `running${'0'.repeat(14)}2`;
  await env.ctx.store.collection('grades').append({ ...base, id: freshId, status: 'running', createdAt: now });
  await env.ctx.store.collection('grades').append({
    ...base, id: oldId, status: 'running', createdAt: new Date(env.clock.t - 5 * 60 * 1000).toISOString(),
  });
  const running = await (await get(env, `/grade/${freshId}`)).text();
  assert.ok(running.includes('Finding your website'));
  assert.ok(running.includes('<noscript><meta http-equiv="refresh" content="3"></noscript>'));
  assert.ok(running.includes('Asking AI to name the best plumbers in Nashville'));
  const stale = await (await get(env, `/grade/${oldId}`)).text();
  assert.ok(stale.includes("This check didn't finish"));
  assert.ok(stale.includes('Start again'));
  assert.equal(env.ctx.grader.isStale({ status: 'running', createdAt: now }, env.clock.t + 3 * 60 * 1000), false);
  assert.equal(env.ctx.grader.isStale({ status: 'running', createdAt: now }, env.clock.t + 5 * 60 * 1000), true);
});

test('/grade stays out of sitemap.xml and llms.txt; no Grader page uses the banned phone-book names', async () => {
  const env = await startEnv();
  assert.equal((await (await get(env, '/sitemap.xml')).text()).includes('/grade'), false);
  assert.equal((await (await get(env, '/llms.txt')).text()).includes('/grade'), false);
  const id = idOf(await postGrade(env, fieldsOf(EXPECTED.roofer.input)));
  await waitDone(env, id);
  for (const p of ['/grade', '/grade/about', `/grade/${id}`]) {
    const html = await (await get(env, p)).text();
    assert.equal(/yellow\s*pages/i.test(html), false, p);
    assert.equal(/\bYP\b/.test(html), false, p);
    assert.equal(/guarantee/i.test(html), false, p);
  }
});
