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

const whole = v => (Number.isInteger(v) && v >= 0 ? v : 0);

/** The numbers in a heads-up email, and nothing else: whatever else is passed in is dropped. */
function allowanceCounts({ percent, used, left, limit, checks } = {}) {
  return { percent: whole(percent), used: whole(used), left: whole(left), limit: whole(limit), checks: whole(checks) };
}

function humanCheckCounts({ human } = {}) {
  return { human: whole(human) };
}

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
    /** Grader leads: recorded in memory only (never printed). */
    leads: [],
    async notifyLead({ business, score, reportUrl, lead }) {
      notifier.leads.push({ business, score, reportUrl, lead });
      while (notifier.leads.length > cap) notifier.leads.shift();
    },
    /** Heads-up emails about the day's AI calls: the five numbers, recorded in memory only. */
    allowances: [],
    async notifyAllowance(counts) {
      notifier.allowances.push(allowanceCounts(counts));
      while (notifier.allowances.length > cap) notifier.allowances.shift();
    },
    /** "The human check may be set up wrong" emails: the one number, recorded in memory only. */
    humanChecks: [],
    async notifyHumanCheck(counts) {
      notifier.humanChecks.push(humanCheckCounts(counts));
      while (notifier.humanChecks.length > cap) notifier.humanChecks.shift();
    },
    /**
     * Monthly watch emails to an owner (addon-monthly-watch): recorded in memory only. `failOwnerSends` makes the next
     * that many sends fail (sent: false), for the "3 failed sends pause the watch" rule.
     */
    owners: [],
    failOwnerSends: 0,
    async sendToOwner({ to, subject, text, headers } = {}) {
      if (notifier.failOwnerSends > 0) {
        notifier.failOwnerSends -= 1;
        return { notifier: 'mock', sent: false, error: 'mock_failure' };
      }
      notifier.owners.push({ to, subject, text, headers: { ...(headers ?? {}) } });
      while (notifier.owners.length > cap) notifier.owners.shift();
      return { notifier: 'mock', sent: true };
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
    /** One line: business name, score and report link. Never the visitor's name, email or phone. */
    async notifyLead({ business, score, reportUrl }) {
      write(JSON.stringify({ event: 'grader-lead', business, score, reportUrl }) + '\n');
    },
    /** One line with the five numbers. */
    async notifyAllowance(counts) {
      write(JSON.stringify({ event: 'grader-allowance', ...allowanceCounts(counts) }) + '\n');
    },
    /** One line with the one number. */
    async notifyHumanCheck(counts) {
      write(JSON.stringify({ event: 'grader-human-check', ...humanCheckCounts(counts) }) + '\n');
    },
    /**
     * Monthly watch email to an owner: nothing is sent (the console can't deliver email). One line says an email was
     * due, with no address, subject or text (an owner's email is never logged).
     */
    async sendToOwner() {
      write(`${JSON.stringify({ event: 'watch-email' })}\n`);
      return { notifier: 'console', sent: false };
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
    async notifyLead() {
      return { notifier: 'none', sent: false };
    },
    async notifyAllowance() {
      return { notifier: 'none', sent: false };
    },
    async notifyHumanCheck() {
      return { notifier: 'none', sent: false };
    },
    async sendToOwner() {
      return { notifier: 'none', sent: false };
    },
  };
}

/** The only headers an owner's email may carry (the unsubscribe pair, RFC 2369 and RFC 8058). */
export const OWNER_HEADERS = Object.freeze(['List-Unsubscribe', 'List-Unsubscribe-Post']);

