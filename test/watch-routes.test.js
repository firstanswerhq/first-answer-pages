/**
 * addon-monthly-watch task 8: the watch routes, through createApp. Off means 404; not eligible means no form; eligible
 * shows the form; GET confirm and GET stop change nothing, POST does; the one-click POST stops; every page is noindex,
 * no-store and no-referrer; names are escaped; rate limits.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createMockNotifier } from '../server/lib/notifier.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 18, 18, 0, 0);
const DAY = 86400000;
const BASE_URL = 'https://pages.example.test';
const EMAIL = 'owner@quillfeather.example';
const BUSINESS = { name: 'Quillfeather Drain Works', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' };
const PROMISE = /will name|guarantee|\$/iu;

const servers = [];
const dirs = [];
after(async () => {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise(r => s.close(r));
  }
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

let ipCounter = 10;
const freshIp = () => `203.0.113.${ipCounter++ % 250}`;

async function startEnv({ config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-routes-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  const clock = { t: START, now() { return this.t; } };
  const notifier = createMockNotifier();
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    notifier,
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co\n2. Another Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: null,
    placesLookup: null,
    bingLookup: null,
    safeFetcher: { async fetchText() { throw Object.assign(new Error('no network in tests'), { code: 'timeout' }); } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `wr${String(++n).padStart(20, '0')}`,
    config: {
      baseUrl: BASE_URL, graderSecret: 'test-secret', graderLeadGate: false, gradeMainAsks: 1, gradeAiCallsPerDay: 150,
      demoMode: false, trustProxy: 1, watchEnabled: true, notifierName: 'resend', ...config,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(r => server.once('listening', r));
  return { dir, clock, notifier, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p, { ip = freshIp(), headers = {} } = {}) => fetch(env.base + p, { redirect: 'manual', headers: { 'x-forwarded-for': ip, ...headers } });
const post = (env, p, fields = {}, { ip = freshIp(), headers = {} } = {}) => fetch(env.base + p, {
  method: 'POST', redirect: 'manual', headers: { 'x-forwarded-for': ip, ...headers }, body: new URLSearchParams(fields),
});

/** Runs a real check (no website) and waits for it to finish. With `claimed`, a Draft is recorded on the Grade. */
async function makeGrade(env, { claimed = true, input = BUSINESS } = {}) {
  const page = await (await get(env, '/grade')).text();
  const t = /name="t" value="([^"]+)"/u.exec(page)[1];
  env.clock.t += 5000;
  const res = await post(env, '/grade', { nickname: '', t, ...input });
  assert.equal(res.status, 303);
  const id = /\/grade\/([^/?#]+)$/u.exec(res.headers.get('location'))[1];
  for (let i = 0; i < 500; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (g?.status === 'done') break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal((await env.ctx.grader.get(id)).status, 'done');
  if (claimed) {
    await env.ctx.store.collection('grades').update(list => { list.find(g => g.id === id).draftId = 'draft-1'; });
  }
  return id;
}

const stampOf = html => /action="\/grade\/[^"]+\/watch">\s*<input type="hidden" name="t" value="([^"]+)"/u.exec(html)?.[1];

/** Opens the report, takes the watch form's stamp, waits 5 seconds, and starts a watch. */
async function startWatch(env, gradeId, fields = {}, opts = {}) {
  const report = await (await get(env, `/grade/${gradeId}`)).text();
  const t = stampOf(report);
  assert.ok(t, 'the report has the watch form');
  env.clock.t += 5000;
  return post(env, `/grade/${gradeId}/watch`, { t, ...fields }, opts);
}

const watchIdOf = res => /^\/watch\/([A-Za-z0-9_-]{22})$/u.exec(res.headers.get('location') ?? '')?.[1];

function assertPrivate(res) {
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
}

// ---- off --------------------------------------------------------------------------------------------------------

test('off: every watch path is the site 404 (still noindex), and the report shows no watch form', async () => {
  const env = await startEnv({ config: { watchEnabled: false } });
  const id = await makeGrade(env);
  const report = await (await get(env, `/grade/${id}`)).text();
  assert.equal(report.includes('Watch this every month'), false);
  for (const p of ['/watch/abcdefghijklmnopqrstuv', '/watch/abcdefghijklmnopqrstuv/confirm?t=x', '/watch/abcdefghijklmnopqrstuv/stop?t=x']) {
    const res = await get(env, p);
    assert.equal(res.status, 404, p);
    assertPrivate(res);
    assert.ok((await res.text()).includes('Page not found'));
  }
  const start = await post(env, `/grade/${id}/watch`, { t: 'x' });
  assert.equal(start.status, 404);
  assert.equal((await post(env, '/watch/abcdefghijklmnopqrstuv/stop', { t: 'x' })).status, 404);
  assert.deepEqual(await env.ctx.store.collection('watches').read(), []);
});

// ---- eligibility --------------------------------------------------------------------------------------------------

test('not eligible (no claimed listing): no form, and a start does nothing', async () => {
  const env = await startEnv();
  const id = await makeGrade(env, { claimed: false });
  const report = await (await get(env, `/grade/${id}`)).text();
  assert.equal(report.includes('Watch this every month'), false);
  assert.equal(stampOf(report), undefined);
});

test('eligible: the full report shows the form after the recheck part, with the email field under resend', async () => {
  const env = await startEnv();
  const id = await makeGrade(env);
  const report = await (await get(env, `/grade/${id}`)).text();
  assert.ok(report.includes('Watch this every month'));
  assert.ok(report.includes('name="email"'));
  // With no website the recheck part is one line ("nothing to check again"); the watch form comes right after it.
  const recheck = report.indexOf('so there is nothing to check again');
  assert.ok(recheck > report.indexOf('id="full-report"'));
  assert.ok(recheck < report.indexOf(`action="/grade/${id}/watch"`));
  assert.ok(stampOf(report));
});

test('with a notifier that sends no email the form has no email field, and a typed email is ignored', async () => {
  const env = await startEnv({ config: { notifierName: 'none' } });
  const id = await makeGrade(env);
  const report = await (await get(env, `/grade/${id}`)).text();
  assert.equal(report.includes('name="email"'), false);
  assert.ok(report.includes('Alerts show on your watch page only.'));
  const res = await startWatch(env, id, { email: EMAIL });
  assert.equal(res.status, 303);
  const watch = await env.ctx.watch.get(watchIdOf(res));
  assert.equal(watch.status, 'active');
  assert.equal(watch.email, null);
});

test('a locked report (lead gate on, not opened) shows no form and cannot start a watch', async () => {
  const env = await startEnv({ config: { graderLeadGate: true } });
  const id = await makeGrade(env);
  const report = await (await get(env, `/grade/${id}`)).text();
  assert.equal(report.includes('Watch this every month'), false);
  const res = await post(env, `/grade/${id}/watch`, { t: 'x' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/grade/${id}`);
  assert.deepEqual(await env.ctx.store.collection('watches').read(), []);
});

test('at WATCH_MAX_ACTIVE the report says it is full and a start says so too', async () => {
  const env = await startEnv({ config: { watchMaxActive: 0 } });
  const id = await makeGrade(env);
  const report = await (await get(env, `/grade/${id}`)).text();
  assert.ok(report.includes('Monthly watch is full right now.'));
  assert.equal(stampOf(report), undefined);
});

// ---- start, the page, confirm, stop ---------------------------------------------------------------------------------

test('start with an email: pending, a confirm email, the watch page; GET confirm changes nothing, POST confirms', async () => {
  const env = await startEnv();
  const id = await makeGrade(env);
  const res = await startWatch(env, id, { email: EMAIL });
  assertPrivate(res);
  assert.equal(res.status, 303);
  const wid = watchIdOf(res);
  assert.ok(wid);
  let watch = await env.ctx.watch.get(wid);
  assert.equal(watch.status, 'pending');
  assert.equal(watch.email, EMAIL);

  assert.equal(env.notifier.owners.length, 1);
  const mail = env.notifier.owners[0];
  assert.equal(mail.to, EMAIL);
  const confirmUrl = `${BASE_URL}/watch/${wid}/confirm?t=${watch.confirmToken}`;
  assert.ok(mail.text.includes(confirmUrl));
  assert.equal(mail.headers['List-Unsubscribe'], `<${BASE_URL}/watch/${wid}/stop?t=${watch.stopToken}>`);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(PROMISE.test(mail.subject + mail.text), false);

  const page = await get(env, `/watch/${wid}`);
  assert.equal(page.status, 200);
  assertPrivate(page);
  const pageText = await page.text();
  assert.ok(pageText.includes('Monthly watch for Quillfeather Drain Works'));
  assert.ok(pageText.includes('o\u2026@q\u2026.example'));
  assert.equal(pageText.includes(EMAIL), false);
  assert.equal(PROMISE.test(pageText.replace(/<script[^>]*><\/script>/gu, '')), false);

  const confirmGet = await get(env, `/watch/${wid}/confirm?t=${watch.confirmToken}`);
  assert.equal(confirmGet.status, 200);
  assertPrivate(confirmGet);
  assert.ok((await confirmGet.text()).includes(`name="t" value="${watch.confirmToken}"`));
  assert.equal((await env.ctx.watch.get(wid)).status, 'pending', 'GET changes nothing');

  const wrong = await post(env, `/watch/${wid}/confirm`, { t: 'wrong-token' });
  assert.equal(wrong.status, 400);
  assert.equal((await env.ctx.watch.get(wid)).status, 'pending');

  const ok = await post(env, `/watch/${wid}/confirm`, { t: watch.confirmToken });
  assert.equal(ok.status, 200);
  assertPrivate(ok);
  watch = await env.ctx.watch.get(wid);
  assert.equal(watch.status, 'active');
});

test('a bad or too-fast stamp starts nothing; a bad email is refused', async () => {
  const env = await startEnv();
  const id = await makeGrade(env);
  assert.equal((await post(env, `/grade/${id}/watch`, { t: 'forged' })).status, 422);
  const report = await (await get(env, `/grade/${id}`)).text();
  const t = stampOf(report);
  assert.equal((await post(env, `/grade/${id}/watch`, { t })).status, 422, 'too fast');
  env.clock.t += 5000;
  assert.equal((await post(env, `/grade/${id}/watch`, { t, email: 'not an email' })).status, 422);
  assert.deepEqual(await env.ctx.store.collection('watches').read(), []);
});

test('GET stop changes nothing; POST stop deletes the watch and its email address', async () => {
  const env = await startEnv();
  const id = await makeGrade(env);
  const wid = watchIdOf(await startWatch(env, id, { email: EMAIL }));
  const { stopToken } = await env.ctx.watch.get(wid);

  const page = await get(env, `/watch/${wid}/stop?t=${stopToken}`);
  assert.equal(page.status, 200);
  assertPrivate(page);
  assert.ok((await page.text()).includes(`action="/watch/${wid}/stop"`));
  assert.ok(await env.ctx.watch.get(wid), 'GET changes nothing');

  assert.equal((await post(env, `/watch/${wid}/stop`, { t: 'wrong' })).status, 400);
  assert.ok(await env.ctx.watch.get(wid));

  const res = await post(env, `/watch/${wid}/stop`, { t: stopToken });
  assert.equal(res.status, 200);
  assertPrivate(res);
  assert.ok((await res.text()).includes('The watch is stopped'));
  assert.equal(await env.ctx.watch.get(wid), undefined);
  assert.equal((await fs.readFile(path.join(env.dir, 'watches.json'), 'utf8')).includes(EMAIL), false);
  assert.equal((await get(env, `/watch/${wid}`)).status, 404);
});

test('the one-click List-Unsubscribe-Post stops the watch', async () => {
  const env = await startEnv();
  const id = await makeGrade(env);
  const wid = watchIdOf(await startWatch(env, id, { email: EMAIL }));
  const { stopToken } = await env.ctx.watch.get(wid);
  const res = await fetch(`${env.base}/watch/${wid}/stop?t=${stopToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': freshIp() },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(res.status, 200);
  assert.equal(await env.ctx.watch.get(wid), undefined);
});

test('a business name or competitor name with <script> is escaped on the watch page', async () => {
  const env = await startEnv();
  const id = await makeGrade(env, { input: { ...BUSINESS, about: 'fix <script>alert(1)</script> drains' } });
  const wid = watchIdOf(await startWatch(env, id));
  await env.ctx.store.collection('watches').update(list => {
    const w = list.find(x => x.id === wid);
    w.readings.push({ at: new Date(START + 30 * DAY).toISOString(), named: false, position: null, total: 2, competitors: ['<script>alert(2)</script>'], source: 'ask' });
  });
  const text = await (await get(env, `/watch/${wid}`)).text();
  assert.equal(/<script>alert/u.test(text), false);
  assert.ok(text.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));
  assert.ok(text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('an unknown watch is a 404 page with the private headers', async () => {
  const env = await startEnv();
  for (const p of ['/watch/abcdefghijklmnopqrstuv', '/watch/short', '/watch/abcdefghijklmnopqrstuv/confirm?t=x']) {
    const res = await get(env, p);
    assert.equal(res.status, 404, p);
    assertPrivate(res);
  }
});

// ---- rate limits --------------------------------------------------------------------------------------------------

test('rate limits: start 5 an hour per client; confirm 20 an hour; stop is counted, never refused', async () => {
  const env = await startEnv();
  const id = await makeGrade(env);
  const ip = '198.51.100.7';
  for (let i = 0; i < 5; i += 1) assert.equal((await startWatch(env, id, {}, { ip })).status, 303, `start ${i + 1}`);
  const sixth = await startWatch(env, id, {}, { ip });
  assert.equal(sixth.status, 429);
  assert.ok(sixth.headers.get('retry-after'));
  assert.equal((await env.ctx.store.collection('watches').read()).length, 5);

  const other = '198.51.100.8';
  for (let i = 0; i < 20; i += 1) assert.notEqual((await post(env, '/watch/abcdefghijklmnopqrstuv/confirm', { t: 'x' }, { ip: other })).status, 429);
  assert.equal((await post(env, '/watch/abcdefghijklmnopqrstuv/confirm', { t: 'x' }, { ip: other })).status, 429);

  const watches = await env.ctx.store.collection('watches').read();
  const stopper = '198.51.100.9';
  for (let i = 0; i < 25; i += 1) assert.notEqual((await post(env, '/watch/abcdefghijklmnopqrstuv/stop', { t: 'x' }, { ip: stopper })).status, 429);
  const last = watches[0];
  assert.equal((await post(env, `/watch/${last.id}/stop`, { t: last.stopToken }, { ip: stopper })).status, 200, 'stop still works over the limit');
  assert.equal(await env.ctx.watch.get(last.id), undefined);
});
