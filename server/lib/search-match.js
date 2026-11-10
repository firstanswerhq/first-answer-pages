/**
 * search-match.js — forgiving category and city matching for search callers.
 * Pure, deterministic, no dependencies. store.searchListings stays strict;
 * callers normalize first.
 */

const STATES = new Set((
  'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY ' +
  'NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'
).split(' '));

/** Lower-case, non-alphanumerics to single spaces, trimmed. */
function normalizeText(input) {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strips one common ending, keeping at least 3 letters. */
function stemWord(word) {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  for (const suffix of ['ers', 'ing', 'er', 'es', 's']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length);
  }
  return word;
}

function stemText(text) {
  return text.split(' ').map(stemWord).join(' ');
}

/**
 * Maps a slug, label, or singular/plural/stem variant to a category slug.
 * @param {unknown} input
 * @param {{ slug: string, label: string }[]} categories
 * @returns {string|undefined}
 */
export function normalizeCategory(input, categories) {
  if (typeof input !== 'string' || !Array.isArray(categories)) return undefined;
  const wanted = normalizeText(input);
  if (wanted === '') return undefined;
  const list = categories.filter(c => c && typeof c.slug === 'string');
  for (const c of list) {
    if (wanted === normalizeText(c.slug) || wanted === normalizeText(c.label)) return c.slug;
  }
  const stem = stemText(wanted);
  for (const c of list) {
    if (stem === stemText(normalizeText(c.slug)) || stem === stemText(normalizeText(c.label))) return c.slug;
  }
  return undefined;
}

/**
 * Trims and removes a trailing ", ST" or " ST" two-letter state.
 * A bare two-letter city, or a trailing word that is not a state, is kept.
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeCity(input) {
  if (typeof input !== 'string') return '';
  const text = input.trim();
  const m = /^(.*\S)\s*,?\s+([A-Za-z]{2})$/.exec(text);
  if (m && STATES.has(m[2].toUpperCase())) return m[1].replace(/\s*,$/, '').trim();
  const comma = /^(.*\S)\s*,\s*([A-Za-z]{2})$/.exec(text);
  if (comma && STATES.has(comma[2].toUpperCase())) return comma[1].trim();
  return text;
}

/**
 * The category a free-text query names, if any: the whole query, or one of
 * its words (e.g. "plumber", "emergency plumbing" -> plumbers).
 * @param {unknown} query
 * @param {{ slug: string, label: string }[]} categories
 * @returns {string|undefined}
 */
export function categoryForQuery(query, categories) {
  if (typeof query !== 'string') return undefined;
  const whole = normalizeCategory(query, categories);
  if (whole) return whole;
  for (const word of normalizeText(query).split(' ')) {
    if (word.length < 3) continue;
    const slug = normalizeCategory(word, categories);
    if (slug) return slug;
  }
  return undefined;
}
