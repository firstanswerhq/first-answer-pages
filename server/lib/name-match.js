/**
 * name-match.js — does an AI answer name the business, and who else did it name?
 *
 * Matching is done on normalized text padded with spaces, so "ace plumbing"
 * does not match "space plumbing". Answer text is untrusted data: nothing here
 * follows links or runs anything found in it.
 */

import { normalizeForMatch } from './seance.js';

const LEGAL_WORDS = new Set([
  'llc', 'inc', 'incorporated', 'co', 'company', 'corp', 'corporation', 'ltd', 'pllc', 'pc', 'lp',
]);

/** Words that describe the trade, not the business, so they can't identify it alone. */
const GENERIC_WORDS = new Set([
  'the', 'and', 'of', 'a', 'an', 'services', 'service', 'solutions', 'group', 'pros', 'pro',
  'roofing', 'roofer', 'roofers', 'plumbing', 'plumber', 'plumbers', 'electric', 'electrical',
  'electrician', 'electricians', 'hvac', 'heating', 'cooling', 'air', 'repair', 'repairs',
  'cleaning', 'landscaping', 'lawn', 'construction', 'contractor', 'contractors', 'auto',
  'restaurant', 'salon', 'home', 'house', 'general', 'local', 'best', 'quality',
]);

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac']);

/**
 * @param {string} name
 * @param {{ service?: string, city?: string, state?: string }} [context]
 * @returns {string|null} the name without a leading "the" and legal endings, or null when too weak to match on
 */
export function shortName(name, { service = '', city = '', state = '' } = {}) {
  let words = normalizeForMatch(name).split(' ').filter(Boolean);
  if (words[0] === 'the') words = words.slice(1);
  for (;;) {
    const n = words.length;
    if (n >= 3 && words.slice(-3).join(' ') === 'l l c') { words = words.slice(0, -3); continue; }
    if (n >= 1 && LEGAL_WORDS.has(words[n - 1])) { words = words.slice(0, -1); continue; }
    break;
  }
  if (words.length === 0) return null;
  const text = words.join(' ');
  if (words.length < 2 && text.length < 6) return null;
  const context = new Set(
    [service, city, state].flatMap(v => normalizeForMatch(v).split(' ')).filter(Boolean),
  );
  if (words.every(w => GENERIC_WORDS.has(w) || context.has(w))) return null;
  return text;
}

/**
 * The distinctive words before the trade words: "Hiller Plumbing, Heating, Cooling &
 * Electrical" -> "hiller", "Benjamin Franklin Plumbing" -> "benjamin franklin".
 * Only used when it is at least 2 words or 6 letters, so short words never match.
 */
export function coreName(name, context = new Set()) {
  let words = normalizeForMatch(name).split(' ').filter(Boolean);
  if (words[0] === 'the') words = words.slice(1);
  const core = [];
  for (const w of words) {
    if (GENERIC_WORDS.has(w) || LEGAL_WORDS.has(w) || context.has(w)) break;
    core.push(w);
  }
  if (core.length === 0 || core.length === words.length) return '';
  const text = core.join(' ');
  if (core.length < 2 && text.length < 6) return '';
  return text;
}

/** Edit distance between two short words (insert, delete, change one letter). */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The first word that identifies the business (not "the", a trade word, a legal ending or the city). */
function firstDistinctive(name, context) {
  return normalizeForMatch(name).split(' ').filter(Boolean)
    .find(w => !GENERIC_WORDS.has(w) && !LEGAL_WORDS.has(w) && !context.has(w) && w.length >= 2) ?? '';
}

/**
 * A sanity limit for "same business" answers from outside: the two names must start with
 * the same identifying word, give or take a typo ("Acee Acounting" and "Ace Accounting").
 */
export function looksLikeSameName(candidate, business) {
  const context = new Set([business?.city, business?.state].flatMap(v => normalizeForMatch(v ?? '').split(' ')).filter(Boolean));
  const a = firstDistinctive(candidate, context);
  const b = firstDistinctive(business?.name ?? '', context);
  if (!a || !b) return false;
  if (a === b) return true;
  const longest = Math.max(a.length, b.length);
  if (longest > 40) return false;
  return editDistance(a, b) <= (longest >= 7 ? 2 : 1);
}

