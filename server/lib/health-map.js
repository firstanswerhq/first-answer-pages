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
import { addressParts } from './health-compare.js';

// ---- the words -----------------------------------------------------------------------------------------------------

/** A main node's status words. The AI answers node uses the report's own row word "Pass" for green. */
export const MAIN_WORDS = Object.freeze({ good: 'Good', partly: 'Partly', missing: 'Needs work', not_checked: 'Not checked' });

/** A symbol per status, so color is never the only cue. 'info' is the free listing: plain information. */
export const SYMBOLS = Object.freeze({ good: '\u2713', partly: '!', missing: '\u2715', not_checked: '?', info: 'i' });

export const MAP_TITLE = 'Health of your setup';
// Step 2 reader review H1: say what the colors are; the score is named the same way as at the top of the page.
// J10 ("partway", "yellow") and J4/W7 (the "i" of the free listing is explained).
// Batch 5 K19: about the reader, not about us.
export const MAP_INTRO = "Every check we ran, at a glance. Green is good, yellow is partway there, red needs work, gray means we couldn't check it. i = about your free listing, not part of your health.";
/** Batch 6 item 2: the intro without the free listing line, for a report with no Free listing group. */
export const MAP_INTRO_NO_LISTING = "Every check we ran, at a glance. Green is good, yellow is partway there, red needs work, gray means we couldn't check it.";
export const CLICK_HINT = 'Click a circle to see its checks.';
/** Shown under the "Speaks AI's language" cluster heading, so the reader knows where it counts (J6, K19: no "yet"). */
export const SPEAKS_NOTE = "These checks don't count toward your score.";
/** Batch 5 K9: the first Website cluster. */
export const BASICS_CLUSTER = 'Website basics';
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
  // 1. Website. "Website basics" (Requirement 12; named "Website is reachable" before batch 5 K9) comes first:
  // nothing else works if the site doesn't open.
  { main: 'website', cluster: BASICS_CLUSTER, name: 'Security certificate', path: 'website.certificate' },
  { main: 'website', cluster: BASICS_CLUSTER, name: 'Website address works', path: 'website.addressWorks', words: { Works: 'Yes' } },
  { main: 'website', cluster: 'Can AI read your website', name: 'Your website lets AI assistants read it (robots.txt)', check: 'ai-bots-allowed', words: { pass: 'Yes', fail: 'No, it blocks some' } },
  { main: 'website', cluster: 'Can AI read your website', name: 'Page list for search engines (sitemap)', path: 'website.sitemap' },
  { main: 'website', cluster: 'Can AI read your website', name: 'Text AI can read', path: 'website.wordsInPage', words: { 'Found in the page': 'Yes' } },
  { main: 'website', cluster: 'Can AI read your website', name: 'Name, phone and address tagged for AI (business label)', check: 'business-labeled', words: { pass: 'Found', fail: 'Not found' } },
  // The info file counts in "Can AI read your website" in Score by area, so it sits there (J6; was "Speaks AI's language").
  { main: 'website', cluster: 'Can AI read your website', name: 'A short info file for AI (llms.txt)', check: 'info-sheet', words: { pass: 'Found', fail: 'Not found' } },
  { main: 'website', cluster: "Speaks AI's language", name: 'Says what you do', path: 'website.saysWhatYouDo' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Says where you work', path: 'website.saysWhereYouWork' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Answers common questions', path: 'website.answersQuestions' },
  { main: 'website', cluster: "Speaks AI's language", name: 'A page for each service', path: 'website.pagePerService' },
  { main: 'website', cluster: "Speaks AI's language", name: 'Updated in the last 12 months', path: 'website.recentlyUpdated', words: { 'Updated in the last 12 months': 'Yes', 'Sitemap dates over a year old': 'Not by its sitemap dates' } },
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
  { main: 'google', name: 'Open for business', path: 'google.open', words: { Open: 'Yes' } },
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
  { main: 'details', name: 'On Bing Maps', path: 'bing.found', words: { 'Found on Bing': 'Yes', 'Not found in Bing map data': 'Not on Bing Maps yet' } },
  { main: 'details', name: 'Details match on Bing', path: 'bing.details' },
  // 6. Links
  { main: 'links', name: 'Website links to your Google profile', path: 'links.google', words: { 'Linked from your website': 'Linked' } },
  { main: 'links', name: 'Website links to Yelp', path: 'links.yelp', words: { 'Linked from your website': 'Linked' } },
  { main: 'links', name: 'Google links to your site', path: 'google.linksToWebsite', words: { 'Links to your website': 'Yes', "Doesn't link to your website": 'No' } },
  { main: 'links', cluster: 'Socials', name: 'Facebook', path: 'links.facebook', words: { 'Linked from your website': 'Linked' } },
  { main: 'links', cluster: 'Socials', name: 'Instagram', path: 'links.instagram', words: { 'Linked from your website': 'Linked' } },
  { main: 'links', cluster: 'Socials', name: 'TikTok', path: 'links.tiktok', words: { 'Linked from your website': 'Linked' } },
  // 7. Free listing (information, not health). The two listing rows moved here from Details match and Links (J4, W4).
  { main: 'listing', name: 'Listed on First Answer Pages', path: 'listing.listed' },
  { main: 'listing', name: 'Verified stamp', path: 'listing.verified' },
  { main: 'listing', name: 'Listing matches your website', path: 'listing.matchesWebsite' },
  { main: 'listing', name: 'Listing links to your website', path: 'listing.linksToWebsite' },
  { main: 'listing', name: 'Founding Member', path: 'listing.founding' },
]);

