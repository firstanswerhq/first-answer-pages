/**
 * agency-report.js: the agency-grade parts of the full report (high-tech-look Requirement 13), from data the check
 * already has. No new paid call; nothing here changes the score.
 *
 *  - shareOfVoice: every business named across the answers that came back, with how many answers named it (13.1).
 *  - sitesUsed: the sites the answers listed as their sources, and directories AI read that the website doesn't link
 *    to (13.2). Only sources in the stored data are ever shown.
 *  - evidence: the AI, model, time and live web search of one answer (13.3).
 *  - reportCsv: one row per health row and one per answer (13.4).
 *  - cleanPreparedBy: the optional "Prepared by" name, text only, 60 characters at most (13.5).
 *
 * Pure functions. Every value shown on a page goes through escapeHtml where it is written.
 */

import { normalizeForMatch } from './seance.js';
import { registeredDomain, sameSite, pageKey, SHARED_DOMAINS } from './name-match.js';

/** The answers that came back with text: the same set for share of voice, sites, and the CSV (batch 4 Y4). */
export const answersOf = grade => (Array.isArray(grade?.ai) ? grade.ai : [])
  .filter(a => a && typeof a === 'object' && !Array.isArray(a) && typeof a.answer === 'string' && a.answer.trim() !== '');

/**
 * 13.1: every business named across the answers that came back. The checked business is always a row, even at 0.
 * Names come only from what each answer already listed (`competitors`, and `named` for the business itself).
 * @returns {{ total: number, rows: Array<{ name: string, count: number, own: boolean }> }}
 */
export function shareOfVoice(grade) {
  const answers = answersOf(grade);
  const ownName = String(grade?.input?.name ?? '').trim();
  const ownKey = normalizeForMatch(ownName);
  const counts = new Map();
  counts.set('\u0000own', { name: ownName, count: 0, own: true });
  for (const a of answers) {
    const seen = new Set();
    if (a.named === true) seen.add('\u0000own');
    for (const raw of Array.isArray(a.competitors) ? a.competitors : []) {
      if (typeof raw !== 'string' || raw.trim() === '') continue;
      const key = normalizeForMatch(raw);
      if (!key) continue;
      const id = key === ownKey ? '\u0000own' : key;
      seen.add(id);
      if (!counts.has(id)) counts.set(id, { name: raw.trim(), count: 0, own: false });
    }
    for (const id of seen) counts.get(id).count += 1;
  }
  const rows = [...counts.values()].sort((x, y) => y.count - x.count || (x.own ? -1 : y.own ? 1 : x.name.localeCompare(y.name)));
  return { total: answers.length, rows };
}

/** Directories profile-links already recognizes, with the signal that says whether the website links to them. */
const DIRECTORIES = Object.freeze([
  { domain: 'yelp.com', name: 'Yelp', link: 'yelp', page: 'a Yelp page' },
  { domain: 'facebook.com', name: 'Facebook', link: 'facebook', page: 'a Facebook page' },
  { domain: 'instagram.com', name: 'Instagram', link: 'instagram', page: 'an Instagram page' },
  { domain: 'tiktok.com', name: 'TikTok', link: 'tiktok', page: 'a TikTok page' },
  // Batch 4 Y3: only a Google Business Profile or Maps page counts for this line, never any google.com page.
  { domain: 'google.com', name: 'Google', link: 'google', page: 'your Google profile', profileOnly: true },
]);

/** True for a Google Business Profile or Maps address (maps.google.com, business.google.com, google.com/maps, g.page, maps.app.goo.gl). */
export function isGoogleProfileUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (host === 'maps.google.com' || host === 'business.google.com' || host === 'g.page' || host === 'maps.app.goo.gl') return true;
  // Batch 5 Z2: only Google's own domains (google.com, google.de, google.co.uk, google.com.au), never google.evil.com.
  return GOOGLE_HOST.test(host) && /^\/maps(?:\/|$)/i.test(u.pathname);
}

