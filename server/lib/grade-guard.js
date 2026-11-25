/**
 * grade-guard.js — the day's counts and the heads-up emails for the bot protection on the AI Visibility
 * Check (Feature G).
 *
 * The counters live in the AI budget (`note`, `notes`, `once`), so they follow its Chicago day and survive
 * a restart the same day. This file names them:
 *   checks     a Grade started
 *   humanPass  the human check said "ok" (a check let through because Cloudflare was unreachable or the
 *              setup is wrong is not a pass)
 *   human      turned away by the human check
 *   limit      turned away by a per-address limit
 *   network    turned away by the per-network limit
 *
 * The emails (counts only, to ADMIN_EMAIL through the notifier, never a business name or an owner's details):
 *   - at 50% and at 90% of the Grader's AI calls for the day, worked out as used / (used + left), because the
 *     shared caps can hold `left` below what GRADE_AI_CALLS_PER_DAY says;
 *   - once a day, "the human check may be set up wrong", when it has turned away 10 or more checks and
 *     passed none. That rule also runs when a check is turned away, because a lockout starts no AI call and
 *     no Grade, so `watch()` would never run.
 * `once()` is called only at the moment of sending, so nothing is flagged for an email that cannot go out
 * (no email service). It is true before the flag is on disk and before the send finishes: a crash in between
 * can send a second email after the restart, and a failed email is not tried again that day.
 *
 * Nothing here reads grades.json, logs typed input, waits for an email, or throws: `watch()` catches
 * everything and always returns undefined, so a request can call it without a try/catch.
 */

const COUNTS = ['checks', 'humanPass', 'human', 'limit', 'network'];
const LOOKUP_COUNTS = ['placesOk', 'placesError', 'bingOk', 'bingError'];
const TURNED_AWAY = new Set(['human', 'limit', 'network']);
const MISCONFIGURED = 'misconfigured';
const THRESHOLDS = [50, 90];
const HUMAN_CHECK_MIN = 10;

/**
 * @param {{ aiBudget: object, notifier?: object, log?: (line: string) => void }} deps
 */
export function createGradeGuard({ aiBudget, notifier, log = () => {} } = {}) {
  const say = line => {
    try {
      log(line);
    } catch {
      // a failing log must not break a check
    }
  };

  function note(name) {
    try {
      aiBudget?.note?.(name);
    } catch {
      say('guard-count-failed');
    }
  }

  const todaysNotes = () => aiBudget?.notes?.() ?? {};
  const count = (notes, name) => (Number.isInteger(notes[name]) ? notes[name] : 0);

  /** True when `method` can really send: a notifier that is not the "none" one, with that method. */
  const canSend = method => Boolean(notifier) && notifier.name !== 'none' && typeof notifier[method] === 'function';

  /**
   * Sends one email, once per day per `flag`, without waiting for it. `once` is called only here, at the
   * moment of sending. A throw, a rejection or a reported failure logs `label` (a threshold, no detail).
   */
  function sendOnce(flag, method, payload, label) {
    if (!canSend(method)) return;
    if (aiBudget?.once?.(flag) !== true) return;
    Promise.resolve()
      .then(() => notifier[method](payload))
      .then(result => {
        if (result && result.sent === false) say(`${label}-failed`);
      })
      .catch(() => say(`${label}-failed`));
  }

  /** 50% and 90% of the day's Grader AI calls. Nothing is sent when used + left is 0. */
  function checkAllowance() {
    const { used, left } = aiBudget?.usage?.({ kind: 'grade' }) ?? {};
    if (!Number.isInteger(used) || !Number.isInteger(left)) return;
    const limit = used + left;
    if (limit <= 0) return;
    const checks = count(todaysNotes(), 'checks');
    for (const percent of THRESHOLDS) {
      if (used * 100 >= percent * limit) {
        sendOnce(`email${percent}`, 'notifyAllowance', { percent, used, left, limit, checks }, `allowance-email-${percent}`);
      }
    }
  }

  /** "The human check may be set up wrong": 10 or more turned away today and none passed. */
  function checkHumanCheck() {
    const notes = todaysNotes();
    const human = count(notes, 'human');
    if (human >= HUMAN_CHECK_MIN && count(notes, 'humanPass') === 0) {
      sendOnce('humanSetup', 'notifyHumanCheck', { human }, 'human-check-email');
    }
  }

  const guard = {
    /** One check turned away: kind is 'human', 'limit' (per address) or 'network'. Anything else counts nothing. */
    turnedAway(kind) {
      if (!TURNED_AWAY.has(kind)) return;
      note(kind);
      // A lockout starts no AI call and no Grade, so watch() would never see it.
      if (kind === 'human') {
        try {
          checkHumanCheck();
        } catch {
          say('guard-watch-failed');
        }
      }
    },
    /** One check passed the human check (only an `ok` from Cloudflare). */
    passed() {
      note('humanPass');
    },
    /** One Grade started. */
    started() {
      note('checks');
      guard.watch();
    },
    /** Cloudflare said the secret is wrong or it has an error of its own; the admin page shows it. */
    misconfigured() {
      note(MISCONFIGURED);
    },
    /**
     * Called, without waiting, after each counted AI call and each new Grade. Sends the heads-up emails
     * that are due. Catches everything and always returns undefined.
     */
    watch() {
      try {
        checkAllowance();
        checkHumanCheck();
      } catch {
        say('guard-watch-failed');
      }
      return undefined;
    },
    /** Today's numbers for the admin page, all from the budget. */
    summary() {
      let usage = { used: 0, left: 0, limit: 0 };
      let notes = {};
      try {
        usage = aiBudget?.usage?.({ kind: 'grade' }) ?? usage;
        notes = aiBudget?.notes?.() ?? {};
      } catch {
        say('guard-summary-failed');
      }
      const counts = {};
      for (const name of COUNTS) counts[name] = count(notes, name);
      // The Google and Bing lookups' ok / error counts for today (the grader notes them; no key, no body).
      const lookups = {};
      for (const name of LOOKUP_COUNTS) lookups[name] = count(notes, name);
      return { usage, counts, lookups, misconfigured: count(notes, MISCONFIGURED) > 0 };
    },
  };
  return guard;
}
