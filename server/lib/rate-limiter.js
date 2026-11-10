/**
 * Sliding-window-log rate limiter, in memory.
 *
 * Each key holds an array of call timestamps (ms). A call is allowed when
 * fewer than `limit` timestamps fall inside the window (now - windowMs, now].
 * Empty keys are deleted, and the total key count is capped with LRU eviction
 * so a flood of spoofed addresses cannot grow memory without bound.
 */

/** Maximum number of distinct keys held at once. */
export const MAX_KEYS = 10000;

/** Rate limit rules used by the routes. */
export const RULES = Object.freeze({
  rise: Object.freeze({ limit: 10, windowMs: 10 * 60 * 1000 }),
  mcp: Object.freeze({ limit: 120, windowMs: 60 * 1000 }),
  quote: Object.freeze({ limit: 5, windowMs: 60 * 60 * 1000 }),
  'quote-listing': Object.freeze({ limit: 3, windowMs: 60 * 60 * 1000 }),
  seance: Object.freeze({ limit: 10, windowMs: 60 * 60 * 1000 }),
  'seance-listing': Object.freeze({ limit: 1, windowMs: 10 * 60 * 1000 }),
  'admin-auth': Object.freeze({ limit: 10, windowMs: 60 * 60 * 1000 }),
});

const systemClock = { now: () => Date.now() };

/**
 * @param {{ clock?: { now(): number }, maxKeys?: number }} [options]
 */
export function createRateLimiter({ clock = systemClock, maxKeys = MAX_KEYS } = {}) {
  /** @type {Map<string, number[]>} Map order doubles as LRU order (oldest first). */
  const logs = new Map();

  /** Drop timestamps at or before now - windowMs; delete the key if empty. */
  function prune(key, windowMs, now) {
    const log = logs.get(key);
    if (!log) return undefined;
    const cutoff = now - windowMs;
    let i = 0;
    while (i < log.length && log[i] <= cutoff) i++;
    if (i > 0) log.splice(0, i);
    if (log.length === 0) {
      logs.delete(key);
      return undefined;
    }
    return log;
  }

  /** Mark a key as most recently used. */
  function touch(key, log) {
    logs.delete(key);
    logs.set(key, log);
  }

  function evictIfNeeded(protectedKeys) {
    while (logs.size > maxKeys) {
      let victim;
      for (const k of logs.keys()) {
        if (!protectedKeys.has(k)) {
          victim = k;
          break;
        }
      }
      if (victim === undefined) return;
      logs.delete(victim);
    }
  }

  /**
   * Check every check; record all of them only if all allow.
   * @param {{ key: string, limit: number, windowMs: number }[]} checks
   * @returns {{ allowed: boolean, retryAfterSeconds?: number }}
   */
  function consumeAll(checks) {
    const now = clock.now();
    let retry = 0;
    let allowed = true;

    for (const { key, limit, windowMs } of checks) {
      const log = prune(key, windowMs, now);
      const count = log ? log.length : 0;
      if (count >= limit) {
        allowed = false;
        const maxSeconds = Math.ceil(windowMs / 1000);
        let seconds = maxSeconds;
        if (log && limit > 0) {
          const blocking = log[log.length - limit];
          seconds = Math.ceil((blocking + windowMs - now) / 1000);
        }
        seconds = Math.min(Math.max(seconds, 1), maxSeconds);
        if (seconds > retry) retry = seconds;
        if (log) touch(key, log);
      }
    }

    if (!allowed) return { allowed: false, retryAfterSeconds: retry };

    const batch = new Set();
    for (const { key } of checks) {
      const log = logs.get(key) ?? [];
      log.push(now);
      touch(key, log);
      batch.add(key);
    }
    evictIfNeeded(batch);
    return { allowed: true };
  }

  /**
   * @param {string} key
   * @param {{ limit: number, windowMs: number }} rule
   */
  function consume(key, { limit, windowMs }) {
    return consumeAll([{ key, limit, windowMs }]);
  }

  /**
   * Check a key without recording a call.
   * @param {string} key
   * @param {{ limit: number, windowMs: number }} rule
   * @returns {{ allowed: boolean, retryAfterSeconds?: number }}
   */
  function peek(key, { limit, windowMs }) {
    const now = clock.now();
    const log = prune(key, windowMs, now);
    const count = log ? log.length : 0;
    if (count < limit) return { allowed: true };
    const maxSeconds = Math.ceil(windowMs / 1000);
    let seconds = maxSeconds;
    if (log && limit > 0) {
      seconds = Math.ceil((log[log.length - limit] + windowMs - now) / 1000);
    }
    return { allowed: false, retryAfterSeconds: Math.min(Math.max(seconds, 1), maxSeconds) };
  }

  return {
    consume,
    consumeAll,
    peek,
    /** Number of keys currently tracked (for tests). */
    size: () => logs.size,
  };
}
