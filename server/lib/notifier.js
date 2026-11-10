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
 * Pick a notifier from resolved config (config.notifierName).
 * @param {{ notifierName?: string }} config
 */
export function createNotifier(config = {}) {
  if (config.notifierName === 'console') return createConsoleNotifier();
  // Test runs keep every payload; otherwise cap memory.
  const testRun = config.testRun ?? isTestRun();
  return createMockNotifier(testRun ? {} : { maxSent: MOCK_MAX_SENT });
}
