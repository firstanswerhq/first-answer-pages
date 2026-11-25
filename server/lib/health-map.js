/**
 * health-map.js: the health map at the top of a finished report (high-tech-look Requirement 2, Step 2).
 *
 * Two views of the same facts, both in the server's HTML:
 *  - a plain text list (first in the page, read by screen readers and search tools), with every main node and every
 *    sub-node and its status words;
 *  - the map: an orb in the center with the business name and the report's score, the seven main nodes around it,
 *    each with its sub-nodes. It is decoration only (aria-hidden): the list holds every fact. There are two drawings
 *    of it: the full one (wide screens) and a main-nodes-only one with bigger words (phones). Lines, colors and moving
 *    dots are CSS; the small script /js/health-orb.js only adds a turning particle canvas behind the still orb.
 *
 * Rules: the score shown is the report's existing score in its own form ("Score 69/100"); nothing here changes it.
 * Color is never the only cue: every list row and every main node says its status in words and has a symbol; on the
 * map, sub-nodes are decoration (symbol and color), and their names and words are in the list beside it (design
 * decision, Step 2 review V4). The free listing is information, not health: no health color (Step 2 review V3, H8).
 * Every typed value and every reason goes through escapeHtml. Wording rules apply (wording.md).
 */

import { escapeHtml as h } from './html.js';
import { signalRows } from './health-signals.js';

// ---- the words -----------------------------------------------------------------------------------------------------

/** A main node's status words. The AI answers node uses the report's own row word "Pass" for green. */
export const MAIN_WORDS = Object.freeze({ good: 'Good', partly: 'Partly', missing: 'Needs work', not_checked: 'Not checked' });

/** A symbol per status, so color is never the only cue. 'info' is the free listing: plain information. */
export const SYMBOLS = Object.freeze({ good: '\u2713', partly: '!', missing: '\u2715', not_checked: '?', info: 'i' });

export const MAP_TITLE = 'Health of your setup';
// Step 2 reader review H1: say what the colors are; the score is named the same way as at the top of the page.
export const MAP_INTRO = "Every check we ran, at a glance. Green is good, amber is part way there, red needs work, gray means we couldn't check it. Your score is at the top of the page.";
// Step 2 review V3: true at any later time (the spots were open when the check ran), and the listing is free.
export const FOUNDING_NOTE = 'When we ran this check, Founding Member spots were still open. Listing is free; Founding Members pay once for the optional Verified stamp.';
export const TAP_HINT = 'Tap a circle to see its checks.';
export const OLD_REPORT_NOTE = 'This report was made before these checks existed. Run a new check to see them.';
const OLD_REPORT_SHORT = 'Made before this check existed.';
const HAVE_NOT_CHECKED = "Couldn't check this time. Run a new check later.";

/** The seven main nodes, in the design's order, with their names on one or two lines for the map. */
export const MAIN_NODES = Object.freeze([
  { id: 'website', name: 'Website', lines: ['Website'] },
  { id: 'ai', name: 'AI answers', lines: ['AI', 'answers'] },
  { id: 'google', name: 'Google profile', lines: ['Google', 'profile'] },
  { id: 'reviews', name: 'Reviews', lines: ['Reviews'] },
  { id: 'details', name: 'Details match', lines: ['Details', 'match'] },
  { id: 'links', name: 'Links', lines: ['Links'] },
  { id: 'listing', name: 'Free listing', lines: ['Free', 'listing'] },
]);

/**
 * Every sub-node except the AI answers, in the design's order (design.md, "The sub-nodes"). `check` rows read the
 * existing Checks (HAVE); `path` rows read the saved signals (ADD and KEY). Names are plain words first (Step 2 reader
 * review H6, H9); `words` turns a status label that repeats the name into a short answer (H7).
 */
