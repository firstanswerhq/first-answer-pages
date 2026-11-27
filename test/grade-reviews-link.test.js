/**
 * The review-link validators and the optional `reviewsLink` listing field (Feature B, task F1).
 * Pure functions: no network, nothing fetched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';

import {
  reviewsLinkHost, reviewsLinkOnPage, normalizeFields, validateFields, MAX_REVIEWS_LINK,
} from '../server/lib/listing-fields.js';

const categories = JSON.parse(readFileSync(new URL('../data/categories.json', import.meta.url), 'utf8'));

const GOOD_LISTING = {
  name: 'Capital City Window', category: 'cleaners', phone: '615-555-0100', services: ['Window cleaning'],
  serviceArea: 'Nashville', description: 'We clean windows.', city: 'Nashville', state: 'TN',
};

// ---- reviewsLinkHost: links an owner types -----------------------------------------------------

test('F1: reviewsLinkHost accepts each review site', () => {
  const cases = [
    ['https://www.google.com/maps/place/Capital+City+Window/@36.16,-86.78,15z', 'google'],
    ['https://google.com/maps?cid=1234567890', 'google'],
    ['https://maps.google.com/?cid=1234567890', 'google'],
    ['https://maps.google.com/maps?cid=1234567890&hl=en', 'google'],
    ['https://www.google.com/search?q=capital+city+window#lrd=0x8864:0x1234,1,,,', 'google'],
    ['https://www.google.com/search?q=capital+city+window&ludocid=1234567890', 'google'],
    ['https://g.co/kgs/AbC123', 'google'],
    ['https://g.page/capital-city-window/review', 'google'],
    ['https://maps.app.goo.gl/AbCdEf123', 'google'],
    ['https://search.google.com/local/reviews?placeid=ChIJ123', 'google'],
    ['https://www.yelp.com/biz/capital-city-window-nashville', 'yelp'],
    ['https://m.yelp.com/biz/capital-city-window-nashville', 'yelp'],
    ['https://www.facebook.com/CapitalCityWindow/reviews', 'facebook'],
    ['https://www.facebook.com/CapitalCityWindow', 'facebook'],
    ['https://m.facebook.com/CapitalCityWindow', 'facebook'],
    ['https://nextdoor.com/pages/capital-city-window-nashville-tn/', 'nextdoor'],
    ['https://nextdoor.com/neighborhood/east-nashville/', 'nextdoor'],
    ['  https://www.yelp.com/biz/capital-city-window-nashville  ', 'yelp'],
    ['HTTPS://WWW.YELP.COM/biz/capital-city-window', 'yelp'],
  ];
  for (const [url, site] of cases) assert.equal(reviewsLinkHost(url), site, url);
});

test('F1: reviewsLinkHost refuses anything else', () => {
  const bad = [
    'http://www.yelp.com/biz/capital-city-window', // not https
    'https://www.example.com/reviews', // another site
    'https://www.angi.com/companylist/us/tn/nashville/capital-city-window.htm',
    'javascript:alert(1)',
    'https://user:pass@www.yelp.com/biz/capital-city-window', // credentials
    'https://user@www.yelp.com/biz/capital-city-window',
    'https://www.yelp.com:8443/biz/capital-city-window', // a port
    'https://www.google.com/', // Google, but not the maps
    'https://www.google.com/about',
    'https://www.google.com/search?q=plumbers',
    'https://www.google.com/search?q=plumbers#top',
    'https://g.co/other/AbC123',
    'https://search.google.com/test/rich-results',
    'https://www.yelp.com/search?find_desc=plumbers', // Yelp, but not /biz
    'https://www.yelp.com/',
    'https://fakeyelp.com/biz/x',
    'https://yelp.com.evil.example/biz/x',
    'https://www.facebook.com.evil.example/x',
    `https://www.yelp.com/biz/${'a'.repeat(MAX_REVIEWS_LINK)}`, // too long
    'reviews', // a bare word
    'yelp.com/biz/capital-city-window', // no scheme
    'https://www.yelp.com/biz/capital city', // a space inside
    'https://www.yelp.com/biz/x\nhttps://evil.example',
    '',
    '   ',
  ];
  for (const url of bad) assert.equal(reviewsLinkHost(url), '', url);
  for (const notText of [undefined, null, 42, {}, ['https://www.yelp.com/biz/x'], true]) {
    assert.equal(reviewsLinkHost(notText), '', String(notText));
  }
});

test('F1: a real-length Google search link of about 600 characters with #lrd= passes, and one over 1,000 fails', () => {
  const query = `q=capital+city+window+cleaning+nashville+tn&rlz=1C1GCEA_enUS1000US1000&oq=capital+city+window&gs_lcrp=${'EgZjaHJvbWUqBggAEEUYOzIGCAAQRRg7'.repeat(13)}&sourceid=chrome&ie=UTF-8`;
  const long = `https://www.google.com/search?${query}#lrd=0x8864665b8b5d8d6f:0x9d0c1f2b3a4e5f60,1,,,,`;
  assert.ok(long.length > 550 && long.length < 700, `${long.length} characters`);
  assert.equal(reviewsLinkHost(long), 'google');

  const tooLong = `https://www.google.com/search?${query}${'&x=1'.repeat(120)}#lrd=0x8864:0x1,1`;
  assert.ok(tooLong.length > MAX_REVIEWS_LINK);
  assert.equal(reviewsLinkHost(tooLong), '');
  assert.equal(MAX_REVIEWS_LINK, 1000);
});

test('F1: reviewsLinkHost never throws on any input', () => {
  fc.assert(fc.property(fc.oneof(fc.string(), fc.fullUnicodeString(), fc.anything()), value => {
    const out = reviewsLinkHost(value);
    assert.ok(['', 'google', 'yelp', 'facebook', 'nextdoor'].includes(out));
    assert.ok(['', 'google', 'yelp', 'facebook', 'nextdoor'].includes(reviewsLinkOnPage(value)));
  }));
});

// ---- reviewsLinkOnPage: links read from a home page -------------------------------------------------

test('F1: reviewsLinkOnPage is stricter for Facebook, Nextdoor and the Google review form', () => {
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow'), '');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow/reviews'), 'facebook');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow/reviews/?ref=page'), 'facebook');
  assert.equal(reviewsLinkOnPage('https://nextdoor.com/neighborhood/east-nashville/'), '');
  assert.equal(reviewsLinkOnPage('https://nextdoor.com/pages/capital-city-window-nashville-tn/'), 'nextdoor');
  assert.equal(reviewsLinkOnPage('https://search.google.com/local/writereview?placeid=ChIJ123'), '');
  assert.equal(reviewsLinkOnPage('https://search.google.com/local/reviews?placeid=ChIJ123'), 'google');
  assert.equal(reviewsLinkOnPage('https://www.google.com/maps/place/Capital+City+Window'), 'google');
  assert.equal(reviewsLinkOnPage('https://www.yelp.com/biz/capital-city-window-nashville'), 'yelp');
  // Everything reviewsLinkHost refuses, it refuses too.
  assert.equal(reviewsLinkOnPage('http://www.facebook.com/CapitalCityWindow/reviews'), '');
  assert.equal(reviewsLinkOnPage('https://www.google.com/search?q=plumbers'), '');
});

// ---- the listing field ------------------------------------------------------------------------------

test('F1: validateFields keeps a valid reviews link and leaves an invalid one out', () => {
  const good = 'https://www.yelp.com/biz/capital-city-window-nashville';
  const kept = validateFields({ ...GOOD_LISTING, reviewsLink: `  ${good}  ` }, categories);
  assert.equal(kept.fields.reviewsLink, good);
  assert.deepEqual(kept.missingFields, []);

  // The query string and the # part are kept.
  const google = 'https://www.google.com/search?q=capital+city+window#lrd=0x8864:0x1234,1,,,';
  assert.equal(validateFields({ ...GOOD_LISTING, reviewsLink: google }, categories).fields.reviewsLink, google);

  for (const bad of ['http://www.yelp.com/biz/x', 'https://www.example.com/reviews', 'javascript:alert(1)', 'reviews', 42, null]) {
    const out = validateFields({ ...GOOD_LISTING, reviewsLink: bad }, categories);
    assert.equal(Object.hasOwn(out.fields, 'reviewsLink'), false, String(bad));
    assert.deepEqual(out.missingFields, [], 'it is never a missing field');
  }
});

test('F1: the result has no reviewsLink key when the input has none or an invalid one', () => {
  const empty = normalizeFields({}, categories);
  assert.equal(Object.hasOwn(empty, 'reviewsLink'), false);
  for (const key of ['name', 'category', 'phone', 'hours', 'services', 'serviceArea', 'description', 'city', 'state', 'address', 'ownerEmail']) {
    assert.ok(Object.hasOwn(empty, key), `the usual key ${key} is still there`);
  }
  assert.equal(Object.hasOwn(normalizeFields({ reviewsLink: '' }, categories), 'reviewsLink'), false);
  assert.equal(Object.hasOwn(normalizeFields({ reviewsLink: 'https://www.google.com/search?q=plumbers' }, categories), 'reviewsLink'), false);
  // A missing listing field is still listed; a missing reviews link never is.
  const { missingFields } = validateFields({}, categories);
  assert.equal(missingFields.includes('reviewsLink'), false);
});

test('F1: normalizing again keeps the same reviews link', () => {
  const links = [
    'https://maps.google.com/?cid=1234567890',
    'https://g.co/kgs/AbC123',
    '  https://www.facebook.com/CapitalCityWindow  ',
  ];
  for (const link of links) {
    const once = validateFields({ ...GOOD_LISTING, reviewsLink: link }, categories);
    const twice = validateFields(once.fields, categories);
    assert.deepEqual(twice.fields, once.fields);
    assert.equal(once.fields.reviewsLink, link.trim());
  }
});

test('F1: a __proto__ reviews link is ignored', () => {
  const raw = JSON.parse('{"__proto__": {"reviewsLink": "https://www.yelp.com/biz/x"}, "name": "Joe"}');
  const out = normalizeFields(raw, categories);
  assert.equal(Object.hasOwn(out, 'reviewsLink'), false);
  assert.equal(({}).reviewsLink, undefined);
});
