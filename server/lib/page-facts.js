/**
 * page-facts.js — reads one home page into Page_Facts with built-ins only.
 *
 * Elements and comments are removed by indexOf scanning (an unclosed tag cuts
 * to the end of the page), because lazy patterns go quadratic on unclosed
 * tags. Attribute and text patterns run only on short, bounded pieces. Page
 * scripts are never run.
 */

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_TAG_LENGTH = 4000; // an open tag longer than this is treated as junk
const MAX_INNER = 2000; // longest piece of link/button text we look at
const MAX_LABELS = 200;
const MAX_LABEL_READS = 2000; // links and buttons whose text we read; keeps hostile pages fast

export const BUSINESS_TYPES = new Set([
  'LocalBusiness', 'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery',
  'HomeAndConstructionBusiness', 'RoofingContractor', 'HVACBusiness', 'Plumber', 'Electrician',
  'GeneralContractor', 'HousePainter', 'Locksmith', 'MovingCompany', 'AutomotiveBusiness', 'AutoRepair',
  'HealthAndBeautyBusiness', 'HairSalon', 'BeautySalon', 'DaySpa', 'LegalService', 'Attorney',
  'ProfessionalService', 'FinancialService', 'InsuranceAgency', 'RealEstateAgent', 'Dentist',
  'MedicalBusiness', 'Store', 'CleaningService',
]);

// ---- Patterns used by the Checks (all case-insensitive, all bounded) -------

const DAY = '(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const TIME = '\\d{1,2}(?::\\d{2})?\\s?(?:[ap]\\.m\\.|[ap]m\\b)';
export const HOURS_PATTERN = new RegExp(
  `\\b${DAY}\\b[\\s\\S]{0,40}?${TIME}`
  + `|${TIME}[\\s\\S]{0,40}?\\b${DAY}\\b`
  + `|${TIME}\\s?(?:-|\u2013|\u2014|to)\\s?${TIME}`
  + '|\\b24/7\\b|\\bopen 24 hours\\b',
  'i',
);

export const STREET_PATTERN = /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s){0,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Pike|Hwy|Highway|Cir|Circle|Pl|Place|Ter|Terrace)\b/i;

export const CTA_PATTERN = /\b(?:call|book|schedule|quote|estimate|order|reserve|reservation|appointment|get started)\b/i;

// ---- Small string helpers (all linear) --------------------------------------

/** Lower-case ASCII letters only, so the result has exactly the same length. */
const asciiLower = text => text.replace(/[A-Z]+/g, m => m.toLowerCase());

const isBoundary = ch => ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 12 || ch === 62 || ch === 47;

/**
 * indexOf with a cache, for queries whose `from` never goes backwards.
 * Keeps scans linear even when the needle is missing.
 */
function finder(text, needle) {
  let cached = -2;
  return from => {
    if (cached === -1) return -1;
    if (cached < from) cached = text.indexOf(needle, from);
    return cached;
  };
}

function eachOpen(lower, name, visit) {
  const needle = `<${name}`;
  let pos = 0;
  for (;;) {
    const i = lower.indexOf(needle, pos);
    if (i === -1) return;
    if (!isBoundary(lower.charCodeAt(i + needle.length))) { pos = i + 1; continue; }
    const next = visit(i);
    if (next === false) return;
    pos = typeof next === 'number' && next > i ? next : i + 1;
  }
}

/** Remove <!-- ... --> comments. An unclosed comment cuts to the end. */
function removeComments(text) {
  const out = [];
  let pos = 0;
  for (;;) {
    const i = text.indexOf('<!--', pos);
    if (i === -1) { out.push(text.slice(pos)); break; }
    out.push(text.slice(pos, i), ' ');
    const end = text.indexOf('-->', i + 4);
    if (end === -1) break;
    pos = end + 3;
  }
  return out.join('');
}

/** Remove <tag ...> ... </tag> elements. An unclosed element cuts to the end. */
function stripElements(text, tag) {
  const lower = asciiLower(text);
  const close = `</${tag}`;
  const out = [];
  let pos = 0;
  let cut = false;
  eachOpen(lower, tag, i => {
    out.push(text.slice(pos, i), ' ');
    const c = lower.indexOf(close, i + tag.length + 1);
    if (c === -1) { cut = true; return false; }
    const gt = lower.indexOf('>', c);
    if (gt === -1) { cut = true; return false; }
    pos = gt + 1;
    return pos;
  });
  if (!cut) out.push(text.slice(pos));
  return out.join('');
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014',
  rsquo: '\u2019', lsquo: '\u2018', ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026', copy: '\u00a9', reg: '\u00ae',
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
      return String.fromCodePoint(code);
    }
    const hit = NAMED[body.toLowerCase()];
    return hit === undefined ? whole : hit;
  });
}

const collapse = text => text.replace(/\s+/g, ' ').trim();

