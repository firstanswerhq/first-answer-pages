/**
 * watch-service.js: the monthly watch's service (addon-monthly-watch task 6). It owns the timer's logic, not the timer.
 *
 *  - start({ gradeId, email }): a new watch for a finished, claimed Grade. With an email it waits for the owner to
 *    confirm (`pending`, a confirm email goes out); without one it starts at once (`active`).
 *  - confirm(id, token): a pending watch becomes active.
 *  - stop(id, token): the watch and its email address are deleted.
 *  - get(id): the watch record, or undefined.
 *  - runDue(now): deletes pending watches older than 7 days, then reads the due watches, oldest first, within the
 *    budget floor (more than 25 Grader calls left) and the daily cap (WATCH_MAX_PER_DAY readings).
 *
 * Logs hold the watch id, step names and counts only: never the business, the email, the question or an answer.
 */

import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

import { freeAnswersOf, freeQuestion, sameBusinessInput } from './grader.js';
import { normalizeEmail } from './listing-fields.js';
import { newWatch, dueWatches, addReading, confirmedChange, lastReading, makeReading } from './watch.js';
import { watchEmails } from './watch-html.js';
import { EMAIL_RE } from './notifier.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** No reading runs when this many or fewer Grader calls are left today (requirement 7). */
export const WATCH_BUDGET_FLOOR = 25;
/** A reading that cannot run is tried again the next day, on at most this many days (requirement 7). */
export const WATCH_MAX_RETRIES = 3;
/** A pending watch not confirmed in this many days is deleted. */
export const PENDING_DAYS = 7;
/** This many failed sends in a row pause a watch (requirement 13). */
export const MAX_SEND_FAILURES = 3;
/** The aiBudget day counter for watch readings. */
export const WATCH_RUNS_NOTE = 'watchRuns';
/** At most this many confirm emails to one address in 24 hours (code fix 1). */
export const MAX_CONFIRM_EMAILS = 2;
/** A paused watch, and its address, is deleted after this many days (code fix 4). */
export const PAUSED_DAYS = 14;
/** The address-limit maps keep at most this many keys. */
const ADDRESS_KEYS_MAX = 10000;

// The Chicago day, as aiBudget counts days.
const CHICAGO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });

const iso = ms => new Date(ms).toISOString();
const toMs = t => (t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : Number(t));

