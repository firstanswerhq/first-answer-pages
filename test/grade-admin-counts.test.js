/**
 * The admin Grades page: how the bot protection is set up and today's counts (Feature G, task G5).
 * Fake clock, fake verifier, fake assistant and notifiers; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createMockNotifier, createNoneNotifier } from '../server/lib/notifier.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const TOKEN = 'grade-admin-counts-token';
const GOOD = 'good-token-111';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

function verifier(answer) {
  return {
    siteKey: 'site-key-ABC123',
    async verify(token) {
      if (answer) return answer;
      return token === GOOD ? 'ok' : 'failed';
    },
  };
}

async function startEnv({ turnstile, notifier, gradeGuard, config = {} } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-admin-counts-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const assistant = {
    name: 'anthropic',
    async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; },
  };
  const deps = {
    dataDir: dir,
    clock,
    assistantProvider: assistant,
    extraAssistants: [],
    safeFetcher: { async fetchText() { throw new Error('no network in tests'); } },
    newGradeId: () => `adm${String(++n).padStart(19, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: TOKEN,
      trustProxy: 1, gradeAiCallsPerDay: 150, ...config,
    },
  };
  if (turnstile !== undefined) deps.turnstile = turnstile;
  if (notifier !== undefined) deps.notifier = notifier;
  if (gradeGuard !== undefined) deps.gradeGuard = gradeGuard;
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
  return { dir, clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

let service = 0;

async function startCheck(env, ip, token) {
  const page = await (await fetch(`${env.base}/grade`, { headers: { 'x-forwarded-for': ip } })).text();
  const t = /name="t" value="([^"]+)"/.exec(page)[1];
  env.clock.t += 5000;
  service += 1;
  const fields = { nickname: '', t, name: `Shop ${service}`, city: 'Nashville', state: 'TN', service: 'accountants', website: '' };
  if (token !== undefined) fields['cf-turnstile-response'] = token;
  return fetch(`${env.base}/grade`, {
    method: 'POST', redirect: 'manual', headers: { 'x-forwarded-for': ip }, body: new URLSearchParams(fields),
  });
}

const adminPage = (env, headers = { authorization: `Bearer ${TOKEN}` }) => fetch(`${env.base}/admin/grades`, {
  redirect: 'manual', headers: { accept: 'text/html', ...headers },
});

/** The lines of the protection block, as plain text. */
async function blockLines(env) {
  const res = await adminPage(env);
  assert.equal(res.status, 200);
  const text = await res.text();
  const block = /<ul class="admin-protection">([\s\S]*?)<\/ul>/.exec(text);
  assert.ok(block, 'the block is on the page');
  const lines = [...block[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => m[1]);
  return { lines, text, block: block[0] };
}

const TODAY = /^Today: \d+ AI calls used, \d+ left\. \d+ checks run\.$/;

// ---- the setup lines ----------------------------------------------------------------------------

test('G5: with no Turnstile keys the page says the human check is off', async () => {
  const env = await startEnv({ turnstile: null, notifier: createMockNotifier() });
  const { lines } = await blockLines(env);
  assert.equal(lines[0], 'Human check: off (no Turnstile keys)');
});

test('G5: with the keys set the page says the human check is on', async () => {
  const env = await startEnv({ turnstile: verifier(), notifier: createMockNotifier() });
  assert.equal((await blockLines(env)).lines[0], 'Human check: on');
});

test('G5: after Cloudflare reports a problem the page says so, and checks are let through', async () => {
  const env = await startEnv({ turnstile: verifier('misconfigured'), notifier: createMockNotifier() });
  assert.equal((await blockLines(env)).lines[0], 'Human check: on');
  assert.equal((await startCheck(env, '203.0.113.5', GOOD)).status, 303);
  assert.equal(
    (await blockLines(env)).lines[0],
    'Human check: on, but Cloudflare reported a problem (wrong secret key or an error on its side); checks are let through',
  );
  // An unreachable Cloudflare is not a setup problem.
  const other = await startEnv({ turnstile: verifier('unreachable'), notifier: createMockNotifier() });
  assert.equal((await startCheck(other, '203.0.113.5', GOOD)).status, 303);
  assert.equal((await blockLines(other)).lines[0], 'Human check: on');
});

test('G5: the heads-up emails line says on with an email service and off without one', async () => {
  const withService = await startEnv({ turnstile: null, notifier: createMockNotifier() });
  assert.equal((await blockLines(withService)).lines[1], 'Heads-up emails: on');
  const without = await startEnv({ turnstile: null, notifier: createNoneNotifier() });
  assert.equal((await blockLines(without)).lines[1], 'Heads-up emails: off (no email service set)');
  const bare = await startEnv({ turnstile: null, notifier: { name: 'test', async notify() {} } });
  assert.equal((await blockLines(bare)).lines[1], 'Heads-up emails: off (no email service set)');
});

// ---- the counts ---------------------------------------------------------------------------------

test('G5: a fresh day shows zeros and the whole Grader allowance left', async () => {
  const env = await startEnv({ turnstile: verifier(), notifier: createMockNotifier() });
  const { lines } = await blockLines(env);
  assert.deepEqual(lines.slice(2), [
    'Today: 0 AI calls used, 150 left. 0 checks run.',
    'Human check: 0 passed, 0 turned away.',
    'Limits: 0 turned away by the per-address limits, 0 by the per-network limit.',
  ]);
});

test('G5: the counts follow checks, a failed human check, a refused address and a refused network, each on its own line', async () => {
  const env = await startEnv({ turnstile: verifier(), notifier: createMockNotifier(), config: { gradeNetworkPerDay: 6 } });
  for (let i = 0; i < 5; i += 1) assert.equal((await startCheck(env, '203.0.113.7', GOOD)).status, 303);
  assert.equal((await startCheck(env, '203.0.113.7', 'bad')).status, 422, 'a failed human check');
  assert.equal((await startCheck(env, '203.0.113.7', GOOD)).status, 429, 'a refused address');
  assert.equal((await startCheck(env, '203.0.113.8', GOOD)).status, 303);
  assert.equal((await startCheck(env, '203.0.113.9', GOOD)).status, 429, 'a refused network');

  const { lines } = await blockLines(env);
  assert.equal(lines.length, 5);
  assert.match(lines[2], TODAY);
  assert.match(lines[2], / 6 checks run\.$/);
  assert.equal(lines[3], 'Human check: 8 passed, 1 turned away.');
  assert.equal(lines[4], 'Limits: 1 turned away by the per-address limits, 1 by the per-network limit.');
});

test('G5: the AI calls used and left come from the budget', async () => {
  const env = await startEnv({ turnstile: null, notifier: createMockNotifier() });
  assert.equal((await startCheck(env, '203.0.113.5')).status, 303);
  for (let i = 0; i < 250 && env.ctx.aiBudget.usage({ kind: 'grade' }).used === 0; i += 1) await new Promise(r => setTimeout(r, 20));
  const { used, left } = env.ctx.aiBudget.usage({ kind: 'grade' });
  assert.ok(used >= 1);
  assert.equal((await blockLines(env)).lines[2], `Today: ${used} AI calls used, ${left} left. 1 checks run.`);
});

test('G5: the counts start again at zero the next Chicago day', async () => {
  const env = await startEnv({ turnstile: verifier(), notifier: createMockNotifier() });
  await startCheck(env, '203.0.113.5', 'bad');
  assert.equal((await blockLines(env)).lines[3], 'Human check: 0 passed, 1 turned away.');
  env.clock.t += DAY;
  const { lines } = await blockLines(env);
  assert.equal(lines[2], 'Today: 0 AI calls used, 150 left. 0 checks run.');
  assert.equal(lines[3], 'Human check: 0 passed, 0 turned away.');
});

// ---- counts only, escaped, behind the login -------------------------------------------------------------

test('G5: the block holds counts only: no business name, address or visitor detail', async () => {
  const env = await startEnv({ turnstile: verifier(), notifier: createMockNotifier() });
  assert.equal((await startCheck(env, '203.0.113.5', GOOD)).status, 303);
  assert.equal((await startCheck(env, '203.0.113.5', 'bad')).status, 422);
  const { block, lines } = await blockLines(env);
  for (const leak of ['Shop', 'Nashville', 'accountants', '203.0.113', 'good-token', 'site-key', TOKEN, 'test-secret']) {
    assert.equal(block.includes(leak), false, leak);
  }
  for (const line of lines) assert.match(line, /^(Human check|Heads-up emails|Today|Limits): /);
});

test('G5: every value in the block is escaped, and a value that is not a count shows as 0', async () => {
  const gradeGuard = {
    turnedAway() {}, passed() {}, started() {}, misconfigured() {}, watch() {},
    summary: () => ({
      usage: { used: '<script>alert(1)</script>', left: -5 },
      counts: { checks: '<b>9</b>', humanPass: 1.5, human: null, limit: '&amp;', network: [1] },
      misconfigured: false,
    }),
  };
  const env = await startEnv({ turnstile: null, notifier: createMockNotifier(), gradeGuard });
  const { lines, text } = await blockLines(env);
  assert.equal(lines[2], 'Today: 0 AI calls used, 0 left. 0 checks run.');
  assert.equal(lines[3], 'Human check: 0 passed, 0 turned away.');
  assert.equal(lines[4], 'Limits: 0 turned away by the per-address limits, 0 by the per-network limit.');
  assert.equal(text.includes('<script>alert(1)</script>'), false);
  assert.equal(text.includes('<b>9</b>'), false);
});

test('G5: a guard that gives nothing still shows the page', async () => {
  const gradeGuard = {
    turnedAway() {}, passed() {}, started() {}, misconfigured() {}, watch() {}, summary: () => undefined,
  };
  const env = await startEnv({ turnstile: null, notifier: createMockNotifier(), gradeGuard });
  const { lines } = await blockLines(env);
  assert.equal(lines[2], 'Today: 0 AI calls used, 0 left. 0 checks run.');
});

test('G5: the block is behind the admin login like the rest of the page', async () => {
  const env = await startEnv({ turnstile: verifier(), notifier: createMockNotifier() });
  for (const headers of [{}, { authorization: 'Bearer wrong-token' }]) {
    const res = await adminPage(env, headers);
    assert.notEqual(res.status, 200);
    const text = await res.text();
    assert.equal(text.includes('admin-protection'), false);
    assert.equal(text.includes('Heads-up emails'), false);
    assert.equal(text.includes('Turnstile'), false);
  }
  assert.equal((await adminPage(env)).status, 200);
});

test('G5: the reports list is still there under the block', async () => {
  const env = await startEnv({ turnstile: null, notifier: createMockNotifier() });
  assert.ok((await (await adminPage(env)).text()).includes('No reports yet.'));
  assert.equal((await startCheck(env, '203.0.113.5')).status, 303);
  const text = await (await adminPage(env)).text();
  assert.ok(text.includes('AI Visibility Check reports'));
  assert.ok(text.includes('Open the report'));
  assert.ok(text.indexOf('admin-protection') < text.indexOf('Open the report'), 'the block is above the list');
});
