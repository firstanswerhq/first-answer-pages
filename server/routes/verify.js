/**
 * verify.js — the paid "Verified" stamp, reached from the owner's private link
 *
 *   GET  /verified                            public page: what the stamp means
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
import { DEFAULT_SITE_NAME } from '../lib/config.js';
import {
  trustStatus, planFor, paidThroughAfter, toE164, lastFour, formatFee, MAX_ID_ATTEMPTS,
} from '../lib/trust.js';

const NOTES = Object.freeze({
  sent: "Code sent. It can take a minute. No text? Tap 'Call me with the code'.",
  called: 'We are calling that number now. A recording will read your code.',
  wrong: 'That code did not match. Codes stop working after 10 minutes. Check it and try again, or ask for a new one.',
  slow: 'Too many tries. Please wait an hour and try again.',
  down: 'We could not reach the service just now. Please try again in a minute.',
  paydown: 'We could not reach the payment page just now. Nothing was charged. Please try again in a minute.',
  canceled: 'Payment canceled. Nothing was charged.',
});

function formatDay(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' }).format(at);
}

/** "Email us at x" with the address as plain, selectable text, or a link to the About page. */
function contactHtml(email) {
  return typeof email === 'string' && email.trim() !== ''
    ? `email us at ${escapeHtml(email.trim())}`
    : 'contact us through the <a href="/about">About page</a>';
}

/** What the stamp does for a business. Shared by the owner page and the public page. */
export const VERIFIED_BENEFITS = `<ul class="verify-benefits">
    <li><strong>Customers see proof.</strong> We confirmed the business phone is answered, and we checked a photo ID for the person who manages the listing.</li>
    <li><strong>AI assistants are told.</strong> The page we publish for AI tools marks the business as verified and says what was checked. We cannot promise an AI will name any business, but it gives the AI a reason to trust this listing.</li>
    <li><strong>It sets the real business apart.</strong> A fake listing that uses someone else's phone number cannot pass the phone check, so it can never carry the stamp.</li>
  </ul>`;

