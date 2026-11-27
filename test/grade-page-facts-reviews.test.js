/**
 * Page reading for service areas, reviews and review links (Features A and B, task F2).
 * Pure functions: no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  readPageFacts, serviceAreaPattern, REVIEW_HEADING_PATTERN, RATING_PATTERN, QUOTED_REVIEW_PATTERN, hasReviewSignal,
} from '../server/lib/page-facts.js';
import { normalizeForMatch } from '../server/lib/seance.js';

const MB = 1024 * 1024;
const page = body => `<!doctype html><html><head><title>Capital City Window</title></head><body>${body}</body></html>`;
const textOf = html => normalizeForMatch(readPageFacts(html).text);
const servesArea = (body, city) => serviceAreaPattern(city).test(textOf(page(body)));
const reviews = body => hasReviewSignal(readPageFacts(page(body)));

// ---- the service area --------------------------------------------------------------------------

test('F2: each service-area phrase matches', () => {
  const cases = [
    ['<p>Our service area covers all of Davidson County.</p>', 'Nashville'],
    ['<h2>Service Areas</h2><p>Nashville, Franklin, Brentwood</p>', 'Nashville'],
    ['<p>Areas we serve: Nashville, Franklin and Brentwood.</p>', 'Nashville'],
    ['<p>Serving Nashville and nearby areas.</p>', 'Nashville'],
    ['<p>We serve Nashville, Franklin and Brentwood.</p>', 'Nashville'],
    ['<p>We proudly serve the greater Nashville area.</p>', 'Nashville'],
    ['<p>Proudly serving homeowners across Williamson County.</p>', 'Nashville'],
    ['<p>Serving the surrounding communities since 1998.</p>', 'Nashville'],
    ['<p>We serve families in nearby towns.</p>', 'Nashville'],
    ['<p>Nashville and the surrounding areas.</p>', 'Nashville'],
    ['<p>Nashville and nearby communities</p>', 'Nashville'],
    ['<p>Tallahassee and neighboring counties</p>', 'Tallahassee'],
    ['<p>Serving St. Louis and nearby areas</p>', 'St. Louis'],
    ['<p>We serve all of St. Louis.</p>', 'St. Louis'],
    ['<p>SERVING NASHVILLE</p>', 'nashville'],
  ];
  for (const [body, city] of cases) assert.equal(servesArea(body, city), true, body);
});

test('F2: food, products and a bare street address are not a service area', () => {
  const cases = [
    '<p>Serving biscuits every morning.</p>',
    '<p>We serve breakfast all day.</p>',
    '<p>We serve coffee, tea and pie.</p>',
    '<p>12 Main Street, Nashville, TN 37201</p>',
    '<p>Call us at (615) 555-0100.</p>',
    '<p>Nashville\'s favorite window cleaner.</p>',
  ];
  for (const body of cases) assert.equal(servesArea(body, 'Nashville'), false, body);
  // The window is 80 characters: an area word far after "serving" does not count.
  const far = `<p>Serving ${'fresh hot biscuits and gravy '.repeat(4)} in the area</p>`;
  assert.equal(servesArea(far, 'Nashville'), false);
});

test('F2: odd cities never throw and never pass a page with no service-area words', () => {
  const plain = page('<p>We clean windows. Call (615) 555-0100. Open Mon-Fri 8am-5pm. 12 Main Street.</p><p>A++ Nash|ville St. Louis</p>');
  for (const city of ['A++', 'Nash|ville', 'St. Louis', '', '   ', '...', '(', '[', '\\', '*', '$^', 'a{2}', undefined, null, 42]) {
    let re;
    assert.doesNotThrow(() => { re = serviceAreaPattern(city); }, String(city));
    assert.ok(re instanceof RegExp);
    assert.equal(re.test(textOf(plain)), false, String(city));
  }
  assert.equal(serviceAreaPattern('St. Louis').test(textOf(page('<p>Serving St. Louis and nearby areas</p>'))), true);
  assert.equal(serviceAreaPattern('A++').test(normalizeForMatch('Serving A++ and nearby areas')), true);
  assert.equal(serviceAreaPattern('Nash|ville').test(normalizeForMatch('we serve nash|ville')), true);
  // An empty city has no city alternative: the area words still work, the city alone never does.
  assert.equal(serviceAreaPattern('').test('serving nearby areas'), true);
  assert.equal(serviceAreaPattern('').test('serving biscuits'), false);
  assert.equal(serviceAreaPattern('').test(''), false);
});

test('F2: serviceAreaPattern never throws and never matches text with no service-area words', () => {
  fc.assert(fc.property(fc.fullUnicodeString({ maxLength: 30 }), fc.string({ maxLength: 200 }), (city, text) => {
    const clean = normalizeForMatch(`${text} ${city}`);
    fc.pre(!/serv|area|nearby|surrounding|neighboring|communit|count/.test(clean));
    let re;
    assert.doesNotThrow(() => { re = serviceAreaPattern(city); });
    assert.equal(re.test(clean), false);
  }), { numRuns: 300 });
});

// ---- the business label -------------------------------------------------------------------------

function labelPage(extra) {
  const node = { '@context': 'https://schema.org', '@type': 'CleaningService', name: 'Capital City Window', telephone: '(615) 555-0100', ...extra };
  return `<script type="application/ld+json">${JSON.stringify(node)}</script><p>${'We clean windows. '.repeat(20)}</p>`;
}

test('F2: areaServed is read from a string, an object with a name, and an array', () => {
  assert.equal(readPageFacts(labelPage({ areaServed: 'Nashville' })).jsonLd.business.areaServed, 'Nashville');
  assert.equal(readPageFacts(labelPage({ areaServed: { '@type': 'City', name: 'Nashville' } })).jsonLd.business.areaServed, 'Nashville');
  assert.equal(
    readPageFacts(labelPage({ areaServed: ['Nashville', { '@type': 'City', name: 'Franklin' }, 7, null, { name: '' }] })).jsonLd.business.areaServed,
    'Nashville, Franklin',
  );
  assert.equal(readPageFacts(labelPage({})).jsonLd.business.areaServed, '');
  assert.equal(readPageFacts(labelPage({ areaServed: 'x'.repeat(500) })).jsonLd.business.areaServed.length, 120);
  // The existing fields are read as before.
  const f = readPageFacts(labelPage({ areaServed: 'Nashville' }));
  assert.equal(f.jsonLd.business.name, 'Capital City Window');
  assert.equal(f.jsonLd.business.telephone, '(615) 555-0100');
  assert.equal(f.jsonLd.business.address, null);
});

test('F2: hasReviewData is true for aggregateRating or review, and false when empty or missing', () => {
  const rated = readPageFacts(labelPage({ aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.9', reviewCount: '57' } }));
  assert.equal(rated.jsonLd.business.hasReviewData, true);
  assert.equal(hasReviewSignal(rated), true);
  const reviewed = readPageFacts(labelPage({ review: [{ '@type': 'Review', author: 'Dana R.' }] }));
  assert.equal(reviewed.jsonLd.business.hasReviewData, true);
  assert.equal(hasReviewSignal(reviewed), true);
  for (const empty of [{}, { aggregateRating: '' }, { review: [] }, { aggregateRating: {} }, { review: null }]) {
    const f = readPageFacts(labelPage(empty));
    assert.equal(f.jsonLd.business.hasReviewData, false, JSON.stringify(empty));
    assert.equal(hasReviewSignal(f), false, JSON.stringify(empty));
  }
});

// ---- headings ------------------------------------------------------------------------------------

test('F2: headings hold h1 to h3 in page order, leaving out link text and anything inside a nav', () => {
  const f = readPageFacts(page(`
    <nav><h2>Menu</h2><a href="/reviews">Reviews</a></nav>
    <h1>Capital City Window</h1>
    <h3>Fast and careful</h3>
    <h2>Customer reviews</h2>
    <a href="/testimonials"><h3>Testimonials</h3></a>
    <h3><a href="/more">Read more</a></h3>
    <h4>Not a heading we read</h4>`));
  assert.deepEqual(f.headings, ['Capital City Window', 'Fast and careful', 'Customer reviews']);
  assert.deepEqual(f.h1s, ['Capital City Window'], 'h1s is unchanged');
});

test('F2: headings are cut to 120 characters and at most 40 are kept', () => {
  const f = readPageFacts(page(`<h2>${'w'.repeat(300)}</h2>${'<h3>Item</h3>'.repeat(60)}`));
  assert.equal(f.headings.length, 40);
  assert.equal(f.headings[0].length, 120);
});

// ---- review signals ---------------------------------------------------------------------------------

test('F2: each kind of review signal passes', () => {
  const cases = {
    'a reviews heading': '<h2>Customer reviews</h2>',
    'a testimonials heading': '<h3>Testimonials</h3>',
    'what our customers say': '<h2>What our customers say</h2>',
    'what clients are saying': '<h3>What clients are saying</h3>',
    'stars': '<p>Rated 5.0 stars by our customers.</p>',
    'out of 5': '<p>4.9 out of 5 from 57 neighbors.</p>',
    'decimal slash': '<p>Rated 4.8/5 on Google.</p>',
    'star symbols': '<p>\u2605\u2605\u2605\u2605\u2605 Great work</p>',
    'quoted comment, straight quotes': '<p>"They cleaned every window and left no streaks at all." - Dana R.</p>',
    'quoted comment, curly quotes': '<p>\u201CFast, friendly and on time every single visit.\u201D \u2014 Mike T., Mar 2026</p>',
    'Google maps link': '<a href="https://www.google.com/maps/place/Capital+City+Window">Google</a>',
    'Google search link': '<a href="https://www.google.com/search?q=capital+city+window#lrd=0x8864:0x1234,1,,,">Google reviews</a>',
    'Yelp link': '<a href="https://www.yelp.com/biz/capital-city-window-nashville">Yelp</a>',
    'Facebook reviews link': '<a href="https://www.facebook.com/CapitalCityWindow/reviews">Facebook</a>',
    'Nextdoor page link': '<a href="https://nextdoor.com/pages/capital-city-window-nashville-tn/">Nextdoor</a>',
  };
  for (const [name, body] of Object.entries(cases)) assert.equal(reviews(body), true, name);
});

test('F2: a page with no review signal fails', () => {
  assert.equal(reviews('<h1>Capital City Window</h1><p>We clean windows in Nashville. Call (615) 555-0100.</p>'), false);
  assert.equal(hasReviewSignal(readPageFacts('')), false);
  assert.equal(hasReviewSignal(undefined), false);
});

test('F2: a "Reviews" link in a menu or in the page is not a review heading', () => {
  for (const body of [
    '<nav><a href="/reviews">Reviews</a></nav>',
    '<ul class="menu"><li><a href="/reviews">Reviews</a></li><li><a href="/testimonials">Testimonials</a></li></ul>',
    '<a href="/reviews"><h3>Reviews</h3></a>',
    '<nav><h2>Reviews</h2></nav>',
    '<p>Read our reviews below.</p>',
  ]) {
    assert.equal(reviews(body), false, body);
  }
});

test('F2: a slash form without a decimal is not a rating', () => {
  for (const body of ['<p>Closed 1/5 for the holiday.</p>', '<p>Open 9/5.</p>', '<p>Gutters 2/5 price.</p>', '<p>15 stars of the show</p>']) {
    assert.equal(reviews(body), false, body);
  }
  assert.equal(RATING_PATTERN.test('Rated 5.0/5'), true);
  assert.equal(RATING_PATTERN.test('\u2B50\u2B50\u2B50'), true);
  assert.equal(RATING_PATTERN.test('\u2605\u2605'), false, 'two stars are not enough');
});

test('F2: links to other sites and non-https links are not review links', () => {
  const f = readPageFacts(page(`
    <a href="http://www.yelp.com/biz/capital-city-window">Yelp</a>
    <a href="https://www.example.com/reviews">Our reviews</a>
    <a href="/reviews">Reviews</a>
    <a href="https://www.google.com/search?q=window+cleaners">Search</a>
    <a href="javascript:alert(1)">Click</a>`));
  assert.deepEqual(f.reviewLinks, []);
  assert.equal(hasReviewSignal(f), false);
});

test('F2: a footer Facebook page link fails, and its /reviews form passes', () => {
  const footer = '<footer><a href="https://www.facebook.com/CapitalCityWindow">Facebook</a> <a href="https://nextdoor.com/neighborhood/east-nashville/">Nextdoor</a></footer>';
  assert.deepEqual(readPageFacts(page(footer)).reviewLinks, []);
  assert.equal(reviews(footer), false);
  const withReviews = '<footer><a href="https://www.facebook.com/CapitalCityWindow/reviews">Facebook reviews</a></footer>';
  assert.deepEqual(readPageFacts(page(withReviews)).reviewLinks, ['https://www.facebook.com/CapitalCityWindow/reviews']);
  assert.equal(reviews(withReviews), true);
});

test('F2: a Google "write a review" link alone fails', () => {
  const body = '<a href="https://search.google.com/local/writereview?placeid=ChIJ123">Leave us a review</a>';
  assert.deepEqual(readPageFacts(page(body)).reviewLinks, []);
  assert.equal(reviews(body), false);
});

test('F2: review links are kept in page order, at most 5, with their query and # part', () => {
  const links = [
    'https://www.yelp.com/biz/a',
    'https://www.google.com/maps/place/A',
    'https://www.facebook.com/A/reviews',
    'https://maps.google.com/?cid=1',
    'https://g.page/a',
    'https://nextdoor.com/pages/a/',
    'https://maps.app.goo.gl/x',
  ];
  const f = readPageFacts(page(links.map(l => `<a href="  ${l}  ">x</a>`).join(' ')));
  assert.deepEqual(f.reviewLinks, links.slice(0, 5));
});

test('F2: the review patterns are bounded', () => {
  assert.equal(REVIEW_HEADING_PATTERN.test('Reviews'), true);
  assert.equal(REVIEW_HEADING_PATTERN.test('Previews of our work'), false, 'whole words only');
  assert.equal(QUOTED_REVIEW_PATTERN.test('"too short" - Dana'), false, 'under 20 characters');
  assert.equal(QUOTED_REVIEW_PATTERN.test(`"${'a'.repeat(401)}" - Dana`), false, 'over 400 characters');
  assert.equal(QUOTED_REVIEW_PATTERN.test('"They cleaned every window very well." - dana'), false, 'needs a capitalized name');
  for (const re of [REVIEW_HEADING_PATTERN, RATING_PATTERN, QUOTED_REVIEW_PATTERN]) {
    assert.equal(re.global, false);
    assert.equal(re.sticky, false);
  }
});

// ---- speed ----------------------------------------------------------------------------------------

/** A string of about 1 MB made by repeating `piece`. */
const megabyte = piece => piece.repeat(Math.ceil(MB / piece.length)).slice(0, MB);

