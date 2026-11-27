/**
 * azure-maps.js: the one Azure Maps point-of-interest search per check, for "is the business on Bing and do the
 * details match" (checklist A6 and G2). Azure Maps is the data behind Bing Maps.
 *
 * Same rules as places.js: the key is never put in a result, a log line or an error; every outcome is an object with a
 * `status` ('found', 'not_found', 'unsure' or 'error') and, when not found, a safe one-line `reason`; it never throws;
 * `fetch` is injectable so tests make no real call. Azure Maps data is not Bing Places itself, so a miss here is never
 * shown red. The key is a query parameter (the only way Search v1.0 documents it), so the request address is secret:
 * it is never logged, stored, thrown or shown. Search v1 is "superseded by 2026-01-01" with no retirement date, and the
 * 2026-01-01 API has no POI search. Before go-live, confirm `search/poi/json?api-version=1.0` answers with one real call.
 */

import { LOOKUP_TIMEOUT_MS } from './health-constants.js';
import { pickCandidate } from './health-compare.js';
import { withTimeout } from './places.js';

const ENDPOINT = 'https://atlas.microsoft.com/search/poi/json';

export const BING_ERROR_REASON = "We couldn't reach Bing this time.";

/** One Azure Maps result as the health map reads it. */
export function reduceBingResult(r) {
  const url = typeof r?.poi?.url === 'string' ? r.poi.url.trim() : '';
  return {
    name: typeof r?.poi?.name === 'string' ? r.poi.name : '',
    address: typeof r?.address?.freeformAddress === 'string' ? r.address.freeformAddress : '',
    city: typeof r?.address?.municipality === 'string' ? r.address.municipality : '',
    phone: typeof r?.poi?.phone === 'string' ? r.poi.phone : '',
    // Azure Maps gives a host such as "www.example.com"; it is made into an address.
    website: url === '' ? '' : (/^https?:\/\//i.test(url) ? url : `https://${url}`),
  };
}

/**
 * @param {{ apiKey?: string, fetch?: Function, timeoutMs?: number }} [options]
 * @returns {{ name: 'bing', lookup: (query: { name: string, city: string, state?: string, website?: string }) => Promise<object> } | null}
 *   null without a key
 */
export function createBingLookup({ apiKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = LOOKUP_TIMEOUT_MS } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') return null;
  const key = apiKey.trim();
  return {
    name: 'bing',
    async lookup({ name, city, state, website } = {}) {
      const controller = new AbortController();
      try {
        // Microsoft documents `subscription-key` for Search POI v1.0 only as a query parameter (review T4), so the key
        // is in the address. That address is held only in this function: it is never logged, never put in a result or
        // an error, and never shown. Every failure below is replaced by one fixed sentence. The form is US-only.
        const query = new URLSearchParams({
          'api-version': '1.0', query: [name, city, state].filter(Boolean).join(' '), limit: '5', countrySet: 'US',
          'subscription-key': key,
        });
        // One timer for the whole lookup (the request and reading its body).
        const work = async () => {
          const res = await fetchImpl(`${ENDPOINT}?${query}`, { signal: controller.signal });
          if (!res || res.ok !== true) return null;
          return res.json();
        };
        const data = await withTimeout(work(), timeoutMs, () => controller.abort());
        if (data === null || data === undefined) return { status: 'error', reason: BING_ERROR_REASON };
        const places = (Array.isArray(data?.results) ? data.results : []).slice(0, 10).map(reduceBingResult);
        const picked = pickCandidate(places, { name, city, website });
        return picked.status === 'found' ? { status: 'found', place: picked.place } : picked;
      } catch {
        return { status: 'error', reason: BING_ERROR_REASON };
      }
    },
  };
}
