/**
 * seance-html.js — pure report building for the Seance, plus the HTML page.
 * Every dynamic value goes through escapeHtml. Visible wording says
 * "owner confirmation", never the word that names the old stamp.
 */

import { layout, escapeHtml } from './html.js';

export const TAG_BEFORE = 'before owner confirmation';
export const TAG_AFTER = 'after owner confirmation';
export const DEMO_LABEL = 'Demo answer (no AI connected)';

/** True for runs answered by the mock provider. Computed, never stored. */
const isDemo = providerName => providerName === 'mock';

const demoSpan = providerName =>
  isDemo(providerName) ? ` <span class="seance-demo">${DEMO_LABEL}</span>` : '';

/** Provider name as shown to people: the mock provider reads as "demo". */
export const providerLabel = name => (name === 'mock' ? 'demo' : name);

const TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZoneName: 'short',
});

/**
 * Readable Central time, e.g. 'Nov 9, 2026, 11:05 PM CST'.
 * Invalid input is returned unchanged (the caller escapes it).
 * @param {string} isoString
 * @returns {string}
 */
export function formatRunTime(isoString) {
  try {
    const date = new Date(isoString);
    if (typeof isoString !== 'string' || Number.isNaN(date.getTime())) return isoString;
    const p = {};
    for (const part of TIME_FORMAT.formatToParts(date)) p[part.type] = part.value;
    const period = String(p.dayPeriod ?? '').replace(/[\u202f\u00a0]/g, ' ').trim();
    return `${p.month} ${p.day}, ${p.year}, ${p.hour}:${p.minute} ${period} ${p.timeZoneName}`;
  } catch {
    return isoString;
  }
}

/** <time> element: raw ISO in datetime, readable text as content. Both escaped. */
function timeEl(iso) {
  return `<time datetime="${escapeHtml(iso)}">${escapeHtml(formatRunTime(iso))}</time>`;
}

/**
 * Orders runs oldest to newest (stable for equal timestamps).
 * @param {object[]} runs
 */
function sortRuns(runs) {
  return runs
    .map((run, i) => ({ run, i }))
    .sort((a, b) => {
      const ta = String(a.run.timestamp ?? '');
      const tb = String(b.run.timestamp ?? '');
      return ta < tb ? -1 : ta > tb ? 1 : a.i - b.i;
    })
    .map(x => x.run);
}

/**
 * Tags a run by UTC date against the owner-confirmed date.
 * Same date counts as after. No confirmed date means no tag.
 * @param {{ timestamp: string }} run
 * @param {string|null|undefined} confirmedDate YYYY-MM-DD
 * @returns {string|null}
 */
export function tagRun(run, confirmedDate) {
  if (typeof confirmedDate !== 'string' || confirmedDate === '') return null;
  const day = String(run.timestamp ?? '').slice(0, 10);
  return day < confirmedDate ? TAG_BEFORE : TAG_AFTER;
}

/**
 * Groups runs by (provider, prompt). Groups keep first-appearance order.
 * With 2 or more runs the first is "before", the last is "after".
 * @param {object[]} runs
 * @returns {{ provider: string, prompt: string, runs: object[], before: object|null, after: object|null, changed: boolean|null }[]}
 */
export function groupRuns(runs) {
  const map = new Map();
  for (const run of sortRuns(Array.isArray(runs) ? runs : [])) {
    const key = JSON.stringify([run.provider, run.prompt]);
    if (!map.has(key)) map.set(key, { provider: run.provider, prompt: run.prompt, runs: [] });
    map.get(key).runs.push(run);
  }
  return [...map.values()].map(g => {
    if (g.runs.length < 2) return { ...g, before: null, after: null, changed: null };
    const before = g.runs[0];
    const after = g.runs[g.runs.length - 1];
    return { ...g, before, after, changed: before.named !== after.named };
  });
}

/**
 * History used by both the JSON endpoint and the HTML page.
 * @param {object[]} runs
 * @param {string|null|undefined} confirmedDate
 * @returns {{ runs: object[], groups: object[] }}
 */
export function buildHistory(runs, confirmedDate) {
  const ordered = sortRuns(Array.isArray(runs) ? runs : []);
  const tagged = ordered.map(run => ({
    ...run,
    ownerConfirmation: tagRun(run, confirmedDate),
    demo: isDemo(run.provider),
  }));
  const groups = groupRuns(ordered).map(g => ({
    provider: g.provider,
    prompt: g.prompt,
    runCount: g.runs.length,
    before: g.before ? { id: g.before.id, timestamp: g.before.timestamp, named: g.before.named } : null,
    after: g.after ? { id: g.after.id, timestamp: g.after.timestamp, named: g.after.named } : null,
    namedChanged: g.changed,
  }));
  return { runs: tagged, groups };
}

const yesNo = named => (named ? 'named the business' : 'did not name the business');

