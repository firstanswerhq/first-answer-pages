// Reads the facts the Grader needs from a home page's HTML.
// Hand-written and bounded: elements and comments are removed by indexOf
// scanning (an unclosed tag cuts to the end), never by lazy patterns, and no
// page script is ever run.

import { reviewsLinkOnPage } from './listing-fields.js';
import { normalizeForMatch } from './seance.js';
import { LOCAL_BUSINESS_TYPES, ORGANIZATION_TYPES } from './schema-types.js';

const MAX_HTML = 2 * 1024 * 1024;
const MAX_TAG = 4000; // longest tag text read for attributes
const MAX_CONTENT = 2000; // longest element text read for labels and headlines
const MAX_LABELS = 200;
const MAX_TEL = 100;
const MAX_H1 = 50;
const MAX_HEADINGS = 40;
const MAX_HEADING_TEXT = 120;
const MAX_REVIEW_LINKS = 5;
const MAX_AREA_TEXT = 120;
const MAX_LINKS_FOR_REVIEWS = 2000;

/** How much of the page text the service-area, rating and quoted-comment tests read. */
export const MAX_PATTERN_TEXT = 200000;

/** The start of the page text that those tests read (normalizing all of a 1 MB page is too slow). */
export function textForPatterns(text) {
  return typeof text === 'string' ? text.slice(0, MAX_PATTERN_TEXT) : '';
}

/** The page text as the service-area test reads it: the first 200,000 characters, normalized. */
export function serviceAreaText(facts) {
  return normalizeForMatch(textForPatterns(facts?.text));
}

/** Hours: a day word near a time, a time range, or round-the-clock wording. */
const TIME = String.raw`\d{1,2}(?::\d{2})?\s?(?:(?:am|pm)(?![a-z])|a\.m\.|p\.m\.)`;
const DAY = String.raw`\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b`;
// A 24-hour time ("07:00", "18:30") counts only in a range after a day word ("Mon-Fri 07:00-18:00"), so a lone
// "10:30" or a phone number is never taken for hours (V219).
const TIME24 = String.raw`(?:[01]?\d|2[0-3]):[0-5]\d`;
export const HOURS_PATTERN = new RegExp(
  `${DAY}[\\s\\S]{0,40}?${TIME}|${TIME}\\s?(?:-|\u2013|\u2014|to)\\s?${TIME}|${DAY}[\\s\\S]{0,40}?${TIME24}\\s?(?:-|\u2013|\u2014|to)\\s?${TIME24}|24/7|open 24 hours`,
  'i',
);

/** A street address such as "12 Main Street". */
export const STREET_PATTERN =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Pike|Hwy|Highway|Cir|Circle|Pl|Place|Ter|Terrace)\b/i;

/** Call-to-action words, whole words only. */
export const CTA_PATTERN =
  /\b(?:call|book|schedule|quote|estimate|order|reserve|reservation|appointment|get started)\b/i;

// ---------- service area (no-storefront mode) ----------

/** Words that, near "serving" or "we serve", say an area is meant rather than food or a product. */
const AREA_WORDS = 'areas?|county|counties|surrounding|nearby|communities';
// Letters and digits on either side mark a whole word; \b is not enough when a city ends in "+".
const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';
const NEVER = /(?!)/u;

/** Longest stretch between "serving" (or "we serve") and the city or area word, inside one sentence. */
const SERVE_WINDOW = 120;
const SERVE_VERB = `${WORD_START}(?:we\\s(?:proudly\\s)?serve|proudly\\sserve|serving)${WORD_END}`;
const SPACE = '[\\s\\p{P}]{1,3}';

/**
 * The service-area test for one Grade, matched against the page text before punctuation is taken out
 * (`serviceAreaSource(facts)`: the first 200,000 characters). It also works on normalized text.
 *
 * The city is normalized (lower case, punctuation gone), each of its words is escaped, and the words may be
 * joined in the page by spaces or punctuation, so "St. Louis" matches "st louis". An empty city adds no city
 * alternative (never an empty one, which would match everywhere).
 *
 * After "serving", "we serve" or "proudly serve" the city or an area word must come in the same sentence: the
 * window stops at a period, "!", "?" or a line break, and runs at most 120 characters. To stay fast, the window
 * is checked backward from a city or area word (a lookbehind), so a page full of "serving" with no city costs
 * nothing. No open-ended or lazy matching. Never throws.
 * @param {unknown} city
 * @returns {RegExp}
 */
