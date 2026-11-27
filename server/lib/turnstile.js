/**
 * turnstile.js — the human check on the AI Visibility Check form (Cloudflare Turnstile).
 *
 * `createTurnstile({ siteKey, secretKey })` gives null unless both keys are set, so the check is off
 * until both are. Otherwise `{ siteKey, verify(token, ip) }`, where `verify` resolves to:
 *   'ok'            Cloudflare confirmed the visitor.
 *   'failed'        no token, a bad token, or one already used or expired.
 *   'unreachable'   Cloudflare could not be reached, timed out, answered 500 or more, or sent a reply
 *                   that cannot be read or has no true/false `success`. The body is read for any lower status.
 *   'misconfigured' Cloudflare says the secret key is wrong or missing, or it has an internal error.
 *                   That is not the visitor's fault, so the route lets the check through.
 *
 * The address is fixed, redirects are refused, and the wait is limited. The token and the secret are
 * never logged, stored or put in an error message. Tests pass a fake `fetch` or a fake verifier.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MAX_TOKEN_LENGTH = 2048;
const MISCONFIGURED_CODES = ['invalid-input-secret', 'missing-input-secret', 'internal-error'];

const clean = v => (typeof v === 'string' ? v.trim() : '');

/** "::ffff:203.0.113.7" (or its hex form) becomes "203.0.113.7"; anything else is unchanged. */
function plainAddress(ip) {
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return ip;
}

/**
 * @param {{ siteKey?: string, secretKey?: string, fetch?: Function, timeoutMs?: number }} [opts]
 * @returns {{ siteKey: string, verify: (token: unknown, ip?: string) => Promise<'ok'|'failed'|'unreachable'|'misconfigured'> } | null}
 */
export function createTurnstile({ siteKey, secretKey, fetch = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const site = clean(siteKey);
  const secret = clean(secretKey);
  if (site === '' || secret === '') return null;

  async function verify(token, ip) {
    if (typeof token !== 'string' || token === '' || token.length > MAX_TOKEN_LENGTH) return 'failed';
    try {
      const fields = new URLSearchParams({ secret, response: token });
      if (typeof ip === 'string' && ip !== '') fields.set('remoteip', plainAddress(ip));
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        body: fields,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res) return 'unreachable';
      // Cloudflare does not say which status goes with a bad token, so a 4xx body is read like any other.
      // Only a server error (500 or more) means Cloudflare is failing.
      if (typeof res.status === 'number' && res.status >= 500) return 'unreachable';
      const reply = await res.json();
      if (!reply || typeof reply !== 'object') return 'unreachable';
      if (reply.success === true) return 'ok';
      if (reply.success !== false) return 'unreachable';
      const codes = Array.isArray(reply['error-codes']) ? reply['error-codes'] : [];
      return codes.some(c => MISCONFIGURED_CODES.includes(c)) ? 'misconfigured' : 'failed';
    } catch {
      // Nothing from the error is kept: it could echo the request.
      return 'unreachable';
    }
  }

  return { siteKey: site, verify };
}
