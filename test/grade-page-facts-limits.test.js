/**
 * The F2 review (V74 to V76): pages with very many links, very long text, and the narrower "serving" window.
 * Pure functions: no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readPageFacts, serviceAreaPattern, hasReviewSignal, serviceAreaText, textForPatterns, MAX_PATTERN_TEXT,
  RATING_PATTERN, QUOTED_REVIEW_PATTERN,
} from '../server/lib/page-facts.js';
import { normalizeForMatch } from '../server/lib/seance.js';

const MB = 1024 * 1024;
const megabyte = piece => piece.repeat(Math.ceil(MB / piece.length)).slice(0, MB);

test('V74: a 1 MB page made of links is read in under 200 ms', () => {
  for (const [name, html] of Object.entries({
    'bare links': megabyte('<a href=x>'),
    'relative links with text': megabyte('<a href="/x">y</a>'),
  })) {
    readPageFacts(html.slice(0, 1000)); // warm up
    const start = performance.now();
    const facts = readPageFacts(html);
    const ms = performance.now() - start;
    assert.ok(ms < 200, `${name} took ${Math.round(ms)} ms`);
    assert.deepEqual(facts.reviewLinks, []);
  }
});

test('V74: only full https addresses among the first 2,000 links are looked at', () => {
  const yelp = '<a href="https://www.yelp.com/biz/capital-city-window">Yelp</a>';
  const early = readPageFacts(`${'<a href="/x">y</a>'.repeat(1999)}${yelp}`);
  assert.deepEqual(early.reviewLinks, ['https://www.yelp.com/biz/capital-city-window']);
  const late = readPageFacts(`${'<a href="/x">y</a>'.repeat(2000)}${yelp}`);
  assert.deepEqual(late.reviewLinks, [], 'the 2,001st link is not looked at');
  // Links that are not written out as https:// never count.
  const short = readPageFacts('<a href="https:www.yelp.com/biz/a">a</a><a href="//www.yelp.com/biz/a">b</a><a href="HTTPS://www.yelp.com/biz/a">c</a>');
  assert.deepEqual(short.reviewLinks, ['HTTPS://www.yelp.com/biz/a']);
});

test('V75: the pattern tests read only the first 200,000 characters of the text', () => {
  assert.equal(MAX_PATTERN_TEXT, 200000);
  assert.equal(textForPatterns('a'.repeat(300000)).length, 200000);
  assert.equal(textForPatterns(undefined), '');
  assert.equal(serviceAreaText({ text: `${'x '.repeat(150000)}serving nearby areas` }).includes('serving'), false);
  assert.equal(serviceAreaText({ text: 'Serving St. Louis and nearby areas' }), 'serving st louis and nearby areas');
  assert.equal(serviceAreaText(null), '');

  // A rating far down a huge page is not read; one near the top is.
  const far = { text: `${'word '.repeat(50000)}Rated 5.0 stars`, headings: [], reviewLinks: [], jsonLd: {} };
  assert.equal(hasReviewSignal(far), false);
  const near = { text: `Rated 5.0 stars ${'word '.repeat(50000)}`, headings: [], reviewLinks: [], jsonLd: {} };
  assert.equal(hasReviewSignal(near), true);
});

test('V75: normalizing and testing 1 MB of page text stays under 200 ms', () => {
  const text = megabyte('We clean windows, gutters and siding! Call (615) 555-0100. ');
  const area = serviceAreaPattern('Nashville');
  serviceAreaText({ text: text.slice(0, 1000) }); // warm up
  const start = performance.now();
  const normalized = serviceAreaText({ text });
  area.test(normalized);
  const capped = textForPatterns(text);
  RATING_PATTERN.test(capped);
  QUOTED_REVIEW_PATTERN.test(capped);
  hasReviewSignal({ text, headings: [], reviewLinks: [], jsonLd: {} });
  const ms = performance.now() - start;
  assert.ok(ms < 200, `took ${Math.round(ms)} ms`);
});

test('V76 (as changed by V79): the window after "serving" stays inside one sentence, up to 120 characters', () => {
  const nashville = serviceAreaPattern('Nashville');
  // V79: the page text is read before punctuation is taken out.
  const read = text => nashville.test(text);
  assert.equal(read('We serve breakfast all day. Visit us at 12 Main St, Nashville, TN'), false);
  assert.equal(read('We proudly serve the greater Nashville area'), true);
  assert.equal(read('Serving Nashville and surrounding areas'), true);
  assert.equal(read('Proudly serve the Nashville area'), true);
  // The window holds the characters between the verb and the city: a space, the x's and a space.
  assert.equal(read(`Serving ${'x'.repeat(118)} Nashville`), true, 'just inside the window');
  assert.equal(read(`Serving ${'x'.repeat(125)} Nashville`), false, 'just outside the window');
});
