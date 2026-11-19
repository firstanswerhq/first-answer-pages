/**
 * Bot protection for the AI Visibility Check (Feature G). So far: the per-network limit (task G1).
 * Fake assistant and fake clock; no real AI and no real network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { networkKey } from '../server/lib/network-key.js';
import { parseGradeNetworkPerDay, configFromEnv } from '../server/lib/config.js';
import { RULES } from '../server/lib/rate-limiter.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

// ---- networkKey --------------------------------------------------------------------------------

test('G1: networkKey gives the first three parts of an IPv4 address', () => {
  assert.equal(networkKey('203.0.113.7'), '203.0.113');
  assert.equal(networkKey('203.0.113.250'), '203.0.113');
  assert.equal(networkKey('10.1.2.3'), '10.1.2');
});

test('G1: networkKey gives the first four groups of an IPv6 address, expanded, lower case, no leading zeros', () => {
  assert.equal(networkKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2');
  assert.equal(networkKey('2001:0DB8:0001:0002:0000:0000:0000:0001'), '2001:db8:1:2');
  assert.equal(networkKey('2001:db8::1'), '2001:db8:0:0');
  assert.equal(networkKey('::1'), '0:0:0:0');
  assert.equal(networkKey('fe80::1%eth0'), 'fe80:0:0:0');
  assert.equal(networkKey('2001:db8:1:2::5'), networkKey('2001:db8:1:2:ffff:ffff:ffff:ffff'));
  assert.notEqual(networkKey('2001:db8:1:2::5'), networkKey('2001:db8:1:3::5'));
});

test('G1: an IPv4 address written inside an IPv6 one gives the IPv4 network', () => {
  assert.equal(networkKey('::ffff:203.0.113.7'), '203.0.113');
  assert.equal(networkKey('::ffff:cb00:7107'), '203.0.113');
  assert.equal(networkKey('::FFFF:203.0.113.200'), networkKey('203.0.113.1'));
});

test('G1: anything that is not an address gives the text itself, so unknown values are never lumped together', () => {
  assert.equal(networkKey('not-an-address'), 'not-an-address');
  assert.equal(networkKey(''), '');
  assert.equal(networkKey(undefined), '');
  assert.notEqual(networkKey('unknown-a'), networkKey('unknown-b'));
  assert.equal(networkKey('203.0.113'), '203.0.113');
});

// ---- the setting -------------------------------------------------------------------------------

test('G1: GRADE_NETWORK_PER_DAY is a positive whole number, default 20, and a bad value warns without echoing it', () => {
  const warnings = [];
  const warn = msg => warnings.push(String(msg));
  assert.equal(parseGradeNetworkPerDay(undefined, warn), 20);
  assert.equal(parseGradeNetworkPerDay('', warn), 20);
  assert.equal(parseGradeNetworkPerDay('5', warn), 5);
  assert.equal(parseGradeNetworkPerDay('100', warn), 100);
  assert.equal(warnings.length, 0);
  for (const bad of ['0', '-3', '2.5', 'many', '1e3']) assert.equal(parseGradeNetworkPerDay(bad, warn), 20, bad);
  assert.equal(warnings.length, 5);
  for (const w of warnings) {
    assert.match(w, /GRADE_NETWORK_PER_DAY/);
    assert.doesNotMatch(w, /many|2\.5|1e3/);
  }
  assert.equal(configFromEnv({ GRADE_NETWORK_PER_DAY: '7' }, { warn() {} }).gradeNetworkPerDay, 7);
  assert.equal(configFromEnv({}, { warn() {} }).gradeNetworkPerDay, 20);
  assert.equal(RULES['grade-network'].limit, 20);
  assert.equal(RULES['grade-network'].windowMs, 24 * 60 * 60 * 1000);
});

// ---- the limit on the route --------------------------------------------------------------------

async function startEnv({ config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-guard-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const assistant = {
    name: 'anthropic',
    async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; },
  };
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider: assistant,
    extraAssistants: [],
    newGradeId: () => `guard${String(++n).padStart(17, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'guard-test-token',
      trustProxy: 1, gradeAiCallsPerDay: 150, ...config,
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
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { dir, clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

let service = 0;

/** Post the check form as a visitor at `ip` (through a one-hop proxy) and return the response. */
async function startCheck(env, ip) {
  const html = await (await fetch(`${env.base}/grade`, { headers: { 'x-forwarded-for': ip } })).text();
  const t = /name="t" value="([^"]+)"/.exec(html)[1];
  env.clock.t += 5000;
  service += 1;
  return fetch(`${env.base}/grade`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': ip },
    body: new URLSearchParams({
      nickname: '', t, name: `Shop ${service}`, city: 'Nashville', state: 'TN', service: 'accountants', website: '',
    }),
  });
}

