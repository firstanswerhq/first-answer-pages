// Name matching for the AI visibility grader: is the business named in an AI
// answer, where does it sit in the answer's list, and who else is listed.
// Pure functions. Nothing here logs or stores answer text.

import { normalizeForMatch } from './seance.js';

const LEGAL = new Set([
  'llc', 'inc', 'incorporated', 'co', 'company', 'corp', 'corporation', 'ltd', 'pllc', 'pc', 'lp', 'llp',
]);

// Words that name a trade or service. A name made only of these is not distinctive.
const TRADE = new Set([
  'plumbing', 'plumber', 'plumbers', 'roofing', 'roofer', 'roofers', 'roof', 'roofs',
  'electric', 'electrical', 'electrician', 'electricians', 'hvac', 'heating', 'cooling', 'air',
  'conditioning', 'ac', 'drain', 'drains', 'sewer', 'repair', 'repairs', 'restoration', 'remodeling',
  'construction', 'contractor', 'contractors', 'landscaping', 'landscape', 'landscapers', 'lawn',
  'cleaning', 'cleaners', 'cleaner', 'pressure', 'washing', 'paving', 'concrete', 'pool', 'pools',
  'painting', 'painters', 'painter', 'auto', 'automotive', 'salon', 'salons', 'barber', 'lawyer',
  'lawyers', 'attorney', 'attorneys', 'restaurant', 'restaurants', 'accounting', 'accountants',
  'accountant', 'tax', 'taxes', 'handyman', 'carpentry', 'flooring', 'tile', 'masonry', 'fencing',
]);

// Plain filler words that do not make a name distinctive.
const GENERIC = new Set([
  'the', 'and', 'of', 'best', 'top', 'good', 'great', 'quality', 'affordable', 'local', 'pro',
  'pros', 'professional', 'professionals', 'service', 'services', 'company', 'solutions', 'group',
  'team', 'expert', 'experts', 'city', 'county', 'area', 'metro', 'inc', 'llc',
]);

// Small words allowed to stay lowercase inside a business name.
const CONNECTORS = new Set(['of', 'the', 'and', 'an', 'a', 'for', 'in', 'on', 'to', 'by', 'at', 'is', 'or', 'de', 'la', 'el', 'y', 'n']);

// Words that mark a heading or a tip, never a business.
const HEADING_WORDS = new Set([
  'caveat', 'caveats', 'tip', 'tips', 'note', 'notes', 'summary', 'conclusion', 'disclaimer',
  'disclaimers', 'overview', 'recommendation', 'recommendations', 'consideration', 'considerations',
  'mentions', 'takeaway', 'takeaways', 'thoughts', 'faq', 'faqs', 'verdict',
  'introduction', 'warning', 'warnings', 'reminder', 'reminders', 'checklist', 'questions',
  'resources', 'sources', 'references',
]);

// "Pros" and "Cons" are headings only when they stand alone; "Plumbing Pros of Nashville" is a business.
const HEADING_PHRASES = new Set(['pro', 'pros', 'con', 'cons', 'pros and cons', 'pros cons', 'pros vs cons']);

// Lines that are only an offer, never a business name. Matched as a whole line (normalized), so a
// real name that merely contains these words ("Family Owned Roofing & Repair", "The Local") stays.
const OFFER_LINES = new Set([
  'free estimate', 'free estimates', 'free quote', 'free quotes', 'free consultation', 'free inspection',
  'same day service', 'same day service available', 'same day repair', 'same day repairs',
  '24 7 service', '24 7 emergency service', '24 7 emergency services', 'emergency service', 'emergency services',
  'licensed and insured', 'licensed insured and bonded', 'licensed bonded and insured', 'fully insured',
  'family owned', 'family owned and operated', 'locally owned', 'locally owned and operated',
  'satisfaction guaranteed', 'free estimates available',
]);

/** True when the whole line is a standard offer line. */
const offerOnly = text => OFFER_LINES.has(words(text).join(' '));

