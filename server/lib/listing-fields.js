/**
 * listing-fields.js — pure helpers for turning untrusted listing data
 * (vision output, review-form posts) into the Listing model.
 *
 * No I/O. Everything here is a total function: it never throws on odd input.
 */

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
  return '';
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
  out.phone = normalizePhone(get('phone'));
  out.category = mapCategory(get('category'), categories);
  if (/^[a-z]{2}$/i.test(out.state)) out.state = out.state.toUpperCase();
  out.hours = normalizeHours(get('hours'));
  out.services = normalizeServices(get('services'));
  out.ownerEmail = normalizeEmail(get('ownerEmail')); // private, optional
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
  if (!/^[A-Z]{2}$/.test(out.state)) fail('state', '');

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
  const text = [name, city]
    .map(v => (typeof v === 'string' ? v : ''))
    .join(' ')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = text.slice(0, MAX_SLUG).replace(/-+$/g, '') || 'listing';
  const taken = takenIds && typeof takenIds.has === 'function' ? takenIds : new Set();
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
