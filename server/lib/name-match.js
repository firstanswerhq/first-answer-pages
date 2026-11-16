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
  return candidates.some(c => c !== '' && haystack.includes(` ${c} `));
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

function beforeSeparator(text) {
  let cut = text.length;
  for (const sep of [' - ', ' \u2013 ', ' \u2014 ', ':', '(', ' | ']) {
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

/** Every name in the answer's list lines and bold spans, in order, without duplicates. */
function listedNames(answer) {
  const names = [];
  const seen = new Set();
  const add = raw => {
    const candidate = beforeSeparator(stripMarkdown(raw));
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
  for (const line of String(answer ?? '').split(/\r?\n/)) {
    const list = LIST_LINE.exec(line);
    if (list) {
      const indent = indentOf(line);
      if (baseIndent === null || indent < baseIndent) baseIndent = indent;
      if (indent > baseIndent && looksLikeDetail(list[1])) continue;
      add(list[1]);
      continue;
    }
    // Prose indented under a list item stays part of that item.
    if (line.trim() !== '' && (baseIndent === null || indentOf(line) <= baseIndent)) baseIndent = null;
    // bold spans on other lines (bounded: no lazy scan over long text)
    const spans = line.slice(0, 2000).match(/\*\*[^*\n]{1,120}\*\*/g) ?? [];
    for (const span of spans) add(span);
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
export function analyzeAnswer(answer, business) {
  const listed = listedNames(answer);
  const inList = n => isNamed(n, business, { allowGeneric: true });
  const index = listed.findIndex(inList);
  return {
    named: index !== -1 || isNamed(answer, business),
    position: index === -1 ? null : index + 1,
    total: listed.length,
    competitors: listed.filter(n => !inList(n)).slice(0, 5),
  };
}