test('F2: every new pattern reads a 1 MB adversarial page in under 200 ms', () => {
  const area = serviceAreaPattern('Nash|ville St. Louis A++');
  const pages = {
    'serving, no area': megabyte('serving fresh biscuits '),
    'we serve, no area': megabyte('we proudly serve '),
    'service, no area': megabyte('servic '),
    'city, no and': megabyte('nash|ville st louis a++ '),
    'stars, no number': megabyte('stars out of 5 / '),
    'numbers, no stars': megabyte('5 4.8 3.2 / 1 '),
    'half stars': megabyte('\u2605\u2605 '),
    'open quotes': megabyte(`"${'a'.repeat(399)}`),
    'quotes, no dash': megabyte(`"${'a'.repeat(30)}" `),
    'quotes, dash, no name': megabyte(`"${'a'.repeat(30)}" - `),
    'what our customers': megabyte('what our customers '),
    'one long word': 'a'.repeat(MB),
    'only spaces': ' '.repeat(MB),
  };
  for (const [name, text] of Object.entries(pages)) {
    for (const [label, re] of [['area', area], ['heading', REVIEW_HEADING_PATTERN], ['rating', RATING_PATTERN], ['quote', QUOTED_REVIEW_PATTERN]]) {
      const start = performance.now();
      re.test(text);
      const ms = performance.now() - start;
      assert.ok(ms < 200, `${label} on "${name}" took ${Math.round(ms)} ms`);
    }
  }
});

test('F2: reading a 1 MB page full of headings and review links stays fast and never throws', () => {
  const pieces = {
    headings: megabyte('<h2>Customer reviews</h2><h3>x</h3>'),
    links: megabyte('<a href="https://www.facebook.com/x">x</a>'),
    'nav and a, unclosed': megabyte('<nav><a><h2>'),
    'unclosed a': megabyte('<a'),
  };
  for (const [name, html] of Object.entries(pieces)) {
    const start = Date.now();
    let facts;
    assert.doesNotThrow(() => { facts = readPageFacts(html); }, name);
    hasReviewSignal(facts);
    const ms = Date.now() - start;
    assert.ok(ms < 3000, `${name} took ${ms} ms`);
    assert.ok(facts.headings.length <= 40 && facts.reviewLinks.length <= 5);
  }
});

test('F2: the new fields are there on any input', () => {
  for (const v of [undefined, null, '', 42, '<h2>', '<a href="https://www.yelp.com/biz/x">']) {
    const f = readPageFacts(v);
    assert.ok(Array.isArray(f.headings));
    assert.ok(Array.isArray(f.reviewLinks));
  }
});