/** Plain notes under a cluster heading. */
const CLUSTER_NOTES = Object.freeze({ "Speaks AI's language": SPEAKS_NOTE });

const STATUSES = new Set(['good', 'partly', 'missing', 'not_checked', 'info']);
const statusOf = s => (STATUSES.has(s) ? s : 'not_checked');

// ---- the model -----------------------------------------------------------------------------------------------------

/** A HAVE row from an existing Check result: pass, fail or not checked, in the design's words. */
/** A sentence ends with a period (W9: "No website given" sits next to "No website given."). */
const sentence = text => String(text).trim().replace(/([^.!?])$/, '$1.');

export const ADDRESS_ONE_LINE = 'Write your full street address on one line, like "123 Main St, Nashville, TN 37201", so we can compare it with Google.';
export const PHONE_AS_TEXT = "We saw a tap-to-call link but couldn't read the number. Write the number as plain text too.";

/**
 * The tip for a Check that passed but whose details could not all be read (J1, J2, batch 5 K2): the health map row and
 * the score card show the same words. Null when there is nothing to add.
 */
export function checkTip(id, input, found) {
  if (!found) return null;
  const storefront = input?.noStorefront !== true;
  if (id === 'address-shown' && storefront && !addressParts(found.address)) {
    return { label: 'Found, but not on one line', reason: ADDRESS_ONE_LINE };
  }
  if (id === 'tap-to-call' && !found.phone) return { label: 'Found a link, but not the number', reason: PHONE_AS_TEXT };
  return null;
}

/**
 * Batch 5 K10: one name per check on the whole report (health map, score cards, "Fix these first", fix kit, CSV): the
 * health map's plain name, with the technical term in brackets. The service-area name for a business with no
 * storefront. Null for a check the map doesn't show (the caller keeps its own label).
 */
/** Batch 6 item 7a: the names of the health rows that show a Check (the CSV has a "check" row for each of those). */
export const CHECK_ROW_NAMES = Object.freeze(new Set(SUB_NODES.filter(d => d.check).flatMap(d => [d.name, d.serviceAreaName].filter(Boolean))));
/** Batch 6 fix B: the Check id each of those rows shows (both names of the address row lead to the same id). */
export const CHECK_ROW_IDS = Object.freeze(new Map(SUB_NODES.filter(d => d.check)
  .flatMap(d => [d.name, d.serviceAreaName].filter(Boolean).map(n => [n, d.check]))));

