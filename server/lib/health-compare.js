/**
 * health-compare.js: tolerant comparisons for the health map's "details match" signals (checklist A1 to A6), and the
 * rule for picking one result out of a lookup's results. Every comparison answers 'match', 'close', 'differ' or
 * 'unknown'. 'unknown' means one side is missing or unreadable, and it is never turned into a red result
 * (high-tech-look Requirement 8).
 */

import { sameSite } from './name-match.js';

// ---- phone -----------------------------------------------------------------------------------------------------

/** Digits only, with a leading 1 dropped from an 11-digit US number; '' when it is not a 10-digit number. */
export function phoneDigits(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 ? ten : '';
}

/** 'match' | 'differ' | 'unknown'. */
export function comparePhone(a, b) {
  const x = phoneDigits(a);
  const y = phoneDigits(b);
  if (!x || !y) return 'unknown';
  return x === y ? 'match' : 'differ';
}

/** Every 10-digit phone number written anywhere in a page's visible text, as digits. */
export function phonesInText(text, telLinks = []) {
  const found = new Set();
  const source = String(text ?? '').slice(0, 200000);
  for (const m of source.matchAll(/\(?\d{3}\)?[\s.\-]{0,2}\d{3}[\s.\-]{0,2}\d{4}/g)) {
    const d = phoneDigits(m[0]);
    if (d) found.add(d);
  }
  for (const href of Array.isArray(telLinks) ? telLinks : []) {
    const d = phoneDigits(String(href).replace(/^tel:/i, ''));
    if (d) found.add(d);
  }
  return found;
}

// ---- names ------------------------------------------------------------------------------------------------------

const LEGAL_WORDS = new Set(['llc', 'inc', 'incorporated', 'co', 'corp', 'corporation', 'company', 'ltd', 'the', 'and']);

/** Lower case, no punctuation, "&" as "and", without LLC, Inc and the like. */
export function nameTokens(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t && !LEGAL_WORDS.has(t));
}

function editDistance(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= y.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[y.length];
}

/**
 * 'match' when the names are the same after case, punctuation, LLC and Inc are ignored; 'close' when one holds all
 * the words of the other, or they differ by a small typo; 'differ' otherwise; 'unknown' when a name is missing.
 */
export function compareNames(a, b) {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length === 0 || y.length === 0) return 'unknown';
  const joinedX = x.join(' ');
  const joinedY = y.join(' ');
  if (joinedX === joinedY) return 'match';
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 2 && short.every(t => long.includes(t))) return 'close';
  if (short.length === 1 && short[0].length >= 5 && long.includes(short[0])) return 'close';
  const limit = Math.min(joinedX.length, joinedY.length) >= 8 ? 2 : 1;
  return editDistance(joinedX, joinedY) <= limit ? 'close' : 'differ';
}

// ---- addresses --------------------------------------------------------------------------------------------------

const ABBREVIATIONS = new Map([
  ['street', 'st'], ['avenue', 'ave'], ['road', 'rd'], ['drive', 'dr'], ['boulevard', 'blvd'], ['lane', 'ln'],
  ['court', 'ct'], ['circle', 'cir'], ['highway', 'hwy'], ['parkway', 'pkwy'], ['place', 'pl'], ['terrace', 'ter'],
  ['north', 'n'], ['south', 's'], ['east', 'e'], ['west', 'w'], ['northeast', 'ne'], ['northwest', 'nw'],
  ['southeast', 'se'], ['southwest', 'sw'], ['suite', 'ste'], ['apartment', 'apt'], ['floor', 'fl'],
]);

/** Words after which a number is a suite, unit or floor, never the street number ("Suite 200, 123 Main St"). */
const UNIT_WORDS = new Set(['ste', 'suite', 'apt', 'apartment', 'unit', '#', 'fl', 'floor', 'rm', 'room']);

/** Direction words, after ABBREVIATIONS ("North" is "n"). */
const DIRECTIONS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