/** Replace tags with spaces. A "<" not followed by a tag-like character stays. */
function stripTags(text) {
  const out = [];
  const gt = finder(text, '>');
  let pos = 0;
  for (;;) {
    const i = text.indexOf('<', pos);
    if (i === -1) break;
    const c = text.charCodeAt(i + 1);
    const tagLike = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 47 || c === 33 || c === 63;
    if (!tagLike) { out.push(text.slice(pos, i + 1)); pos = i + 1; continue; }
    out.push(text.slice(pos, i), ' ');
    const end = gt(i);
    if (end === -1) { pos = text.length; break; }
    pos = end + 1;
  }
  out.push(text.slice(pos));
  return out.join('');
}

const plainText = html => collapse(decodeEntities(stripTags(html)));

/** Attributes of one short open tag, names lower-cased, values entity-decoded. */
function parseAttrs(tagText) {
  const attrs = new Map();
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tagText)) !== null) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

const cap = (text, n) => Array.from(text).slice(0, n).join('');

// ---- JSON-LD ---------------------------------------------------------------

function typeNames(node) {
  const raw = node && typeof node === 'object' ? node['@type'] : undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(t => typeof t === 'string').map(t => t.slice(t.lastIndexOf('/') + 1));
}

function nodesOf(parsed) {
  const nodes = [];
  const add = value => {
    if (value && typeof value === 'object' && !Array.isArray(value)) nodes.push(value);
  };
  const top = Array.isArray(parsed) ? parsed : [parsed];
  for (const item of top) {
    add(item);
    if (item && typeof item === 'object' && Array.isArray(item['@graph'])) item['@graph'].forEach(add);
  }
  return nodes;
}

const str = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

function readAddress(value) {
  if (typeof value === 'string') return str(value) ? { text: value.trim() } : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const address = {
    street: str(value.streetAddress),
    city: str(value.addressLocality),
    state: str(value.addressRegion),
    postalCode: str(value.postalCode),
  };
  const text = [address.street, address.city, address.state, address.postalCode].filter(Boolean).join(', ');
  return text ? { ...address, text } : undefined;
}

function readHours(node) {
  const out = [];
  const raw = node.openingHours;
  for (const h of Array.isArray(raw) ? raw : [raw]) if (str(h)) out.push(h.trim());
  const spec = node.openingHoursSpecification;
  for (const s of Array.isArray(spec) ? spec : [spec]) {
    if (!s || typeof s !== 'object') continue;
    const days = [].concat(s.dayOfWeek ?? []).filter(d => typeof d === 'string').map(d => d.slice(d.lastIndexOf('/') + 1));
    if (days.length && str(s.opens) && str(s.closes)) out.push(`${days.join(', ')} ${s.opens}-${s.closes}`);
  }
  return out;
}

function readJsonLd(blocks) {
  const result = { blockCount: blocks.length, unreadableCount: 0, types: [], business: null };
  for (const body of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      result.unreadableCount += 1;
      continue;
    }
    for (const node of nodesOf(parsed)) {
      const types = typeNames(node);
      for (const t of types) if (!result.types.includes(t)) result.types.push(t);
      if (result.business) continue;
      const hasPhoneAndAddress = str(node.telephone) && node.address;
      const isBusiness = types.some(t => BUSINESS_TYPES.has(t) || (t === 'Organization' && hasPhoneAndAddress));
      if (!isBusiness) continue;
      result.business = {
        name: str(node.name),
        telephone: str(node.telephone),
        address: readAddress(node.address),
        hours: readHours(node),
        url: str(node.url),
      };
    }
  }
  return result;
}

// ---- Main ------------------------------------------------------------------

/**
 * @param {string} html
 * @returns {object} Page_Facts
 */