export function serviceAreaPattern(city) {
  try {
    const words = normalizeForMatch(typeof city === 'string' ? city : '').slice(0, 120).split(' ').filter(Boolean);
    // Only the characters that may be escaped under the `u` flag (a "\-" would be a syntax error there).
    const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join(SPACE);
    const target = escaped ? `${AREA_WORDS}|${escaped}` : AREA_WORDS;
    const word = t => `${WORD_START}(?:${t})${WORD_END}`;
    const parts = [
      word(`service${SPACE}areas?`),
      word(`areas?${SPACE}we${SPACE}serve`),
      // The city or area word, then (looking back) the verb earlier in the same sentence.
      `${word(target)}(?<=${SERVE_VERB}[^.!?\\n]{0,${SERVE_WINDOW}}(?:${target}))`,
    ];
    if (escaped) {
      parts.push(word(`${escaped}${SPACE}and\\s(?:the\\s)?(?:surrounding|nearby|neighboring)\\s(?:areas?|communities|towns|cities|counties)`));
    }
    return new RegExp(parts.join('|'), 'iu');
  } catch {
    return NEVER;
  }
}

/**
 * The page text as the service-area test reads it: the first 200,000 characters, punctuation kept, and a line
 * break wherever a block (a paragraph, heading, list item, table cell, div or line break) ends, so text split
 * across two blocks with no period between them is never read as one sentence. Hand-built facts with only
 * `text` are read as they are.
 */
export function serviceAreaSource(facts) {
  return typeof facts?.areaText === 'string' ? textForPatterns(facts.areaText) : textForPatterns(facts?.text);
}

/** How much of the page's HTML is read for `areaText` (the test reads at most 200,000 characters of it). */
const MAX_AREA_HTML = 1000000;
/** Where a block ends. Bounded: no open-ended or lazy matching. */
const BLOCK_END = /<\/(?:p|div|li|h[1-6]|td)\s{0,20}>|<br(?:\s[^<>]{0,200})?\s{0,5}\/?>/gi;
const BREAK_MARK = '\u0001';

/** The page text with a line break at each block end (see serviceAreaSource). */
function readAreaText(html) {
  const marked = html.slice(0, MAX_AREA_HTML).replace(/\u0001/g, ' ').replace(BLOCK_END, BREAK_MARK);
  const text = collapse(decode(stripTags(marked)));
  return textForPatterns(text.replace(/ ?\u0001[ \u0001]*/g, '\n').trim());
}

// ---------- reviews ----------

/**
 * Tested against each entry of `facts.headings` (never the page text, so a "Reviews" menu link does not count).
 */
export const REVIEW_HEADING_PATTERN =
  /\b(?:reviews|testimonials)\b|\bwhat (?:our |my )?(?:customers|clients|neighbors) (?:say|are saying)\b/i;

/**
 * A rating written out: "5.0 stars", "4.9 out of 5", a decimal before the slash ("4.8/5"; "Closed 1/5" and
 * "Open 9/5" never count), or three or more star symbols in a row.
 */
export const RATING_PATTERN =
  /\b[1-5](?:\.\d)?\s{0,3}stars?\b|\b[1-5](?:\.\d)?\s{0,3}out of\s{1,3}5\b|\b[1-5]\.\d\s?\/\s?5\b|[\u2605\u2B50]{3,}/iu;

