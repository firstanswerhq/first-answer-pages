/**
 * public-listing.js — strips private fields from a listing before any public
 * output (pages, JSON, JSON-LD, MCP, llms.txt, sitemap).
 */

import { reviewsLinkHost, normalizeWebsite } from './listing-fields.js';

/** Keys that exist on stored listings but must never be shown publicly. */
export const PRIVATE_KEYS = Object.freeze(['ownerEmail']);

/**
 * Shallow copy of `listing` without private fields. Non-objects pass through.
 * @param {object|undefined} listing
 * @returns {object|undefined}
 */
export function publicListing(listing) {
  if (listing === null || typeof listing !== 'object' || Array.isArray(listing)) return listing;
  const copy = { ...listing };
  for (const key of PRIVATE_KEYS) delete copy[key];
  // A reviews link is public only when it is a valid one (a hand-edited bad link never leaves the site).
  if (Object.hasOwn(copy, 'reviewsLink') && reviewsLinkHost(copy.reviewsLink) === '') delete copy.reviewsLink;
  // The same for the business's own website: checked again, and returned only in its clean form.
  if (Object.hasOwn(copy, 'website')) {
    const website = normalizeWebsite(copy.website);
    if (website === '') delete copy.website;
    else copy.website = website;
  }
  return copy;
}
