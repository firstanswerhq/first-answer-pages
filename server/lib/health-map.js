/**
 * health-map.js: the health map at the top of a finished report (high-tech-look Requirement 2, Step 2).
 *
 * Two views of the same facts, both in the server's HTML:
 *  - a plain text list (first in the page, read by screen readers and search tools), with every main node and every
 *    sub-node and its status words;
 *  - the map: an orb in the center with the business name and "Health 68", the seven main nodes around it, each with
 *    its sub-nodes. It is decoration only (aria-hidden): the list holds every fact. Lines, colors and moving dots are
 *    CSS; the small script /js/health-orb.js only adds a turning particle canvas behind the still orb.
 *
 * Rules: the score shown is the report's existing score (nothing here changes it). Color is never the only cue: every
 * node and row says its status in words, and every node also has a status symbol. "Founding spots still open" is not
 * a health signal: it shows only in the listing part of the list, as a plain line, never with a health color.
 * Every typed value and every reason goes through escapeHtml. Wording rules apply (wording.md).
 */

import { escapeHtml as h } from './html.js';
import { signalRows } from './health-signals.js';

// ---- the words -----------------------------------------------------------------------------------------------------

/** A main node's status words. The AI answers node uses the report's own row word "Pass" for green. */
export const MAIN_WORDS = Object.freeze({ good: 'Good', partly: 'Partly', missing: 'Needs work', not_checked: 'Not checked' });

/** The short status word on a sub-node of the map (the list beside it gives the full words). */
export const SUB_WORDS = MAIN_WORDS;

/** A symbol per status, so color is never the only cue. */
export const SYMBOLS = Object.freeze({ good: '\u2713', partly: '!', missing: '\u2715', not_checked: '?' });

export const MAP_TITLE = 'Health of your setup';
export const MAP_INTRO = "These lights don't change your score. Each one says what we found, or why we couldn't check it.";
export const FOUNDING_NOTE = 'Founding Member spots are still open. Founding Members pay once for the Verified stamp.';
const HAVE_NOT_CHECKED = "We couldn't check this on your website this time.";

/** The seven main nodes, in the design's order. */
export const MAIN_NODES = Object.freeze([
  { id: 'website', name: 'Website' },
  { id: 'ai', name: 'AI answers' },
  { id: 'google', name: 'Google profile' },
  { id: 'reviews', name: 'Reviews' },
  { id: 'details', name: 'Details match' },
  { id: 'links', name: 'Links' },
  { id: 'listing', name: 'Free listing' },
]);

/**
 * Every sub-node except the AI answers, in the design's order (design.md, "The sub-nodes"). `check` rows read the
 * existing Checks (HAVE); `path` rows read the saved signals (ADD and KEY).
 */
