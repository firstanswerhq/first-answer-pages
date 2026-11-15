/**
 * verify.js — the paid "Verified" stamp, reached from the owner's private link
 *
 *   GET  /rise/drafts/:id/verify              where the owner stands, and the next step
 *   POST /rise/drafts/:id/verify/pay          go to the payment page
 *   POST /rise/drafts/:id/verify/phone/send   text or call the listing's phone with a code
 *   POST /rise/drafts/:id/verify/phone/check  type the code in
 *   POST /rise/drafts/:id/verify/id           go to the photo ID check
 *   POST /webhooks/stripe                     signed payment and ID results from Stripe
 *
 * Every address returns 404 while verification is off (no provider keys).
 * A payment or ID result is believed only when Stripe itself says so: either a
 * signed webhook, or this server asking Stripe directly. Never a browser redirect.
 */

import express, { Router } from 'express';
import { RULES } from '../lib/rate-limiter.js';
import { createDraftStore } from '../lib/drafts.js';
import { layout, escapeHtml } from '../lib/html.js';
import { baseUrlFor } from '../lib/base-url.js';
import {
  trustStatus, planFor, paidThroughAfter, toE164, lastFour, formatFee,
} from '../lib/trust.js';

const NOTES = Object.freeze({
  sent: 'Code sent. It can take a minute to arrive.',
  called: 'We are calling that number now with your code.',
  wrong: 'That code did not match. Check it and try again, or ask for a new one.',
  slow: 'Too many tries. Please wait a while and try again.',
  down: 'We could not reach the service just now. Nothing was charged. Please try again in a minute.',
  canceled: 'Payment canceled. Nothing was charged.',
});

function formatDay(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' }).format(at);
}

/** The owner's verification page. Exported for tests. */
export function verifyPage({ draftId, listing, status, price, note, testMode }) {
  const base = `/rise/drafts/${encodeURIComponent(draftId)}/verify`;
  const done = '<span class="verify-done">Done</span>';
  const noteHtml = note && Object.hasOwn(NOTES, note)
    ? `\n  <p class="notice" role="status">${escapeHtml(NOTES[note])}</p>` : '';
  const testHtml = testMode
    ? '\n  <p class="notice" role="note">Test mode: no real money moves and no real ID is checked.</p>' : '';
  const priceLine = price.plan === 'founder'
    ? `As a Founding Member you pay ${formatFee(price.amountCents)} once and stay verified for life.`
    : `Verification is ${formatFee(price.amountCents)} per year.`;

  let payStep;
  if (status.removed) {
    payStep = '<p>Verification for this listing has been turned off. Please contact us.</p>';
  } else if (status.paid) {
    const until = status.plan === 'yearly' && status.paidThrough ? ` Paid through ${escapeHtml(formatDay(status.paidThrough))}.` : '';
    payStep = `<p>${done} Fee paid.${until}</p>`;
  } else {
    payStep = `<p>${escapeHtml(priceLine)} You pay on a secure Stripe page. We never see your card number.</p>
    <form method="POST" action="${base}/pay"><button type="submit">Pay ${formatFee(price.amountCents)}</button></form>`;
  }

  const four = lastFour(listing.phone);
  let phoneStep;
  if (status.phoneOk) {
    phoneStep = `<p>${done} The phone number on your listing is confirmed.</p>`;
  } else if (!status.paid || status.removed) {
    phoneStep = '<p class="hint">Opens after the fee is paid.</p>';
  } else if (!toE164(listing.phone)) {
    phoneStep = '<p>We can only check 10-digit US phone numbers. Please contact us and we will help.</p>';
  } else {
    phoneStep = `<p>We send a code to the phone number on your listing, ending in ${escapeHtml(four)}. Answer it to show the number is yours.</p>
    <form method="POST" action="${base}/phone/send" class="verify-inline">
      <button type="submit" name="channel" value="sms">Text me the code</button>
      <button type="submit" name="channel" value="call" class="button-secondary">Call me with the code</button>
    </form>
    <form method="POST" action="${base}/phone/check" class="verify-code">
      <label for="verify-code">Type the code</label>
      <input id="verify-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{4,8}" maxlength="8" required>
      <button type="submit">Check code</button>
    </form>`;
  }

  let idStep;
  if (status.idOk) {
    idStep = `<p>${done} Photo ID and selfie matched.</p>`;
  } else if (!status.paid || status.removed) {
    idStep = '<p class="hint">Opens after the fee is paid.</p>';
  } else if (status.idAttemptsLeft === 0) {
    idStep = '<p>The photo ID check did not pass after three tries. Please contact us and we will help.</p>';
  } else {
    idStep = `<p>Take a photo of your driver's license or other government ID, then a selfie. Stripe checks that they match. We are told only whether it passed. We never see or keep your ID or your photo.</p>
    <form method="POST" action="${base}/id"><button type="submit">Start the photo ID check</button></form>`;
  }

  const headline = status.verified
    ? `<p class="notice success-box" role="status">${escapeHtml(listing.name)} is Verified. The stamp is on your listing now.</p>`
    : '';

  const body = `<section class="verify">
  <h1>Get the Verified stamp</h1>
  <p class="tagline">Show customers there is a real person behind ${escapeHtml(listing.name)}.</p>${testHtml}${noteHtml}
  ${headline}
  <ol class="verify-steps">
    <li><h2>Pay the fee</h2>
    ${payStep}</li>
    <li><h2>Confirm your business phone</h2>
    ${phoneStep}</li>
    <li><h2>Check your photo ID</h2>
    ${idStep}</li>
  </ol>
  <p><a href="/listings/${encodeURIComponent(listing.id)}">See your listing</a></p>
</section>`;
  return layout({ title: 'Get the Verified stamp: First Answer Pages', body });
}

