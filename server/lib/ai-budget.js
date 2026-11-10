/**
 * ai-budget.js — in-memory daily cap on paid AI provider calls.
 *
 * Counts calls per UTC day. Resets at UTC midnight. Nothing is persisted.
 */

export const DEFAULT_AI_LIMIT = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{ clock: { now(): number }, limit?: number }} opts
 */
export function createAiBudget({ clock, limit } = {}) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_AI_LIMIT;
  let dayKey = '';
  let count = 0;

  function state() {
    const now = clock.now();
    const key = new Date(now).toISOString().slice(0, 10);
    if (key !== dayKey) {
      dayKey = key;
      count = 0;
    }
    const nextMidnight = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
    return {
      resetsAt: new Date(nextMidnight).toISOString(),
      retryAfterSeconds: Math.max(1, Math.ceil((nextMidnight - now) / 1000)),
    };
  }

  function result(allowed) {
    const s = state();
    return { allowed, remaining: Math.max(0, cap - count), ...s };
  }

  return {
    limit: cap,
    /** Counts one call if the cap allows it. Denied calls are not counted. */
    consume() {
      state();
      if (count >= cap) return result(false);
      count += 1;
      return result(true);
    },
    /** Reports the current state without counting. */
    peek() {
      state();
      return result(count < cap);
    },
  };
}
