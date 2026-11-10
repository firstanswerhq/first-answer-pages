/**
 * Tests for admin sign-in: bearer token, login form, cookie, CSRF check,
 * lockout fix, logout, and the pending page wording.
 *
 * Requests go through node:http so the Cookie, Origin and Referer headers can
 * be set freely. Every app runs on a temporary DATA_DIR (copies of
 * listings.json and categories.json plus seeded drafts/pending files); the
 * real data/ directory is never written to. Throttling uses the real rate
 * limiter with a fake clock.
 *
 * Property: a correct token is always accepted, whatever the throttle state
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { DEFAULT_BASE_URL } from '../server/lib/config.js';
import { createRateLimiter } from '../server/lib/rate-limiter.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'admin login/token &=+ %20';
const COOKIE_VALUE = createHash('sha256').update(TOKEN).digest('hex');
const COOKIE = `fap_admin=${COOKIE_VALUE}`;
const HOUR = 60 * 60 * 1000;
const SUBMITTED_AT = '2026-11-10T20:15:00.000Z'; // 2:15 PM in Chicago (CST)

const HTML_ACCEPT = 'text/html,application/xhtml+xml';

// ---- fixtures ---------------------------------------------------------------

function pendingFixture() {
  return {
    drafts: [{
      id: 'd1',
      status: 'pending',
      provider: 'mock',
      fields: {
        name: 'Zephyrine Plumbing',
        category: 'plumbers',
        phone: '(615) 555-0101',
        services: ['Leak repair', 'Drain cleaning'],
        serviceArea: 'Greater Springfield',
        description: 'We fix pipes and leaks.',
        city: 'Springfield',
        state: 'TN',
      },
      missingFields: [],
      createdAt: SUBMITTED_AT,
      reservedId: 'zephyrine-1',
    }],
    pending: [{ id: 'd1', draftId: 'd1', submittedAt: SUBMITTED_AT, status: 'pending' }],
  };
}

// ---- environment ------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/**
 * @param {{ config?: object, limiter?: 'fake'|'permissive' }} [opts]
 * `config` is merged over { adminToken, baseUrl: DEFAULT_BASE_URL } so Origin
 * checks fall back to the Host header unless a test sets baseUrl.
 */
