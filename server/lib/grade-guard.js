/**
 * grade-guard.js — the day's counts for the bot protection on the AI Visibility Check (Feature G).
 *
 * The counters live in the AI budget (`note`, `notes`, `once`), so they follow its Chicago day and survive
 * a restart the same day. This file only names them:
 *   checks     a Grade started
 *   humanPass  the human check said "ok" (a check let through because Cloudflare was unreachable or the
 *              setup is wrong is not a pass)
 *   human      turned away by the human check
 *   limit      turned away by a per-address limit
 *   network    turned away by the per-network limit
 * Nothing here reads grades.json, logs typed input, or throws: a counting problem never stops a check.
 * `watch()` is where the heads-up emails go (task G4); for now it does nothing.
 */

const COUNTS = ['checks', 'humanPass', 'human', 'limit', 'network'];
const TURNED_AWAY = new Set(['human', 'limit', 'network']);
const MISCONFIGURED = 'misconfigured';

/**
 * @param {{ aiBudget: object, notifier?: object, store?: object, clock?: object, config?: object, log?: (line: string) => void }} deps
 */
export function createGradeGuard({ aiBudget, log = () => {} } = {}) {
  function note(name) {
    try {
      aiBudget?.note?.(name);
    } catch {
      log('guard-count-failed');
    }
  }

  const guard = {
    /** One check turned away: kind is 'human', 'limit' (per address) or 'network'. Anything else counts nothing. */
    turnedAway(kind) {
      if (TURNED_AWAY.has(kind)) note(kind);
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
    /** Called, without waiting, after each counted AI call and each new Grade. The heads-up emails come in G4. */
    watch() {
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
        log('guard-summary-failed');
      }
      const counts = {};
      for (const name of COUNTS) counts[name] = Number.isInteger(notes[name]) ? notes[name] : 0;
      return { usage, counts, misconfigured: Number.isInteger(notes[MISCONFIGURED]) && notes[MISCONFIGURED] > 0 };
    },
  };
  return guard;
}