/** Host without "www.", cut to the registered domain ("example.co.uk" stays three labels). */
export function registeredDomain(website) {
  if (typeof website !== 'string' || website.trim() === '') return '';
  let host;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`).hostname;
  } catch {
    return '';
  }
  host = host.toLowerCase().replace(/^www\./, '');
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return '';
  const take = labels.length >= 3 && labels[labels.length - 1].length === 2 && SECOND_LEVEL.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/**
 * @param {string} answer
 * @param {{ name: string, website?: string|null, service?: string, city?: string, state?: string }} business
 * @returns {boolean}
 */
export function isNamed(answer, business, { allowGeneric = false } = {}) {
  const haystack = ` ${normalizeForMatch(answer)} `;
  // A name made only of trade words ("Best Roofers") also turns up in the AI's own
  // sentences, so in running text it does not count. In a list line it does.
  const full = normalizeForMatch(business?.name);
  const context = new Set(
    [business?.service, business?.city, business?.state].flatMap(v => normalizeForMatch(v ?? '').split(' ')).filter(Boolean),
  );
  const fullWords = full.split(' ').filter(Boolean);
  const fullIsGeneric = fullWords.length > 0 && fullWords.every(w => GENERIC_WORDS.has(w) || context.has(w));
  const candidates = [
    fullIsGeneric && !allowGeneric ? '' : full,
    shortName(business?.name, business ?? {}) ?? '',
    normalizeForMatch(registeredDomain(business?.website)),
  ];
  if (candidates.some(c => c !== '' && haystack.includes(` ${c} `))) return true;
  // The core name ("Hiller") only counts against a single listed name, never running
  // text, and only when the listed name starts with it and every other word comes
  // from the business's own name ("Hiller Plumbing" yes, "Johnson Controls" no).
  if (!allowGeneric) return false;
  const core = coreName(business?.name, context);
  if (core === '') return false;
  const listed = normalizeForMatch(answer);
  if (listed !== core && !listed.startsWith(`${core} `)) return false;
  const own = new Set([...fullWords, ...context, 'of', 'the', 'and']);
  return listed.slice(core.length).split(' ').filter(Boolean).every(w => own.has(w) || LEGAL_WORDS.has(w));
}

// ---- Reading the answer's list ------------------------------------------------

const LIST_LINE = /^\s*(?:\d{1,3}[.)]|[-*\u2022])\s+(.*)$/;
const LABEL_WORDS = new Set([
  'phone', 'address', 'website', 'hours', 'rating', 'reviews', 'review', 'services', 'why', 'note', 'tip',
  'pros', 'cons', 'location', 'contact', 'email', 'specialty', 'specialties', 'known for', 'summary',
  'tips', 'notes', 'what to look for', 'service area', 'years in business',
  // Section headings AI answers use (never business names).
  'caveats', 'caveat', 'also worth a look', 'also worth considering', 'worth considering', 'also consider',
  'honorable mentions', 'honorable mention', 'other options', 'other good options', 'top picks', 'my top picks',
  'top recommendations', 'recommendations', 'bottom line', 'final thoughts', 'how to choose', 'before you hire',
  'things to consider', 'quick tips', 'sources', 'disclaimer', 'a few caveats', 'good to know', 'keep in mind',
  'top 5', 'top five', 'the list', 'my picks', 'best overall', 'how i picked these', 'methodology',
  'company', 'business', 'name', 'provider', 'plumber', 'contractor',
  'best for', 'good for', 'ideal for', 'price range', 'price', 'cost', 'pricing', 'availability',
  'why we like it', 'why it stands out', 'feature', 'category', 'criteria',
  // Review sites and big-box stores are sources, not competitors.
  'google', 'google reviews', 'google maps', 'yelp', 'bbb', 'better business bureau', 'angi', 'angie s list',
  'nextdoor', 'thumbtack', 'homeadvisor', 'home advisor', 'home depot', 'lowe s', 'facebook', 'consumeraffairs',
  'consumer affairs', 'expertise com', 'reddit', 'yahoo', 'cityvetted', 'threebestrated', 'three best rated',
]);


// A nested list line with any of these is a detail about a business, not a name.
const DETAIL_PATTERN = /\b(?:licensed|insured|bonded|family[- ]owned|locally[- ]owned|veteran[- ]owned|woman[- ]owned|years?|since|reviews?|rated|rating|stars?|estimates?|24\/7|available|same[- ]day|warranty|guarantee[ds]?|financing|phone|hours|serves?|serving|known|specializ\w*|offers?|prices?|pricing|experienced)\b|\$|\d{3}/i;

// A name ending in one of these is a business ("5 Star Plumbing", "24/7 Plumbing Pros").
const BUSINESS_END = /\b(?:plumbing|plumbers?|roofing|roofers?|electric(?:al)?|electricians?|hvac|heating|cooling|air|drains?|rooter|sewer|pros?|services?|solutions|company|co|inc|llc|ltd|corp|group|contractors?|construction|cleaning|cleaners|landscaping|lawn|repairs?|restoration|remodeling|builders|painting|pest|control|movers|moving|salon|spa|auto|garage)\.?$/i;

const STRONG_TRADE = /\b(?:plumbing|plumbers?|roofing|roofers?|electric(?:al)?|electricians?|hvac|heating|cooling|conditioning|air|drains?|rooter|sewer|locksmiths?|handyman|garage|windows?|doors?|landscaping|lawn|pest|painting|remodeling|restoration|construction|contractors?|cleaning|cleaners|movers|moving|salon|auto)\b/i;
const SMALL_WORDS = new Set(['of', 'and', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', '&']);

/** Every word of 3+ letters starts with a capital or a digit ("Same Day Plumbing", "24/7 Locksmith"). */
function isTitleCase(name) {
  return name.split(/\s+/).every(w => SMALL_WORDS.has(w.toLowerCase()) || !/^\p{L}{3}/u.test(w) || /^\p{Lu}/u.test(w));
}

/**
 * True when a nested list line reads like a detail ("Licensed and insured"),
 * not a business name. Only the name part (before " - ", ":" or "(") is judged;
 * a line that starts with a bold name or a link is always a name.
 */
function looksLikeDetail(raw) {
  const trimmed = String(raw).trim();
  if (/^\*\*[^*]+\*\*/.test(trimmed) || /^\[[^\]]+\]\(/.test(trimmed)) return false;
  const name = beforeSeparator(stripMarkdown(trimmed));
  if (name === '') return true;
  // A Title Case name with a trade word anywhere is a business ("Same Day Plumbing",
  // "One Hour Heating & Air Conditioning of Nashville", "24/7 Locksmith Nashville").
  if (STRONG_TRADE.test(name) && isTitleCase(name)) return false;
  // Phrases that open a detail even when they end in "service" ("Same-day service").
  if (/^(?:same[- ]day|free|licensed|insured|bonded|over|family|locally|veteran|woman|fully|offers?|serves?|serving|available|specializ\w*)\b/i.test(name)) return true;
  if (BUSINESS_END.test(name)) return false;
  if (/^\p{Ll}/u.test(name)) return true;
  if (name.split(/\s+/).length > 6) return true;
  return DETAIL_PATTERN.test(name);
}

function stripMarkdown(text) {
  return text
    .replace(/\[([^\]]{0,200})\]\([^)]{0,500}\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .trim();
}

function beforeSeparator(text, { words = false } = {}) {
  let cut = text.length;
  // " is ", " has " ... end a name only in plain text ("Honest Plumbing is a good pick");
  // inside a bold span or link the whole span is the name ("**Time is Money Plumbing**").
  const seps = [' - ', ' \u2013 ', ' \u2014 ', ':', '(', ' | '];
  if (words) seps.push(' is ', ' has ', ' was ', ' offers ');
  for (const sep of seps) {
    const i = text.indexOf(sep);
    if (i !== -1 && i < cut) cut = i;
  }
  return text.slice(0, cut).trim();
}

function acceptable(candidate) {
  const chars = Array.from(candidate);
  if (chars.length < 2 || chars.length > 60) return false;
  if (!/^[\p{L}\p{N}]/u.test(candidate)) return false;
  if (candidate.split(/\s+/).length > 8) return false;
  return !LABEL_WORDS.has(normalizeForMatch(candidate));
}

/** The name part of a list item: its leading bold span or link text when it has one. */
function leadingName(raw) {
  const text = String(raw).trim();
  const bold = /^\*{2,3}([^*\n]{1,120})\*{2,3}(.*)$/.exec(text);
  // "**Acme Plumbing** - desc" -> the bold span; "**Acme** Plumbing & Drain" -> the whole line.
  if (bold && /^(?:$|\s*[-\u2013\u2014:,(.|]|\s+(?:is|has|was|offers|are)\b)/.test(bold[2])) return bold[1];
  const link = /^\[([^\]]{1,120})\]\(/.exec(text);
  if (link) return link[1];
  return text;
}

// Advice lines that open with a verb ("Check licensing", "Get multiple quotes") are tips, not businesses.
const TIP_START = /^(?:check|ask|get|read|call|compare|look|verify|make|avoid|confirm|request|choose|consider|search|find|don't|never|always|watch|beware|expect|schedule)\b/i;
function isTip(candidate) {
  return TIP_START.test(candidate) && !BUSINESS_END.test(candidate) && !STRONG_TRADE.test(candidate.split(/\s+/).slice(-1)[0] ?? '');
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const NAME_HEADER = /\b(?:name|company|companies|business(?:es)?|plumbers?|roofers?|electricians?|contractors?|providers?|pick|shop)\b/i;

/** Business names from a markdown table: the column headed like a name, else the first non-number column. */
function tableNames(rows) {
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  let body = rows;
  let header = null;
  if (rows.length >= 2 && TABLE_RULE.test(rows[1])) {
    header = cells(rows[0]);
    body = rows.slice(2);
  }
  body = body.filter(r => !TABLE_RULE.test(r)).map(cells);
  if (body.length === 0) return [];
  const width = Math.max(...body.map(r => r.length));
  let col = header ? header.findIndex(h => NAME_HEADER.test(stripMarkdown(h))) : -1;
  // A headed table with no name column is a cost or comparison table ("| Service | Typical cost |").
  if (col === -1 && header) return [];
  if (col === -1) {
    const isNumberish = c => /^[#\d.)\s$%/*:-]*$/.test(stripMarkdown(c));
    for (let k = 0; k < width && col === -1; k += 1) {
      if (body.filter(r => r[k] !== undefined && !isNumberish(r[k])).length >= Math.ceil(body.length / 2)) col = k;
    }
  }
  if (col === -1) return [];
  return body.map(r => r[col]).filter(c => c !== undefined && c !== '');
}

/** Every name in the answer's list lines and bold spans, in order, without duplicates. */
export function listedNames(answer) {
  const names = [];
  const seen = new Set();
  const add = raw => {
    const lead = leadingName(raw);
    const marked = lead !== String(raw).trim();
    const candidate = beforeSeparator(stripMarkdown(lead), { words: !marked && !/^\*|^\[/.test(String(raw).trim()) })
      .replace(/^\d{1,3}[.)]\s+/, '');
    if (isTip(candidate)) return;
    if (!acceptable(candidate)) return;
    const key = normalizeForMatch(candidate);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    names.push(candidate);
  };
  // Indent of the first list line in the current list. A deeper line that reads
  // like a detail ("   - Licensed and insured") is skipped; a deeper line that
  // reads like a name (businesses grouped under "Best value:" or a neighborhood)
  // still counts.
  let baseIndent = null;
  const indentOf = line => /^[ \t]*/.exec(line)[0].replace(/\t/g, '    ').length;
  const lines = String(answer ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // Markdown table: read the whole block and take names from its name column.
    if (TABLE_ROW.test(line)) {
      let j = i;
      while (j < lines.length && TABLE_ROW.test(lines[j])) j += 1;
      for (const name of tableNames(lines.slice(i, j))) add(name);
      i = j - 1;
      baseIndent = null;
      continue;
    }
    // "### 1. Frog Heating, Air & Plumbing": a numbered markdown heading is a list item.
    const heading = /^\s*#{1,6}\s+(\d{1,3}[.)]\s+.*)$/.exec(line);
    const list = LIST_LINE.exec(heading ? heading[1] : line);
    if (list) {
      const indent = indentOf(line);
      if (baseIndent === null || indent < baseIndent) baseIndent = indent;
      if (indent > baseIndent && looksLikeDetail(list[1])) continue;
      add(list[1]);
      continue;
    }
    // Prose indented under a list item stays part of that item.
    if (line.trim() !== '' && (baseIndent === null || indentOf(line) <= baseIndent)) baseIndent = null;
    // Bold spans: one that opens the line can be a name; one inside a sentence counts
    // only when it is written like a name ("I'd start with **Acme Plumbing**"), not
    // when it is ordinary words ("my **top five Nashville plumbers**").
    const spans = line.slice(0, 2000).match(/\*\*[^*\n]{1,120}\*\*/g) ?? [];
    spans.forEach((span, k) => {
      const inner = span.replace(/\*/g, '').trim();
      const opens = k === 0 && /^\s*(?:#{1,6}\s+)?\*{2,3}/.test(line);
      const nameLike = /^[\p{Lu}\d]/u.test(inner) && isTitleCase(inner)
        && (STRONG_TRADE.test(inner) || BUSINESS_END.test(inner.replace(/[.,]+$/, '')));
      if (opens || nameLike) add(span);
    });
  }
  return names;
}

/**
 * Names the answer lists other than the business: at most 5, in answer order.
 * @returns {string[]}
 */
export function extractCompetitors(answer, business) {
  return listedNames(answer).filter(n => !isNamed(n, business, { allowGeneric: true })).slice(0, 5);
}

/**
 * @returns {{ named: boolean, position: number|null, total: number, competitors: string[] }}
 *   position is the business's 1-based place in the answer's list, or null
 */
export function analyzeAnswer(answer, business, { keep } = {}) {
  // keep: an optional second opinion on which pulled-out names are really businesses.
  const all = listedNames(answer);
  const listed = typeof keep === 'function' ? all.filter(n => keep(n)) : all;
  const inList = n => isNamed(n, business, { allowGeneric: true });
  const index = listed.findIndex(inList);
  return {
    named: index !== -1 || isNamed(answer, business),
    position: index === -1 ? null : index + 1,
    total: listed.length,
    competitors: listed.filter(n => !inList(n)).slice(0, 5),
  };
}
