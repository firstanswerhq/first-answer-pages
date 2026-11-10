/**
 * Tests for TRUST_PROXY handling and the admin attempt limits.
 *
 * Config examples cover configFromEnv(): the hop count defaults to 1 in
 * production and is unset otherwise, only non-negative whole numbers are
 * accepted, and `true` is never produced.
 *
 * Server tests run in-process on a temporary DATA_DIR (copies of
 * listings.json and categories.json). The test client connects from
 * 127.0.0.1, so with `trust proxy` = 1 req.ip is the LAST X-Forwarded-For
 * entry (what a one-hop trusted proxy would append). Earlier entries are
 * client-controlled and must never affect the limiter key.
 *
 * **Validates: docs/launch-fixes.md section 13 (13.2)**
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { configFromEnv } from '../server/lib/config.js';
import { createRateLimiter, RULES } from '../server/lib/rate-limiter.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2025, 0, 15, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const TOKEN = 'test-admin-token';
const WRONG = 'Bearer not-the-token';
const GOOD = `Bearer ${TOKEN}`;

// ---- environment ------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

let sharedDir;
async function dataDir() {
  if (!sharedDir) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-trust-'));
    for (const name of ['listings.json', 'categories.json']) {
      await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
    }
    sharedDir = dir;
    cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  }
  return sharedDir;
}

/** Start a fresh app (own limiter and clock). `trustProxy: undefined` leaves it unset. */
async function startEnv({ trustProxy } = {}) {
  const dir = await dataDir();
  const clock = { t: START, now: () => clock.t };
  const rateLimiter = createRateLimiter({ clock });
  const config = { adminToken: TOKEN };
  // createApp merges over configFromEnv(process.env); force the value either way.
  config.trustProxy = trustProxy;
  const app = createApp({ dataDir: dir, clock, rateLimiter, config });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });
  const { port } = server.address();
  return { clock, rateLimiter, base: `http://127.0.0.1:${port}` };
}

/** GET /admin/pending with an optional Authorization and X-Forwarded-For. */
function hit(env, { auth, xff } = {}) {
  const headers = {};
  if (auth) headers.Authorization = auth;
  if (xff !== undefined) headers['X-Forwarded-For'] = xff;
  return fetch(`${env.base}/admin/pending`, { headers });
}

const keyFor = ip => `admin-auth:${ip}`;
const isBlocked = (env, ip) => !env.rateLimiter.peek(keyFor(ip), RULES['admin-auth']).allowed;

// ---- configFromEnv: trustProxy ---------------------------------------------

test('trustProxy is unset when NODE_ENV is not production and TRUST_PROXY is unset', () => {
  assert.equal(configFromEnv({}, { warn() {} }).trustProxy, undefined);
  assert.equal(configFromEnv({ NODE_ENV: 'development' }, { warn() {} }).trustProxy, undefined);
});

test('trustProxy defaults to 1 in production', () => {
  assert.equal(configFromEnv({ NODE_ENV: 'production' }, { warn() {} }).trustProxy, 1);
});

test('integer TRUST_PROXY values are parsed', () => {
  assert.equal(configFromEnv({ TRUST_PROXY: '0' }, { warn() {} }).trustProxy, 0);
  assert.equal(configFromEnv({ TRUST_PROXY: '2' }, { warn() {} }).trustProxy, 2);
  assert.equal(configFromEnv({ NODE_ENV: 'production', TRUST_PROXY: '2' }, { warn() {} }).trustProxy, 2);
  assert.equal(configFromEnv({ NODE_ENV: 'production', TRUST_PROXY: '0' }, { warn() {} }).trustProxy, 0);
});

test('non-integer TRUST_PROXY values are rejected with a warning that omits the value', () => {
  const bad = ['true', 'false', '-1', '1.5', 'loopback', '10.0.0.0/8'];
  for (const raw of bad) {
    for (const [nodeEnv, expected] of [[undefined, undefined], ['production', 1]]) {
      const warnings = [];
      const env = { TRUST_PROXY: raw };
      if (nodeEnv) env.NODE_ENV = nodeEnv;
      const cfg = configFromEnv(env, { warn: msg => warnings.push(String(msg)) });
      assert.equal(cfg.trustProxy, expected, `TRUST_PROXY=${raw} NODE_ENV=${nodeEnv}`);
      assert.notEqual(cfg.trustProxy, true);
      assert.ok(warnings.length >= 1, `expected a warning for ${raw}`);
      for (const w of warnings) {
        assert.ok(!w.includes(raw), `warning must not echo ${raw}`);
      }
    }
  }
});

