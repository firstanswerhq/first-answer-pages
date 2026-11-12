import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { scoreGrade } from '../server/lib/grade-score.js';
import { CHECKS } from '../server/lib/grade-checks.js';

const resultFor = (check, result, earned) => (
  check.id === 'ai-named' && result === 'pass' ? { id: check.id, result, earned } : { id: check.id, result }
);

const resultList = fc.tuple(
  fc.array(fc.constantFrom('pass', 'fail', 'not_checked'), { minLength: CHECKS.length, maxLength: CHECKS.length }),
  fc.integer({ min: 0, max: 30 }),
  fc.array(fc.boolean(), { minLength: CHECKS.length, maxLength: CHECKS.length }),
).map(([states, earned, keep]) => CHECKS
  .map((c, i) => (keep[i] ? resultFor(c, states[i], earned) : null))
  .filter(Boolean));

// Feature: ai-visibility-grader, Property 6: Score bounds and invariance
test('Property 6: score is null or an integer from 0 to 100', () => {
  fc.assert(fc.property(resultList, results => {
    const { score, available } = scoreGrade(results);
    if (available < 40) assert.equal(score, null);
    else {
      assert.ok(Number.isInteger(score));
      assert.ok(score >= 0 && score <= 100);
    }
  }), { numRuns: 300 });
});

test('Property 6: every counted Check passing with full points scores 100', () => {
  fc.assert(fc.property(fc.array(fc.boolean(), { minLength: CHECKS.length, maxLength: CHECKS.length }), keep => {
    const results = CHECKS.map((c, i) => (keep[i] ? resultFor(c, 'pass', 30) : null)).filter(Boolean);
    const { score, available } = scoreGrade(results);
    assert.equal(score, available >= 40 ? 100 : null);
  }), { numRuns: 200 });
});

test('Property 6: not_checked results never change the score', () => {
  fc.assert(fc.property(resultList, results => {
    const without = results.filter(r => r.result !== 'not_checked');
    const a = scoreGrade(results);
    const b = scoreGrade(without);
    assert.equal(a.score, b.score);
    assert.equal(a.available, b.available);
    assert.equal(a.earned, b.earned);
  }), { numRuns: 300 });
});

test('ai-named partial points count; under 40 available points is not scored', () => {
  const some = [
    { id: 'ai-named', result: 'pass', earned: 10 },
    { id: 'business-labeled', result: 'fail' },
  ];
  const r = scoreGrade(some);
  assert.equal(r.available, 38);
  assert.equal(r.score, null);
  const more = [...some, { id: 'info-sheet', result: 'pass' }];
  const m = scoreGrade(more);
  assert.equal(m.available, 42);
  assert.equal(m.earned, 14);
  assert.equal(m.score, 33);
  assert.equal(m.failed, 1);
  assert.equal(m.counted, 3);
});

test('the Check table totals 100 points and fixes fit in 160 characters', () => {
  assert.equal(CHECKS.reduce((n, c) => n + c.points, 0), 100);
  for (const c of CHECKS) assert.ok(Array.from(c.fix).length <= 160, c.id);
});
