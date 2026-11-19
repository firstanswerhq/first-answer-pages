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
} from './listing-fields.js';

// ---- constants -------------------------------------------------------------------

export const AI_LIMIT_REACHED = 'AI check limit reached for today';
export const AI_NOT_CONNECTED = "AI check isn't connected";
export const AI_FAILED = "AI didn't answer this time. You can run the check again later.";

const STALE_AFTER_MS = 4 * 60 * 1000;
const REUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const AI_TIMEOUT_MS = 120 * 1000;
const NOTIFY_TIMEOUT_MS = 5 * 1000;
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
  const errors = {};
  if (name === '' || codePoints(name) > 120) errors.name = MESSAGES.name;
  if (city === '' || codePoints(city) > 80) errors.city = MESSAGES.city;
  if (!US_STATE_CODES.has(state)) errors.state = STATE_ERROR;
  if (service === '' || codePoints(service) > 60) errors.service = MESSAGES.service;
  const site = readWebsiteInput(websiteText);
  if (site.error) errors.website = site.error;
  if (Object.keys(errors).length > 0) return { ok: false, values, errors };
  return { ok: true, values, errors, input: { name, city, state, service, website: site.value } };
}

/** The key two Grades share when they are about the same business. */
function reuseKey(input) {
  return [
    normalizeForMatch(input.name), normalizeForMatch(input.city), String(input.state).toLowerCase(),
    normalizeForMatch(input.service), registeredDomain(input.website) || '-',
  ].join('|');
}

// ---- the questions and the steps -----------------------------------------------------

/** The question in the free part of a report. */
export function freeQuestion(input) {
  return `Who are the best ${input.service} in ${input.city}, ${input.state}? Name your top 5.`;
}

/** The two questions asked after the report is opened. */
export function extraQuestions(input) {
  return [
    `I need ${input.service} in ${input.city}, ${input.state}. Which companies would you recommend?`,
    `Which ${input.service} in ${input.city}, ${input.state} do people say are the most reliable?`,
  ];
}

