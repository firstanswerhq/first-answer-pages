/**
 * public-listing.js — strips private fields from a listing before any public
 * output (pages, JSON, JSON-LD, MCP, llms.txt, sitemap).
 */

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
  return copy;
}
