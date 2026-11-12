// Retention rules for quotes.json and drafts.json. Pure functions: they take a
// list and a time in ms and return a new list (never mutate the input).

export const QUOTE_RETENTION_DAYS = 180;
export const DRAFT_EXPIRY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Age in ms of an ISO createdAt, or undefined when missing/invalid. */
function ageMs(createdAt, nowMs) {
  if (typeof createdAt !== 'string') return undefined;
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? undefined : nowMs - t;
}

/**
 * Keep quotes younger than 180 days. Invalid or missing createdAt is kept.
 * @param {object[]} list
 * @param {number} nowMs
 * @returns {object[]}
 */
export function pruneQuotes(list, nowMs) {
  if (!Array.isArray(list)) return list;
  return list.filter(q => {
    const age = ageMs(q?.createdAt, nowMs);
    return age === undefined || age < QUOTE_RETENTION_DAYS * DAY_MS;
  });
}

/**
 * Remove drafts older than 30 days, only when status is 'draft' or 'rejected'.
 * A draft with a matching pending entry is never expired.
 * @param {object[]} list
 * @param {number} nowMs
 * @param {object[]} [pending] pending.json entries (optional)
 * @returns {object[]}
 */
export function pruneDrafts(list, nowMs, pending = []) {
  if (!Array.isArray(list)) return list;
  const pendingIds = new Set();
  if (Array.isArray(pending)) {
    for (const e of pending) {
      if (!e || e.status !== 'pending') continue;
      if (e.draftId !== undefined) pendingIds.add(e.draftId);
      if (e.id !== undefined) pendingIds.add(e.id);
    }
  }
  return list.filter(d => {
    if (!d || (d.status !== 'draft' && d.status !== 'rejected')) return true;
    if (pendingIds.has(d.id)) return true;
    const age = ageMs(d.createdAt, nowMs);
    return age === undefined || age < DRAFT_EXPIRY_DAYS * DAY_MS;
  });
}

export const GRADE_RETENTION_DAYS = 90;

/**
 * Keep grades (and leads) younger than 90 days. A missing or invalid
 * createdAt is kept, the same rule as quotes.
 * @param {object[]} list
 * @param {number} nowMs
 * @returns {object[]}
 */
export function pruneGrades(list, nowMs) {
  if (!Array.isArray(list)) return list;
  return list.filter(g => {
    const age = ageMs(g?.createdAt, nowMs);
    return age === undefined || age < GRADE_RETENTION_DAYS * DAY_MS;
  });
}

export const pruneLeads = pruneGrades;