/**
 * @param {{ store: object, trust?: { payments: object, phone: object }, rateLimiter: object, clock?: object, config: object }} ctx
 */
export function createVerifyRouter(ctx) {
  const router = Router();
  const providers = ctx.trust;
  if (!providers) return router; // verification off: nothing is mounted, every address is a 404

  const { store } = ctx;
  const { payments, phone } = providers;
  const drafts = createDraftStore({ store, clock: ctx.clock, newId: ctx.newId });
  const form = express.urlencoded({ extended: false, limit: 2048, parameterLimit: 5 });
  const now = () => new Date(ctx.clock ? ctx.clock.now() : Date.now());
  const fees = { founderCents: ctx.config.trust.founderCents, yearlyCents: ctx.config.trust.yearlyCents };
  const logFail = (what, err) => process.stderr.write(`[verify] ${what} failed code=${typeof err?.code === 'string' ? err.code : 'internal'}\n`);

  /** The owner's live listing for a draft link, or undefined. */
  async function ownerListing(draftId) {
    const found = await drafts.get(draftId);
    const draft = found.status === 200 ? found.draft : undefined;
    if (draft?.status !== 'published' || typeof draft.listingId !== 'string') return undefined;
    const listing = store.findById(draft.listingId);
    return listing && !store.isSeed(listing.id) ? listing : undefined;
  }

  const statusOf = listing => trustStatus(store.getTrustRecord(listing.id), listing, now());

  /** Record a payment once. A payment already counted is ignored. */
  async function markPaid(listingId, plan, ref) {
    await store.updateTrustRecord(listingId, r => {
      const seen = Array.isArray(r.payments) ? r.payments : [];
      if (seen.includes(ref)) return;
      const at = now();
      r.paidThrough = paidThroughAfter(plan, r, at.getTime());
      r.plan = plan === 'founder' ? 'founder' : 'yearly';
      r.paidAt = at.toISOString();
      r.paymentRef = ref;
      r.payments = [...seen, ref].slice(-20);
      r.idAttempts = 0;
      delete r.pendingCheckout;
    });
  }

  async function markIdPassed(listingId, ref) {
    const listing = store.findById(listingId);
    if (!listing) return;
    await store.updateTrustRecord(listingId, r => {
      r.identity = { ref, at: now().toISOString(), name: listing.name };
      delete r.pendingIdCheck;
    });
  }

  /** Ask Stripe about anything the owner started and we have not heard back on. */
  async function catchUp(listing) {
    const record = store.getTrustRecord(listing.id);
    if (!record) return;
    const status = trustStatus(record, listing, now());
    try {
      if (!status.paid && typeof record.pendingCheckout?.id === 'string') {
        const s = await payments.getCheckout(record.pendingCheckout.id);
        if (s.paid && s.listingId === listing.id) await markPaid(listing.id, s.plan, record.pendingCheckout.id);
      }
      if (!status.idOk && typeof record.pendingIdCheck === 'string') {
        const s = await payments.getIdCheck(record.pendingIdCheck);
        if (s.status === 'verified' && s.listingId === listing.id) await markIdPassed(listing.id, record.pendingIdCheck);
      }
    } catch (err) {
      logFail('catch-up', err);
    }
  }

  const back = (res, draftId, note) => res.redirect(303, `/rise/drafts/${encodeURIComponent(draftId)}/verify${note ? `?note=${note}` : ''}`);
  const notFound = (req, res, next) => next(); // falls through to the site's 404 page

  router.get('/rise/drafts/:id/verify', async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      await catchUp(listing);
      const price = planFor(store.getFounder(listing.id), fees);
      res.status(200).type('html').send(verifyPage({
        draftId: req.params.id, listing, status: statusOf(listing), price,
        note: typeof req.query.note === 'string' ? req.query.note : '',
        testMode: payments.testMode === true,
      }));
    } catch (err) { next(err); }
  });

  router.post('/rise/drafts/:id/verify/pay', async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      const status = statusOf(listing);
      if (status.paid || status.removed) return back(res, req.params.id);
      const limited = ctx.rateLimiter.consume(`verify-pay:${listing.id}`, RULES['verify-pay']);
      if (!limited.allowed) return back(res, req.params.id, 'slow');
      const price = planFor(store.getFounder(listing.id), fees);
      const base = baseUrlFor(req, ctx.config);
      const page = `${base}/rise/drafts/${encodeURIComponent(req.params.id)}/verify`;
      let session;
      try {
        session = await payments.createCheckout({
          listingId: listing.id, plan: price.plan, amountCents: price.amountCents,
          description: price.plan === 'founder'
            ? 'First Answer Pages verification, Founding Member (one time, for life)'
            : 'First Answer Pages verification (one year)',
          successUrl: page, cancelUrl: `${page}?note=canceled`,
        });
      } catch (err) {
        logFail('checkout', err);
        return back(res, req.params.id, 'down');
      }
      await store.updateTrustRecord(listing.id, r => { r.pendingCheckout = { id: session.id, plan: price.plan }; });
      res.redirect(303, session.url);
    } catch (err) { next(err); }
  });

  router.post('/rise/drafts/:id/verify/phone/send', form, async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      const status = statusOf(listing);
      const to = toE164(listing.phone);
      if (!status.paid || status.removed || status.phoneOk || !to) return back(res, req.params.id);
      const limited = ctx.rateLimiter.consume(`verify-send:${listing.id}`, RULES['verify-send']);
      if (!limited.allowed) return back(res, req.params.id, 'slow');
      const channel = req.body?.channel === 'call' ? 'call' : 'sms';
      try {
        await phone.send(to, channel);
      } catch (err) {
        logFail('phone-send', err);
        return back(res, req.params.id, 'down');
      }
      back(res, req.params.id, channel === 'call' ? 'called' : 'sent');
    } catch (err) { next(err); }
  });

  router.post('/rise/drafts/:id/verify/phone/check', form, async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      const status = statusOf(listing);
      const to = toE164(listing.phone);
      if (!status.paid || status.removed || status.phoneOk || !to) return back(res, req.params.id);
      const code = typeof req.body?.code === 'string' ? req.body.code.replace(/\s/g, '') : '';
      if (!/^\d{4,8}$/.test(code)) return back(res, req.params.id, 'wrong');
      const limited = ctx.rateLimiter.consume(`verify-check:${listing.id}`, RULES['verify-check']);
      if (!limited.allowed) return back(res, req.params.id, 'slow');
      let ok;
      try {
        ok = await phone.check(to, code);
      } catch (err) {
        logFail('phone-check', err);
        return back(res, req.params.id, 'down');
      }
      if (!ok) return back(res, req.params.id, 'wrong');
      await store.updateTrustRecord(listing.id, r => { r.phone = { number: to, at: now().toISOString() }; });
      back(res, req.params.id);
    } catch (err) { next(err); }
  });

  router.post('/rise/drafts/:id/verify/id', async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      const status = statusOf(listing);
      if (!status.paid || status.removed || status.idOk || status.idAttemptsLeft === 0) return back(res, req.params.id);
      const base = baseUrlFor(req, ctx.config);
      let session;
      try {
        session = await payments.createIdCheck({
          listingId: listing.id, returnUrl: `${base}/rise/drafts/${encodeURIComponent(req.params.id)}/verify`,
        });
      } catch (err) {
        logFail('id-check', err);
        return back(res, req.params.id, 'down');
      }
      await store.updateTrustRecord(listing.id, r => {
        r.idAttempts = (Number.isInteger(r.idAttempts) ? r.idAttempts : 0) + 1;
        r.pendingIdCheck = session.id;
      });
      res.redirect(303, session.url);
    } catch (err) { next(err); }
  });

  // Signed results from Stripe. The body must stay raw for the signature check.
  router.post('/webhooks/stripe', express.raw({ type: () => true, limit: '256kb' }), async (req, res, next) => {
    try {
      let event;
      try {
        event = payments.parseWebhook(req.body, req.get('Stripe-Signature'));
      } catch {
        return res.status(400).json({ error: 'bad signature' });
      }
      const o = event.object;
      const listingId = typeof o.metadata?.listing_id === 'string' ? o.metadata.listing_id : '';
      const known = listingId !== '' && Boolean(store.findById(listingId)) && !store.isSeed(listingId);
      if (known && typeof o.id === 'string') {
        if (event.type === 'checkout.session.completed' && o.payment_status === 'paid') {
          await markPaid(listingId, o.metadata?.plan, o.id);
        } else if (event.type === 'identity.verification_session.verified') {
          await markIdPassed(listingId, o.id);
        }
      }
      res.status(200).json({ received: true });
    } catch (err) { next(err); }
  });

  return router;
}
