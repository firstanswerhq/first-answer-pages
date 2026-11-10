/**
 * More tests for the daily AI cap (task 21.2): the photo share, the Chicago
 * midnight reset, and persistence to a file. Everything uses a fake clock and
 * temporary directories; nothing touches the network or the repo data/ folder.
 *
 * Property: totals and photo calls never exceed their caps per Chicago day.
 * **Validates: task 21.2 (photo share, daily reset)**
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';

import { createAiBudget, PHOTO_LIMIT_DEFAULT, DEFAULT_AI_LIMIT } from '../server/lib/ai-budget.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOON = Date.UTC(2025, 0, 15, 12, 0, 0);
const CHICAGO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });

const clockAt = (t = NOON) => ({ t, now() { return this.t; } });
const iso = (s) => Date.parse(s);

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-budget2-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const exists = async (file) => fs.access(file).then(() => true, () => false);

// ---- photo share --------------------------------------------------------------------

test('defaults: limit 200 and photo share 150', () => {
  assert.equal(DEFAULT_AI_LIMIT, 200);
  assert.equal(PHOTO_LIMIT_DEFAULT, 150);
  const budget = createAiBudget({ clock: clockAt() });
  assert.equal(budget.limit, 200);
  assert.equal(budget.photoLimit, 150);
});

test('limit 200: photo is denied after 150 photo calls, Séance still runs until 200 in total', () => {
  const budget = createAiBudget({ clock: clockAt(), limit: 200 });
  for (let i = 0; i < 150; i++) assert.equal(budget.consume({ kind: 'photo' }).allowed, true, `photo ${i}`);

  const denied = budget.consume({ kind: 'photo' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0, 'no photo calls left');
  assert.equal(budget.peek({ kind: 'photo' }).allowed, false);
  assert.equal(budget.peek({ kind: 'seance' }).remaining, 50, 'denied photo calls were not counted');

  for (let i = 0; i < 50; i++) assert.equal(budget.consume({ kind: 'seance' }).allowed, true, `seance ${i}`);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, false);
  assert.equal(budget.peek().remaining, 0);
});

test('limit 100: the photo cap is min(150, 100) = 100', () => {
  const budget = createAiBudget({ clock: clockAt(), limit: 100 });
  assert.equal(budget.photoLimit, 100);
  for (let i = 0; i < 100; i++) assert.equal(budget.consume({ kind: 'photo' }).allowed, true);
  assert.equal(budget.consume({ kind: 'photo' }).allowed, false);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, false, 'the total is spent');
});

test('photo is denied once the total reaches the limit even with photo share left', () => {
  const budget = createAiBudget({ clock: clockAt(), limit: 200 });
  for (let i = 0; i < 100; i++) assert.equal(budget.consume({ kind: 'seance' }).allowed, true);
  for (let i = 0; i < 100; i++) assert.equal(budget.consume({ kind: 'photo' }).allowed, true);
  const denied = budget.consume({ kind: 'photo' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
});

test('denied calls are not counted', () => {
  const budget = createAiBudget({ clock: clockAt(), limit: 3, photoLimit: 1 });
  assert.equal(budget.consume({ kind: 'photo' }).allowed, true);
  for (let i = 0; i < 5; i++) assert.equal(budget.consume({ kind: 'photo' }).allowed, false);
  assert.equal(budget.peek().remaining, 2, 'five denials did not use any units');
  assert.equal(budget.consume({ kind: 'seance' }).allowed, true);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, true);
  assert.equal(budget.consume({ kind: 'seance' }).allowed, false);
  for (let i = 0; i < 3; i++) assert.equal(budget.consume({ kind: 'seance' }).allowed, false);
  assert.equal(budget.peek().remaining, 0);
});

test('remaining in a result is the count left for that kind', () => {
  const budget = createAiBudget({ clock: clockAt(), limit: 10, photoLimit: 3 });
  assert.equal(budget.consume({ kind: 'photo' }).remaining, 2);
  assert.equal(budget.consume({ kind: 'seance' }).remaining, 8);
  assert.equal(budget.peek({ kind: 'photo' }).remaining, 2);
  assert.equal(budget.peek({ kind: 'seance' }).remaining, 8);
});

// ---- Chicago midnight -------------------------------------------------------------------

test('winter: 05:59:59Z is still Jan 15 (CST); 06:00:00Z is the new day', () => {
  const clock = clockAt(iso('2025-01-16T05:59:59Z'));
  const budget = createAiBudget({ clock, limit: 1 });
  const first = budget.consume();
  assert.equal(first.allowed, true);
  assert.equal(first.resetsAt, '2025-01-16T06:00:00.000Z');
  assert.equal(first.retryAfterSeconds, 1);
  assert.equal(budget.consume().allowed, false, 'same Chicago day');

  clock.t = iso('2025-01-16T06:00:00Z');
  const next = budget.consume();
  assert.equal(next.allowed, true, 'a new day starts at Chicago midnight');
  assert.equal(next.resetsAt, '2025-01-17T06:00:00.000Z');
  assert.equal(next.retryAfterSeconds, 24 * 60 * 60);
});

test('summer (CDT): 04:59Z is still June 30; 05:00Z is July 1', () => {
  const clock = clockAt(iso('2025-07-01T04:59:00Z'));
  const budget = createAiBudget({ clock, limit: 1 });
  const first = budget.consume();
  assert.equal(first.allowed, true);
  assert.equal(first.resetsAt, '2025-07-01T05:00:00.000Z');
  assert.equal(first.retryAfterSeconds, 60);
  assert.equal(budget.consume().allowed, false);

  clock.t = iso('2025-07-01T05:00:00Z');
  assert.equal(budget.consume().allowed, true);
  assert.equal(budget.peek().resetsAt, '2025-07-02T05:00:00.000Z');
});

test('resetsAt and retryAfterSeconds are exact across the DST changes', () => {
  // Spring forward 2025-03-09: that Chicago day is 23 hours long.
  const spring = createAiBudget({ clock: clockAt(iso('2025-03-09T06:00:00Z')), limit: 1 }).peek();
  assert.equal(spring.resetsAt, '2025-03-10T05:00:00.000Z');
  assert.equal(spring.retryAfterSeconds, 23 * 60 * 60);

  // Fall back 2025-11-02: that Chicago day is 25 hours long.
  const fall = createAiBudget({ clock: clockAt(iso('2025-11-02T05:00:00Z')), limit: 1 }).peek();
  assert.equal(fall.resetsAt, '2025-11-03T06:00:00.000Z');
  assert.equal(fall.retryAfterSeconds, 25 * 60 * 60);

  // A plain winter noon, 18 hours before midnight.
  const noon = createAiBudget({ clock: clockAt(), limit: 1 }).peek();
  assert.equal(noon.resetsAt, '2025-01-16T06:00:00.000Z');
  assert.equal(noon.retryAfterSeconds, 18 * 60 * 60);
});

test('a denied call reports the same exact resetsAt and retryAfterSeconds', () => {
  const budget = createAiBudget({ clock: clockAt(iso('2025-01-16T03:30:00Z')), limit: 1 });
  budget.consume();
  const denied = budget.consume();
  assert.equal(denied.allowed, false);
  assert.equal(denied.resetsAt, '2025-01-16T06:00:00.000Z');
  assert.equal(denied.retryAfterSeconds, 2.5 * 60 * 60);
});

// ---- persistence -------------------------------------------------------------------------

test('persistence: a second budget on the same file sees limit-3 on the same day and a clean next day', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'ai-budget.json');
    const clock = clockAt();
    const first = createAiBudget({ clock, limit: 10, file });
    first.consume({ kind: 'photo' });
    first.consume({ kind: 'seance' });
    first.consume({ kind: 'seance' });
    await first.flush();

    const second = createAiBudget({ clock, limit: 10, file });
    assert.equal(second.peek().remaining, 7);
    assert.equal(second.peek({ kind: 'photo' }).remaining, 7);

    clock.t += DAY_MS;
    assert.equal(second.peek().remaining, 10, 'zero used on the next Chicago day');
    assert.equal(createAiBudget({ clock, limit: 10, file }).peek().remaining, 10);
  });
});

test('persistence: the photo count survives a restart too', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'ai-budget.json');
    const clock = clockAt();
    const first = createAiBudget({ clock, limit: 5, photoLimit: 2, file });
    first.consume({ kind: 'photo' });
    first.consume({ kind: 'photo' });
    await first.flush();

    const second = createAiBudget({ clock, limit: 5, photoLimit: 2, file });
    assert.equal(second.consume({ kind: 'photo' }).allowed, false, 'photo share was already used');
    assert.equal(second.consume({ kind: 'seance' }).allowed, true);
    assert.equal(second.peek().remaining, 2);
    await second.flush();
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { day: '2025-01-15', total: 3, photo: 2 });
  });
});

test('persistence: a corrupt or oddly shaped file is tolerated and starts at zero', async () => {
  await withTempDir(async (dir) => {
    for (const content of ['{not json', '', '[]', 'null', '{"day":1}', '{"day":"2025-01-15","total":-1,"photo":0}']) {
      const file = path.join(dir, 'ai-budget.json');
      await fs.writeFile(file, content);
      let budget;
      assert.doesNotThrow(() => { budget = createAiBudget({ clock: clockAt(), limit: 4, file }); }, content);
      assert.equal(budget.peek().remaining, 4, content);
      assert.equal(budget.consume().allowed, true, content);
      await budget.flush();
      // The next start reads the good file the counter wrote.
      assert.equal(createAiBudget({ clock: clockAt(), limit: 4, file }).peek().remaining, 3, content);
    }
  });
});

test('persistence: no file is written when nothing was consumed', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'ai-budget.json');
    const budget = createAiBudget({ clock: clockAt(), limit: 3, file });
    budget.peek();
    budget.peek({ kind: 'photo' });
    await budget.flush();
    assert.equal(await exists(file), false);

    // A denied call is not counted, so it writes nothing either.
    const full = createAiBudget({ clock: clockAt(), limit: 1, file: path.join(dir, 'other.json') });
    full.consume();
    await full.flush();
    const before = await fs.readFile(path.join(dir, 'other.json'), 'utf8');
    full.consume();
    await full.flush();
    assert.equal(await fs.readFile(path.join(dir, 'other.json'), 'utf8'), before);
  });
});

// ---- property -----------------------------------------------------------------------------

test('Property: for any interleaving, totals stay within the limit and photo calls within min(150, limit) per Chicago day', () => {
  // **Validates: task 21.2 (photo share, daily reset)**
  const opArb = fc.record({
    kind: fc.constantFrom('photo', 'seance'),
    step: fc.integer({ min: 0, max: 6 * HOUR_MS }),
  });
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 400 }),
      fc.array(opArb, { maxLength: 600 }),
      (limit, ops) => {
        const clock = clockAt(NOON);
        const budget = createAiBudget({ clock, limit });
        const photoCap = Math.min(150, limit);
        assert.equal(budget.photoLimit, photoCap);
        const perDay = new Map();
        for (const { kind, step } of ops) {
          clock.t += step; // time only moves forward
          const day = CHICAGO_DAY.format(new Date(clock.t));
          const counts = perDay.get(day) ?? { total: 0, photo: 0 };
          perDay.set(day, counts);
          if (budget.consume({ kind }).allowed) {
            counts.total += 1;
            if (kind === 'photo') counts.photo += 1;
          }
          assert.ok(counts.total <= limit, `total ${counts.total} > ${limit}`);
          assert.ok(counts.photo <= photoCap, `photo ${counts.photo} > ${photoCap}`);
        }
      },
    ),
    { numRuns: 60 },
  );
});