export const SUB_NODES = Object.freeze([
  // 1. Website
  { main: 'website', cluster: 'Can AI read your website', name: 'Your website lets AI assistants read it (robots.txt)', check: 'ai-bots-allowed', words: { pass: 'Yes', fail: 'No, it blocks some' } },
  { main: 'website', cluster: 'Can AI read your website', name: 'Page list for search engines (sitemap)', path: 'website.sitemap' },
  { main: 'website', cluster: 'Can AI read your website', name: 'Text AI can read', path: 'website.wordsInPage', words: { 'Found in the page': 'Yes' } },
  { main: 'website', cluster: 'Can AI read your website', name: 'Name, phone and address tagged for AI (business label)', check: 'business-labeled', words: { pass: 'Found', fail: 'Not found' } },
  { main: 'website', cluster: "Speaks AI's language", name: 'Says what you do', path: 'website.saysWhatYouDo' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Says where you work', path: 'website.saysWhereYouWork' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Answers common questions', path: 'website.answersQuestions' },
  { main: 'website', cluster: "Speaks AI's language", name: 'A page for each service', path: 'website.pagePerService' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Recently updated', path: 'website.recentlyUpdated' },
  { main: 'website', cluster: "Speaks AI's language", name: 'A short info file for AI (llms.txt)', check: 'info-sheet', words: { pass: 'Found', fail: 'Not found' } },
  { main: 'website', cluster: 'Search basics', name: 'Page title names your city and service', check: 'title-city-service' },
  { main: 'website', cluster: 'Search basics', name: 'One main headline on the page', check: 'one-headline' },
  { main: 'website', cluster: 'Search basics', name: 'Search summary (the 2 lines under your link in Google)', check: 'summary' },
  { main: 'website', cluster: 'Search basics', name: 'Descriptions on your pictures', check: 'image-descriptions' },
  { main: 'website', cluster: 'Search basics', name: 'Picture shown when someone shares your link', check: 'share-picture' },
  { main: 'website', cluster: 'Customer basics', name: 'Tap-to-call phone number', check: 'tap-to-call' },
  { main: 'website', cluster: 'Customer basics', name: 'Hours on the home page', check: 'hours-shown' },
  { main: 'website', cluster: 'Customer basics', name: 'Street address on the home page', serviceAreaName: 'Service area on the home page', check: 'address-shown' },
  { main: 'website', cluster: 'Customer basics', name: 'Call or book button on the home page', check: 'call-button' },
  // 3. Google profile
  { main: 'google', name: 'On Google', path: 'google.found', words: { 'Found on Google': 'Yes', 'Not found on Google': 'Not found' } },
  { main: 'google', name: 'Open for business', path: 'google.open' },
  { main: 'google', name: 'Category', path: 'google.category', words: { 'Category fits': 'Fits', 'Category may not fit what you do': 'May not fit what you do' } },
  { main: 'google', name: 'Hours on Google', path: 'google.hours', words: { 'Hours listed': 'Listed', 'No hours listed': 'Not listed' } },
  // 4. Reviews
  { main: 'reviews', name: 'Google review count', path: 'google.reviewCount' },
  { main: 'reviews', name: 'Google star rating', path: 'google.rating' },
  { main: 'reviews', name: 'A recent review', path: 'google.newestReview' },
  { main: 'reviews', name: 'Reviews shown on your website', check: 'reviews-visible', words: { pass: 'Shown', fail: 'Not shown' } },
  // 5. Details match
  { main: 'details', name: 'Phone matches Google', path: 'google.phoneMatch' },
  { main: 'details', name: 'Address matches Google', path: 'google.addressMatch' },
  { main: 'details', name: 'Name matches Google', path: 'google.nameMatch' },
  { main: 'details', name: 'Hours match Google', path: 'google.hoursMatch' },
  { main: 'details', name: 'Your First Answer Pages listing matches your website', path: 'listing.matchesWebsite' },
  { main: 'details', name: 'On Bing Maps', path: 'bing.found', words: { 'Found on Bing': 'Yes', 'Not found in Bing map data': 'Not on Bing Maps yet' } },
  { main: 'details', name: 'Details match on Bing', path: 'bing.details' },
  // 6. Links
  { main: 'links', name: 'Website links to your Google profile', path: 'links.google' },
  { main: 'links', name: 'Website links to Yelp', path: 'links.yelp' },
  { main: 'links', name: 'Google links to your site', path: 'google.linksToWebsite', words: { 'Links to your website': 'Yes', "Doesn't link to your website": 'No' } },
  { main: 'links', name: 'Your First Answer Pages listing links to your website', path: 'listing.linksToWebsite' },
  { main: 'links', cluster: 'Socials', name: 'Facebook', path: 'links.facebook' },
  { main: 'links', cluster: 'Socials', name: 'Instagram', path: 'links.instagram' },
  { main: 'links', cluster: 'Socials', name: 'TikTok', path: 'links.tiktok' },
  // 7. Free listing (information, not health)
  { main: 'listing', name: 'Listed on First Answer Pages', path: 'listing.listed' },
  { main: 'listing', name: 'Verified stamp', path: 'listing.verified' },
  { main: 'listing', name: 'Founding Member', path: 'listing.founding' },
]);

const STATUSES = new Set(['good', 'partly', 'missing', 'not_checked', 'info']);
const statusOf = s => (STATUSES.has(s) ? s : 'not_checked');

// ---- the model -----------------------------------------------------------------------------------------------------

/** A HAVE row from an existing Check result: pass, fail or not checked, in the design's words. */
function checkSub(def, result, input) {
  const name = def.serviceAreaName && input?.noStorefront === true ? def.serviceAreaName : def.name;
  const base = { name, cluster: def.cluster ?? null };
  const r = result?.result;
  if (r === 'pass') return { ...base, status: 'good', label: def.words?.pass ?? 'Good' };
  if (r === 'fail') return { ...base, status: 'missing', label: def.words?.fail ?? 'Needs work' };
  // The check's own plain reason, the same one the full list of checks shows (Step 2 review V9).
  const reason = typeof result?.detail === 'string' && result.detail.trim() !== '' ? result.detail : HAVE_NOT_CHECKED;
  return { ...base, status: 'not_checked', label: 'Not checked', reason };
}

/** A row from the saved signals (already in plain words, with a reason or a fix). */
function signalSub(def, row, old) {
  // "Founding spots still open" (status 'info') is never a node: it is the plain note under Free listing (Q8).
  if (!row || row.status === 'info') return null;
  const label = String(row.label ?? 'Not checked');
  const reason = old ? OLD_REPORT_SHORT : row.reason;
  return {
    name: def.name,
    cluster: def.cluster ?? null,
    status: statusOf(row.status),
    label: def.words?.[label] ?? label,
    ...(reason ? { reason: String(reason) } : {}),
    ...(row.fix ? { fix: String(row.fix) } : {}),
  };
}

/**
 * The free listing rows as information (Step 2 review V3, reader H8): no health color, no fix; plain words that say
 * what is so ("Not yet. It's free, claim it below.").
 */
function listingSub(def, row, old) {
  if (!row || row.status === 'info') return null;
  const base = { name: def.name, cluster: null, status: 'info' };
  if (old) return { ...base, label: 'Not checked', reason: OLD_REPORT_SHORT };
  if (def.path === 'listing.listed') {
    if (row.status === 'good') return { ...base, label: 'Listed' };
    if (row.needsClaim) return { ...base, label: "Not yet. It's free, claim it below." };
    return { ...base, label: 'Not checked', ...(row.reason ? { reason: String(row.reason) } : {}) };
  }
  if (def.path === 'listing.verified') {
    if (row.status === 'good') return { ...base, label: 'Verified' };
    if (row.status === 'partly') return { ...base, label: 'Not verified yet' };
    if (row.reason === 'No listing yet.') return { ...base, label: 'Available after you claim your listing.' };
    return { ...base, label: 'Not checked', ...(row.reason ? { reason: String(row.reason) } : {}) };
  }
  return { ...base, label: String(row.label ?? '') }; // Founding Member
}

const counted = subs => subs.filter(s => s.status !== 'not_checked' && s.status !== 'info');
const allGood = subs => subs.length > 0 && subs.every(s => s.status === 'good');

/** The main node's status from its sub-nodes, by the design's main status rules. */
export function mainStatus(id, subs, extra = {}) {
  if (id === 'ai') return statusOf(extra.aiStatus);
  if (id === 'listing') return 'info'; // information, never a health color
  const seen = counted(subs);
  if (seen.length === 0) return 'not_checked';
  const byName = name => subs.find(s => s.name === name);
  switch (id) {
    case 'website': {
      if (allGood(seen)) return 'good';
      const red = seen.filter(s => s.status === 'missing').length;
      return red > seen.length / 2 ? 'missing' : 'partly';
    }
    case 'google': {
      if (byName('On Google')?.status === 'missing') return 'missing';
      return allGood(seen) ? 'good' : 'partly';
    }
    case 'reviews': {
      const count = byName('Google review count');
      const stars = byName('Google star rating');
      const site = byName('Reviews shown on your website');
      if (count?.status === 'good' && stars?.status === 'good') return 'good';
      if (count?.status === 'missing' && site?.status === 'missing') return 'missing';
      return allGood(seen) ? 'good' : 'partly';
    }
    case 'details': {
      if (seen.some(s => s.status === 'missing')) return 'missing';
      return allGood(seen) ? 'good' : 'partly';
    }
    default: // links: no link row is ever red, so the node is amber at worst
      return allGood(seen) ? 'good' : 'partly';
  }
}

/** The free listing node's words: what is so, not a health word. */
function listingLabel(subs, old) {
  if (old) return 'Not checked';
  const listed = subs.find(s => s.name === 'Listed on First Answer Pages')?.label;
  const verified = subs.find(s => s.name === 'Verified stamp')?.label;
  if (listed === 'Listed') return verified === 'Verified' ? 'Verified' : 'Listed';
  if (listed && listed.startsWith('Not yet')) return 'Not started';
  return 'Not sure';
}

/**
 * Everything the list and the map show, worked out once.
 * @param {object} grade  a finished Grade (with `results` already scored by the report)
 * @param {{ score: number|null, aiRows: Array<{ name: string, status: string, label: string }>, aiStatus: string,
 *           aiReason?: string }} opts  `aiReason` is the one line shown when there is no answer (H5)
 */
export function healthModel(grade, { score = null, aiRows = [], aiStatus = 'not_checked', aiReason } = {}) {
  const results = new Map((Array.isArray(grade?.results) ? grade.results : []).filter(r => r && typeof r.id === 'string').map(r => [r.id, r]));
  const old = !grade?.signals || typeof grade.signals !== 'object';
  const rows = new Map(signalRows(old ? undefined : grade.signals).map(r => [r.path, r]));
  const input = grade?.input ?? {};
  const mains = MAIN_NODES.map(node => {
    let subs;
    if (node.id === 'ai') {
      subs = aiRows.map(r => ({ name: r.name, cluster: null, status: statusOf(r.status), label: r.label }));
    } else {
      subs = SUB_NODES.filter(d => d.main === node.id)
        .map(d => {
          if (d.check) return checkSub(d, results.get(d.check), input);
          if (node.id === 'listing') return listingSub(d, rows.get(d.path), old);
          return signalSub(d, rows.get(d.path), old);
        })
        .filter(Boolean);
    }
    const status = mainStatus(node.id, subs, { aiStatus });
    let label = MAIN_WORDS[status];
    if (node.id === 'ai' && status === 'good') label = 'Pass';
    if (node.id === 'listing') label = listingLabel(subs, old);
    const out = { id: node.id, name: node.name, lines: node.lines, status, label, subs };
    if (node.id === 'ai' && subs.length === 0 && aiReason) out.reason = String(aiReason);
    if (node.id === 'links') out.socials = socialsCluster(old ? undefined : grade.signals);
    if (node.id === 'listing' && !old && grade.signals?.listing?.founding?.status === 'info') out.note = FOUNDING_NOTE;
    return out;
  });
  return { name: String(input.name ?? ''), score: Number.isInteger(score) ? score : null, old, mains };
}

/** The Socials cluster's own line ("1 of 3 linked"), or "Not checked" with a reason for a report from before. */
function socialsCluster(signals) {
  const s = signals?.links?.socials;
  if (!s || typeof s !== 'object') return { status: 'not_checked', label: 'Not checked', reason: OLD_REPORT_SHORT };
  return {
    status: statusOf(s.status),
    label: String(s.label ?? 'Not checked'),
    ...(s.reason ? { reason: String(s.reason) } : {}),
    ...(s.fix ? { fix: String(s.fix) } : {}),
  };
}

// ---- the plain text list -------------------------------------------------------------------------------------------

const sym = status => `<span class="health-sym" aria-hidden="true">${SYMBOLS[statusOf(status)]}</span>`;

/** A reason line, escaped; "Run a new check" in it becomes the report's own link to a new check (V244). */
function reasonHtml(reason, runNew) {
  const safe = h(reason);
  return typeof runNew === 'function' ? safe.replace(/Run a new check/g, () => runNew('Run a new check')) : safe;
}

function rowHtml(sub, full, runNew) {
  const reason = sub.reason ? ` <span class="health-why">${reasonHtml(sub.reason, runNew)}</span>` : '';
  const fix = full && sub.fix && sub.status !== 'info' ? ` <span class="health-fix"><strong>Fix:</strong> ${h(sub.fix)}</span>` : '';
  return `<li class="health-row health-${sub.status}">${sym(sub.status)}<strong class="health-row-name">${h(sub.name)}:</strong> <span class="health-status">${h(sub.label)}</span>${reason}${fix}</li>`;
}

function groupHtml(main, full, runNew) {
  const parts = [];
  let cluster;
  let list = [];
  const flush = () => {
    if (list.length === 0) return;
    parts.push(`<ul class="health-rows">\n${list.join('\n')}\n</ul>`);
    list = [];
  };
  for (const sub of main.subs) {
    if ((sub.cluster ?? null) !== (cluster ?? null)) {
      flush();
      cluster = sub.cluster ?? null;
      if (cluster === 'Socials' && main.socials) {
        const so = main.socials;
        parts.push(`<h4 class="health-cluster health-${so.status}">${sym(so.status)}Socials: <span class="health-status">${h(so.label)}</span></h4>`);
        // The reason and the fix sit under the heading, not inside it (Step 2 review V11).
        if (so.reason) parts.push(`<p class="health-why">${reasonHtml(so.reason, runNew)}</p>`);
        if (full && so.fix) parts.push(`<p class="health-fix"><strong>Fix:</strong> ${h(so.fix)}</p>`);
      } else if (cluster) {
        parts.push(`<h4 class="health-cluster">${h(cluster)}</h4>`);
      }
    }
    list.push(rowHtml(sub, full, runNew));
  }
  flush();
  if (main.reason) parts.push(`<p class="health-why">${reasonHtml(main.reason, runNew)}</p>`);
  if (main.note) parts.push(`<p class="health-note">${h(main.note)}</p>`);
  return `<div class="health-group health-${main.status}" id="health-g-${main.id}">
  <h3>${sym(main.status)}<span class="health-group-name">${h(main.name)}:</span> <span class="health-status">${h(main.label)}</span></h3>
  ${parts.join('\n  ')}
  <a href="#health-map" class="health-back" tabindex="-1" aria-hidden="true">Back to the map</a>
</div>`;
}

// ---- the map (decoration; every fact is in the list) ---------------------------------------------------------------

/**
 * The two drawings and their sizes. The words on the main nodes are at least 12 px on screen at the narrowest map
 * each drawing is shown at (Step 2 review V2, reader H4): font units x shown width / viewBox width.
 */
export const MAP_SIZES = Object.freeze({
  full: { view: 1000, minShownPx: 540, rMain: 280, rNode: 86, nameFont: 24, statusFont: 24, symbolFont: 26, orbFont: 24 },
  phone: { view: 700, minShownPx: 353, rMain: 260, rNode: 86, nameFont: 26, statusFont: 24, symbolFont: 26, orbFont: 24 },
});
const MID = 500;
const R_ORB = 110;
const R_SUB_AT = 150;
const R_SUB = 14;
const round = n => Math.round(n * 10) / 10;
const polar = (cx, cy, r, deg) => [round(cx + r * Math.cos((deg * Math.PI) / 180)), round(cy + r * Math.sin((deg * Math.PI) / 180))];

/**
 * One link: steady dots both ways when green, slow fading dots partway when amber, a break when red, dashed when gray,
 * a plain still line for information (the free listing).
 */
export function linkSvg([x1, y1], [x2, y2], status, size = 'main') {
  const at = t => [round(x1 + (x2 - x1) * t), round(y1 + (y2 - y1) * t)];
  const line = (a, b, cls) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${cls}"/>`;
  const base = `health-line health-line-${size}`;
  const s = statusOf(status);
  if (s === 'good') {
    return `${line([x1, y1], [x2, y2], `${base} health-line-good`)}${line([x1, y1], [x2, y2], `health-flow health-flow-${size} health-flow-out`)}${line([x2, y2], [x1, y1], `health-flow health-flow-${size} health-flow-in`)}`;
  }
  if (s === 'partly') {
    return `${line([x1, y1], [x2, y2], `${base} health-line-partly`)}${line([x1, y1], at(0.6), `health-flow health-flow-${size} health-flow-slow`)}`;
  }
  if (s === 'missing') {
    // A wider break on the short sub-node links, so it shows (Step 2 review V7).
    const [a, b] = size === 'sub' ? [0.3, 0.7] : [0.44, 0.56];
    return `${line([x1, y1], at(a), `${base} health-line-missing`)}${line(at(b), [x2, y2], `${base} health-line-missing`)}`;
  }
  if (s === 'info') return line([x1, y1], [x2, y2], `${base} health-line-info`);
  return line([x1, y1], [x2, y2], `${base} health-line-gray`);
}

/** Up to two short lines of the business name for the orb. */
function nameLines(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (`${cur} ${w}`.trim().length <= 16) lines[lines.length - 1] = `${cur} ${w}`.trim();
    else if (lines.length < 2 && cur !== '') lines.push(w);
    else if (cur === '') lines[lines.length - 1] = w;
    else { lines[1] = `${lines[1]}\u2026`; break; }
  }
  return lines.map(l => (l.length > 17 ? `${l.slice(0, 16)}\u2026` : l)).filter(Boolean);
}