// Plural people and category words ("Plumbers", "Restaurants") name a group, not one business.
const GROUP_NOUNS = new Set([
  'plumber', 'plumbers', 'roofer', 'roofers', 'electrician', 'electricians', 'landscapers', 'cleaners',
  'cleaner', 'painters', 'painter', 'lawyer', 'lawyers', 'attorney', 'attorneys', 'restaurant', 'restaurants',
  'accountants', 'accountant', 'contractor', 'contractors', 'salons', 'pools', 'barber',
]);

/**
 * Does this heading read like ONE business? It has a legal word (LLC, Inc, Co), a possessive, or a
 * trade word that names work rather than people (Plumbing, Roofing, Heating). A group, a category or a
 * place ("Emergency Plumbers", "Budget Picks", "Fine Dining", "Germantown") does not.
 */
function looksLikeOneBusiness(text) {
  if (/['\u2019]s\b/.test(text)) return true;
  const list = words(text);
  return list.some(w => LEGAL.has(w) || (TRADE.has(w) && !GROUP_NOUNS.has(w)));
}

// Labels that start a "Label: value" detail line. Anything else before a colon or a dash is a name.
const DETAIL_LABELS = new Set([
  'known for', 'best for', 'must try', 'price', 'price range', 'pricing', 'cost', 'phone', 'address', 'hours',
  'why', 'rating', 'ratings', 'specialty', 'specialties', 'notes', 'note', 'tip', 'tips', 'services', 'service',
  'location', 'locations', 'contact', 'website', 'email', 'review', 'reviews', 'details', 'highlights', 'features',
  'pros', 'cons', 'area', 'neighborhood', 'neighbourhood', 'cuisine', 'vibe', 'style', 'focus', 'best', 'known',
]);

/** Plural group words in a heading ("Emergency Plumbers", "Budget Picks"): a group, not one business. */
const PLURAL_GROUP_WORDS = new Set([
  'plumbers', 'roofers', 'electricians', 'landscapers', 'cleaners', 'painters', 'lawyers', 'attorneys',
  'restaurants', 'accountants', 'contractors', 'salons', 'picks', 'options', 'spots', 'places', 'choices',
  'companies', 'businesses', 'shops', 'favorites', 'recommendations',
]);

const hasGroupWord = text => words(text).some(w => PLURAL_GROUP_WORDS.has(w));

const isDetailLabel = text => DETAIL_LABELS.has(words(text).join(' '));

/** Splits "Name: description", "Name - description" or "[Name](link): description" at the first separator. */
function splitLead(content) {
  const text = stripMarkdown(content).trim();
  const m = /\s[-\u2013\u2014]\s|[\u2013\u2014]|:|\s\|\s|\(/.exec(text);
  if (!m) return { lead: trimName(text), rest: '', sep: '' };
  const sep = m[0] === ':' ? 'colon' : /[-\u2013\u2014]/.test(m[0]) ? 'dash' : 'other';
  return { lead: trimName(text.slice(0, m.index)), rest: text.slice(m.index + m[0].length).trim(), sep };
}

/** The Title Case name a plain sentence starts with ("Music City Roofing, which handles storm repairs."), or ''. */
function sentenceLead(content) {
  const tokens = stripMarkdown(content).trim().split(/\s+/);
  const out = [];
  let lastCap = -1;
  let capped = 0;
  for (const raw of tokens) {
    const bare = raw.replace(/[,.;:!?)]+$/, '');
    const first = Array.from(bare.replace(/^[^\p{L}\p{N}&]+/u, ''))[0] ?? '';
    const upper = /\p{Lu}/u.test(first);
    const cap = upper || /\p{N}/u.test(first) || bare === '&';
    const joiner = CONNECTORS.has(bare.toLowerCase());
    if (!cap && !joiner) break;
    out.push(bare);
    if (cap) {
      lastCap = out.length - 1;
      if (upper) capped += 1;
    }
    if (/[,;:.!?]$/.test(raw) || raw.includes('(')) break; // punctuation ends the name
  }
  if (lastCap < 0 || capped < 2) return '';
  const name = out.slice(0, lastCap + 1).join(' ');
  return validName(name, 2) ? name : '';
}

/** A one-word or short name that is the business itself, read from the text before a separator. */
function ownLead(text, own) {
  if (!own) return '';
  const lead = trimName(cutAtSeparator(stripMarkdown(String(text))));
  return lead && lead.split(/\s+/).length <= 5 && own(lead) ? lead : '';
}

/**
 * The names a bullet gives. "Label: value" lines (Known For, Best For, Phone, ...) are details and give
 * none. "Name: description", "Name - description" and "[Name](link): description" give the name before the
 * separator, even a single word. A plain sentence that starts with a business name gives that name.
 */
function namesFromBullet(content, own) {
  const c = String(content).trim();
  if (/^\*\*[^*]*:\*\*\s*\S/.test(c)) return []; // "**Best for:** emergencies"
  const { lead, rest, sep } = splitLead(c);
  if (rest && isDetailLabel(lead)) return [];
  const names = fromListContent(c, false);
  if (names.length > 0) return names;
  if ((sep === 'colon' || sep === 'dash') && rest && lead && !isDetailLabel(lead) && validName(lead, 1)) return [lead];
  const sentence = sentenceLead(c);
  if (sentence) return [sentence];
  const mine = ownLead(c, own);
  return mine ? [mine] : [];
}

/** The names on the bullet lines right after line `i` (a heading), through blank lines. */
function bulletNamesAfter(lines, i, own) {
  const names = [];
  for (let k = i + 1; k < lines.length && k <= i + 40; k += 1) {
    const line = lines[k];
    if (line.trim() === '') continue;
    const li = line.match(LIST_RE);
    if (!li || !/^[-*\u2022]/.test(li[2])) break;
    names.push(...namesFromBullet(li[3], own).filter(n => !offerOnly(n)));
  }
  return names;
}

/** The names a numbered heading ("### 2. Joes Plumbing" or "**2. Joes Plumbing**") gives, or null when the line is not one. */
function numberedHeadingNames(line, own) {
  const h = line.match(HEADING_RE);
  if (h) {
    const numbered = h[1].trim().match(/^\d+[.)]\s+(.*)$/);
    if (!numbered) return null;
    const names = fromListContent(numbered[1]);
    if (names.length > 0) return names;
    const mine = ownLead(numbered[1], own);
    return mine ? [mine] : [];
  }
  if (/^\s*\|/.test(line) || LIST_RE.test(line)) return null;
  const sb = line.match(STANDALONE_BOLD_RE);
  if (!sb || !/^\s*\d+[.)]/.test(sb[1])) return null;
  const names = fromStandaloneBold(sb[1]);
  if (names.length > 0) return names;
  const mine = ownLead(sb[1].replace(/^\s*\d+[.)]\s*/, ''), own);
  return mine ? [mine] : [];
}

