/**
 * ai-budget.js — daily cap on paid AI provider calls.
 *
 * The day runs midnight to midnight America/Chicago. The cap is a total
 * (MAX_AI_CALLS_PER_DAY) shared by every paid call; photo uploads may use at
 * most min(150, total - ceil(total / 4)) of it (at least 1 when the total is
 * 2 or more), so a quarter of the day is always held back for Séance runs,
 * even when the total is lowered. When a
 * `file` is given the day's counts are loaded from it at startup and written
 * after each counted call, so a restart does not reset the cap.
 */

import { readFileSync, unlinkSync } from 'node:fs';
import { updateJsonFile } from './json-file.js';

export const DEFAULT_AI_LIMIT = 200;
export const PHOTO_LIMIT_DEFAULT = 150;
export const GRADE_LIMIT_DEFAULT = 60;

const TIME_ZONE = 'America/Chicago';
const HOUR_MS = 60 * 60 * 1000;

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Chicago calendar day as 'YYYY-MM-DD'. */
function chicagoDay(ms) {
  return DAY_FORMAT.format(new Date(ms));
}

/**
 * The next Chicago midnight after `now`, in ms. Chicago's UTC offset is always
 * a whole number of hours, so midnight falls on a UTC hour boundary: step hour
 * by hour until the Chicago date changes. This follows DST changes for free.
 */
function nextChicagoMidnight(now) {
  const day = chicagoDay(now);
  let t = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
  // A Chicago day is at most 25 hours; the cap only guards against odd input.
  for (let i = 0; i < 30 && chicagoDay(t) === day; i++) t += HOUR_MS;
  return t;
}

const isCount = n => Number.isInteger(n) && n >= 0;

// Names of the day counters ("checks", "humanPass") and of the once-a-day flags ("once:email50").
const NOTE_NAME = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const ONCE_PREFIX = 'once:';
const MAX_NOTES = 50;

/**
 * The saved `notes`: a plain object of whole-number counts. Anything else (a string, an array, numbers that
 * are not counts, odd names) is ignored, so a damaged `notes` can never cost the day's spending counts.
 */
function readNotes(value) {
  const out = new Map();
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, count] of Object.entries(value)) {
    if (out.size >= MAX_NOTES) break;
    const name = key.startsWith(ONCE_PREFIX) ? key.slice(ONCE_PREFIX.length) : key;
    if (NOTE_NAME.test(name) && isCount(count)) out.set(key, count);
  }
  return out;
}

/** Saved counts, or null when the file is missing or unreadable. A corrupt file is removed. */
function loadCounts(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(text);
    if (typeof data?.day === 'string' && isCount(data.total) && isCount(data.photo)) {
      // `grade` is written only when above 0, so older files load it as 0.
      return {
        day: data.day,
        total: data.total,
        photo: data.photo,
        grade: isCount(data.grade) ? data.grade : 0,
        notes: readNotes(data.notes),
      };
    }
  } catch {
    // fall through to removal
  }
  try {
    unlinkSync(file); // start clean; a bad file would block every later write
  } catch {
    // nothing more to do
  }
  return null;
}

/**
 * The photo-upload share of a daily total: min(150, total - ceil(total / 4)),
 * at least 1 when the total is 2 or more. A quarter is kept for Séance runs.
 * @param {number} cap the daily total
 * @param {number} [photoLimit] override for the 150 ceiling
 */
export function photoShare(cap, photoLimit) {
  const ceiling = Number.isInteger(photoLimit) && photoLimit > 0 ? photoLimit : PHOTO_LIMIT_DEFAULT;
  const reserved = cap - Math.ceil(cap / 4);
  const share = Math.min(ceiling, reserved);
  return cap >= 2 ? Math.max(1, share) : Math.max(0, share);
}

/**
 * @param {{ clock: { now(): number }, limit?: number, photoLimit?: number, file?: string }} opts
 */