test('trustProxy is never boolean true', () => {
  for (const raw of [undefined, '', 'true', 'TRUE', 'false', '1', '0', '3', 'yes', '1e3']) {
    for (const nodeEnv of [undefined, 'production']) {
      const env = {};
      if (raw !== undefined) env.TRUST_PROXY = raw;
      if (nodeEnv) env.NODE_ENV = nodeEnv;
      const { trustProxy } = configFromEnv(env, { warn() {} });
      assert.notEqual(trustProxy, true);
      assert.ok(trustProxy === undefined || Number.isInteger(trustProxy));
    }
  }
});

// ---- admin attempt limits behind one trusted proxy --------------------------

test('wrong tokens: 401 for the first 10, 429 with an integer Retry-After on the 11th', async () => {
  const env = await startEnv({ trustProxy: 1 });
  const real = '203.0.113.10';
  for (let i = 1; i <= 10; i++) {
    const res = await hit(env, { auth: WRONG, xff: `198.51.100.${i}, ${real}` });
    assert.equal(res.status, 401, `attempt ${i}`);
    await res.arrayBuffer();
  }
  const res = await hit(env, { auth: WRONG, xff: `198.51.100.99, ${real}` });
  assert.equal(res.status, 429);
  const retry = res.headers.get('retry-after');
  assert.match(retry, /^\d+$/);
  assert.ok(Number(retry) >= 1);
  await res.arrayBuffer();
  assert.ok(isBlocked(env, real), 'the proxy-appended address is the limiter key');
});

test('the limiter key is the last X-Forwarded-For entry, not a forged prefix', async () => {
  const env = await startEnv({ trustProxy: 1 });
  const real = '203.0.113.11';
  for (let i = 0; i < 10; i++) {
    const res = await hit(env, { auth: WRONG, xff: `10.0.${i}.1, 10.1.${i}.2, ${real}` });
    assert.equal(res.status, 401);
    await res.arrayBuffer();
  }
  assert.ok(isBlocked(env, real));
  assert.ok(!isBlocked(env, '10.0.0.1'));
  assert.ok(!isBlocked(env, '10.1.0.2'));
  assert.ok(!isBlocked(env, '127.0.0.1'));
  const res = await hit(env, { auth: WRONG, xff: `10.9.9.9, ${real}` });
  assert.equal(res.status, 429);
  await res.arrayBuffer();
});

test('a different real address is not blocked', async () => {
  const env = await startEnv({ trustProxy: 1 });
  const real = '203.0.113.12';
  for (let i = 0; i < 11; i++) {
    const res = await hit(env, { auth: WRONG, xff: `1.1.1.${i}, ${real}` });
    await res.arrayBuffer();
  }
  const other = await hit(env, { auth: WRONG, xff: `1.1.1.0, 203.0.113.13` });
  assert.equal(other.status, 401);
  await other.arrayBuffer();
  const good = await hit(env, { auth: GOOD, xff: `1.1.1.0, 203.0.113.14` });
  assert.equal(good.status, 200);
  await good.arrayBuffer();
});

test('a correct token never consumes budget and works from a different address after a block', async () => {
  const env = await startEnv({ trustProxy: 1 });
  const real = '203.0.113.20';
  for (let i = 0; i < 20; i++) {
    const res = await hit(env, { auth: GOOD, xff: `9.9.9.${i}, ${real}` });
    assert.equal(res.status, 200, `correct request ${i + 1}`);
    await res.arrayBuffer();
  }
  assert.ok(!isBlocked(env, real));
  // Budget is untouched: all 10 wrong attempts still return 401.
  for (let i = 0; i < 10; i++) {
    const res = await hit(env, { auth: WRONG, xff: `9.9.9.${i}, ${real}` });
    assert.equal(res.status, 401, `wrong attempt ${i + 1}`);
    await res.arrayBuffer();
  }
  const blocked = await hit(env, { auth: WRONG, xff: `9.9.9.0, ${real}` });
  assert.equal(blocked.status, 429);
  await blocked.arrayBuffer();
  // The correct token is checked first, so the admin is never locked out,
  // even from the throttled address (task 21.1).
  const stillWorks = await hit(env, { auth: GOOD, xff: `9.9.9.0, ${real}` });
  assert.equal(stillWorks.status, 200);
  await stillWorks.arrayBuffer();
  // A different address with the right token works.
  const other = await hit(env, { auth: GOOD, xff: `9.9.9.0, 203.0.113.21` });
  assert.equal(other.status, 200);
  await other.arrayBuffer();
});

