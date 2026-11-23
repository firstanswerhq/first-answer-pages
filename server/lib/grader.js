/**
 * grader.js — runs an AI Visibility Grade from start to finish.
 *
 * createGrader(deps) returns { start, run, get, peek, isStale, recheck, unlock,
 * claim, startExtraQuestions, remove }. A Grade is stored in the `grades`
 * collection and a Lead in `leads`. The website is read only through the safe
 * fetcher. AI answers are untrusted text: they are stored and read here, never
 * followed, and every page escapes them.
 *
 * Logging: only the Grade_Id, step or error codes, counts and timings. Never
 * typed input, answers, names or lead details.
 */

import { randomBytes } from 'node:crypto';
import { normalizeForMatch } from './seance.js';
import { readPageFacts, STREET_PATTERN } from './page-facts.js';
import { runWebsiteChecks, CHECKS } from './grade-checks.js';
import { scoreGrade } from './grade-score.js';
import { analyzeAnswer, listedNames, looksLikeSameName, registeredDomain } from './name-match.js';
import { DROP_BELOW, NAMED_ABOVE } from './name-check.js';
import {
  normalizePhone, normalizeState, tidyCity, mapCategory, validateFields, US_STATE_CODES, STATE_ERROR,
  reviewsLinkHost, reviewsLinkOnPage, normalizeWebsite,
} from './listing-fields.js';

// ---- constants -------------------------------------------------------------------

export const AI_LIMIT_REACHED = 'AI check limit reached for today';
export const AI_NOT_CONNECTED = "AI check isn't connected";
export const AI_FAILED = "AI didn't answer this time. You can run the check again later.";

const STALE_AFTER_MS = 4 * 60 * 1000;
const REUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const AI_TIMEOUT_MS = 120 * 1000;
const NOTIFY_TIMEOUT_MS = 5 * 1000;
const SECOND_OPINION_TIMEOUT_MS = 45 * 1000; // a second opinion never holds up the report
const RETRY_DEFAULT_SECONDS = 5; // pause before the one retry after a 429 or 529 with no retry-after
const RETRY_MAX_SECONDS = 20;
const DEFAULT_MAX_RUNNING = 20;
const SECOND_RETRY_MAX_SECONDS = 5; // a second opinion's pause before its one retry is never longer than this
const MAX_ANSWER_CODE_POINTS = 4000;
const MAX_NAMES_TO_CHECK = 30;
const MAX_COMPETITORS = 5;
const MAX_SOURCES = 8;
const SECOND_OPINION_RESERVE = 12; // second opinions never use the day's last calls
const SECOND_OPINION_FAILS = 3;
const SECOND_OPINION_PAUSE_MS = 15 * 60 * 1000;
const MAX_TEXT_FOR_PATTERNS = 200000;

const HOME_UNREADABLE = "We couldn't read your home page.";
const TOO_SLOW = 'Your website took too long to answer.';
const WEBSITE_BUDGET_MS = 30 * 1000; // Requirement 2.8: the website steps share 30 seconds

const PROVIDER_LABELS = Object.freeze({
  anthropic: 'Claude',
  openai: 'ChatGPT',
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  perplexity: 'Perplexity',
  mock: 'The demo assistant',
});

/** Plain name of an assistant for sentences, from its provider id. */
export function providerLabel(provider) {
  return Object.hasOwn(PROVIDER_LABELS, provider) ? PROVIDER_LABELS[provider] : 'The assistant';
}

const log = line => process.stderr.write(`[grader] ${line}\n`);

// ---- reading what the visitor typed ----------------------------------------------

const BIDI = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const cleanText = v => String(v ?? '').replace(BIDI, '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
const codePoints = s => Array.from(s).length;

const MESSAGES = Object.freeze({
  name: 'Type your business name (up to 120 characters).',
  city: 'Type your city (up to 80 characters).',
  service: 'Say what you do, like roofers or plumbers (up to 60 characters).',
  website: 'Type your website like example.com.',
});

function readWebsiteInput(text) {
  const t = cleanText(text);
  if (t === '') return { value: null };
  if (/\s/.test(t)) return { error: MESSAGES.website };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: MESSAGES.website };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: MESSAGES.website };
  if (url.username || url.password || !url.hostname.includes('.')) return { error: MESSAGES.website };
  return { value: `${url.protocol}//${url.host}/` };
}

/**
 * Clean and check the grade form. Direction-flipping marks and control
 * characters are removed from every field.
 * @param {object} raw the posted fields
 * @returns {{ ok: boolean, input?: object, values: object, errors: Record<string, string> }}
 */
export function normalizeGradeInput(raw) {
  const src = raw !== null && typeof raw === 'object' ? raw : {};
  const name = cleanText(src.name);
  const city = tidyCity(cleanText(src.city));
  const stateText = cleanText(src.state);
  const state = normalizeState(stateText);
  const service = cleanText(src.service);
  const websiteText = cleanText(src.website);
  const values = { name, city, state: stateText, service, website: websiteText };
  // "We go to our customers (no storefront)": kept only when ticked, so a Grade made without it looks as before.
  // A browser sends "1" (or "on"); a stored input that is read again holds `true`. Anything else is not ticked.
  const noStorefront = src.noStorefront === '1' || src.noStorefront === 'on' || src.noStorefront === true;
  if (noStorefront) values.noStorefront = true;
  const errors = {};
  if (name === '' || codePoints(name) > 120) errors.name = MESSAGES.name;
  if (city === '' || codePoints(city) > 80) errors.city = MESSAGES.city;
  if (!US_STATE_CODES.has(state)) errors.state = STATE_ERROR;
  if (service === '' || codePoints(service) > 60) errors.service = MESSAGES.service;
  const site = readWebsiteInput(websiteText);
  if (site.error) errors.website = site.error;
  if (Object.keys(errors).length > 0) return { ok: false, values, errors };
  const input = { name, city, state, service, website: site.value };
  if (noStorefront) input.noStorefront = true;
  return { ok: true, values, errors, input };
}

/** The key two Grades share when they are about the same business. */
function reuseKey(input) {
  return [
    normalizeForMatch(input.name), normalizeForMatch(input.city), String(input.state).toLowerCase(),
    normalizeForMatch(input.service), registeredDomain(input.website) || '-',
  ].join('|');
}

// ---- the questions and the steps -----------------------------------------------------

// ---- the cleaned service phrase (Feature F, Requirement 24) ------------------------------------------------

/** Nationality and cuisine words that keep their capital. */
const KEEP_CAPITAL = new Set([
  'mexican', 'italian', 'chinese', 'thai', 'japanese', 'indian', 'greek', 'french', 'korean', 'vietnamese',
  'cuban', 'cajun', 'caribbean', 'mediterranean', 'american', 'spanish', 'german', 'irish',
]);

/** Singular last words with their own plural. */
const PLURAL_OF = new Map([
  ['company', 'companies'], ['agency', 'agencies'], ['bakery', 'bakeries'], ['handyman', 'handymen'], ['attorney', 'attorneys'],
]);

/** Singular last words that take "s". A fixed list: there is no general "-er" or "-or" rule. */
const TAKES_S = new Set([
  'contractor', 'shop', 'service', 'crew', 'store', 'salon', 'studio', 'clinic', 'restaurant', 'cafe', 'firm',
  'lawyer', 'doctor', 'plumber', 'roofer', 'painter', 'cleaner', 'landscaper', 'mechanic', 'barber',
  'photographer', 'realtor', 'agent', 'groomer', 'inspector',
]);

const hasLower = w => /\p{Ll}/u.test(w);
const hasUpper = w => /\p{Lu}/u.test(w);
const startsUpper = w => /^\p{Lu}/u.test(w);
// A word that keeps its capitals: all capitals (HVAC, A/C), a capital inside it (iPhone) or a word on the list.
const keepsCapitals = w => !hasLower(w) || /\p{Ll}\p{Lu}/u.test(w) || KEEP_CAPITAL.has(w.toLowerCase());
const lowerFirst = w => {
  const chars = Array.from(w);
  return chars.length === 0 ? w : chars[0].toLowerCase() + chars.slice(1).join('');
};
// The ending in the word's own case: "BUSINESS" gets "ES", every other word a lower-case ending.
const ending = (w, text) => (hasUpper(w) && !hasLower(w) ? text.toUpperCase() : text);

