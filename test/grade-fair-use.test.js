/**
 * high-tech-look Requirement 11: fair use of the AI part of the check. One full check with AI per business per
 * GRADE_AI_REPEAT_DAYS days (default 7, 0 is off); "Check again" stays free; the admin and Verified listings are never
 * limited; the report link on the "checked recently" page shows only to the browser that ran the check.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { configFromEnv, parseGradeAiRepeatDays, DEFAULT_GRADE_AI_REPEAT_DAYS } from '../server/lib/config.js';
import { sameBusinessInput, normalizeGradeInput } from '../server/lib/grader.js';
import { repeatCheckLines, fairUseDay } from '../server/lib/grade-html.js';
import { gradeAdminCookieValue, isGradeAdmin, GRADE_ADMIN_COOKIE } from '../server/lib/admin-auth.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 24, 18, 0, 0);
const DAY = 86400000;
const TOKEN = 'fair-use-token';
const servers = [];
const dirs = [];
after(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function startEnv({ config = {}, published, trust } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-fair-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  if (published) await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  if (trust) await fs.writeFile(path.join(dir, 'trust.json'), JSON.stringify(trust));
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co\n2. Another Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: null,
    placesLookup: null,
    bingLookup: null,
    safeFetcher: { async fetchText() { throw Object.assign(new Error('no network in tests'), { code: 'timeout' }); } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `fair${String(++n).padStart(18, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: TOKEN, trustProxy: 1,
      gradeAiCallsPerDay: 150, gradeMainAsks: 1, demoMode: false, gradeAiRepeatDays: 7, ...config,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise(r => server.once('listening', r));
  return { clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

let ip = 10;
/** Post the check form for one business; `cookie` and `headers` are sent as given. */
async function check(env, fields, { cookie = '', headers = {} } = {}) {
  const from = `203.0.113.${ip++}`; // a fresh address each time, so the per-address limits never get in the way
  const page = await (await fetch(`${env.base}/grade`, { headers: { 'x-forwarded-for': from } })).text();
  const t = /name="t" value="([^"]+)"/.exec(page)[1];
  env.clock.t += 5000;
  return fetch(`${env.base}/grade`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': from, ...(cookie ? { cookie } : {}), ...headers },
    body: new URLSearchParams({ nickname: '', t, state: 'TN', service: 'plumbers', website: '', ...fields }),
  });
}
const mineCookie = res => (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).filter(c => c.startsWith('gr_mine=')).join('; ');
const idOf = res => /\/grade\/([^/?#]+)$/.exec(res.headers.get('location') ?? '')?.[1];

const ZEPHYR = { name: 'Zephyr Plumbing', city: 'Nashville', website: 'https://zephyr.example/' };

test('11.1, 11.2: the same website within 7 days gets the "checked recently" page, with the link only for its runner', async () => {
  const env = await startEnv();
  const first = await check(env, ZEPHYR);
  assert.equal(first.status, 303);
  const id = idOf(first);
  const cookie = mineCookie(first);
  assert.ok(cookie, 'the browser remembers the checks it ran');

  // The same browser, a few days later: the message and the link to its own report.
  env.clock.t += 3 * DAY;
  const again = await check(env, { ...ZEPHYR, name: 'Zephyr Plumbing LLC', website: 'http://www.zephyr.example/contact' }, { cookie });
  assert.equal(again.status, 200);
  const text = await again.text();
  assert.ok(text.includes(`This business was checked on ${fairUseDay(new Date(START).toISOString())}.`));
  assert.ok(text.includes('Open that report and use Check again to see your website changes.'));
  assert.ok(text.includes(`so we ask them again after ${fairUseDay(new Date(START + 7 * DAY).toISOString())}.`));
  assert.ok(text.includes(`href="/grade/${id}"`), 'the runner gets the link');
  assert.equal((await env.ctx.store.collection('grades').read()).length, 1, 'no new check, no AI asked');

  // Anyone else: the same words and dates, and no link to that report.
  const other = await check(env, ZEPHYR);
  const otherText = await other.text();
  assert.equal(other.status, 200);
  assert.ok(otherText.includes('This business was checked on'));
  assert.equal(otherText.includes(`/grade/${id}`), false);
});

test('11.1: a different page on a shared host is a different business; day 8 runs again', async () => {
  const env = await startEnv();
  assert.equal((await check(env, { name: 'Joe Plumbing', city: 'Nashville', website: 'https://www.facebook.com/joeplumbing' })).status, 303);
  assert.equal((await check(env, { name: 'Bob Roofing', city: 'Nashville', website: 'https://www.facebook.com/bobroofing' })).status, 303);
  assert.equal((await check(env, { name: 'Joe Plumbing Co', city: 'Nashville', website: 'https://m.facebook.com/JoePlumbing/' })).status, 200, 'the same page');
  env.clock.t += 8 * DAY;
  assert.equal((await check(env, { name: 'Joe Plumbing', city: 'Nashville', website: 'https://www.facebook.com/joeplumbing' })).status, 303, 'day 8 runs');
});

test('11.1: with no website, the same name and city are the same business', async () => {
  const env = await startEnv();
  assert.equal((await check(env, { name: 'Ace Accounting', city: 'Nashville' })).status, 303);
  assert.equal((await check(env, { name: 'ACE  accounting', city: 'nashville' })).status, 200);
  assert.equal((await check(env, { name: 'Ace Accounting', city: 'Memphis' })).status, 303, 'another city');
});

test('11.3: the admin is never limited (the admin token, or the short /grade cookie of a signed-in admin)', async () => {
  const env = await startEnv();
  assert.equal((await check(env, ZEPHYR)).status, 303);
  assert.equal((await check(env, ZEPHYR, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 303);
  const cookie = `${GRADE_ADMIN_COOKIE}=${gradeAdminCookieValue(TOKEN, env.clock.now())}`;
  assert.equal((await check(env, ZEPHYR, { cookie })).status, 303);
  // A forged or old cookie is not the admin.
  assert.equal((await check(env, ZEPHYR, { cookie: `${GRADE_ADMIN_COOKIE}=${gradeAdminCookieValue('wrong', env.clock.now())}` })).status, 200);
  assert.equal(isGradeAdmin({ headers: { cookie } }, TOKEN, env.clock.now() + 13 * 60 * 60 * 1000), false, 'void after 12 hours');
});

test('11.3: a signed-in admin\'s page view sets the /grade cookie', async () => {
  const env = await startEnv();
  const login = await fetch(`${env.base}/admin/login`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: env.base },
    body: new URLSearchParams({ token: TOKEN }),
  });
  const adminCookie = (login.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ');
  // Batch 3 X14: a broken setup fails here instead of passing without checking anything.
  assert.ok(adminCookie.includes('fap_admin='), 'the sign-in set the admin cookie');
  const page = await fetch(`${env.base}/admin/pending`, { headers: { cookie: adminCookie, accept: 'text/html' } });
  const set = (page.headers.getSetCookie?.() ?? []).find(c => c.startsWith(`${GRADE_ADMIN_COOKIE}=`)) ?? '';
  assert.match(set, /Path=\/grade/);
  assert.match(set, /HttpOnly/);
  assert.equal(set.includes(TOKEN), false, 'never the token itself');
});

const RIDGE = {
  id: 'ridge-roofing-nashville', name: 'Ridge Roofing', category: 'roofers', phone: '(615) 555-0101',
  description: 'Roof repair.', city: 'Nashville', state: 'TN', services: ['Roof repair'], serviceArea: 'Nashville',
  hours: { monday: '8am-5pm' },
};
const RIDGE_TRUST = {
  [RIDGE.id]: {
    waivedAt: new Date(START - DAY).toISOString(), waivedBy: 'admin',
    phone: { number: '+16155550101', at: new Date(START - DAY).toISOString() },
    identity: { ref: 'vs_1', at: new Date(START - DAY).toISOString(), name: 'Ridge Roofing' },
  },
};

async function verifiedEnv() {
  const env = await startEnv({ published: [RIDGE], trust: RIDGE_TRUST });
  const verified = env.ctx.store.getTrustStatus?.(env.ctx.store.findById?.(RIDGE.id))?.verified;
  // Batch 3 X14: a broken setup fails here instead of passing without checking anything.
  assert.ok(verified === true, 'the listing is Verified');
  return env;
}

test('11.4: a Verified listing is not limited for its own business', async () => {
  const env = await verifiedEnv();
  assert.equal((await check(env, { name: 'Ridge Roofing', city: 'Nashville' })).status, 303);
  assert.equal((await check(env, { name: 'Ridge Roofing', city: 'Nashville' })).status, 303, 'not limited');
});

test('11.4, batch 3 X3: a Verified name with another website, or a close name, is limited like anyone else', async () => {
  const env = await verifiedEnv();
  const other = { name: 'Ridge Roofing', city: 'Nashville', website: 'https://not-ridge.example/' };
  assert.equal((await check(env, other)).status, 303);
  assert.equal((await check(env, other)).status, 200, 'the listing has no website, so this site is not its business');
  const close = { name: 'Ridge Roofing & Gutters', city: 'Nashville' };
  assert.equal((await check(env, close)).status, 303);
  assert.equal((await check(env, close)).status, 200, 'a close name is not the Verified name');
});

test('batch 3 X4: a check cut off by a restart (running, older than 4 minutes, no answers) does not limit', async () => {
  const env = await startEnv();
  const input = normalizeGradeInput({ ...ZEPHYR, state: 'TN', service: 'plumbers' }).input;
  const old = new Date(START - 10 * 60 * 1000).toISOString();
  await env.ctx.store.collection('grades').append({
    id: 'fairstale0000000000001', status: 'running', input, createdAt: old, startedAt: old, finishedAt: null,
    steps: [], results: [], ai: [],
  });
  assert.equal((await check(env, ZEPHYR)).status, 303, 'the stopped check asked nothing');
  assert.equal((await check(env, ZEPHYR)).status, 200, 'the new check counts');
});

test('batch 3 X6: a check the admin ran never turns the real owner away', async () => {
  const env = await startEnv();
  const byAdmin = await check(env, ZEPHYR, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(byAdmin.status, 303);
  const stored = (await env.ctx.store.collection('grades').read()).find(g => g.id === idOf(byAdmin));
  assert.equal(stored.byAdmin, true, 'the admin\'s check is marked');
  assert.equal((await check(env, ZEPHYR)).status, 303, 'the owner\'s own check runs');
});

test('batch 3 X16: signing out also ends the /grade admin cookie', async () => {
  const env = await startEnv();
  const res = await fetch(`${env.base}/admin/logout`, { method: 'POST', redirect: 'manual', headers: { origin: env.base } });
  assert.equal(res.status, 303);
  const set = (res.headers.getSetCookie?.() ?? []).find(c => c.startsWith(`${GRADE_ADMIN_COOKIE}=`)) ?? '';
  assert.match(set, new RegExp(`^${GRADE_ADMIN_COOKIE}=;`));
  assert.match(set, /Path=\/grade/);
  assert.match(set, /Max-Age=0/);
  assert.match(set, /HttpOnly/);
});

test('11.6: GRADE_AI_REPEAT_DAYS 0 turns the rule off; the default is 7', async () => {
  const env = await startEnv({ config: { gradeAiRepeatDays: 0 } });
  assert.equal((await check(env, ZEPHYR)).status, 303);
  assert.equal((await check(env, ZEPHYR)).status, 303);
  assert.equal(DEFAULT_GRADE_AI_REPEAT_DAYS, 7);
  assert.equal(parseGradeAiRepeatDays(undefined), 7);
  assert.equal(parseGradeAiRepeatDays('0'), 0);
  assert.equal(parseGradeAiRepeatDays('14'), 14);
  const warned = [];
  assert.equal(parseGradeAiRepeatDays('soon', m => warned.push(m)), 7);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].includes('soon'), false, 'the value is never echoed');
  assert.equal(configFromEnv({}, { warn: () => {} }).gradeAiRepeatDays, 7);
  assert.equal(configFromEnv({ GRADE_AI_REPEAT_DAYS: '3' }, { warn: () => {} }).gradeAiRepeatDays, 3);
  assert.equal(configFromEnv({ NODE_TEST_CONTEXT: 'child' }, { warn: () => {} }).gradeAiRepeatDays, 0, 'off in test runs unless set');
});

test('11.5: "Check again" (website only) is not limited', async () => {
  const env = await startEnv();
  const res = await check(env, ZEPHYR);
  const id = idOf(res);
  for (let i = 0; i < 600; i += 1) {
    const g = await env.ctx.grader.get(id);
    if (g && g.status !== 'running') break;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.equal((await env.ctx.grader.get(id)).status, 'done');
  assert.deepEqual(await env.ctx.grader.recheck(id), { started: true });
});

test('11.1: on a shared host the typed page is kept beside the home page the check reads (which is unchanged)', () => {
  const form = website => normalizeGradeInput({ name: 'Joe Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website }).input;
  const joe = form('https://www.facebook.com/joeplumbing');
  const bob = form('https://www.facebook.com/bobroofing/');
  assert.equal(joe.website, 'https://www.facebook.com/', 'the check still reads the same home page');
  assert.equal(joe.websitePage, 'https://www.facebook.com/joeplumbing');
  assert.equal(sameBusinessInput(joe, bob), false, 'different Facebook pages are different businesses');
  assert.equal(sameBusinessInput(joe, form('https://m.facebook.com/JoePlumbing/')), true);
  assert.equal(sameBusinessInput(joe, form('https://www.facebook.com/')), false, 'facebook.com alone says nothing');
  // An own domain keeps only its home page, as before.
  const own = form('https://zephyr.example/about');
  assert.equal(own.website, 'https://zephyr.example/');
  assert.equal('websitePage' in own, false);
  assert.equal(form('https://facebook.com/profile.php?id=7').websitePage, 'https://facebook.com/profile.php?id=7');
});

test('11.1, batch 3 X5: the same website AND (the same host, or the same city and state) is the same business', () => {
  const form = (website, city = 'Nashville', state = 'TN') =>
    normalizeGradeInput({ name: 'Mr Rooter', city, state, service: 'plumbers', website }).input;
  const same = (a, b) => sameBusinessInput(a, b);
  // Franchise locations on their own subdomains in other cities are different businesses.
  assert.equal(same(form('https://nashville.mrrooter.example/'), form('https://memphis.mrrooter.example/', 'Memphis')), false);
  assert.equal(same(form('https://nashville.mrrooter.example/', 'Nashville', 'TN'), form('https://nashville.mrrooter.example/', 'Nashville', 'KY')), true, 'the same host');
  // The same domain in the same city and state is the same business, whatever page was typed.
  assert.equal(same(form('https://mrrooter.example/'), form('https://www.mrrooter.example/nashville')), true);
  assert.equal(same(form('https://nashville.mrrooter.example/'), form('https://mrrooter.example/')), true, 'same city and state');
  assert.equal(same(form('https://mrrooter.example/'), form('https://mrrooter.example/', 'Memphis')), true, 'the same host, another city');
  // Shared hosts: the page decides, ignoring case, a trailing slash, www. and m.
  assert.equal(same(form('https://www.instagram.com/joeplumbing'), form('https://instagram.com/bobroofing')), false);
  assert.equal(same(form('https://www.instagram.com/joeplumbing'), form('https://m.instagram.com/JoePlumbing/', 'Memphis')), true);
  assert.equal(same(form('https://www.yelp.com/biz/joe-plumbing'), form('https://www.yelp.com/biz/bob-roofing')), false);
  // With no website, a different state is a different business.
  assert.equal(same(form(''), form('', 'Nashville', 'KY')), false);
  assert.equal(same(form(''), form('')), true);
});

test('11.7: the business match follows the rules; the page sentences are short and plain', () => {
  const at = (a, b) => sameBusinessInput(a, b);
  assert.equal(at({ website: 'https://zephyr.example/' }, { website: 'http://www.zephyr.example/about' }), true);
  assert.equal(at({ website: 'https://zephyr.example/' }, { website: 'https://other.example/' }), false);
  assert.equal(at({ website: 'https://joe.wixsite.com/site' }, { website: 'https://bob.wixsite.com/site' }), false);
  assert.equal(at({ website: 'https://joe.wixsite.com/site' }, { website: 'https://joe.wixsite.com/site/' }), true);
  assert.equal(at({ website: 'https://facebook.com/profile.php?id=1' }, { website: 'https://facebook.com/profile.php?id=2' }), false);
  assert.equal(at({ name: 'Ace', city: 'Nashville' }, { name: 'ace', city: 'NASHVILLE' }), true);
  assert.equal(at({ name: 'Ace', city: 'Nashville' }, { name: 'Ace', city: 'Memphis' }), false);
  // The business's own domain: www., http and another path are the same business; a missing state on both is equal.
  const zephyr = { name: 'Zephyr Plumbing', city: 'Nashville', state: '', website: 'https://zephyr.example/' };
  assert.equal(at(zephyr, { name: 'Zephyr Plumbing LLC', city: 'Nashville', state: '', website: 'http://www.zephyr.example/contact' }), true);
  assert.equal(at(zephyr, { name: 'Zephyr Plumbing LLC', city: 'Nashville', website: 'http://www.zephyr.example/' }), true);
  assert.equal(at({ ...zephyr, state: undefined }, { ...zephyr, website: 'https://ZEPHYR.example/about/' }), true);
  // Batch 3 X7: with no website, the state counts too.
  assert.equal(at({ name: 'Ace', city: 'Springfield', state: 'IL' }, { name: 'Ace', city: 'Springfield', state: 'TN' }), false);
  assert.equal(at({ name: 'Ace', city: 'Springfield', state: 'TN' }, { name: 'ace', city: 'springfield', state: 'tn' }), true);
  for (const line of repeatCheckLines({ checkedAt: new Date(START).toISOString(), againAt: new Date(START + 7 * DAY).toISOString() })) {
    assert.ok(line.length <= 160, line);
    assert.equal(/guarantee|\$\d|colour|centre|will (?:name|recommend)/i.test(line), false, line);
  }
});