/** A quoted comment of 20 to 400 characters, then within 40 characters a dash and a capitalized name. */
export const QUOTED_REVIEW_PATTERN =
  /["\u201C][^"\u201C\u201D\n]{20,400}["\u201D][\s,.]{0,40}[-\u2013\u2014~]\s{0,3}\p{Lu}\p{Ll}{0,30}/u;

/**
 * True when the page facts hold a review signal: a review heading, a rating or a quoted comment with a name
 * in the text, a link to reviews on a review site, or review data in the business label.
 * @param {object} facts Page_Facts from readPageFacts
 * @returns {boolean}
 */
export function hasReviewSignal(facts) {
  if (!facts || typeof facts !== 'object') return false;
  const headings = Array.isArray(facts.headings) ? facts.headings : [];
  if (headings.some(h => typeof h === 'string' && REVIEW_HEADING_PATTERN.test(h))) return true;
  const text = textForPatterns(facts.text);
  if (RATING_PATTERN.test(text) || QUOTED_REVIEW_PATTERN.test(text)) return true;
  if (Array.isArray(facts.reviewLinks) && facts.reviewLinks.length > 0) return true;
  return facts.jsonLd?.business?.hasReviewData === true;
}

// Every schema.org local-business type (see schema-types.js) plus two deliberate extras, neither a schema.org
// local-business type: `CleaningService` (kept from before) and `VeterinaryCare` (a vet is local; in schema.org it
// sits under MedicalOrganization, which is not a local business).
// `OnlineBusiness`, `OnlineStore` and `OnlineMarketplace` are not here and not in ORGANIZATION_TYPES: they never
// count as local (V156).
const BUSINESS_TYPES = new Set([...LOCAL_BUSINESS_TYPES, 'CleaningService', 'VeterinaryCare']);

/** "https://schema.org/AutoWash", "http://schema.org/AutoWash" and "schema:AutoWash" are all "AutoWash" (V156). */
const SCHEMA_PREFIX = /^\s*(?:https?:\/\/schema\.org\/|schema:)/i;
export function bareSchemaType(type) {
  return typeof type === 'string' ? type.replace(SCHEMA_PREFIX, '').trim() : '';
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201C', rdquo: '\u201D', hellip: '\u2026', copy: '\u00A9', reg: '\u00AE',
};

const MAX_LINKS_KEPT = 400;
const MAX_LINK_HREF = 500;
const FAQ_HEADING = /\b(?:faqs?|frequently asked questions|questions? (?:and|&) answers?|common questions|questions? we get asked)\b/i;

/** How many times `needle` (already lowercase) appears in `lower`, counting at most 50. */
function countOf(lower, needle) {
  let n = 0;
  let at = lower.indexOf(needle);
  while (at !== -1 && n < 50) {
    n += 1;
    at = lower.indexOf(needle, at + needle.length);
  }
  return n;
}

/**
 * True when the page has a questions-and-answers section (Requirement 3.11): a heading that says FAQ or common
 * questions, two or more details/summary pairs, FAQPage markup, or two or more headings ending in a question mark.
 */
function hasQuestionsSection(facts, lowerHtml) {
  const headings = Array.isArray(facts.headings) ? facts.headings : [];
  if (headings.some(h => FAQ_HEADING.test(h))) return true;
  if (headings.filter(h => /\?\s*$/.test(h)).length >= 2) return true;
  if (countOf(lowerHtml, '<details') >= 2 && countOf(lowerHtml, '<summary') >= 2) return true;
  const types = Array.isArray(facts.jsonLd?.types) ? facts.jsonLd.types : [];
  return types.includes('FAQPage');
}

function emptyFacts() {
  return {
    title: '',
    metaDescription: '',
    ogTitle: '',
    ogImage: '',
    hasViewport: false,
    h1s: [],
    headings: [],
    reviewLinks: [],
    areaText: '',
    imgCount: 0,
    imgMissingAlt: 0,
    telLinks: [],
    ctaLabels: [],
    text: '',
    scriptBuilt: false,
    // Every link with an address, in page order: { href, text } (at most 400). Read only; never fetched.
    links: [],
    // True when the page has a questions-and-answers section (Requirement 3.11).
    faq: false,
    jsonLd: { blockCount: 0, unreadableCount: 0, blocks: [], types: [], business: null },
  };
}

// ---------- small helpers ----------

/** ASCII-only lowercase; keeps the string length, so indexes line up. */
function toLower(s) {
  return s.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
}

function isBoundary(code) {
  // end of string, whitespace, '>' or '/'
  return Number.isNaN(code) || code === 62 || code === 47 || code === 32 || (code >= 9 && code <= 13);
}

function isLetter(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * Finds `needle` from an index, remembering the last answer. Calls must use
 * non-decreasing `from` values, so a failed search is never repeated.
 */
function finder(str, needle, ok) {
  let cache = -2;
  return from => {
    if (cache === -1) return -1;
    if (cache >= from) return cache;
    let i = from;
    for (;;) {
      i = str.indexOf(needle, i);
      if (i === -1) { cache = -1; return -1; }
      if (!ok || ok(str.charCodeAt(i + needle.length))) { cache = i; return i; }
      i += 1;
    }
  };
}

function decode(str) {
  if (str.indexOf('&') === -1) return str;
  return str.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));/g, (m, dec, hex, name) => {
    if (name !== undefined) {
      const v = NAMED[name.toLowerCase()];
      return v === undefined ? m : v;
    }
    const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return ' ';
    return String.fromCodePoint(cp);
  });
}

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** Removes every <!-- ... --> comment. An unclosed comment cuts to the end. */
function removeComments(s) {
  let i = s.indexOf('<!--');
  if (i === -1) return s;
  const parts = [];
  let pos = 0;
  while (i !== -1) {
    parts.push(s.slice(pos, i));
    const end = s.indexOf('-->', i + 4);
    if (end === -1) { pos = s.length; break; }
    pos = end + 3;
    i = s.indexOf('<!--', pos);
  }
  parts.push(s.slice(pos));
  return parts.join('');
}