/** One line of plain text: control characters and line breaks removed, spaces collapsed. */
export function plainLine(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Two strings equal in constant time (a wrong token never tells how much of it was right). */
function sameToken(given, kept) {
  if (typeof given !== 'string' || typeof kept !== 'string' || kept === '') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(kept);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The links in a watch email. URLs come from config.baseUrl only (never a request's Host). */
export function watchUrls(baseUrl, watch) {
  const base = String(baseUrl ?? '').replace(/\/+$/u, '');
  const id = encodeURIComponent(watch.id);
  return {
    page: `${base}/watch/${id}`,
    confirm: `${base}/watch/${id}/confirm?t=${encodeURIComponent(watch.confirmToken)}`,
    stop: `${base}/watch/${id}/stop?t=${encodeURIComponent(watch.stopToken)}`,
  };
}

/** The unsubscribe headers every watch email carries (requirement 11). */
export function unsubscribeHeaders(urls) {
  return { 'List-Unsubscribe': `<${urls.stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

/**
 * The plain-text email builders used when none are passed: the same wording as the app's (`watchEmails` in
 * watch-html.js), with no postal address and no Questions line. No HTML; every inserted value on one plain line.
 */
export const defaultEmails = Object.freeze(watchEmails());

/** A reading's fields from one Grade answer list: named if any main answer named it. */
function readingFromAnswers(answers) {
  const named = answers.some(a => a.named === true);
  const pick = answers.find(a => a.named === true) ?? answers[0];
  return {
    named,
    position: Number.isInteger(pick?.position) ? pick.position : null,
    total: Number.isInteger(pick?.total) ? pick.total : 0,
    competitors: Array.isArray(pick?.competitors) ? pick.competitors : [],
  };
}

/**
 * @param {{ store: object, grader: { readFree: Function, get: Function, watchEligible: Function },
 *   aiBudget: object, notifier: object, clock: { now(): number }, newId?: () => string, config?: object,
 *   log?: (line: string) => void, newToken?: () => string, emails?: typeof defaultEmails }} deps
 */
export function createWatchService({
  store, grader, aiBudget, notifier, clock, newId, config = {}, log = () => {},
  newToken = () => randomBytes(24).toString('base64url'),
  emails = defaultEmails,
}) {
  const watches = () => store.collection('watches');
  const makeId = typeof newId === 'function' ? newId : () => randomBytes(16).toString('base64url');
  const repeatDays = () => (Number.isInteger(config.gradeAiRepeatDays) ? config.gradeAiRepeatDays : 0);
  const maxPerDay = () => (Number.isInteger(config.watchMaxPerDay) ? config.watchMaxPerDay : 10);
  const maxActive = () => (Number.isInteger(config.watchMaxActive) ? config.watchMaxActive : 200);
  const withLock = (name, fn) => (typeof store.withLock === 'function' ? store.withLock(name, fn) : fn());

  /** Changes one record in place; returns the changed copy, or null when it is gone (or `fn` returned false). */
  async function change(id, fn) {
    let out = null;
    await watches().update(list => {
      const w = Array.isArray(list) ? list.find(x => x && x.id === id) : undefined;
      if (!w) return;
      if (fn(w) === false) return;
      out = structuredClone(w);
    });
    return out;
  }

  /** Sends one owner email; counts a failed send, and 3 in a row pause the watch. Never throws. */
  async function send(watch, message) {
    let res;
    try {
      res = await notifier.sendToOwner({
        to: watch.email,
        subject: message.subject,
        text: message.text,
        headers: unsubscribeHeaders(watchUrls(config.baseUrl, watch)),
      });
    } catch {
      res = { sent: false, error: 'exception' };
    }
    if (res?.sent === true) {
      await change(watch.id, w => { w.sendFailures = 0; });
      log(`watch-email-sent id=${watch.id}`);
      return true;
    }
    // A notifier that does not send email (none, console) is not a failure; only a send that was tried and failed is.
    if (!res?.error) return false;
    const after = await change(watch.id, w => {
      w.sendFailures = (Number.isInteger(w.sendFailures) ? w.sendFailures : 0) + 1;
      if (w.sendFailures >= MAX_SEND_FAILURES && w.status === 'active') {
        w.status = 'paused';
        // A paused watch keeps its address only PAUSED_DAYS more days (code fix 4).
        w.pausedAt = iso(clock.now());
      }
    });
    log(`watch-email-failed id=${watch.id} failures=${after?.sendFailures ?? 0}${after?.status === 'paused' ? ' paused' : ''}`);
    return false;
  }

  // ---- confirm-email limits (code fix 1). Kept in memory, keyed by a keyed hash of the address: the plain address is
  // never a key and never logged. A restart clears them, which only ever allows a few more emails, never fewer.
  const confirmSends = new Map(); // address key -> times a confirm email was sent (ms), newest last
  const stoppedAt = new Map(); // address key -> when a watch with this address was stopped (ms)
  const addressKey = address => createHmac('sha256', `watch-address:${String(config.graderSecret ?? '')}`)
    .update(String(address).trim().toLowerCase()).digest('base64url');
  const remember = (map, key, value) => {
    map.delete(key);
    map.set(key, value);
    while (map.size > ADDRESS_KEYS_MAX) map.delete(map.keys().next().value);
  };
  const sendsToday = (key, now) => {
    const kept = (confirmSends.get(key) ?? []).filter(t => t > now - DAY_MS);
    if (kept.length > 0) confirmSends.set(key, kept);
    else confirmSends.delete(key);
    return kept.length;
  };
  const stoppedRecently = (key, now) => {
    const t = stoppedAt.get(key);
    if (t === undefined) return false;
    if (t > now - DAY_MS) return true;
    stoppedAt.delete(key);
    return false;
  };

  /**
   * Starts a watch for a finished Grade whose business has claimed a listing. At most one watch per Grade: a second
   * start returns the one there (`existing: true`) and sends nothing. An address gets at most 2 confirm emails in 24
   * hours, and none for 24 hours after a watch with it was stopped (`reason: 'email_limit'`).
   * @returns {Promise<{ ok: true, watch: object, existing?: true }
   *   | { ok: false, reason: 'not_eligible'|'full'|'email'|'email_limit' }>}
   */
  async function start({ gradeId, email = null } = {}) {
    let address = null;
    if (typeof email === 'string' && email.trim() !== '') {
      address = normalizeEmail(email);
      // The same check the Resend notifier makes, so "a,b@x.com" is refused here and never reaches a send (code fix 6).
      if (!address || address.length > 254 || !EMAIL_RE.test(address)) return { ok: false, reason: 'email' };
    }
    const grade = typeof gradeId === 'string' ? await grader.get(gradeId) : undefined;
    if (!grade || !(await grader.watchEligible(gradeId))) return { ok: false, reason: 'not_eligible' };

    const already = async () => {
      const list = await watches().read();
      const w = Array.isArray(list) ? list.find(x => x && x.gradeId === gradeId) : undefined;
      return w ? { ok: true, existing: true, watch: structuredClone(w) } : null;
    };
    const there = await already();
    if (there) return there;

    const now = clock.now();
    const key = address ? addressKey(address) : null;
    if (key && (stoppedRecently(key, now) || sendsToday(key, now) >= MAX_CONFIRM_EMAILS)) {
      log('watch-email-limit');
      return { ok: false, reason: 'email_limit' };
    }

    const first = readingFromAnswers(freeAnswersOf(Array.isArray(grade.ai) ? grade.ai : []));
    let made = null;
    let full = false;
    let raced = false;
    // Not behind the `watch-run` lock: a start never waits for an hourly run's AI asks. The file update is queued, and
    // the one-watch-per-Grade rule is checked again inside it, so two starts at once make one watch.
    await watches().update(list => {
      if (list.some(w => w && w.gradeId === gradeId)) { raced = true; return; }
      const open = list.filter(w => w && (w.status === 'active' || w.status === 'pending')).length;
      if (open >= maxActive()) { full = true; return; }
      made = newWatch({
        id: makeId(), gradeId, input: grade.input, email: address,
        confirmToken: newToken(), stopToken: newToken(), now, first, repeatDays: repeatDays(),
      });
      list.push(made);
    });
    if (raced) return (await already()) ?? { ok: false, reason: 'not_eligible' };
    if (full) {
      log('watch-full');
      return { ok: false, reason: 'full' };
    }
    log(`watch-started id=${made.id} status=${made.status}`);
    if (made.email) {
      remember(confirmSends, key, [...(confirmSends.get(key) ?? []), now]);
      await send(made, emails.confirm({ watch: made, urls: watchUrls(config.baseUrl, made) }));
    }
    return { ok: true, watch: (await get(made.id)) ?? made };
  }

  /** A pending watch becomes active with the right confirm token. An active watch stays as it is. */
  async function confirm(id, token) {
    let state = 'not_found';
    const after = await change(id, w => {
      if (!sameToken(token, w.confirmToken)) { state = 'bad_token'; return false; }
      if (w.status !== 'pending') { state = 'already'; return false; }
      w.status = 'active';
      w.confirmedAt = iso(clock.now());
      state = 'confirmed';
      return true;
    });
    if (state === 'confirmed') log(`watch-confirmed id=${id}`);
    if (state === 'confirmed' || state === 'already') return { ok: true, state, watch: after ?? (await get(id)) };
    return { ok: false, state };
  }

  /** Deletes the watch and its email address, with the right stop token. */
  async function stop(id, token) {
    let removed = false;
    let address = null;
    await watches().update(list => {
      const i = list.findIndex(w => w && w.id === id);
      if (i === -1 || !sameToken(token, list[i].stopToken)) return;
      address = list[i].email;
      list.splice(i, 1);
      removed = true;
    });
    // A stopped address gets no new confirm email for 24 hours (only its keyed hash is kept).
    if (removed && address) remember(stoppedAt, addressKey(address), clock.now());
    if (removed) log(`watch-stopped id=${id}`);
    return { ok: removed };
  }

  async function get(id) {
    if (typeof id !== 'string' || id === '') return undefined;
    const list = await watches().read();
    const w = Array.isArray(list) ? list.find(x => x && x.id === id) : undefined;
    return w ? structuredClone(w) : undefined;
  }

  /**
   * A full check of the same business with a fresh AI answer, made in the last GRADE_AI_REPEAT_DAYS days and after
   * the watch's last reading: its answer is the reading, and nothing new is asked (requirement 6).
   */
  async function reusedReading(watch, now) {
    const days = repeatDays();
    if (days <= 0) return null;
    const list = await store.collection('grades').read();
    if (!Array.isArray(list)) return null;
    const cutoff = now - days * DAY_MS;
    const since = Date.parse(watch.lastCheckedAt);
    const about = watch.input?.about ?? '';
    let best = null;
    for (const g of list) {
      if (!g || typeof g !== 'object' || g.status !== 'done' || g.byAdmin === true) continue;
      const at = Date.parse(g.createdAt);
      if (!Number.isFinite(at) || at < cutoff || at > now || (Number.isFinite(since) && at <= since)) continue;
      if (!sameBusinessInput(g.input, watch.input) || (g.input?.about ?? '') !== about) continue;
      const fresh = freeAnswersOf(Array.isArray(g.ai) ? g.ai : []).filter(a => !a.reusedFrom && typeof a.named === 'boolean');
      if (fresh.length === 0) continue;
      if (!best || at > best.at) best = { at, answers: fresh };
    }
    return best ? readingFromAnswers(best.answers) : null;
  }

  // ---- the daily cap (code fix 3) -----------------------------------------------------------------------------
  // The watch's own count of today's asks, kept here so the aiBudget's 50-name limit on notes can never stop it
  // counting. The aiBudget note is still written (it survives a restart and shows on the admin page); the higher of the
  // two counts is used, and a note that could not be written (0) is taken as the cap reached, so the cap fails closed.
  const runs = { day: '', count: 0 };
  const runsToday = now => {
    const day = CHICAGO_DAY.format(new Date(now));
    if (runs.day !== day) {
      runs.day = day;
      runs.count = 0;
    }
    return Math.max(runs.count, aiBudget.notes()[WATCH_RUNS_NOTE] ?? 0);
  };
  const capReached = now => runsToday(now) >= maxPerDay();
  /** Counts one ask. False when the cap is reached, or the aiBudget note could not be written. */
  const countAsk = now => {
    if (capReached(now)) return false;
    runs.count += 1;
    return aiBudget.note(WATCH_RUNS_NOTE) !== 0;
  };

  /**
   * One ask through the watch's reader (its AI call is also counted by the grader's own budget use). Every ask counts
   * toward WATCH_MAX_PER_DAY, the confirming second ask too. Returns { capped: true } when the cap stops it.
   */
  async function ask(watch, now) {
    if (!countAsk(now)) return { capped: true };
    try {
      const r = await grader.readFree(watch.input);
      return r && r.state === 'ok' ? r : null;
    } catch {
      return null;
    }
  }

  const belowFloor = () => aiBudget.peek({ kind: 'grade' }).remaining <= WATCH_BUDGET_FLOOR;

  /** A reading that could not run: tried again tomorrow, and after 3 more days recorded as "couldn't check". */
  async function failed(id, now) {
    let gaveUp = false;
    await change(id, w => {
      const retries = (Number.isInteger(w.retries) ? w.retries : 0) + 1;
      if (retries > WATCH_MAX_RETRIES) {
        Object.assign(w, addReading(w, makeReading({ at: now, named: false, source: 'none' }), { now, repeatDays: repeatDays() }));
        gaveUp = true;
      } else {
        w.retries = retries;
        w.nextDueAt = iso(now + DAY_MS);
      }
    });
    log(`watch-read-failed id=${id}${gaveUp ? ' recorded=none' : ''}`);
    return gaveUp ? 'none' : 'retry';
  }

  /** Reads one due watch. Returns the step taken. */
  async function readOne(watch, now) {
    // Move the due date before anything is asked, so a second run (another process, a slow tick) skips this watch.
    const claimed = await change(watch.id, w => {
      if (w.status !== 'active' || !(Date.parse(w.nextDueAt) <= now)) return false;
      w.nextDueAt = iso(now + DAY_MS);
      return true;
    });
    if (!claimed) return 'skipped';

    const before = lastReading(claimed);
    let reading = null;
    let source = 'reused';
    try {
      reading = await reusedReading(claimed, now);
    } catch {
      reading = null;
    }
    if (!reading) {
      source = 'ask';
      reading = await ask(claimed, now);
      // The cap stopped it before anything was asked: due again tomorrow (the claim moved the date), not a failure.
      if (reading?.capped) return 'capped';
      if (!reading) return failed(claimed.id, now);
    }

    // A reading that differs from the one before is asked once more; the change is kept only when both agree.
    let changed = null;
    if (before && before.named !== reading.named) {
      if (belowFloor()) return failed(claimed.id, now);
      const second = await ask(claimed, now);
      if (second?.capped) return 'capped';
      if (!second) return failed(claimed.id, now);
      changed = confirmedChange(before, reading, second);
      if (!changed) {
        // The two answers did not agree: no change. The second answer (the same as before) is the reading.
        reading = second;
        source = 'ask';
      }
    }

    const saved = await change(claimed.id, w => {
      Object.assign(w, addReading(w, makeReading({ ...reading, at: now, source }), {
        now, repeatDays: repeatDays(), changed: Boolean(changed),
      }));
    });
    if (!saved) return 'gone';
    log(`watch-read id=${saved.id} source=${source}${changed ? ` change=${changed}` : ''}`);

    if (changed && saved.email && saved.status === 'active') {
      const last = saved.readings[saved.readings.length - 1];
      await send(saved, emails.change({
        watch: saved, change: changed, reading: last, question: freeQuestion(saved.input),
        urls: watchUrls(config.baseUrl, saved),
      }));
    }
    return changed ? `change-${changed}` : source;
  }

  /**
   * Deletes pending watches not confirmed in 7 days, and paused watches (with their address) paused for more than 14
   * days (code fix 4). Returns how many. A paused watch with no pause date (made before the date was kept) counts
   * from its last check.
   */
  async function prunePending(now) {
    let removed = 0;
    await watches().update(list => {
      const kept = list.filter(w => {
        if (!w) return true;
        const pendingOld = w.status === 'pending' && Date.parse(w.createdAt) <= now - PENDING_DAYS * DAY_MS;
        const pausedSince = Date.parse(w.pausedAt ?? w.lastCheckedAt);
        const pausedOld = w.status === 'paused' && Number.isFinite(pausedSince) && pausedSince < now - PAUSED_DAYS * DAY_MS;
        if (pendingOld || pausedOld) removed += 1;
        return !(pendingOld || pausedOld);
      });
      return removed > 0 ? kept : undefined;
    });
    if (removed > 0) log(`watch-pruned count=${removed}`);
    return removed;
  }

  /**
   * The hourly run. Returns counts only.
   * @returns {Promise<{ pruned: number, due: number, asked: number, reused: number, failed: number, changes: number,
   *   stopped: null | 'floor' | 'cap' }>}
   */
  function runDue(at = clock.now()) {
    const now = toMs(at);
    return withLock('watch-run', async () => {
      const out = { pruned: 0, due: 0, asked: 0, reused: 0, failed: 0, changes: 0, stopped: null };
      out.pruned = await prunePending(now);
      const due = dueWatches(await watches().read(), now);
      out.due = due.length;
      for (const w of due) {
        if (belowFloor()) { out.stopped = 'floor'; break; }
        if (capReached(now)) { out.stopped = 'cap'; break; }
        let step;
        try {
          step = await readOne(w, now);
        } catch {
          log(`watch-run-failed id=${w.id}`);
          continue;
        }
        if (step === 'capped') { out.stopped = 'cap'; break; }
        if (step === 'reused') out.reused += 1;
        else if (step === 'ask') out.asked += 1;
        else if (step === 'retry' || step === 'none') out.failed += 1;
        else if (step.startsWith('change-')) { out.asked += 1; out.changes += 1; }
      }
      log(`watch-run due=${out.due} asked=${out.asked} reused=${out.reused} failed=${out.failed} changes=${out.changes}${out.stopped ? ` stopped=${out.stopped}` : ''}`);
      return out;
    });
  }

  /** True when WATCH_MAX_ACTIVE watches (active or waiting for a confirm) exist, so the form says it is full. */
  async function isFull() {
    const list = await watches().read();
    const open = (Array.isArray(list) ? list : []).filter(w => w && (w.status === 'active' || w.status === 'pending')).length;
    return open >= maxActive();
  }

  return { start, confirm, stop, get, runDue, prunePending, isFull };
}

// ---- the hourly timer (task 9) --------------------------------------------------------------------------------------

/** One hour between ticks. */
export const WATCH_TICK_MS = 60 * 60 * 1000;

/** The timer runs only with WATCH_ENABLED=on, and never in a test run. */
export function shouldStartWatchTimer(config = {}) {
  return config.watchEnabled === true && config.testRun !== true;
}

/**
 * One tick: nothing runs while the Grader's checks are at GRADE_MAX_RUNNING (requirement 15); otherwise `runDue`,
 * which also deletes pending watches older than 7 days. Never rejects: a failure logs a step name only (each watch's
 * own failure is logged with its id inside `runDue`).
 * @param {{ service: { runDue: Function }, grader?: { busy?: () => boolean }, log?: (line: string) => void }} opts
 */
export function watchTick({ service, grader, log = () => {} }) {
  if (typeof grader?.busy === 'function' && grader.busy()) {
    log('watch-tick-skipped reason=busy');
    return Promise.resolve(null);
  }
  return Promise.resolve()
    .then(() => service.runDue())
    .catch(() => {
      log('watch-tick-failed');
      return null;
    });
}

/**
 * Starts the hourly timer and returns it, unref'd so it never keeps the process alive. Tests pass a fake
 * `setIntervalFn`; no real timer runs in a test.
 */
export function startWatchTimer({ tick, setIntervalFn = setInterval, everyMs = WATCH_TICK_MS }) {
  const timer = setIntervalFn(() => {
    Promise.resolve().then(tick).catch(() => {});
  }, everyMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}