export const SUB_NODES = Object.freeze([
  // 1. Website
  { main: 'website', cluster: 'AI can read it', name: 'robots.txt lets AI assistants in', check: 'ai-bots-allowed', words: { pass: 'Open to AI assistants', fail: 'Blocks some AI assistants' } },
  { main: 'website', cluster: 'AI can read it', name: 'Sitemap', path: 'website.sitemap' },
  { main: 'website', cluster: 'AI can read it', name: 'Words are in the page itself', path: 'website.wordsInPage' },
  { main: 'website', cluster: 'AI can read it', name: 'Business label', check: 'business-labeled', words: { pass: 'Found', fail: 'Not found' } },
  { main: 'website', cluster: "Speaks AI's language", name: 'Says what you do', path: 'website.saysWhatYouDo' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Says where you work', path: 'website.saysWhereYouWork' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Answers common questions', path: 'website.answersQuestions' },
  { main: 'website', cluster: "Speaks AI's language", name: 'A page for each service', path: 'website.pagePerService' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Recently updated', path: 'website.recentlyUpdated' },
  { main: 'website', cluster: "Speaks AI's language", name: 'AI info sheet (llms.txt)', check: 'info-sheet', words: { pass: 'Found', fail: 'Not found' } },
  { main: 'website', cluster: 'Search basics', name: 'Title names city and service', check: 'title-city-service' },
  { main: 'website', cluster: 'Search basics', name: 'One headline', check: 'one-headline' },
  { main: 'website', cluster: 'Search basics', name: 'Summary', check: 'summary' },
  { main: 'website', cluster: 'Search basics', name: 'Image descriptions', check: 'image-descriptions' },
  { main: 'website', cluster: 'Search basics', name: 'Share picture', check: 'share-picture' },
  { main: 'website', cluster: 'Customer basics', name: 'Tap to call', check: 'tap-to-call' },
  { main: 'website', cluster: 'Customer basics', name: 'Hours on the page', check: 'hours-shown' },
  { main: 'website', cluster: 'Customer basics', name: 'Address on the page', serviceAreaName: 'Service area on the page', check: 'address-shown' },
  { main: 'website', cluster: 'Customer basics', name: 'Call button', check: 'call-button' },
  // 3. Google profile
  { main: 'google', name: 'Found on Google', path: 'google.found' },
  { main: 'google', name: 'Open for business', path: 'google.open' },
  { main: 'google', name: 'Category fits', path: 'google.category' },
  { main: 'google', name: 'Hours listed', path: 'google.hours' },
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
  { main: 'details', name: 'Your listing matches your website', path: 'listing.matchesWebsite' },
  { main: 'details', name: 'Found on Bing', path: 'bing.found' },
  { main: 'details', name: 'Details match on Bing', path: 'bing.details' },
  // 6. Links
  { main: 'links', name: 'Website links to your Google profile', path: 'links.google' },
  { main: 'links', name: 'Website links to Yelp', path: 'links.yelp' },
  { main: 'links', name: 'Google profile links to your website', path: 'google.linksToWebsite' },
  { main: 'links', name: 'Your listing links to your website', path: 'listing.linksToWebsite' },
  { main: 'links', cluster: 'Socials', name: 'Facebook', path: 'links.facebook' },
  { main: 'links', cluster: 'Socials', name: 'Instagram', path: 'links.instagram' },
  { main: 'links', cluster: 'Socials', name: 'TikTok', path: 'links.tiktok' },
  // 7. Free listing
  { main: 'listing', name: 'Listed on First Answer Pages', path: 'listing.listed' },
  { main: 'listing', name: 'Verified stamp', path: 'listing.verified' },
  { main: 'listing', name: 'Founding Member', path: 'listing.founding' },
]);

const STATUSES = new Set(['good', 'partly', 'missing', 'not_checked']);
const statusOf = s => (STATUSES.has(s) ? s : 'not_checked');

// ---- the model -----------------------------------------------------------------------------------------------------

/** A HAVE row from an existing Check result: pass, fail or not checked, in the design's words. */
function checkSub(def, result, input) {
  const name = def.serviceAreaName && input?.noStorefront === true ? def.serviceAreaName : def.name;
  const r = result?.result;
  if (r === 'pass') return { name, cluster: def.cluster ?? null, status: 'good', label: def.words?.pass ?? 'Good' };
  if (r === 'fail') return { name, cluster: def.cluster ?? null, status: 'missing', label: def.words?.fail ?? 'Needs work' };
  return { name, cluster: def.cluster ?? null, status: 'not_checked', label: 'Not checked', reason: HAVE_NOT_CHECKED };
}

/** A row from the saved signals (already in plain words, with a reason or a fix). */
function signalSub(def, row) {
  // "Founding spots still open" (status 'info') is never a health node: it is the plain note under Free listing (Q8).
  if (!row || row.status === 'info') return null;
  return {
    name: def.name,
    cluster: def.cluster ?? null,
    status: statusOf(row.status),
    label: String(row.label ?? 'Not checked'),
    ...(row.reason ? { reason: String(row.reason) } : {}),
    ...(row.fix ? { fix: String(row.fix) } : {}),
  };
}

const counted = subs => subs.filter(s => s.status !== 'not_checked');
const allGood = subs => subs.length > 0 && subs.every(s => s.status === 'good');

/** The main node's status from its sub-nodes, by the design's main status rules. */
export function mainStatus(id, subs, extra = {}) {
  const seen = counted(subs);
  if (id === 'ai') return statusOf(extra.aiStatus);
  if (seen.length === 0) return 'not_checked';
  const byName = name => subs.find(s => s.name === name);
  switch (id) {
    case 'website': {
      if (allGood(seen)) return 'good';
      const red = seen.filter(s => s.status === 'missing').length;
      return red > seen.length / 2 ? 'missing' : 'partly';
    }
    case 'google': {
      if (byName('Found on Google')?.status === 'missing') return 'missing';
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
    case 'listing': {
      const listed = byName('Listed on First Answer Pages');
      const verified = byName('Verified stamp');
      if (listed?.status === 'good' && verified?.status === 'good') return 'good';
      return 'partly';
    }
    default: // links: no link row is ever red, so the node is amber at worst
      return allGood(seen) ? 'good' : 'partly';
  }
}

/**
 * Everything the list and the map show, worked out once.
 * @param {object} grade  a finished Grade (with `results` already scored by the report)
 * @param {{ score: number|null, aiRows: Array<{ name: string, status: string, label: string, reason?: string }>,
 *           aiStatus: string, aiLabel?: string }} opts
 */
export function healthModel(grade, { score = null, aiRows = [], aiStatus = 'not_checked', aiLabel } = {}) {
  const results = new Map((Array.isArray(grade?.results) ? grade.results : []).filter(r => r && typeof r.id === 'string').map(r => [r.id, r]));
  const rows = new Map(signalRows(grade?.signals).map(r => [r.path, r]));
  const input = grade?.input ?? {};
  const mains = MAIN_NODES.map(node => {
    let subs;
    if (node.id === 'ai') {
      subs = aiRows.map(r => ({ name: r.name, cluster: null, status: statusOf(r.status), label: r.label, ...(r.reason ? { reason: r.reason } : {}) }));
    } else {
      subs = SUB_NODES.filter(d => d.main === node.id)
        .map(d => (d.check ? checkSub(d, results.get(d.check), input) : signalSub(d, rows.get(d.path))))
        .filter(Boolean);
    }
    const status = mainStatus(node.id, subs, { aiStatus });
    const label = node.id === 'ai' && status === 'good' ? 'Pass' : node.id === 'ai' && aiLabel ? aiLabel : MAIN_WORDS[status];
    const out = { id: node.id, name: node.name, status, label, subs };
    if (node.id === 'links') out.socials = socialsCluster(grade?.signals);
    if (node.id === 'listing' && grade?.signals?.listing?.founding?.status === 'info') out.note = FOUNDING_NOTE;
    return out;
  });
  return { name: String(input.name ?? ''), score: Number.isInteger(score) ? score : null, mains };
}

/** The Socials cluster's own line ("1 of 3 linked"), or "Not checked" for a report from before these signals. */
function socialsCluster(signals) {
  const s = signals?.links?.socials;
  if (!s || typeof s !== 'object') return { status: 'not_checked', label: 'Not checked' };
  return { status: statusOf(s.status), label: String(s.label ?? 'Not checked'), ...(s.fix ? { fix: String(s.fix) } : {}) };
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
  const fix = full && sub.fix ? ` <span class="health-fix"><strong>Fix:</strong> ${h(sub.fix)}</span>` : '';
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
        const fix = full && main.socials.fix ? ` <span class="health-fix"><strong>Fix:</strong> ${h(main.socials.fix)}</span>` : '';
        parts.push(`<h4 class="health-cluster health-${main.socials.status}">${sym(main.socials.status)}Socials: <span class="health-status">${h(main.socials.label)}</span>${fix}</h4>`);
      } else if (cluster) {
        parts.push(`<h4 class="health-cluster">${h(cluster)}</h4>`);
      }
    }
    list.push(rowHtml(sub, full, runNew));
  }
  flush();
  if (main.subs.length === 0) parts.push('<p class="health-why">Nothing to show here yet.</p>');
  if (main.note) parts.push(`<p class="health-note">${h(main.note)}</p>`);
  return `<div class="health-group health-${main.status}" id="health-g-${main.id}">
  <h3>${sym(main.status)}<span class="health-group-name">${h(main.name)}:</span> <span class="health-status">${h(main.label)}</span></h3>
  ${parts.join('\n  ')}
</div>`;
}

