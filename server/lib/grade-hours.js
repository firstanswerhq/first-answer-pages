/**
 * grade-hours.js — reads business hours from the places the Grader can see
 * and says whether they agree.
 *
 * Every parser here is cautious: anything it cannot read for sure is left
 * out, and a source that says two different things for the same day is
 * dropped. The hours-match Check only fails when two sources clearly give
 * different hours for the same day. Page text is untrusted: it is only read.
 */

import { normalizeForMatch } from './seance.js';

export const DAY_LABELS = Object.freeze(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
const LISTING_DAYS = Object.freeze(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);

const MAX_TEXT = 200000; // page text we scan for hours
const MAX_SEGMENTS = 100;

/** Day word -> 0 (Monday) .. 6 (Sunday). Two-letter forms are for structured data only. */
function dayIndex(word, { short = false } = {}) {
  const w = String(word).toLowerCase().replace(/\.$/, '');
  const table = {
    mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, wednesday: 2,
    thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6,
  };
  if (Object.hasOwn(table, w)) return table[w];
  if (short) {
    const two = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
    if (Object.hasOwn(two, w)) return two[w];
  }
  return -1;
}

/** Days from `a` to `b`, wrapping past Sunday ("Fri-Mon"). */
function dayRange(a, b) {
  const out = [];
  for (let i = a; ; i = (i + 1) % 7) {
    out.push(i);
    if (i === b || out.length >= 7) break;
  }
  return out;
}

// ---- times ------------------------------------------------------------------

const MERIDIEM = '(a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)';
const CLOCK = `(?:(\\d{1,2})(?::(\\d{2}))?\\s?${MERIDIEM}?|noon|midnight)`;

/** One time to minutes after midnight, with whether it carried am/pm (or was 24-hour "HH:MM"). */
function readTime(text) {
  const t = String(text).trim().toLowerCase();
  if (t === 'noon') return { minutes: 720, sure: true };
  if (t === 'midnight') return { minutes: 0, sure: true };
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s?(a\.?\s?m\.?|p\.?\s?m\.?)?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3][0] === 'p';
    return { minutes: (h % 12 + (pm ? 12 : 0)) * 60 + min, sure: true };
  }
  // No am/pm: only a 24-hour "HH:MM" is clear enough to use.
  if (m[2] === undefined || h > 24 || (h === 24 && min !== 0)) return null;
  return { minutes: h * 60 + min, sure: true };
}

/** Normalized key for one open-close range, or null. Closing at midnight reads as end of day. */
function rangeKey(opens, closes) {
  const o = readTime(opens);
  const c = readTime(closes);
  if (!o || !c) return null;
  let close = c.minutes;
  if (close === 0 || close === 1439) close = 1440;
  if (o.minutes === close) return null; // "9am-9am" says nothing
  return `${o.minutes}-${close}`;
}

const sortKeys = keys => [...new Set(keys)].sort((x, y) => Number(x.split('-')[0]) - Number(y.split('-')[0])).join(',');

const RANGE_SPLIT = /\s*(?:-|\u2013|\u2014|\bto\b|\buntil\b|\btill\b)\s*/i;

/** "8am - 5pm" -> "480-1020"; "8am-12pm, 1pm-5pm" -> "480-720,780-1020"; "closed" -> "closed". */
export function readDayValue(text) {
  const t = String(text ?? '').trim().toLowerCase();
  if (t === '') return null;
  if (/^closed\.?$/.test(t)) return 'closed';
  const parts = t.split(/\s*(?:,|&|\band\b)\s*/).filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;
  const keys = [];
  for (const part of parts) {
    const ends = part.split(RANGE_SPLIT).filter(Boolean);
    if (ends.length !== 2) return null;
    const key = rangeKey(ends[0], ends[1]);
    if (!key) return null;
    keys.push(key);
  }
  return sortKeys(keys);
}

// ---- sources -------------------------------------------------------------------

/**
 * Adds day -> value pairs to a map. A day given two different values makes the
 * whole source unsure (returns false).
 */
