// Fix kit: copy-and-paste text built only from typed or found facts.
// All lengths count code points, not UTF-16 units.

import { stripAddressTail } from './schema.js';
import { usAddressStyle } from './address-style.js';

const TITLE_MAX = 60;
const SUMMARY_MAX = 160;
/** What the business label holds for the phone when none was found on the page (V137). */
export const PHONE_PLACEHOLDER = 'ADD YOUR PHONE NUMBER';

const cp = s => Array.from(s);
const len = s => cp(s).length;
const tidy = v => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Cut to at most `max` code points at a word boundary (hard cut for one long word). */
function cutAtWord(s, max) {
  const chars = cp(s);
  if (chars.length <= max) return s;
  const head = chars.slice(0, max).join('');
  if (chars[max] === ' ') return head.trim();
  const i = head.lastIndexOf(' ');
  return (i > 0 ? head.slice(0, i) : head).trim();
}

function clean(found = {}) {
  return {
    name: tidy(found.name),
    service: tidy(found.service),
    city: tidy(found.city),
    state: tidy(found.state).toUpperCase(),
    phone: tidy(found.phone),
    website: tidy(found.website),
    address: tidy(found.address),
    hours: normalizeHours(found.hours),
  };
}

function normalizeHours(hours) {
  if (!hours) return [];
  if (typeof hours === 'string') return tidy(hours) ? [tidy(hours)] : [];
  if (Array.isArray(hours)) return hours.map(tidy).filter(Boolean);
  if (typeof hours === 'object') {
    return Object.entries(hours)
      .map(([day, v]) => (tidy(v) ? `${tidy(day)} ${tidy(v)}` : ''))
      .filter(Boolean);
  }
  return [];
}

function capitalizeFirst(s) {
  const chars = cp(s);
  if (!chars.length) return s;
  return chars[0].toUpperCase() + chars.slice(1).join('');
}

/** Lower-case a service for use in a sentence; words of 2+ letters in all caps stay as typed. */
function serviceInSentence(service) {
  return tidy(service)
    .split(' ')
    .map(w => (len(w) >= 2 && w === w.toUpperCase() && w !== w.toLowerCase() ? w : w.toLowerCase()))
    .join(' ');
}

function place(city, state) {
  if (city && state) return `${city}, ${state}`;
  return city || state;
}

export function suggestedTitle(found) {
  const f = clean(found);
  const tries = [];
  // The service is shown whole or not at all, and the state stays while the city is shown (V118): a shorter
  // try leaves the service out rather than cutting it mid-phrase ("… | Window cleaning and pressure in …").
  if (f.service) {
    const svc = capitalizeFirst(f.service);
    tries.push(`${f.name} | ${svc}${f.city ? ` in ${place(f.city, f.state)}` : ''}`);
  }
  if (f.city && f.state) tries.push(`${f.name} | ${f.city}, ${f.state}`);
  tries.push(f.city ? `${f.name} | ${f.city}` : f.name);
  for (const t of tries) if (len(t) <= TITLE_MAX) return t;
  return cutAtWord(f.name, TITLE_MAX);
}

export function suggestedSummary(found) {
  const f = clean(found);
  const where = place(f.city, f.state);
  let s = f.name;
  if (f.service) s += `: ${serviceInSentence(f.service)}`;
  if (where) s += `${f.service ? ' in' : ':'} ${where}`;
  s += '.';
  if (f.phone) s += ` Call ${f.phone} today.`;
  if (f.city) {
    const extra = ` Serving ${f.city} and nearby areas.`;
    if (len(s + extra) <= SUMMARY_MAX) s += extra;
  }
  return cutAtWord(s, SUMMARY_MAX);
}

/** Placeholders the report's kit puts in for a street or ZIP it couldn't read (batch 5 K13). */
export const STREET_PLACEHOLDER = 'ADD YOUR STREET ADDRESS';
export const ZIP_PLACEHOLDER = 'ADD YOUR ZIP CODE';
/** The line shown above a block that holds a placeholder (K13). */
export const REPLACE_CAPITALS = 'Replace the CAPITAL WORDS before pasting.';