export function checkName(id, input) {
  const def = SUB_NODES.find(d => d.check === id);
  if (!def) return null;
  return def.serviceAreaName && input?.noStorefront === true ? def.serviceAreaName : def.name;
}

function checkSub(def, result, input, found) {
  const storefront = input?.noStorefront !== true;
  const name = def.serviceAreaName && !storefront ? def.serviceAreaName : def.name;
  const base = { name, cluster: def.cluster ?? null };
  const r = result?.result;
  if (r === 'pass') {
    // The same facts the listing card uses (J1, J2): "Good" only when what the page shows could also be read.
    // Batch 6 item 4: never a green mark next to "but". A check that passed but whose details could not be read is
    // "partly" here, and its score card says "Partly" with the same tip (checkTip). The points don't change.
    const tip = checkTip(def.check, input, found);
    if (tip) return { ...base, status: 'partly', label: tip.label, reason: tip.reason };
    return { ...base, status: 'good', label: def.words?.pass ?? 'Good' };
  }
  if (r === 'fail') return { ...base, status: 'missing', label: def.words?.fail ?? 'Needs work' };
  // The check's own plain reason, the same one the full list of checks shows (Step 2 review V9).
  const reason = typeof result?.detail === 'string' && result.detail.trim() !== '' ? sentence(result.detail) : HAVE_NOT_CHECKED;
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
function listingSub(def, row, old, notListed, agency = false) {
  if (!row || row.status === 'info') return null;
  // A report from before these checks: gray "Not checked", like every other row of it (W7).
  if (old) return { name: def.name, cluster: null, status: 'not_checked', label: 'Not checked', reason: OLD_REPORT_SHORT };
  const base = { name: def.name, cluster: null, status: 'info' };
  const unsure = (reason = row.reason) => ({ ...base, label: 'Not checked', ...(reason ? { reason: String(reason) } : {}) });
  switch (def.path) {
    case 'listing.listed':
      if (row.status === 'good') return { ...base, label: 'Yes' }; // W5: never "Listed: Listed"
      // Batch 5 K4: an agency's report (Prepared by) has no "claim it below" line.
      if (row.needsClaim) return { ...base, label: agency ? 'Not yet' : "Not yet. It's free, claim it below." };
      return unsure();
    case 'listing.verified':
      if (row.status === 'good') return { ...base, label: 'Yes' };
      if (row.status === 'partly') return { ...base, label: 'Not yet' };
      if (notListed) return { ...base, label: agency ? 'No listing yet' : 'Available after you claim your listing.' };
      return unsure();
    case 'listing.matchesWebsite':
    case 'listing.linksToWebsite': {
      // Nothing to check before there is a listing: never a gray "couldn't check" (J4, W4).
      if (notListed) return { ...base, label: agency ? 'No listing yet' : 'After you claim your listing.' };
      if (row.status === 'not_checked') return unsure();
      const words = { Matches: 'Yes', "Doesn't match": "Doesn't match", Linked: 'Yes', 'No website on the listing': 'No website on the listing' };
      return { ...base, label: words[row.label] ?? String(row.label ?? '') };
    }
    default: // Founding Member (W5: never "Founding Member: Founding Member")
      return { ...base, label: Number.isInteger(row.number) ? `Yes, member No. ${row.number}` : 'Yes' };
  }
}

const counted = subs => subs.filter(s => s.status !== 'not_checked' && s.status !== 'info');
const allGood = subs => subs.length > 0 && subs.every(s => s.status === 'good');

/** The main node's status from its sub-nodes, by the design's main status rules. */
export function mainStatus(id, subs, extra = {}) {
  if (id === 'ai') return statusOf(extra.aiStatus);
  // Information, never a health color; gray on a report from before these checks, like the rest of it (W7).
  if (id === 'listing') return extra.old ? 'not_checked' : 'info';
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
  if (listed === 'Yes') return verified === 'Yes' ? 'Verified' : 'Listed';
  if (listed && listed.startsWith('Not yet')) return 'Not started';
  return 'Not sure';
}

/**
 * Everything the list and the map show, worked out once.
 * @param {object} grade  a finished Grade (with `results` already scored by the report)
 * @param {{ score: number|null, aiRows: Array<{ name: string, status: string, label: string }>, aiStatus: string,
 *           aiReason?: string }} opts  `aiReason` is the one line shown when there is no answer (H5)
 */
export function healthModel(grade, { score = null, aiRows = [], aiStatus = 'not_checked', aiReason, found, agency = false } = {}) {
  const results = new Map((Array.isArray(grade?.results) ? grade.results : []).filter(r => r && typeof r.id === 'string').map(r => [r.id, r]));
  const old = !grade?.signals || typeof grade.signals !== 'object';
  const rows = new Map(signalRows(old ? undefined : grade.signals).map(r => [r.path, r]));
  const notListed = rows.get('listing.listed')?.needsClaim === true;
  const input = grade?.input ?? {};
  // Batch 6 item 2: an agency's report (Prepared by) has no Free listing group at all: no bubble, no rows, no note.
  const mains = MAIN_NODES.filter(node => !(agency && node.id === 'listing')).map(node => {
    let subs;
    if (node.id === 'ai') {
      subs = aiRows.map(r => ({ name: r.name, cluster: null, status: statusOf(r.status), label: r.label }));
    } else {
      subs = SUB_NODES.filter(d => d.main === node.id)
        .map(d => {
          if (d.check) return checkSub(d, results.get(d.check), input, found);
          if (node.id === 'listing') return listingSub(d, rows.get(d.path), old, notListed, agency);
          return signalSub(d, rows.get(d.path), old);
        })
        .filter(Boolean);
    }
    const status = mainStatus(node.id, subs, { aiStatus, old });
    let label = MAIN_WORDS[status];
    if (node.id === 'ai' && status === 'good') label = 'Pass';
    // J10: with several answers the AI circle says how many named the business ("2 of 3"), like "Socials: 1 of 3".
    if (node.id === 'ai' && subs.length > 1) label = `${subs.filter(s => s.status === 'good').length} of ${subs.length}`;
    if (node.id === 'listing') label = listingLabel(subs, old);
    const out = { id: node.id, name: node.name, lines: node.lines, status, label, subs };
    if (node.id === 'ai' && subs.length === 0 && aiReason) out.reason = String(aiReason);
    if (node.id === 'links') out.socials = socialsCluster(old ? undefined : grade.signals);
    // K4: no Founding Member pitch on an agency's report.
    if (node.id === 'listing' && !old && !agency && grade.signals?.listing?.founding?.status === 'info') out.note = FOUNDING_NOTE;
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
        if (CLUSTER_NOTES[cluster]) parts.push(`<p class="health-why">${h(CLUSTER_NOTES[cluster])}</p>`);
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
  // W3: the real narrowest widths: 530 px for the wide drawing (two columns from 960 px), 323 px for the phone drawing
  // on a 360 px screen (the common Android width).
  full: { view: 1000, minShownPx: 530, rMain: 280, rNode: 86, nameFont: 24, statusFont: 24, symbolFont: 26, orbFont: 24 },
  // Phone words at 27 units are 12.5 px at 323 px (26 was 11.997 px, just under 12); radius 96 fits "Not checked".
  phone: { view: 700, minShownPx: 323, rMain: 253, rNode: 96, nameFont: 27, statusFont: 27, symbolFont: 28, orbFont: 27 },
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
    + `<title>${h(main.name)}: ${h(main.label)}</title>`
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
  // W10: with no score, the same words as the top of the page ("Not enough to score yet"), on two lines.
  const scoreSvg = model.score === null
    ? `<text class="health-orb-score health-orb-score-none"><tspan x="${MID}" y="${MID + 30}">Not enough</tspan><tspan x="${MID}" y="${MID + 58}">to score yet</tspan></text>`
    : `<text x="${MID}" y="${MID + 38}" class="health-orb-score" data-score="${model.score}">Score ${model.score}/100</text>`;
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
    // One group per main node, so the one-time scan (2.10) can light it up as a whole.
    parts.push(`<g class="health-branch" data-main="${main.id}">`);
    parts.push(linkSvg(polar(MID, MID, R_ORB + 6, deg), polar(MID, MID, sz.rMain - sz.rNode - 4, deg), main.status, 'main'));
    const subs = main.subs;
    const spread = subs.length > 1 ? Math.min(150, 9 * (subs.length - 1)) : 0;
    subs.forEach((sub, k) => {
      const a = subs.length > 1 ? deg - spread / 2 + (k * spread) / (subs.length - 1) : deg;
      const p = polar(pos[0], pos[1], R_SUB_AT, a);
      const st = statusOf(sub.status);
      // J5: the check's name and status on hover, the same words as its row in the list.
      parts.push(`<g class="health-sub health-sub-${st}"><title>${h(sub.name)}: ${h(sub.label)}</title>${linkSvg(polar(pos[0], pos[1], sz.rNode + 3, a), polar(pos[0], pos[1], R_SUB_AT - R_SUB - 2, a), st, 'sub')}`
        + `<circle cx="${p[0]}" cy="${p[1]}" r="${R_SUB}" class="health-dot-node"/>`
        + `<text x="${p[0]}" y="${round(p[1] + 7)}" class="health-sub-sym">${SYMBOLS[st]}</text>`
        + '</g>');
    });
    parts.push(mainNodeSvg(main, pos, sz));
    parts.push('</g>');
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
    parts.push(`<g class="health-branch" data-main="${main.id}">`);
    parts.push(linkSvg(polar(MID, MID, R_ORB + 6, deg), polar(MID, MID, sz.rMain - sz.rNode - 4, deg), main.status, 'main'));
    parts.push(mainNodeSvg(main, pos, sz));
    parts.push('</g>');
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
export function healthMapHtml(model, { full = false, runNew, mapFirst = false } = {}) {
  // A report from before these checks: one line with the link, not the same link on every row (Step 2 review V10).
  const oldNote = model.old ? `\n  <p class="health-note health-old">${reasonHtml(OLD_REPORT_NOTE, runNew)}</p>` : '';
  const list = `    <div class="health-list">
${model.mains.map(m => groupHtml(m, full, runNew)).join('\n')}
    </div>`;
  const map = mapHtml(model);
  // On screen the list comes first in the page (read first by screen readers and search tools; CSS shows the map
  // beside or above it). The print page asks for the map first (`mapFirst`), so on paper it sits right under the score
  // box with no page break before it (batch 6 fix C): Chrome doesn't move a map kept whole inside a flex layout well.
  return `<section class="health" aria-labelledby="health-title">
  <h2 id="health-title">${MAP_TITLE}</h2>
  <p class="hint health-intro">${h(model.mains.some(m => m.id === 'listing') ? MAP_INTRO : MAP_INTRO_NO_LISTING)}</p>${oldNote}
  <div class="health-layout">
${mapFirst ? `${map}\n${list}` : `${list}\n${map}`}
  </div>
</section>`;
}

/** The map part of the section (decoration, aria-hidden). */
function mapHtml(model) {
  return `    <div class="health-map" id="health-map" aria-hidden="true">
      <div class="health-art">
        <div class="health-orb-host" data-health-orb></div>
        ${fullSvg(model)}
        ${phoneSvg(model)}
      </div>
      <p class="health-caption" aria-hidden="true" data-health-caption></p>
      <p class="health-tap">${h(TAP_HINT)}</p>
      <p class="health-click">${h(CLICK_HINT)}</p>
    </div>`;
}
