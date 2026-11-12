/**
 * grade-stamp.js — signed values for the Grader: the form-start timer and the
 * per-Grade cookies. Everything is an HMAC of a fixed label plus the value,
 * keyed with GRADER_SECRET (or the per-process key), and compared in constant time.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const MIN_FORM_AGE_MS = 3000;
export const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1000;

const sign = (secret, text) => createHmac('sha256', secret).update(text).digest('hex');

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The hidden form field: "<ms>.<hmac>". */
export function makeStamp(secret, nowMs) {
  const ms = String(Math.trunc(nowMs));
  return `${ms}.${sign(secret, `form:${ms}`)}`;
}

/** True when the stamp is ours and the form was served 3 seconds to 2 hours ago. */
export function checkStamp(secret, value, nowMs) {
  if (typeof value !== 'string') return false;
  const m = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(value);
  if (!m) return false;
  if (!same(m[2], sign(secret, `form:${m[1]}`))) return false;
  const age = nowMs - Number(m[1]);
  return age >= MIN_FORM_AGE_MS && age <= MAX_FORM_AGE_MS;
}

/** Cookie value that unlocks the Full_Report of one Grade. */
export const unlockToken = (secret, gradeId) => sign(secret, `unlock:${gradeId}`);

/** Cookie value that shows this browser claimed one Draft of the Grade: "<draftId>.<hmac>". */
export const claimCookieValue = (secret, gradeId, draftId) => `${draftId}.${sign(secret, `claim:${gradeId}:${draftId}`)}`;

/** Value of one cookie from a request, or ''. */
export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

/** The Draft id this browser claimed for the Grade (from its signed cookie), or ''. */
export function readClaim(req, secret, gradeId) {
  const value = readCookie(req, `gc_${gradeId}`);
  const dot = value.lastIndexOf('.');
  if (dot < 1) return '';
  const draftId = value.slice(0, dot);
  return same(value.slice(dot + 1), sign(secret, `claim:${gradeId}:${draftId}`)) ? draftId : '';
}

/** True when the request carries a valid cookie of the given kind for this Grade. */
export function hasToken(req, name, expected) {
  const got = readCookie(req, name);
  return got !== '' && same(got, expected);
}