/** Removes every <name ...>...</name> element. An unclosed element cuts to the end. */
function removeElements(s, name) {
  let lower = toLower(s);
  const open = `<${name}`;
  const close = `</${name}`;
  if (lower.indexOf(open) === -1) return s;
  const parts = [];
  let pos = 0;
  let from = 0;
  for (;;) {
    const i = lower.indexOf(open, from);
    if (i === -1) break;
    if (!isBoundary(lower.charCodeAt(i + open.length))) { from = i + 1; continue; }
    let c = i + open.length;
    for (;;) {
      c = lower.indexOf(close, c);
      if (c === -1 || isBoundary(lower.charCodeAt(c + close.length))) break;
      c += 1;
    }
    parts.push(s.slice(pos, i));
    if (c === -1) { pos = s.length; break; }
    const gt = lower.indexOf('>', c);
    pos = gt === -1 ? s.length : gt + 1;
    parts.push(' ');
    from = pos;
    if (pos >= s.length) break;
  }
  parts.push(s.slice(pos));
  lower = '';
  return parts.join('');
}

/** Replaces tags with spaces. A '<' that does not start a tag stays as text. */
function stripTags(s) {
  if (s.indexOf('<') === -1) return s;
  const gt = finder(s, '>');
  const lt = finder(s, '<');
  const out = [];
  let pos = 0;
  let i = 0;
  for (;;) {
    i = lt(i);
    if (i === -1) break;
    const c = s.charCodeAt(i + 1);
    if (!(isLetter(c) || c === 47 || c === 33 || c === 63)) { i += 1; continue; }
    const g = gt(i);
    const l = lt(i + 1);
    out.push(s.slice(pos, i), ' ');
    if (g === -1 && l === -1) { pos = s.length; break; }
    pos = l !== -1 && (g === -1 || l < g) ? l : g + 1;
    i = pos;
  }
  out.push(s.slice(pos));
  return out.join('');
}

function cleanText(s) {
  return collapse(decode(stripTags(s)));
}

/** Reads attributes of one (bounded) tag into a Map keyed by lowercase name. */
function readAttrs(tag, name) {
  const attrs = new Map();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
  const body = tag.slice(1 + name.length);
  let m;
  while ((m = re.exec(body)) !== null) {
    const key = m[1].toLowerCase();
    if (attrs.has(key)) continue;
    const raw = m[2] ?? m[3] ?? m[4];
    attrs.set(key, raw === undefined ? '' : decode(raw));
  }
  return attrs;
}

