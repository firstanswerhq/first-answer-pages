/**
 * Task 5.4 (Requirement 14.1): photo and Grader calls share three quarters of the day's AI calls, so the quarter held
 * back for Séance runs stays open when that share is used up; and an old budget file with no Grader counter loads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createAiBudget } from '../server/lib/ai-budget.js';

// 12:00 in Chicago on Nov 24, 2026 (the budget's day runs midnight to midnight Central time).
const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const TODAY = '2026-11-24';
const clock = () => ({ t: NOW, now() { return this.t; } });

test('5.4: once photo and Grader calls have used their share, a Séance call is still allowed', () => {
  // A cap of 8 holds back 2 calls for Séance runs; photo and Grader calls share the other 6.
  const budget = createAiBudget({ clock: clock(), limit: 8, gradeLimit: 60 });
  for (let i = 0; i < 4; i += 1) assert.equal(budget.consume({ kind: 'grade' }).allowed, true, `grade ${i + 1}`);
  for (let i = 0; i < 2; i += 1) assert.equal(budget.consume({ kind: 'photo' }).allowed, true, `photo ${i + 1}`);
  // The shared part is full: neither kind gets another call.
  assert.equal(budget.consume({ kind: 'grade' }).allowed, false);
  assert.equal(budget.consume({ kind: 'photo' }).allowed, false);
  assert.equal(budget.peek({ kind: 'grade' }).allowed, false);
  // The held-back quarter is still there for Séance runs, and only the cap stops them.
  assert.equal(budget.peek({ kind: 'seance' }).allowed, true);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, true);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, true);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, false, 'the whole cap is used');
  assert.equal(budget.usage({ kind: 'seance' }).used, 8);
});

test('5.4: the Grader share alone also leaves the Séance quarter open', () => {
  const budget = createAiBudget({ clock: clock(), limit: 20, gradeLimit: 60 });
  let allowed = 0;
  while (budget.consume({ kind: 'grade' }).allowed) allowed += 1;
  assert.equal(allowed, 15, 'three quarters of 20');
  for (let i = 0; i < 5; i += 1) assert.equal(budget.consume({ kind: 'seance' }).allowed, true, `seance ${i + 1}`);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, false);
});

test('5.4: an old budget file with no Grader counter loads, starts it at zero and counts from there', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-budget-share-'));
  try {
    const file = path.join(dir, 'ai-budget.json');
    await fs.writeFile(file, JSON.stringify({ day: TODAY, total: 5, photo: 1 }));
    const budget = createAiBudget({ clock: clock(), limit: 20, gradeLimit: 60, file });
    assert.equal(budget.usage({ kind: 'grade' }).used, 0, 'no Grader counter in the file');
    assert.equal(budget.usage({ kind: 'photo' }).used, 1);
    assert.equal(budget.usage({ kind: 'seance' }).used, 5);
    assert.equal(budget.consume({ kind: 'grade' }).allowed, true);
    assert.equal(budget.usage({ kind: 'grade' }).used, 1);
    assert.equal(budget.usage({ kind: 'seance' }).used, 6);
    await budget.flush();
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(saved.grade, 1);
    assert.equal(saved.total, 6);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  }
});