// Review sites and directories that show up in bold but are not the businesses.
const BLOCK_WORDS = new Set([
  'google', 'yelp', 'bbb', 'bureau', 'review', 'reviews', 'angi', 'angie', 'homeadvisor',
  'thumbtack', 'facebook', 'nextdoor', 'reddit', 'bing', 'yahoo',
]);

const SKIP_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'yelp.com', 'linkedin.com', 'google.com', 'twitter.com', 'x.com',
  'youtube.com', 'tiktok.com', 'nextdoor.com', 'angi.com', 'homeadvisor.com', 'thumbtack.com',
  'bbb.org', 'wixsite.com', 'weebly.com', 'squarespace.com', 'wordpress.com', 'godaddysites.com',
]);

const TWO_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'com.br',
  'co.jp', 'co.in', 'com.mx',
]);

const MAX_COMPETITORS = 5;

// ---- small helpers --------------------------------------------------------------

function words(s) {
  const n = normalizeForMatch(s);
  return n === '' ? [] : n.split(' ');
}

function stripLegal(list) {
  const w = list.slice();
  while (w.length) {
    const n = w.length;
    if (n >= 3 && w[n - 3] === 'l' && w[n - 2] === 'l' && w[n - 1] === 'c') { w.length = n - 3; continue; }
    if (n >= 2 && w[n - 2] === 'p' && w[n - 1] === 'c') { w.length = n - 2; continue; }
    if (n >= 2 && w[n - 2] === 'l' && w[n - 1] === 'p') { w.length = n - 2; continue; }
    if (LEGAL.has(w[n - 1])) { w.pop(); continue; }
    break;
  }
  return w;
}