/**
 * Visits every <name ...> tag. `cb(tag, contentStart, contentEnd)` gets the
 * bounded tag text and, when `withContent` is set, the range of its content.
 * Content ends at the nearest of the closing tag, the next tag of the same
 * name, or `maxContent` characters, so nested or unclosed tags stay linear.
 */
function scan(s, lower, name, withContent, maxContent, cb) {
  const open = `<${name}`;
  const close = `</${name}`;
  const findOpen = finder(lower, open, isBoundary);
  const findClose = finder(lower, close, isBoundary);
  const gt = finder(s, '>');
  const lt = finder(s, '<');
  let from = 0;
  for (;;) {
    const i = findOpen(from);
    if (i === -1) break;
    const g = gt(i);
    const l = lt(i + 1);
    const stop = l !== -1 && (g === -1 || l < g) ? l : g;
    if (stop === -1) {
      cb(s.slice(i, i + MAX_TAG), s.length, s.length);
      break;
    }
    const tag = s.slice(i, Math.min(stop, i + MAX_TAG));
    const contentStart = stop === g ? g + 1 : l;
    if (!withContent) {
      cb(tag, contentStart, contentStart);
      from = contentStart;
      continue;
    }
    const nextOpen = findOpen(contentStart);
    const c = findClose(contentStart);
    let end = Math.min(s.length, contentStart + maxContent);
    if (c !== -1 && c < end) end = c;
    if (nextOpen !== -1 && nextOpen < end) end = nextOpen;
    cb(tag, contentStart, end);
    from = end;
  }
}

// ---------- JSON-LD ----------

function asArray(v) {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function str(v) {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}

function nodeTypes(node) {
  return asArray(node['@type']).filter(t => typeof t === 'string').map(bareSchemaType).filter(Boolean);
}

/** Top object, each item of a top-level array, and each item of any @graph. */
function collectNodes(value) {
  const nodes = [];
  const visit = (item, depth) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    nodes.push(item);
    if (depth === 0 && Array.isArray(item['@graph'])) {
      for (const g of item['@graph']) visit(g, 1);
    }
  };
  if (Array.isArray(value)) for (const item of value) visit(item, 0);
  else visit(value, 0);
  return nodes;
}

function isBusinessNode(node) {
  const types = nodeTypes(node);
  if (types.some(t => BUSINESS_TYPES.has(t))) return true;
  // Organization and its subtypes that are not local businesses (Corporation, NGO, ...) count only with a
  // telephone and an address.
  return types.some(t => ORGANIZATION_TYPES.has(t)) && Boolean(str(node.telephone)) && Boolean(node.address);
}