function groupSection(g) {
  let summary;
  if (g.runCount < 2) {
    summary = '<p>Only one run so far, so there is nothing to compare yet.</p>';
  } else {
    const change = g.namedChanged
      ? `The answer changed: the first run (before) ${yesNo(g.before.named)}; the latest run (after) ${yesNo(g.after.named)}.`
      : `No change: both the first run (before) and the latest run (after) ${yesNo(g.after.named)}.`;
    summary = `<p><strong>Before:</strong> ${timeEl(g.before.timestamp)}. <strong>After:</strong> ${timeEl(g.after.timestamp)}.</p>
    <p>${escapeHtml(change)}</p>`;
  }
  return `<section class="seance-group">
    <h3>${escapeHtml(providerLabel(g.provider))}: &ldquo;${escapeHtml(g.prompt)}&rdquo;${demoSpan(g.provider)}</h3>
    <p>${escapeHtml(String(g.runCount))} run${g.runCount === 1 ? '' : 's'}.</p>
    ${summary}
  </section>`;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

/**
 * Chicago date as 'Mon D, YYYY', e.g. 'Nov 10, 2026'.
 * Invalid input is returned unchanged (the caller escapes it).
 * @param {string} iso
 * @returns {string}
 */
export function formatRunDate(iso) {
  try {
    const date = new Date(iso);
    if (typeof iso !== 'string' || Number.isNaN(date.getTime())) return iso;
    const p = {};
    for (const part of DATE_FORMAT.formatToParts(date)) p[part.type] = part.value;
    return `${p.month} ${p.day}, ${p.year}`;
  } catch {
    return iso;
  }
}

/** 'Asked Claude (with web search) on Nov 10, 2026.' or '' for demo runs. */
function askedLine(run) {
  if (isDemo(run.provider)) return '';
  const who = run.provider === 'anthropic' ? 'Claude'
    : run.provider === 'openai' ? 'OpenAI'
      : providerLabel(run.provider);
  const search = run.webSearch === true ? ' (with web search)' : '';
  return `<p class="seance-asked">${escapeHtml(`Asked ${who}${search} on ${formatRunDate(run.timestamp)}.`)}</p>`;
}

/**
 * 'Sources: <a>Title</a>, ...' for a run, or '' when it has none. Only http(s)
 * URLs become links (checked again here); title and URL are escaped.
 */
function sourcesLine(run) {
  if (!Array.isArray(run.sources)) return '';
  const links = run.sources
    .filter(s => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url.trim()))
    .map(s => {
      const url = s.url.trim();
      const title = typeof s.title === 'string' && s.title !== '' ? s.title : url;
      return `<a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow">${escapeHtml(title)}</a>`;
    });
  return links.length > 0 ? `\n    <p class="seance-sources">Sources: ${links.join(', ')}</p>` : '';
}

function runSection(run) {
  const model = run.provider !== 'mock' && typeof run.model === 'string' && run.model !== ''
    ? ` &middot; ${escapeHtml(run.model)}`
    : '';
  const tag = run.ownerConfirmation
    ? ` <span class="seance-tag">${escapeHtml(run.ownerConfirmation)}</span>`
    : '';
  return `<article class="seance-run">
    <h3>${timeEl(run.timestamp)}${tag}${demoSpan(run.provider)}</h3>
    ${askedLine(run)}
    <p class="seance-meta">${escapeHtml(providerLabel(run.provider))}${model} &middot; ${escapeHtml(run.prompt)} &middot; ${escapeHtml(yesNo(run.named))}</p>
    <blockquote class="seance-answer">${escapeHtml(run.answer)}</blockquote>${sourcesLine(run)}
  </article>`;
}

/**
 * Seance report page.
 * @param {{ id: string, name: string }} listing
 * @param {object[]} runs
 * @param {string|null|undefined} confirmedDate
 * @returns {string} full HTML document
 */
export function seanceReportPage(listing, runs, confirmedDate) {
  const { runs: tagged, groups } = buildHistory(runs, confirmedDate);
  const confirmed = confirmedDate
    ? `<p>Owner-confirmed ${escapeHtml(confirmedDate)}.</p>`
    : '<p>Not yet confirmed by the owner.</p>';
  let content;
  if (tagged.length === 0) {
    content = '<p>No runs have been recorded yet.</p>';
  } else {
    const latest = tagged[tagged.length - 1];
    const headline = isDemo(latest.provider)
      ? `<p class="seance-result seance-demo">${escapeHtml(latest.named ? 'Demo answer: AI named this business' : "Demo answer: AI didn't name this business yet")}</p>`
      : latest.named
        ? `<p class="seance-result seance-named">${escapeHtml('AI named this business')}</p>`
        : `<p class="seance-result seance-not-named">${escapeHtml("AI didn't name this business yet")}</p>`;
    content = `${headline}
  <h2>Before and after</h2>
  ${groups.map(groupSection).join('\n  ')}
  <h2>All runs, oldest first</h2>
  ${tagged.map(runSection).join('\n  ')}`;
  }
  const body = `<section class="seance">
  <h1>Séance report: ${escapeHtml(listing.name)}</h1>
  <p>We ask an AI assistant a plain question about this business&rsquo;s category and city, then record whether the answer names the business.</p>
  ${confirmed}
  ${content}
  <p><a href="/listings/${encodeURIComponent(listing.id)}">Back to the listing</a></p>
</section>`;
  return layout({ title: `Séance report: ${listing.name}`, body });
}