/** Lower case words, with "." and "," as spaces and "#" kept as its own word. */
function addressWords(text) {
  return String(text ?? '').toLowerCase().replace(/[.,]/g, ' ').replace(/#/g, ' # ').split(/\s+/).filter(Boolean);
}

const isStreetNumber = t => /^\d{1,6}[a-z]?$/.test(t);

/** The pieces of a street address that count: the number, the street words, and the ZIP. */
export function addressParts(address) {
  const first = addressWords(address);
  if (first.length === 0) return null;
  const zip = /\b(\d{5})(?:-\d{4})?\b\s*$/.exec(first.join(' '))?.[1] ?? '';
  const numberAt = first.findIndex((t, i) => isStreetNumber(t) && !(i > 0 && UNIT_WORDS.has(first[i - 1])));
  if (numberAt === -1) return null;
  const number = first[numberAt];
  const rest = first.slice(numberAt + 1).map(t => ABBREVIATIONS.get(t) ?? t);
  // The street name is what follows the number up to the suite, city or state (stop at a unit word or a ZIP).
  const street = [];
  for (const t of rest) {
    if (UNIT_WORDS.has(t) || /^\d{5}$/.test(t)) break;
    street.push(t);
    if (street.length >= 4) break;
  }
  if (street.length === 0) return null;
  return { number, street: street.join(' '), zip };
}

const sameStreet = (a, b) => a === b || a.startsWith(b) || b.startsWith(a);
const withoutDirections = street => street.split(' ').filter(t => !DIRECTIONS.has(t)).join(' ');

/**
 * 'match' when the street number and street name are the same (St or Street, Ave or Avenue, case and punctuation
 * ignored); 'close' when they are the same but the ZIP differs, or only a direction word ("N") differs; 'differ' when
 * the number or the street is different; 'unknown' when either side has no street number and street name to read.
 */
export function compareAddresses(a, b) {
  const x = addressParts(a);
  const y = addressParts(b);
  if (!x || !y) return 'unknown';
  if (x.number !== y.number) return 'differ';
  if (sameStreet(x.street, y.street)) {
    return x.zip && y.zip && x.zip !== y.zip ? 'close' : 'match';
  }
  const bareX = withoutDirections(x.street);
  const bareY = withoutDirections(y.street);
  if (bareX && bareY && sameStreet(bareX, bareY)) return 'close';
  return 'differ';
}

/**
 * True when the street number and street name of `address` are written anywhere in `text`. The street word is the
 * first one that is not a direction, and it may come one or two words after the number ("12 N Main St").
 */
export function addressInText(address, text) {
  const parts = addressParts(address);
  if (!parts) return false;
  const word = parts.street.split(' ').find(t => !DIRECTIONS.has(t));
  if (!word) return false;
  const tokens = addressWords(String(text ?? '').slice(0, 200000)).map(t => ABBREVIATIONS.get(t) ?? t);
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== parts.number) continue;
    if (tokens[i + 1] === word) return true;
    if (DIRECTIONS.has(tokens[i + 1]) && tokens[i + 2] === word) return true;
  }
  return false;
}

// ---- hours ------------------------------------------------------------------------------------------------------

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const two = n => String(n).padStart(2, '0');

/**
 * Google's regularOpeningHours.periods as { monday: { opens: '08:00', closes: '17:00' }, ... }. A day whose hours
 * run past midnight, are all day, or have two periods is left out (it cannot be compared for sure).
 */
export function googleHoursByDay(periods) {
  const list = Array.isArray(periods) ? periods : [];
  const perDay = new Map();
  for (const p of list) {
    const day = p?.open?.day;
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    perDay.set(day, [...(perDay.get(day) ?? []), p]);
  }
  const out = {};
  for (const [day, items] of perDay) {
    if (items.length !== 1) continue;
    const { open, close } = items[0];
    if (!close || close.day !== open.day) continue;
    if (!Number.isInteger(open.hour) || !Number.isInteger(close.hour)) continue;
    out[DAY_KEYS[day]] = { opens: `${two(open.hour)}:${two(open.minute ?? 0)}`, closes: `${two(close.hour)}:${two(close.minute ?? 0)}` };
  }
  return out;
}