const GOOGLE_HOST = /^google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

/**
 * True when a source is the business's own website (batch 4 Y1). An own domain matches by `sameSite`. On a shared host
 * (a Facebook page as the website) only the business's own page matches, never every page on that host.
 */
function ownSource(input, url) {
  const website = input?.website ?? '';
  if (!website) return false;
  if (sameSite(website, url)) return true;
  if (!SHARED_DOMAINS.has(registeredDomain(website))) return false;
  const page = pageKey(String(input?.websitePage ?? ''));
  return page !== '' && page === pageKey(url);
}

/**
 * 13.2: the sites AI used, from the `sources` stored on each answer (never anything else).
 * @returns {{ hasSources: boolean, rows: Array<{ domain: string, url: string, count: number, own: boolean }>, gaps: string[] }}
 */
export function sitesUsed(grade) {
  const all = answersOf(grade);
  // Batch 5 K3: only answers that really ran a live web search have cited sites. Sources stored on an answer that
  // answered from memory are never shown, so a site list never sits next to "without a live web search".
  const answers = all.filter(a => a.webSearch === true);
  const fromMemory = all.some(a => a.webSearch !== true && Array.isArray(a.sources) && a.sources.length > 0);
  const input = grade?.input ?? {};
  const sharedSite = SHARED_DOMAINS.has(registeredDomain(String(input.website ?? '')));
  const byKey = new Map();
  const domainAnswers = new Map(); // registered domain -> answers that cited any page there (for the gap lines)
  let googleProfileAnswers = 0;
  for (const a of answers) {
    const seen = new Set();
    const domains = new Set();
    let googleProfile = false;
    for (const s of Array.isArray(a.sources) ? a.sources : []) {
      if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) continue;
      const domain = registeredDomain(s.url);
      if (!domain) continue;
      if (isGoogleProfileUrl(s.url)) googleProfile = true;
      domains.add(domain);
      // Batch 5 Z1: on a shared host, the business's own page is its own row (keyed by the page); every other page on
      // that host stays in the plain domain row, never "(your website)".
      const ownPage = sharedSite && ownSource(input, s.url);
      const key = ownPage ? `page:${pageKey(s.url)}` : domain;
      if (!byKey.has(key)) byKey.set(key, { domain: ownPage ? pageKey(s.url) : domain, url: s.url, count: 0, own: ownPage });
      const row = byKey.get(key);
      // An own (not shared) domain: the row is the business's website (Y1).
      if (!ownPage && !sharedSite && !row.own && ownSource(input, s.url)) row.own = true;
      if (seen.has(key)) continue;
      seen.add(key);
      row.count += 1;
    }
    for (const d of domains) domainAnswers.set(d, (domainAnswers.get(d) ?? 0) + 1);
    if (googleProfile) googleProfileAnswers += 1;
  }
  const rows = [...byKey.values()].sort((x, y) => y.count - x.count || x.domain.localeCompare(y.domain));
  const links = grade?.signals?.links ?? {};
  const gaps = [];
  for (const d of DIRECTORIES) {
    // Only when we know the website doesn't link there (a checked "Not linked"), never a guess.
    if (links[d.link]?.status !== 'partly') continue;
    // Google: the answers that cited a profile or Maps page (g.page and maps.app.goo.gl have no google.com row).
    // The others: the answers that cited any page on that site, the own page included (Z1).
    const count = d.profileOnly ? googleProfileAnswers : (domainAnswers.get(d.domain) ?? 0);
    if (count === 0) continue;
    const forWhat = count === 1 ? 'for one answer' : `for ${count} answers`;
    gaps.push(`AI read ${d.name} ${forWhat}. Your website doesn't link to ${d.page}.`);
  }
  return { hasSources: rows.length > 0, rows, gaps, searchAnswers: answers.length, fromMemory };
}

/** A time as "Nov 24, 2026, 12:00 PM CT" (the owner's time zone). */
export function evidenceTime(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const text = new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
  });
  return `${text} CT`;
}

