/**
 * high-tech-look Requirements 3.3, 4.2 and 8: the one Google Places lookup and the one Azure Maps (Bing) search of a
 * check. The network is always a fake `fetch`; no real call is made. The key is never in a result.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPlacesLookup, reducePlace } from '../server/lib/places.js';
import { createBingLookup, reduceBingResult } from '../server/lib/azure-maps.js';

const KEY = 'AIzaSy-test-key-do-not-leak';
const AZURE_KEY = 'azure-test-key-do-not-leak';
const QUERY = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', website: 'https://zephyr.example/' };

/** A fake fetch that records every call and answers with `reply(url, init)`. */
function fakeFetch(reply) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    return reply(String(url), init);
  };
  fn.calls = calls;
  return fn;
}
const ok = body => ({ ok: true, status: 200, json: async () => body });

const googlePlace = (extra = {}) => ({
  displayName: { text: 'Zephyr Plumbing LLC' },
  formattedAddress: '12 Main St, Nashville, TN 37203, USA',
  nationalPhoneNumber: '(615) 555-0142',
  websiteUri: 'https://zephyr.example/',
  regularOpeningHours: { periods: [{ open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } }] },
  businessStatus: 'OPERATIONAL',
  primaryType: 'plumber',
  rating: 4.6,
  userRatingCount: 133,
  reviews: [{ publishTime: '2026-11-01T10:00:00Z' }, { publishTime: '2026-09-01T10:00:00Z' }],
  ...extra,
});

test('Places: without a key there is no lookup at all, and nothing is called', () => {
  assert.equal(createPlacesLookup({}), null);
  assert.equal(createPlacesLookup({ apiKey: '' }), null);
  assert.equal(createPlacesLookup({ apiKey: '   ' }), null);
  assert.equal(createPlacesLookup(), null);
});

test('Places: one request, with only the fields the health map uses, and the key only in a header', async () => {
  const f = fakeFetch(() => ok({ places: [googlePlace()] }));
  const result = await createPlacesLookup({ apiKey: KEY, fetch: f }).lookup(QUERY);
  assert.equal(f.calls.length, 1, 'never two lookups');
  const [call] = f.calls;
  assert.equal(call.url, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers['X-Goog-Api-Key'], KEY);
  assert.equal(call.url.includes(KEY), false, 'the key is not in the address');
  assert.deepEqual(JSON.parse(call.init.body), { textQuery: 'Zephyr Plumbing Nashville TN', languageCode: 'en' });
  const fields = call.init.headers['X-Goog-FieldMask'].split(',');
  for (const wanted of [
    'places.displayName', 'places.formattedAddress', 'places.nationalPhoneNumber', 'places.websiteUri',
    'places.regularOpeningHours', 'places.businessStatus', 'places.primaryType', 'places.rating',
    'places.userRatingCount', 'places.reviews.publishTime',
  ]) assert.ok(fields.includes(wanted), wanted);
  assert.equal(fields.length, 10, 'no other field is asked for');
  assert.equal(result.status, 'found');
  assert.equal(JSON.stringify(result).includes(KEY), false);
});

test('Places: a match is reduced to what the map reads', async () => {
  const result = await createPlacesLookup({ apiKey: KEY, fetch: fakeFetch(() => ok({ places: [googlePlace()] })) }).lookup(QUERY);
  assert.equal(result.status, 'found');
  assert.deepEqual(result.place, {
    name: 'Zephyr Plumbing LLC',
    address: '12 Main St, Nashville, TN 37203, USA',
    phone: '(615) 555-0142',
    website: 'https://zephyr.example/',
    hasHours: true,
    hoursByDay: { monday: { opens: '08:00', closes: '17:00' } },
    businessStatus: 'OPERATIONAL',
    primaryType: 'plumber',
    rating: 4.6,
    ratingCount: 133,
    newestReviewAt: '2026-11-01T10:00:00.000Z',
  });
});

test('Places: a place with no reviews and no hours reads as zero reviews and no hours', () => {
  const p = reducePlace({ displayName: { text: 'New Co' } });
  assert.equal(p.ratingCount, 0);
  assert.equal(p.rating, null);
  assert.equal(p.hasHours, false);
  assert.equal(p.newestReviewAt, null);
  assert.deepEqual(reducePlace(null).hoursByDay, {});
});

test('Places: no results is "not found"; results that are nothing like the business is "not found"', async () => {
  const none = await createPlacesLookup({ apiKey: KEY, fetch: fakeFetch(() => ok({})) }).lookup(QUERY);
  assert.equal(none.status, 'not_found');
  const other = await createPlacesLookup({
    apiKey: KEY,
    fetch: fakeFetch(() => ok({ places: [googlePlace({ displayName: { text: 'Ridgeline Roofing' } })] })),
  }).lookup(QUERY);
  assert.equal(other.status, 'not_found');
});

test('Places: two close results, or the right name in another city, are "unsure" and nothing is picked', async () => {
  const two = await createPlacesLookup({
    apiKey: KEY,
    fetch: fakeFetch(() => ok({ places: [
      googlePlace({ displayName: { text: 'Zephyr Plumbing' }, websiteUri: 'https://a.example', formattedAddress: '1 A St, Nashville, TN' }),
      googlePlace({ displayName: { text: 'Zephyr Plumbing' }, websiteUri: 'https://b.example', formattedAddress: '2 B St, Nashville, TN' }),
    ] })),
  }).lookup({ ...QUERY, website: undefined });
  assert.equal(two.status, 'unsure');
  assert.ok(two.reason.length > 0 && !('place' in two));
  const chain = await createPlacesLookup({
    apiKey: KEY,
    fetch: fakeFetch(() => ok({ places: [googlePlace({ formattedAddress: '9 Elm St, Memphis, TN 38103, USA' })] })),
  }).lookup(QUERY);
  assert.equal(chain.status, 'unsure');
});