function put(map, days, value) {
  for (const d of days) {
    if (map.has(d) && map.get(d) !== value) return false;
    map.set(d, value);
  }
  return true;
}

const DAYW = '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\b\\.?';
const DAY_JOIN = '\\s*(?:-|\u2013|\u2014|to|through|thru)\\s*';
const DAY_LIST = `${DAYW}(?:${DAY_JOIN}${DAYW})?(?:\\s*(?:,|&|and|/)\\s*${DAYW}(?:${DAY_JOIN}${DAYW})?){0,6}`;
const TIME_RANGE = `${CLOCK}\\s*(?:-|\u2013|\u2014|to|until|till)\\s*${CLOCK}`;
const SEGMENT = new RegExp(
  `\\b(${DAY_LIST})\\s*[:,]?\\s*(?:from\\s+)?(closed\\b|${TIME_RANGE}(?:\\s*(?:,|&|and)\\s*${TIME_RANGE}){0,2})`,
  'gi',
);

/** The days named in "Mon-Fri", "Sat & Sun", "Monday through Wednesday, Friday". */
function daysOf(spec, short = false) {
  const days = [];
  const pieces = spec.split(/\s*(?:,|&|\band\b|\/)\s*/).filter(Boolean);
  for (const piece of pieces) {
    const ends = piece.split(/\s*(?:-|\u2013|\u2014|\bto\b|\bthrough\b|\bthru\b)\s*/i).filter(Boolean);
    if (ends.length === 1) {
      const d = dayIndex(ends[0], { short });
      if (d < 0) return [];
      days.push(d);
    } else if (ends.length === 2) {
      const a = dayIndex(ends[0], { short });
      const b = dayIndex(ends[1], { short });
      if (a < 0 || b < 0) return [];
      days.push(...dayRange(a, b));
    } else return [];
  }
  return [...new Set(days)];
}

/**
 * Hours written on the page, such as "Mon-Fri 8am-5pm, Sat 9am-1pm, Sun closed".
 * @param {string} text visible page text
 * @returns {Map<number, string>|null} null when nothing clear was found or the page disagrees with itself
 */
export function hoursFromText(text) {
  const s = String(text ?? '').slice(0, MAX_TEXT);
  const map = new Map();
  SEGMENT.lastIndex = 0;
  let m;
  let n = 0;
  while ((m = SEGMENT.exec(s)) !== null && n < MAX_SEGMENTS) {
    n += 1;
    const days = daysOf(m[1]);
    const value = readDayValue(m[2]);
    if (days.length === 0 || value === null) continue;
    if (!put(map, days, value)) return null;
  }
  return map.size > 0 ? map : null;
}

/**
 * Hours from the business label (JSON-LD): openingHours strings such as
 * "Mo-Fr 08:00-17:00" and openingHoursSpecification rows.
 * @param {{ text?: string[], spec?: { days: string[], opens: string, closes: string }[] }|undefined} parts
 * @returns {Map<number, string>|null}
 */
export function hoursFromStructured(parts) {
  if (!parts) return null;
  const map = new Map();
  for (const line of Array.isArray(parts.text) ? parts.text : []) {
    // One string can hold several rules: "Mo-Fr 08:00-17:00, Sa 09:00-12:00"
    const s = String(line).slice(0, 500);
    const rule = /([a-z]{2,9}(?:\s*[-,]\s*[a-z]{2,9})*)\s+(\d[\d:\-\u2013, ]*\d)/gi;
    let m;
    let used = '';
    while ((m = rule.exec(s)) !== null) {
      used += m[0];
      const days = daysOf(m[1], true);
      const value = readDayValue(m[2]);
      if (days.length === 0 || value === null) return null;
      if (!put(map, days, value)) return null;
    }
    // Anything we could not read in the line makes the whole label unsure.
    let rest = s;
    rule.lastIndex = 0;
    rest = rest.replace(rule, '');
    if (/[^\s,;]/.test(rest) || used === '') return null;
  }
  const byDay = new Map();
  for (const row of Array.isArray(parts.spec) ? parts.spec : []) {
    const days = row.days.map(d => dayIndex(d)).filter(d => d >= 0);
    if (days.length !== row.days.length) return null;
    // opens = closes = 00:00 is how schema.org says "closed all day".
    const o = readTime(row.opens);
    const c = readTime(row.closes);
    if (!o || !c) return null;
    const key = o.minutes === 0 && c.minutes === 0 ? 'closed' : rangeKey(row.opens, row.closes);
    if (!key) return null;
    // Several rows for one day are split hours (a lunch break).
    for (const d of days) byDay.set(d, [...(byDay.get(d) ?? []), key]);
  }
  for (const [d, keys] of byDay) {
    const value = keys.includes('closed') ? (keys.length === 1 ? 'closed' : null) : sortKeys(keys);
    if (value === null || !put(map, [d], value)) return null;
  }
  return map.size > 0 ? map : null;
}

