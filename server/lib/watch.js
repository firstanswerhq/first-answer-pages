/**
 * watch.js: the monthly watch's pure logic (addon-monthly-watch). No I/O, no clock of its own, no logging.
 *
 *  - newWatch: a new watch record, with its first reading (the report's own answer).
 *  - dueWatches: the active watches whose next reading is due, oldest first.
 *  - addReading: a watch with one more reading (12 kept), and its next due date.
 *  - confirmedChange: whether a reading that differs from the one before is confirmed by a second ask.
 *  - maskEmail: an address shown with its middle hidden ("a…@e….com").
 *  - cleanNames: up to 5 business names from an answer, as plain short text.
 *
 * A watch never stores answer text, the question, or an IP: only named yes/no, position, total and up to 5 names.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The shortest gap between two readings (requirement 5). */
export const WATCH_INTERVAL_DAYS = 30;
/** How many readings a watch keeps (requirement 10). */
export const MAX_READINGS = 12;
/** Up to this many other businesses per reading (requirement 14). */
export const MAX_NAMES = 5;
/** Each name at most this many code points (requirement 14). */
export const NAME_MAX = 80;
/** Where a reading came from. */
export const SOURCES = Object.freeze(['report', 'ask', 'reused', 'none']);

/** Days between readings: 30, or GRADE_AI_REPEAT_DAYS when that is more than 30 (requirement 5). */
export function intervalDays(repeatDays) {
  return Number.isInteger(repeatDays) && repeatDays > WATCH_INTERVAL_DAYS ? repeatDays : WATCH_INTERVAL_DAYS;
}

const toMs = t => (t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : Number(t));
const iso = t => new Date(toMs(t)).toISOString();

/**
 * Up to 5 business names, as plain short text: control characters and direction marks removed, spaces collapsed, at
 * most 80 code points each, empty ones dropped, the same name (any case) once. Anything that isn't a string is
 * dropped. The names are untrusted (they come from an AI answer): pages escape them and never link them.
 * @param {unknown} list
 * @returns {string[]}
 */
export function cleanNames(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const plain = raw
      .replace(/[\p{Cc}\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim();
    const name = Array.from(plain).slice(0, NAME_MAX).join('').trim();
    if (name === '') continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length === MAX_NAMES) break;
  }
  return out;
}

/**
 * One reading, as stored: when, named or not, the business's place in the list (or null), how many were listed, up to
 * 5 other names, and where it came from. Never the answer text.
 */
export function makeReading({ at, named, position = null, total = 0, competitors = [], source = 'ask' }) {
  return {
    at: iso(at),
    named: named === true,
    position: Number.isInteger(position) && position >= 1 ? position : null,
    total: Number.isInteger(total) && total >= 0 ? total : 0,
    competitors: cleanNames(competitors),
    source: SOURCES.includes(source) ? source : 'ask',
  };
}

/**
 * A new watch record. With an email the watch waits for the owner to confirm (`pending`); without one it starts at once
 * (`active`). The first reading is the report's own answer, so no AI is asked (requirement 5).
 * @param {{ id: string, gradeId: string, input: object, email?: string | null, confirmToken: string, stopToken: string,
 *   now: number | string | Date, first: object, repeatDays?: number }} opts
 */
export function newWatch({ id, gradeId, input, email = null, confirmToken, stopToken, now, first, repeatDays = 0 }) {
  const i = input && typeof input === 'object' ? input : {};
  const kept = { name: i.name, city: i.city, state: i.state, service: i.service, website: i.website ?? null };
  if (typeof i.about === 'string' && i.about !== '') kept.about = i.about;
  if (i.noStorefront === true) kept.noStorefront = true;
  const address = typeof email === 'string' && email.trim() !== '' ? email.trim() : null;
  const at = toMs(now);
  return {
    id,
    gradeId,
    input: kept,
    email: address,
    status: address ? 'pending' : 'active',
    confirmToken,
    stopToken,
    createdAt: iso(at),
    confirmedAt: null,
    nextDueAt: iso(at + intervalDays(repeatDays) * DAY_MS),
    retries: 0,
    lastCheckedAt: iso(at),
    lastChangeAt: null,
    sendFailures: 0,
    readings: [makeReading({ ...first, at, source: 'report' })],
  };
}

/** The active watches due at `now`, the one due longest ago first. Pending and paused watches are never due. */
export function dueWatches(watches, now) {
  const at = toMs(now);
  return (Array.isArray(watches) ? watches : [])
    .filter(w => w && w.status === 'active' && Number.isFinite(Date.parse(w.nextDueAt)) && Date.parse(w.nextDueAt) <= at)
    .sort((a, b) => Date.parse(a.nextDueAt) - Date.parse(b.nextDueAt));
}

/**
 * The watch with one more reading: the newest 12 kept, checked now, the next reading due in 30 days (or
 * GRADE_AI_REPEAT_DAYS when longer), retries back to 0. `changed` marks a confirmed change. Returns a new object.
 */
export function addReading(watch, reading, { now, repeatDays = 0, changed = false } = {}) {
  const at = toMs(now ?? reading?.at);
  const next = makeReading({ ...reading, at: reading?.at ?? at });
  const readings = [...(Array.isArray(watch?.readings) ? watch.readings : []), next].slice(-MAX_READINGS);
  return {
    ...watch,
    readings,
    lastCheckedAt: iso(at),
    nextDueAt: iso(at + intervalDays(repeatDays) * DAY_MS),
    retries: 0,
    lastChangeAt: changed ? iso(at) : (watch?.lastChangeAt ?? null),
  };
}

/** The last reading that really asked something (not "We couldn't check this month"), or null. */
export function lastReading(watch) {
  const list = Array.isArray(watch?.readings) ? watch.readings : [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] && list[i].source !== 'none') return list[i];
  return null;
}

/**
 * Whether a reading is a confirmed change from the one before (requirement 8). `first` is this month's answer and
 * `second` the one asked again the same day. Returns 'stopped' (AI stopped naming the business), 'started' (AI started
 * naming it) or null (no change, or the two answers did not agree, so nothing is sent).
 * @param {{ named: boolean } | null} previous
 * @param {{ named: boolean } | null} first
 * @param {{ named: boolean } | null} [second]
 * @returns {'stopped' | 'started' | null}
 */
export function confirmedChange(previous, first, second) {
  if (!previous || !first || typeof previous.named !== 'boolean' || typeof first.named !== 'boolean') return null;
  if (previous.named === first.named) return null;
  if (!second || typeof second.named !== 'boolean' || second.named !== first.named) return null;
  return first.named ? 'started' : 'stopped';
}

/**
 * An email address with its middle hidden, for the owner's own watch page: "alex@example.com" gives "a…@e….com".
 * Anything that doesn't look like an address gives ''.
 * @param {unknown} email
 * @returns {string}
 */
export function maskEmail(email) {
  if (typeof email !== 'string') return '';
  const m = /^([^\s@]+)@([^\s@]+)$/.exec(email.trim());
  if (!m) return '';
  const local = Array.from(m[1]);
  const domain = m[2];
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}\u2026@${Array.from(host)[0]}\u2026${tld}`;
}
