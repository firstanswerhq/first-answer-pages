/**
 * listing-fields.js — pure helpers for turning untrusted listing data
 * (vision output, review-form posts) into the Listing model.
 *
 * No I/O. Everything here is a total function: it never throws on odd input.
 */

import net from 'node:net';

export const DAYS = Object.freeze([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

const MAX_STRING = 500;
const MAX_SERVICES = 20;
const MAX_SLUG = 60;
const STRING_KEYS = ['name', 'category', 'phone', 'serviceArea', 'description', 'city', 'state', 'address'];

/**
 * Single-line text: every newline / control character becomes a space, runs of
 * whitespace collapse to one space, trim, cap at 500, trim again (idempotent).
 */
function clean(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\n\r\u2028\u2029\u0085]|\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STRING)
    .trim();
}

/**
 * Multi-line text (description only): line breaks are kept as \n, other
 * control characters except tab are removed, then trim, cap at 500, trim.
 */
function cleanMultiline(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[\r\u2028\u2029]/g, '\n')
    .replace(/(?![\n\t])\p{Cc}/gu, '')
    .trim()
    .slice(0, MAX_STRING)
    .trim();
}

/**
 * Private, optional owner email. Returns the trimmed address when it passes a
 * simple check (<= 254 chars, one @, a dot in the domain, no whitespace), else ''.
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeEmail(input) {
  const text = clean(input);
  if (text === '' || text.length > 254 || /\s/.test(text)) return '';
  const parts = text.split('@');
  if (parts.length !== 2) return '';
  const [local, domain] = parts;
  if (local === '' || !domain.includes('.')) return '';
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return '';
  return text;
}

/**
 * Returns "(NNN) NNN-NNNN" for 10 digits (or 11 starting with 1), else ''.
 * @param {unknown} input
 * @returns {string}
 */