async function startEnv({ config = {}, limiter = 'permissive' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-adminlogin-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const { drafts, pending } = pendingFixture();
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify(drafts));
  await fs.writeFile(path.join(dir, 'pending.json'), JSON.stringify(pending));

  const clock = { t: Date.UTC(2026, 10, 10, 20, 30, 0), now() { return this.t; } };
  const rateLimiter = limiter === 'fake'
    ? createRateLimiter({ clock })
    : { consume: () => ({ allowed: true }), consumeAll: () => ({ allowed: true }), peek: () => ({ allowed: true }) };
  const app = createApp({
    dataDir: dir,
    clock,
    rateLimiter,
    config: { adminToken: TOKEN, baseUrl: DEFAULT_BASE_URL, ...config },
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

/** One HTTP request with no redirect following and no keep-alive. */
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
        setCookie: res.headers['set-cookie'] ?? [],
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const bearer = token => ({ authorization: `Bearer ${token}` });
const origin = env => `http://127.0.0.1:${env.port}`;
const loginBody = token => new URLSearchParams({ token }).toString();
const postLogin = (env, token) => request(env, { method: 'POST', path: '/admin/login', body: loginBody(token) });
const adminPending = (env, headers) => request(env, { path: '/admin/pending', headers });

async function readJson(env, name) {
  return JSON.parse(await fs.readFile(path.join(env.dir, name), 'utf8'));
}

// ---- bearer token and lockout -----------------------------------------------------

test('a wrong bearer token is 401 and each wrong attempt counts toward the limit', async () => {
  const env = await startEnv({ limiter: 'fake' });
  for (let i = 0; i < 10; i++) {
    const res = await adminPending(env, bearer(`wrong-${i}`));
    assert.equal(res.status, 401, `attempt ${i + 1}`);
    assert.equal(res.headers['www-authenticate'], 'Bearer');
    assert.deepEqual(JSON.parse(res.text), { error: 'Unauthorized' });
  }
  const eleventh = await adminPending(env, bearer('wrong-10'));
  assert.equal(eleventh.status, 429);
  assert.ok(Number(eleventh.headers['retry-after']) >= 1);
});

test('after 10 wrong attempts a correct token still works and another wrong one gets 429', async () => {
  const env = await startEnv({ limiter: 'fake' });
  for (let i = 0; i < 10; i++) assert.equal((await adminPending(env, bearer(`wrong-${i}`))).status, 401);
  assert.equal((await adminPending(env, bearer('still-wrong'))).status, 429);

  const ok = await adminPending(env, bearer(TOKEN));
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-type'], /html/);

  assert.equal((await adminPending(env, bearer('still-wrong-2'))).status, 429);

  // The window passes and wrong tokens count again from zero.
  env.clock.t += HOUR + 1000;
  assert.equal((await adminPending(env, bearer('fresh-wrong'))).status, 401);
});

test('a missing Authorization header from a throttled address is 429, a correct one is 200', async () => {
  const env = await startEnv({ limiter: 'fake' });
  for (let i = 0; i < 10; i++) await adminPending(env, bearer(`wrong-${i}`));
  assert.equal((await adminPending(env, { accept: 'application/json' })).status, 429);
  assert.equal((await adminPending(env, bearer(TOKEN))).status, 200);
});

test('Property: a correct bearer token is accepted after any number of wrong attempts', async () => {
  const env = await startEnv({ limiter: 'fake' });
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 30 }), async n => {
      env.clock.t += 2 * HOUR; // start each run with a fresh window
      for (let i = 0; i < n; i++) {
        const res = await adminPending(env, bearer(`wrong-${i}`));
        assert.equal(res.status, i < 10 ? 401 : 429, `wrong attempt ${i + 1} of ${n}`);
      }
      const ok = await adminPending(env, bearer(TOKEN));
      assert.equal(ok.status, 200, `correct token after ${n} wrong attempts`);
    }),
    { numRuns: 15 },
  );
});

test('browser GETs without a cookie are redirected and spend no attempts', async () => {
  const env = await startEnv({ limiter: 'fake' });
  for (let i = 0; i < 15; i++) {
    const res = await adminPending(env, { accept: HTML_ACCEPT });
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin/login');
  }
  assert.equal((await adminPending(env, bearer('wrong'))).status, 401, 'budget must be untouched');
});

// ---- login page and form post -----------------------------------------------------------

test('GET /admin/login is 200 with a password field and a POST form, no token needed', async () => {
  const env = await startEnv();
  const res = await request(env, { path: '/admin/login', headers: { accept: HTML_ACCEPT } });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.text, /<input type="password" id="token" name="token"/);
  assert.match(res.text, /<form method="POST" action="\/admin\/login"/);
  assert.match(res.headers['cache-control'], /no-store/);
  assert.match(res.headers['x-robots-tag'], /noindex/);
});

test('POST /admin/login with the right token: 303 to /admin/pending and a safe cookie', async () => {
  const env = await startEnv();
  const res = await postLogin(env, TOKEN);
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/admin/pending');

  assert.equal(res.setCookie.length, 1);
  const [cookie] = res.setCookie;
  assert.ok(cookie.startsWith(`fap_admin=${COOKIE_VALUE}; `), 'value is the SHA-256 hex of the token');
  assert.match(COOKIE_VALUE, /^[0-9a-f]{64}$/);
  assert.ok(!cookie.includes(TOKEN) && !cookie.includes(encodeURIComponent(TOKEN)), 'token must not be in the cookie');

  const attrs = cookie.split('; ').slice(1);
  assert.deepEqual(attrs, ['HttpOnly', 'SameSite=Strict', 'Path=/admin', 'Max-Age=43200']);
  assert.ok(!attrs.includes('Secure'), 'plain http outside production has no Secure flag');
});

