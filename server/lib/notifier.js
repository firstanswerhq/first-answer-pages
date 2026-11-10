// Notifier implementations. A notifier is { name, notify({ quote, listing }) -> Promise<void> }.
//
// The Listing model has no owner email, so the only real notifier is
// 'console'. Email or SMS adapters would implement the same interface later.

import { isTestRun } from './config.js';

/** Cap on the mock notifier's `sent` list outside test runs. */
const MOCK_MAX_SENT = 50;

// Control characters and angle brackets/ampersands/quotes are neutralized so
// notification text can never carry markup into an email or HTML relay.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const HTML_UNSAFE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Make a value safe to place in notification text.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeForNotice(value) {
  return String(value ?? '')
    .replace(CONTROL, '')
    .replace(/[&<>"']/g, ch => HTML_UNSAFE[ch]);
}

/**
 * Plain-text body a future adapter can send. Values are sanitized.
 * @param {{ quote: object, listing: object }} payload
 * @returns {string}
 */
export function formatNotice({ quote, listing }) {
  return [
    `New quote request for ${sanitizeForNotice(listing?.name)}`,
    `From: ${sanitizeForNotice(quote.name)}`,
    `Contact: ${sanitizeForNotice(quote.contact)}`,
    `Details: ${sanitizeForNotice(quote.details)}`,
  ].join('\n');
}

/**
 * In-memory notifier for tests. `sent` records each payload; setting
 * `failNext = true` makes the next notify() reject once.
 */
export function createMockNotifier({ maxSent } = {}) {
  const cap = Number.isInteger(maxSent) && maxSent > 0 ? maxSent : Infinity;
  const notifier = {
    name: 'mock',
    sent: [],
    failNext: false,
    async notify({ quote, listing }) {
      if (notifier.failNext) {
        notifier.failNext = false;
        throw new Error('mock notifier failure');
      }
      notifier.sent.push({ quote, listing, text: formatNotice({ quote, listing }) });
      while (notifier.sent.length > cap) notifier.sent.shift(); // drop oldest
    },
  };
  return notifier;
}

/**
 * Writes one JSON line with ids only. No name, contact, or details.
 * @param {{ write?: (line: string) => void }} [opts]
 */
export function createConsoleNotifier({ write = line => process.stdout.write(line) } = {}) {
  return {
    name: 'console',
    async notify({ quote, listing }) {
      write(JSON.stringify({ event: 'quote', quoteId: quote.id, listingId: listing?.id ?? quote.listingId }) + '\n');
    },
  };
}

/**
 * Sends nothing and says so. Used when no email is set up.
 */
export function createNoneNotifier() {
  return {
    name: 'none',
    async notify() {
      return { notifier: 'none', sent: false };
    },
  };
}

const RESEND_URL = 'https://api.resend.com/emails';
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Plain-text email body. Control characters removed; no HTML in plain text. */
function plainText(value) {
  return String(value ?? '').replace(CONTROL, '').trim();
}

/**
 * Emails each quote with Resend: to the owner (when the listing has a valid
 * ownerEmail) and always to the admin. notify() never throws and never
 * includes the key in its result.
 * @param {{ apiKey: string, from: string, adminEmail: string, fetch?: typeof fetch, timeoutMs?: number }} opts
 */
export function createResendNotifier({ apiKey, from, adminEmail, fetch: fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  return {
    name: 'resend',
    async notify({ quote, listing }) {
      const fail = error => ({ notifier: 'resend', sent: false, error });
      const to = [adminEmail];
      const owner = typeof listing?.ownerEmail === 'string' ? listing.ownerEmail.trim() : '';
      if (owner && owner.length <= 254 && EMAIL_RE.test(owner) && owner.toLowerCase() !== String(adminEmail).toLowerCase()) {
        to.unshift(owner);
      }
      const business = plainText(listing?.name);
      const text = [
        `New quote request for ${business}`,
        `From: ${plainText(quote.name)}`,
        `Contact: ${plainText(quote.contact)}`,
        '',
        'Details:',
        plainText(quote.details),
      ].join('\n');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to, subject: `New quote request: ${business}`.replace(/\s+/g, ' ').slice(0, 200), text }),
          signal: controller.signal,
        });
        if (!res.ok) return fail(`http_${res.status}`);
        return { notifier: 'resend', sent: true };
      } catch (err) {
        // Name only: messages could echo request details.
        return fail(err?.name === 'AbortError' ? 'TimeoutError' : (err?.name ?? 'Error'));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Pick a notifier from resolved config (config.notifierName).
 * @param {{ notifierName?: string }} config
 */
export function createNotifier(config = {}) {
  if (config.notifierName === 'console') return createConsoleNotifier();
  if (config.notifierName === 'none') return createNoneNotifier();
  if (config.notifierName === 'resend' && config.resend) {
    return createResendNotifier({ ...config.resend, timeoutMs: config.providerTimeoutMs });
  }
  // Test runs keep every payload; otherwise cap memory.
  const testRun = config.testRun ?? isTestRun();
  return createMockNotifier(testRun ? {} : { maxSent: MOCK_MAX_SENT });
}