/** A main node: its symbol, its name on one or two lines, and its status word. */
function mainNodeSvg(main, [x, y], sz) {
  const st = statusOf(main.status);
  const lines = main.lines ?? [main.name];
  const lh = sz.nameFont + 2;
  const top = y - (lines.length * lh) / 2 + sz.nameFont * 0.35;
  const nameSvg = lines.map((l, i) => `<tspan x="${x}" y="${round(top + i * lh)}">${h(l)}</tspan>`).join('');
  return `<a href="#health-g-${main.id}" tabindex="-1" class="health-node-link"><g class="health-node health-node-${st}" data-name="${h(main.name)}">`
    + `<circle cx="${x}" cy="${y}" r="${sz.rNode}" class="health-node-ring"/>`
    + `<text x="${x}" y="${round(y - sz.rNode + sz.symbolFont + 4)}" class="health-node-sym" font-size="${sz.symbolFont}">${SYMBOLS[st]}</text>`
    + `<text class="health-node-name" font-size="${sz.nameFont}">${nameSvg}</text>`
    + `<text x="${x}" y="${round(y + sz.rNode * 0.52)}" class="health-node-status" font-size="${sz.statusFont}">${h(main.label)}</text>`
    + '</g></a>';
}

function orbSvg(model, sz, gradientId) {
  const lines = nameLines(model.name);
  const lh = sz.orbFont + 4;
  const nameY = MID - 20 - (lines.length - 1) * lh;
  const nameSvg = lines.map((l, i) => `<text x="${MID}" y="${round(nameY + i * lh)}" class="health-orb-name" font-size="${sz.orbFont}">${h(l)}</text>`).join('');
  // H1: the score in the report's own form, the same number as at the top of the page.
  const scoreSvg = model.score === null
    ? `<text x="${MID}" y="${MID + 34}" class="health-orb-score health-orb-score-none">Not scored yet</text>`
    : `<text x="${MID}" y="${MID + 38}" class="health-orb-score">Score ${model.score}/100</text>`;
  return `<circle cx="${MID}" cy="${MID}" r="${R_ORB + 40}" class="health-orb-halo"/>
  <circle cx="${MID}" cy="${MID}" r="${R_ORB}" class="health-orb" fill="url(#${gradientId})"/>
  ${nameSvg}${scoreSvg}`;
}

