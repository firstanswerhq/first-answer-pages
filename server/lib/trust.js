/**
 * trust.js — the paid "Verified" stamp (identity verification)
 *
 * A listing is Verified when its owner has (1) paid the fee, (2) answered a code
 * sent to the phone number on the listing, and (3) passed a photo ID and selfie
 * check. This is separate from the "Owner-confirmed" tamper-check stamp.
 *
 * Founding Members pay once and stay verified for life. Everyone else pays per
 * year. Only results are stored: never an ID image, an ID number or a selfie.
 *
 * Record shape (trust.json, keyed by listing id):
 *   { plan: 'founder'|'yearly', paidAt, paidThrough|null, paymentRef,
 *     pendingCheckout, phone: { number, at }, identity: { ref, at, name },
 *     paymentIntents, pendingIdCheck, idAttempts, idFailed, removedAt, refundedAt, test }
 * `refundedAt` is set when the last payment is refunded or disputed; a new payment clears it.
 * `test: true` marks a practice run made with a Stripe test key.
 */

export const DEFAULT_FOUNDER_FEE_CENTS = 1900;
export const DEFAULT_YEARLY_FEE_CENTS = 4900;
/** Photo ID attempts allowed per payment; each one costs the site money. */
export const MAX_ID_ATTEMPTS = 3;
/** A yearly plan can be renewed this long before it ends. */
export const RENEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Whole cents from 100 to 100000, else the fallback. */
export function parseFeeCents(value, fallback) {
  if (typeof value !== 'string' || !/^\d{3,6}$/.test(value.trim())) return fallback;
  const n = Number(value.trim());
  return n >= 100 && n <= 100000 ? n : fallback;
}

/** "$19" or "$19.50". */
export function formatFee(cents) {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;
}

/**
 * US phone number as +1XXXXXXXXXX, or null when it is not a 10-digit US number.
 * @param {unknown} phone
 */
export function toE164(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return ten.length === 10 && /^[2-9]/.test(ten) ? `+1${ten}` : null;
}

/** Last four digits for display: "ending in 0101". */
export function lastFour(phone) {
  return String(phone ?? '').replace(/\D/g, '').slice(-4);
}

/** Which price a listing pays: founders once for life, everyone else per year. */
export function planFor(founder, fees) {
  return founder
    ? { plan: 'founder', amountCents: fees.founderCents }
    : { plan: 'yearly', amountCents: fees.yearlyCents };
}

/** paidThrough for a payment made at `nowMs`; a renewal extends from the current end date. */
export function paidThroughAfter(plan, record, nowMs) {
  if (plan === 'founder') return null;
  const current = Date.parse(record?.paidThrough ?? '');
  const from = Number.isFinite(current) && current > nowMs ? current : nowMs;
  const end = new Date(from);
  end.setUTCFullYear(end.getUTCFullYear() + 1); // a calendar year, so the date reads the same next year
  return end.toISOString();
}

/**
 * Where a listing stands.
 * @returns {{ paid: boolean, phoneOk: boolean, idOk: boolean, verified: boolean,
 *   verifiedAt?: string, paidThrough?: string|null, plan?: string, removed: boolean, idAttemptsLeft: number }}
 */
export function trustStatus(record, listing, now) {
  const r = record && typeof record === 'object' ? record : {};
  const nowMs = new Date(now).getTime();
  const through = Date.parse(r.paidThrough ?? '');
  const paid = typeof r.paidAt === 'string' && typeof r.refundedAt !== 'string'
    && (r.plan === 'founder' || (Number.isFinite(through) && nowMs < through));
  const number = toE164(listing?.phone);
  const phoneOk = Boolean(number) && r.phone?.number === number && typeof r.phone?.at === 'string';
  const idOk = typeof r.identity?.at === 'string' && r.identity?.name === listing?.name;
  const removed = typeof r.removedAt === 'string';
  // A practice run with a test key never shows a stamp to the public.
  const practice = r.test === true;
  const verified = paid && phoneOk && idOk && !removed && !practice;
  const yearly = r.plan === 'yearly' && Number.isFinite(through);
  const out = {
    paid, phoneOk, idOk, verified, removed, practice,
    practiceDone: practice && paid && phoneOk && idOk && !removed,
    expired: yearly && typeof r.paidAt === 'string' && nowMs >= through && typeof r.refundedAt !== 'string',
    canRenew: yearly && paid && through - nowMs <= RENEW_WINDOW_MS,
    idFailed: r.idFailed === true,
    refunded: typeof r.refundedAt === 'string',
    plan: r.plan, paidThrough: r.paidThrough ?? null,
    idAttemptsLeft: Math.max(MAX_ID_ATTEMPTS - (Number.isInteger(r.idAttempts) ? r.idAttempts : 0), 0),
  };
  if (verified) out.verifiedAt = r.phone.at > r.identity.at ? r.phone.at : r.identity.at;
  return out;
}