/** Hours on a First Answer listing ({ monday: '7am-5pm', sunday: 'Closed', ... }). */
export function hoursFromListing(hours) {
  if (hours === null || typeof hours !== 'object') return null;
  const map = new Map();
  LISTING_DAYS.forEach((day, i) => {
    const value = readDayValue(hours[day]);
    if (value !== null) map.set(i, value);
  });
  return map.size > 0 ? map : null;
}

// ---- matching a listing ------------------------------------------------------------

const digits10 = phone => {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return d.length === 10 ? d : '';
};

/**
 * The one public listing that is clearly this business: same 10-digit phone
 * as the website, same city and same state. Anything less clear returns null.
 * @param {object[]} listings
 * @param {{ phones: string[], city: string, state: string }} who
 * @returns {object|null}
 */
export function findListingFor(listings, { phones, city, state }) {
  const wanted = new Set((Array.isArray(phones) ? phones : []).map(digits10).filter(Boolean));
  if (wanted.size === 0 || !Array.isArray(listings)) return null;
  const c = normalizeForMatch(city ?? '');
  const st = String(state ?? '').trim().toUpperCase();
  if (c === '' || st === '') return null;
  const hits = listings.filter(l => l && wanted.has(digits10(l.phone))
    && normalizeForMatch(l.city ?? '') === c && String(l.state ?? '').trim().toUpperCase() === st);
  return hits.length === 1 ? hits[0] : null;
}

// ---- comparing ---------------------------------------------------------------------

function minutesText(m) {
  const mm = ((m % 1440) + 1440) % 1440;
  if (mm === 0) return 'midnight';
  if (mm === 720) return 'noon';
  const h = Math.floor(mm / 60);
  const min = mm % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "480-1020" -> "8 AM to 5 PM"; "closed" -> "closed". */
export function valueText(value) {
  if (value === 'closed') return 'closed';
  return value.split(',').map(r => {
    const [o, c] = r.split('-').map(Number);
    return `${minutesText(o)} to ${minutesText(c)}`;
  }).join(' and ');
}

const single = v => v === 'closed' || !v.includes(',');

/**
 * Compares named sources. Only a day that both sources state plainly can
 * disagree; split hours on one side and plain hours on the other are skipped.
 * @param {{ label: string, hours: Map<number, string> }[]} sources
 * @returns {{ compared: number, mismatch: null|{ day: number, a: object, b: object, av: string, bv: string } }}
 */
export function compareHours(sources) {
  let compared = 0;
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const a = sources[i];
      const b = sources[j];
      for (let d = 0; d < 7; d += 1) {
        if (!a.hours.has(d) || !b.hours.has(d)) continue;
        const av = a.hours.get(d);
        const bv = b.hours.get(d);
        if (av === bv) { compared += 1; continue; }
        if (!single(av) || !single(bv)) continue; // unsure: lunch breaks and such
        return { compared: compared + 1, mismatch: { day: d, a, b, av, bv } };
      }
    }
  }
  return { compared, mismatch: null };
}