export function normalizePhone(input) {
  if (typeof input !== 'string') return '';
  let digits = input.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
  if (digits.length !== 10) return '';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Maps a category slug or label (any letter case) to a known slug, else ''.
 * @param {unknown} input
 * @param {{ slug: string, label: string }[]} categories
 * @returns {string}
 */
export function mapCategory(input, categories) {
  if (typeof input !== 'string' || !Array.isArray(categories)) return '';
  const wanted = input.trim().toLowerCase();
  if (wanted === '') return '';
  const dashed = wanted.replace(/\s+/g, '-');
  for (const c of categories) {
    if (!c || typeof c.slug !== 'string') continue;
    const slug = c.slug.toLowerCase();
    const label = typeof c.label === 'string' ? c.label.trim().toLowerCase() : '';
    if (wanted === slug || dashed === slug || (label !== '' && wanted === label)) return c.slug;
  }
  // Common service words, matched exactly, and only when the category exists.
  const alias = SERVICE_ALIASES.get(wanted.replace(/\s+/g, ' '));
  if (alias && categories.some(c => c && c.slug === alias)) return alias;
  return '';
}

/** Service words people type that belong to a category (see mapCategory). */
const SERVICE_ALIASES = new Map([
  ...['roof', 'roofs', 'roofing', 'roofer', 'roofers', 'roofing contractor', 'roofing contractors',
    'roofing company', 'roofing companies'].map(w => [w, 'roofers']),
  ...['hvac', 'heating', 'cooling', 'heating and cooling', 'heating & cooling', 'heating and air',
    'heating & air', 'air conditioning', 'air conditioning and heating', 'heating and air conditioning',
    'heating, ventilation and air conditioning', 'ac repair'].map(w => [w, 'hvac']),
]);

/** Two-letter codes for the 50 states and DC, keyed by full name (lowercase). */
const STATE_NAMES = Object.freeze({
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
});

/** The 51 accepted state codes (50 states and DC). */
export const US_STATE_CODES = Object.freeze(new Set(Object.values(STATE_NAMES)));

/** Shown under the State box and as its error. */
export const STATE_HINT = '2 letters, like TN';
export const STATE_ERROR = 'Use the 2-letter state, like TN.';

/**
 * A real state code from a code or a full name, any letter case:
 * "tn" -> "TN", "Tennessee" -> "TN", "Washington, D.C." -> "DC".
 * Anything else comes back as typed (cleaned), so validateFields can flag it.
 * @param {string} text already cleaned single-line text
 * @returns {string}
 */
export function normalizeState(text) {
  if (typeof text !== 'string' || text === '') return '';
  const code = text.replace(/\./g, '').trim().toUpperCase();
  if (US_STATE_CODES.has(code)) return code;
  const name = text.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (Object.hasOwn(STATE_NAMES, name)) return STATE_NAMES[name];
  if (name === 'washington dc' || name === 'washington, dc' || name === 'dc') return 'DC';
  return text;
}

/**
 * Tidy a city typed all in lower (or all in upper) case: "nashville" ->
 * "Nashville", "st. louis" -> "St. Louis", "winston-salem" -> "Winston-Salem".
 * Mixed-case input is left exactly as typed. Idempotent.
 * @param {string} text already cleaned single-line text
 * @returns {string}
 */
export function tidyCity(text) {
  if (typeof text !== 'string' || text === '') return '';
  if (/\p{Ll}/u.test(text) && /\p{Lu}/u.test(text)) return text;
  return text
    .toLowerCase()
    // Title case, not upper case: a letter whose capital is two letters ("\u00df" -> "SS",
    // "\u1f80" -> "\u1f08\u0399") keeps only the first one capital, so a second pass changes nothing.
    .replace(/(^|[\s\-.'\u2019])(\p{Ll})/gu, (_, before, letter) => {
      const [first, ...rest] = letter.toUpperCase();
      return before + first + rest.join('').toLowerCase();
    })
    .slice(0, MAX_STRING)
    .trim();
}

// ---- the business's own website ---------------------------------------------------------------

/** Longest text looked at, before parsing. */
const MAX_WEBSITE_INPUT = 600;
/** Longest website kept, after it is rebuilt as scheme, host and path. */
export const MAX_WEBSITE = 300;

/**
 * The business's own website as a clean public https address ("https://<host><path>"), or '' when it is not
 * one. Works on the trimmed text, which must start with "https://". Refused: more than 600 characters before
 * parsing, any other scheme, a user name or password, a port (a default ":443" is dropped by the parser), any
 * IP address (IPv4 or IPv6, public or not), "localhost" and names ending in ".localhost", and a name with no
 * dot. One trailing dot on the host is removed first. The query string and the "#" part are dropped, so no login
 * or tracking parameters are kept; the result is refused when it is longer than 300 characters. Never throws and
 * never looks anything up on the network.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeWebsite(value) {
  try {
    if (typeof value !== 'string') return '';
    const text = value.trim();
    if (text === '' || text.length > MAX_WEBSITE_INPUT || /[\s\p{Cc}]/u.test(text)) return '';
    // Written out in full: "https:example.com" parses, but in a page's href it points at our own site.
    if (!/^https:\/\//i.test(text)) return '';
    let url;
    try {
      url = new URL(text);
    } catch {
      return '';
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return '';
    let host = url.hostname.toLowerCase();
    if (host.endsWith('.')) host = host.slice(0, -1);
    const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    if (bare === '' || net.isIP(bare) !== 0) return '';
    if (host === 'localhost' || host.endsWith('.localhost')) return '';
    if (!host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return '';
    // Letters, digits, dots and hyphens only (V98): the URL parser keeps some punctuation in a host
    // ('"', "'", '`', '{', '&', ';'). International names arrive as "xn--…", so they still pass.
    if (!/^[a-z0-9.-]+$/.test(host)) return '';
    const clean = `https://${host}${url.pathname || '/'}`;
    return clean.length <= MAX_WEBSITE ? clean : '';
  } catch {
    return '';
  }
}

// ---- review links --------------------------------------------------------------------------

/** Longest review link kept, query string and `#` part included (real Google links often pass 300). */
export const MAX_REVIEWS_LINK = 1000;

/** The URL, or null: https only, no user name, password or port, at most 1,000 characters, one line. */
function parseReviewsUrl(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === '' || text.length > MAX_REVIEWS_LINK || /[\s\p{Cc}]/u.test(text)) return null;
  // Written out in full: "https:google.com/maps" parses, but in a page's href it points at our own site.
  if (!/^https:\/\//i.test(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  return url;
}

/** The host without a leading "www." or "m.". */
const bareHost = url => url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');

/**
 * Which review site an owner-typed link points to: 'google', 'yelp', 'facebook', 'nextdoor', or '' when it
 * is not an https link to one of them. Never throws and fetches nothing.
 * @param {unknown} value
 * @returns {'google' | 'yelp' | 'facebook' | 'nextdoor' | ''}
 */
export function reviewsLinkHost(value) {
  const url = parseReviewsUrl(value);
  if (!url) return '';
  const host = bareHost(url);
  const p = url.pathname;
  // Redirect addresses ("/url?q=…", "/biz_redir", "/l.php") are refused: the label would vouch for a link
  // that can lead anywhere.
  switch (host) {
    case 'google.com':
      if (p === '/maps' || p.startsWith('/maps/')) return 'google';
      // A Google search address is a business's reviews only when it names the business's own panel.
      if (p === '/search' && (url.hash.includes('lrd=') || url.search.includes('ludocid='))) return 'google';
      return '';
    case 'maps.google.com':
      return p === '/url' || p.startsWith('/url/') ? '' : 'google';
    case 'g.page':
    case 'maps.app.goo.gl':
      return 'google';
    case 'g.co':
      return p.startsWith('/kgs/') ? 'google' : '';
    case 'search.google.com':
      return p.startsWith('/local') ? 'google' : '';
    case 'yelp.com':
      return p.startsWith('/biz/') ? 'yelp' : '';
    case 'facebook.com':
      return p === '/l.php' || p.startsWith('/l.php/') || p.startsWith('/flx/') ? '' : 'facebook';
    case 'nextdoor.com':
      return 'nextdoor';
    default:
      return '';
  }
}

/**
 * The same, for links read from a home page, which is stricter: a Facebook link counts only when its path
 * has "/reviews", a Nextdoor link only under "/pages/", and Google's "write a review" form never counts
 * (a footer link to a Facebook page is not a page of reviews).
 * @param {unknown} value
 * @returns {'google' | 'yelp' | 'facebook' | 'nextdoor' | ''}
 */
export function reviewsLinkOnPage(value) {
  const site = reviewsLinkHost(value);
  if (site === '') return '';
  const url = parseReviewsUrl(value);
  const host = bareHost(url);
  const p = url.pathname;
  if (site === 'facebook') return p.endsWith('/reviews') || p.includes('/reviews/') ? site : '';
  if (site === 'nextdoor') return p.startsWith('/pages/') ? site : '';
  if (host === 'search.google.com' && p.startsWith('/local/writereview')) return '';
  return site;
}

function normalizeHours(raw) {
  const out = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const day = key.trim().toLowerCase();
    if (!DAYS.includes(day) || Object.hasOwn(out, day)) continue;
    const text = clean(value);
    if (text !== '') out[day] = text;
  }
  return out;
}

function normalizeServices(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const text = clean(item);
    if (text === '') continue;
    out.push(text);
    if (out.length >= MAX_SERVICES) break;
  }
  return out;
}

