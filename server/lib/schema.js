/**
 * schema.js — Schema Builder
 *
 * Converts a Listing into a schema.org LocalBusiness JSON-LD object.
 */

const REQUIRED_FIELDS = ['name', 'phone', 'description', 'city', 'state', 'services'];

/**
 * @param {object} listing
 * @param {string} field
 * @returns {boolean} true when the field is present and non-empty
 */
function isPresent(listing, field) {
  const value = listing?.[field];
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Converts a Listing object to a schema.org LocalBusiness JSON-LD object.
 * Throws a descriptive Error if any required field is missing.
 *
 * @param {object} listing
 * @param {{ verifiedDate: string, hash: string } | null} [verification]
 *   when non-null, adds `identifier` (hash) and `dateModified` (verifiedDate)
 * @returns {object} JSON-LD LocalBusiness object
 */
export function buildSchema(listing, verification) {
  for (const field of REQUIRED_FIELDS) {
    if (!isPresent(listing, field)) {
      throw new Error(`Schema_Builder: missing required field: ${field}`);
    }
  }

  const address = {
    '@type': 'PostalAddress',
    addressLocality: listing.city,
    addressRegion: listing.state,
  };
  if (isPresent(listing, 'address')) {
    address.streetAddress = listing.address;
  }

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: listing.name,
    telephone: listing.phone,
    description: listing.description,
    address,
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      itemListElement: listing.services.map(service => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: service },
      })),
    },
  };
  if (verification && verification.hash && verification.verifiedDate) {
    schema.identifier = verification.hash;
    schema.dateModified = verification.verifiedDate;
  }
  return schema;
}