/** Normalized words with a leading "the" and trailing legal words removed. */
function baseWords(name) {
  let w = words(name);
  if (w.length > 1 && w[0] === 'the') w = w.slice(1);
  const stripped = stripLegal(w);
  return stripped.length ? stripped : w;
}

function singular(w) {
  return w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
}

/** Context words that are never distinctive: the business's service, city and state. */
function contextSets(ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const service = new Set();
  for (const w of words(c.service)) { service.add(w); service.add(singular(w)); }
  const place = new Set([...words(c.city), ...words(c.state)]);
  return { service, place };
}

function isTradeWord(w, sets) {
  return TRADE.has(w) || sets.service.has(w);
}

function allGeneric(list, sets) {
  return list.length > 0 && list.every(w => GENERIC.has(w) || isTradeWord(w, sets) || sets.place.has(w));
}

function levenshtein(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

// ---- exported name helpers ------------------------------------------------------

/**
 * The name without "the" and legal words, normalized. Null when it is too short
 * (under 2 words and under 6 characters) or every word is a service, city,
 * state or generic word.
 */
export function shortName(name, ctx = {}) {
  const w = baseWords(name);
  if (!w.length) return null;
  if (allGeneric(w, contextSets(ctx))) return null;
  const s = w.join(' ');
  return w.length >= 2 || s.length >= 6 ? s : null;
}

/**
 * The distinctive words before the first trade word ("hiller" for "Hiller
 * Plumbing, Heating ..."). Empty when there are none, when all are generic, or
 * when they are too short to trust.
 */
export function coreName(name, ctx = {}) {
  const sets = contextSets(ctx);
  const core = [];
  for (const w of baseWords(name)) {
    if (isTradeWord(w, sets)) break;
    core.push(w);
  }
  if (!core.length || allGeneric(core, sets)) return '';
  const s = core.join(' ');
  return core.length >= 2 || s.length >= 6 ? s : '';
}

/** The registered domain of a website ("example.co.uk"), or null. */
export function registeredDomain(website) {
  if (typeof website !== 'string') return null;
  let s = website.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let host;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (/^\d+(\.\d+){3}$/.test(host)) return null;
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const last2 = labels.slice(-2).join('.');
  if (labels.length >= 3 && TWO_PART_SUFFIXES.has(last2)) return labels.slice(-3).join('.');
  return last2;
}

// ---- reading a list out of an answer --------------------------------------------

const LIST_RE = /^(\s*)(\d+[.)]|[-*•])\s+(.*)$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;
const STANDALONE_BOLD_RE = /^\s*\*\*([^*]+)\*\*\s*:?\s*$/;

function stripMarkdown(s) {
  return String(s).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '').replace(/\*+/g, '');
}

