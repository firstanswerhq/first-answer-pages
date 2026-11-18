/**
 * grade-freshness.js — signs that a website was updated lately.
 *
 * Reads a copyright year and "updated" dates from the visible page text, the
 * newest dateModified in the page's structured data, and the Last-Modified
 * header. Nothing here fetches anything; page text is only read. "Now" always
 * comes from the caller (the app's clock), so results are repeatable.
 */

const MAX_TEXT = 200000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A date within this many days counts as recent. */
export const RECENT_DAYS = 365;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 2, 2026" (UTC day). */
export function dayText(ms) {
  const d = new Date(ms);
  return `${SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * The newest copyright year on the page, or null. Handles "\u00a9 2019-2026",
 * "\u00a9 2019-26", "\u00a9 2015, 2026" and "\u00a9 2010 - Present" (this year).
 * Years more than one year ahead of `nowYear` are ignored as typos.
 */
export function copyrightYear(text, nowYear) {
  const s = String(text ?? '').slice(0, MAX_TEXT);
  const YEAR = '(?:19|20)\\d{2}';
  const JOIN = '\\s*(?:,|&|\\band\\b|-|\u2013|\u2014|\\bto\\b)\\s*';
  const TAIL = `(?:${YEAR}|\\d{2}\\b|present\\b|today\\b|now\\b|current\\b)`;
  const re = new RegExp(`(?:\u00a9|\\(c\\)|\\bcopyright\\b)\\s*(?:\u00a9\\s*)?(${YEAR}\\b(?:${JOIN}${TAIL}){0,5})`, 'gi');
  let best = null;
  // Years that may be a picture credit. They can never cause a fail, but a
  // recent one still counts ("\u00a9 2026 Acme Maps & Surveying" is current).
  let creditBest = null;
  let m;
  while ((m = re.exec(s)) !== null) {
    // "\u00a9 2014 Photo: Jane Doe" is a picture credit, not the site's own year.
    // Only the words up to the next separator count, so "\u00a9 2026 Acme | Photos by\u2026" is the site's year.
    const credit = /\b(?:photos?|photograph(?:y|s)?|images?|maps?|illustrations?)\b/i;
    const end = m.index + m[0].length;
    const isCredit = credit.test(s.slice(end, end + 20).split(/[.!?|\n]/)[0])
      || credit.test(s.slice(Math.max(0, m.index - 20), m.index).split(/[.!?|\n]/).pop());
    const years = [];
    let last = null;
    for (const part of m[1].split(new RegExp(JOIN, 'i')).map(p => p.trim().toLowerCase()).filter(Boolean)) {
      let y = null;
      if (/^(?:19|20)\d{2}$/.test(part)) y = Number(part);
      else if (/^\d{2}$/.test(part) && last !== null) {
        // "2019-26": the end year shares the century of the start year.
        y = Math.floor(last / 100) * 100 + Number(part);
        if (y < last) y = null;
      } else if (['present', 'today', 'now', 'current'].includes(part)) y = nowYear;
      if (y === null) continue;
      last = y;
      if (y <= nowYear + 1) years.push(y);
    }
    for (const y of years) {
      if (isCredit) { if (creditBest === null || y > creditBest) creditBest = y; }
      else if (best === null || y > best) best = y;
    }
  }
  if (creditBest !== null && creditBest >= nowYear - 1 && (best === null || creditBest > best)) return creditBest;
  return best;
}

const MONTH_WORD = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';

/** Dates written next to "updated" ("Last updated: March 3, 2026", "Updated 2026-03-03", "Updated 3/3/2026"). */
export function updatedDates(text) {
  const s = String(text ?? '').slice(0, MAX_TEXT);
  const re = new RegExp(
    `\\bupdated\\b(?:\\s+on)?\\s*:?\\s*(?:${MONTH_WORD}\\s+(\\d{1,2}),?\\s+(\\d{4})|(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})/(\\d{1,2})/(\\d{4}))`,
    'gi',
  );
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null && out.length < 20) {
    let y; let mo; let d;
    if (m[1]) { y = +m[3]; mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); d = +m[2]; } else if (m[4]) { y = +m[4]; mo = +m[5] - 1; d = +m[6]; } else { y = +m[9]; mo = +m[7] - 1; d = +m[8]; }
    const ms = Date.UTC(y, mo, d);
    const back = new Date(ms);
    if (mo >= 0 && mo <= 11 && back.getUTCDate() === d && back.getUTCMonth() === mo) out.push(ms);
  }
  return out;
}

/**
 * @param {{ text?: string, scriptBuilt?: boolean, jsonLd?: { dateModified?: string } }} facts
 * @param {{ now: number, lastModified?: string }} opts
 * @returns {{ result: 'pass'|'fail'|'not_checked', detail: string }}
 */
export function judgeFreshness(facts, { now, lastModified } = {}) {
  const nowMs = Number(now);
  const year = new Date(nowMs).getUTCFullYear();
  const recent = ms => Number.isFinite(ms) && ms <= nowMs + DAY_MS && nowMs - ms <= RECENT_DAYS * DAY_MS;
  // Words built by scripts can't be read, so the page text is skipped then.
  const text = facts?.scriptBuilt ? '' : facts?.text ?? '';

  const copyright = copyrightYear(text, year);
  const updated = updatedDates(text).filter(ms => ms <= nowMs + DAY_MS).sort((a, b) => b - a)[0];
  const modifiedMs = Date.parse(facts?.jsonLd?.dateModified ?? '');
  const headerMs = Date.parse(lastModified ?? '');

  if (copyright !== null && copyright >= year - 1) {
    return { result: 'pass', detail: `Your website shows © ${copyright}, so it looks kept up.` };
  }
  if (recent(updated)) return { result: 'pass', detail: `Your website says it was updated on ${dayText(updated)}.` };
  if (recent(modifiedMs)) return { result: 'pass', detail: `Your business label says it was updated on ${dayText(modifiedMs)}.` };
  if (copyright !== null) {
    return { result: 'fail', detail: `Your website shows © ${copyright}. That can make it look out of date to customers and AI.` };
  }
  // A server date alone never outweighs an old year people can see, so it is checked last.
  if (recent(headerMs)) return { result: 'pass', detail: `Your website's settings say the home page changed on ${dayText(headerMs)}.` };
  if (facts?.scriptBuilt) {
    return { result: 'not_checked', detail: "Your page loads its words in a way this check can't read yet." };
  }
  // An old date was found: say so, never "no date". Still only a note, not a fail.
  const newest = [updated, modifiedMs, headerMs].filter(ms => Number.isFinite(ms) && ms <= nowMs + DAY_MS).sort((a, b) => b - a)[0];
  if (newest !== undefined) {
    return {
      result: 'not_checked',
      detail: `The newest date we found for your home page is ${dayText(newest)}. Showing the current year in your footer tells people the site is kept up.`,
    };
  }
  return {
    result: 'not_checked',
    detail: 'We found no date on your home page. Showing the current year in your footer tells people the site is kept up.',
  };
}
