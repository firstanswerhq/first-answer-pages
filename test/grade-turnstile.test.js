/**
 * The human check on the AI Visibility Check form (Feature G, task G2): Cloudflare Turnstile.
 * A fake verifier or a fake fetch stands in for Cloudflare; nothing here uses the network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createTurnstile, SITEVERIFY_URL } from '../server/lib/turnstile.js';
import { configFromEnv, redactConfig } from '../server/lib/config.js';
import { failedPage } from '../server/lib/grade-html.js';
import { RULES } from '../server/lib/rate-limiter.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);
const SITE_KEY = 'site-key-ABC123';
const SECRET = 'secret-key-XYZ789';
const GOOD = 'good-token-111';
const MESSAGE = "Please try again: we couldn't confirm you're a person.";
// The page escapes apostrophes, so the message is compared the way it appears in the HTML.
const escaped = text => text.replace(/'/g, '&#39;');
const BLOCKER_LINE = 'If no box appears, turn off ad blockers or try another browser.';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const NOSCRIPT_LINE = "Turn on JavaScript to confirm you're a person.";
const PRIVACY_LINE = 'uses Cloudflare Turnstile to confirm you are a person';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/** Everything written to stderr while `fn` runs. */
async function captureStderr(fn) {
  const original = process.stderr.write;
  let text = '';
  process.stderr.write = (chunk, ...rest) => {
    text += String(chunk);
    const cb = rest.find(r => typeof r === 'function');
    if (cb) cb();
    return true;
  };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return text;
}