export function readPageFacts(html) {
  let s = typeof html === 'string' ? html.slice(0, MAX_HTML_BYTES) : '';
  s = removeComments(s);

  // Count scripts and collect JSON-LD before scripts are removed.
  let lower = asciiLower(s);
  const ldBlocks = [];
  let scriptCount = 0;
  {
    const gt = finder(lower, '>');
    const closeScript = finder(lower, '</script');
    eachOpen(lower, 'script', i => {
      scriptCount += 1;
      const end = gt(i);
      if (end === -1) return false;
      const close = closeScript(end + 1);
      if (end - i <= MAX_TAG_LENGTH) {
        const type = parseAttrs(s.slice(i, end)).get('type');
        if (type && type.trim().toLowerCase().startsWith('application/ld+json')) {
          ldBlocks.push(close === -1 ? s.slice(end + 1) : s.slice(end + 1, close));
        }
      }
      return close === -1 ? false : close;
    });
  }

  for (const tag of ['script', 'style', 'noscript', 'template', 'svg']) s = stripElements(s, tag);
  lower = asciiLower(s);
  // Each scan pass restarts at the top of the page, so each pass needs its own
  // finder (a finder is only valid for queries that never go backwards).
  const openTagAttrs = (gt, i) => {
    const end = gt(i);
    if (end === -1 || end - i > MAX_TAG_LENGTH) return null;
    return { attrs: parseAttrs(s.slice(i, end)), end };
  };

  // title
  let title = '';
  {
    const closeTitle = finder(lower, '</title');
    const gt = finder(lower, '>');
    eachOpen(lower, 'title', i => {
      const end = gt(i);
      if (end === -1) return false;
      const close = closeTitle(end + 1);
      if (close !== -1) title = cap(plainText(s.slice(end + 1, close)), 300);
      return false;
    });
  }

  // meta tags
  const meta = {};
  let hasViewport = false;
  const gtMeta = finder(lower, '>');
  eachOpen(lower, 'meta', i => {
    const tag = openTagAttrs(gtMeta, i);
    if (!tag) return undefined;
    const key = (tag.attrs.get('name') ?? tag.attrs.get('property') ?? '').trim().toLowerCase();
    const content = tag.attrs.get('content');
    if (key === 'viewport') hasViewport = true;
    if (['description', 'og:title', 'og:image'].includes(key) && content !== undefined && !(key in meta)) {
      meta[key] = collapse(content);
    }
    return tag.end + 1;
  });

  // h1s
  const h1s = [];
  {
    const closeH1 = finder(lower, '</h1');
    const gt = finder(lower, '>');
    eachOpen(lower, 'h1', i => {
      const end = gt(i);
      if (end === -1) return false;
      const close = closeH1(end + 1);
      if (close === -1) return false;
      h1s.push(cap(plainText(s.slice(end + 1, close)), 300));
      return close;
    });
  }

  // images
  let imgCount = 0;
  let imgMissingAlt = 0;
  const gtImg = finder(lower, '>');
  eachOpen(lower, 'img', i => {
    const end = gtImg(i);
    if (end === -1) return false;
    imgCount += 1;
    const alt = end - i <= MAX_TAG_LENGTH ? parseAttrs(s.slice(i, end)).get('alt') : undefined;
    if (alt === undefined || alt.trim() === '') imgMissingAlt += 1;
    return end + 1;
  });

  // links (tel: and labels) and buttons
  const telLinks = [];
  const ctaLabels = [];
  let labelReads = 0;
  const canReadLabel = () => labelReads < MAX_LABEL_READS && ctaLabels.length < MAX_LABELS;
  const addLabel = raw => {
    if (!canReadLabel()) return;
    labelReads += 1;
    const label = cap(plainText(raw), 60);
    if (label !== '') ctaLabels.push(label);
  };
  {
    const closeA = finder(lower, '</a');
    const gt = finder(lower, '>');
    eachOpen(lower, 'a', i => {
      const end = gt(i);
      if (end === -1) return false;
      if (end - i <= MAX_TAG_LENGTH) {
        const href = parseAttrs(s.slice(i, end)).get('href');
        if (href !== undefined && href.trim().toLowerCase().startsWith('tel:') && telLinks.length < MAX_LABELS) {
          telLinks.push(href.trim());
        }
      }
      if (canReadLabel()) {
        const close = closeA(end + 1);
        if (close !== -1) addLabel(s.slice(end + 1, Math.min(close, end + 1 + MAX_INNER)));
      }
      return end + 1;
    });
  }
  {
    const closeButton = finder(lower, '</button');
    const gt = finder(lower, '>');
    eachOpen(lower, 'button', i => {
      const end = gt(i);
      if (end === -1) return false;
      if (!canReadLabel()) return false;
      const close = closeButton(end + 1);
      if (close !== -1) addLabel(s.slice(end + 1, Math.min(close, end + 1 + MAX_INNER)));
      return end + 1;
    });
  }
  const gtInput = finder(lower, '>');
  eachOpen(lower, 'input', i => {
    const tag = openTagAttrs(gtInput, i);
    if (!tag) return undefined;
    const type = (tag.attrs.get('type') ?? '').trim().toLowerCase();
    const value = tag.attrs.get('value');
    if ((type === 'submit' || type === 'button') && value) addLabel(value);
    return tag.end + 1;
  });

  // visible text (the title element is not page text)
  const text = plainText(stripElements(s, 'title'));

  return {
    title,
    metaDescription: meta.description ?? '',
    ogTitle: meta['og:title'] ?? '',
    ogImage: meta['og:image'] ?? '',
    hasViewport,
    h1s,
    imgCount,
    imgMissingAlt,
    telLinks,
    ctaLabels,
    text,
    jsonLd: readJsonLd(ldBlocks),
    scriptCount,
    scriptBuilt: text.length < 200 && scriptCount > 0,
  };
}
