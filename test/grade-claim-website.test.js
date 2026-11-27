/**
 * The claim fills the website (Feature C, task F10; Requirement 21.6). The typed website is rewritten to https
 * without fetching anything, checked with normalizeWebsite again, and never logged. No network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { claimWebsite } from '../server/lib/grader.js';
import { normalizeWebsite } from '../server/lib/listing-fields.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 22, 18, 0, 0);

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/** Everything written to stderr (where the server logs) while `fn` runs. */
async function captureOutput(fn) {
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

// ---- claimWebsite -------------------------------------------------------------------------------------

test('F10: claimWebsite rewrites http to https with the same host and path, and no port', () => {
  assert.equal(claimWebsite('http://example.com:8080/menu?x=1'), 'https://example.com/menu');
  assert.equal(claimWebsite('http://example.com/'), 'https://example.com/');
  assert.equal(claimWebsite('https://example.com/about#team'), 'https://example.com/about');
  assert.equal(claimWebsite('https://user:pw@example.com:8443/a'), 'https://example.com/a');
  for (const none of ['', '   ', null, undefined, 42, 'not a website', 'ftp://example.com/', 'javascript:alert(1)']) {
    assert.equal(claimWebsite(none), '', String(none));
  }
  // The result still goes through normalizeWebsite.
  assert.equal(normalizeWebsite(claimWebsite('http://example.com:8080/menu?x=1')), 'https://example.com/menu');
  assert.equal(normalizeWebsite(claimWebsite('http://203.0.113.7/')), '', 'an IP address never becomes a listing website');
  assert.equal(normalizeWebsite(claimWebsite('http://localhost:3000/')), '');
});

// ---- the claim -------------------------------------------------------------------------------------------------

async function startEnv(grades) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-claim-website-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'grades.json'), JSON.stringify(grades));
  const app = createApp({
    dataDir: dir,
    clock: { now: () => START },
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { throw new Error('no network in tests'); } },
    config: { baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'claim-site-token', gradeAiCallsPerDay: 150 },
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
  return { ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

let n = 0;
function storedGrade(website) {
  n += 1;
  const id = `claimSite${String(n).padStart(13, '0')}`;
  const at = new Date(START).toISOString();
  return {
    id, status: 'done', input: { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website },
    key: `k|${id}`, createdAt: at, finishedAt: at, steps: [], facts: null,
    found: { phone: '(615) 555-0101', hours: [], address: '', website: website ?? '', reviewsLink: '' },
    results: [], ai: [], aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: null,
    previousScore: null, draftId: null, draftIds: [], recheckedAt: null, recheckRunning: false, recheckFailedAt: null,
    extraAiStartedAt: at,
  };
}

async function claimed(env, grade) {
  const out = await env.ctx.grader.claim(grade.id);
  assert.equal(out.status, 303);
  const drafts = await env.ctx.store.collection('drafts').read();
  return drafts.find(d => d.id === out.draftId);
}

test('F10: the claim fills the website from the typed site, without its query string', async () => {
  const grade = storedGrade('https://zephyrplumbing.com/services?utm_source=check#top');
  const env = await startEnv([grade]);
  const draft = await claimed(env, grade);
  assert.equal(draft.fields.website, 'https://zephyrplumbing.com/services');
  assert.equal(draft.missingFields.includes('website'), false);
  // The owner sees it on the Draft review page, in the box, and can change or clear it there.
  const page = await (await fetch(`${env.base}/rise/drafts/${draft.id}`)).text();
  assert.ok(page.includes('name="website" value="https://zephyrplumbing.com/services"'));
});

test('F10: a typed http address with a port fills the https address with no port', async () => {
  const grade = storedGrade('http://example.com:8080/menu?x=1');
  const env = await startEnv([grade]);
  assert.equal((await claimed(env, grade)).fields.website, 'https://example.com/menu');
});

test('F10: no website, or one that cannot be a listing website, leaves the field empty', async () => {
  const grades = [null, '', 'http://203.0.113.7/', 'http://localhost:3000/', 'https://intranet/', 'not a website'].map(storedGrade);
  const env = await startEnv(grades);
  for (const grade of grades) {
    const draft = await claimed(env, grade);
    assert.equal(Object.hasOwn(draft.fields, 'website'), false, String(grade.input.website));
    assert.equal(draft.missingFields.includes('website'), false);
  }
});

test('F10: the other claim fields are unchanged by the website', async () => {
  const withSite = storedGrade('https://zephyrplumbing.com/');
  const without = storedGrade(null);
  const env = await startEnv([withSite, without]);
  const a = (await claimed(env, withSite)).fields;
  const b = (await claimed(env, without)).fields;
  const { website, ...rest } = a;
  assert.equal(website, 'https://zephyrplumbing.com/');
  assert.deepEqual(rest, b);
});

test('F10: nothing typed is logged during a claim', async () => {
  const grade = storedGrade('http://secret-site-name.example:8080/private-path?token=abc123');
  const env = await startEnv([grade]);
  let draft;
  const log = await captureOutput(async () => {
    draft = await claimed(env, grade);
  });
  assert.equal(draft.fields.website, 'https://secret-site-name.example/private-path');
  for (const typed of ['secret-site-name', 'private-path', 'abc123', 'Zephyr Plumbing']) {
    assert.equal(log.includes(typed), false, typed);
  }
});