/** The five Scan_Steps in order. */
export function stepNames(input) {
  return [
    'Finding your website',
    'Reading your home page',
    'Checking what AI is allowed to read',
    `Asking AI to name the best ${input.service} in ${input.city}`,
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

/** Phone, hours and address found on the website. Grades made before `found` existed keep them in `facts`. */
export function foundOf(grade) {
  if (grade?.found && typeof grade.found === 'object') return grade.found;
  const f = grade?.facts && typeof grade.facts === 'object' ? grade.facts : {};
  return {
    phone: typeof f.phone === 'string' ? f.phone : '',
    hours: Array.isArray(f.hours) ? f.hours.filter(x => typeof x === 'string') : [],
    address: typeof f.address === 'string' ? f.address : '',
    website: grade?.input?.website || '',
  };
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
  const found = { phone: '', hours: [], address: '', website: input.website || '' };
  if (!facts) return found;
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
  draftStore, notifier, clock, newId, config = {}, websiteBudgetMs = WEBSITE_BUDGET_MS,
}) {
  const grades = () => store.collection('grades');
  const leads = () => store.collection('leads');
  const nowIso = () => new Date(clock.now()).toISOString();
  const extras = Array.isArray(extraAssistants) ? extraAssistants : [];
  const live = new Map(); // Grade_Id -> running Grade, so status.json need not read the file
  const active = new Map(); // Grade_Id -> promise of the run, so one id runs once
  const secondOpinion = new Map(); // assistant name -> { fails, until }

  const background = (id, label, fn) => {
    Promise.resolve().then(fn).catch(() => log(`${label}-failed id=${id}`));
  };

  async function get(id) {
    const list = await grades().read();
    return Array.isArray(list) ? list.find(g => g && g.id === id) : undefined;
  }

  const isStale = (grade, now) => Boolean(grade)
    && grade.status === 'running'
    && now - Date.parse(grade.createdAt) > STALE_AFTER_MS;

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
  async function askQuestion({ input, prompt, existing }) {
    const main = assistantProvider;
    const mainName = main?.name ?? 'unknown';
    const isMock = mainName === 'mock';
    const category = mapCategory(input.service, store.getCategories()) || '';
    const have = name => existing.some(a => a.prompt === prompt && a.provider === name);
    const consume = () => aiBudget.consume({ kind: 'grade' }).allowed === true;

    let mainState = 'ok';
    const plans = [];
    if (!main) mainState = 'off';
    else if (have(mainName)) mainState = 'ok';
    else if (isMock && config.production === true) mainState = 'not_connected';
    else if (!isMock && !consume()) mainState = 'limit';
    else plans.push({ assistant: main, second: false });

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

    const run = async ({ assistant, second }) => {
      const started = clock.now();
      try {
        const raw = await withDeadline(signal => assistant.ask({
          prompt,
          signal,
          category,
          businessName: input.name,
          ...(second ? {} : { consumeExtra: () => aiBudget.consume({ kind: 'grade' }).allowed === true }),
        }), AI_TIMEOUT_MS);
        const result = typeof raw === 'string' ? { answer: raw } : raw;
        if (!result || typeof result.answer !== 'string' || result.answer.trim() === '') throw coded('unparseable');
        const entry = await buildEntry({
          assistant, second, prompt, input, result, ms: Math.max(0, clock.now() - started),
        });
        if (second) noteSecond(assistant.name, true);
        return { entry, second };
      } catch (err) {
        log(second ? `second-ai-failed provider=${assistant.name} code=${codeOf(err)}` : `ai-failed code=${codeOf(err)}`);
        if (second) noteSecond(assistant.name, false);
        return { entry: null, second };
      }
    };

    const outcomes = await Promise.all(plans.map(run));
    const mainRan = outcomes.find(o => !o.second);
    if (mainRan && !mainRan.entry) mainState = 'failed';
    return { entries: outcomes.filter(o => o.entry).map(o => o.entry), mainState };
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
    live.set(id, structuredClone(grade));
    const step = (index, state, finding, ms) => recordStep(id, input, index, state, finding, ms);

    const website = readWebsite(input, step).catch(() => {
      log(`website-failed id=${id}`);
      return { facts: null, found: foundFromFacts(null, input), results: runWebsiteChecks({ facts: null, robots: null, llms: null, input, failure: undefined }), homeOk: false };
    });

    // Carried answers are read again by Gemini here, in the background and all at once, so
    // POST /grade never waits on it.
    const carried = rereadCarried(grade.ai, input).catch(() => grade.ai);

    const aiBranch = (async () => {
      const t = clock.now();
      const prompt = freeQuestion(input);
      let outcome;
      try {
        outcome = await askQuestion({ input, prompt, existing: grade.ai });
      } catch {
        log(`ai-step-failed id=${id}`);
        outcome = { entries: [], mainState: 'failed' };
      }
      const ai = [...(await carried), ...outcome.entries];
      const main = ai.filter(a => !isSecondOpinion(a) && a.prompt === prompt);
      const reused = outcome.entries.length === 0 && main.length > 0;
      let state = 'done';
      let finding;
      if (outcome.mainState === 'limit' || outcome.mainState === 'not_connected' || outcome.mainState === 'off') {
        state = 'skipped';
        finding = outcome.mainState === 'limit' ? AI_LIMIT_REACHED : AI_NOT_CONNECTED;
      } else if (outcome.mainState === 'failed') {
        state = 'failed';
        finding = "AI didn't answer this time";
      } else if (reused) {
        finding = 'Used an answer from earlier this week';
      } else {
        const first = main[0];
        finding = first && first.total > 0
          ? `${providerLabel(first.provider)} listed ${first.total} business${first.total === 1 ? '' : 'es'}`
          : 'Read the AI answer';
      }
      await step(3, state, finding, clock.now() - t);
      return { ai, mainState: outcome.mainState };
    })();

    const [web, aiOut] = await Promise.all([website, aiBranch]);

    const t = clock.now();
    await step(4, 'done', 'Your free listing is ready to claim', clock.now() - t);

    const aiMain = {
      provider: assistantProvider?.name ?? 'unknown',
      label: providerLabel(assistantProvider?.name),
      state: aiOut.mainState,
    };
    const results = assemble(web.results, aiOut.ai, aiMain);
    const score = scoreOf(results);
    await grades().update(list => {
      const g = list.find(x => x && x.id === id);
      if (!g) return;
      g.status = 'done';
      g.finishedAt = nowIso();
      g.facts = storedFacts(web.facts, web.found);
      g.found = web.found;
      g.ai = aiOut.ai;
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
      .finally(() => active.delete(id));
    active.set(id, p);
  }

  // ---- starting a Grade -----------------------------------------------------------------------------------------

  /** Answers from a Grade of the same business in the last 7 days, for assistants that are still switched on. */
  async function reusableAnswers(key) {
    const list = await grades().read();
    if (!Array.isArray(list)) return [];
    const names = new Set([assistantProvider?.name, ...extras.map(e => e.name)]);
    const cutoff = clock.now() - REUSE_WINDOW_MS;
    const earlier = list
      .filter(g => g && g.status === 'done' && g.key === key && Array.isArray(g.ai) && g.ai.length > 0
        && Date.parse(g.createdAt) >= cutoff)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (!earlier) return [];
    const copies = [];
    for (const a of earlier.ai) {
      if (!names.has(a.provider)) continue;
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
    const copies = await reusableAnswers(key);
    const id = newId();
    await grades().append({
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
    });
    if (typeof store.pruneExpired === 'function') {
      await store.pruneExpired({ quotes: false, drafts: false, grades: true, leads: true })
        .catch(() => log(`prune-failed id=${id}`));
    }
    queueMicrotask(() => startRun(id));
    return id;
  }

  // ---- the extra AI questions ------------------------------------------------------------------------------------------

  async function runExtraQuestions(id) {
    for (const prompt of extraQuestions((await get(id)).input)) {
      const grade = await get(id);
      if (!grade) return;
      const { entries, mainState } = await askQuestion({ input: grade.input, prompt, existing: grade.ai });
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
      score: grade.score?.score ?? null,
      createdAt: nowIso(),
    };
    await leads().append(stored);

    if (typeof notifier?.notifyLead === 'function') {
      let timer;
      try {
        await Promise.race([
          notifier.notifyLead({
            business: grade.input.name,
            score: stored.score,
            reportUrl: `${config.baseUrl ?? ''}/grade/${id}`,
            lead: { name: stored.name, email: stored.email, phone: stored.phone, okToContact: stored.okToContact },
          }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(coded('timeout')), NOTIFY_TIMEOUT_MS); }),
        ]);
      } catch {
        log(`lead-notice-failed id=${id}`);
      } finally {
        clearTimeout(timer);
      }
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
        serviceArea: input.city,
        city: input.city,
        state: input.state,
        address: found.address,
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
          g.previousScore = g.score?.score ?? null;
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
    live.delete(id);
    return found;
  }

  return {
    start,
    run: id => { startRun(id); return active.get(id) ?? Promise.resolve(); },
    get,
    peek: id => (live.has(id) ? structuredClone(live.get(id)) : undefined),
    isStale,
    recheck,
    unlock,
    claim,
    startExtraQuestions,
    remove,
  };
}