test('G1: the 21st check in a day from one IPv4 /24 is turned away, and a different network is not', async () => {
  const env = await startEnv();
  // Twenty checks from twenty addresses on the same /24 (each address stays under its own limits).
  for (let i = 1; i <= 20; i += 1) {
    const res = await startCheck(env, `203.0.113.${i}`);
    assert.equal(res.status, 303, `check ${i}`);
  }
  const refused = await startCheck(env, '203.0.113.99');
  assert.equal(refused.status, 429);
  assert.match(refused.headers.get('retry-after') ?? '', /^\d+$/);
  assert.ok(Number(refused.headers.get('retry-after')) >= 1);
  const text = await refused.text();
  assert.ok(text.includes('A lot of checks have come from your network today. Please try again tomorrow, or from another connection.'));
  assert.equal(text.includes('from your address'), false, 'it does not blame one address');

  // Another network is not affected.
  assert.equal((await startCheck(env, '198.51.100.5')).status, 303);
  // A refused check counted nothing: the same network is still refused, and a day later it is let in.
  assert.equal((await startCheck(env, '203.0.113.100')).status, 429);
  env.clock.t += 24 * 60 * 60 * 1000 + 1000;
  assert.equal((await startCheck(env, '203.0.113.101')).status, 303);
});

test('G1: a lower GRADE_NETWORK_PER_DAY is honored, for an IPv6 /64 too', async () => {
  const env = await startEnv({ config: { gradeNetworkPerDay: 3 } });
  for (let i = 1; i <= 3; i += 1) {
    assert.equal((await startCheck(env, `2001:db8:1:2::${i}`)).status, 303, `check ${i}`);
  }
  const refused = await startCheck(env, '2001:db8:1:2:aaaa::9');
  assert.equal(refused.status, 429);
  assert.ok((await refused.text()).includes('from your network today'));
  // The next /64 is a different network.
  assert.equal((await startCheck(env, '2001:db8:1:3::1')).status, 303);
});

test('G1: an IPv4 address inside an IPv6 one counts on the IPv4 network', async () => {
  const env = await startEnv({ config: { gradeNetworkPerDay: 2 } });
  assert.equal((await startCheck(env, '203.0.113.1')).status, 303);
  assert.equal((await startCheck(env, '::ffff:203.0.113.2')).status, 303);
  assert.equal((await startCheck(env, '203.0.113.3')).status, 429);
});

test('G1: the per-address limits still apply, with their own message', async () => {
  const env = await startEnv();
  for (let i = 0; i < 5; i += 1) assert.equal((await startCheck(env, '203.0.113.7')).status, 303, `check ${i + 1}`);
  const refused = await startCheck(env, '203.0.113.7');
  assert.equal(refused.status, 429);
  assert.ok(refused.headers.get('retry-after'));
  const text = await refused.text();
  assert.ok(text.includes('We have had a lot of checks from your address.'));
  assert.equal(text.includes('from your network'), false);
});

test('G1: a check refused by the network limit uses none of the address counts', async () => {
  const env = await startEnv({ config: { gradeNetworkPerDay: 1 } });
  assert.equal((await startCheck(env, '203.0.113.1')).status, 303);
  // Refused by the network rule; its own address (a different one) has used nothing.
  assert.equal((await startCheck(env, '203.0.113.2')).status, 429);
  const limiter = env.ctx.rateLimiter;
  assert.equal(limiter.peek('grade:203.0.113.2', RULES.grade).allowed, true);
  assert.equal(limiter.peek('grade-day:203.0.113.2', RULES['grade-day']).allowed, true);
  // It leaves the same address's count at zero, so five more attempts from it would all be refused by the network only.
  for (let i = 0; i < 5; i += 1) assert.equal((await startCheck(env, '203.0.113.2')).status, 429);
  const text = await (await startCheck(env, '203.0.113.2')).text();
  assert.ok(text.includes('from your network today'));
});
