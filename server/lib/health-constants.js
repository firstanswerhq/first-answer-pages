/**
 * health-constants.js: every threshold the health map's signals use, in one place so the owner can change them
 * (high-tech-look Requirement 3.4 and the healthy-setup checklist). Nothing here changes the score.
 */

/** Google review count: green at this many or more, amber from 1, red at 0. */
export const REVIEW_COUNT_GREEN = 10;

/** Google star rating: green at this or higher. */
export const RATING_GREEN = 4.3;
/** Google star rating: amber at this or higher (and below RATING_GREEN); red below. */
export const RATING_AMBER = 3.8;

/** The newest review Google returned is "recent" when it is no older than this many days. */
export const NEWEST_REVIEW_DAYS = 90;

/** A sitemap's newest date counts as "recently updated" within this many days (12 months). */
export const UPDATED_WITHIN_DAYS = 365;

/** Service pages found for "A page for each service": green at this many or more. */
export const SERVICE_PAGES_GREEN = 2;

/** Each outside lookup (Google Places, Azure Maps) is cut off after this long, and the check carries on. */
export const LOOKUP_TIMEOUT_MS = 5 * 1000;

/** No fix sentence is longer than this many characters. */
export const FIX_MAX_CHARS = 160;

/** How many entries of a sitemap are read (a bigger one still counts as found). */
export const SITEMAP_MAX_ENTRIES = 5000;

/** Google's own wording for a business status, as the lookup returns it. */
export const GOOGLE_OPEN = 'OPERATIONAL';
export const GOOGLE_CLOSED = new Set(['CLOSED_PERMANENTLY', 'CLOSED_TEMPORARILY']);
