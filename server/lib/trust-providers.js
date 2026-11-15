/**
 * trust-providers.js — Stripe (fee + photo ID check) and Twilio Verify (phone code)
 *
 * Plain HTTPS calls, no SDKs. Keys come only from the environment. Nothing here
 * logs a key, a code, a phone number or a provider response body.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const STRIPE = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

export class TrustProviderError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'TrustProviderError';
    this.code = code;
    this.providerStatus = status;
  }
}

async function call(fetchImpl, url, { method = 'GET', auth, form, timeoutMs = 15000 }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: auth,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TrustProviderError('unreachable');
  }
  let data;
  try { data = await res.json(); } catch { data = undefined; }
  if (!res.ok || !data || typeof data !== 'object') throw new TrustProviderError('rejected', res.status);
  return data;
}

/**
 * @param {{ secretKey: string, webhookSecret?: string, fetch?: typeof fetch, clock?: { now(): Date|number } }} opts
 */
export function createStripePayments({ secretKey, webhookSecret, fetch: fetchImpl = globalThis.fetch, clock = { now: () => Date.now() } }) {
  const auth = `Bearer ${secretKey}`;
  return {
    name: 'stripe',
    testMode: secretKey.startsWith('sk_test_'),

    /** One-time payment page. @returns {Promise<{ id: string, url: string }>} */
    async createCheckout({ listingId, plan, amountCents, description, successUrl, cancelUrl }) {
      const s = await call(fetchImpl, `${STRIPE}/checkout/sessions`, {
        method: 'POST', auth,
        form: {
          mode: 'payment',
          success_url: successUrl,
          cancel_url: cancelUrl,
          client_reference_id: listingId,
          'metadata[listing_id]': listingId,
          'metadata[plan]': plan,
          'payment_method_types[0]': 'card', // cards settle at once; no delayed bank payments
          'line_items[0][quantity]': '1',
          'line_items[0][price_data][currency]': 'usd',
          'line_items[0][price_data][unit_amount]': String(amountCents),
          'line_items[0][price_data][product_data][name]': description,
        },
      });
      if (typeof s.id !== 'string' || typeof s.url !== 'string') throw new TrustProviderError('rejected');
      return { id: s.id, url: s.url };
    },

    /**
     * @returns {Promise<{ paid: boolean, open: boolean, url?: string, paymentIntent?: string, listingId?: string, plan?: string }>}
     *   open: the payment page can still be used
     */
    async getCheckout(id) {
      const s = await call(fetchImpl, `${STRIPE}/checkout/sessions/${encodeURIComponent(id)}`, { auth });
      return {
        paid: s.payment_status === 'paid',
        open: s.status === 'open' && typeof s.url === 'string',
        url: typeof s.url === 'string' ? s.url : undefined,
        paymentIntent: typeof s.payment_intent === 'string' ? s.payment_intent : undefined,
        listingId: s.metadata?.listing_id,
        plan: s.metadata?.plan,
      };
    },

    /** Close a payment page so it can no longer be paid. True when it is closed. */
    async expireCheckout(id) {
      try {
        await call(fetchImpl, `${STRIPE}/checkout/sessions/${encodeURIComponent(id)}/expire`, { method: 'POST', auth, form: {} });
        return true;
      } catch (err) {
        if (err instanceof TrustProviderError && err.code === 'rejected') return false; // already paid or already closed
        throw err;
      }
    },

    /** Cancel a photo ID check that has not finished. True when it is canceled. */
    async cancelIdCheck(id) {
      try {
        await call(fetchImpl, `${STRIPE}/identity/verification_sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', auth, form: {} });
        return true;
      } catch (err) {
        if (err instanceof TrustProviderError && err.code === 'rejected') return false; // already processing or finished
        throw err;
      }
    },

    /** Photo ID plus selfie check, hosted by Stripe. @returns {Promise<{ id: string, url: string }>} */
    async createIdCheck({ listingId, returnUrl }) {
      const s = await call(fetchImpl, `${STRIPE}/identity/verification_sessions`, {
        method: 'POST', auth,
        form: {
          type: 'document',
          'options[document][require_matching_selfie]': 'true',
          'metadata[listing_id]': listingId,
          return_url: returnUrl,
        },
      });
      if (typeof s.id !== 'string' || typeof s.url !== 'string') throw new TrustProviderError('rejected');
      return { id: s.id, url: s.url };
    },

    /** @returns {Promise<{ status: string, failed: boolean, listingId?: string }>} status 'verified' means passed */
    async getIdCheck(id) {
      const s = await call(fetchImpl, `${STRIPE}/identity/verification_sessions/${encodeURIComponent(id)}`, { auth });
      // requires_input with a last_error means a finished check that did not pass.
      return { status: String(s.status ?? ''), failed: s.status === 'requires_input' && s.last_error != null, listingId: s.metadata?.listing_id };
    },

    webhookEnabled: typeof webhookSecret === 'string' && webhookSecret !== '',

    /**
     * Check a Stripe-Signature header and return the event. Throws on any mismatch.
     * @param {Buffer|string} rawBody @param {unknown} header
     * @returns {{ type: string, object: object }}
     */
    parseWebhook(rawBody, header) {
      if (!this.webhookEnabled) throw new TrustProviderError('webhook_off');
      const parts = Object.create(null);
      const sigs = [];
      for (const piece of String(header ?? '').split(',')) {
        const i = piece.indexOf('=');
        if (i === -1) continue;
        const k = piece.slice(0, i).trim();
        const v = piece.slice(i + 1).trim();
        if (k === 'v1') sigs.push(v); else parts[k] = v;
      }
      const t = Number(parts.t);
      const nowSeconds = Math.floor(new Date(clock.now()).getTime() / 1000);
      if (!Number.isInteger(t) || Math.abs(nowSeconds - t) > WEBHOOK_TOLERANCE_SECONDS) throw new TrustProviderError('bad_signature');
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
      const expected = createHmac('sha256', webhookSecret).update(`${t}.`).update(body).digest();
      const ok = sigs.some(s => {
        if (!/^[0-9a-f]{64}$/i.test(s)) return false;
        return timingSafeEqual(Buffer.from(s, 'hex'), expected);
      });
      if (!ok) throw new TrustProviderError('bad_signature');
      let event;
      try { event = JSON.parse(body.toString('utf8')); } catch { throw new TrustProviderError('bad_body'); }
      const object = event?.data?.object;
      if (typeof event?.type !== 'string' || !object || typeof object !== 'object') throw new TrustProviderError('bad_body');
      return { type: event.type, object };
    },
  };
}

/**
 * Twilio Verify: sends a code by text or voice call and checks it.
 * @param {{ accountSid: string, authToken: string, serviceSid: string, fetch?: typeof fetch }} opts
 */
export function createTwilioPhone({ accountSid, authToken, serviceSid, fetch: fetchImpl = globalThis.fetch }) {
  const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  const base = `https://verify.twilio.com/v2/Services/${encodeURIComponent(serviceSid)}`;
  return {
    name: 'twilio',
    /** @param {string} to +1XXXXXXXXXX @param {'sms'|'call'} channel */
    async send(to, channel) {
      await call(fetchImpl, `${base}/Verifications`, {
        method: 'POST', auth, form: { To: to, Channel: channel === 'call' ? 'call' : 'sms' },
      });
    },
    /** @returns {Promise<boolean>} true when the code is right */
    async check(to, code) {
      try {
        const r = await call(fetchImpl, `${base}/VerificationCheck`, { method: 'POST', auth, form: { To: to, Code: code } });
        return r.status === 'approved';
      } catch (err) {
        // 404: no code is waiting (expired, used up, or never sent). Treat as a wrong code.
        if (err instanceof TrustProviderError && err.providerStatus === 404) return false;
        throw err;
      }
    },
  };
}

/**
 * Real providers when every key is set, otherwise undefined (verification off).
 * @param {object} config configFromEnv result
 */
export function createTrustProviders(config, deps = {}) {
  const t = config?.trust;
  if (!t || !t.stripeSecretKey || !t.twilioAccountSid || !t.twilioAuthToken || !t.twilioVerifyServiceSid) return undefined;
  return {
    payments: createStripePayments({ secretKey: t.stripeSecretKey, webhookSecret: t.stripeWebhookSecret, fetch: deps.fetch, clock: deps.clock }),
    phone: createTwilioPhone({ accountSid: t.twilioAccountSid, authToken: t.twilioAuthToken, serviceSid: t.twilioVerifyServiceSid, fetch: deps.fetch }),
  };
}
