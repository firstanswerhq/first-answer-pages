/**
 * Task 6.2: when the main assistant's call never answers, the check is cut off at its time limit, the Grade is still
 * done, the AI Check is not checked, and the website Checks still run. The 120 seconds are shortened for the test.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const SITE_HTML = '<!doctype html><html><head><title>Home</title></head><body><h1>Home</h1></body></html>';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

test('6.2: a main AI call that never answers times out: ai-named is not_checked and the Grade is still done', async () => {
  const assistant = {
    name: 'anthropic',
    calls: 0,
    // Never answers and never rejects: only the time limit ends it.
    ask() {
      assistant.calls += 1;
      return new Promise(() => {});
    },
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-ai-timeout-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 1000, gradeLimit: 1000 });
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: assistant,
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { return { status: 200, text: SITE_HTML, contentType: 'text/html' }; } },
    graderTiming: { sleep: async () => {}, aiTimeoutMs: 50 },
    newGradeId: () => 'timeoutAAAAAAAAAAAAAAA',
    config: {
      baseUrl: 'http://example.test', graderLeadGate: false, graderSecret: 'test-secret', adminToken: 'timeout-token',
      gradeAiCallsPerDay: 1000, gradeMainAsks: 1, demoMode: false,
    },
  });
  cleanups.push(async () => {
    await aiBudget.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });

  const id = await app.locals.ctx.grader.start({ name: 'Timeout Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: '' });
  let grade = null;
  for (let i = 0; i < 600 && !grade; i += 1) {
    const g = await app.locals.ctx.grader.get(id);
    if (g && g.status !== 'running') grade = g;
    else await sleep(10);
  }
  assert.ok(grade, 'the check finished');
  assert.equal(grade.status, 'done', 'a timeout does not fail the Grade');
  assert.ok(assistant.calls >= 1, 'the assistant was asked');
  const named = grade.results.find(r => r.id === 'ai-named');
  assert.equal(named.result, 'not_checked');
  assert.equal(grade.aiMain.state, 'failed');
  assert.deepEqual(grade.ai, [], 'no answer was stored');
});