test('Places: a chain with a store in the typed city picks that store', async () => {
  const result = await createPlacesLookup({
    apiKey: KEY,
    fetch: fakeFetch(() => ok({ places: [
      googlePlace({ formattedAddress: '9 Elm St, Memphis, TN 38103, USA', nationalPhoneNumber: '(901) 555-0100' }),
      googlePlace({ formattedAddress: '12 Main St, Nashville, TN 37203, USA' }),
    ] })),
  }).lookup(QUERY);
  assert.equal(result.status, 'found');
  assert.ok(result.place.address.includes('Nashville'));
});

test('Places: a typo in the name still finds it; a typo in the city is not guessed at', async () => {
  const fetchImpl = fakeFetch(() => ok({ places: [googlePlace()] }));
  const lookup = createPlacesLookup({ apiKey: KEY, fetch: fetchImpl });
  assert.equal((await lookup.lookup({ ...QUERY, name: 'Zephyr Plumbng' })).status, 'found');
  assert.equal((await lookup.lookup({ ...QUERY, city: 'Nashvile' })).status, 'unsure');
});

test('Places: a failed reply, a bad body, a thrown error and a timeout are all "error", with no key and no raw text', async () => {
  const cases = {
    'a 403': fakeFetch(() => ({ ok: false, status: 403, json: async () => ({ error: { message: `API key ${KEY} is not valid` } }) })),
    'a 500': fakeFetch(() => ({ ok: false, status: 500, json: async () => ({}) })),
    'a bad body': fakeFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } })),
    'a thrown error': fakeFetch(() => { throw new Error(`connect ECONNREFUSED while using ${KEY}`); }),
    'nothing at all': fakeFetch(() => undefined),
  };
  for (const [name, f] of Object.entries(cases)) {
    const result = await createPlacesLookup({ apiKey: KEY, fetch: f }).lookup(QUERY);
    assert.equal(result.status, 'error', name);
    assert.equal(result.reason, "We couldn't reach Google this time.", name);
    assert.equal(JSON.stringify(result).includes(KEY), false, `${name}: no key`);
    assert.equal(/ECONNREFUSED|Unexpected token|not valid/.test(JSON.stringify(result)), false, `${name}: no raw error text`);
  }
});

test('Places: a call that never answers is cut off after the time limit and the lookup still returns', async () => {
  let aborted = false;
  const hang = fakeFetch((url, init) => {
    init.signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(() => {});
  });
  const started = Date.now();
  const result = await createPlacesLookup({ apiKey: KEY, fetch: hang, timeoutMs: 30 }).lookup(QUERY);
  assert.equal(result.status, 'error');
  assert.ok(Date.now() - started < 2000);
  assert.equal(aborted, true, 'the request was told to stop');
});

// ---- Azure Maps (Bing) ---------------------------------------------------------------------------------------------

const azureResult = (extra = {}) => ({
  poi: { name: 'Zephyr Plumbing', phone: '+1 615-555-0142', url: 'www.zephyr.example' },
  address: { freeformAddress: '12 Main Street, Nashville, TN 37203', municipality: 'Nashville', countrySubdivision: 'TN' },
  ...extra,
});

test('Bing: without a key there is no lookup, and nothing is called', () => {
  assert.equal(createBingLookup({}), null);
  assert.equal(createBingLookup({ apiKey: ' ' }), null);
});

test('Bing: one search, and a match is reduced to name, phone, address and website', async () => {
  const f = fakeFetch(() => ok({ results: [azureResult()] }));
  const result = await createBingLookup({ apiKey: AZURE_KEY, fetch: f }).lookup(QUERY);
  assert.equal(f.calls.length, 1);
  const url = new URL(f.calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://atlas.microsoft.com/search/poi/json');
  assert.equal(url.searchParams.get('query'), 'Zephyr Plumbing Nashville TN');
  assert.equal(result.status, 'found');
  assert.deepEqual(result.place, {
    name: 'Zephyr Plumbing', address: '12 Main Street, Nashville, TN 37203', city: 'Nashville',
    phone: '+1 615-555-0142', website: 'https://www.zephyr.example',
  });
  assert.equal(JSON.stringify(result).includes(AZURE_KEY), false);
  assert.equal(reduceBingResult({}).website, '');
});

test('Bing: no results, a different business, an error and a timeout never throw and never show the key', async () => {
  assert.equal((await createBingLookup({ apiKey: AZURE_KEY, fetch: fakeFetch(() => ok({ results: [] })) }).lookup(QUERY)).status, 'not_found');
  assert.equal((await createBingLookup({
    apiKey: AZURE_KEY,
    fetch: fakeFetch(() => ok({ results: [azureResult({ poi: { name: 'Ridgeline Roofing' } })] })),
  }).lookup(QUERY)).status, 'not_found');
  for (const f of [
    fakeFetch(() => ({ ok: false, status: 401, json: async () => ({}) })),
    fakeFetch(() => { throw new Error(`fetch failed for subscription-key=${AZURE_KEY}`); }),
  ]) {
    const result = await createBingLookup({ apiKey: AZURE_KEY, fetch: f }).lookup(QUERY);
    assert.equal(result.status, 'error');
    assert.equal(result.reason, "We couldn't reach Bing this time.");
    assert.equal(JSON.stringify(result).includes(AZURE_KEY), false);
  }
  const hang = fakeFetch(() => new Promise(() => {}));
  const slow = await createBingLookup({ apiKey: AZURE_KEY, fetch: hang, timeoutMs: 30 }).lookup(QUERY);
  assert.equal(slow.status, 'error');
});
