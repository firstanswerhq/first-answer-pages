import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createRateLimiter, RULES } from '../server/lib/rate-limiter.js';

function fakeClock(start = 1_000_000) {
  const clock = { t: start, now: () => clock.t };
  return clock;
}

const arbRule = fc.record({
  limit: fc.integer({ min: 1, max: 6 }),
  windowMs: fc.integer({ min: 1, max: 20_000 }),
});
const arbDeltas = fc.array(fc.integer({ min: 0, max: 8_000 }), { minLength: 1, maxLength: 60 });

// Feature: super-pages, Property 13: Rate limiter honours limit, window, and Retry-After

test('Property 13: never more than limit calls allowed in any window', () => {
  fc.assert(
    fc.property(arbRule, arbDeltas, (rule, deltas) => {
      const clock = fakeClock();
      const rl = createRateLimiter({ clock });
      const allowedTimes = [];
      for (const d of deltas) {
        clock.t += d;
        if (rl.consume('k', rule).allowed) allowedTimes.push(clock.t);
      }
      for (const t of allowedTimes) {
        const inWindow = allowedTimes.filter((a) => a <= t && a > t - rule.windowMs).length;
        assert.ok(inWindow <= rule.limit, `${inWindow} allowed in window ending ${t}`);
      }
    }),
    { numRuns: 100 },
  );
});

test('Property 13: refused calls report an integer retryAfterSeconds in [1, ceil(windowMs/1000)]', () => {
  fc.assert(
    fc.property(arbRule, arbDeltas, (rule, deltas) => {
      const clock = fakeClock();
      const rl = createRateLimiter({ clock });
      const max = Math.ceil(rule.windowMs / 1000);
      for (const d of deltas) {
        clock.t += d;
        const res = rl.consume('k', rule);
        if (!res.allowed) {
          assert.ok(Number.isInteger(res.retryAfterSeconds));
          assert.ok(res.retryAfterSeconds >= 1 && res.retryAfterSeconds <= max);
        }
      }
    }),
    { numRuns: 100 },
  );
});

test('Property 13: waiting retryAfterSeconds after a refusal allows the call', () => {
  fc.assert(
    fc.property(arbRule, arbDeltas, (rule, deltas) => {
      const clock = fakeClock();
      const rl = createRateLimiter({ clock });
      for (const d of deltas) {
        clock.t += d;
        const res = rl.consume('k', rule);
        if (!res.allowed) {
          // A refused call records nothing, so waiting then retrying is a clean test.
          clock.t += res.retryAfterSeconds * 1000;
          assert.equal(rl.consume('k', rule).allowed, true);
        }
      }
    }),
    { numRuns: 100 },
  );
});

test('Property 13: different keys never affect each other', () => {
  const arbCalls = fc.array(
    fc.record({ key: fc.constantFrom('a', 'b', 'c'), delta: fc.integer({ min: 0, max: 5_000 }) }),
    { minLength: 1, maxLength: 60 },
  );
  fc.assert(
    fc.property(arbRule, arbCalls, (rule, calls) => {
      const clock = fakeClock();
      const shared = createRateLimiter({ clock });
      const solo = {};
      const soloClocks = {};
      for (const k of ['a', 'b', 'c']) {
        soloClocks[k] = fakeClock();
        solo[k] = createRateLimiter({ clock: soloClocks[k] });
      }
      for (const { key, delta } of calls) {
        clock.t += delta;
        soloClocks[key].t = clock.t;
        const got = shared.consume(key, rule);
        const expected = solo[key].consume(key, rule);
        assert.deepEqual(got, expected);
      }
    }),
    { numRuns: 100 },
  );
});

test('consumeAll is atomic: a refused check does not consume the other key budget', () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ clock });
  const ip = { key: 'quote:1.2.3.4', ...RULES.quote };
  const perListing = { key: 'quote:1.2.3.4:abc', ...RULES['quote-listing'] };

  // Exhaust the per-listing budget directly.
  for (let i = 0; i < perListing.limit; i++) {
    assert.equal(rl.consume(perListing.key, perListing).allowed, true);
  }

  // Combined call is refused because of the per-listing key.
  const refused = rl.consumeAll([ip, perListing]);
  assert.equal(refused.allowed, false);
  assert.ok(Number.isInteger(refused.retryAfterSeconds) && refused.retryAfterSeconds >= 1);

  // The per-IP budget was untouched: its full limit is still available.
  for (let i = 0; i < ip.limit; i++) {
    assert.equal(rl.consume(ip.key, ip).allowed, true, `ip call ${i + 1}`);
  }
  assert.equal(rl.consume(ip.key, ip).allowed, false);
});

test('consumeAll records every key when all checks allow', () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ clock });
  const a = { key: 'a', limit: 1, windowMs: 60_000 };
  const b = { key: 'b', limit: 2, windowMs: 60_000 };
  assert.equal(rl.consumeAll([a, b]).allowed, true);
  assert.equal(rl.consume('a', a).allowed, false);
  assert.equal(rl.consume('b', b).allowed, true);
  assert.equal(rl.consume('b', b).allowed, false);
});

test('key cap eviction keeps size <= cap', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 8 }),
      fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 80 }),
      (cap, keyIds) => {
        const clock = fakeClock();
        const rl = createRateLimiter({ clock, maxKeys: cap });
        for (const id of keyIds) {
          rl.consume(`key-${id}`, { limit: 5, windowMs: 60_000 });
          assert.ok(rl.size() <= cap, `size ${rl.size()} > cap ${cap}`);
        }
      },
    ),
    { numRuns: 100 },
  );
});

test('eviction removes the least recently used key', () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ clock, maxKeys: 3 });
  const rule = { limit: 1, windowMs: 60_000 };
  rl.consume('k0', rule);
  rl.consume('k1', rule);
  rl.consume('k2', rule);
  // Refused call on k0 still marks it as recently used.
  assert.equal(rl.consume('k0', rule).allowed, false);
  // New key evicts the oldest, which is now k1.
  rl.consume('k3', rule);
  assert.equal(rl.size(), 3);
  assert.equal(rl.consume('k0', rule).allowed, false, 'k0 kept');
  assert.equal(rl.consume('k1', rule).allowed, true, 'k1 was evicted, so it starts fresh');
});

test('expired keys are removed so size drops back', () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ clock });
  const rule = { limit: 1, windowMs: 1000 };
  rl.consume('x', rule);
  assert.equal(rl.size(), 1);
  clock.t += 1000;
  assert.equal(rl.consume('x', rule).allowed, true);
  assert.equal(rl.size(), 1);
});
