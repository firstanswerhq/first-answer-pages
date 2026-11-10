/**
 * seance-html.js — pure report building for the Seance, plus the HTML page.
 * Every dynamic value goes through escapeHtml. Visible wording says
 * "owner confirmation", never the word that names the old stamp.
 */

import { layout, escapeHtml } from './html.js';

export const TAG_BEFORE = 'before owner confirmation';
export const TAG_AFTER = 'after owner confirmation';

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
  const tagged = ordered.map(run => ({ ...run, ownerConfirmation: tagRun(run, confirmedDate) }));
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
    summary = `<p><strong>Before:</strong> ${escapeHtml(g.before.timestamp)}. <strong>After:</strong> ${escapeHtml(g.after.timestamp)}.</p>
    <p>${escapeHtml(change)}</p>`;
  }
  return `<section class="seance-group">
    <h3>${escapeHtml(g.provider)}: &ldquo;${escapeHtml(g.prompt)}&rdquo;</h3>
    <p>${escapeHtml(String(g.runCount))} run${g.runCount === 1 ? '' : 's'}.</p>
    ${summary}
  </section>`;
}

function runSection(run) {
  const tag = run.ownerConfirmation
    ? ` <span class="seance-tag">${escapeHtml(run.ownerConfirmation)}</span>`
    : '';
  return `<article class="seance-run">
    <h3>${escapeHtml(run.timestamp)}${tag}</h3>
    <p class="seance-meta">${escapeHtml(run.provider)} &middot; ${escapeHtml(run.prompt)} &middot; ${escapeHtml(yesNo(run.named))}</p>
    <blockquote class="seance-answer">${escapeHtml(run.answer)}</blockquote>
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
    content = `<h2>Before and after</h2>
  ${groups.map(groupSection).join('\n  ')}
  <h2>All runs, oldest first</h2>
  ${tagged.map(runSection).join('\n  ')}`;
  }
  const body = `<section class="seance">
  <h1>Seance report: ${escapeHtml(listing.name)}</h1>
  <p>We ask an AI assistant a plain question about this business&rsquo;s category and city, then record whether the answer names the business.</p>
  ${confirmed}
  ${content}
  <p><a href="/listings/${encodeURIComponent(listing.id)}">Back to the listing</a></p>
</section>`;
  return layout({ title: `Seance report: ${listing.name}`, body });
}
