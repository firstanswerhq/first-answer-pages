/**
 * places.js: the one Google Places lookup per check (high-tech-look Requirement 3.3, checklist B1 to B4, C1 to C3,
 * A1 to A4). A text search for the business name and city, asking only for the fields the health map uses.
 *
 * The key is sent in a header and is never put in a result, a log line or an error. Every outcome is an object with a
 * `status` and, when it is not 'found', a one-line `reason` that is safe to show:
 *   'found'      one result clearly is the business; `place` holds the reduced result
 *   'not_found'  Google answered with no results at all
 *   'unsure'     results came back but none is clearly the business; nothing is picked
 *   'error'      the lookup failed or ran past the one overall time limit (request and body together)
 * It never throws. Before go-live, confirm the field mask with one real call (a refused mask makes every check gray). `fetch` is injectable so tests make no real call.
 */

import { LOOKUP_TIMEOUT_MS } from './health-constants.js';
import { pickCandidate, googleHoursByDay } from './health-compare.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = [
  'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber', 'places.websiteUri',
  'places.regularOpeningHours', 'places.businessStatus', 'places.primaryType', 'places.rating',
  // `places.reviews` rather than the nested `places.reviews.publishTime`: the nested mask may be refused with a 400, and
  // both are the same price. Only each review's publishTime is read (reducePlace); nothing else of a review is kept.
  'places.userRatingCount', 'places.reviews',
].join(',');

export const PLACES_ERROR_REASON = "We couldn't reach Google this time.";

/** One Places result as the health map reads it. */
export function reducePlace(p) {
  const reviews = Array.isArray(p?.reviews) ? p.reviews : [];
  const times = reviews.map(r => Date.parse(r?.publishTime)).filter(Number.isFinite);
  const periods = Array.isArray(p?.regularOpeningHours?.periods) ? p.regularOpeningHours.periods : [];
  return {
    name: typeof p?.displayName?.text === 'string' ? p.displayName.text : '',
    address: typeof p?.formattedAddress === 'string' ? p.formattedAddress : '',
    phone: typeof p?.nationalPhoneNumber === 'string' ? p.nationalPhoneNumber : '',
    website: typeof p?.websiteUri === 'string' ? p.websiteUri : '',
    hasHours: periods.length > 0
      || (Array.isArray(p?.regularOpeningHours?.weekdayDescriptions) && p.regularOpeningHours.weekdayDescriptions.length > 0),
    hoursByDay: googleHoursByDay(periods),
    businessStatus: typeof p?.businessStatus === 'string' ? p.businessStatus : '',
    primaryType: typeof p?.primaryType === 'string' ? p.primaryType : '',
    rating: Number.isFinite(p?.rating) ? p.rating : null,
    // Google leaves the count out when a place has no reviews.
    ratingCount: Number.isInteger(p?.userRatingCount) ? p.userRatingCount : 0,
    newestReviewAt: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/** Race a promise against a timer, so a call that never answers still ends. */
export function withTimeout(promise, ms, onTimeout) {
  let timer;
  const clock = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* ignore */ }
      reject(new Error('timeout'));
    }, ms);
  });
  return Promise.race([promise, clock]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ apiKey?: string, fetch?: Function, timeoutMs?: number }} [options]
 * @returns {{ name: 'places', lookup: (query: { name: string, city: string, state?: string, website?: string }) => Promise<object> } | null}
 *   null without a key
 */
export function createPlacesLookup({ apiKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return null;
  const key = apiKey.trim();
  return {
    name: 'places',
    async lookup({ name, city, state, website } = {}) {
      const controller = new AbortController();
      try {
        const body = JSON.stringify({ textQuery: [name, city, state].filter(Boolean).join(' '), languageCode: 'en' });
        // One timer for the whole lookup (the request and reading its body), so it never runs past timeoutMs.
        const work = async () => {
          const res = await fetchImpl(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
            body,
            signal: controller.signal,
          });
          if (!res || res.ok !== true) return null;
          return res.json();
        };
        const data = await withTimeout(work(), timeoutMs, () => controller.abort());
        if (data === null || data === undefined) return { status: 'error', reason: PLACES_ERROR_REASON };
        const places = (Array.isArray(data?.places) ? data.places : []).slice(0, 10).map(reducePlace);
        const picked = pickCandidate(places, { name, city, website });
        return picked.status === 'found' ? { status: 'found', place: picked.place } : picked;
      } catch {
        // Nothing about the failure (and never the key) is passed on.
        return { status: 'error', reason: PLACES_ERROR_REASON };
      }
    },
  };
}