/** The owner's verification page. Exported for tests. */
export function verifyPage({ draftId, listing, status, price, fees, note, testMode, idProcessing, contactEmail }) {
  const base = `/rise/drafts/${encodeURIComponent(draftId)}/verify`;
  const done = '<span class="verify-done">Done</span>';
  const contact = contactHtml(contactEmail);
  const noteHtml = note && Object.hasOwn(NOTES, note)
    ? `\n  <p class="notice verify-note" role="status">${escapeHtml(NOTES[note])}</p>` : '';
  const testHtml = testMode
    ? '\n  <p class="notice verify-note" role="note">Test mode. This is a practice run: no real money moves, no real ID is checked, and no stamp is shown to the public.</p>' : '';
  const fee = formatFee(price.amountCents);
  const canCheckPhone = Boolean(toE164(listing.phone));

  let payStep;
  if (status.removed) {
    payStep = `<p>Verification for this listing has been turned off. Please ${contact}.</p>`;
  } else if (status.paid && !status.canRenew) {
    payStep = status.plan === 'yearly'
      ? `<p>${done} Fee paid. Paid through ${escapeHtml(formatDay(status.paidThrough))}. It will not renew by itself. Come back to this page to pay for another year.</p>`
      : `<p>${done} Fee paid. One time, nothing more to pay.</p>`;
  } else if (!canCheckPhone) {
    payStep = `<p>We can only check 10-digit US phone numbers, and the number on your listing is not one. Please ${contact} before you pay and we will help.</p>`;
  } else if (status.paid && status.canRenew) {
    payStep = `<p>${done} Fee paid. Paid through ${escapeHtml(formatDay(status.paidThrough))}. It will not renew by itself.</p>
    <p>Your year is almost up. Pay now and the new year starts when this one ends.</p>
    <form method="POST" action="${base}/pay"><button type="submit">Pay ${fee} for another year</button></form>`;
  } else {
    const refunded = status.refunded
      ? '<p>Your last payment was refunded or disputed, so the stamp is off your listing. Pay again to put it back.</p>\n    '
      : '';
    const lapsed = status.expired
      ? `<p>Your year ended on ${escapeHtml(formatDay(status.paidThrough))}. The stamp is off your listing. Pay again to put it back. You will not need to redo the phone or ID steps.</p>\n    `
      : '';
    const priceLine = price.plan === 'founder'
      ? `As a Founding Member you pay ${fee} once. The stamp stays for as long as your listing is up with the same business name and phone number. If either changes, you confirm again at no charge.`
      : `Verification is ${fee} for one year. It does not renew by itself and your card is not charged again. When the year ends, the stamp comes off until you pay for another year.`;
    payStep = `${refunded}${refunded ? '' : lapsed}<p>${escapeHtml(priceLine)}</p>
    <p>You pay on a secure Stripe page. We never see your card number.</p>
    <p class="hint">Wrong phone number on the listing? Please ${contact} to fix it before you pay.</p>
    <form method="POST" action="${base}/pay"><button type="submit">Pay ${fee}</button></form>`;
  }

  const four = lastFour(listing.phone);
  let phoneStep;
  if (status.phoneOk) {
    phoneStep = `<p>${done} The phone number on your listing is confirmed.</p>`;
  } else if (!status.paid || status.removed) {
    phoneStep = '<p class="hint">Opens after the fee is paid.</p>';
  } else if (!canCheckPhone) {
    phoneStep = `<p>We can only check 10-digit US phone numbers. Please ${contact} and we will help.</p>`;
  } else {
    phoneStep = `<p>We send a 6-digit code to the phone number on your listing, ending in ${escapeHtml(four)}. Type the code below. Landline or office phone? Tap 'Call me with the code' and a recording will read it to you.</p>
    <form method="POST" action="${base}/phone/send" class="verify-inline">
      <button type="submit" name="channel" value="sms">Text me the code</button>
      <button type="submit" name="channel" value="call" class="button-secondary">Call me with the code</button>
    </form>
    <p class="hint">You can ask for a code 3 times an hour.</p>
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
  } else if (idProcessing) {
    idStep = '<p>Stripe is checking your ID. This usually takes a minute. Refresh this page to see the result.</p>';
  } else if (status.idAttemptsLeft === 0) {
    idStep = `<p>The photo ID check did not pass after ${MAX_ID_ATTEMPTS} tries. Please ${contact} and we will help.</p>`;
  } else {
    const failed = status.idFailed
      ? `<p class="notice verify-note" role="status">That check did not pass. Make sure the ID is in focus and not expired, then try again. Tries left: ${status.idAttemptsLeft}.</p>\n    `
      : '';
    idStep = `${failed}<p>Take a photo of your driver's license or other government ID, then a selfie. Stripe, the payment company, runs the check and holds the photos. This site does not store them. We are told only whether it passed.</p>
    <form method="POST" action="${base}/id"><button type="submit">Start the photo ID check</button></form>
    <p class="hint">You get ${MAX_ID_ATTEMPTS} tries.</p>`;
  }

  let headline = '';
  if (status.verified) {
    headline = `<p class="notice success-box" role="status">${escapeHtml(listing.name)} is Verified. The stamp is on your listing now.</p>`;
  } else if (status.practiceDone) {
    headline = '<p class="notice verify-note" role="status">Practice run complete. All three steps work. No stamp is shown because this was test mode.</p>';
  }

  const prices = fees
    ? `<p class="hint">${formatFee(fees.founderCents)} once for Founding Members. ${formatFee(fees.yearlyCents)} a year for everyone else, with no automatic renewal. Your listing stays free either way.</p>`
    : '';

  const body = `<section class="verify">
  <h1>Get the Verified stamp</h1>
  <p class="tagline">Show customers there is a real person behind ${escapeHtml(listing.name)}.</p>${testHtml}${noteHtml}
  ${headline}
  <h2>What you get</h2>
  ${VERIFIED_BENEFITS}
  ${prices}
  <h2>Three steps</h2>
  <ol class="verify-steps">
    <li><h3>Pay the fee</h3>
    ${payStep}</li>
    <li><h3>Confirm your business phone</h3>
    ${phoneStep}</li>
    <li><h3>Check your photo ID</h3>
    ${idStep}</li>
  </ol>
  <p><a href="/listings/${encodeURIComponent(listing.id)}">See your listing</a></p>
  <p class="hint">Save this page now: bookmark it, or text the link to yourself. It is the only way back to get or renew the Verified stamp.</p>
</section>`;
  return layout({ title: `Get the Verified stamp: ${DEFAULT_SITE_NAME}`, body });
}

/** Public page linked from the stamp. */
export function verifiedInfoPage({ fees, canonical }) {
  const body = `<section class="message verify-info">
  <h1>What "Verified" means</h1>
  <p>A Verified stamp on a ${DEFAULT_SITE_NAME} listing means two things were checked:</p>
  <ol>
    <li><strong>The business phone.</strong> We sent a code to the phone number on the listing, and the person asking for the stamp answered it.</li>
    <li><strong>A photo ID.</strong> The person who manages the listing showed a government photo ID and a selfie, and Stripe confirmed they match.</li>
  </ol>
  <p>It is not a license check, a background check, or a promise about the quality of anyone's work. It tells you a real, reachable person stands behind the listing.</p>
  <h2>For business owners</h2>
  ${VERIFIED_BENEFITS}
  <p>Listing is free for everyone, always. The Verified stamp is optional: ${formatFee(fees.founderCents)} once for Founding Members, ${formatFee(fees.yearlyCents)} a year for everyone else, with no automatic renewal. You start from the private link you got when your listing was approved.</p>
  <p><a href="/rise">List your business free &rarr;</a></p>
</section>`;
  return layout({
    title: `What "Verified" means | ${DEFAULT_SITE_NAME}`, body, canonical,
    description: 'What the Verified stamp on a listing means: the business phone was confirmed and a photo ID was checked.',
  });
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
  const testMode = payments.testMode === true;
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
    if (!listing || store.isSeed(listing.id)) return undefined;
    // Practice results from a test key are thrown away once the site runs on a live key.
    if (!testMode && store.getTrustRecord(listing.id)?.test === true) {
      await store.updateTrustRecord(listing.id, r => {
        if (r.test !== true) return;
        for (const k of Object.keys(r)) if (k !== 'removedAt') delete r[k];
      });
    }
    return listing;
  }

  /** On a test key, real results are left alone: only an empty or practice record can be used. */
  function lockedByMode(listing) {
    if (!testMode) return false;
    const r = store.getTrustRecord(listing.id);
    return Boolean(r) && r.test !== true && Object.keys(r).some(k => k !== 'removedAt');
  }

  const statusOf = listing => trustStatus(store.getTrustRecord(listing.id), listing, now());

  /** Record a payment once. A payment already counted is ignored. */
  async function markPaid(listingId, plan, ref, paymentIntent) {
    await store.updateTrustRecord(listingId, r => {
      const seen = Array.isArray(r.payments) ? r.payments : [];
      if (seen.includes(ref)) return;
      const at = now();
      // After a refund the old end date no longer counts: the new term starts today.
      if (typeof r.refundedAt === 'string') r.paidThrough = null;
      r.prevPaidThrough = r.paidThrough ?? null;
      r.paidThrough = paidThroughAfter(plan, r, at.getTime());
      r.plan = plan === 'founder' ? 'founder' : 'yearly';
      r.paidAt = at.toISOString();
      r.paymentRef = ref;
      r.payments = [...seen, ref].slice(-20);
      if (typeof paymentIntent === 'string' && paymentIntent !== '') {
        r.paymentIntents = [...(Array.isArray(r.paymentIntents) ? r.paymentIntents : []), paymentIntent].slice(-20);
      }
      delete r.refundedAt;
      r.idAttempts = 0;
      delete r.idFailed;
      if (testMode) r.test = true; else delete r.test;
      if (r.pendingCheckout?.id === ref) delete r.pendingCheckout;
    });
  }

  async function markIdPassed(listingId, ref) {
    const listing = store.findById(listingId);
    if (!listing) return;
    await store.updateTrustRecord(listingId, r => {
      // Only the check that is waiting counts. A repeated or stale message from
      // Stripe must never put a stamp back after the business name has changed.
      if (r.pendingIdCheck !== ref) return;
      r.identity = { ref, at: now().toISOString(), name: listing.name };
      delete r.idFailed;
      delete r.pendingIdCheck;
    });
  }

  /** A refund or a dispute takes the paid status away. The checks already passed are kept. */
  async function markRefunded(paymentIntent) {
    if (typeof paymentIntent !== 'string' || paymentIntent === '') return;
    const ids = store.findTrustIds(r => Array.isArray(r?.paymentIntents) && r.paymentIntents.at(-1) === paymentIntent);
    for (const id of ids) {
      await store.updateTrustRecord(id, r => {
        if (typeof r.refundedAt === 'string' || r.paymentIntents?.at(-1) !== paymentIntent) return;
        const at = now();
        const earlier = Date.parse(r.prevPaidThrough ?? '');
        r.paymentIntents = r.paymentIntents.slice(0, -1);
        if (r.plan === 'yearly' && Number.isFinite(earlier) && earlier > at.getTime()) {
          // A refunded renewal: the year already paid for still runs to its end.
          r.paidThrough = r.prevPaidThrough;
          r.prevPaidThrough = null;
          return;
        }
        r.refundedAt = at.toISOString();
        if (r.plan === 'yearly') r.paidThrough = at.toISOString();
      });
    }
  }

  /** Count one failed photo ID try. Only the check that is waiting counts, and only once. */
  async function markIdFailed(listingId, ref) {
    await store.updateTrustRecord(listingId, r => {
      if (r.pendingIdCheck !== ref) return;
      r.idAttempts = (Number.isInteger(r.idAttempts) ? r.idAttempts : 0) + 1;
      r.idFailed = true;
      delete r.pendingIdCheck;
    });
  }

  /**
   * Ask Stripe about anything the owner started and we have not heard back on.
   * @returns {Promise<{ idProcessing: boolean }>}
   */
  async function catchUp(listing) {
    const record = store.getTrustRecord(listing.id);
    const out = { idProcessing: false };
    if (!record) return out;
    const status = trustStatus(record, listing, now());
    try {
      if (typeof record.pendingCheckout?.id === 'string' && (!status.paid || status.canRenew)) {
        const s = await payments.getCheckout(record.pendingCheckout.id);
        if (s.paid && s.listingId === listing.id) await markPaid(listing.id, s.plan, record.pendingCheckout.id, s.paymentIntent);
      }
      if (!status.idOk && typeof record.pendingIdCheck === 'string') {
        const s = await payments.getIdCheck(record.pendingIdCheck);
        if (s.listingId === listing.id) {
          if (s.status === 'verified') await markIdPassed(listing.id, record.pendingIdCheck);
          else if (s.failed) await markIdFailed(listing.id, record.pendingIdCheck);
          else if (s.status === 'processing') out.idProcessing = true;
        }
      }
    } catch (err) {
      logFail('catch-up', err);
    }
    return out;
  }

  const back = (res, draftId, note) => res.redirect(303, `/rise/drafts/${encodeURIComponent(draftId)}/verify${note ? `?note=${note}` : ''}`);
  const notFound = (req, res, next) => next(); // falls through to the site's 404 page

  router.get('/verified', (req, res) => {
    res.status(200).type('html').send(verifiedInfoPage({ fees, canonical: `${baseUrlFor(req, ctx.config)}/verified` }));
  });

  router.get('/rise/drafts/:id/verify', async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      const { idProcessing } = await catchUp(listing);
      const price = planFor(store.getFounder(listing.id), fees);
      res.status(200).type('html').send(verifyPage({
        draftId: req.params.id, listing, status: statusOf(listing), price, fees,
        note: typeof req.query.note === 'string' ? req.query.note : '',
        testMode, idProcessing, contactEmail: ctx.config.contactEmail,
      }));
    } catch (err) { next(err); }
  });

  router.post('/rise/drafts/:id/verify/pay', async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      // One at a time per listing, so a double click cannot open two payment pages.
      const target = await store.withLock(`verify:${listing.id}`, async () => {
        await catchUp(listing);
        const status = statusOf(listing);
        // Never take money for a listing whose phone we cannot check.
        if ((status.paid && !status.canRenew) || status.removed || !toE164(listing.phone) || lockedByMode(listing)) return { note: '' };
        const limited = ctx.rateLimiter.consume(`verify-pay:${listing.id}`, RULES['verify-pay']);
        if (!limited.allowed) return { note: 'slow' };
        const price = planFor(store.getFounder(listing.id), fees);
        const base = baseUrlFor(req, ctx.config);
        const page = `${base}/rise/drafts/${encodeURIComponent(req.params.id)}/verify`;
        try {
          // A payment page that is still open is used again, so there is never
          // more than one that could be paid.
          const pending = store.getTrustRecord(listing.id)?.pendingCheckout;
          if (typeof pending?.id === 'string') {
            const open = await payments.getCheckout(pending.id);
            if (open.paid && open.listingId === listing.id) {
              await markPaid(listing.id, open.plan, pending.id, open.paymentIntent);
              return { note: '' };
            }
            if (open.open && open.listingId === listing.id) {
              const same = pending.plan === price.plan && pending.amountCents === price.amountCents;
              if (same) return { url: open.url };
              // The price or plan changed: close the old page before opening a new one.
              if (!(await payments.expireCheckout(pending.id))) return { note: 'paydown' };
            }
          }
          const session = await payments.createCheckout({
            listingId: listing.id, plan: price.plan, amountCents: price.amountCents,
            description: price.plan === 'founder'
              ? `${DEFAULT_SITE_NAME} Verified stamp, Founding Member (one time)`
              : `${DEFAULT_SITE_NAME} Verified stamp (one year, does not renew by itself)`,
            successUrl: page, cancelUrl: `${page}?note=canceled`,
          });
          await store.updateTrustRecord(listing.id, r => {
            r.pendingCheckout = { id: session.id, plan: price.plan, amountCents: price.amountCents };
          });
          return { url: session.url };
        } catch (err) {
          logFail('checkout', err);
          return { note: 'paydown' };
        }
      });
      if (target.url) return res.redirect(303, target.url);
      back(res, req.params.id, target.note);
    } catch (err) { next(err); }
  });

  router.post('/rise/drafts/:id/verify/phone/send', form, async (req, res, next) => {
    try {
      const listing = await ownerListing(req.params.id);
      if (!listing) return notFound(req, res, next);
      const status = statusOf(listing);
      const to = toE164(listing.phone);
      if (!status.paid || status.removed || status.phoneOk || !to || lockedByMode(listing)) return back(res, req.params.id);
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
      if (!status.paid || status.removed || status.phoneOk || !to || lockedByMode(listing)) return back(res, req.params.id);
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
      // One at a time per listing, so the limit on tries holds under a burst of clicks.
      const target = await store.withLock(`verify:${listing.id}`, async () => {
        // Settle any check already under way before starting another.
        const { idProcessing } = await catchUp(listing);
        const status = statusOf(listing);
        if (!status.paid || status.removed || status.idOk || idProcessing || status.idAttemptsLeft === 0 || lockedByMode(listing)) return { note: '' };
        const limited = ctx.rateLimiter.consume(`verify-id:${listing.id}`, RULES['verify-id']);
        if (!limited.allowed) return { note: 'slow' };
        const base = baseUrlFor(req, ctx.config);
        try {
          // Only one photo ID check can be live. An unfinished one is canceled first;
          // if it can no longer be canceled it is already being checked, so wait for it.
          const waiting = store.getTrustRecord(listing.id)?.pendingIdCheck;
          if (typeof waiting === 'string' && !(await payments.cancelIdCheck(waiting))) return { note: '' };
          const session = await payments.createIdCheck({
            listingId: listing.id, returnUrl: `${base}/rise/drafts/${encodeURIComponent(req.params.id)}/verify`,
          });
          await store.updateTrustRecord(listing.id, r => { r.pendingIdCheck = session.id; });
          return { url: session.url };
        } catch (err) {
          logFail('id-check', err);
          return { note: 'down' };
        }
      });
      if (target.url) return res.redirect(303, target.url);
      back(res, req.params.id, target.note);
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
      // Money taken back: a full refund, or a customer disputing the charge with their bank.
      if (event.type === 'charge.refunded' && o.refunded === true) await markRefunded(o.payment_intent);
      if (event.type === 'charge.dispute.created') await markRefunded(o.payment_intent);
      const listingId = typeof o.metadata?.listing_id === 'string' ? o.metadata.listing_id : '';
      const known = listingId !== '' && Boolean(store.findById(listingId)) && !store.isSeed(listingId);
      if (known && typeof o.id === 'string') {
        if (event.type === 'checkout.session.completed' && o.payment_status === 'paid') {
          await markPaid(listingId, o.metadata?.plan, o.id, typeof o.payment_intent === 'string' ? o.payment_intent : undefined);
        } else if (event.type === 'identity.verification_session.verified') {
          await markIdPassed(listingId, o.id);
        } else if (event.type === 'identity.verification_session.requires_input' && o.last_error != null) {
          await markIdFailed(listingId, o.id);
        }
      }
      res.status(200).json({ received: true });
    } catch (err) { next(err); }
  });

  return router;
}