/** The last word made plural by the fixed list, and whether the phrase then names people or businesses. */
function pluralLast(word) {
  const lw = word.toLowerCase();
  if (lw === 'business') return { word: word + ending(word, 'es'), names: true };
  if (lw.endsWith('ss')) return { word, names: false }; // glass, fitness: not a plural
  if (lw.endsWith('s')) return { word, names: true };
  if (PLURAL_OF.has(lw)) {
    const plural = PLURAL_OF.get(lw);
    // Keep the typed letters and change only the ending (company -> compan + ies, handyman -> handym + en).
    let same = 0;
    while (same < lw.length && lw[same] === plural[same]) same += 1;
    return { word: word.slice(0, same) + ending(word, plural.slice(same)), names: true };
  }
  if (TAKES_S.has(lw) || lw.endsWith('ist') || lw.endsWith('ian')) return { word: word + ending(word, 's'), names: true };
  return { word, names: false };
}

/**
 * The service as it reads in a question (Requirement 24). `plain` is the cleaned phrase with its last word made
 * plural by the fixed list ("I need … in …"); `named` adds " businesses" when the phrase does not already name
 * people or businesses (the free question, the second extra question and the scan step). The stored input keeps
 * the service as typed. Never throws: odd input gives a best-effort phrase, and every page escapes it.
 */
export function servicePhrase(service) {
  const text = typeof service === 'string' ? service.replace(/\s+/g, ' ').trim() : '';
  if (text === '') return { plain: '', named: '' };
  try {
    let words = text.split(' ');
    if (words.every(startsUpper)) {
      // "Pressure Washing Companies": every word lower case except the ones that keep their capitals.
      words = words.map(w => (keepsCapitals(w) ? w : w.toLowerCase()));
    } else if (!keepsCapitals(words[0])) {
      words[0] = lowerFirst(words[0]);
    }
    const last = pluralLast(words[words.length - 1]);
    words[words.length - 1] = last.word;
    const plain = words.join(' ');
    return { plain, named: last.names ? plain : `${plain} businesses` };
  } catch {
    return { plain: text, named: text };
  }
}

/** The question in the free part of a report. */
export function freeQuestion(input) {
  return `Who are the best ${servicePhrase(input.service).named} in ${input.city}, ${input.state}? Name your top 5.`;
}

/** The two questions asked after the report is opened. */
export function extraQuestions(input) {
  const { plain, named } = servicePhrase(input.service);
  return [
    `I need ${plain} in ${input.city}, ${input.state}. Which companies would you recommend?`,
    `Which ${named} in ${input.city}, ${input.state} do people say are the most reliable?`,
  ];
}

/** The five Scan_Steps in order. */
export function stepNames(input) {
  return [
    'Finding your website',
    'Reading your home page',
    'Checking what AI is allowed to read',
    `Asking AI to name the best ${servicePhrase(input.service).named} in ${input.city}`,
    'Drafting your free directory listing',
  ];
}

// ---- hours -----------------------------------------------------------------------------

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const CLOCK = String.raw`\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.)?`;
const TIME_RANGE_ANYWHERE = new RegExp(String.raw`${CLOCK}\s*(?:-|\u2013|\u2014|to)\s*${CLOCK}`, 'gi');

function dayIndex(token) {
  const t = token.toLowerCase().replace(/\./g, '');
  return t.length < 2 ? -1 : DAY_NAMES.findIndex(d => d.startsWith(t));
}

/** The days named in a piece of text ("Mo-Fr", "Monday, Wednesday"), or null when unsure. */
function parseDays(text) {
  const days = text
    .replace(/\s*(?:-|\u2013|\u2014)\s*/g, '-')
    .replace(/\s+(?:to|through|thru)\s+/gi, '-')
    .replace(/[:;]+/g, ' ');
  const indexes = new Set();
  for (const token of days.split(/[\s,&]+/).filter(Boolean)) {
    if (/^and$/i.test(token)) continue;
    const parts = token.split('-').filter(Boolean);
    if (parts.length === 2) {
      const a = dayIndex(parts[0]);
      const b = dayIndex(parts[1]);
      if (a === -1 || b === -1) return null;
      for (let i = a; ; i = (i + 1) % 7) {
        indexes.add(i);
        if (i === b) break;
      }
    } else if (parts.length === 1) {
      const i = dayIndex(parts[0]);
      if (i === -1) return null;
      indexes.add(i);
    } else {
      return null;
    }
  }
  return indexes.size > 0 ? indexes : null;
}

/**
 * Turn opening-hours lines such as "Mo-Fr 08:00-17:00", "Mo-Fr 08:00-17:00, Sa
 * 09:00-12:00" or "Monday, Wednesday 9am-5pm" into { monday: '08:00-17:00', ... }.
 * Each time range takes the days written just before it. A line with a part it
 * cannot read for sure (a word that is not a day, days with no time) is left out
 * whole, so the hours stay blank rather than wrong.
 * @param {string[] | undefined} lines
 * @returns {Record<string, string>}
 */
export function hoursToObject(lines) {
  const out = {};
  for (const line of Array.isArray(lines) ? lines : []) {
    if (typeof line !== 'string') continue;
    const found = [];
    let from = 0;
    let sure = true;
    for (const m of line.matchAll(TIME_RANGE_ANYWHERE)) {
      const days = parseDays(line.slice(from, m.index));
      from = m.index + m[0].length;
      if (!days) {
        sure = false;
        break;
      }
      const value = m[0]
        .replace(/\s*(?:-|\u2013|\u2014|\bto\b)\s*/gi, '-')
        .replace(/\s+(?=(?:am|pm|a\.m\.|p\.m\.))/gi, '');
      found.push({ days, value });
    }
    if (!sure || found.length === 0) continue;
    for (const { days, value } of found) {
      for (const i of [...days].sort((x, y) => x - y)) {
        if (out[DAY_NAMES[i]] === undefined) out[DAY_NAMES[i]] = value;
      }
    }
  }
  return out;
}

const SCHEMA_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** "9am" -> "09:00", "17:30" -> "17:30"; null when the time could mean more than one thing. */
function schemaTime(text) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3]?.toLowerCase().replace(/\./g, '');
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (m[2] === undefined) {
    return null; // "9" alone: morning or evening?
  }
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Opening hours in schema.org's own format ("Mo-Fr 08:00-17:00"), for the fix kit's business
 * label. Anything that cannot be read for sure is left out.
 * @param {string[] | undefined} lines
 * @returns {string[]}
 */
export function schemaHours(lines) {
  const byTime = new Map();
  for (const [day, value] of Object.entries(hoursToObject(lines))) {
    const [open, close, extra] = value.split('-');
    const a = schemaTime(open ?? '');
    const b = schemaTime(close ?? '');
    if (!a || !b || extra !== undefined) continue;
    const key = `${a}-${b}`;
    byTime.set(key, [...(byTime.get(key) ?? []), DAY_NAMES.indexOf(day)]);
  }
  const out = [];
  for (const [time, days] of byTime) {
    const sorted = [...days].sort((x, y) => x - y);
    const parts = [];
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
      parts.push(j > i ? `${SCHEMA_DAYS[sorted[i]]}-${SCHEMA_DAYS[sorted[j]]}` : SCHEMA_DAYS[sorted[i]]);
      i = j + 1;
    }
    out.push(`${parts.join(',')} ${time}`);
  }
  return out;
}

