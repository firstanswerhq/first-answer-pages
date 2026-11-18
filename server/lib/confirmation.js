/**
 * confirmation.js — which listing details the business confirmed, when, and
 * whether that confirmation still counts as current.
 *
 * A confirmation older than CONFIRM_FRESH_DAYS is still shown, but only as
 * "last confirmed on", never as current. Nothing here changes a stored date:
 * the date moves only when the owner confirms again.
 */

export const CONFIRM_FRESH_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Listing details an owner confirms, in the order they are named. */
const CONFIRMABLE = Object.freeze([
  ['phone', 'phone'],
  ['address', 'address'],
  ['hours', 'hours'],
]);
const KNOWN = new Set(CONFIRMABLE.map(([key]) => key));

const hasHours = hours => hours !== null && typeof hours === 'object'
  && Object.values(hours).some(v => typeof v === 'string' && v.trim() !== '');

/**
 * The details on this listing that an owner confirms: phone, plus address and
 * hours when the listing has them.
 * @param {object} listing
 * @returns {string[]}
 */
export function confirmedFieldsFor(listing) {
  const out = [];
  if (typeof listing?.phone === 'string' && listing.phone.trim() !== '') out.push('phone');
  if (typeof listing?.address === 'string' && listing.address.trim() !== '') out.push('address');
  if (hasHours(listing?.hours)) out.push('hours');
  return out;
}

/** Only known field names, in the usual order, no repeats. */
export function cleanFields(fields) {
  if (!Array.isArray(fields)) return null;
  const set = new Set(fields.filter(f => KNOWN.has(f)));
  const out = CONFIRMABLE.map(([key]) => key).filter(key => set.has(key));
  return out.length > 0 ? out : null;
}

/** ['phone', 'address', 'hours'] -> "Phone, address and hours". */
export function fieldsText(fields) {
  const clean = cleanFields(fields);
  if (!clean) return '';
  const words = clean.map(key => CONFIRMABLE.find(([k]) => k === key)[1]);
  const joined = words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** The time of the confirmation in ms, from confirmedAt, verifiedAt or the date-only verifiedDate. */
export function confirmedMs(v) {
  for (const value of [v?.confirmedAt, v?.verifiedAt]) {
    const t = Date.parse(value ?? '');
    if (Number.isFinite(t)) return t;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v?.verifiedDate ?? ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}

/**
 * How to show a confirmation.
 * @param {{ verifiedDate?: string, verifiedAt?: string, confirmedAt?: string, confirmedFields?: string[] }} v
 * @param {number} [now] the app clock's time; without it the confirmation counts as current
 * @returns {{ current: boolean, stampDate: { verifiedDate?: string, verifiedAt?: string }, fields: string }}
 *   stampDate is ready for formatStampDate; fields like "Phone, address and hours" ('' for older listings)
 */
export function confirmationView(v, now) {
  const at = confirmedMs(v);
  const nowMs = now === undefined || now === null ? NaN : Number(now);
  const current = !Number.isFinite(nowMs) || !Number.isFinite(at) || nowMs - at <= CONFIRM_FRESH_DAYS * DAY_MS;
  const stampDate = { verifiedDate: v?.verifiedDate, verifiedAt: v?.confirmedAt ?? v?.verifiedAt };
  return { current, stampDate, fields: fieldsText(v?.confirmedFields) };
}
