/**
 * verifier.js — tamper-check hash for owner-confirmed listings
 *
 * A matching hash means the listing is unchanged since the owner confirmed it.
 * It is not proof of ownership or identity. Visible wording is
 * "Owner-confirmed"; identifiers keep the Verified/verification names.
 * The hash is computed on every call; nothing is cached.
 */

import { createHash } from 'node:crypto';
import { canonicalize } from './canonical.js';

/**
 * SHA-256 (lowercase hex) of canonicalize({ listing, verifiedDate }),
 * with `verifiedDate` and `verificationHash` stripped from the listing.
 * @param {object} listing
 * @param {string} verifiedDate
 * @returns {string}
 */
export function hashListing(listing, verifiedDate) {
  // eslint-disable-next-line no-unused-vars
  const { verifiedDate: _d, verificationHash: _h, ...rest } = listing;
  const input = canonicalize({ listing: rest, verifiedDate });
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * @param {{ getVerifiedDate(id: string): string|undefined|null }} store
 * @param {object} listing
 * @returns {{ verifiedDate: string, hash: string }|null} null when unverified
 */
export function verificationFor(store, listing) {
  const verifiedDate = store.getVerifiedDate(listing.id);
  if (!verifiedDate) return null;
  return { verifiedDate, hash: hashListing(listing, verifiedDate) };
}

/**
 * Compares a supplied hash with the current one.
 * @param {string} current
 * @param {unknown} supplied
 * @returns {boolean|null} null when supplied is absent, false for non-strings
 */
export function checkHash(current, supplied) {
  if (supplied === undefined || supplied === null) return null;
  if (typeof supplied !== 'string') return false;
  return supplied.trim().toLowerCase() === String(current).toLowerCase();
}
