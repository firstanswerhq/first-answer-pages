/**
 * Feature: ai-visibility-grader, Property 10: Reuse never copies a visitor's state.
 * For any two Grades with the same key within 7 days, the second Grade copies only `ai` entries, and never
 * `draftId`, unlock state, or Leads. (Requirements 14.3, 14.4.) Fake assistants only; nothing real is called.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

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

function fakeAssistant() {
  const fake = {
    name: 'anthropic',
    calls: 0,
    answer: '1. Other Co\n2. Another Co',
    async ask() {
      fake.calls += 1;
      return { answer: fake.answer, provider: 'anthropic', model: 'stub', webSearch: true };
    },
  };
  return fake;
}

async function startEnv(assistant) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-reuse-prop-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 100000, gradeLimit: 100000 });
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: assistant,
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { return { status: 200, text: SITE_HTML, contentType: 'text/html' }; } },
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `rp${String(++n).padStart(20, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'reuse-token',
      gradeAiCallsPerDay: 100000, gradeMainAsks: 1, demoMode: false,
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
    await aiBudget.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { ctx: app.locals.ctx, clock, dir };
}

async function until(fn, what) {
  for (let i = 0; i < 600; i += 1) {
    const value = await fn();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function finished(env, id) {
  return until(async () => {
    const g = await env.ctx.grader.get(id);
    return g && g.status !== 'running' ? g : null;
  }, 'the check');
}

test('Property 10: a Grade that reuses answers copies only the answers, never a visitor\'s state', async () => {
  const assistant = fakeAssistant();
  const env = await startEnv(assistant);
  let run = 0;
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom('Zephyr Plumbing', 'Ridgeline Roofing', 'Capital City Window'),
      fc.constantFrom('plumbers', 'roofers', 'window cleaners'),
      fc.stringMatching(/^[a-z0-9]{1,12}$/),
      fc.array(fc.stringMatching(/^[a-z0-9]{1,12}$/), { maxLength: 3 }),
      fc.boolean(),
      async (baseName, service, draftId, extraDraftIds, withLead) => {
        run += 1;
        // A different business each run, so earlier runs never serve as this run's earlier Grade.
        const input = { name: `${baseName} ${run}`, city: 'Nashville', state: 'TN', service, website: '' };

        const firstId = await env.ctx.grader.start(input);
        await finished(env, firstId);
        // The first visitor's state: a claimed draft, other drafts, a Lead.
        await env.ctx.store.collection('grades').update(list => {
          const g = list.find(x => x && x.id === firstId);
          g.draftId = draftId;
          g.draftIds = [draftId, ...extraDraftIds];
          g.previousScore = 55;
          g.recheckedAt = new Date(NOW).toISOString();
        });
        if (withLead) {
          await env.ctx.store.collection('leads').update(list => {
            list.push({
              id: `lead${run}`, gradeId: firstId, business: input.name, name: 'Pat Visitor', email: 'pat@example.com',
              phone: '(615) 555-0100', okToContact: false, score: 50, createdAt: new Date(NOW).toISOString(),
            });
          });
        }
        const first = await env.ctx.grader.get(firstId);
        const callsBefore = assistant.calls;

        env.clock.t += 1000;
        const secondId = await env.ctx.grader.start(input);
        const second = await finished(env, secondId);

        assert.notEqual(second.id, first.id);
        assert.equal(assistant.calls, callsBefore, 'the answer is reused, not asked again');
        // Only answers are copied.
        assert.ok(second.ai.length > 0);
        for (const entry of second.ai) {
          assert.ok(entry.reusedFrom, 'a copied answer says where it came from');
          const original = first.ai.find(a => a.prompt === entry.prompt && a.provider === entry.provider);
          assert.ok(original, 'a copy of a real earlier answer');
          assert.equal(entry.answer, original.answer);
        }
        // Never a visitor's state.
        assert.ok(second.draftId === null || second.draftId === undefined, 'no draft id');
        assert.equal(Array.isArray(second.draftIds) && second.draftIds.length > 0, false, 'no draft ids');
        assert.ok(second.previousScore === null || second.previousScore === undefined, 'no previous score');
        assert.ok(second.recheckedAt === null || second.recheckedAt === undefined, 'no recheck time');
        const leads = JSON.parse(await fs.readFile(path.join(env.dir, 'leads.json'), 'utf8').catch(() => '[]'));
        assert.equal(leads.some(l => l.gradeId === secondId), false, 'no Lead');
      },
    ),
    { numRuns: 6 },
  );
});