/**
 * 13.3: one answer's evidence, in plain words: who answered, the model, when, and whether it searched the web live.
 * The exact question is the heading right above it on the page, and a column of its own in the CSV.
 */
export function evidence(a, label) {
  const model = typeof a?.model === 'string' && a.model.trim() !== '' ? ` (model ${a.model.trim()})` : '';
  const when = evidenceTime(a?.at);
  return `Evidence: ${label}${model}${when ? `, asked ${when}` : ''}, ${a?.webSearch === true ? 'with a live web search' : 'without a live web search'}.`;
}

/** 13.5: the "Prepared by" name: text only, one line, 60 characters at most; '' to clear it. */
export const PREPARED_BY_MAX = 60;
export function cleanPreparedBy(value) {
  const text = String(value ?? '').replace(/\p{Cc}/gu, ' ').replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, PREPARED_BY_MAX).join('').trim();
}

/** One CSV cell: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Batch 5 K17: one header row first (nothing above it), and every row carries the report's own columns (business,
 * website, city, state, check date, score, prepared by), so an agency can stack many clients in one sheet.
 */
export const CSV_COLUMNS = Object.freeze([
  'business', 'website', 'city', 'state', 'check_date', 'score', 'prepared_by',
  'section', 'group', 'item', 'status', 'points_earned', 'points_possible', 'detail',
  'engine', 'model', 'web_search', 'question', 'named', 'answer', 'businesses_named', 'sites_cited', 'date',
]);

/**
 * 13.4 and K17: the report's data as CSV, the same facts as the page. Sections:
 *  - "check": one per scored check, with its area, status and points;
 *  - "health": one per health map row;
 *  - "answer": one per answer, with its text, the businesses it named and the sites it cited;
 *  - "named": one per business named across the answers, with how many answers named it;
 *  - "site": one per site the answers cited (live web search only), with how many answers cited it.
 * @param {{ report?: { business?: string, website?: string, city?: string, state?: string, checkDate?: string,
 *   score?: number|null }, preparedBy?: string, checks?: object[], health?: object[], answers?: object[],
 *   named?: object[], sites?: object[] }} data
 */
export function reportCsv({ report = {}, preparedBy = '', checks = [], health = [], answers = [], named = [], sites = [] }) {
  const meta = [
    report.business ?? '', report.website ?? '', report.city ?? '', report.state ?? '', report.checkDate ?? '',
    Number.isInteger(report.score) ? String(report.score) : '', cleanPreparedBy(preparedBy),
  ];
  const row = rest => [...meta, ...rest].map(csvCell).join(',');
  const blank = n => Array.from({ length: n }, () => '');
  const lines = [CSV_COLUMNS.join(',')];
  for (const c of checks) {
    lines.push(row(['check', c.group, c.item, c.status, String(c.earned ?? ''), String(c.points ?? ''), c.detail ?? '', ...blank(9)]));
  }
  for (const r of health) {
    lines.push(row(['health', r.group, r.item, r.status, '', '', r.detail ?? '', ...blank(9)]));
  }
  for (const a of answers) {
    lines.push(row([
      'answer', '', '', '', '', '', '', a.engine, a.model ?? '', a.webSearch === true ? 'yes' : 'no', a.question,
      a.named ? 'yes' : 'no', a.answer ?? '', (a.businesses ?? []).join('; '), (a.sites ?? []).join('; '), a.date,
    ]));
  }
  for (const n of named) {
    lines.push(row(['named', '', n.name, n.own ? 'you' : '', '', '', `${n.count} of ${n.total}`, ...blank(9)]));
  }
  for (const s of sites) {
    lines.push(row(['site', '', s.domain, s.own ? 'your website' : '', '', '', `${s.count} ${s.count === 1 ? 'answer' : 'answers'}`, ...blank(4), '', '', '', s.url ?? '', '']));
  }
  return `${lines.join('\r\n')}\r\n`;
}