test('POST /admin/login sets Secure when config.production is true', async () => {
  const env = await startEnv({ config: { production: true, demoMode: false } });
  const res = await postLogin(env, TOKEN);
  assert.equal(res.status, 303);
  const attrs = res.setCookie[0].split('; ').slice(1);
  assert.ok(attrs.includes('Secure'));
  assert.ok(attrs.includes('HttpOnly'));
  assert.ok(attrs.includes('SameSite=Strict'));
  assert.ok(attrs.includes('Path=/admin'));
  assert.ok(attrs.includes('Max-Age=43200'));
});

test('POST /admin/login with a wrong token: 401 page and no cookie', async () => {
  const env = await startEnv();
  for (const token of ['nope', '', TOKEN + 'x']) {
    const res = await postLogin(env, token);
    assert.equal(res.status, 401, JSON.stringify(token));
    assert.deepEqual(res.setCookie, []);
    assert.match(res.headers['content-type'], /html/);
    assert.ok(res.text.includes('That token is not right. Please try again.'));
    assert.ok(res.text.includes('type="password"'), 'the form is shown again');
    assert.ok(!res.text.includes(TOKEN));
  }
});

test('POST /admin/login with a missing body is 401, not an error', async () => {
  const env = await startEnv();
  const res = await request(env, { method: 'POST', path: '/admin/login', body: '' });
  assert.equal(res.status, 401);
  assert.deepEqual(res.setCookie, []);
});

test('login form: 10 wrong tries, then a wrong one is 429 but the right token still logs in', async () => {
  const env = await startEnv({ limiter: 'fake' });
  for (let i = 0; i < 10; i++) assert.equal((await postLogin(env, `wrong-${i}`)).status, 401);

  const blocked = await postLogin(env, 'wrong-again');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) >= 1);
  assert.ok(blocked.text.includes('Too many tries. Please wait and try again later.'));
  assert.deepEqual(blocked.setCookie, []);

  const ok = await postLogin(env, TOKEN);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.location, '/admin/pending');
  assert.equal(ok.setCookie.length, 1);
});

test('POST /admin/login is 403 when no admin token is configured', async () => {
  const env = await startEnv({ config: { adminToken: undefined } });
  const res = await postLogin(env, TOKEN);
  assert.equal(res.status, 403);
  assert.deepEqual(res.setCookie, []);
});

// ---- cookie access ----------------------------------------------------------------------------

test('the login cookie grants GET /admin/pending and /admin/quotes', async () => {
  const env = await startEnv();
  for (const p of ['/admin/pending', '/admin/quotes']) {
    const res = await request(env, { path: p, headers: { cookie: COOKIE, accept: HTML_ACCEPT } });
    assert.equal(res.status, 200, p);
    assert.match(res.headers['content-type'], /html/);
  }
});

test('the cookie from a real login works when sent back', async () => {
  const env = await startEnv();
  const login = await postLogin(env, TOKEN);
  const pair = login.setCookie[0].split(';')[0];
  const res = await adminPending(env, { cookie: pair, accept: HTML_ACCEPT });
  assert.equal(res.status, 200);
});

