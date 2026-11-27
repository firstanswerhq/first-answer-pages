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

import { randomBytes, timingSafeEqual } from 'node:crypto';

import { freeAnswersOf, freeQuestion, sameBusinessInput } from './grader.js';
import { normalizeEmail } from './listing-fields.js';
import { newWatch, dueWatches, addReading, confirmedChange, lastReading, makeReading } from './watch.js';

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

const SNAPSHOT_LINE = 'AI answers change from one time to the next, so this is one snapshot, not a ranking.';

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
 * Plain-text email builders. Task 7 (`watch-html.js`) brings the final wording; these keep the same rules: no HTML,
 * every inserted value on one plain line, no promise that anything makes AI name a business.
 */
export const defaultEmails = Object.freeze({
  confirm({ watch, urls }) {
    const name = plainLine(watch.input?.name);
    return {
      subject: `Confirm the monthly watch for ${name}`,
      text: [
        `Someone asked us to email this address once a month about how AI answers for ${name}.`,
        `To start the emails, open this page and press Confirm: ${urls.confirm}`,
        'If this was not you, do nothing. We delete the request in 7 days.',
        `Stop watching: ${urls.stop}`,
      ].join('\n'),
    };
  },
  change({ watch, change, reading, question, urls }) {
    const name = plainLine(watch.input?.name);
    const names = (reading.competitors ?? []).map(plainLine).filter(Boolean).join(', ');
    const started = change === 'started';
    const lines = [
      started ? 'AI named your business this time.' : 'AI did not name your business this time.',
      `We asked: ${plainLine(question)}`,
    ];
    if (names) lines.push(`${started ? 'AI named' : 'AI named instead'}: ${names}`);
    lines.push(SNAPSHOT_LINE, `Your watch page: ${urls.page}`, `Stop watching: ${urls.stop}`);
    return { subject: started ? `AI named ${name} this month` : `AI did not name ${name} this month`, text: lines.join('\n') };
  },
});

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
      if (w.sendFailures >= MAX_SEND_FAILURES && w.status === 'active') w.status = 'paused';
    });
    log(`watch-email-failed id=${watch.id} failures=${after?.sendFailures ?? 0}${after?.status === 'paused' ? ' paused' : ''}`);
    return false;
  }

  /**
   * Starts a watch for a finished Grade whose business has claimed a listing.
   * @returns {Promise<{ ok: true, watch: object } | { ok: false, reason: 'not_eligible'|'full'|'email' }>}
   */
  async function start({ gradeId, email = null } = {}) {
    let address = null;
    if (typeof email === 'string' && email.trim() !== '') {
      address = normalizeEmail(email);
      if (!address) return { ok: false, reason: 'email' };
    }
    const grade = typeof gradeId === 'string' ? await grader.get(gradeId) : undefined;
    if (!grade || !(await grader.watchEligible(gradeId))) return { ok: false, reason: 'not_eligible' };

    const now = clock.now();
    const first = readingFromAnswers(freeAnswersOf(Array.isArray(grade.ai) ? grade.ai : []));
    let made = null;
    let full = false;
    // Not behind the `watch-run` lock: a start never waits for an hourly run's AI asks. The file update is queued.
    await watches().update(list => {
      const open = list.filter(w => w && (w.status === 'active' || w.status === 'pending')).length;
      if (open >= maxActive()) { full = true; return; }
      made = newWatch({
        id: makeId(), gradeId, input: grade.input, email: address,
        confirmToken: newToken(), stopToken: newToken(), now, first, repeatDays: repeatDays(),
      });
      list.push(made);
    });
    if (full) {
      log('watch-full');
      return { ok: false, reason: 'full' };
    }
    log(`watch-started id=${made.id} status=${made.status}`);
    if (made.email) await send(made, emails.confirm({ watch: made, urls: watchUrls(config.baseUrl, made) }));
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
    await watches().update(list => {
      const i = list.findIndex(w => w && w.id === id);
      if (i === -1 || !sameToken(token, list[i].stopToken)) return;
      list.splice(i, 1);
      removed = true;
    });
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

  /**
   * One ask through the watch's reader (its AI call is counted by the grader's own budget use). A month's reading is
   * counted in today's watch readings; the confirm ask is not (WATCH_MAX_PER_DAY counts readings, not calls).
   */
  async function ask(watch, { reading = true } = {}) {
    if (reading) aiBudget.note(WATCH_RUNS_NOTE);
    try {
      const r = await grader.readFree(watch.input);
      return r && r.state === 'ok' ? r : null;
    } catch {
      return null;
    }
  }

  const belowFloor = () => aiBudget.peek({ kind: 'grade' }).remaining <= WATCH_BUDGET_FLOOR;
  const capReached = () => (aiBudget.notes()[WATCH_RUNS_NOTE] ?? 0) >= maxPerDay();

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
      reading = await ask(claimed);
      if (!reading) return failed(claimed.id, now);
    }

    // A reading that differs from the one before is asked once more; the change is kept only when both agree.
    let changed = null;
    if (before && before.named !== reading.named) {
      if (belowFloor()) return failed(claimed.id, now);
      const second = await ask(claimed, { reading: false });
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

  /** Deletes pending watches not confirmed in 7 days. Returns how many. */
  async function prunePending(now) {
    let removed = 0;
    await watches().update(list => {
      const kept = list.filter(w => {
        const old = w && w.status === 'pending' && Date.parse(w.createdAt) <= now - PENDING_DAYS * DAY_MS;
        if (old) removed += 1;
        return !old;
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
        if (capReached()) { out.stopped = 'cap'; break; }
        let step;
        try {
          step = await readOne(w, now);
        } catch {
          log(`watch-run-failed id=${w.id}`);
          continue;
        }
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
