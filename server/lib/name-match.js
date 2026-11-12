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
]);

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
  for (const line of String(answer ?? '').split(/\r?\n/)) {
    const list = LIST_LINE.exec(line);
    if (list) {
      add(list[1]);
      continue;
    }
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
