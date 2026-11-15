/**
 * founders.js — the Founding Member program
 *
 * The first `cap` approved listings whose owners signed up before `deadline`
 * become Founding Members. Each gets a permanent number (1..cap). A number is
 * never reused or handed to another listing, even if a listing is unpublished.
 * Sample (demo) listings are never founders.
 */

export const DEFAULT_FOUNDERS_CAP = 500;
/** End of January 31, 2027 in Nashville (Central Standard Time, UTC-6). */
export const DEFAULT_FOUNDERS_DEADLINE = '2027-02-01T06:00:00.000Z';

/**
 * @param {unknown} value FOUNDERS_CAP
 * @returns {number} a whole number from 0 (program off) to 100000
 */
export function parseFoundersCap(value) {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_FOUNDERS_CAP;
  const text = value.trim();
  if (!/^\d{1,6}$/.test(text)) return DEFAULT_FOUNDERS_CAP;
  return Math.min(Number(text), 100000);
}

/**
 * @param {unknown} value FOUNDERS_DEADLINE, an ISO date-time
 * @returns {string} ISO date-time; the default when missing or unreadable
 */
export function parseFoundersDeadline(value) {
  if (typeof value !== 'string' || value.trim() === '') return DEFAULT_FOUNDERS_DEADLINE;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? new Date(ms).toISOString() : DEFAULT_FOUNDERS_DEADLINE;
}

/** Entries that carry a real founder number. */
function entries(map) {
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.values(map).filter(e => e && Number.isInteger(e.number) && e.number > 0);
}

/** How many founder numbers have been handed out. */
export function foundersCount(map) {
  return entries(map).length;
}

/** The next free number: one past the highest ever handed out. */
export function nextFounderNumber(map) {
  return entries(map).reduce((max, e) => Math.max(max, e.number), 0) + 1;
}

/**
 * Whether a sign-up at `signedUpAt` earns a founder number.
 * @param {{ cap: number, deadline: string }} program
 * @param {object} map founders.json contents
 * @param {Date|string|number} signedUpAt when the owner sent the listing in
 */
export function earnsFounderSpot(program, map, signedUpAt) {
  if (!program || !Number.isInteger(program.cap) || program.cap <= 0) return false;
  const at = new Date(signedUpAt).getTime();
  const end = Date.parse(program.deadline);
  if (!Number.isFinite(at) || !Number.isFinite(end) || at >= end) return false;
  return nextFounderNumber(map) <= program.cap;
}

/**
 * Public summary for pages.
 * @returns {{ cap: number, taken: number, left: number, open: boolean, deadline: string }}
 */
export function foundersStatus(program, map, now) {
  const cap = program && Number.isInteger(program.cap) ? Math.max(program.cap, 0) : 0;
  const deadline = program?.deadline ?? DEFAULT_FOUNDERS_DEADLINE;
  const taken = foundersCount(map);
  const left = Math.max(cap - (nextFounderNumber(map) - 1), 0);
  const open = cap > 0 && left > 0 && new Date(now).getTime() < Date.parse(deadline);
  return { cap, taken, left, open, deadline };
}

/** "January 31, 2027": the last day to sign up, in Nashville time. */
export function formatFoundersDeadline(deadline) {
  const end = Date.parse(deadline);
  if (!Number.isFinite(end)) return '';
  // The deadline is the instant the day ends, so step back one second to name that day.
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date(end - 1000));
}
