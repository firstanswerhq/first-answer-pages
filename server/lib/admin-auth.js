/**
 * admin-auth.js — shared bearer-token check for admin-only routes.
 *
 * The token comes from ctx.config.adminToken (ADMIN_TOKEN, or the older
 * SEANCE_ADMIN_TOKEN). Tokens are accepted only in the Authorization header,
 * never in a query string.
 *
 *   403  no token configured (checked first: the route is disabled)
 *   429  `admin-auth:<ip>` budget (10 wrong attempts/hour) exhausted, with
 *        Retry-After; checked before the token is compared
 *   401  missing or wrong token, with WWW-Authenticate: Bearer (consumes budget;
 *        a correct token does not)
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { RULES } from './rate-limiter.js';

const sha256 = s => createHash('sha256').update(String(s)).digest();

/** True when the Authorization header carries the expected bearer token. */
export function tokenMatches(header, expected) {
  const match = typeof header === 'string' ? /^Bearer (.+)$/i.exec(header.trim()) : null;
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]), sha256(expected));
}

/**
 * @param {{ config: { adminToken?: string } }} ctx
 * @returns {import('express').RequestHandler}
 */
export function requireAdmin(ctx) {
  return (req, res, next) => {
    const expected = ctx.config.adminToken;
    if (!expected) {
      return res.status(403).json({ error: 'Admin access is disabled' });
    }
    const limiter = ctx.rateLimiter;
    const key = `admin-auth:${req.ip}`;
    const rule = RULES['admin-auth'];

    // Throttle first, so brute force stays blocked even if a later guess is right.
    if (typeof limiter?.peek === 'function') {
      const check = limiter.peek(key, rule);
      if (!check.allowed) {
        res.set('Retry-After', String(check.retryAfterSeconds));
        return res.status(429).json({ error: 'Too many attempts' });
      }
    }

    if (!tokenMatches(req.headers.authorization, expected)) {
      if (typeof limiter?.consume === 'function') {
        const result = limiter.consume(key, rule);
        if (result && result.allowed === false) {
          res.set('Retry-After', String(result.retryAfterSeconds));
          return res.status(429).json({ error: 'Too many attempts' });
        }
      }
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}