function readAddress(a) {
  if (typeof a === 'string') {
    const text = a.trim();
    return text ? { street: text, city: '', region: '', postalCode: '', text } : null;
  }
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    const street = str(a.streetAddress);
    const city = str(a.addressLocality);
    const region = str(a.addressRegion);
    const postalCode = str(a.postalCode);
    // US style: "400 Church Street, Franklin, TN 37064", with no comma before the ZIP (V144).
    const text = [street, city, [region, postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return text ? { street, city, region, postalCode, text } : null;
  }
  return null;
}

function readHours(node) {
  const out = [];
  for (const h of asArray(node.openingHours)) {
    const t = str(h);
    if (t) out.push(t);
  }
  for (const spec of asArray(node.openingHoursSpecification)) {
    if (!spec || typeof spec !== 'object') continue;
    const days = asArray(spec.dayOfWeek).map(d => str(d).replace(/^.*[/#]/, '')).filter(Boolean).join(', ');
    const opens = str(spec.opens);
    const closes = str(spec.closes);
    const t = [days, opens && closes ? `${opens}-${closes}` : opens || closes].filter(Boolean).join(' ');
    if (t) out.push(t);
  }
  return out;
}

function readBusiness(node) {
  return {
    type: nodeTypes(node).find(t => BUSINESS_TYPES.has(t)) || 'Organization',
    name: str(node.name),
    telephone: str(node.telephone),
    address: readAddress(node.address),
    hours: readHours(node),
    url: str(node.url),
    areaServed: readAreaServed(node.areaServed),
    hasReviewData: hasValue(node.aggregateRating) || hasValue(node.review),
  };
}

/** `areaServed` as text: a string, an object with `name`, or an array of those, joined with ", ". */
function readAreaServed(value) {
  const parts = [];
  for (const item of asArray(value)) {
    const text = typeof item === 'string'
      ? item.trim()
      : item && typeof item === 'object' && !Array.isArray(item) ? str(item.name) : '';
    if (text) parts.push(text);
    if (parts.length >= 20) break;
  }
  return parts.join(', ').slice(0, MAX_AREA_TEXT).trim();
}

/** A value that holds something: a non-empty string, a number, a non-empty array or object. */
function hasValue(v) {
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.some(hasValue);
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}

function readJsonLd(bodies) {
  const result = { blockCount: bodies.length, unreadableCount: 0, blocks: [], types: [], business: null };
  const seen = new Set();
  let local = null;
  let fallback = null;
  let stub = null;
  for (const body of bodies) {
    let value;
    try {
      value = JSON.parse(body);
    } catch {
      value = undefined;
    }
    if (value === undefined || value === null || typeof value !== 'object') {
      result.unreadableCount += 1;
      result.blocks.push({ unreadable: true });
      continue;
    }
    result.blocks.push({ unreadable: false });
    for (const node of collectNodes(value)) {
      for (const t of nodeTypes(node)) {
        if (!seen.has(t)) { seen.add(t); result.types.push(t); }
      }
      // The first node of a local-business type, from all blocks, is the business (V197); only when there is none,
      // the first Organization-rule node (an Organization or a non-local subtype with a telephone and an address).
      // A bare local node (no name and no telephone, such as {"@type":"Plumber","@id":"#joe"}) is kept only as a
      // last local choice, so it cannot beat a full organization (V201).
      if (nodeTypes(node).some(t => BUSINESS_TYPES.has(t))) {
        if (!local && (str(node.name) || str(node.telephone))) local = node;
        else if (!stub) stub = node;
      } else if (!fallback && isBusinessNode(node)) {
        fallback = node;
      }
    }
  }
  const chosen = local ?? fallback ?? stub;
  if (chosen) result.business = readBusiness(chosen);
  return result;
}

// ---------- headings ----------

/**
 * The text of every <h1>, <h2> and <h3>, in page order (each cut to 120 characters, at most 40). Heading text
 * inside an <a>, or a heading inside a <nav>, is left out, so a "Reviews" menu link is never a heading.
 * Same indexOf scanning as the rest of the file.
 */
function readHeadings(s) {
  let t = removeElements(s, 'nav');
  t = removeElements(t, 'a');
  if (t.indexOf('<') === -1) return [];
  const lower = toLower(t);
  const found = [];
  for (const name of ['h1', 'h2', 'h3']) {
    let count = 0;
    scan(t, lower, name, true, MAX_CONTENT, (tag, start, end) => {
      if (count >= MAX_HEADINGS) return;
      const text = cleanText(t.slice(start, end)).slice(0, MAX_HEADING_TEXT).trim();
      if (!text) return;
      count += 1;
      found.push({ at: start, text });
    });
  }
  // The first 40 of each kind always hold the first 40 overall.
  return found.sort((a, b) => a.at - b.at).slice(0, MAX_HEADINGS).map(h => h.text);
}

// ---------- main ----------

/**
 * @param {string} html
 * @returns {object} Page_Facts
 */
export function readPageFacts(html) {
  const facts = emptyFacts();
  if (typeof html !== 'string' || html === '') return facts;

  let s = html.length > MAX_HTML ? html.slice(0, MAX_HTML) : html;
  s = removeComments(s);

  // JSON-LD first, while the script elements are still there.
  const ldBodies = [];
  let scriptCount = 0;
  if (s.indexOf('<') !== -1) {
    const lower = toLower(s);
    scan(s, lower, 'script', true, Infinity, (tag, start, end) => {
      scriptCount += 1;
      const type = (readAttrs(tag, 'script').get('type') || '').trim().toLowerCase();
      if (type.startsWith('application/ld+json')) ldBodies.push(s.slice(start, end));
    });
  }
  facts.jsonLd = readJsonLd(ldBodies);

  for (const name of ['script', 'style', 'noscript', 'template', 'svg']) s = removeElements(s, name);

  if (s.indexOf('<') !== -1) {
    const lower = toLower(s);

    let gotTitle = false;
    scan(s, lower, 'title', true, MAX_CONTENT, (tag, start, end) => {
      if (gotTitle) return;
      gotTitle = true;
      facts.title = cleanText(s.slice(start, end));
    });

    scan(s, lower, 'meta', false, 0, tag => {
      const a = readAttrs(tag, 'meta');
      const key = (a.get('name') || a.get('property') || '').trim().toLowerCase();
      const content = (a.get('content') || '').trim();
      if (key === 'description' && !facts.metaDescription) facts.metaDescription = content;
      else if (key === 'og:title' && !facts.ogTitle) facts.ogTitle = content;
      else if (key === 'og:image' && !facts.ogImage) facts.ogImage = content;
      else if (key === 'viewport') facts.hasViewport = true;
    });

    scan(s, lower, 'h1', true, MAX_CONTENT, (tag, start, end) => {
      if (facts.h1s.length >= MAX_H1) return;
      const t = cleanText(s.slice(start, end));
      if (t) facts.h1s.push(t);
    });

    scan(s, lower, 'img', false, 0, tag => {
      facts.imgCount += 1;
      if (!(readAttrs(tag, 'img').get('alt') || '').trim()) facts.imgMissingAlt += 1;
    });

    let linksSeen = 0;
    const addLabel = text => {
      const label = text.slice(0, 60).trim();
      if (label && facts.ctaLabels.length < MAX_LABELS) facts.ctaLabels.push(label);
    };

    scan(s, lower, 'a', true, MAX_CONTENT, (tag, start, end) => {
      const href = (readAttrs(tag, 'a').get('href') || '').trim();
      if (/^tel:/i.test(href) && facts.telLinks.length < MAX_TEL) facts.telLinks.push(href);
      // Links to the business's reviews on a review site, in page order (https only, the stricter page rules).
      // Only the first 2,000 links are looked at, and only full https addresses reach the validator, so a page
      // made of a huge number of links stays fast.
      linksSeen += 1;
      if (
        facts.reviewLinks.length < MAX_REVIEW_LINKS && linksSeen <= MAX_LINKS_FOR_REVIEWS
        && /^https:\/\//i.test(href) && reviewsLinkOnPage(href) !== ''
      ) facts.reviewLinks.push(href);
      const labelText = cleanText(s.slice(start, end));
      // Every link with an address, in page order, for the health map's profile and service-page signals (never fetched).
      if (href !== '' && facts.links.length < MAX_LINKS_KEPT && !/^(?:#|javascript:|mailto:|tel:)/i.test(href)) {
        facts.links.push({ href: href.slice(0, MAX_LINK_HREF), text: labelText.slice(0, 100) });
      }
      addLabel(labelText);
    });

    scan(s, lower, 'button', true, MAX_CONTENT, (tag, start, end) => {
      addLabel(cleanText(s.slice(start, end)));
    });

    scan(s, lower, 'input', false, 0, tag => {
      const a = readAttrs(tag, 'input');
      const type = (a.get('type') || '').trim().toLowerCase();
      if (type === 'submit' || type === 'button') addLabel(collapse(a.get('value') || ''));
    });
  }

  facts.headings = readHeadings(s);
  facts.faq = hasQuestionsSection(facts, toLower(s));
  const withoutTitle = removeElements(s, 'title');
  facts.text = cleanText(withoutTitle);
  facts.areaText = readAreaText(withoutTitle);
  facts.scriptBuilt = facts.text.length < 200 && scriptCount > 0;
  return facts;
}
