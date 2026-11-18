// Reads the facts the Grader needs from a home page's HTML.
// Hand-written and bounded: elements and comments are removed by indexOf
// scanning (an unclosed tag cuts to the end), never by lazy patterns, and no
// page script is ever run.

const MAX_HTML = 2 * 1024 * 1024;
const MAX_TAG = 4000; // longest tag text read for attributes
const MAX_CONTENT = 2000; // longest element text read for labels and headlines
const MAX_LABELS = 200;
const MAX_TEL = 100;
const MAX_H1 = 50;

/** Hours: a day word near a time, a time range, or round-the-clock wording. */
const TIME = String.raw`\d{1,2}(?::\d{2})?\s?(?:(?:am|pm)(?![a-z])|a\.m\.|p\.m\.)`;
const DAY = String.raw`\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b`;
export const HOURS_PATTERN = new RegExp(
  `${DAY}[\\s\\S]{0,40}?${TIME}|${TIME}\\s?(?:-|\u2013|\u2014|to)\\s?${TIME}|24/7|open 24 hours`,
  'i',
);

/** A street address such as "12 Main Street". */
export const STREET_PATTERN =
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Pike|Hwy|Highway|Cir|Circle|Pl|Place|Ter|Terrace)\b/i;

/** Call-to-action words, whole words only. */
export const CTA_PATTERN =
  /\b(?:call|book|schedule|quote|estimate|order|reserve|reservation|appointment|get started)\b/i;

const BUSINESS_TYPES = new Set([
  'LocalBusiness', 'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery',
  'HomeAndConstructionBusiness', 'RoofingContractor', 'HVACBusiness', 'Plumber', 'Electrician',
  'GeneralContractor', 'HousePainter', 'Locksmith', 'MovingCompany', 'AutomotiveBusiness', 'AutoRepair',
  'HealthAndBeautyBusiness', 'HairSalon', 'BeautySalon', 'DaySpa', 'LegalService', 'Attorney',
  'ProfessionalService', 'FinancialService', 'InsuranceAgency', 'RealEstateAgent', 'Dentist',
  'MedicalBusiness', 'Store', 'CleaningService',
]);

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201C', rdquo: '\u201D', hellip: '\u2026', copy: '\u00A9', reg: '\u00AE',
};

function emptyFacts() {
  return {
    title: '',
    metaDescription: '',
    ogTitle: '',
    ogImage: '',
    hasViewport: false,
    h1s: [],
    imgCount: 0,
    imgMissingAlt: 0,
    telLinks: [],
    ctaLabels: [],
    text: '',
    scriptBuilt: false,
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
  return asArray(node['@type']).filter(t => typeof t === 'string');
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
  return types.includes('Organization') && Boolean(str(node.telephone)) && Boolean(node.address);
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
    const text = [street, city, region, postalCode].filter(Boolean).join(', ');
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
  };
}

function readJsonLd(bodies) {
  const result = { blockCount: bodies.length, unreadableCount: 0, blocks: [], types: [], business: null };
  const seen = new Set();
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
      if (!result.business && isBusinessNode(node)) result.business = readBusiness(node);
    }
  }
  return result;
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

    const addLabel = text => {
      const label = text.slice(0, 60).trim();
      if (label && facts.ctaLabels.length < MAX_LABELS) facts.ctaLabels.push(label);
    };

    scan(s, lower, 'a', true, MAX_CONTENT, (tag, start, end) => {
      const href = (readAttrs(tag, 'a').get('href') || '').trim();
      if (/^tel:/i.test(href) && facts.telLinks.length < MAX_TEL) facts.telLinks.push(href);
      addLabel(cleanText(s.slice(start, end)));
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

  facts.text = cleanText(removeElements(s, 'title'));
  facts.scriptBuilt = facts.text.length < 200 && scriptCount > 0;
  return facts;
}
