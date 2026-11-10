/**
 * Tests for the admin review round (helper B): full preview before approval,
 * duplicate warnings, "are you sure" for reject/unpublish, the owner-email
 * reminder after approve, quote contact links and "Mark handled", the
 * "Run AI check" button, the login and whoami hints, and server-side expiry
 * of the login cookie.
 *
 * Every app runs on its own temporary DATA_DIR with copies of the repo's
 * listings.json (demo samples) and categories.json; the real data/ folder is
 * never written to. Requests go through node:http so Cookie and Origin can be
 * set freely.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { adminCookieValue } from '../server/lib/admin-auth.js';
import { createAiBudget } from '../server/lib/ai-budget.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'admin-review-token';
const BASE = 'https://pages.example.test';
const ORIGIN = BASE;
const T0 = Date.UTC(2026, 10, 10, 20, 30, 0); // 2:30 PM in Chicago
const HOUR = 60 * 60 * 1000;
const HTML = 'text/html,application/xhtml+xml';
const SEED_ID = 'nashville-pipe-pros';
const SEED_PHONE = '(555) 555-0101';

const cookieAt = t => `fap_admin=${adminCookieValue(TOKEN, t)}`;
const COOKIE = cookieAt(T0);
const browser = (extra = {}) => ({ cookie: COOKIE, accept: HTML, origin: ORIGIN, ...extra });
const bearer = { authorization: `Bearer ${TOKEN}` };

function draft(i, overrides = {}) {
  const { fields, ...rest } = overrides;
  return {
    id: `d${i}`,
    status: 'pending',
    provider: 'anthropic',
    fields: {
      name: `Zephyrine Plumbing ${i}`,
      category: 'plumbers',
      phone: `(615) 555-01${String(i).padStart(2, '0')}`,
      services: ['Leak repair', 'Drain cleaning'],
      serviceArea: 'Greater Springfield',
      description: 'We fix pipes.\nSame-day service.',
      city: 'Springfield',
      state: 'TN',
      hours: { monday: '8:00 AM - 5:00 PM', tuesday: '' },
      ...fields,
    },
    missingFields: [],
    createdAt: '2026-11-10T20:15:00.000Z',
    reservedId: `zephyrine-${i}`,
    ...rest,
  };
}
const queued = d => ({ id: d.id, draftId: d.id, submittedAt: d.createdAt, status: 'pending' });

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv({ drafts = [], quotes, config = {}, deps = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-adminreview-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify(drafts));
  await fs.writeFile(path.join(dir, 'pending.json'), JSON.stringify(drafts.map(queued)));
  if (quotes) await fs.writeFile(path.join(dir, 'quotes.json'), JSON.stringify(quotes));

  const clock = { t: T0, now() { return this.t; } };
  const app = createApp({
    dataDir: dir,
    clock,
    rateLimiter: { consume: () => ({ allowed: true }), consumeAll: () => ({ allowed: true }), peek: () => ({ allowed: true }) },
    config: { adminToken: TOKEN, baseUrl: BASE, demoMode: true, production: false, ...config },
    ...deps,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, clock, port: server.address().port };
}

function request(env, { method = 'GET', path: p, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body !== undefined) {
      h['content-type'] ??= 'application/x-www-form-urlencoded';
      h['content-length'] = String(Buffer.byteLength(body));
    }
    const req = http.request({ host: '127.0.0.1', port: env.port, path: p, method, headers: h, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const readJson = async (env, name) => JSON.parse(await fs.readFile(path.join(env.dir, name), 'utf8'));
const pendingPage = async (env, query = '') => (await request(env, { path: `/admin/pending${query}`, headers: browser() })).text;

// ---- 1. full preview ---------------------------------------------------------------------

test('the pending page shows a full preview with plain-words source and category label', async () => {
  const env = await startEnv({
    drafts: [
      draft(1, { fields: { address: '12 Main St', website: 'https://zeph.example', ownerEmail: 'owner1@example.com' } }),
      draft(2, { provider: 'manual' }),
      draft(3, { provider: 'mock' }),
    ],
  });
  const html = await pendingPage(env);
  assert.ok(html.includes('Plumbers &middot; Springfield, TN'), 'category label, not the slug');
  assert.ok(html.includes('<dt>Services</dt><dd>Leak repair, Drain cleaning</dd>'));
  assert.ok(html.includes('<dt>Description</dt><dd>We fix pipes.<br>Same-day service.</dd>'));
  assert.ok(html.includes('<dt>Hours</dt><dd>Monday: 8:00 AM - 5:00 PM</dd>'), 'blank days are left out');
  assert.ok(!html.includes('Tuesday:'));
  assert.ok(html.includes('<dt>Service area</dt><dd>Greater Springfield</dd>'));
  assert.ok(html.includes('<dt>Address</dt><dd>12 Main St</dd>'));
  assert.ok(html.includes('<dt>Website</dt><dd>https://zeph.example</dd>'));
  assert.ok(html.includes('<dt>Owner email (private)</dt><dd>owner1@example.com</dd>'));
  assert.ok(html.includes('Source: Read from a photo by Claude'));
  assert.ok(html.includes('Source: Typed in by the owner'));
  assert.ok(html.includes('Source: Demo photo reader'));
  assert.ok(!/mock/i.test(html));
});

test('the preview escapes every field', async () => {
  const bad = '<script>alert(1)</script>';
  const env = await startEnv({
    drafts: [draft(1, { fields: { name: bad, description: bad, services: [bad], serviceArea: bad, hours: { monday: bad } } })],
  });
  const html = await pendingPage(env);
  assert.ok(!html.includes(bad));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

// ---- 2. duplicate warning ----------------------------------------------------------------

test('a phone that matches a live listing or another pending entry is flagged', async () => {
  const env = await startEnv({
    drafts: [
      draft(1, { fields: { phone: '555.555.0101' } }), // same digits as the sample listing
      draft(2, { fields: { phone: '615-555-0777' } }),
      draft(3, { fields: { name: 'Zephyrine Again', phone: '(615) 555 0777' } }),
      draft(4, { fields: { phone: '(615) 555-0999' } }),
    ],
  });
  const html = await pendingPage(env);
  assert.ok(html.includes(`Same phone number as Nashville Pipe Pros, already live (<a href="/listings/${SEED_ID}">view it</a>)`));
  assert.ok(html.includes('Same phone number as Zephyrine Again, also waiting for review (<a href="#pending-d3">jump to it</a>)'));
  assert.ok(html.includes('Same phone number as Zephyrine Plumbing 2, also waiting for review (<a href="#pending-d2">jump to it</a>)'));
  assert.ok(!html.includes('below') && !html.includes('above'), 'no below/above wording');
  assert.ok(html.includes('id="pending-d2"'));
  const item4 = html.slice(html.indexOf('id="pending-d4"'));
  assert.ok(!item4.slice(0, item4.indexOf('</li>')).includes('Same phone number as'), 'a unique phone is not flagged');
});

// ---- 3. are you sure ---------------------------------------------------------------------

test('a browser reject asks first; "Yes, reject" rejects; bearer clients are not asked', async () => {
  const env = await startEnv({ drafts: [draft(1), draft(2)] });
  const ask = await request(env, { method: 'POST', path: '/admin/pending/d1/reject', headers: browser() });
  assert.equal(ask.status, 200);
  assert.ok(ask.text.includes("Reject Zephyrine Plumbing 1? This can&#39;t be undone."));
  assert.ok(ask.text.includes('name="confirm" value="yes"'));
  assert.ok(ask.text.includes('action="/admin/pending/d1/reject"'));
  assert.ok(ask.text.includes('>Yes, reject</button>'));
  assert.ok(ask.text.includes('<a href="/admin/pending">Cancel</a>'));
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'pending', 'nothing happened yet');

  const yes = await request(env, { method: 'POST', path: '/admin/pending/d1/reject', headers: browser(), body: 'confirm=yes' });
  assert.equal(yes.status, 303);
  assert.equal(yes.headers.location, '/admin/pending?note=rejected&id=d1');
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'rejected');

  const api = await request(env, { method: 'POST', path: '/admin/pending/d2/reject', headers: bearer });
  assert.equal(api.status, 200);
  assert.deepEqual(JSON.parse(api.text), { ok: true });
});

test('a browser unpublish asks first; the confirm button unpublishes', async () => {
  const env = await startEnv({ drafts: [draft(1)] });
  assert.equal((await request(env, { method: 'POST', path: '/admin/pending/d1/approve', headers: bearer })).status, 200);

  const ask = await request(env, { method: 'POST', path: '/admin/listings/zephyrine-1/unpublish', headers: browser() });
  assert.equal(ask.status, 200);
  assert.ok(ask.text.includes('Unpublish Zephyrine Plumbing 1? It comes off the site right away.'));
  assert.ok(ask.text.includes('>Yes, unpublish</button>'));
  assert.equal((await request(env, { path: '/listings/zephyrine-1' })).status, 200, 'still live');

  const yes = await request(env, {
    method: 'POST', path: '/admin/listings/zephyrine-1/unpublish', headers: browser(), body: 'confirm=yes',
  });
  assert.equal(yes.status, 303);
  assert.equal(yes.headers.location, '/admin/pending?note=unpublished&id=zephyrine-1');
  assert.equal((await request(env, { path: '/listings/zephyrine-1' })).status, 404);

  // A sample listing can't be unpublished: no confirm page, just the note.
  const seed = await request(env, { method: 'POST', path: `/admin/listings/${SEED_ID}/unpublish`, headers: browser() });
  assert.equal(seed.status, 303);
  assert.equal(seed.headers.location, '/admin/pending?note=failed');
});

test('the confirm step still needs a matching Origin for cookie posts', async () => {
  const env = await startEnv({ drafts: [draft(1)] });
  const res = await request(env, {
    method: 'POST', path: '/admin/pending/d1/reject', headers: browser({ origin: 'https://evil.example' }), body: 'confirm=yes',
  });
  assert.equal(res.status, 403);
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'pending');
});

// ---- 4. tell the owner -------------------------------------------------------------------

test('after approve the note shows the owner email to copy and a mailto link', async () => {
  const env = await startEnv({ drafts: [draft(1, { fields: { ownerEmail: 'pat.o+zeph@example.com' } }), draft(2)] });
  const res = await request(env, { method: 'POST', path: '/admin/pending/d1/approve', headers: browser() });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/admin/pending?note=approved&id=zephyrine-1');
  const html = await pendingPage(env, '?note=approved&id=zephyrine-1');
  assert.ok(html.includes('Let the owner know it\'s live: <span class="owner-email">pat.o+zeph@example.com</span>'));
  assert.ok(html.includes('href="mailto:pat.o%2Bzeph@example.com?subject=Your%20listing%20is%20live&amp;body=Good%20news'));
  assert.ok(html.includes(encodeURIComponent(`${BASE}/listings/zephyrine-1`)));

  await request(env, { method: 'POST', path: '/admin/pending/d2/approve', headers: bearer });
  const none = await pendingPage(env, '?note=approved&id=zephyrine-2');
  assert.ok(!none.includes('Let the owner know'), 'no owner email, no reminder');
});

// ---- 5. quotes ---------------------------------------------------------------------------

function quote(id, contact, extra = {}) {
  return {
    id, listingId: SEED_ID, name: 'Pat', contact, details: 'Leak under the sink.',
    createdAt: `2026-11-10T19:0${id.slice(-1)}:00.000Z`, notified: false, ...extra,
  };
}

test('quote contacts become tel:/mailto: links and the business phone is a tel: link', async () => {
  const env = await startEnv({
    quotes: [quote('q1', 'pat@example.com'), quote('q2', '(615) 555-0177'), quote('q3', 'call after 5 <b>')],
  });
  const html = (await request(env, { path: '/admin/quotes', headers: browser() })).text;
  assert.ok(html.includes('<a href="mailto:pat@example.com">pat@example.com</a>'));
  assert.ok(html.includes('<a href="tel:+16155550177">(615) 555-0177</a>'));
  assert.ok(html.includes('Contact: call after 5 &lt;b&gt;'), 'anything else stays plain, escaped text');
  assert.ok(html.includes(`Business phone: <a href="tel:+15555550101">${SEED_PHONE}</a>`));
  assert.ok(html.includes('action="/admin/quotes/q1/handled"'));
  assert.ok(html.includes('>Mark handled</button>'));
});

test('"Mark handled" saves handled and handledAt and moves the quote to the Handled list', async () => {
  const env = await startEnv({ quotes: [quote('q1', 'pat@example.com'), quote('q2', 'lee@example.com')] });
  const res = await request(env, { method: 'POST', path: '/admin/quotes/q1/handled', headers: browser() });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/admin/quotes?note=handled');
  const saved = await readJson(env, 'quotes.json');
  const q1 = saved.find(q => q.id === 'q1');
  assert.equal(q1.handled, true);
  assert.equal(q1.handledAt, new Date(T0).toISOString());
  assert.equal(saved.find(q => q.id === 'q2').handled, undefined);

  const html = (await request(env, { path: '/admin/quotes?note=handled', headers: browser() })).text;
  assert.ok(html.includes('Marked handled.'));
  const handledAt = html.indexOf('<h2>Handled</h2>');
  assert.ok(handledAt > 0);
  assert.ok(html.indexOf('lee@example.com') < handledAt, 'open quotes come first');
  assert.ok(html.indexOf('pat@example.com') > handledAt, 'handled quotes are listed below');
  assert.ok(!html.includes('action="/admin/quotes/q1/handled"'), 'no button on a handled quote');

  const missing = await request(env, { method: 'POST', path: '/admin/quotes/nope/handled', headers: bearer });
  assert.equal(missing.status, 404);
  const foreign = await request(env, {
    method: 'POST', path: '/admin/quotes/q2/handled', headers: browser({ origin: 'https://evil.example' }),
  });
  assert.equal(foreign.status, 403);
});

// ---- 6. Run AI check ---------------------------------------------------------------------

test('live owner listings get a "Run AI check (Séance)" button that runs and opens the report', async () => {
  const env = await startEnv({ drafts: [draft(1)] });
  await request(env, { method: 'POST', path: '/admin/pending/d1/approve', headers: bearer });
  const html = await pendingPage(env);
  assert.ok(html.includes('action="/admin/listings/zephyrine-1/seance"'));
  assert.ok(html.includes('>Run AI check (Séance)</button>'));

  const res = await request(env, { method: 'POST', path: '/admin/listings/zephyrine-1/seance', headers: browser() });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/seance/zephyrine-1');
  const runs = await readJson(env, 'seance.json');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].listingId, 'zephyrine-1');

  const api = await request(env, { method: 'POST', path: '/admin/listings/zephyrine-1/seance', headers: bearer });
  assert.equal(api.status, 201);
  assert.ok(JSON.parse(api.text).run);
});

test('Run AI check shows a clear note when it is not connected, over the limit, or the listing is gone', async () => {
  const off = await startEnv({ config: { production: true, demoMode: true } });
  const r1 = await request(off, { method: 'POST', path: `/admin/listings/${SEED_ID}/seance`, headers: browser() });
  assert.equal(r1.status, 303);
  assert.equal(r1.headers.location, '/admin/pending?note=seanceoff');
  assert.ok((await pendingPage(off, '?note=seanceoff')).includes('The AI check is not connected yet'));

  const spent = createAiBudget({ clock: { now: () => T0 }, limit: 1 });
  spent.consume({ kind: 'seance' });
  const limit = await startEnv({
    deps: {
      aiBudget: spent,
      assistantProvider: { name: 'anthropic', ask: async () => { throw new Error('must not be called'); } },
    },
  });
  const r2 = await request(limit, { method: 'POST', path: `/admin/listings/${SEED_ID}/seance`, headers: browser() });
  assert.equal(r2.headers.location, '/admin/pending?note=seancelimit');
  assert.ok((await pendingPage(limit, '?note=seancelimit')).includes("Today&#39;s limit for AI checks is reached"));
  const r2api = await request(limit, { method: 'POST', path: `/admin/listings/${SEED_ID}/seance`, headers: bearer });
  assert.equal(r2api.status, 429);

  const gone = await request(limit, { method: 'POST', path: '/admin/listings/nope/seance', headers: browser() });
  assert.equal(gone.headers.location, '/admin/pending?note=notfound');
});

// ---- 7. hints ----------------------------------------------------------------------------

test('the login page says where to find the token; whoami says what to look for', async () => {
  const env = await startEnv();
  const login = (await request(env, { path: '/admin/login' })).text;
  assert.ok(login.includes('Your admin token is in Render: open your service, then Environment, then ADMIN_TOKEN.'));
  const who = (await request(env, { path: '/admin/whoami', headers: browser() })).text;
  assert.ok(who.includes('What to look for:'));
  assert.ok(who.includes('change TRUST_PROXY in Render by one and check again'));
});

// ---- 8. cookie expiry --------------------------------------------------------------------

test('the login cookie stops working after 12 hours, on the server', async () => {
  const env = await startEnv();
  const at = () => request(env, { path: '/admin/pending', headers: { cookie: COOKIE } });
  assert.equal((await at()).status, 200);
  env.clock.t = T0 + 12 * HOUR; // exactly 12 hours: still fine
  assert.equal((await at()).status, 200);
  env.clock.t = T0 + 12 * HOUR + 1000;
  assert.equal((await at()).status, 401, 'expired cookie is no cookie');
  const browserGet = await request(env, { path: '/admin/pending', headers: { cookie: COOKIE, accept: HTML } });
  assert.equal(browserGet.status, 302);
  assert.equal(browserGet.headers.location, '/admin/login');
});

test('a tampered, future-dated or old-style cookie is rejected', async () => {
  const env = await startEnv();
  const get = cookie => request(env, { path: '/admin/pending', headers: { cookie } });
  const [stamp, mac] = adminCookieValue(TOKEN, T0).split('.');
  const flipped = mac.slice(0, -1) + (mac.endsWith('0') ? '1' : '0');
  assert.equal((await get(`fap_admin=${stamp}.${flipped}`)).status, 401, 'bad MAC');
  assert.equal((await get(`fap_admin=${T0 - 1000}.${mac}`)).status, 401, 'MAC for another time');
  assert.equal((await get(cookieAt(T0 + 2 * HOUR))).status, 401, 'issued in the future');
  assert.equal((await get(`fap_admin=${adminCookieValue('other-token', T0)}`)).status, 401, 'another token');
  assert.equal((await get('fap_admin=' + 'a'.repeat(64))).status, 401, 'old SHA-256 style value');
  assert.equal((await get(cookieAt(T0 - HOUR))).status, 200, 'an hour old is fine');
});

test('logging in issues a cookie stamped with the current time', async () => {
  const env = await startEnv();
  env.clock.t = T0 + 5 * HOUR;
  const res = await request(env, { method: 'POST', path: '/admin/login', body: new URLSearchParams({ token: TOKEN }).toString() });
  assert.equal(res.status, 303);
  const cookie = res.headers['set-cookie'][0];
  assert.ok(cookie.startsWith(`fap_admin=${adminCookieValue(TOKEN, T0 + 5 * HOUR)};`));
  assert.ok(!cookie.includes(TOKEN));
});