// ---- the map (decoration; every fact is in the list) ---------------------------------------------------------------

const SIZE = 1000;
const MID = SIZE / 2;
const R_ORB = 110;
const R_MAIN = 280;
const R_NODE = 58;
const R_SUB_AT = 118;
const R_SUB = 11;
const round = n => Math.round(n * 10) / 10;
const polar = (cx, cy, r, deg) => [round(cx + r * Math.cos((deg * Math.PI) / 180)), round(cy + r * Math.sin((deg * Math.PI) / 180))];

/** One link: steady dots both ways when green, slow fading dots when amber, a break when red, dashed when gray. */
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
    return `${line([x1, y1], at(0.44), `${base} health-line-missing`)}${line(at(0.56), [x2, y2], `${base} health-line-missing`)}`;
  }
  return line([x1, y1], [x2, y2], `${base} health-line-gray`);
}

/** Up to two short lines of the business name for the orb. */
function nameLines(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  const lines = [''];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if (`${cur} ${w}`.trim().length <= 16) lines[lines.length - 1] = `${cur} ${w}`.trim();
    else if (lines.length < 2) lines.push(w);
    else { lines[1] = `${lines[1]}\u2026`; break; }
  }
  return lines.map(l => (l.length > 17 ? `${l.slice(0, 16)}\u2026` : l)).filter(Boolean);
}