const gradient = id => `<defs><radialGradient id="${id}" cx="50%" cy="45%" r="60%"><stop offset="0%" stop-color="#7ef3ff" stop-opacity="0.55"/><stop offset="60%" stop-color="#1e6f8f" stop-opacity="0.35"/><stop offset="100%" stop-color="#0b1020" stop-opacity="0"/></radialGradient></defs>`;

/** The full drawing: main nodes and their sub-nodes (symbol and color only; the list has their words). */
function fullSvg(model) {
  const sz = MAP_SIZES.full;
  const parts = [];
  const n = model.mains.length;
  model.mains.forEach((main, i) => {
    const deg = -90 + (i * 360) / n;
    const pos = polar(MID, MID, sz.rMain, deg);
    parts.push(linkSvg(polar(MID, MID, R_ORB + 6, deg), polar(MID, MID, sz.rMain - sz.rNode - 4, deg), main.status, 'main'));
    const subs = main.subs;
    const spread = subs.length > 1 ? Math.min(150, 9 * (subs.length - 1)) : 0;
    subs.forEach((sub, k) => {
      const a = subs.length > 1 ? deg - spread / 2 + (k * spread) / (subs.length - 1) : deg;
      const p = polar(pos[0], pos[1], R_SUB_AT, a);
      const st = statusOf(sub.status);
      parts.push(`<g class="health-sub health-sub-${st}">${linkSvg(polar(pos[0], pos[1], sz.rNode + 3, a), polar(pos[0], pos[1], R_SUB_AT - R_SUB - 2, a), st, 'sub')}`
        + `<circle cx="${p[0]}" cy="${p[1]}" r="${R_SUB}" class="health-dot-node"/>`
        + `<text x="${p[0]}" y="${round(p[1] + 7)}" class="health-sub-sym">${SYMBOLS[st]}</text>`
        + '</g>');
    });
    parts.push(mainNodeSvg(main, pos, sz));
  });
  return `<svg class="health-svg health-svg-full" viewBox="0 0 ${sz.view} ${sz.view}" role="presentation" focusable="false" xmlns="http://www.w3.org/2000/svg">
  ${gradient('health-orb-glow-full')}
  ${parts.join('\n  ')}
  ${orbSvg(model, sz, 'health-orb-glow-full')}
</svg>`;
}