test('without a cookie: browser GET redirects to the login page, API clients get 401 JSON', async () => {
  const env = await startEnv();

  const browser = await adminPending(env, { accept: HTML_ACCEPT });
  assert.equal(browser.status, 302);
  assert.equal(browser.headers.location, '/admin/login');

  for (const headers of [{}, { accept: 'application/json' }, { ...bearer('wrong'), accept: HTML_ACCEPT }]) {
    const res = await adminPending(env, headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.equal(res.headers['www-authenticate'], 'Bearer');
    assert.deepEqual(JSON.parse(res.text), { error: 'Unauthorized' });
  }
});

test('a wrong cookie value is treated as no cookie', async () => {
  const env = await startEnv();
  const wrong = 'fap_admin=' + 'a'.repeat(64);
  const browser = await adminPending(env, { cookie: wrong, accept: HTML_ACCEPT });
  assert.equal(browser.status, 302);
  const api = await adminPending(env, { cookie: wrong });
  assert.equal(api.status, 401);
  // The raw token is not a valid cookie value either.
  const raw = await adminPending(env, { cookie: `fap_admin=${encodeURIComponent(TOKEN)}` });
  assert.equal(raw.status, 401);
});

test('a bearer token works without a cookie and without an Origin on POST', async () => {
  const env = await startEnv();
  const res = await request(env, { method: 'POST', path: '/admin/pending/d1/approve', headers: bearer(TOKEN) });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /json/);
  assert.deepEqual(JSON.parse(res.text), { ok: true, listingId: 'zephyrine-1' });
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'approved');
});

// ---- CSRF check ------------------------------------------------------------------------------------

test('cookie POST approve without Origin or Referer is 403 and changes nothing', async () => {
  const env = await startEnv();
  const res = await request(env, {
    method: 'POST', path: '/admin/pending/d1/approve', headers: { cookie: COOKIE, accept: HTML_ACCEPT },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(JSON.parse(res.text), { error: 'Forbidden' });
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'pending');
});

test('cookie POST approve with a foreign Origin or Referer is 403 and changes nothing', async () => {
  const env = await startEnv();
  for (const headers of [
    { origin: 'http://evil.example' },
    { origin: 'null' },
    { referer: 'http://evil.example/admin/pending' },
    // A lookalike host must not pass a prefix or suffix match.
    { origin: `http://127.0.0.1.evil.example:${env.port}` },
  ]) {
    const res = await request(env, {
      method: 'POST', path: '/admin/pending/d1/approve', headers: { cookie: COOKIE, accept: HTML_ACCEPT, ...headers },
    });
    assert.equal(res.status, 403, JSON.stringify(headers));
  }
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'pending');
});