const DAY_TITLES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "07:00" -> "7:00 am", "9am" -> "9:00 am"; null when the time could mean more than one thing. */
function readableTime(text) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ?? '00';
  const meridiem = m[3]?.toLowerCase().replace(/\./g, '');
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return `${hour}:${minute} ${meridiem}`;
  }
  if (m[2] === undefined || hour > 23) return null;
  const ampm = hour >= 12 ? 'pm' : 'am';
  hour = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour}:${minute} ${ampm}`;
}

/**
 * Opening hours for people to read: "Monday to Friday, 7:00 am to 6:00 pm". Lines that cannot be
 * read for sure are shown as they were found.
 * @param {string[] | undefined} lines
 * @returns {string[]}
 */
export function readableHours(lines) {
  const found = (Array.isArray(lines) ? lines : []).filter(x => typeof x === 'string' && x.trim() !== '');
  const byDay = hoursToObject(found);
  const days = DAY_NAMES.filter(d => byDay[d] !== undefined);
  if (days.length === 0) return found;
  const out = [];
  for (let i = 0; i < days.length;) {
    let j = i;
    while (
      j + 1 < days.length
      && DAY_NAMES.indexOf(days[j + 1]) === DAY_NAMES.indexOf(days[j]) + 1
      && byDay[days[j + 1]] === byDay[days[i]]
    ) j += 1;
    const first = DAY_TITLES[DAY_NAMES.indexOf(days[i])];
    const last = DAY_TITLES[DAY_NAMES.indexOf(days[j])];
    const label = j === i ? first : j === i + 1 ? `${first} and ${last}` : `${first} to ${last}`;
    const [open, close, extra] = byDay[days[i]].split('-');
    const a = readableTime(open ?? '');
    const b = readableTime(close ?? '');
    out.push(`${label}, ${a && b && extra === undefined ? `${a} to ${b}` : byDay[days[i]]}`);
    i = j + 1;
  }
  return out;
}

/** Providers that are always second opinions; a stored answer from one never counts toward the score. */
const SECOND_OPINION_PROVIDERS = new Set(['chatgpt', 'gemini', 'grok', 'perplexity']);

/** True for a second-opinion answer, whether or not an older Grade marked it. */
export const isSecondOpinion = a => Boolean(a) && (a.second === true || SECOND_OPINION_PROVIDERS.has(a.provider));

/**
 * Phone, hours, address and the best reviews link found on the website. Grades made before `found` existed keep
 * the first three in `facts`; Grades made before review links were read give an empty `reviewsLink`.
 */
export function foundOf(grade) {
  if (grade?.found && typeof grade.found === 'object') {
    const found = grade.found;
    return typeof found.reviewsLink === 'string' ? found : { ...found, reviewsLink: '' };
  }
  const f = grade?.facts && typeof grade.facts === 'object' ? grade.facts : {};
  return {
    phone: typeof f.phone === 'string' ? f.phone : '',
    hours: Array.isArray(f.hours) ? f.hours.filter(x => typeof x === 'string') : [],
    address: typeof f.address === 'string' ? f.address : '',
    website: grade?.input?.website || '',
    reviewsLink: '',
  };
}

/**
 * The website a claim carries over, before `normalizeWebsite` checks it: the check accepts `http` sites and
 * ports, so an `http://` address becomes `https://` with the same host and path and no port (and no user name,
 * query string or `#` part). Nothing is fetched or looked up. '' when there is no usable address.
 * @param {unknown} value the Grade's typed website
 * @returns {string}
 */
export function claimWebsite(value) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return `https://${url.hostname}${url.pathname || '/'}`;
  } catch {
    return '';
  }
}

const REVIEW_SITE_RANK = { google: 0, yelp: 1, facebook: 2, nextdoor: 2 };

/**
 * The best of the home page's review links: a Google link first, then Yelp, then Facebook or Nextdoor, in page
 * order within each kind; an empty string when none passes both review-link checks.
 * @param {unknown} links facts.reviewLinks
 * @returns {string}
 */
export function bestReviewsLink(links) {
  let best = '';
  let bestRank = Infinity;
  for (const link of Array.isArray(links) ? links : []) {
    if (typeof link !== 'string') continue;
    const site = reviewsLinkOnPage(link);
    if (site === '' || reviewsLinkHost(link) === '') continue;
    const rank = REVIEW_SITE_RANK[site];
    if (rank < bestRank) {
      best = link.trim();
      bestRank = rank;
    }
  }
  return best;
}

/**
 * True when the Grade has a number for a Score but the AI part was not checked (Claude did not answer, the
 * daily limit was reached, or the AI check is not connected): the number counts website points only.
 */
export function isPartialScore(grade) {
  const list = Array.isArray(grade?.results) ? grade.results : [];
  return Number.isInteger(grade?.score?.score) && list.some(r => r && r.id === 'ai-named' && r.result === 'not_checked');
}

/** True while a "check again" is really running: it stops counting after 4 minutes, like a stale Grade. */
export function recheckIsRunning(grade, nowMs) {
  if (!grade?.recheckRunning) return false;
  const started = Date.parse(grade.recheckStartedAt);
  return Number.isFinite(started) && nowMs - started <= STALE_AFTER_MS;
}

const DAY_WORD = String.raw`\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b`;
const CLOCK_PM = String.raw`\d{1,2}(?::\d{2})?\s?(?:am|pm)(?![a-z])`;
const HOURS_IN_TEXT = new RegExp(
  `${DAY_WORD}(?:\\s?(?:-|\u2013|\u2014|to|through)\\s?${DAY_WORD})?[:,]?\\s{0,3}${CLOCK_PM}\\s?(?:-|\u2013|\u2014|to)\\s?${CLOCK_PM}`,
  'gi',
);
const PHONE_IN_TEXT = /\(?\d{3}\)?[\s.\-\u2013]+\d{3}[\s.\-\u2013]\d{4}/g;

// ---- what the scan found on the website ---------------------------------------------------

/** Phone, hours and address from the page: the business label first, then tap-to-call links, then the text. */
function foundFromFacts(facts, input) {
  const found = { phone: '', hours: [], address: '', website: input.website || '', reviewsLink: '' };
  if (!facts) return found;
  found.reviewsLink = bestReviewsLink(facts.reviewLinks);
  const business = facts.jsonLd?.business ?? null;
  const text = String(facts.text ?? '').slice(0, MAX_TEXT_FOR_PATTERNS);

  found.phone = normalizePhone(business?.telephone ?? '');
  if (!found.phone) {
    for (const href of facts.telLinks ?? []) {
      found.phone = normalizePhone(String(href).replace(/^tel:/i, ''));
      if (found.phone) break;
    }
  }
  if (!found.phone) {
    for (const m of text.matchAll(PHONE_IN_TEXT)) {
      found.phone = normalizePhone(m[0]);
      if (found.phone) break;
    }
  }

  if (business?.hours?.length) {
    found.hours = business.hours.slice(0, 7);
  } else {
    const seen = new Set();
    for (const m of text.matchAll(HOURS_IN_TEXT)) {
      const h = m[0].replace(/\s+/g, ' ').trim();
      if (!seen.has(h.toLowerCase())) {
        seen.add(h.toLowerCase());
        found.hours.push(h);
      }
      if (found.hours.length >= 3) break;
    }
  }

  found.address = business?.address?.text || (STREET_PATTERN.exec(text)?.[0] ?? '');
  return found;
}

/** The facts kept on a Grade: only what the business published on its own website. */
function storedFacts(facts, found) {
  if (!facts) return null;
  return {
    title: facts.title,
    metaDescription: facts.metaDescription,
    ogImage: Boolean(facts.ogImage),
    h1s: facts.h1s.slice(0, 12),
    imgCount: facts.imgCount,
    imgMissingAlt: facts.imgMissingAlt,
    telCount: facts.telLinks.length,
    phone: found.phone,
    hours: found.hours,
    address: found.address,
    jsonLdTypes: facts.jsonLd.types.slice(0, 20),
    jsonLdBlocks: facts.jsonLd.blockCount,
    jsonLdUnreadable: facts.jsonLd.unreadableCount,
    scriptBuilt: facts.scriptBuilt,
    hasViewport: facts.hasViewport,
  };
}

function failureFor(err) {
  switch (err?.code) {
    case 'blocked_address': return "We can't visit that address because it isn't a public website.";
    case 'timeout': return TOO_SLOW;
    case 'too_large': return 'Your home page is too large to check.';
    default: return undefined;
  }
}

const looksLikeHtml = res => /html/i.test(String(res.contentType ?? ''))
  || /^\s*(?:<!doctype\s+html|<html)/i.test(String(res.text ?? '').slice(0, 200));

// ---- AI answers -------------------------------------------------------------------------------

const codeOf = err => (
  err && ['timeout', 'provider_failed', 'unparseable'].includes(err.code) ? err.code : 'internal'
);

function coded(code) {
  return Object.assign(new Error(code), { code });
}

/** True when a provider answered 429 (rate limited) or 529 (overloaded). */
const isBusy = err => Boolean(err) && (err.status === 429 || err.status === 529);

/** Wait `ms`, ending early with a timeout error when `signal` aborts. */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(coded('timeout'));
    }, { once: true });
  });
}