/** A fake verifier that records what it was asked. */
function fakeVerifier(answer = token => (token === GOOD ? 'ok' : 'failed')) {
  const calls = [];
  return {
    siteKey: SITE_KEY,
    calls,
    async verify(token, ip) {
      calls.push({ token, ip });
      const a = typeof answer === 'function' ? answer(token) : answer;
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

async function startEnv({ turnstile, config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-turnstile-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const counts = { asked: 0, fetched: 0 };
  const assistant = {
    name: 'anthropic',
    async ask() { counts.asked += 1; return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; },
  };
  const safeFetcher = {
    async fetchText() { counts.fetched += 1; throw new Error('no network in tests'); },
  };
  const deps = {
    dataDir: dir,
    clock,
    assistantProvider: assistant,
    extraAssistants: [],
    safeFetcher,
    newGradeId: () => `turn${String(++n).padStart(18, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'turnstile-test-token',
      trustProxy: 1, gradeAiCallsPerDay: 150, ...config,
    },
  };
  if (turnstile !== undefined) deps.turnstile = turnstile;
  const app = createApp(deps);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { dir, clock, counts, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p, ip = '203.0.113.1') => fetch(`${env.base}${p}`, { headers: { 'x-forwarded-for': ip } });

let service = 0;

/** Post the check form from `ip`; `extra` adds fields (such as the widget's token). */
async function startCheck(env, ip, extra = {}, website = '') {
  const page = await (await get(env, '/grade', ip)).text();
  const t = /name="t" value="([^"]+)"/.exec(page)[1];
  env.clock.t += 5000;
  service += 1;
  return fetch(`${env.base}/grade`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': ip },
    body: new URLSearchParams({
      nickname: '', t, name: `Shop ${service}`, city: 'Nashville', state: 'TN', service: 'accountants', website, ...extra,
    }),
  });
}

const withToken = token => ({ 'cf-turnstile-response': token });

// ---- the verifier -------------------------------------------------------------------------------

test('G2: createTurnstile gives null unless both keys are set', () => {
  assert.equal(createTurnstile({}), null);
  assert.equal(createTurnstile({ siteKey: SITE_KEY }), null);
  assert.equal(createTurnstile({ secretKey: SECRET }), null);
  assert.equal(createTurnstile({ siteKey: '  ', secretKey: SECRET }), null);
  assert.equal(createTurnstile({ siteKey: SITE_KEY, secretKey: '' }), null);
  const on = createTurnstile({ siteKey: ` ${SITE_KEY} `, secretKey: SECRET, fetch: async () => ({}) });
  assert.equal(on.siteKey, SITE_KEY);
  assert.equal(typeof on.verify, 'function');
});

function reply(body, { ok = true } = {}) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

function verifierWith(fetchImpl) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
  return { turnstile: createTurnstile({ siteKey: SITE_KEY, secretKey: SECRET, fetch, timeoutMs: 1000 }), calls };
}

test('G2: verify sends one fixed, no-redirect request and maps Cloudflare replies', async () => {
  const { turnstile, calls } = verifierWith(() => reply({ success: true }));
  assert.equal(await turnstile.verify(GOOD, '203.0.113.9'), 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SITEVERIFY_URL);
  assert.equal(SITEVERIFY_URL, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal, 'it has a time limit');
  const sent = new URLSearchParams(String(calls[0].init.body));
  assert.equal(sent.get('secret'), SECRET);
  assert.equal(sent.get('response'), GOOD);
  assert.equal(sent.get('remoteip'), '203.0.113.9');
});

test('G2: no token, a token that is not text, or one over 2,048 characters is failed with no call', async () => {
  const { turnstile, calls } = verifierWith(() => reply({ success: true }));
  for (const bad of [undefined, null, '', 42, {}, ['a'], 'x'.repeat(2049)]) {
    assert.equal(await turnstile.verify(bad, '203.0.113.9'), 'failed');
  }
  assert.equal(calls.length, 0);
  assert.equal(await turnstile.verify('x'.repeat(2048), '203.0.113.9'), 'ok');
  assert.equal(calls.length, 1);
});

test('G2: success false is failed, except the three codes that mean the setup is wrong', async () => {
  for (const code of ['invalid-input-response', 'timeout-or-duplicate', 'bad-request']) {
    const { turnstile } = verifierWith(() => reply({ success: false, 'error-codes': [code] }));
    assert.equal(await turnstile.verify(GOOD, '203.0.113.9'), 'failed', code);
  }
  assert.equal(await verifierWith(() => reply({ success: false })).turnstile.verify(GOOD, 'x'), 'failed');
  for (const code of ['invalid-input-secret', 'missing-input-secret', 'internal-error']) {
    const { turnstile } = verifierWith(() => reply({ success: false, 'error-codes': ['other', code] }));
    assert.equal(await turnstile.verify(GOOD, '203.0.113.9'), 'misconfigured', code);
  }
});

test('G2: a network error, a timeout, a server error status or an unreadable reply is unreachable', async () => {
  const cases = [
    () => { throw new TypeError('fetch failed'); },
    () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; },
    () => reply({}, { ok: false }),
    () => ({ ok: true, json: async () => { throw new SyntaxError('not json'); } }),
    () => reply(null),
    () => reply('text'),
    () => reply({ nothing: 'useful' }),
  ];
  for (const make of cases) {
    const { turnstile } = verifierWith(make);
    assert.equal(await turnstile.verify(GOOD, '203.0.113.9'), 'unreachable');
  }
});

// ---- the setting --------------------------------------------------------------------------------

test('G2: TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are trimmed, empty when unset, and the secret is hidden when the config is shown', () => {
  const on = configFromEnv({ TURNSTILE_SITE_KEY: ` ${SITE_KEY} `, TURNSTILE_SECRET_KEY: ` ${SECRET}\n` }, { warn() {} });
  assert.equal(on.turnstileSiteKey, SITE_KEY);
  assert.equal(on.turnstileSecretKey, SECRET);
  const off = configFromEnv({}, { warn() {} });
  assert.equal(off.turnstileSiteKey, '');
  assert.equal(off.turnstileSecretKey, '');
  assert.equal(JSON.stringify(redactConfig(on)).includes(SECRET), false);
});

test('G2: the app builds the check from the two keys, and from nothing without them', async () => {
  const on = await startEnv({ config: { turnstileSiteKey: SITE_KEY, turnstileSecretKey: SECRET } });
  assert.equal(on.ctx.turnstile.siteKey, SITE_KEY);
  const oneKey = await startEnv({ config: { turnstileSiteKey: SITE_KEY } });
  assert.equal(oneKey.ctx.turnstile, null);
  const off = await startEnv();
  assert.equal(off.ctx.turnstile, null);
  const injected = fakeVerifier();
  assert.equal((await startEnv({ turnstile: injected })).ctx.turnstile, injected);
});

// ---- the form -----------------------------------------------------------------------------------

test('G2: with the check off, the form has no widget, script or noscript line, and a check runs without a token', async () => {
  const env = await startEnv({ turnstile: null });
  const page = await (await get(env, '/grade')).text();
  assert.equal(page.includes('cf-turnstile'), false);
  assert.equal(page.includes('challenges.cloudflare.com'), false);
  assert.equal(page.includes(NOSCRIPT_LINE), false);
  assert.equal((await startCheck(env, '203.0.113.5')).status, 303);
});

test('G2: with the check on, the form has the widget before the button, the script in the head and the noscript line', async () => {
  const env = await startEnv({ turnstile: fakeVerifier() });
  const page = await (await get(env, '/grade')).text();
  assert.ok(page.includes(`<div class="cf-turnstile" data-sitekey="${SITE_KEY}"></div>`));
  assert.ok(page.includes(`<script src="${SCRIPT}" async defer></script>`));
  assert.ok(page.includes(`<noscript><p class="hint">${NOSCRIPT_LINE}</p></noscript>`));
  assert.ok(page.indexOf('cf-turnstile') < page.indexOf('Check my business'));
  assert.ok(page.indexOf(SCRIPT) < page.indexOf('<body'));
  assert.equal(page.includes(SECRET), false);
});

test('G2: the site key is escaped on the form', async () => {
  const verifier = { ...fakeVerifier(), siteKey: '"><script>x</script>' };
  const env = await startEnv({ turnstile: verifier });
  const page = await (await get(env, '/grade')).text();
  assert.equal(page.includes('"><script>x</script>'), false);
  assert.ok(page.includes('data-sitekey="&quot;&gt;&lt;script&gt;x&lt;/script&gt;"'));
});

test("G2: the form page's Content-Security-Policy is still only frame-ancestors 'none'", async () => {
  for (const turnstile of [null, fakeVerifier()]) {
    const env = await startEnv({ turnstile });
    const res = await get(env, '/grade');
    assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'none'");
  }
});

// ---- the route ----------------------------------------------------------------------------------

test('G2: a missing or bad token gives 422 with the message, keeps the entries, and starts nothing', async () => {
  const verifier = fakeVerifier();
  const env = await startEnv({ turnstile: verifier });
  for (const extra of [{}, withToken(''), withToken('bad-token')]) {
    const res = await startCheck(env, '203.0.113.5', extra, 'example.com');
    assert.equal(res.status, 422);
    const text = await res.text();
    assert.ok(text.includes(escaped(MESSAGE)));
    assert.ok(text.includes(BLOCKER_LINE));
    assert.ok(text.includes(`value="Shop ${service}"`), 'the entries are kept');
    assert.ok(text.includes('value="example.com"'));
    assert.ok(text.includes('cf-turnstile'), 'the form carries the widget again');
  }
  assert.equal(env.counts.asked, 0, 'no AI call');
  assert.equal(env.counts.fetched, 0, 'no website fetch');
  assert.ok(verifier.calls.every(c => c.ip === '203.0.113.5'));
});

test('G2: a good token runs the check', async () => {
  const verifier = fakeVerifier();
  const env = await startEnv({ turnstile: verifier });
  const res = await startCheck(env, '203.0.113.5', withToken(GOOD));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/grade\/[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(verifier.calls.map(c => c.token), [GOOD]);
});

test('G2: the form checks come first: a bad form never reaches the verifier', async () => {
  const verifier = fakeVerifier();
  const env = await startEnv({ turnstile: verifier });
  const res = await startCheck(env, '203.0.113.5', { ...withToken(GOOD), city: '' });
  assert.equal(res.status, 422);
  assert.equal(verifier.calls.length, 0);
  const trapped = await startCheck(env, '203.0.113.5', { ...withToken(GOOD), nickname: 'bot' });
  assert.equal(trapped.status, 422);
  assert.equal(verifier.calls.length, 0);
});

test('G2: a failed human check uses none of the per-address or per-network counts', async () => {
  const env = await startEnv({ turnstile: fakeVerifier(), config: { gradeNetworkPerDay: 1 } });
  for (let i = 0; i < 8; i += 1) assert.equal((await startCheck(env, '203.0.113.5', withToken('bad'))).status, 422);
  const limiter = env.ctx.gradeLimiter;
  assert.equal(limiter.peek('grade:203.0.113.5', { ...RULES.grade, limit: 1 }).allowed, true);
  assert.equal(limiter.peek('grade-day:203.0.113.5', { ...RULES['grade-day'], limit: 1 }).allowed, true);
  assert.equal(limiter.peek('grade-network:203.0.113', { ...RULES['grade-network'], limit: 1 }).allowed, true);
  // The one check the network allows is still there.
  assert.equal((await startCheck(env, '203.0.113.5', withToken(GOOD))).status, 303);
});

test('G2: the limits still apply after a good token', async () => {
  const env = await startEnv({ turnstile: fakeVerifier() });
  for (let i = 0; i < 5; i += 1) assert.equal((await startCheck(env, '203.0.113.7', withToken(GOOD))).status, 303);
  assert.equal((await startCheck(env, '203.0.113.7', withToken(GOOD))).status, 429);
});

test('G2: when Cloudflare cannot be reached the check goes through, and the log says only turnstile=unreachable', async () => {
  for (const answer of ['unreachable', new Error(`boom ${SECRET} ${GOOD}`)]) {
    const env = await startEnv({ turnstile: fakeVerifier(answer) });
    let status;
    const log = await captureStderr(async () => {
      status = (await startCheck(env, '203.0.113.5', withToken(GOOD))).status;
    });
    assert.equal(status, 303);
    assert.ok(log.includes('turnstile=unreachable'));
    assert.equal(log.includes(SECRET), false);
    assert.equal(log.includes(GOOD), false);
  }
});

for (const code of ['invalid-input-secret', 'missing-input-secret', 'internal-error']) {
  test(`G2: Cloudflare error ${code} lets the check through and logs turnstile=misconfigured without the secret`, async () => {
    const { turnstile } = verifierWith(() => reply({ success: false, 'error-codes': [code] }));
    const env = await startEnv({ turnstile });
    let status;
    const log = await captureStderr(async () => {
      status = (await startCheck(env, '203.0.113.5', withToken(GOOD))).status;
    });
    assert.equal(status, 303);
    assert.ok(log.includes('turnstile=misconfigured'));
    assert.equal(log.includes(SECRET), false);
    assert.equal(log.includes(GOOD), false);
  });
}

for (const code of ['invalid-input-response', 'timeout-or-duplicate']) {
  test(`G2: Cloudflare error ${code} turns the check away`, async () => {
    const { turnstile } = verifierWith(() => reply({ success: false, 'error-codes': [code] }));
    const env = await startEnv({ turnstile });
    const res = await startCheck(env, '203.0.113.5', withToken(GOOD));
    assert.equal(res.status, 422);
    assert.ok((await res.text()).includes(escaped(MESSAGE)));
    assert.equal(env.counts.asked, 0);
  });
}

test('G2: neither the token nor the secret is logged or shown, pass or fail', async () => {
  const { turnstile } = verifierWith((url, init) => reply({ success: new URLSearchParams(String(init.body)).get('response') === GOOD }));
  const env = await startEnv({ turnstile });
  let shown = '';
  const log = await captureStderr(async () => {
    for (const token of [GOOD, 'another-token-222']) {
      const res = await startCheck(env, '203.0.113.5', withToken(token));
      shown += await res.text();
    }
    shown += await (await get(env, '/grade')).text();
    shown += await (await get(env, '/privacy')).text();
  });
  for (const secretish of [SECRET, GOOD, 'another-token-222']) {
    assert.equal(log.includes(secretish), false, 'log');
    assert.equal(shown.includes(secretish), false, 'pages');
  }
});

// ---- the failed page ----------------------------------------------------------------------------

const FAILED_GRADE = {
  id: 'AAAAAAAAAAAAAAAAAAAAAA',
  input: { name: 'Slow Co', city: 'Nashville', state: 'TN', service: 'plumbers', website: null },
};

test('G2: the "Start again" form carries the widget, script and noscript line only when the check is on', () => {
  const on = failedPage(FAILED_GRADE, { stamp: 'stamp', turnstileSiteKey: SITE_KEY });
  assert.ok(on.includes(`<div class="cf-turnstile" data-sitekey="${SITE_KEY}"></div>`));
  assert.ok(on.includes(`<script src="${SCRIPT}" async defer></script>`));
  assert.ok(on.includes(NOSCRIPT_LINE));
  assert.ok(on.indexOf('cf-turnstile') < on.indexOf('Start again'));
  for (const off of [failedPage(FAILED_GRADE, { stamp: 'stamp' }), failedPage(FAILED_GRADE, { stamp: 'stamp', turnstileSiteKey: '' })]) {
    assert.equal(off.includes('cf-turnstile'), false);
    assert.equal(off.includes('challenges.cloudflare.com'), false);
    assert.equal(off.includes(NOSCRIPT_LINE), false);
    assert.ok(off.includes('Start again'));
  }
});

test('G2: the failed page on the site carries the widget with the check on and none with it off', async () => {
  const base = {
    input: FAILED_GRADE.input,
    key: 'k', finishedAt: null, steps: [], facts: null, results: [], ai: [], score: null,
    previousScore: null, draftId: null, recheckedAt: null,
  };
  for (const [turnstile, expected] of [[fakeVerifier(), true], [null, false]]) {
    const env = await startEnv({ turnstile });
    const id = `stale${'0'.repeat(17)}`;
    await env.ctx.store.collection('grades').append({
      ...base, id, status: 'running', createdAt: new Date(env.clock.t - 5 * 60 * 1000).toISOString(),
    });
    const text = await (await get(env, `/grade/${id}`)).text();
    assert.ok(text.includes("This check didn't finish"));
    assert.equal(text.includes('cf-turnstile'), expected);
    assert.equal(text.includes(SCRIPT), expected);
    assert.equal(text.includes(NOSCRIPT_LINE), expected);
  }
});

// ---- the privacy page ---------------------------------------------------------------------------

test('G2: the privacy sentence shows only with the check on', async () => {
  const on = await startEnv({ turnstile: fakeVerifier() });
  const shown = await (await get(on, '/privacy')).text();
  assert.ok(shown.includes('The form that starts an AI Visibility Check uses Cloudflare Turnstile to confirm you are a person; Cloudflare receives your address and browser details under its own privacy terms.'));
  const off = await startEnv({ turnstile: null });
  assert.equal((await (await get(off, '/privacy')).text()).includes(PRIVACY_LINE), false);
});

// ---- README and render.yaml ---------------------------------------------------------------------

test('G2: README and render.yaml list both keys, and render.yaml leaves them to be pasted in', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
  const yaml = await fs.readFile(path.join(root, 'render.yaml'), 'utf8');
  for (const key of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
    assert.ok(readme.includes(`\`${key}\``), key);
    assert.match(yaml, new RegExp(`- key: ${key}\\s+sync: false`), key);
  }
});