test('cookie POST approve with a matching Origin (Host header, no baseUrl) redirects with a note', async () => {
  const env = await startEnv();
  const res = await request(env, {
    method: 'POST',
    path: '/admin/pending/d1/approve',
    headers: { cookie: COOKIE, accept: HTML_ACCEPT, origin: origin(env) },
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/admin/pending?note=approved&id=zephyrine-1');
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'approved');
  assert.deepEqual((await readJson(env, 'published.json')).map(l => l.id), ['zephyrine-1']);
});

test('cookie POST reject also needs a matching Referer when Origin is absent', async () => {
  const env = await startEnv();
  const res = await request(env, {
    method: 'POST',
    path: '/admin/pending/d1/reject',
    headers: { cookie: COOKIE, accept: HTML_ACCEPT, referer: `${origin(env)}/admin/pending` },
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/admin/pending?note=rejected');
  assert.equal((await readJson(env, 'pending.json'))[0].status, 'rejected');
});

test('with baseUrl set, Origin must match the baseUrl host, not the Host header', async () => {
  const env = await startEnv({ config: { baseUrl: 'https://pages.example.test' } });
  const path1 = '/admin/pending/d1/approve';
  const viaHost = await request(env, {
    method: 'POST', path: path1, headers: { cookie: COOKIE, accept: HTML_ACCEPT, origin: origin(env) },
  });
  assert.equal(viaHost.status, 403);

  const viaBase = await request(env, {
    method: 'POST', path: path1, headers: { cookie: COOKIE, accept: HTML_ACCEPT, origin: 'https://pages.example.test' },
  });
  assert.equal(viaBase.status, 303);
  assert.equal(viaBase.headers.location, '/admin/pending?note=approved&id=zephyrine-1');
});

// ---- logout ---------------------------------------------------------------------------------------

test('logout clears the cookie and redirects to the login page', async () => {
  const env = await startEnv();
  const res = await request(env, {
    method: 'POST', path: '/admin/logout', headers: { cookie: COOKIE, origin: origin(env) },
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, '/admin/login');
  assert.equal(res.setCookie.length, 1);
  const [cookie] = res.setCookie;
  assert.ok(cookie.startsWith('fap_admin=; '));
  const attrs = cookie.split('; ').slice(1);
  assert.deepEqual(attrs, ['HttpOnly', 'SameSite=Strict', 'Path=/admin', 'Max-Age=0']);
});

test('logout without a cookie still lands on the login page; a cookie with a foreign Origin is 403', async () => {
  const env = await startEnv();
  const anon = await request(env, { method: 'POST', path: '/admin/logout' });
  assert.equal(anon.status, 303);
  assert.equal(anon.headers.location, '/admin/login');
  assert.ok(anon.setCookie[0].includes('Max-Age=0'));

  const forged = await request(env, {
    method: 'POST', path: '/admin/logout', headers: { cookie: COOKIE, origin: 'http://evil.example' },
  });
  assert.equal(forged.status, 403);
  assert.deepEqual(forged.setCookie, []);
});

test('logout in production also carries Secure', async () => {
  const env = await startEnv({ config: { production: true, demoMode: false, baseUrl: 'https://pages.example.test' } });
  const res = await request(env, {
    method: 'POST', path: '/admin/logout', headers: { cookie: COOKIE, origin: 'https://pages.example.test' },
  });
  assert.equal(res.status, 303);
  assert.ok(res.setCookie[0].split('; ').includes('Secure'));
});

// ---- pending page wording ------------------------------------------------------------------------------

test('pending page shows Chicago time without a zone name, and no "curl" or "mock"', async () => {
  const env = await startEnv();
  const res = await adminPending(env, { cookie: COOKIE, accept: HTML_ACCEPT });
  assert.equal(res.status, 200);
  assert.ok(res.text.includes('Zephyrine Plumbing'), 'the pending entry is listed');
  assert.ok(res.text.includes('Submitted Nov 10, 2026, 2:15 PM'), 'Chicago time, no zone');
  assert.ok(!/\b(?:CST|CDT|UTC|GMT)\b/.test(res.text), 'no zone name');
  assert.ok(!/curl/i.test(res.text), 'no "curl"');
  assert.ok(!/mock/i.test(res.text), 'no "mock"');
  assert.ok(res.text.includes('Provider: Demo photo reader'));
});

test('the quotes page has no "curl" or "mock" either', async () => {
  const env = await startEnv();
  const res = await request(env, { path: '/admin/quotes', headers: { cookie: COOKIE, accept: HTML_ACCEPT } });
  assert.equal(res.status, 200);
  assert.ok(!/curl/i.test(res.text));
  assert.ok(!/mock/i.test(res.text));
});

test('the note query value is never echoed; only fixed notes appear', async () => {
  const env = await startEnv();
  const headers = { cookie: COOKIE, accept: HTML_ACCEPT };

  for (const note of ['<script>zzqq</script>', 'constructor', '__proto__', 'toString', 'zzqq']) {
    const res = await request(env, { path: `/admin/pending?note=${encodeURIComponent(note)}`, headers });
    assert.equal(res.status, 200, note);
    assert.ok(!res.text.includes('zzqq'), `note "${note}" echoed`);
    assert.ok(!res.text.includes('admin-note'), `note "${note}" produced a note box`);
  }

  const known = await request(env, { path: '/admin/pending?note=approved&id=zephyrine-1', headers });
  assert.ok(known.text.includes('<p class="admin-note" role="status">Approved.'));
  assert.ok(known.text.includes('href="/listings/zephyrine-1"'));

  // The id is only used to build an encoded link, never printed raw.
  const evil = await request(env, {
    path: `/admin/pending?note=approved&id=${encodeURIComponent('"><script>zzqq</script>')}`, headers,
  });
  assert.ok(!evil.text.includes('<script>zzqq'));
});
