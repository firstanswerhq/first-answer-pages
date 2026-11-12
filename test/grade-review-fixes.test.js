// Tests for the fixes that came out of the code review and the plain-reader review.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createDataStore } from '../server/data.js';
import { createSafeFetcher } from '../server/lib/safe-fetch.js';
import { analyzeAnswer, isNamed } from '../server/lib/name-match.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/grade/', import.meta.url));
const START = Date.UTC(2026, 10, 9, 18, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn().catch(() => {});
});

// ---- name matching ---------------------------------------------------------------

test('a business named only with trade words is not "named" by the AI\'s own sentence', () => {
  const business = { name: 'Best Roofers', service: 'roofers', city: 'Nashville', state: 'TN' };
  const intro = 'Here are the best roofers in Nashville:\n1. Other Co\n2. Another Co';
  assert.equal(isNamed(intro, business), false);
  const a = analyzeAnswer(intro, business);
  assert.equal(a.named, false);
  assert.equal(a.position, null);
  assert.deepEqual(a.competitors, ['Other Co', 'Another Co']);
});

test('the same business is named when it is on the AI\'s list', () => {
  const business = { name: 'Best Roofers', service: 'roofers', city: 'Nashville', state: 'TN' };
  const a = analyzeAnswer('Here are the best roofers in Nashville:\n1. Other Co\n2. Best Roofers - 4.9 stars', business);
  assert.equal(a.named, true);
  assert.equal(a.position, 2);
  assert.deepEqual(a.competitors, ['Other Co']);
});

test('an ordinary name is still found in running text', () => {
  const business = { name: 'Acme Roofing Company', service: 'roofers', city: 'Nashville', state: 'TN' };
  assert.equal(isNamed('Many people recommend Acme Roofing for repairs.', business), true);
});

// ---- a small app with a website that can go down ------------------------------------

