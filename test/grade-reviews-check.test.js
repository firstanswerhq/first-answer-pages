/**
 * The reviews-visible Check and the new Customer basics points (Feature B, task F3; Requirement 19).
 * Pure functions: no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHECKS, checkById, runWebsiteChecks } from '../server/lib/grade-checks.js';
import { readPageFacts } from '../server/lib/page-facts.js';

const input = { city: 'Nashville', service: 'window cleaning', website: 'https://example.com/' };
const FILLER = `<p>${'We clean windows for homes and shops. '.repeat(10)}</p>`;

function reviewsResult(body, extra = {}) {
  const facts = readPageFacts(`<title>Capital City Window</title><h1>Window cleaning</h1>${FILLER}${body}`);
  const results = runWebsiteChecks({ facts, robots: { status: 404 }, llms: { status: 404 }, input, ...extra });
  return results.find(r => r.id === 'reviews-visible');
}

const FAIL_DETAIL = "We found no customer reviews on your home page. AI assistants often can't see reviews that are only inside Google.";
const PASS_DETAIL = 'Your home page shows customer reviews that AI can read.';
const FIX = "Put 3 or more of your real customer reviews on your home page, with each customer's first name and the date, and add a link to your Google reviews.";

test('F3: reviews-visible is a 3-point Customer basics Check with the label, texts and fix of Requirement 19', () => {
  const c = checkById('reviews-visible');
  assert.ok(c);
  assert.equal(c.group, 'customer_basics');
  assert.equal(c.points, 3);
  assert.equal(c.label, 'Reviews on your website');
  assert.equal(c.passText, PASS_DETAIL);
  assert.equal(c.failText, FAIL_DETAIL);
  assert.equal(c.fix, FIX);
  assert.ok(Array.from(c.fix).length <= 160);
});

test('F3: the five Customer basics Checks are 4, 3, 3, 2 and 3 and total 15, and all Checks still total 100', () => {
  const basics = Object.fromEntries(CHECKS.filter(c => c.group === 'customer_basics').map(c => [c.id, c.points]));
  assert.deepEqual(basics, { 'tap-to-call': 4, 'hours-shown': 3, 'address-shown': 3, 'call-button': 2, 'reviews-visible': 3 });
  assert.equal(Object.values(basics).reduce((a, b) => a + b, 0), 15);
  assert.equal(CHECKS.reduce((n, c) => n + c.points, 0), 100);
  // A readable Grade still has 85 points available before google-profile.
  const available = CHECKS.filter(c => c.id !== 'google-profile').reduce((n, c) => n + c.points, 0);
  assert.equal(available, 85);
});

test('F3: reviews-visible passes for each kind of review signal', () => {
  const cases = {
    'a reviews heading': '<h2>Customer reviews</h2>',
    'a testimonials heading': '<h2>Testimonials</h2>',
    'what our customers say': '<h2>What our customers say</h2>',
    'stars': '<p>Rated 5.0 stars.</p>',
    'out of 5': '<p>4.9 out of 5 from our neighbors.</p>',
    'a decimal slash': '<p>4.8/5 on Google.</p>',
    'star symbols': '<p>\u2605\u2605\u2605\u2605\u2605</p>',
    'a quoted comment with a name': '<p>"Every window was spotless and they were done in an hour." - Dana R., March 2026</p>',
    'a Google reviews link': '<a href="https://www.google.com/maps/place/Capital+City+Window">Google reviews</a>',
    'a Yelp link': '<a href="https://www.yelp.com/biz/capital-city-window-nashville">Yelp</a>',
    'a Facebook reviews link': '<a href="https://www.facebook.com/CapitalCityWindow/reviews">Facebook</a>',
    'a Nextdoor page link': '<a href="https://nextdoor.com/pages/capital-city-window-nashville-tn/">Nextdoor</a>',
    'aggregateRating': '<script type="application/ld+json">{"@type":"LocalBusiness","name":"Capital City Window","telephone":"6155550100","aggregateRating":{"ratingValue":"4.9","reviewCount":"40"}}</script>',
    'review': '<script type="application/ld+json">{"@type":"LocalBusiness","name":"Capital City Window","telephone":"6155550100","review":[{"author":"Dana"}]}</script>',
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = reviewsResult(body);
    assert.equal(r.result, 'pass', name);
    assert.equal(r.detail, PASS_DETAIL, name);
  }
});

test('F3: reviews-visible fails with the plain detail when there is no review signal', () => {
  const cases = {
    'nothing': '',
    'a menu link': '<nav><a href="/reviews">Reviews</a></nav>',
    'a footer Facebook page': '<footer><a href="https://www.facebook.com/CapitalCityWindow">Facebook</a></footer>',
    'a write-a-review form': '<a href="https://search.google.com/local/writereview?placeid=ChIJ123">Leave a review</a>',
    'a date with a slash': '<p>Closed 1/5 for the holiday.</p>',
  };
  for (const [name, body] of Object.entries(cases)) {
    const r = reviewsResult(body);
    assert.equal(r.result, 'fail', name);
    assert.equal(r.detail, FAIL_DETAIL, name);
  }
});

test('F3: reviews-visible is not checked with no website, an unreadable page or a script-built page', () => {
  const none = runWebsiteChecks({ facts: null, robots: null, llms: null, input: { ...input, website: null } });
  assert.deepEqual(none.find(r => r.id === 'reviews-visible'), { id: 'reviews-visible', result: 'not_checked', detail: 'No website given' });

  const down = runWebsiteChecks({ facts: null, robots: null, llms: null, input });
  assert.equal(down.find(r => r.id === 'reviews-visible').result, 'not_checked');
  assert.equal(down.find(r => r.id === 'reviews-visible').detail, "We couldn't reach your website.");

  const script = readPageFacts('<title>Capital City Window</title><div id="root"></div><script src="app.js"></script><h2>Reviews</h2>');
  const built = runWebsiteChecks({ facts: script, robots: { status: 404 }, llms: { status: 404 }, input });
  const r = built.find(x => x.id === 'reviews-visible');
  assert.equal(r.result, 'not_checked');
  assert.equal(r.detail, "Your page loads its words in a way some AI tools can't read.");
});

test('F3: no review wording suggests writing, editing or copying reviews, or promises AI will name the business', () => {
  const c = checkById('reviews-visible');
  for (const text of [c.label, c.passText, c.failText, c.fix]) {
    assert.doesNotMatch(text, /\b(write|writing|edit|editing|copy|copying|fake|buy|ask (for|your)|guarantee)\b/i, text);
    assert.doesNotMatch(text, /will (name|recommend|mention)/i, text);
  }
  assert.match(c.fix, /real customer reviews/);
});