function cutAtSeparator(s) {
  const at = s.search(/\s[-–—]\s|[–—]|\s\|\s|:|\(/);
  return (at === -1 ? s : s.slice(0, at)).trim();
}

function trimName(s) {
  return String(s).trim().replace(/[\s.,;:!?]+$/, '').trim();
}

/** No heading word, review-site word, or lone "Pros" / "Cons". */
function notAHeading(text) {
  const list = words(text);
  if (HEADING_PHRASES.has(list.join(' '))) return false;
  return !list.some(w => HEADING_WORDS.has(w) || BLOCK_WORDS.has(w));
}

/** Does this text read like a business name? Title case, no heading or review-site words. */
function validName(text, minWords) {
  if (text.length < 2 || text.length > 60) return false;
  if (!/^[\p{L}\p{N}]/u.test(text)) return false;
  const tokens = text.split(/\s+/);
  const count = tokens.filter(t => /[\p{L}\p{N}]/u.test(t)).length;
  if (count < minWords) return false;
  for (const tok of tokens) {
    const bare = tok.replace(/^[^\p{L}\p{N}]+/u, '');
    if (!bare) continue;
    const first = Array.from(bare)[0];
    if (/\p{N}/u.test(first) || /\p{Lu}/u.test(first)) continue;
    if (CONNECTORS.has(bare.toLowerCase().replace(/[^\p{L}]/gu, ''))) continue;
    return false;
  }
  return notAHeading(text);
}

/** Bold spans inside a line of running text. */
function boldSpans(line) {
  const out = [];
  for (const m of line.matchAll(/\*\*([^*]+?)\*\*/g)) {
    const after = line.slice(m.index + m[0].length);
    if (/:\s*$/.test(m[1]) && /^\s*\S/.test(after)) continue; // "**Label:** text"
    const t = trimName(stripMarkdown(m[1]));
    if (validName(t, 2)) out.push(t);
  }
  return out;
}

/**
 * A plain line of a top-level numbered list that does not read as title case,
 * such as "Before booking". The AI chose to list it, so it is read as a name; a
 * second look (Gemini) may still drop it. Never used for bullets or nested lines.
 */
function looseName(text) {
  if (text.length < 4 || text.length > 40) return false;
  if (!/^[\p{L}\p{N}]/u.test(text)) return false;
  const tokens = text.split(/\s+/);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (!/[\p{Lu}\p{N}]/u.test(Array.from(tokens[0])[0])) return false;
  return notAHeading(text);
}

/** Names from the text after a list marker. `loose` is true for an unindented numbered line. */
function fromListContent(content, loose = false) {
  const c = content.trim();
  if (/^\*\*[^*]*:\*\*\s*\S/.test(c)) return [];
  const b = c.match(/^\*\*([^*]+)\*\*/);
  if (b) {
    const bold = trimName(stripMarkdown(b[1]));
    const whole = trimName(cutAtSeparator(stripMarkdown(c)));
    if (whole.length > bold.length && whole.startsWith(bold) && validName(whole, 1)) return [whole];
    if (validName(bold, 1)) return [bold];
    return boldSpans(c);
  }
  const plain = trimName(cutAtSeparator(stripMarkdown(c)));
  if (validName(plain, 2)) return [plain];
  if (loose && looseName(plain)) return [plain];
  return boldSpans(c);
}

function fromStandaloneBold(inner) {
  const t = trimName(stripMarkdown(inner).replace(/^\s*\d+[.)]\s*/, ''));
  return validName(t, 1) ? [t] : [];
}

function isTableSeparator(line) {
  return typeof line === 'string' && /^[\s|:-]+$/.test(line) && line.includes('-');
}

function fromTableRow(line, next) {
  if (isTableSeparator(line) || isTableSeparator(next)) return [];
  const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  const cell = cells.find(c => /\p{L}/u.test(c));
  if (!cell) return [];
  const t = trimName(cutAtSeparator(stripMarkdown(cell)));
  return validName(t, 2) ? [t] : [];
}

/**
 * Every name listed in an answer, in answer order. `prep` (the business being looked for) makes sure the
 * business itself is never dropped by a filter.
 */
