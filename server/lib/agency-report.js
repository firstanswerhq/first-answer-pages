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
import { registeredDomain, sameSite } from './name-match.js';

const answersOf = grade => (Array.isArray(grade?.ai) ? grade.ai : [])
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
  { domain: 'google.com', name: 'Google', link: 'google', page: 'your Google profile' },
]);

/**
 * 13.2: the sites AI used, from the `sources` stored on each answer (never anything else).
 * @returns {{ hasSources: boolean, rows: Array<{ domain: string, url: string, count: number, own: boolean }>, gaps: string[] }}
 */
export function sitesUsed(grade) {
  const answers = answersOf(grade);
  const website = grade?.input?.website ?? '';
  const byDomain = new Map();
  for (const a of answers) {
    const seen = new Set();
    for (const s of Array.isArray(a.sources) ? a.sources : []) {
      if (!s || typeof s.url !== 'string' || !/^https?:\/\//i.test(s.url)) continue;
      const domain = registeredDomain(s.url);
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      if (!byDomain.has(domain)) {
        byDomain.set(domain, { domain, url: s.url, count: 0, own: Boolean(website) && (sameSite(website, s.url) || registeredDomain(website) === domain) });
      }
      byDomain.get(domain).count += 1;
    }
  }
  const rows = [...byDomain.values()].sort((x, y) => y.count - x.count || x.domain.localeCompare(y.domain));
  const links = grade?.signals?.links ?? {};
  const gaps = [];
  for (const d of DIRECTORIES) {
    const row = byDomain.get(d.domain);
    // Only when we know the website doesn't link there (a checked "Not linked"), never a guess.
    if (!row || links[d.link]?.status !== 'partly') continue;
    const forWhat = row.count === 1 ? 'for one answer' : `for ${row.count} answers`;
    gaps.push(`AI read ${d.name} ${forWhat}. Your website doesn't link to ${d.page}.`);
  }
  return { hasSources: rows.length > 0, rows, gaps };
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

export const CSV_COLUMNS = Object.freeze(['section', 'group', 'item', 'status', 'detail', 'engine', 'model', 'question', 'named', 'date']);

/**
 * 13.4: the report's data as CSV. One row per health row (section "health") and one per answer (section "answer"),
 * the same facts as the page. "Prepared by" is the first line when it is set (13.5).
 * @param {{ preparedBy?: string, health: Array<{ group: string, item: string, status: string, detail?: string }>,
 *           answers: Array<{ engine: string, model?: string, question: string, named: boolean, date: string }> }} data
 */
export function reportCsv({ preparedBy = '', health = [], answers = [] }) {
  const lines = [];
  const name = cleanPreparedBy(preparedBy);
  if (name) lines.push([csvCell('Prepared by'), csvCell(name)].join(','), '');
  lines.push(CSV_COLUMNS.join(','));
  for (const r of health) {
    lines.push(['health', r.group, r.item, r.status, r.detail ?? '', '', '', '', '', ''].map(csvCell).join(','));
  }
  for (const a of answers) {
    lines.push(['answer', '', '', '', '', a.engine, a.model ?? '', a.question, a.named ? 'yes' : 'no', a.date].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
