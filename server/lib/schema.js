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
export function buildSchema(listing, verification, options = {}) {
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

  // Richer output for AIs, only when the caller knows the site's base URL.
  const baseUrl = typeof options?.baseUrl === 'string' ? options.baseUrl.trim().replace(/\/+$/, '') : '';
  if (baseUrl !== '') {
    schema['@type'] = schemaTypeFor(listing.category);
    schema.url = `${baseUrl}/listings/${encodeURIComponent(listing.id)}`;
    schema.telephone = toE164(listing.phone);
    if (typeof listing.serviceArea === 'string' && listing.serviceArea.trim() !== '') {
      schema.areaServed = listing.serviceArea;
    }
    const hours = buildOpeningHours(listing.hours);
    if (hours.length > 0) schema.openingHoursSpecification = hours;
    if (address.streetAddress) {
      address.streetAddress = stripAddressTail(listing.address, listing.city, listing.state);
    }
  }
  return schema;
}

/** schema.org type by category slug; anything else is LocalBusiness. */
export const SCHEMA_TYPES = Object.freeze({
  plumbers: 'Plumber',
  electricians: 'Electrician',
  hvac: 'HVACBusiness',
  roofers: 'RoofingContractor',
  landscapers: 'HomeAndConstructionBusiness',
  cleaners: 'HomeAndConstructionBusiness',
  restaurants: 'Restaurant',
  'shops-and-restaurants': 'Restaurant',
  shops: 'Store',
  'hair-salons': 'HairSalon',
  'auto-repair': 'AutoRepair',
  lawyers: 'LegalService',
});

export function schemaTypeFor(category) {
  return typeof category === 'string' && Object.hasOwn(SCHEMA_TYPES, category)
    ? SCHEMA_TYPES[category]
    : 'LocalBusiness';
}

/** "(615) 555-0177" -> "+16155550177"; anything unrecognized is returned as given. */
export function toE164(phone) {
  const original = typeof phone === 'string' ? phone : '';
  const digits = original.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return original;
}

const DAY_NAMES = Object.freeze({
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
});

const TIME = '(\\d{1,2})(?::(\\d{2}))?\\s*([ap])\\.?\\s*m?\\.?';
const RANGE = new RegExp(`^\\s*${TIME}\\s*(?:-|\\u2013|\\u2014|to)\\s*${TIME}\\s*$`, 'i');

function to24(hour, minute, meridiem) {
  const h = Number(hour);
  const m = Number(minute ?? 0);
  if (h < 1 || h > 12 || m > 59) return null;
  const base = h % 12 + (meridiem.toLowerCase() === 'p' ? 12 : 0);
  return `${String(base).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parses "7:00 AM - 5:00 PM" to { opens: '07:00', closes: '17:00' }, or null. */
export function parseHoursRange(text) {
  if (typeof text !== 'string') return null;
  const m = RANGE.exec(text);
  if (!m) return null;
  const opens = to24(m[1], m[2], m[3]);
  const closes = to24(m[4], m[5], m[6]);
  return opens && closes ? { opens, closes } : null;
}

function buildOpeningHours(hours) {
  if (hours === null || typeof hours !== 'object') return [];
  const out = [];
  for (const [key, label] of Object.entries(DAY_NAMES)) {
    const range = parseHoursRange(hours[key]);
    if (range) out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: label, ...range });
  }
  return out;
}

/** Removes a trailing ", City, ST 12345" (or ", City, ST" / ", ST 12345") from a street address. */
export function stripAddressTail(address, city, state) {
  const original = typeof address === 'string' ? address : '';
  const esc = s => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const zip = '(?:\\s+\\d{5}(?:-\\d{4})?)?';
  const patterns = [];
  if (city) patterns.push(new RegExp(`[,\\s]+${esc(city).replace(/\s+/g, '\\s+')}\\s*,?\\s*${esc(state)}${zip}\\s*$`, 'i'));
  patterns.push(new RegExp(`\\s*,\\s*${esc(state)}${zip}\\s*$`, 'i'));
  for (const re of patterns) {
    const stripped = original.replace(re, '').replace(/[,\s]+$/, '').trim();
    if (stripped !== original.trim() && stripped !== '') return stripped;
  }
  return original;
}