function extractEntries(answer, prep) {
  const lines = String(answer ?? '').split(/\r?\n/);
  const entries = [];
  const seen = new Set();
  const own = text => Boolean(prep) && entryMatches(text, prep);
  const push = list => {
    for (const text of list) {
      // A line that is only a standard offer ("Free Estimates", "24/7 Emergency Service") is not a business name.
      if (offerOnly(text) && !own(text)) continue;
      const key = normalizeForMatch(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      entries.push(text);
    }
  };

  // Numbered headings ("### 2. Joes Plumbing", "**2. Joes Plumbing**") are read once for the whole answer.
  const heads = [];
  lines.forEach((line, i) => {
    const names = numberedHeadingNames(line, own);
    if (names) heads.push({ i, names, bullets: bulletNamesAfter(lines, i, own) });
  });
  // If the business is one of the headings, the headings are businesses and their bullets are details.
  // If it is one of the bullets, the headings are groups (categories, places, price bands) and the
  // bullets are the businesses. If it is not in the answer, each heading is judged by what it says.
  let mode = 'auto';
  if (prep) {
    if (heads.some(hd => hd.names.some(own))) mode = 'heading';
    else if (heads.some(hd => hd.bullets.some(own))) mode = 'bullet';
  }
  const headAt = new Map(heads.map(hd => [hd.i, hd]));

  let underBusiness = false; // bullets right after a business heading are its details
  let nestedDetails = false; // indented bullets right after a numbered name are its details

  const heading = hd => {
    underBusiness = false;
    nestedDetails = false;
    if (hd.names.length === 0) return;
    let group;
    if (mode === 'heading') group = false;
    else if (mode === 'bullet') group = true;
    else group = hd.bullets.length > 0 && (hd.names.some(hasGroupWord) || hd.names.every(n => !looksLikeOneBusiness(n)));
    if (group) return; // a group heading is not a name; its bullets are
    push(hd.names);
    underBusiness = true;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      underBusiness = false;
      nestedDetails = false;
      push(fromTableRow(line, lines[i + 1]));
      continue;
    }
    const hd = headAt.get(i);
    if (hd) {
      heading(hd);
      continue;
    }
    const h = line.match(HEADING_RE);
    if (h) {
      // An unnumbered heading ("## Best Overall", "### Tips") is never a name; a bold one ("### **Bob Plumbing:**") can be.
      underBusiness = false;
      nestedDetails = false;
      const bold = h[1].trim().match(STANDALONE_BOLD_RE);
      if (bold) push(fromStandaloneBold(bold[1]));
      continue;
    }
    const li = line.match(LIST_RE);
    if (li) {
      const bullet = /^[-*\u2022]/.test(li[2]);
      const indented = li[1] !== '';
      if (bullet) {
        const names = namesFromBullet(li[3], own);
        if (underBusiness || (nestedDetails && indented)) {
          push(names.filter(own)); // a detail of the name above; only the business itself can still count
          continue;
        }
        if (!indented) nestedDetails = false;
        push(names);
        continue;
      }
      underBusiness = false;
      let names = fromListContent(li[3], !indented);
      if (names.length === 0) {
        const mine = ownLead(li[3], own);
        if (mine) names = [mine];
      }
      // Indented bullets are details only under a numbered NAME. A numbered group label ("1. Best overall:",
      // "2. Best value", "3. **Emergency Plumbers**") is not a name, so the bullets under it are the names.
      const strictNames = fromListContent(li[3], false);
      const groupLabel = /:\s*$/.test(li[3].trim()) || strictNames.length === 0 || strictNames.some(hasGroupWord);
      if (!indented) nestedDetails = names.length > 0 && !groupLabel;
      push(names);
      continue;
    }
    const sb = line.match(STANDALONE_BOLD_RE);
    if (sb) {
      underBusiness = false;
      nestedDetails = false;
      push(fromStandaloneBold(sb[1]));
      continue;
    }
    if (line.includes('**')) push(boldSpans(line));
  }
  return entries;
}

// ---- matching the business ------------------------------------------------------