/** True when a built block still holds a placeholder the owner must replace. */
export const hasPlaceholder = text => [PHONE_PLACEHOLDER, STREET_PLACEHOLDER, ZIP_PLACEHOLDER].some(p => String(text).includes(p));

/**
 * The business label (schema.org LocalBusiness markup). `options.placeholders` (the report's kit, K13) puts plain
 * placeholders in for a street and ZIP that couldn't be read, never an invented value. `found.sameAs` is a list of the
 * business's own profile addresses that the check found linked from its website.
 */
export function jsonLdBlock(found, options = {}) {
  const f = clean(found);
  const data = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: f.name };
  // No phone found: a plain placeholder the owner must replace (never an invented number) (V137).
  data.telephone = f.phone || PHONE_PLACEHOLDER;
  if (f.website) data.url = f.website;
  // A business that goes to its customers ("no storefront") names its area and no address at all.
  const noStorefront = found?.noStorefront === true;
  if (!noStorefront && (f.address || f.city || f.state || options.placeholders)) {
    const addr = { '@type': 'PostalAddress' };
    // Only the street goes in streetAddress; the city, state and ZIP each have their own field (V144).
    const whole = usAddressStyle(f.address);
    const street = stripAddressTail(whole, f.city, f.state);
    const zip = street !== whole ? /\b(\d{5}(?:-\d{4})?)\s*$/.exec(whole)?.[1] : undefined;
    if (street) addr.streetAddress = street;
    else if (options.placeholders) addr.streetAddress = STREET_PLACEHOLDER;
    if (f.city) addr.addressLocality = f.city;
    if (f.state) addr.addressRegion = f.state;
    if (zip) addr.postalCode = zip;
    else if (options.placeholders) addr.postalCode = ZIP_PLACEHOLDER;
    data.address = addr;
  }
  if (f.hours.length) data.openingHours = f.hours;
  if (noStorefront) {
    if (f.city) data.areaServed = place(f.city, f.state);
  } else if (f.city) {
    data.areaServed = f.city;
  }
  const sameAs = [...new Set((Array.isArray(found?.sameAs) ? found.sameAs : [])
    .map(u => String(u ?? '').trim()).filter(u => /^https:\/\/[^\s"<>]+$/i.test(u)))];
  if (sameAs.length > 0) data.sameAs = sameAs;
  // Built only from what the owner typed and the page showed: never a rating or a review.
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

export function llmsDraft(found) {
  const f = clean(found);
  const where = place(f.city, f.state);
  const lines = [`# ${f.name}`, ''];
  let summary = f.name;
  if (f.service) summary += `: ${serviceInSentence(f.service)}`;
  if (where) summary += `${f.service ? ' in' : ':'} ${where}`;
  lines.push(`> ${summary}.`, '');
  if (f.service) lines.push(`- Service: ${f.service}`);
  if (where) lines.push(`- Area: ${where}`);
  if (f.phone) lines.push(`- Phone: ${f.phone}`);
  if (f.website) lines.push(`- Website: ${f.website}`);
  if (f.hours.length) lines.push(`- Hours: ${f.hours.join('; ')}`);
  return lines.join('\n') + '\n';
}

export function robotsLines(blockedAgents) {
  const agents = [...new Set((blockedAgents || []).map(a => String(a)))]
    .filter(a => /^[A-Za-z0-9._-]+$/.test(a));
  return agents.map(a => `User-agent: ${a}\nAllow: /`).join('\n\n');
}

// ---- the fix pack (addon-fix-pack) ---------------------------------------------------------------------------------
// New code only: nothing above this line is changed, so the kit's text stays the same for the same input.

// Google Business Profile description limits: taken from the fix-pack spec, not re-checked against Google's help page.
export const GBP_DESCRIPTION_MAX = 750;
export const GBP_ALLOWS_LINKS = false;
export const GBP_ALLOWS_PHONE = false;

/** The fewest FAQ pairs worth pasting; with fewer the pack says what to add first (requirement 7). */
export const FAQ_MIN_PAIRS = 2;
/** Said instead of the FAQ and its markup when fewer than 2 pairs can be built. */
export const FAQ_ADD_FIRST = 'Add what you do and your phone number to your website, then run a new check.';
/** The line above the FAQ markup (requirement 6). */
export const FAQ_MARKUP_LINE = 'Only paste this on a page that also shows these questions and answers to visitors.';
/** Under the Google description when the owner's own words could not be used. */
export const GBP_ABOUT_LEFT_OUT = 'We used what you do instead of your own words, because your words hold a web address, an email, a phone number or an emoji.';
/** The fixed questions, in order. Only the answers hold facts. */
export const FAQ_QUESTIONS = Object.freeze({
  what: 'What do you do?',
  where: 'Where do you work?',
  reach: 'How can I reach you?',
  open: 'When are you open?',
  website: 'What is your website?',
});
/** The plain headings of the pack's parts (the text download and the combined box). */
export const PACK_HEADINGS = Object.freeze({
  gbp: 'Google Business Profile description',
  faq: 'FAQ for your website',
  markup: 'FAQ markup (JSON-LD)',
});
/** In the text download the markup is bare JSON, so the file holds no HTML tags; this line says how to use it. */
export const FAQ_JSON_TEXT_NOTE = 'Paste this inside a script tag of type application/ld+json, on a page that also shows these questions and answers to visitors.';

// One plain line: control characters, direction marks and line breaks removed (requirement 10).
const plainValue = v => String(v ?? '')
  .replace(/[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** The owner's own words, as typed, on one plain line. Kept here so `clean()` is not changed. */
function cleanAbout(about) {
  return plainValue(about);
}

// A web address, an email, 7 or more digits in a row (spaces, dashes, dots and brackets between them count as a row,
// so a typed phone number is caught), or an emoji: the owner's words are then not used in the Google description.
const ABOUT_UNSAFE = /https?:\/\/|www\.|[^\s@]+@[^\s@]+\.[^\s@]|(?:\d[\s().-]{0,2}){6}\d|\p{Extended_Pictographic}/iu;

const aboutUsable = about => about !== '' && !ABOUT_UNSAFE.test(about);

/** One terminal "." added only when the text ends in a letter or a digit; never recased or rewritten. */
const endSentence = s => (/[\p{L}\p{N}]$/u.test(s) ? `${s}.` : s);

/** The pack's facts: the kit's `clean()`, every value on one plain line, plus `about` and the no-storefront flag. */
function packFacts(found = {}) {
  const f = clean(found);
  return {
    name: plainValue(f.name),
    service: plainValue(f.service),
    city: plainValue(f.city),
    state: plainValue(f.state),
    phone: plainValue(f.phone),
    website: plainValue(f.website),
    address: plainValue(f.address),
    hours: f.hours.map(plainValue).filter(Boolean),
    about: cleanAbout(found?.about),
    noStorefront: found?.noStorefront === true,
  };
}

/** True when the owner typed their own words but they could not go in the Google description. */
export function gbpAboutLeftOut(found) {
  const about = cleanAbout(found?.about);
  return about !== '' && !aboutUsable(about);
}

/**
 * The Google Business Profile description: the owner's words (or "{Name} offers {service}."), then the place, at most
 * 750 code points, cut at a word. No web address or phone number is ever put in. '' without a name.
 */
export function gbpDescription(found) {
  const p = packFacts(found);
  if (!p.name) return '';
  const first = aboutUsable(p.about)
    ? endSentence(p.about)
    : (p.service ? `${p.name} offers ${serviceInSentence(p.service)}.` : endSentence(p.name));
  const where = place(p.city, p.state);
  const second = where ? (p.noStorefront ? `Serving ${where} and nearby areas.` : `Serving ${where}.`) : '';
  return cutAtWord([first, second].filter(Boolean).join(' '), GBP_DESCRIPTION_MAX);
}

/**
 * Up to 5 question-and-answer pairs, in a fixed order, each only when its fact is there (never a placeholder).
 * @returns {{ question: string, answer: string }[]}
 */
export function faqPairs(found) {
  const p = packFacts(found);
  if (!p.name) return [];
  const pairs = [];
  if (p.about) pairs.push({ question: FAQ_QUESTIONS.what, answer: endSentence(p.about) });
  else if (p.service) pairs.push({ question: FAQ_QUESTIONS.what, answer: `${p.name} offers ${serviceInSentence(p.service)}.` });
  const where = place(p.city, p.state);
  if (where) {
    let answer = p.noStorefront ? `${p.name} serves ${where} and nearby areas.` : `${p.name} serves ${where}.`;
    // The street address only when the site showed one and the business has a storefront.
    if (!p.noStorefront && p.address) answer += ` The address is ${endSentence(usAddressStyle(p.address))}`;
    pairs.push({ question: FAQ_QUESTIONS.where, answer });
  }
  if (p.phone) pairs.push({ question: FAQ_QUESTIONS.reach, answer: `Call ${p.name} at ${p.phone}.` });
  if (p.hours.length) pairs.push({ question: FAQ_QUESTIONS.open, answer: endSentence(`${p.name} is open ${p.hours.join('; ')}`) });
  if (p.website) pairs.push({ question: FAQ_QUESTIONS.website, answer: `The website is ${p.website}` });
  return pairs;
}

/** The FAQ as plain text: each question on its own line with its answer under it. Fewer than 2 pairs: what to add. */
export function faqText(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (list.length < FAQ_MIN_PAIRS) return FAQ_ADD_FIRST;
  return list.map(({ question, answer }) => `${question}\n${answer}`).join('\n\n');
}

/** The FAQPage JSON itself (with `<` written as \u003c), or '' with fewer than 2 pairs. */
export function faqJsonData(pairs) {
  const list = Array.isArray(pairs) ? pairs : [];
  if (list.length < FAQ_MIN_PAIRS) return '';
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: list.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
  // Never a rating, a review or a claim about search results: only the questions and answers above.
  return JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
}

/** The FAQ markup in its script block, built the way `jsonLdBlock` builds its block. '' with fewer than 2 pairs. */
export function faqJsonLd(pairs) {
  const json = faqJsonData(pairs);
  return json ? `<script type="application/ld+json">\n${json}\n</script>` : '';
}

/**
 * The whole pack under plain headings, parts separated by blank lines. The markup part is there only with 2 or more
 * pairs and a website (it belongs on a page of the website). `markup: 'json'` (the text download) gives the bare JSON
 * with a line saying where it goes, so the file holds no HTML tags; `markup: 'script'` gives the script block.
 */
export function fixPackText(found, { markup = 'json' } = {}) {
  const parts = [];
  const gbp = gbpDescription(found);
  if (gbp) parts.push(`${PACK_HEADINGS.gbp}\n${gbp}`);
  const pairs = faqPairs(found);
  parts.push(`${PACK_HEADINGS.faq}\n${faqText(pairs)}`);
  if (pairs.length >= FAQ_MIN_PAIRS && packFacts(found).website) {
    parts.push(markup === 'script'
      ? `${PACK_HEADINGS.markup}\n${FAQ_MARKUP_LINE}\n${faqJsonLd(pairs)}`
      : `${PACK_HEADINGS.markup}\n${FAQ_JSON_TEXT_NOTE}\n${faqJsonData(pairs)}`);
  }
  return `${parts.join('\n\n')}\n`;
}
