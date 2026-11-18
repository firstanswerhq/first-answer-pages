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
 * The newest copyright year on the page ("© 2019-2026" counts as 2026), or null.
 * Years more than one year ahead of `nowYear` are ignored as typos.
 */
export function copyrightYear(text, nowYear) {
  const s = String(text ?? '').slice(0, MAX_TEXT);
  const re = /(?:©|\(c\)|\bcopyright\b)\s*(?:©\s*)?(?:(?:19|20)\d{2}\s*(?:-|–|—|to)\s*)?((?:19|20)\d{2})\b/gi;
  let best = null;
  let m;
  while ((m = re.exec(s)) !== null) {
    const y = Number(m[1]);
    if (y > nowYear + 1) continue;
    if (best === null || y > best) best = y;
  }
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
  if (recent(headerMs)) return { result: 'pass', detail: `Your web server says the home page changed on ${dayText(headerMs)}.` };
  return {
    result: 'not_checked',
    detail: 'We found no date on your home page. Showing the current year in your footer tells people the site is kept up.',
  };
}