async function startEnv({ gate = false } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-review-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const html = await fs.readFile(path.join(FIXTURES, 'roofer.html'), 'utf8');
  const site = { down: false };
  const fn = (url, opts, cb) => {
    const u = new URL(url);
    const req = new EventEmitter();
    req.end = () => opts.lookup(u.hostname, { all: true }, () => {
      if (site.down) return req.emit('error', new Error('down'));
      const ok = u.pathname === '/';
      const res = Readable.from([Buffer.from(ok ? html : '')]);
      res.statusCode = ok ? 200 : 404;
      res.headers = ok ? { 'content-type': 'text/html; charset=utf-8' } : {};
      return cb(res);
    });
    return req;
  };
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const assistant = { name: 'stub', calls: 0, async ask() { this.calls += 1; return { provider: 'stub', model: 'm', answer: '1. Other Co\n2. Another Co' }; } };
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider: assistant,
    safeFetcher: createSafeFetcher({
      request: { http: fn, https: fn },
      lookup: (host, opts, cb) => setImmediate(() => cb(null, [{ address: '93.184.216.34', family: 4 }])),
    }),
    newGradeId: () => `grade${String(++n).padStart(17, '0')}`,
    config: { baseUrl: 'http://example.test', graderLeadGate: gate, graderSecret: 'test-secret' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const grades = async () => JSON.parse(await fs.readFile(path.join(dir, 'grades.json'), 'utf8'));
  const until = async (test, what) => {
    for (let i = 0; i < 300; i += 1) {
      const v = await test();
      if (v) return v;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  async function grade(fields) {
    const form = await (await fetch(`${base}/grade`)).text();
    const t = /name="t" value="([^"]+)"/.exec(form)[1];
    clock.t += 5000;
    const res = await fetch(`${base}/grade`, {
      method: 'POST', redirect: 'manual', body: new URLSearchParams({ nickname: '', t, ...fields }),
    });
    assert.equal(res.status, 303);
    const id = res.headers.get('location').split('/').pop();
    await until(async () => (await (await fetch(`${base}/grade/${id}/status.json`)).json()).done, 'the grade');
    return id;
  }
  return { dir, base, clock, site, assistant, grades, until, grade };
}

const ROOFER = { name: 'Ridgeline Roofing LLC', city: 'Nashville', state: 'TN', service: 'roofers', website: 'ridgelineroofing.example' };

test('check again while the website is down keeps the earlier results and says so', async () => {
  const env = await startEnv();
  const id = await env.grade(ROOFER);
  const before = (await env.grades())[0];
  assert.ok(Number.isInteger(before.score.score));

  env.site.down = true;
  const res = await fetch(`${env.base}/grade/${id}/recheck`, { method: 'POST', redirect: 'manual' });
  assert.equal(res.status, 303);
  const after = await env.until(async () => {
    const g = (await env.grades())[0];
    return g.recheckFailedAt ? g : null;
  }, 'the failed recheck');
  assert.equal(after.recheckRunning, false);
  assert.deepEqual(after.results, before.results);
  assert.deepEqual(after.score, before.score);
  const html = await (await fetch(`${env.base}/grade/${id}`)).text();
  assert.ok(html.includes("We couldn't reach your website when we checked again"));
  assert.ok(html.includes('Your earlier results are kept.'));
  assert.ok(html.includes(`<span class="num">${before.score.score}</span>`));
});

test('viewing a report again does not rewrite the stored grades or ask AI again', async () => {
  const env = await startEnv();
  const id = await env.grade(ROOFER);
  await (await fetch(`${env.base}/grade/${id}`)).text(); // first view starts the extra questions
  await env.until(async () => ((await env.grades())[0].ai.length === 3), 'the extra questions');
  const calls = env.assistant.calls;
  const file = path.join(env.dir, 'grades.json');
  const stamp = (await fs.stat(file)).mtimeMs;
  await new Promise(r => setTimeout(r, 30));
  for (let i = 0; i < 5; i += 1) await (await fetch(`${env.base}/grade/${id}`)).text();
  assert.equal((await fs.stat(file)).mtimeMs, stamp);
  assert.equal(env.assistant.calls, calls);
});

test('a report with no website hides the search preview and Check again, and explains why', async () => {
  const env = await startEnv();
  const id = await env.grade({ ...ROOFER, website: '' });
  const html = await (await fetch(`${env.base}/grade/${id}`)).text();
  assert.ok(html.includes('We could only run the AI check. Add a website to get a score.'));
  assert.ok(html.includes('A free listing gives AI something to read about the business.'));
  assert.equal(html.includes('How you look in search'), false);
  assert.equal(html.includes('Check again'), false);
  assert.equal(html.includes('checks failed'), false);
  assert.equal(html.includes('your-website'), false);
});

test('direction-flipping marks are removed from what the visitor types', async () => {
  const env = await startEnv();
  const id = await env.grade({ ...ROOFER, website: '', name: 'Ridge‮line Roofing' });
  const g = (await env.grades()).find(x => x.id === id);
  assert.equal(/[‪-‮⁦-⁩]/.test(g.input.name), false);
});

// ---- retention ------------------------------------------------------------------

test('a Lead is removed together with its Grade, even when the Lead itself is newer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-prune-'));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  const iso = ms => new Date(ms).toISOString();
  await fs.writeFile(path.join(dir, 'grades.json'), JSON.stringify([
    { id: 'old', createdAt: iso(START - 91 * DAY) },
    { id: 'new', createdAt: iso(START - 5 * DAY) },
  ]));
  await fs.writeFile(path.join(dir, 'leads.json'), JSON.stringify([
    { id: 'l1', gradeId: 'old', createdAt: iso(START - 30 * DAY) },
    { id: 'l2', gradeId: 'new', createdAt: iso(START - 2 * DAY) },
  ]));
  const store = createDataStore({ dataDir: dir, clock: { now: () => new Date(START) } });
  await store.pruneExpired({ quotes: false, drafts: false, grades: true, leads: true });
  const read = async name => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
  assert.deepEqual((await read('grades.json')).map(g => g.id), ['new']);
  assert.deepEqual((await read('leads.json')).map(l => l.id), ['l2']);
});