/** Run `fn(signal)` with a deadline; the signal aborts when time runs out. */
async function withDeadline(fn, ms) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(coded('timeout'));
    }, ms);
  });
  try {
    return await Promise.race([(async () => fn(ctrl.signal))(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One shared deadline. `timeout` rejects when it passes; `expired` turns true then.
 * `stop()` clears the timer, so a finished run leaves nothing waiting.
 */
function startBudget(ms) {
  let timer;
  let expired = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(coded('timeout'));
    }, ms);
  });
  timeout.catch(() => {}); // no unhandled rejection when nothing is racing it
  return { timeout, get expired() { return expired; }, stop: () => clearTimeout(timer) };
}

/** Race a promise against the shared deadline; the loser's later result or error is ignored. */
function within(budget, promise) {
  Promise.resolve(promise).catch(() => {});
  return Promise.race([promise, budget.timeout]);
}

const cut = (text, max) => {
  const chars = Array.from(text);
  return chars.length > max ? { text: chars.slice(0, max).join(''), cut: true } : { text, cut: false };
};

function safeSources(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(s => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url) && typeof s.title === 'string')
    .slice(0, MAX_SOURCES)
    .map(s => ({ url: s.url, title: s.title }));
}

/** The ai-named Check from the main assistant's answers. */
function aiNamedResult(ai, aiMain) {
  const main = ai.filter(a => !isSecondOpinion(a));
  if (main.length === 0) {
    const detail = aiMain?.state === 'limit' ? AI_LIMIT_REACHED
      : aiMain?.state === 'not_connected' ? AI_NOT_CONNECTED
        : AI_FAILED;
    return { id: 'ai-named', result: 'not_checked', detail };
  }
  const label = providerLabel(main[0].provider);
  const ran = main.length;
  const named = main.filter(a => a.named).length;
  const earned = Math.round((30 * named) / ran);
  let detail;
  if (ran === 1) {
    detail = named ? `Yes. ${label} named your business.` : `No. ${label} did not name your business.`;
  } else {
    detail = named
      ? `Yes. ${label} named your business in ${named} of ${ran} answers.`
      : `No. ${label} did not name your business in any of ${ran} answers.`;
  }
  return { id: 'ai-named', result: named > 0 ? 'pass' : 'fail', detail, earned };
}

/** Website results plus the ai-named result, in the order of the CHECKS table. */
function assemble(websiteResults, ai, aiMain) {
  const all = [...websiteResults.filter(r => r.id !== 'ai-named'), aiNamedResult(ai, aiMain)];
  const order = new Map(CHECKS.map((c, i) => [c.id, i]));
  return all.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
}

/** The Score number a report shows for a Grade (the same rule as `reportPage`), or null. */
export function shownScore(grade) {
  const results = Array.isArray(grade?.results)
    ? grade.results.filter(r => r && typeof r === 'object' && typeof r.id === 'string')
    : [];
  const stored = Number.isInteger(grade?.score?.score) ? grade.score.score : null;
  if (results.length === 0) return stored;
  try {
    const { score } = scoreGrade(results);
    return Number.isInteger(score) ? score : null;
  } catch {
    return stored;
  }
}

function scoreOf(results) {
  const { score, earned, available, failed, counted, byGroup } = scoreGrade(results);
  return { score, earned, available, failed, counted, byGroup };
}

// ---- the grader --------------------------------------------------------------------------------

/**
 * @param {{
 *   store: object, assistantProvider: object, extraAssistants?: object[], nameChecker?: object|null,
 *   aiBudget: object, safeFetcher: object, draftStore: object, notifier?: object,
 *   clock: { now(): number }, newId: () => string, config: object,
 * }} deps
 */
