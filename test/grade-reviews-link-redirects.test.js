/**
 * The F1 review (V71 to V73): redirect-style addresses, links that are not written out as https://, and
 * stricter on-page Facebook links. Pure functions: nothing is fetched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reviewsLinkHost, reviewsLinkOnPage } from '../server/lib/listing-fields.js';

test('V71: redirect-style addresses are refused', () => {
  const refused = [
    'https://www.yelp.com/biz_redir?url=https%3A%2F%2Fevil.tld',
    'https://www.yelp.com/bizarre',
    'https://www.yelp.com/biz',
    'https://maps.google.com/url?q=https://evil.tld',
    'https://maps.google.com/url/?q=https://evil.tld',
    'https://www.google.com/url?q=https://evil.tld',
    'https://www.google.com/mapsfake',
    'https://www.google.com/maps-redirect?u=https://evil.tld',
    'https://www.facebook.com/l.php?u=https%3A%2F%2Fevil.tld',
    'https://m.facebook.com/l.php?u=https%3A%2F%2Fevil.tld',
    'https://www.facebook.com/flx/warn/?u=https%3A%2F%2Fevil.tld',
  ];
  for (const url of refused) {
    assert.equal(reviewsLinkHost(url), '', url);
    assert.equal(reviewsLinkOnPage(url), '', url);
  }
});

test('V71: the real review addresses next to those redirects still pass', () => {
  const accepted = [
    ['https://www.yelp.com/biz/capital-city-window-nashville', 'yelp'],
    ['https://www.google.com/maps', 'google'],
    ['https://www.google.com/maps?cid=1234567890', 'google'],
    ['https://www.google.com/maps/place/Capital+City+Window', 'google'],
    ['https://maps.google.com/?cid=1234567890', 'google'],
    ['https://maps.google.com/maps?cid=1234567890', 'google'],
    ['https://www.facebook.com/CapitalCityWindow', 'facebook'],
    ['https://www.facebook.com/CapitalCityWindow/reviews', 'facebook'],
  ];
  for (const [url, site] of accepted) assert.equal(reviewsLinkHost(url), site, url);
});

test('V72: the link must be written out with https://', () => {
  for (const url of [
    'https:google.com/maps',
    'https:\\\\google.com\\maps',
    'https:/google.com/maps',
    'https:www.yelp.com/biz/capital-city-window',
    ' https:google.com/maps ',
  ]) {
    assert.equal(reviewsLinkHost(url), '', url);
    assert.equal(reviewsLinkOnPage(url), '', url);
  }
  // Any letter case, and spaces around it, are fine.
  assert.equal(reviewsLinkHost('HTTPS://www.google.com/maps/place/A'), 'google');
  assert.equal(reviewsLinkHost('  Https://www.yelp.com/biz/a  '), 'yelp');
});

test('V73: an on-page Facebook link counts only for a path ending in /reviews or holding /reviews/', () => {
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/reviewsfake'), '');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow/reviewsfake'), '');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow/reviews-and-more'), '');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow/reviews'), 'facebook');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow/reviews/'), 'facebook');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/CapitalCityWindow/reviews/?ref=page'), 'facebook');
  assert.equal(reviewsLinkOnPage('https://www.facebook.com/reviews'), 'facebook');
  // An owner may still type any Facebook page.
  assert.equal(reviewsLinkHost('https://www.facebook.com/reviewsfake'), 'facebook');
});