test('the limiter resets after an hour', async () => {
  const env = await startEnv({ trustProxy: 1 });
  const real = '203.0.113.30';
  for (let i = 0; i < 10; i++) {
    const res = await hit(env, { auth: WRONG, xff: real });
    assert.equal(res.status, 401);
    await res.arrayBuffer();
  }
  const blocked = await hit(env, { auth: WRONG, xff: real });
  assert.equal(blocked.status, 429);
  await blocked.arrayBuffer();

  env.clock.t += HOUR;
  const again = await hit(env, { auth: WRONG, xff: real });
  assert.equal(again.status, 401);
  await again.arrayBuffer();
  const good = await hit(env, { auth: GOOD, xff: real });
  assert.equal(good.status, 200);
  await good.arrayBuffer();
});

test('hop count 2 honors one more proxy: the second-from-last entry is the client', async () => {
  const env = await startEnv({ trustProxy: 2 });
  const client = '203.0.113.40';
  for (let i = 0; i < 10; i++) {
    const res = await hit(env, { auth: WRONG, xff: `7.7.7.${i}, ${client}, 192.0.2.1` });
    assert.equal(res.status, 401);
    await res.arrayBuffer();
  }
  assert.ok(isBlocked(env, client));
  assert.ok(!isBlocked(env, '192.0.2.1'));
  const res = await hit(env, { auth: WRONG, xff: `8.8.8.8, ${client}, 192.0.2.1` });
  assert.equal(res.status, 429);
  await res.arrayBuffer();
});

// ---- properties -------------------------------------------------------------

const junkEntry = fc.oneof(
  fc.ipV4(),
  fc
    .array(fc.constantFrom(...'abcdef0123456789.:_-'), { minLength: 1, maxLength: 15 })
    .map(chars => chars.join(''))
);
// Ten forged prefixes, one per wrong attempt.
const forgedChains = fc.array(fc.array(junkEntry, { minLength: 0, maxLength: 4 }), {
  minLength: 10,
  maxLength: 10,
});

test('Property: with trust proxy 1, forged prefixes never dodge the limit (11th wrong attempt is 429)', async () => {
  await fc.assert(
    fc.asyncProperty(forgedChains, fc.integer({ min: 1, max: 254 }), async (chains, n) => {
      const env = await startEnv({ trustProxy: 1 });
      const real = `203.0.113.${n}`;
      for (const chain of chains) {
        const res = await hit(env, { auth: WRONG, xff: [...chain, real].join(', ') });
        assert.equal(res.status, 401);
        await res.arrayBuffer();
      }
      const res = await hit(env, { auth: WRONG, xff: [...chains[0], real].join(', ') });
      assert.equal(res.status, 429);
      assert.match(res.headers.get('retry-after'), /^\d+$/);
      await res.arrayBuffer();
      assert.ok(isBlocked(env, real));
    }),
    { numRuns: 15 }
  );
});

test('Property: with trust proxy 0 or unset, X-Forwarded-For is ignored', async () => {
  await fc.assert(
    fc.asyncProperty(
      forgedChains,
      fc.constantFrom(0, undefined),
      fc.ipV4(),
      async (chains, trustProxy, last) => {
        const env = await startEnv({ trustProxy });
        for (const chain of chains) {
          const res = await hit(env, { auth: WRONG, xff: [...chain, last].join(', ') });
          assert.equal(res.status, 401);
          await res.arrayBuffer();
        }
        // The header cannot dodge the limit...
        const res = await hit(env, { auth: WRONG, xff: '198.51.100.250' });
        assert.equal(res.status, 429);
        await res.arrayBuffer();
        // ...and the key is the socket address, never a header value.
        assert.ok(isBlocked(env, '127.0.0.1'));
        if (last !== '127.0.0.1') assert.ok(!isBlocked(env, last));
        assert.equal(env.rateLimiter.size(), 1);
      }
    ),
    { numRuns: 15 }
  );
});
