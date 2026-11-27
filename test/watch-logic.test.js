/**
 * addon-monthly-watch task 3: the pure logic in server/lib/watch.js. dueWatches (30 days, or GRADE_AI_REPEAT_DAYS when
 * longer), confirmedChange (two agreeing answers; disagreeing answers give no change), the cap of 12 readings,
 * maskEmail, and cleanNames (with a fast-check property: no control characters, at most 80 code points, at most 5).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  newWatch, dueWatches, addReading, confirmedChange, maskEmail, cleanNames, makeReading, lastReading, intervalDays,
  WATCH_INTERVAL_DAYS, MAX_READINGS, MAX_NAMES, NAME_MAX,
} from '../server/lib/watch.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 18, 0, 0);
const INPUT = { name: 'Acme Wash', city: 'Nashville', state: 'TN', service: 'pressure washing', website: 'https://acmewash.example/' };
const FIRST = { named: true, position: 2, total: 5, competitors: ['Ridge Wash', 'Clean Co'] };

const watch = (extra = {}) => newWatch({
  id: 'w'.repeat(22), gradeId: 'g'.repeat(22), input: INPUT, email: null, confirmToken: 'c', stopToken: 's', now: NOW, first: FIRST, ...extra,
});

test('newWatch: no email starts at once; with an email it waits for the owner to confirm; the first reading is the report\'s', () => {
  const w = watch();
  assert.equal(w.status, 'active');
  assert.equal(w.email, null);
  assert.deepEqual(w.readings, [{ at: new Date(NOW).toISOString(), named: true, position: 2, total: 5, competitors: ['Ridge Wash', 'Clean Co'], source: 'report' }]);
  assert.equal(w.nextDueAt, new Date(NOW + 30 * DAY).toISOString());
  assert.deepEqual([w.retries, w.sendFailures, w.lastChangeAt, w.confirmedAt], [0, 0, null, null]);
  const pending = watch({ email: '  owner@example.com ' });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.email, 'owner@example.com');
  // Only the business's own details are kept: never the answer text, the question or anything else from the Grade.
  const odd = watch({ input: { ...INPUT, about: 'We wash roofs.', secret: 'x', ai: ['answer text'] } });
  assert.deepEqual(odd.input, { ...INPUT, about: 'We wash roofs.' });
  assert.equal(JSON.stringify(odd).includes('answer text'), false);
});

test('dueWatches: due after 30 days, or GRADE_AI_REPEAT_DAYS when that is more than 30; oldest first; active only', () => {
  assert.equal(WATCH_INTERVAL_DAYS, 30);
  assert.equal(intervalDays(7), 30);
  assert.equal(intervalDays(0), 30);
  assert.equal(intervalDays(45), 45);
  const a = watch({ id: 'a'.repeat(22) });
  assert.deepEqual(dueWatches([a], NOW + 29 * DAY), []);
  assert.deepEqual(dueWatches([a], NOW + 30 * DAY).map(w => w.id), [a.id]);
  const long = watch({ id: 'b'.repeat(22), repeatDays: 45 });
  assert.deepEqual(dueWatches([long], NOW + 44 * DAY), []);
  assert.deepEqual(dueWatches([long], NOW + 45 * DAY).map(w => w.id), [long.id]);
  // Oldest due first; pending and paused are never due.
  const older = { ...watch({ id: 'c'.repeat(22) }), nextDueAt: new Date(NOW + 10 * DAY).toISOString() };
  const pending = watch({ id: 'd'.repeat(22), email: 'o@example.com' });
  const paused = { ...watch({ id: 'e'.repeat(22) }), status: 'paused' };
  assert.deepEqual(dueWatches([a, pending, paused, older], NOW + 60 * DAY).map(w => w.id), [older.id, a.id]);
  assert.deepEqual(dueWatches(null, NOW), []);
});

test('addReading: keeps the newest 12, moves the next due date, and resets the retries', () => {
  let w = { ...watch(), retries: 2 };
  for (let i = 1; i <= 15; i += 1) {
    w = addReading(w, { named: i % 2 === 0, total: 3, competitors: ['A'], source: 'ask' }, { now: NOW + i * 30 * DAY });
  }
  assert.equal(MAX_READINGS, 12);
  assert.equal(w.readings.length, 12);
  assert.equal(w.readings.at(-1).at, new Date(NOW + 15 * 30 * DAY).toISOString(), 'newest last');
  assert.equal(w.readings[0].at, new Date(NOW + 4 * 30 * DAY).toISOString(), 'the oldest dropped');
  assert.equal(w.nextDueAt, new Date(NOW + 16 * 30 * DAY).toISOString());
  assert.equal(w.retries, 0);
  // A confirmed change is dated; otherwise the date stays.
  const changed = addReading(watch(), { named: false }, { now: NOW + 30 * DAY, changed: true });
  assert.equal(changed.lastChangeAt, new Date(NOW + 30 * DAY).toISOString());
  assert.equal(addReading(changed, { named: false }, { now: NOW + 60 * DAY }).lastChangeAt, changed.lastChangeAt);
  // GRADE_AI_REPEAT_DAYS longer than 30 sets the gap.
  assert.equal(addReading(watch(), { named: true }, { now: NOW, repeatDays: 40 }).nextDueAt, new Date(NOW + 40 * DAY).toISOString());
  // Pure: the watch passed in is unchanged.
  const before = watch();
  addReading(before, { named: false }, { now: NOW + DAY });
  assert.equal(before.readings.length, 1);
});

test('readings store no answer text; "We couldn\'t check this month" is a reading with no source', () => {
  const r = makeReading({ at: NOW, named: true, position: 0, total: -1, competitors: 'x', source: 'odd', answer: 'full text' });
  assert.deepEqual(r, { at: new Date(NOW).toISOString(), named: true, position: null, total: 0, competitors: [], source: 'ask' });
  const w = addReading(watch(), { named: false, source: 'none' }, { now: NOW + 30 * DAY });
  assert.equal(lastReading(w).source, 'report', 'a month we could not check is skipped when comparing');
  assert.equal(lastReading({ readings: [] }), null);
});

test('confirmedChange: a change only when the second ask agrees; never for the same answer', () => {
  const yes = { named: true };
  const no = { named: false };
  assert.equal(confirmedChange(yes, no, no), 'stopped', 'stopped naming, and the second ask agrees');
  assert.equal(confirmedChange(no, yes, yes), 'started');
  assert.equal(confirmedChange(yes, no, yes), null, 'the second ask disagrees: no change, nothing sent');
  assert.equal(confirmedChange(no, yes, no), null);
  assert.equal(confirmedChange(yes, no), null, 'no second ask: not confirmed');
  assert.equal(confirmedChange(yes, yes, yes), null, 'no change');
  assert.equal(confirmedChange(no, no, no), null);
  assert.equal(confirmedChange(null, no, no), null);
  assert.equal(confirmedChange(yes, null, null), null);
});

test('maskEmail: the middle is hidden; anything that is not an address gives nothing', () => {
  assert.equal(maskEmail('alex@example.com'), 'a\u2026@e\u2026.com');
  assert.equal(maskEmail(' Jo@Mail.Example.org '), 'J\u2026@M\u2026.org');
  assert.equal(maskEmail('a@localhost'), 'a\u2026@l\u2026');
  for (const bad of ['', 'no-at-sign', '@example.com', 'a@', 'a b@example.com', null, undefined, 42]) {
    assert.equal(maskEmail(bad), '', String(bad));
  }
  // Never the whole local part or the whole domain name.
  const masked = maskEmail('secretname@privatedomain.com');
  assert.equal(masked.includes('secretname'), false);
  assert.equal(masked.includes('privatedomain'), false);
});

test('cleanNames: plain short names, at most 5, no repeats, nothing that is not a string', () => {
  assert.equal(MAX_NAMES, 5);
  assert.equal(NAME_MAX, 80);
  assert.deepEqual(cleanNames(['  Ridge\nWash  ', 'ridge wash', 'Clean\u0000Co', '', '   ', 7, null, 'A', 'B', 'C', 'D']),
    ['Ridge Wash', 'Clean Co', 'A', 'B', 'C']);
  assert.deepEqual(cleanNames('not a list'), []);
  assert.equal(Array.from(cleanNames(['x'.repeat(200)])[0]).length, 80);
  // Direction marks never survive (they could flip how a name reads).
  assert.deepEqual(cleanNames(['Evil\u202Ename']), ['Evil name']);
});

test('cleanNames property: no control characters, at most 80 code points each, at most 5 names, never empty', () => {
  const anyText = fc.oneof(fc.string(), fc.fullUnicodeString(), fc.constantFrom('\u0000', '\n', '\u202E', '\t', ' '));
  fc.assert(fc.property(fc.array(fc.oneof(anyText, fc.integer(), fc.constant(null)), { maxLength: 20 }), list => {
    const out = cleanNames(list);
    assert.ok(out.length <= 5);
    for (const name of out) {
      assert.equal(typeof name, 'string');
      assert.ok(name.length > 0 && name === name.trim());
      assert.ok(Array.from(name).length <= 80);
      assert.equal(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(name), false);
    }
    assert.equal(new Set(out.map(n => n.toLowerCase())).size, out.length, 'no repeats');
  }), { numRuns: 300 });
});