/**
 * Compare the website's hours with Google's, day by day, for the days both can be read.
 * @param {Record<string, { opens: string, closes: string }>} website  parsed website hours by day
 * @param {Record<string, { opens: string, closes: string }>} google   from googleHoursByDay
 * @returns {{ result: 'match'|'some'|'differ'|'unknown', compared: number, differing: number }}
 */
export function compareHours(website, google) {
  let compared = 0;
  let differing = 0;
  for (const day of DAY_KEYS) {
    const a = website?.[day];
    const b = google?.[day];
    if (!a || !b) continue;
    compared += 1;
    if (a.opens !== b.opens || a.closes !== b.closes) differing += 1;
  }
  if (compared === 0) return { result: 'unknown', compared, differing };
  if (differing === 0) return { result: 'match', compared, differing };
  return { result: differing === compared && compared >= 2 ? 'differ' : 'some', compared, differing };
}

// ---- picking one result out of a lookup's results ---------------------------------------------------------------

const norm = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

/** True when the city is written in the result's address or city field. */
function inCity(candidate, city) {
  const c = norm(city);
  if (!c) return false;
  if (norm(candidate.city) === c) return true;
  return ` ${norm(candidate.address)} `.includes(` ${c} `);
}

/**
 * Pick the one result that is the typed business, or say why not.
 * A result counts when its name matches or nearly matches and it is in the typed city. Several that do are narrowed by
 * the website's address, then by an exact name; if more than one is still left, nothing is picked.
 * @param {Array<{ name: string, address: string, city?: string, website?: string }>} candidates
 * @param {{ name: string, city: string, website?: string }} wanted
 * @returns {{ status: 'found', place: object } | { status: 'not_found', reason: string } | { status: 'unsure', reason: string }}
 */
export function pickCandidate(candidates, wanted) {
  const list = Array.isArray(candidates) ? candidates.filter(c => c && typeof c === 'object') : [];
  if (list.length === 0) return { status: 'not_found', reason: 'No result came back for that name and city.' };
  // The website's domain is the strongest sign, so it is tried first (a unique match in the typed city is found).
  // A shared host (a Facebook page, a wixsite.com site) is never proof (review T1): sameSite is false for those.
  const bySite = list.filter(c => sameSite(wanted.website, c.website));
  let siteElsewhere = false;
  if (bySite.length === 1) {
    const only = bySite[0];
    if (!norm(wanted.city) || inCity(only, wanted.city)) return { status: 'found', place: only };
    // In another city: the name rule below may still find the business in the typed city (review T5).
    siteElsewhere = true;
  }
  const similar = list.filter(c => ['match', 'close'].includes(compareNames(c.name, wanted.name)));
  const here = similar.filter(c => inCity(c, wanted.city));
  if (here.length === 1) return { status: 'found', place: here[0] };
  if (here.length === 0 && siteElsewhere) {
    return { status: 'unsure', reason: "We found a business with your website in a different city, so we didn't use it." };
  }
  if (here.length > 1) {
    const byDomain = here.filter(c => sameSite(wanted.website, c.website));
    if (byDomain.length === 1) return { status: 'found', place: byDomain[0] };
    const exact = here.filter(c => compareNames(c.name, wanted.name) === 'match');
    if (exact.length === 1) return { status: 'found', place: exact[0] };
    return { status: 'unsure', reason: "More than one result looked like your business, so we didn't pick one." };
  }
  if (similar.length > 0) {
    return { status: 'unsure', reason: "We found a business with your name in a different city, so we didn't use it." };
  }
  // Results came back but none matched the name. That is not proof the business is missing.
  return { status: 'unsure', reason: "We couldn't tell which result is your business, so we didn't pick one." };
}