/**
 * Builds a complete set of model fields from untrusted input. Only model keys
 * are read (so `__proto__` and friends are discarded); non-objects count as empty.
 * @param {unknown} raw
 * @param {{ slug: string, label: string }[]} categories
 * @returns {object}
 */
export function normalizeFields(raw, categories) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const get = key => (Object.hasOwn(src, key) ? src[key] : undefined);
  const out = {};
  for (const key of STRING_KEYS) out[key] = clean(get(key));
  out.description = cleanMultiline(get('description'));
  out.city = tidyCity(out.city);
  out.phone = normalizePhone(get('phone'));
  out.category = mapCategory(get('category'), categories);
  out.state = normalizeState(out.state);
  out.hours = normalizeHours(get('hours'));
  out.services = normalizeServices(get('services'));
  out.ownerEmail = normalizeEmail(get('ownerEmail')); // private, optional
  // Optional link to the business's reviews: the key is added only when it has a value, so a listing
  // without one has exactly the fields it had before.
  const reviews = get('reviewsLink');
  if (typeof reviews === 'string' && reviewsLinkHost(reviews) !== '') out.reviewsLink = reviews.trim();
  // Optional link to the business's own website, the same way: the key only when it has a value.
  const website = normalizeWebsite(get('website'));
  if (website !== '') out.website = website;
  return out;
}

/**
 * Normalizes then validates. Failing fields are emptied and named in
 * `missingFields`. `address` and `hours` are optional and never listed.
 * @param {unknown} fields
 * @param {{ slug: string, label: string }[]} categories
 * @returns {{ fields: object, missingFields: string[] }}
 */
export function validateFields(fields, categories) {
  const out = normalizeFields(fields, categories);
  const missing = [];
  const fail = (key, empty) => { out[key] = empty; missing.push(key); };

  if (out.name === '') fail('name', '');
  if (!/^\(\d{3}\) \d{3}-\d{4}$/.test(out.phone)) fail('phone', '');
  if (!Array.isArray(categories) || !categories.some(c => c && c.slug === out.category)) fail('category', '');
  if (out.services.length === 0) fail('services', []);
  if (out.serviceArea === '') fail('serviceArea', '');
  if (out.description === '') fail('description', '');
  if (out.city === '') fail('city', '');
  if (!US_STATE_CODES.has(out.state)) fail('state', '');

  return { fields: out, missingFields: missing };
}

/**
 * URL-safe, unique listing id from name and city: [a-z0-9-], never empty.
 * Collisions get a numeric suffix (-2, -3, ...).
 * @param {unknown} name
 * @param {unknown} city
 * @param {Set<string>} [takenIds]
 * @returns {string}
 */
export function makeSlug(name, city, takenIds) {
  const slugify = v => (typeof v === 'string' ? v : '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const nameSlug = slugify(name);
  const citySlug = slugify(city);
  // Skip the city when the name already contains it as whole words ("Bellevue Plumbing Co").
  const cityInName = citySlug !== '' && `-${nameSlug}-`.includes(`-${citySlug}-`);
  const text = cityInName || citySlug === ''
    ? nameSlug
    : [nameSlug, citySlug].filter(Boolean).join('-');
  const base = text.slice(0, MAX_SLUG).replace(/-+$/g, '') || 'listing';
  const taken = takenIds && typeof takenIds.has === 'function' ? takenIds : new Set();
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