/** The phone drawing: the main nodes only, in a tighter view, with bigger words (Step 2 review V2). */
function phoneSvg(model) {
  const sz = MAP_SIZES.phone;
  const parts = [];
  const n = model.mains.length;
  model.mains.forEach((main, i) => {
    const deg = -90 + (i * 360) / n;
    const pos = polar(MID, MID, sz.rMain, deg);
    parts.push(linkSvg(polar(MID, MID, R_ORB + 6, deg), polar(MID, MID, sz.rMain - sz.rNode - 4, deg), main.status, 'main'));
    parts.push(mainNodeSvg(main, pos, sz));
  });
  const off = MID - sz.view / 2;
  return `<svg class="health-svg health-svg-phone" viewBox="${off} ${off} ${sz.view} ${sz.view}" role="presentation" focusable="false" xmlns="http://www.w3.org/2000/svg">
  ${gradient('health-orb-glow-phone')}
  ${parts.join('\n  ')}
  ${orbSvg(model, sz, 'health-orb-glow-phone')}
</svg>`;
}

// ---- the whole section ---------------------------------------------------------------------------------------------

/**
 * The health map section: the plain list first, then the map. The fix sentences show only in the full report.
 * @param {ReturnType<typeof healthModel>} model
 * @param {{ full?: boolean, runNew?: (text: string) => string }} [opts] `runNew` gives the report's own
 *   "Run a new check" link (trusted HTML), so every mention of it in a reason is a link.
 */
export function healthMapHtml(model, { full = false, runNew } = {}) {
  // A report from before these checks: one line with the link, not the same link on every row (Step 2 review V10).
  const oldNote = model.old ? `\n  <p class="health-note health-old">${reasonHtml(OLD_REPORT_NOTE, runNew)}</p>` : '';
  return `<section class="health" aria-labelledby="health-title">
  <h2 id="health-title">${MAP_TITLE}</h2>
  <p class="hint health-intro">${h(MAP_INTRO)}</p>${oldNote}
  <div class="health-layout">
    <div class="health-list">
${model.mains.map(m => groupHtml(m, full, runNew)).join('\n')}
    </div>
    <div class="health-map" id="health-map" aria-hidden="true">
      <div class="health-orb-host" data-health-orb></div>
      ${fullSvg(model)}
      ${phoneSvg(model)}
      <p class="health-tap">${h(TAP_HINT)}</p>
    </div>
  </div>
</section>`;
}
