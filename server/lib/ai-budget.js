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
      return { day: data.day, total: data.total, photo: data.photo, grade: isCount(data.grade) ? data.grade : 0 };
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
export function createAiBudget({ clock, limit, photoLimit, gradeLimit, file } = {}) {
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
  let pending = Promise.resolve();

  if (typeof file === 'string' && file !== '') {
    const saved = loadCounts(file);
    if (saved) {
      dayKey = saved.day;
      total = saved.total;
      photo = saved.photo;
      grade = saved.grade;
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

  /** Writes the current counts. Writes are queued; a failure logs the error name only. */
  function persist() {
    if (typeof file !== 'string' || file === '') return;
    // `grade` is written only when above 0, so existing files stay byte-identical.
    const snapshot = grade > 0 ? { day: dayKey, total, photo, grade } : { day: dayKey, total, photo };
    pending = pending
      .then(() => updateJsonFile(file, () => snapshot, { fallback: {} }))
      .then(() => undefined, err => {
        process.stderr.write(`[ai-budget] save failed: ${err?.name ?? 'Error'}\n`);
      });
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
    /** Reports the current state without counting. */
    peek({ kind = 'seance' } = {}) {
      state();
      return result(remainingFor(kind) > 0, kind);
    },
    /** Resolves when every queued write has finished. */
    flush: () => pending,
  };
}