export function createGrader({
  store, assistantProvider, extraAssistants = [], nameChecker = null, aiBudget, safeFetcher,
  draftStore, notifier, clock, newId, config = {}, websiteBudgetMs = WEBSITE_BUDGET_MS, guard = null,
  // Injectable so tests need no real waiting: the pause before a retry and a second opinion's time limit.
  sleep = pause, secondOpinionTimeoutMs = SECOND_OPINION_TIMEOUT_MS,
}) {
  const grades = () => store.collection('grades');
  const leads = () => store.collection('leads');
  const nowIso = () => new Date(clock.now()).toISOString();
  const extras = Array.isArray(extraAssistants) ? extraAssistants : [];
  const live = new Map(); // Grade_Id -> running Grade, so status.json need not read the file
  const active = new Map(); // Grade_Id -> promise of the run, so one id runs once
  const secondOpinion = new Map(); // assistant name -> { fails, until }
  // At most GRADE_MAX_RUNNING checks run at once; the rest wait here, first in first out.
  const maxRunning = Number.isInteger(config.gradeMaxRunning) && config.gradeMaxRunning > 0
    ? config.gradeMaxRunning
    : DEFAULT_MAX_RUNNING;
  const waiting = []; // Grade_Ids in line

  // GRADE_MAIN_ASKS: 1 to 3; a missing or odd value counts as 3 (config.js has already checked a set value).
  const mainAsks = () => (Number.isInteger(config.gradeMainAsks) && config.gradeMainAsks >= 1 && config.gradeMainAsks <= 3
    ? config.gradeMainAsks
    : 3);

  const watchGuard = () => {
    try {
      guard?.watch?.();
    } catch {
      // watching the day's use must never stop a check
    }
  };

  const background = (id, label, fn) => {
    Promise.resolve().then(fn).catch(() => log(`${label}-failed id=${id}`));
  };

  async function get(id) {
    const list = await grades().read();
    return Array.isArray(list) ? list.find(g => g && g.id === id) : undefined;
  }

  // A check counts from when it started running (`startedAt`), not from when it was created, so one
  // that waited in line is not failed for the time it waited. A check still in this process's line is
  // never stale; one left over from before a restart has no place in the line and goes stale as before.
  const isStale = (grade, now) => Boolean(grade)
    && grade.status === 'running'
    && !waiting.includes(grade.id)
    && now - Date.parse(grade.startedAt || grade.createdAt) > STALE_AFTER_MS;

  // ---- reading one answer ----------------------------------------------------------------

  /** Our own reading of an answer, then Gemini's second look when a checker is on. */
  async function readAnswer(answer, input, provider) {
    const business = { name: input.name, city: input.city, state: input.state, service: input.service, website: input.website };
    const base = analyzeAnswer(answer, business);
    const plain = { named: base.named, position: base.position, total: base.total, competitors: base.competitors };
    if (!nameChecker || provider === 'mock') return plain;

    const list = listedNames(answer, business);
    const names = list.filter(e => !e.own).map(e => e.name).slice(0, MAX_NAMES_TO_CHECK);
    if (names.length === 0) return plain;

    let verdict = null;
    try {
      verdict = await nameChecker.check({
        answer, business: { name: input.name, city: input.city, state: input.state }, names,
      });
    } catch {
      verdict = null;
    }
    // Asked once: a failed or unreadable reply is not asked for again every time the answer is carried over.
    if (!verdict || !verdict.isBusiness || !verdict.sameAs) return { ...plain, tried: true };

    const dropped = new Set();
    for (const name of names) {
      const p = verdict.isBusiness.get(name);
      if (typeof p === 'number' && p < DROP_BELOW) dropped.add(name);
    }
    let added = null;
    if (!base.named) {
      for (const name of names) {
        if (dropped.has(name)) continue;
        const s = verdict.sameAs.get(name);
        if (typeof s === 'number' && s >= NAMED_ABOVE && looksLikeSameName(name, business)) {
          added = name;
          break;
        }
      }
    }
    const kept = list.filter(e => !dropped.has(e.name));
    const at = kept.findIndex(e => e.own || e.name === added);
    return {
      named: base.named || added !== null,
      position: at === -1 ? null : at + 1,
      total: kept.length,
      competitors: kept.filter(e => !e.own && e.name !== added).map(e => e.name).slice(0, MAX_COMPETITORS),
      nameCheck: { by: nameChecker.name || 'gemini-decisions', dropped: dropped.size, addedNamed: added !== null },
      tried: true,
    };
  }

  async function buildEntry({ assistant, second, prompt, input, result, ms }) {
    const full = result.answer.trim();
    const { text, cut: wasCut } = cut(full, MAX_ANSWER_CODE_POINTS);
    const provider = typeof result.provider === 'string' && result.provider !== '' ? result.provider : assistant.name;
    const read = await readAnswer(full, input, provider);
    const entry = {
      prompt,
      provider,
      model: typeof result.model === 'string' ? result.model : '',
      webSearch: result.webSearch === true,
      answer: text,
      named: read.named,
      position: read.position,
      total: read.total,
      competitors: read.competitors,
      ms,
      at: nowIso(),
    };
    if (wasCut) entry.answerCut = true;
    if (second) entry.second = true;
    if (read.nameCheck) entry.nameCheck = read.nameCheck;
    if (read.tried) entry.nameCheckTried = true;
    const sources = safeSources(result.sources);
    if (sources.length > 0) entry.sources = sources;
    return entry;
  }

  // ---- second opinions that keep failing ---------------------------------------------------

  const isPaused = name => (secondOpinion.get(name)?.until ?? 0) > clock.now();

  function noteSecond(name, ok) {
    if (ok) {
      secondOpinion.set(name, { fails: 0, until: 0 });
      return;
    }
    const state = secondOpinion.get(name) ?? { fails: 0, until: 0 };
    state.fails += 1;
    if (state.fails >= SECOND_OPINION_FAILS) {
      state.fails = 0;
      state.until = clock.now() + SECOND_OPINION_PAUSE_MS;
    }
    secondOpinion.set(name, state);
  }

  /**
   * Ask one question of the main assistant and of each second opinion that may be asked.
   * `existing` holds answers already on the Grade (carried over or asked earlier).
   * @returns {Promise<{ entries: object[], mainState: 'ok'|'limit'|'failed'|'not_connected'|'off' }>}
   */
  async function askQuestion({ input, prompt, existing, onSecond, gradeId, asks = 1 }) {
    const main = assistantProvider;
    const mainName = main?.name ?? 'unknown';
    const isMock = mainName === 'mock';
    const category = mapCategory(input.service, store.getCategories()) || '';
    const have = name => existing.some(a => a.prompt === prompt && a.provider === name);
    // Every counted call is followed by a look at the day's use (the heads-up emails); it never waits or throws.
    const consume = () => {
      const counted = aiBudget.consume({ kind: 'grade' }).allowed === true;
      if (counted) watchGuard();
      return counted;
    };
    // More than 12 of the Grader's calls left: the reserve that keeps the day's last calls for other owners.
    const aboveReserve = () => aiBudget.peek({ kind: 'grade' }).remaining > SECOND_OPINION_RESERVE;

    // How many times the main assistant is asked this question (Feature E). The demo assistant gives the same
    // answer to the same prompt, so it is asked once.
    const wanted = Number.isInteger(asks) && asks >= 1 ? Math.min(asks, 3) : 1;
    const planned = isMock ? 1 : wanted;

    let mainState = 'ok';
    const plans = [];
    if (!main) mainState = 'off';
    else if (have(mainName)) mainState = 'ok';
    else if (isMock && config.production === true) mainState = 'not_connected';
    else if (!isMock && !consume()) mainState = 'limit';
    else {
      // Ask 1 as today; asks 2 and up only while more than 12 calls remain, each charged when it is planned.
      plans.push({ assistant: main, second: false, ask: 1 });
      for (let k = 2; k <= planned; k += 1) {
        if (!aboveReserve() || !consume()) break;
        plans.push({ assistant: main, second: false, ask: k });
      }
    }
    const asked = plans.length;

    // Second opinions: never behind the demo assistant, never on the day's last calls,
    // and not at all for a while after three failures in a row.
    if (main && !isMock) {
      for (const extra of extras) {
        if (have(extra.name) || isPaused(extra.name)) continue;
        if (aiBudget.peek({ kind: 'grade' }).remaining <= SECOND_OPINION_RESERVE) continue;
        if (!consume()) continue;
        plans.push({ assistant: extra, second: true });
      }
    }

    // One retry after a 429 (rate limited) or 529 (overloaded): wait what the provider asks (at most 20
    // seconds, 5 when it says nothing), inside the same deadline. The retry is not charged again.
    const askWithRetry = async (plan, signal) => {
      const { assistant, second } = plan;
      // A resend inside an ask (the reply paused mid-search) is one more paid call. Ask 1 keeps today's rule;
      // asks 2 and up resend only while more than 12 calls remain, and when the resend is refused the ask is
      // marked so its paused preamble is dropped rather than scored as "not named".
      const consumeExtra = (plan.ask ?? 1) <= 1
        ? consume
        : () => {
          if (aboveReserve() && consume()) return true;
          plan.resendRefused = true;
          return false;
        };
      const ask = () => assistant.ask({
        prompt,
        signal,
        category,
        businessName: input.name,
        ...(second ? {} : { consumeExtra }),
      });
      try {
        return await ask();
      } catch (err) {
        if (!isBusy(err)) throw err;
        const seconds = Number.isFinite(err.retryAfterSeconds) ? err.retryAfterSeconds : RETRY_DEFAULT_SECONDS;
        log(`ai-retry provider=${assistant.name} status=${err.status}`);
        // Claude may be asked to wait up to 20 seconds; a second opinion never waits more than 5.
        const top = second ? SECOND_RETRY_MAX_SECONDS : RETRY_MAX_SECONDS;
        await sleep(Math.min(Math.max(seconds, 0), top) * 1000, signal);
        return ask();
      }
    };

    const run = async plan => {
      const { assistant, second } = plan;
      const started = clock.now();
      try {
        const raw = await withDeadline(
          signal => askWithRetry(plan, signal),
          second ? secondOpinionTimeoutMs : AI_TIMEOUT_MS,
        );
        // An ask (2 and up) whose resend was refused counts as not run: nothing is kept from it.
        if (!second && plan.resendRefused) {
          log('ai-ask-dropped reason=resend-refused');
          return { entry: null, second, name: assistant.name, dropped: true };
        }
        const result = typeof raw === 'string' ? { answer: raw } : raw;
        if (!result || typeof result.answer !== 'string' || result.answer.trim() === '') throw coded('unparseable');
        const entry = await buildEntry({
          assistant, second, prompt, input, result, ms: Math.max(0, clock.now() - started),
        });
        // Which ask this was, only when more than one was planned (one ask stays exactly as before).
        if (!second && planned > 1) entry.ask = plan.ask;
        if (second) noteSecond(assistant.name, true);
        return { entry, second, name: assistant.name };
      } catch (err) {
        // A call that ended in 429 or 529 was never served: give it back to the daily allowance.
        const busy = isBusy(err);
        if (busy && typeof aiBudget.refund === 'function') aiBudget.refund({ kind: 'grade' });
        log(second
          ? `second-ai-failed provider=${assistant.name} code=${codeOf(err)}${busy ? ' busy' : ''}`
          : `ai-failed code=${codeOf(err)}${busy ? ' busy' : ''}`);
        if (second) noteSecond(assistant.name, false);
        return { entry: null, second, name: assistant.name, timedOut: err?.code === 'timeout' };
      }
    };

    // Second opinions run at the same time as the main answer, but nothing waits for them: each one is
    // handed to `onSecond` when it ends (or when its 45 seconds are up). Without `onSecond` they are awaited.
    const mainPlans = plans.filter(p => !p.second);
    // Remember which second opinions are still answering, so an open report can say so and refresh.
    for (const plan of plans) if (plan.second && gradeId) trackSecond(gradeId, plan.assistant.name, true);
    const secondRuns = plans.filter(p => p.second).map(async plan => {
      const outcome = await run(plan);
      if (typeof onSecond === 'function') {
        try {
          await onSecond({ entry: outcome.entry, name: outcome.name, timedOut: outcome.timedOut === true, prompt });
        } catch {
          log(`second-save-failed provider=${plan.assistant.name}`);
        }
      }
      if (gradeId) trackSecond(gradeId, plan.assistant.name, false); // after it is saved
      return outcome;
    });
    secondRuns.forEach(p => p.catch(() => {}));

    // All planned asks start together, each with its own deadline and its own retry.
    const mainOutcomes = await Promise.all(mainPlans.map(plan => run(plan)));
    const entries = mainOutcomes.filter(o => o.entry).map(o => o.entry);
    if (mainPlans.length > 0 && entries.length === 0) mainState = 'failed';
    if (typeof onSecond !== 'function') {
      for (const o of await Promise.all(secondRuns)) if (o.entry) entries.push(o.entry);
    }
    return { entries, mainState, planned, asked };
  }

  // Grade_Id -> (assistant name -> how many of its answers are still coming). Counted per answer, so a
  // provider stays listed until every one of its pending answers has arrived or run out of time.
  const pendingSeconds = new Map();

  function trackSecond(id, name, on) {
    const counts = pendingSeconds.get(id) ?? new Map();
    const next = (counts.get(name) ?? 0) + (on ? 1 : -1);
    if (next > 0) counts.set(name, next);
    else counts.delete(name);
    if (counts.size > 0) pendingSeconds.set(id, counts);
    else pendingSeconds.delete(id);
  }

  /** Assistant names (such as 'chatgpt') of second opinions for this Grade that have not all answered yet. */
  const secondPending = id => [...(pendingSeconds.get(id)?.keys() ?? [])];

  /** Add a second opinion that arrived after the report was written (or note that it ran out of time). */
  async function saveLateSecond(id, { entry, name, timedOut, prompt }) {
    if (!entry && !timedOut) return;
    await grades().update(list => {
      const g = list.find(x => x && x.id === id);
      if (!g) return;
      if (entry) {
        if (!g.ai.some(a => a.prompt === entry.prompt && a.provider === entry.provider)) g.ai = [...g.ai, entry];
      } else {
        const missed = Array.isArray(g.secondMissed) ? g.secondMissed : [];
        if (!missed.some(m => m.prompt === prompt && m.provider === name)) g.secondMissed = [...missed, { provider: name, prompt }];
      }
    });
  }

  // ---- the website steps ----------------------------------------------------------------------------

  /**
   * Fetch and read the home page, robots.txt and llms.txt, then run the website Checks.
   * `step(index, state, finding, ms)` is told about each step as it ends.
   */
  async function readWebsite(input, step) {
    const budget = startBudget(websiteBudgetMs);
    try {
      return await readWebsiteWithin(input, step, budget);
    } finally {
      budget.stop();
    }
  }

  /**
   * The website steps share one deadline (30 seconds). A fetch still running at the limit is
   * given up on and its step is recorded as failed; later steps are skipped. Nothing here
   * writes a step after the limit except the flow itself, in order, so a late fetch that
   * finishes on its own is ignored.
   */
  async function readWebsiteWithin(input, step, budget) {
    const nothing = { facts: null, found: foundFromFacts(null, input), results: null, homeOk: false };
    if (!input.website) {
      await step(0, 'skipped', 'No website given', 0);
      await step(1, 'skipped', 'No website given', 0);
      await step(2, 'skipped', 'No website given', 0);
      return { ...nothing, results: runWebsiteChecks({ facts: null, robots: null, llms: null, input }) };
    }

    let home = null;
    let failure;
    let t = clock.now();
    try {
      const res = await within(budget, safeFetcher.fetchText(input.website, { strictSize: true }));
      if (res.status < 200 || res.status >= 300 || !looksLikeHtml(res)) failure = HOME_UNREADABLE;
      else home = res;
    } catch (err) {
      failure = failureFor(err);
    }
    await step(0, home ? 'done' : 'failed', home ? 'Reached your website' : (failure ?? "We couldn't reach your website."), clock.now() - t);

    let facts = null;
    t = clock.now();
    if (home) {
      try {
        facts = readPageFacts(home.text);
        const n = facts.h1s.length;
        await step(1, 'done', `Found ${n} main headline${n === 1 ? '' : 's'}`, clock.now() - t);
      } catch {
        failure = HOME_UNREADABLE;
        await step(1, 'failed', HOME_UNREADABLE, clock.now() - t);
      }
    } else {
      await step(1, 'skipped', 'Nothing to read', 0);
    }

    // robots.txt and llms.txt are read even when the home page could not be (a bot challenge on
    // the home page says nothing about whether AI assistants are let in).
    let robots = null;
    let llms = null;
    let tooSlow = false;
    t = clock.now();
    if (budget.expired) {
      tooSlow = true;
    } else {
      const base = home?.finalUrl || input.website;
      const fetchOne = async path => {
        const res = await safeFetcher.fetchText(new URL(path, base).href);
        return { status: res.status, text: res.text, contentType: res.contentType };
      };
      try {
        [robots, llms] = await within(budget, Promise.all([
          fetchOne('/robots.txt').catch(() => ({ status: 0 })),
          fetchOne('/llms.txt').catch(() => null),
        ]));
      } catch {
        tooSlow = true; // the shared deadline passed; both files count as not checked
        robots = null;
        llms = null;
      }
    }
    if (tooSlow && failure === undefined) failure = TOO_SLOW;
    const results = runWebsiteChecks({ facts, robots, llms, input, failure });
    const bots = results.find(r => r.id === 'ai-bots-allowed');
    if (tooSlow) {
      await step(2, 'failed', TOO_SLOW, clock.now() - t);
    } else if (bots && bots.result !== 'not_checked') {
      const blocked = bots.blocked ?? [];
      await step(2, 'done', blocked.length
        ? `${blocked.length} AI assistant${blocked.length === 1 ? ' is' : 's are'} turned away`
        : 'No AI assistants are turned away', clock.now() - t);
    } else {
      await step(2, 'failed', bots?.detail ?? "We couldn't read your robots.txt file.", clock.now() - t);
    }

    return { facts, found: foundFromFacts(facts, input), results, homeOk: Boolean(home && facts) };
  }

  // ---- steps on the stored Grade ------------------------------------------------------------------------

  async function recordStep(id, input, index, state, finding, ms) {
    const name = stepNames(input)[index];
    const step = { name, state, ms: Math.max(0, Math.round(ms)), finding };
    const order = new Map(stepNames(input).map((n, i) => [n, i]));
    const merge = steps => [...steps.filter(s => s.name !== name), step]
      .sort((a, b) => (order.get(a.name) ?? 9) - (order.get(b.name) ?? 9));
    const snapshot = live.get(id);
    if (snapshot) snapshot.steps = merge(snapshot.steps);
    await grades().update(list => {
      const g = list.find(x => x && x.id === id);
      if (g) g.steps = merge(Array.isArray(g.steps) ? g.steps : []);
    });
  }

  // ---- running a Grade --------------------------------------------------------------------------------------

  async function run(id) {
    const grade = await get(id);
    if (!grade || grade.status !== 'running') return;
    const { input } = grade;
    // The stale clock starts here, when the check really begins (it may have waited in line before this).
    const startedAt = nowIso();
    live.set(id, { ...structuredClone(grade), startedAt });
    await grades().update(list => {
      const g = list.find(x => x && x.id === id);
      if (g) g.startedAt = startedAt;
    });
    const step = (index, state, finding, ms) => recordStep(id, input, index, state, finding, ms);

    const website = readWebsite(input, step).catch(() => {
      log(`website-failed id=${id}`);
      return { facts: null, found: foundFromFacts(null, input), results: runWebsiteChecks({ facts: null, robots: null, llms: null, input, failure: undefined }), homeOk: false };
    });

    // Carried answers are read again by Gemini here, in the background and all at once, so
    // POST /grade never waits on it.
    const carried = rereadCarried(grade.ai, input).catch(() => grade.ai);

    // Second opinions never hold the report up: the ones that end before the report is written go in
    // with it; the rest are added to the stored Grade when they arrive (or noted as out of time).
    const late = { done: false, entries: [], missed: [] };
    const onSecond = async ({ entry, name, timedOut, prompt }) => {
      if (late.done) {
        await saveLateSecond(id, { entry, name, timedOut, prompt });
      } else if (entry) {
        late.entries.push(entry);
      } else if (timedOut) {
        late.missed.push({ provider: name, prompt });
      }
    };

    const aiBranch = (async () => {
      const t = clock.now();
      const prompt = freeQuestion(input);
      let outcome;
      try {
        // The free question is asked GRADE_MAIN_ASKS times (1 to 3; a missing value counts as 3).
        outcome = await askQuestion({ input, prompt, existing: grade.ai, onSecond, gradeId: id, asks: mainAsks() });
      } catch {
        log(`ai-step-failed id=${id}`);
        outcome = { entries: [], mainState: 'failed', planned: 1, asked: 0 };
      }
      const ai = [...(await carried), ...outcome.entries];
      const main = ai.filter(a => !isSecondOpinion(a) && a.prompt === prompt);
      const reused = outcome.entries.length === 0 && main.length > 0;
      let state = 'done';
      let finding;
      let cut = null;
      if (outcome.mainState === 'limit' || outcome.mainState === 'not_connected' || outcome.mainState === 'off') {
        state = 'skipped';
        finding = outcome.mainState === 'limit' ? AI_LIMIT_REACHED : AI_NOT_CONNECTED;
      } else if (outcome.mainState === 'failed') {
        state = 'failed';
        finding = "AI didn't answer this time";
      } else if (reused) {
        // One carried answer keeps today's sentence; more than one says so (V103).
        finding = main.length > 1
          ? `Used ${providerLabel(main[0].provider)}'s answers from earlier this week.`
          : 'Used an answer from earlier this week';
      } else if (outcome.planned > 1) {
        // More than one ask planned: say how many were asked and how many answered, and when the allowance cut it short.
        const label = providerLabel(assistantProvider?.name);
        const answered = outcome.entries.filter(e => !isSecondOpinion(e)).length;
        const times = n => `${n} ${n === 1 ? 'time' : 'times'}`;
        const answers = n => `${n} ${n === 1 ? 'answer' : 'answers'}`;
        finding = outcome.asked < outcome.planned
          ? `Asked ${label} ${times(outcome.asked)}, not ${outcome.planned}, because we reached today's limit. Got ${answers(answered)}.`
          : `Asked ${label} ${times(outcome.asked)} and got ${answers(answered)}.`;
        // The report's hint says how many were planned and how many the limit allowed (V107).
        if (outcome.asked < outcome.planned) cut = { planned: outcome.planned, asked: outcome.asked };
      } else {
        const first = main[0];
        finding = first && first.total > 0
          ? `${providerLabel(first.provider)} listed ${first.total} business${first.total === 1 ? '' : 'es'}`
          : 'Read the AI answer';
      }
      await step(3, state, finding, clock.now() - t);
      return { ai, mainState: outcome.mainState, cut };
    })();

    const [web, aiOut] = await Promise.all([website, aiBranch]);

    const t = clock.now();
    await step(4, 'done', 'Your free listing is ready to claim', clock.now() - t);

    const aiMain = {
      provider: assistantProvider?.name ?? 'unknown',
      label: providerLabel(assistantProvider?.name),
      state: aiOut.mainState,
      // Only when today's limit cut the asks short; every other Grade is stored as before.
      ...(aiOut.cut ? { asks: aiOut.cut } : {}),
    };
    const results = assemble(web.results, aiOut.ai, aiMain);
    const score = scoreOf(results);
    await grades().update(list => {
      // From here on a second opinion that arrives is saved on its own (see onSecond).
      late.done = true;
      const g = list.find(x => x && x.id === id);
      if (!g) return;
      g.status = 'done';
      g.finishedAt = nowIso();
      g.facts = storedFacts(web.facts, web.found);
      g.found = web.found;
      const has = new Set(aiOut.ai.map(a => `${a.prompt}|${a.provider}`));
      g.ai = [...aiOut.ai, ...late.entries.filter(a => !has.has(`${a.prompt}|${a.provider}`))];
      if (late.missed.length > 0) g.secondMissed = late.missed;
      g.aiMain = aiMain;
      g.results = results;
      g.score = score;
    });
    live.delete(id);
  }

  function startRun(id) {
    if (active.has(id)) return;
    const p = run(id)
      .catch(async () => {
        log(`run-failed id=${id}`);
        live.delete(id);
        await grades().update(list => {
          const g = list.find(x => x && x.id === id);
          if (g && g.status === 'running') g.status = 'failed';
        }).catch(() => {});
      })
      .finally(() => {
        active.delete(id);
        startWaiting(); // a place is free: the next check in line starts
      });
    active.set(id, p);
  }

  /** Start checks from the line, first in first out, while fewer than `maxRunning` are running. */
  function startWaiting() {
    while (waiting.length > 0 && active.size < maxRunning) startRun(waiting.shift());
  }

  /**
   * A new Grade starts now, or waits in line when `maxRunning` checks are already running. A waiting
   * Grade is shown as "in line" from memory only (like a running one), so a restart clears the line
   * the same way it clears running checks.
   */
  function enqueue(id, grade) {
    if (active.has(id) || waiting.includes(id)) return;
    if (active.size < maxRunning && waiting.length === 0) {
      startRun(id);
      return;
    }
    waiting.push(id);
    startWaiting();
    if (grade && waiting.includes(id)) live.set(id, { ...structuredClone(grade), queued: true });
  }

  // ---- starting a Grade -----------------------------------------------------------------------------------------

  /** Answers from a Grade of the same business in the last 7 days, for assistants that are still switched on. */
  async function reusableAnswers(key, input) {
    const list = await grades().read();
    if (!Array.isArray(list)) return [];
    const names = new Set([assistantProvider?.name, ...extras.map(e => e.name)]);
    // Only answers to this Grade's own questions, word for word: an answer to a differently worded question
    // would be counted beside the new asks and stop Claude being asked again.
    const prompts = input ? new Set([freeQuestion(input), ...extraQuestions(input)]) : null;
    const cutoff = clock.now() - REUSE_WINDOW_MS;
    const earlier = list
      .filter(g => g && g.status === 'done' && g.key === key && Array.isArray(g.ai) && g.ai.length > 0
        && Date.parse(g.createdAt) >= cutoff)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (!earlier) return [];
    const copies = [];
    for (const a of earlier.ai) {
      if (!names.has(a.provider)) continue;
      if (prompts && !prompts.has(a.prompt)) continue;
      copies.push({ ...structuredClone(a), reusedFrom: a.reusedFrom || a.at });
    }
    return copies;
  }

  /**
   * Carried answers are read again, all at once, when Gemini's name check is on now and has not
   * been asked about them before. An answer that was cut short is never read again (a late
   * mention could be lost), and one that was already asked about is not asked about again, even
   * when that check failed.
   */
  function rereadCarried(entries, input) {
    if (!nameChecker) return Promise.resolve(entries);
    return Promise.all(entries.map(async a => {
      // An answer stored at the 4,000-character cap was cut even if an older Grade did not say so.
      const cutShort = a.answerCut || Array.from(String(a.answer ?? '')).length >= MAX_ANSWER_CODE_POINTS;
      if (cutShort || a.nameCheck || a.nameCheckTried || a.provider === 'mock') return a;
      const read = await readAnswer(a.answer, input, a.provider);
      const next = { ...a };
      // A re-read may add a mention, never take one away: if the earlier read found the business and this
      // one did not, keep the earlier result.
      if (!(a.named && !read.named)) {
        Object.assign(next, {
          named: read.named, position: read.position, total: read.total, competitors: read.competitors,
        });
      }
      if (read.nameCheck) next.nameCheck = read.nameCheck;
      if (read.tried) next.nameCheckTried = true;
      return next;
    }));
  }

  /**
   * Start a Grade. `rawInput` is the posted form; it is cleaned again here.
   * @returns {Promise<string>} the Grade_Id
   */
  async function start(rawInput) {
    const checked = normalizeGradeInput(rawInput);
    if (!checked.ok) throw new TypeError('Invalid grade input');
    const { input } = checked;
    const key = reuseKey(input);
    const copies = await reusableAnswers(key, input);
    const id = newId();
    const created = {
      id,
      status: 'running',
      input,
      key,
      createdAt: nowIso(),
      finishedAt: null,
      steps: [],
      facts: null,
      found: null,
      results: [],
      ai: copies,
      aiMain: null,
      score: null,
      previousScore: null,
      draftId: null,
      draftIds: [],
      recheckedAt: null,
      recheckRunning: false,
      recheckFailedAt: null,
      extraAiStartedAt: null,
    };
    await grades().append(created);
    if (typeof store.pruneExpired === 'function') {
      await store.pruneExpired({ quotes: false, drafts: false, grades: true, leads: true })
        .catch(() => log(`prune-failed id=${id}`));
    }
    queueMicrotask(() => enqueue(id, created));
    return id;
  }

  // ---- the extra AI questions ------------------------------------------------------------------------------------------

  async function runExtraQuestions(id) {
    for (const prompt of extraQuestions((await get(id)).input)) {
      const grade = await get(id);
      if (!grade) return;
      // Second opinions are saved as they arrive; only the main answer is waited for.
      const { entries, mainState } = await askQuestion({
        input: grade.input, prompt, existing: grade.ai, onSecond: details => saveLateSecond(id, details), gradeId: id,
      });
      if (entries.length > 0) {
        await grades().update(list => {
          const g = list.find(x => x && x.id === id);
          if (!g) return;
          g.ai = [...g.ai, ...entries];
          // The free question may have failed or hit the limit; once the main assistant answers, say so.
          if (entries.some(e => !isSecondOpinion(e)) && g.aiMain) g.aiMain.state = 'ok';
          g.results = assemble(g.results, g.ai, g.aiMain);
          g.score = scoreOf(g.results);
        });
      }
      // The main assistant failed: do not spend more paid calls on the next question.
      if (mainState === 'failed') break;
    }
  }

  /**
   * Start the two extra questions once for a Grade. Reading first means a repeat call
   * writes nothing.
   * @returns {Promise<boolean>} true when this call started them
   */
  async function startExtraQuestions(id) {
    const grade = await get(id);
    // The extra questions run even when the free question failed or hit the daily limit (requirement 9.2);
    // only an assistant that is not connected cannot be asked.
    const state = grade?.aiMain?.state;
    if (!grade || grade.status !== 'done' || grade.extraAiStartedAt || state === 'not_connected' || state === 'off') return false;
    let started = false;
    await grades().update(list => {
      const g = list.find(x => x && x.id === id);
      if (g && !g.extraAiStartedAt) {
        g.extraAiStartedAt = nowIso();
        started = true;
      }
    });
    if (started) background(id, 'extra-ai', () => runExtraQuestions(id));
    return started;
  }

  // ---- leads ---------------------------------------------------------------------------------------------------------------

  /**
   * Store a Lead, tell the site owner, and start the two extra AI questions.
   * @param {string} id the Grade_Id
   * @param {{ name: string, email: string, phone: string, okToContact: boolean }} lead already checked
   * @returns {Promise<object|null>} the stored Lead, or null when the Grade does not exist
   */
  async function unlock(id, lead) {
    const grade = await get(id);
    if (!grade) return null;
    const stored = {
      id: randomBytes(12).toString('base64url'),
      gradeId: id,
      business: grade.input.name,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      okToContact: lead.okToContact === true,
      // The score the report shows: worked out from the stored results with the current points, so an old
      // Grade's lead (and the lead email) agree with its report. With no results, the stored number stays.
      score: shownScore(grade),
      createdAt: nowIso(),
    };
    await leads().append(stored);

    // The owner is answered at once; the email goes out in the background, under the same time limit.
    // Nothing about the lead is logged.
    if (typeof notifier?.notifyLead === 'function') {
      const notice = {
        business: grade.input.name,
        score: stored.score,
        reportUrl: `${config.baseUrl ?? ''}/grade/${id}`,
        lead: { name: stored.name, email: stored.email, phone: stored.phone, okToContact: stored.okToContact },
      };
      background(id, 'lead-notice', async () => {
        let timer;
        try {
          await Promise.race([
            notifier.notifyLead(notice),
            new Promise((_, reject) => { timer = setTimeout(() => reject(coded('timeout')), NOTIFY_TIMEOUT_MS); }),
          ]);
        } catch {
          log(`lead-notice-failed id=${id}`);
        } finally {
          clearTimeout(timer);
        }
      });
    }
    await startExtraQuestions(id).catch(() => log(`extra-ai-failed id=${id}`));
    return stored;
  }

  // ---- claim the free page -----------------------------------------------------------------------------------------------------

  /**
   * Create a Draft from what the scan found, or return the one this browser already claimed.
   * Nothing is published. `claimedDraftId` is the Draft id from a correctly signed claim cookie.
   * @returns {Promise<{ status: number, draftId?: string, created?: boolean }>}
   */
  function claim(id, { claimedDraftId } = {}) {
    return store.withLock(`grade-claim:${id}`, async () => {
      const grade = await get(id);
      if (!grade) return { status: 404 };
      // The browser that claimed gets its own Draft back, whatever has happened to it since (even
      // after it was sent for review). Grades made before `draftIds` existed have only `draftId`.
      const mine = new Set([...(Array.isArray(grade.draftIds) ? grade.draftIds : []), grade.draftId].filter(Boolean));
      if (claimedDraftId && mine.has(claimedDraftId)) {
        const existing = await draftStore.get(claimedDraftId);
        if (existing.status === 200) return { status: 303, draftId: claimedDraftId, created: false };
      }
      const { input } = grade;
      const found = foundOf(grade);
      const categories = store.getCategories();
      const checked = validateFields({
        name: input.name,
        category: mapCategory(input.service, categories) || 'other',
        phone: found.phone,
        hours: hoursToObject(found.hours),
        services: [input.service],
        // A business that goes to its customers lists its area and no street address, even when the page shows one.
        serviceArea: input.noStorefront === true ? `${input.city} and nearby areas` : input.city,
        city: input.city,
        state: input.state,
        address: input.noStorefront === true ? '' : found.address,
        // The best review link read from the home page (never from an AI answer); validateFields checks it again
        // and leaves it out when it is not a valid reviews link.
        reviewsLink: typeof found.reviewsLink === 'string' ? found.reviewsLink : '',
        // The website the owner typed on the check, as a clean https address (validateFields checks it once more);
        // empty when none was given or it cannot be a listing website. Nothing is fetched.
        website: normalizeWebsite(claimWebsite(input.website)),
      }, categories);
      const created = await draftStore.create({
        fields: checked.fields, missingFields: checked.missingFields, provider: 'grader',
      });
      const draftId = created.draft.id;
      await grades().update(list => {
        const g = list.find(x => x && x.id === id);
        if (!g) return;
        if (!g.draftId) g.draftId = draftId;
        g.draftIds = [...(Array.isArray(g.draftIds) ? g.draftIds : []), draftId];
      });
      return { status: 303, draftId, created: true };
    });
  }

  // ---- check again ----------------------------------------------------------------------------------------------------------------------

  /**
   * Re-run the website Checks only. The AI answers are kept. A recheck never sets the
   * Grade back to running. If the site cannot be read, the earlier results stay.
   * @returns {Promise<{ started: boolean }>}
   */
  async function recheck(id) {
    const grade = await get(id);
    if (!grade || grade.status !== 'done' || !grade.input.website) return { started: false };
    let started = false;
    await grades().update(list => {
      const g = list.find(x => x && x.id === id);
      // A recheck cut off by a restart stops counting after 4 minutes, so a new one can start.
      if (g && !recheckIsRunning(g, clock.now())) {
        g.recheckRunning = true;
        g.recheckStartedAt = nowIso();
        started = true;
      }
    });
    if (!started) return { started: false };

    background(id, 'recheck', async () => {
      try {
        const web = await readWebsite(grade.input, async () => {});
        await grades().update(list => {
          const g = list.find(x => x && x.id === id);
          if (!g) return;
          g.recheckRunning = false;
          g.recheckStartedAt = null;
          if (!web.homeOk) {
            g.recheckFailedAt = nowIso();
            return;
          }
          // A partial score (no AI answer) is never put beside a full one, and neither is a score from before
          // the reviews-visible Check existed: the points changed then, so the two would not compare.
          const hadReviewsCheck = Array.isArray(g.results) && g.results.some(r => r && r.id === 'reviews-visible');
          g.previousScore = isPartialScore(g) || !hadReviewsCheck ? null : (g.score?.score ?? null);
          g.facts = storedFacts(web.facts, web.found);
          g.found = web.found;
          g.results = assemble(web.results, g.ai, g.aiMain);
          g.score = scoreOf(g.results);
          g.recheckedAt = nowIso();
          g.recheckFailedAt = null;
        });
      } catch (err) {
        await grades().update(list => {
          const g = list.find(x => x && x.id === id);
          if (g) {
            g.recheckRunning = false;
            g.recheckStartedAt = null;
            g.recheckFailedAt = nowIso();
          }
        }).catch(() => {});
        throw err;
      }
    });
    return { started: true };
  }

  // ---- removing a Grade ----------------------------------------------------------------------------------------------------------------------

  /** Delete a Grade and its Leads. @returns {Promise<boolean>} false when there was no such Grade */
  async function remove(id) {
    let found = false;
    await grades().update(list => {
      const i = list.findIndex(g => g && g.id === id);
      if (i === -1) return;
      list.splice(i, 1);
      found = true;
    });
    if (found) await leads().update(list => list.filter(l => l && l.gradeId !== id));
    const inLine = waiting.indexOf(id);
    if (inLine !== -1) waiting.splice(inLine, 1);
    live.delete(id);
    return found;
  }

  return {
    start,
    run: id => { startRun(id); return active.get(id) ?? Promise.resolve(); },
    get,
    peek: id => (live.has(id) ? structuredClone(live.get(id)) : undefined),
    secondPending,
    isStale,
    recheck,
    unlock,
    claim,
    startExtraQuestions,
    remove,
  };
}