function mapSvg(model) {
  const parts = [];
  const n = model.mains.length;
  model.mains.forEach((main, i) => {
    const deg = -90 + (i * 360) / n;
    const pos = polar(MID, MID, R_MAIN, deg);
    parts.push(linkSvg(polar(MID, MID, R_ORB + 6, deg), polar(MID, MID, R_MAIN - R_NODE - 4, deg), main.status, 'main'));
    // The sub-nodes fan out on the outside of the main node.
    const subs = main.subs;
    const spread = subs.length > 1 ? Math.min(150, 9 * (subs.length - 1)) : 0;
    subs.forEach((sub, k) => {
      const a = subs.length > 1 ? deg - spread / 2 + (k * spread) / (subs.length - 1) : deg;
      const p = polar(pos[0], pos[1], R_SUB_AT, a);
      const st = statusOf(sub.status);
      parts.push(`<g class="health-sub health-sub-${st}">${linkSvg(polar(pos[0], pos[1], R_NODE + 3, a), polar(pos[0], pos[1], R_SUB_AT - R_SUB - 2, a), st, 'sub')}`
        + `<circle cx="${p[0]}" cy="${p[1]}" r="${R_SUB}" class="health-dot-node"/>`
        + `<text x="${p[0]}" y="${round(p[1] + 4)}" class="health-sub-sym">${SYMBOLS[st]}</text>`
        + subLabel(pos, a, st)
        + '</g>');
    });
    const st = statusOf(main.status);
    parts.push(`<a href="#health-g-${main.id}" tabindex="-1" class="health-node-link"><g class="health-node health-node-${st}">`
      + `<circle cx="${pos[0]}" cy="${pos[1]}" r="${R_NODE}" class="health-node-ring"/>`
      + `<text x="${pos[0]}" y="${round(pos[1] - 14)}" class="health-node-sym">${SYMBOLS[st]}</text>`
      + `<text x="${pos[0]}" y="${round(pos[1] + 6)}" class="health-node-name">${h(main.name)}</text>`
      + `<text x="${pos[0]}" y="${round(pos[1] + 26)}" class="health-node-status">${h(main.label)}</text>`
      + '</g></a>');
  });
  const lines = nameLines(model.name);
  const nameY = lines.length > 1 ? MID - 34 : MID - 18;
  const nameSvg = lines.map((l, i) => `<text x="${MID}" y="${nameY + i * 28}" class="health-orb-name">${h(l)}</text>`).join('');
  const scoreSvg = model.score === null
    ? `<text x="${MID}" y="${MID + 40}" class="health-orb-score health-orb-score-none">Health: not scored yet</text>`
    : `<text x="${MID}" y="${MID + 46}" class="health-orb-score">Health ${model.score}</text>`;
  return `<svg class="health-svg" viewBox="0 0 ${SIZE} ${SIZE}" role="presentation" focusable="false" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="health-orb-glow" cx="50%" cy="45%" r="60%"><stop offset="0%" stop-color="#7ef3ff" stop-opacity="0.55"/><stop offset="60%" stop-color="#1e6f8f" stop-opacity="0.35"/><stop offset="100%" stop-color="#0b1020" stop-opacity="0"/></radialGradient></defs>
  ${parts.join('\n  ')}
  <circle cx="${MID}" cy="${MID}" r="${R_ORB + 40}" class="health-orb-halo"/>
  <circle cx="${MID}" cy="${MID}" r="${R_ORB}" class="health-orb"/>
  ${nameSvg}${scoreSvg}
</svg>`;
}

/** The short status word next to a sub-node, along its spoke, never upside down. */
function subLabel(pos, deg, status) {
  const norm = ((deg % 360) + 360) % 360;
  const left = norm > 90 && norm < 270;
  const [x, y] = polar(pos[0], pos[1], R_SUB_AT + R_SUB + 5, deg);
  const rot = left ? deg + 180 : deg;
  return `<text x="${x}" y="${y}" transform="rotate(${round(rot)} ${x} ${y})" class="health-sub-word" text-anchor="${left ? 'end' : 'start'}" dominant-baseline="middle">${SUB_WORDS[status]}</text>`;
}

// ---- the whole section ---------------------------------------------------------------------------------------------

/**
 * The health map section: the plain list first, then the map. The fix sentences show only in the full report.
 * @param {ReturnType<typeof healthModel>} model
 * @param {{ full?: boolean, runNew?: (text: string) => string }} [opts] `runNew` gives the report's own
 *   "Run a new check" link (trusted HTML), so every mention of it in a reason is a link.
 */
export function healthMapHtml(model, { full = false, runNew } = {}) {
  return `<section class="health" aria-labelledby="health-title">
  <h2 id="health-title">${MAP_TITLE}</h2>
  <p class="hint health-intro">${h(MAP_INTRO)}</p>
  <div class="health-layout">
    <div class="health-list">
${model.mains.map(m => groupHtml(m, full, runNew)).join('\n')}
    </div>
    <div class="health-map" aria-hidden="true">
      <div class="health-orb-host" data-health-orb></div>
      ${mapSvg(model)}
    </div>
  </div>
</section>`;
}
