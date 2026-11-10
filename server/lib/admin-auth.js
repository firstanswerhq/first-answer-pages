/**
 * admin-auth.js — shared admin check: bearer token, plus (opt-in) a login cookie.
 *
 * The token comes from ctx.config.adminToken (ADMIN_TOKEN, or the older
 * SEANCE_ADMIN_TOKEN). Bearer tokens are accepted only in the Authorization
 * header, never in a query string.
 *
 *   403  no token configured (checked first: the route is disabled)
 *   ok   a correct token (bearer, or the `fap_admin` cookie when allowed) is
 *        checked FIRST and always succeeds, even from a throttled IP
 *   302  browser GET (Accept: text/html, no bearer header) without a valid
 *        cookie -> /admin/login (cookie mode only; not counted)
 *   429  wrong/missing token from an IP whose `admin-auth:<ip>` budget
 *        (10 wrong attempts/hour) is used up, with Retry-After
 *   401  wrong or missing token, with WWW-Authenticate: Bearer (consumes budget)
 *   403  cookie-authenticated POST whose Origin/Referer host is not ours (CSRF)
 *
 * The cookie value is `<issuedAt>.<HMAC-SHA256(token, issuedAt)>` (issuedAt in
 * ms), never the token itself. The server rejects a cookie older than 12 hours
 * or with a bad MAC, so a copied cookie stops working on its own.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { DEFAULT_BASE_URL } from './config.js';
import { RULES } from './rate-limiter.js';

export const ADMIN_COOKIE = 'fap_admin';
export const ADMIN_COOKIE_MAX_AGE = 12 * 60 * 60; // 12 hours, in seconds

const sha256 = s => createHash('sha256').update(String(s)).digest();

/** True when the Authorization header carries the expected bearer token. */
export function tokenMatches(header, expected) {
  const match = typeof header === 'string' ? /^Bearer (.+)$/i.exec(header.trim()) : null;
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]), sha256(expected));
}

/** True when a plain (non-bearer) token, e.g. from the login form, is correct. */
export function plainTokenMatches(token, expected) {
  if (typeof token !== 'string' || token === '') return false;
  return timingSafeEqual(sha256(token), sha256(expected));
}

/** Allowed clock skew for a cookie issued "in the future" (ms). */
const COOKIE_SKEW_MS = 60 * 1000;

/**
 * Cookie value for a token issued at `issuedAt` (ms): `<issuedAt>.<hex HMAC>`.
 * The HMAC key is the token, so changing ADMIN_TOKEN invalidates every cookie.
 */
export function adminCookieValue(token, issuedAt) {
  const t = String(Math.floor(Number(issuedAt)));
  return `${t}.${createHmac('sha256', String(token)).update(t).digest('hex')}`;
}

/** Reads one cookie from the Cookie header by hand. */
export function readCookie(header, name) {
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * True when the request carries a login cookie for the expected token that is
 * at most 12 hours old (timing-safe MAC compare).
 * @param {object} req
 * @param {string} expected the admin token
 * @param {number} [now] current time in ms (pass ctx.clock.now())
 */
export function cookieMatches(req, expected, now = Date.now()) {
  const value = readCookie(req.headers.cookie, ADMIN_COOKIE);
  const match = typeof value === 'string' ? /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value) : null;
  if (!match) return false;
  const issuedAt = Number(match[1]);
  const age = now - issuedAt;
  if (!Number.isFinite(age) || age < -COOKIE_SKEW_MS || age > ADMIN_COOKIE_MAX_AGE * 1000) return false;
  return timingSafeEqual(sha256(value), sha256(adminCookieValue(expected, issuedAt)));
}

const clockNow = ctx => (typeof ctx?.clock?.now === 'function' ? Number(ctx.clock.now()) : Date.now());

/**
 * Secure is always set in production. Outside production it is set only when
 * the request itself is https, so local http development still works.
 */
function secureFlag(ctx, req) {
  return ctx.config.production === true || req.secure === true;
}

export function setAdminCookie(ctx, req, res, token) {
  const secure = secureFlag(ctx, req) ? '; Secure' : '';
  res.append('Set-Cookie',
    `${ADMIN_COOKIE}=${adminCookieValue(token, clockNow(ctx))}; HttpOnly${secure}; SameSite=Strict; Path=/admin; Max-Age=${ADMIN_COOKIE_MAX_AGE}`);
}

export function clearAdminCookie(ctx, req, res) {
  const secure = secureFlag(ctx, req) ? '; Secure' : '';
  res.append('Set-Cookie', `${ADMIN_COOKIE}=; HttpOnly${secure}; SameSite=Strict; Path=/admin; Max-Age=0`);
}

/**
 * CSRF check: Origin (or, when absent, Referer) host must match BASE_URL's host.
 * With no BASE_URL configured (local dev) it compares with the Host header.
 */
export function sameOrigin(ctx, req) {
  const configured = ctx.config.baseUrl && ctx.config.baseUrl !== DEFAULT_BASE_URL;
  let expected;
  try {
    expected = configured ? new URL(ctx.config.baseUrl).host : String(req.get('host') ?? '');
  } catch {
    return false;
  }
  const source = req.get('origin') || req.get('referer');
  if (!source || !expected) return false;
  try {
    return new URL(source).host.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Counts a wrong attempt. Returns { retryAfterSeconds } when the IP is (now)
 * throttled, otherwise null. Used by the middleware and the login form.
 */
export function throttled(ctx, req, { consume }) {
  const limiter = ctx.rateLimiter;
  const key = `admin-auth:${req.ip}`;
  const rule = RULES['admin-auth'];
  if (typeof limiter?.peek === 'function') {
    const check = limiter.peek(key, rule);
    if (!check.allowed) return { retryAfterSeconds: check.retryAfterSeconds };
  }
  if (consume && typeof limiter?.consume === 'function') {
    const result = limiter.consume(key, rule);
    if (result && result.allowed === false) return { retryAfterSeconds: result.retryAfterSeconds };
  }
  return null;
}

/**
 * @param {{ config: { adminToken?: string } }} ctx
 * @param {{ cookie?: boolean }} [options] cookie: also accept the login cookie
 * @returns {import('express').RequestHandler}
 */
export function requireAdmin(ctx, { cookie = false } = {}) {
  return (req, res, next) => {
    const expected = ctx.config.adminToken;
    if (!expected) {
      return res.status(403).json({ error: 'Admin access is disabled' });
    }

    // Correct token first: never locked out, whatever the throttle says.
    const hasBearer = typeof req.headers.authorization === 'string';
    if (tokenMatches(req.headers.authorization, expected)) return next();

    if (cookie && cookieMatches(req, expected, clockNow(ctx))) {
      const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
      if (!safe && !sameOrigin(ctx, req)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return next();
    }

    if (cookie && !hasBearer && (req.method === 'GET' || req.method === 'HEAD')
      && String(req.headers.accept ?? '').includes('text/html')) {
      return res.redirect('/admin/login');
    }

    // Wrong or missing token: throttled IPs get 429, others spend one attempt.
    const block = throttled(ctx, req, { consume: true });
    if (block) {
      res.set('Retry-After', String(block.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many attempts' });
    }
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Unauthorized' });
  };
}