/** The allowed headers, as one-line strings (no CR or LF, so no header can be added through a value). */
function ownerHeaders(headers) {
  const out = {};
  for (const name of OWNER_HEADERS) {
    const v = headers?.[name];
    if (typeof v !== 'string') continue;
    const line = v.replace(/[\r\n\u0000-\u001F\u007F]/g, '').trim();
    if (line !== '' && line.length <= 1000) out[name] = line;
  }
  return out;
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
    /**
     * New Grader lead: emailed to the admin only (never to a business owner), so the
     * admin can follow up. Never throws and never puts the key in its result.
     */
    async notifyLead({ business, score, reportUrl, lead }) {
      const fail = error => ({ notifier: 'resend', sent: false, error });
      const name = plainText(business);
      const text = [
        `New grader lead: ${name}`,
        `Score: ${Number.isInteger(score) ? score : 'not scored yet'}`,
        `Report: ${plainText(reportUrl)}`,
        '',
        `Name: ${plainText(lead?.name)}`,
        `Phone: ${plainText(lead?.phone)}`,
        `Email: ${plainText(lead?.email)}`,
        `OK to contact: ${lead?.okToContact ? 'yes' : 'no'}`,
      ].join('\n');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to: [adminEmail],
            subject: `New grader lead: ${name}`.replace(/\s+/g, ' ').slice(0, 200),
            text,
          }),
          signal: controller.signal,
        });
        if (!res.ok) return fail(`http_${res.status}`);
        return { notifier: 'resend', sent: true };
      } catch (err) {
        return fail(err?.name === 'AbortError' ? 'TimeoutError' : (err?.name ?? 'Error'));
      } finally {
        clearTimeout(timer);
      }
    },
    /**
     * "<percent>% of today's AI calls used": emailed to the admin only, with counts and nothing else.
     * Never throws and never puts the key in its result.
     */
    async notifyAllowance(counts) {
      const c = allowanceCounts(counts);
      return sendToAdmin({
        subject: `AI Visibility Check: ${c.percent}% of today's AI calls used`,
        text: `Used ${c.used} of ${c.limit} calls, ${c.left} left. ${c.checks} ${c.checks === 1 ? 'check' : 'checks'} run today.`,
      });
    },
    /** "The human check may be set up wrong": emailed to the admin only, with counts and nothing else. */
    async notifyHumanCheck(counts) {
      const c = humanCheckCounts(counts);
      return sendToAdmin({
        subject: 'AI Visibility Check: the human check may be set up wrong',
        text: [
          `Today the human check turned away ${c.human} ${c.human === 1 ? 'check' : 'checks'} and passed none.`,
          'If real owners are being turned away, check the two Turnstile keys in Render, or delete either one to turn the human check off.',
        ].join('\n'),
      });
    },
    sendToOwner,
  };

  /**
   * One plain-text email to a business owner (the monthly watch, addon-monthly-watch requirement 12), to one valid
   * address only, with only the unsubscribe headers. Never throws; never puts the key or the address in its result;
   * failures give the error name only. The same time limit as the admin emails.
   */
  async function sendToOwner({ to, subject, text, headers } = {}) {
    const fail = error => ({ notifier: 'resend', sent: false, error });
    const address = typeof to === 'string' ? to.trim() : '';
    if (!address || address.length > 254 || !EMAIL_RE.test(address)) return fail('invalid_to');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const extra = ownerHeaders(headers);
      const res = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [address],
          subject: plainText(subject).replace(/\s+/g, ' ').slice(0, 200),
          text: plainText(text),
          ...(Object.keys(extra).length > 0 ? { headers: extra } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) return fail(`http_${res.status}`);
      return { notifier: 'resend', sent: true };
    } catch (err) {
      return fail(err?.name === 'AbortError' ? 'TimeoutError' : (err?.name ?? 'Error'));
    } finally {
      clearTimeout(timer);
    }
  }

  /** One plain-text email to the admin address. Never throws; failures give the error name only. */
  async function sendToAdmin({ subject, text }) {
    const fail = error => ({ notifier: 'resend', sent: false, error });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [adminEmail], subject: subject.replace(/\s+/g, ' ').slice(0, 200), text }),
        signal: controller.signal,
      });
      if (!res.ok) return fail(`http_${res.status}`);
      return { notifier: 'resend', sent: true };
    } catch (err) {
      return fail(err?.name === 'AbortError' ? 'TimeoutError' : (err?.name ?? 'Error'));
    } finally {
      clearTimeout(timer);
    }
  }
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