function prepBusiness(business) {
  const b = business && typeof business === 'object' ? business : {};
  const name = typeof b.name === 'string' ? b.name : '';
  const ctx = { city: b.city, state: b.state, service: b.service };
  const sets = contextSets(ctx);
  const base = baseWords(name);
  const fullNorm = normalizeForMatch(name);
  const generic = base.length === 0 || allGeneric(base, sets);

  const candidates = [];
  if (fullNorm && !generic) candidates.push(fullNorm);
  const sn = shortName(name, ctx);
  if (sn) candidates.push(sn);
  const dom = registeredDomain(b.website);
  if (dom && !SKIP_DOMAINS.has(dom)) candidates.push(normalizeForMatch(dom));

  const own = new Set([...words(name), ...sets.service]);
  return { ctx, generic, hasName: base.length > 0, baseKey: base.join(' '), candidates, own, core: coreName(name, ctx) };
}

function textMatches(answer, prep) {
  const padded = ` ${normalizeForMatch(answer)} `;
  return prep.candidates.some(c => c && padded.includes(` ${c} `));
}

function entryMatches(entry, prep) {
  const key = normalizeForMatch(entry);
  if (!key) return false;
  if (textMatches(entry, prep)) return true;
  if (prep.generic && prep.hasName && baseWords(entry).join(' ') === prep.baseKey) return true;
  if (prep.core) {
    const coreWords = prep.core.split(' ');
    let ew = words(entry);
    if (ew.length > 1 && ew[0] === 'the') ew = ew.slice(1);
    if (
      ew.length >= coreWords.length
      && coreWords.every((w, i) => ew[i] === w)
      && ew.slice(coreWords.length).every(w => prep.own.has(w) || LEGAL.has(w))
    ) return true;
  }
  return false;
}

/**
 * Read an AI answer for one business.
 * @returns {{ named: boolean, position: number|null, total: number, competitors: string[] }}
 *   position is the business's 1-based place in the list read from the answer,
 *   or null. total counts every name in that list.
 */
export function analyzeAnswer(answer, business) {
  const prep = prepBusiness(business);
  const entries = extractEntries(answer, prep);
  let position = null;
  const competitors = [];
  entries.forEach((entry, i) => {
    if (entryMatches(entry, prep)) {
      if (position === null) position = i + 1;
    } else {
      competitors.push(entry);
    }
  });
  const named = position !== null || textMatches(answer, prep);
  return { named, position, total: entries.length, competitors: competitors.slice(0, MAX_COMPETITORS) };
}

/** True when the answer names the business (by name, short name or website). */
export function isNamed(answer, business) {
  return analyzeAnswer(answer, business).named;
}

/** The other businesses an answer lists, in answer order, at most 5. */
export function extractCompetitors(answer, business) {
  return analyzeAnswer(answer, business).competitors;
}

/**
 * Every name listed in an answer, in answer order, each marked with whether the
 * Name_Matcher matches it to the business. Used to ask Gemini about the names we
 * did not match, and to work out the business's place in the list afterwards.
 * @returns {{ name: string, own: boolean }[]}
 */
export function listedNames(answer, business) {
  const prep = prepBusiness(business);
  return extractEntries(answer, prep).map(name => ({ name, own: entryMatches(name, prep) }));
}

function firstIdentifyingWord(name, ctx) {
  const sets = contextSets(ctx);
  for (const w of baseWords(name)) {
    if (GENERIC.has(w) || isTradeWord(w, sets) || sets.place.has(w)) continue;
    return w.length >= 3 ? w : '';
  }
  return '';
}

/**
 * True when a name starts with the same identifying word as the business,
 * give or take a typo. Used to spot a business named under a close spelling.
 */
export function looksLikeSameName(text, business) {
  const b = business && typeof business === 'object' ? business : {};
  const ctx = { city: b.city, state: b.state, service: b.service };
  const a = firstIdentifyingWord(b.name, ctx);
  const t = firstIdentifyingWord(text, ctx);
  if (!a || !t) return false;
  if (Array.from(a)[0] !== Array.from(t)[0]) return false;
  const limit = Math.min(a.length, t.length) >= 8 ? 2 : 1;
  return levenshtein(a, t) <= limit;
}