export function createAiBudget({
  clock, limit, photoLimit, gradeLimit, file,
  // Where a snapshot goes. Tests pass their own to count the writes.
  save = (target, snapshot) => updateJsonFile(target, () => snapshot, { fallback: {} }),
} = {}) {
  const cap = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_AI_LIMIT;
  const photoCap = photoShare(cap, photoLimit);
  // The Grader's own daily share (GRADE_AI_CALLS_PER_DAY); 0 turns Grader AI calls off.
  const gradeCap = Number.isInteger(gradeLimit) && gradeLimit >= 0 ? gradeLimit : GRADE_LIMIT_DEFAULT;
  // Photo and Grader calls together stay out of the quarter held back for Séance runs.
  const sharedCap = cap - Math.ceil(cap / 4);
  let dayKey = '';
  let total = 0;
  let photo = 0;
  let grade = 0;
  // Today's other counters ("checks", "human", ...) and once-a-day flags ("once:..."), kept with the day.
  let notes = new Map();
  // Writes are coalesced: at most one running and one waiting. The waiting one writes the state as it is
  // when it starts, so any number of counts made meanwhile cost one more write, not one each.
  let writing = null;
  let waiting = false;

  if (typeof file === 'string' && file !== '') {
    const saved = loadCounts(file);
    if (saved) {
      dayKey = saved.day;
      total = saved.total;
      photo = saved.photo;
      grade = saved.grade;
      notes = saved.notes;
    }
  }

  function state() {
    const now = clock.now();
    const key = chicagoDay(now);
    if (key !== dayKey) {
      dayKey = key;
      total = 0;
      photo = 0;
      grade = 0;
      notes = new Map();
    }
    const nextMidnight = nextChicagoMidnight(now);
    return {
      resetsAt: new Date(nextMidnight).toISOString(),
      retryAfterSeconds: Math.max(1, Math.ceil((nextMidnight - now) / 1000)),
    };
  }

  const remainingFor = kind => {
    if (kind === 'photo') return Math.max(0, Math.min(cap - total, photoCap - photo, sharedCap - photo - grade));
    if (kind === 'grade') return Math.max(0, Math.min(cap - total, gradeCap - grade, sharedCap - photo - grade));
    return Math.max(0, cap - total);
  };

  function result(allowed, kind) {
    const s = state();
    return { allowed, remaining: remainingFor(kind), ...s };
  }

  /** The counts as they are now. `grade` and `notes` are written only when not empty, so existing files stay byte-identical. */
  function snapshotNow() {
    const snapshot = grade > 0 ? { day: dayKey, total, photo, grade } : { day: dayKey, total, photo };
    if (notes.size > 0) snapshot.notes = Object.fromEntries(notes);
    return snapshot;
  }

  function startWrite() {
    // The state is read when the write starts, so a waiting write carries every count made while one ran.
    const snapshot = snapshotNow();
    writing = Promise.resolve()
      .then(() => save(file, snapshot))
      .then(() => undefined, err => {
        process.stderr.write(`[ai-budget] save failed: ${err?.name ?? 'Error'}\n`);
      })
      .then(() => {
        writing = null;
        if (waiting) {
          waiting = false;
          startWrite();
        }
      });
  }

  /**
   * Writes the current counts: at most one write running and one waiting, however many counts are made,
   * so a flood of refused requests cannot build a queue. A failure logs the error name only.
   */
  function persist() {
    if (typeof file !== 'string' || file === '') return;
    if (writing) {
      waiting = true;
      return;
    }
    startWrite();
  }

  return {
    limit: cap,
    photoLimit: photoCap,
    gradeLimit: gradeCap,
    /**
     * Counts one call if the cap allows it. Denied calls are not counted.
     * kind 'photo' is also held to the photo share; kind 'grade' to its own
     * share; both together stay below the quarter kept for Séance runs. The
     * default 'seance' is held only to the total.
     * @param {{ kind?: 'photo' | 'seance' | 'grade' }} [opts]
     */
    consume({ kind = 'seance' } = {}) {
      state();
      const blocked = total >= cap
        || (kind === 'photo' && photo >= photoCap)
        || (kind === 'grade' && grade >= gradeCap)
        || ((kind === 'photo' || kind === 'grade') && photo + grade >= sharedCap);
      if (blocked) return result(false, kind);
      total += 1;
      if (kind === 'photo') photo += 1;
      if (kind === 'grade') grade += 1;
      persist();
      return result(true, kind);
    },
    /**
     * Gives back one call that was counted but never served (the provider was rate limited or
     * overloaded). Never goes below zero.
     * @param {{ kind?: 'photo' | 'seance' | 'grade' }} [opts]
     */
    refund({ kind = 'seance' } = {}) {
      state();
      if (total > 0) total -= 1;
      if (kind === 'photo' && photo > 0) photo -= 1;
      if (kind === 'grade' && grade > 0) grade -= 1;
      persist();
    },
    /** Reports the current state without counting. */
    peek({ kind = 'seance' } = {}) {
      state();
      return result(remainingFor(kind) > 0, kind);
    },
    /**
     * Today's use of one share: `used` calls counted, `left` calls still allowed (held down by the shared
     * caps, so used + left can be less than the setting) and the `limit` of that share.
     * @param {{ kind?: 'photo' | 'seance' | 'grade' }} [opts]
     */
    usage({ kind = 'grade' } = {}) {
      state();
      const used = kind === 'photo' ? photo : kind === 'grade' ? grade : total;
      const limit = kind === 'photo' ? photoCap : kind === 'grade' ? gradeCap : cap;
      return { used, left: remainingFor(kind), limit };
    },
    /** Adds one to today's count for `name` ("checks", "human", ...) and returns it. A bad name counts nothing. */
    note(name) {
      if (typeof name !== 'string' || !NOTE_NAME.test(name)) return 0;
      state();
      if (!notes.has(name) && notes.size >= MAX_NOTES) return 0;
      const next = (notes.get(name) ?? 0) + 1;
      notes.set(name, next);
      persist();
      return next;
    },
    /** Today's counts by name (the once-a-day flags are not included). */
    notes() {
      state();
      const out = {};
      for (const [key, count] of notes) if (!key.startsWith(ONCE_PREFIX)) out[key] = count;
      return out;
    },
    /** True the first time it is called with `name` on a Chicago day, false after that (also after a restart). */
    once(name) {
      if (typeof name !== 'string' || !NOTE_NAME.test(name)) return false;
      state();
      const key = `${ONCE_PREFIX}${name}`;
      if (notes.has(key)) return false;
      if (notes.size >= MAX_NOTES) return false;
      notes.set(key, 1);
      persist();
      return true;
    },
    /** Resolves when the write running and the one waiting (if any) have finished. */
    async flush() {
      while (writing) await writing;
    },
  };
}
