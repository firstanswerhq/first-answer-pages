/**
 * grade-stamp.js — signed values for the Grader: the form timer and the
 * per-report cookies. Everything is signed with GRADER_SECRET (HMAC-SHA-256,
 * hex) and checked with timingSafeEqual. Nothing here logs a value or the secret.
 *
 * Form timer ("stamp"): `<ms>.<hmac(secret, 'form:' + ms)>`. It is accepted when
 * the signature matches, the form is at least 3 seconds old and at most 2 hours old.
 *
 * Cookies, each named `<prefix>_<gradeId>`, valued `hmac(secret, '<purpose>:' + gradeId)`:
 *   unlock  g_<id>   opens the full report (set after the lead form)
 *   ran     gr_<id>  marks the browser that ran the check (Google's live answer)
 *   claim   gc_<id>  marks the browser that claimed the free page (Draft reuse)
 * All are HttpOnly, SameSite=Lax, Secure in production, Path=/grade/<id>, 90 days.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const STAMP_MIN_AGE_MS = 3 * 1000;
export const STAMP_MAX_AGE_MS = 2 * 60 * 60 * 1000;
export const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

const COOKIES = Object.freeze({
  unlock: { prefix: 'g', purpose: 'unlock' },
  ran: { prefix: 'gr', purpose: 'ran' },
  claim: { prefix: 'gc', purpose: 'claim' },
});

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const HEX_64 = /^[0-9a-f]{64}$/;

const sign = (secret, message) => createHmac('sha256', String(secret)).update(message).digest('hex');

/** Constant-time comparison of two hex signatures; false for anything that is not 64 hex characters. */
function sameSignature(expected, given) {
  if (typeof given !== 'string' || !HEX_64.test(given) || !HEX_64.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}

/**
 * The hidden timer value for a new form.
 * @param {string} secret
 * @param {number} nowMs
 * @returns {string}
 */
export function signFormStamp(secret, nowMs) {
  const ms = String(Math.trunc(nowMs));
  return `${ms}.${sign(secret, `form:${ms}`)}`;
}

/**
 * Check a submitted timer value.
 * @returns {{ ok: true } | { ok: false, reason: 'bad' | 'too_fast' | 'too_old' }}
 */
export function checkFormStamp(secret, value, nowMs) {
  if (typeof value !== 'string') return { ok: false, reason: 'bad' };
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value);
  if (!match) return { ok: false, reason: 'bad' };
  const [, ms, signature] = match;
  if (!sameSignature(sign(secret, `form:${ms}`), signature)) return { ok: false, reason: 'bad' };
  const age = nowMs - Number(ms);
  if (age < STAMP_MIN_AGE_MS) return { ok: false, reason: 'too_fast' };
  if (age > STAMP_MAX_AGE_MS) return { ok: false, reason: 'too_old' };
  return { ok: true };
}

function kindOf(kind) {
  const entry = Object.hasOwn(COOKIES, kind) ? COOKIES[kind] : undefined;
  if (!entry) throw new TypeError('Unknown cookie kind');
  return entry;
}

function idOf(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new TypeError('Bad grade id');
  return id;
}

/** Cookie name for a kind ('unlock', 'ran' or 'claim') and a Grade id. */
export function cookieName(kind, id) {
  return `${kindOf(kind).prefix}_${idOf(id)}`;
}

/** The signed value a cookie of this kind carries for this Grade. */
export function cookieValue(secret, kind, id) {
  return sign(secret, `${kindOf(kind).purpose}:${idOf(id)}`);
}

/** The `Set-Cookie` header value for a kind of cookie on one Grade. */
export function setCookieHeader(secret, kind, id, { production = false } = {}) {
  const parts = [
    `${cookieName(kind, id)}=${cookieValue(secret, kind, id)}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=/grade/${idOf(id)}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (production) parts.push('Secure');
  return parts.join('; ');
}

/** The value of one cookie from a raw `Cookie` request header, or undefined. */
export function readCookie(header, name) {
  if (typeof header !== 'string' || typeof name !== 'string') return undefined;
  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq === -1) continue;
    if (piece.slice(0, eq).trim() === name) return piece.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * True when the request's `Cookie` header carries a correctly signed cookie of this
 * kind for this Grade. A missing, malformed or forged value is false.
 * @param {string} secret
 * @param {'unlock' | 'ran' | 'claim'} kind
 * @param {string} id the Grade id
 * @param {string | undefined} cookieHeader the raw `Cookie` header
 */
export function hasValidCookie(secret, kind, id, cookieHeader) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return false;
  const given = readCookie(cookieHeader, cookieName(kind, id));
  return sameSignature(cookieValue(secret, kind, id), given);
}
