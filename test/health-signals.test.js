/**
 * high-tech-look Requirements 3, 7 and 8: the new honest signals. Every lookup is a fake result; no network.
 * A signal is green, amber, red or gray; it is never a false red; when it cannot be sure it is "Not checked" with a
 * reason; every fix sentence is at most 160 characters; nothing here changes the score.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { readPageFacts } from '../server/lib/page-facts.js';
import {
  buildSignals, sitemapSignal, signalRows, SIGNAL_ROWS, FIXES, textHasService, serviceWords,
} from '../server/lib/health-signals.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const DAY = 86400000;
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const FOUND = { phone: '(615) 555-0142', address: '12 Main Street, Nashville, TN 37203', hours: [] };
const STATUSES = new Set(['good', 'partly', 'missing', 'not_checked']);

const GOOD_PAGE = `<!doctype html><html><head><title>Zephyr Plumbing | Nashville</title></head><body>
<h1>Zephyr Plumbing</h1>
<p>We are plumbers serving Nashville and nearby towns. Call (615) 555-0142. ${'We fix pipes and drains. '.repeat(15)}</p>
<h2>How much does a drain cleaning cost?</h2><p>It depends.</p>
<h2>Do you work on weekends?</h2><p>Yes.</p>
<a href="/plumbing-repair">Plumbing repair</a> <a href="/water-heater-plumbing">Water heater plumbing</a>
<a href="https://www.facebook.com/ZephyrPlumbing">Facebook</a> <a href="https://www.yelp.com/biz/zephyr-plumbing-nashville">Yelp</a>
<a href="https://maps.app.goo.gl/AbCdEf123">Find us on Google</a>
</body></html>`;

const SITEMAP_XML = (lastmod = '2026-10-01') => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://zephyr.example/</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>
<url><loc>https://zephyr.example/plumbing-repair</loc></url>
</urlset>`;

const place = (extra = {}) => ({
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
  newestReviewAt: new Date(NOW - 20 * DAY).toISOString(),
  ...extra,
});
const found = extra => ({ status: 'found', place: place(extra) });

function build(over = {}) {
  return buildSignals({
    input: INPUT,
    facts: readPageFacts(GOOD_PAGE),
    found: FOUND,
    robots: { status: 200, text: 'User-agent: *\nAllow: /' },
    sitemap: { status: 200, text: SITEMAP_XML(), contentType: 'application/xml', url: 'https://zephyr.example/sitemap.xml' },
    places: found(),
    bing: { status: 'found', place: { name: 'Zephyr Plumbing', phone: '+1 615-555-0142', address: '12 Main Street, Nashville, TN 37203', website: 'https://zephyr.example' } },
    listingInfo: { state: 'none', listing: null, verified: false, founder: null, foundersOpen: false },
    websiteHours: { monday: '8am-5pm' },
    now: NOW,
    ...over,
  });
}

const allSignals = s => Object.entries(s).filter(([k]) => !['version', 'checkedAt'].includes(k))
  .flatMap(([group, obj]) => Object.entries(obj).filter(([, v]) => v).map(([id, v]) => [`${group}.${id}`, v]));

// ---- the sitemap (3.9) ---------------------------------------------------------------------------------------------

test('sitemap: real XML with an entry is Found; a missing page or a page that is not a sitemap is Not found', () => {
  const at = sitemap => sitemapSignal({ hasSite: true, sitemap });
  assert.equal(at({ status: 200, text: SITEMAP_XML() }).label, 'Found');
  assert.equal(at({ status: 200, text: SITEMAP_XML() }).status, 'good');
  assert.equal(at({ status: 200, text: '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://zephyr.example/s1.xml</loc></sitemap></sitemapindex>' }).status, 'good');
  for (const reply of [
    { status: 404, text: 'Not found' },
    { status: 410, text: '' },
    { status: 200, text: '<!doctype html><html><body>Coming soon</body></html>' },
    { status: 200, text: '<?xml version="1.0"?><urlset></urlset>' },
    { status: 200, text: '' },
  ]) {
    const s = at(reply);
    assert.equal(s.status, 'missing', JSON.stringify(reply));
    assert.equal(s.label, 'Not found');
    assert.ok(s.fix.length <= 160);
  }
});

test('sitemap: when we cannot be sure (blocked, error, timeout, no website) it is Not checked with a reason, never Not found', () => {
  const at = (sitemap, hasSite = true) => sitemapSignal({ hasSite, sitemap });
  for (const [name, s] of Object.entries({
    forbidden: at({ status: 403, text: '' }),
    tooMany: at({ status: 429, text: '' }),
    serverError: at({ status: 503, text: '' }),
    error: at({ error: true }),
    timeout: at({ status: 0 }),
    notAsked: at(null),
    noWebsite: at({ status: 200, text: SITEMAP_XML() }, false),
    odd: at({ status: 301, text: '' }),
  })) {
    assert.equal(s.status, 'not_checked', name);
    assert.equal(s.label, 'Not checked', name);
    assert.ok(s.reason && s.reason.length > 0, name);
    assert.equal('fix' in s, false, name);
  }
});

// ---- the website: "Speaks AI's language" and the page itself ---------------------------------------------------------

test('a well written page is Found for everything it says, and the sitemap dates are recent', () => {
  const w = build().website;
  for (const id of ['sitemap', 'wordsInPage', 'saysWhatYouDo', 'saysWhereYouWork', 'answersQuestions', 'pagePerService', 'recentlyUpdated']) {
    assert.equal(w[id].status, 'good', id);
  }
  assert.equal(w.wordsInPage.label, 'Found in the page');
  assert.equal(w.pagePerService.label, 'Several service pages');
  assert.equal(w.recentlyUpdated.label, 'Updated in the last 12 months');
});

test('"Says what you do" and "Says where you work" read the visible text; the title alone does not count', () => {
  const html = '<title>Plumbers in Nashville</title><h1>Welcome</h1><p>Call us any time. ' + 'We care about our customers. '.repeat(15) + '</p>';
  const w = build({ facts: readPageFacts(html) }).website;
  assert.equal(w.saysWhatYouDo.status, 'missing');
  assert.equal(w.saysWhereYouWork.status, 'missing');
  assert.equal(w.saysWhatYouDo.label, 'Not found');
  assert.ok(w.saysWhatYouDo.fix.length <= 160);
});

test('"Says what you do" matches plurals and the same word stem; filler words never match', () => {
  assert.equal(textHasService('We do roofing and repairs', 'roofers'), true);
  assert.equal(textHasService('Best plumber in town', 'plumbers'), true);
  assert.equal(textHasService('Our window cleaning crew', 'Window cleaning and pressure cleaning'), true);
  assert.equal(textHasService('We sell cakes', 'plumbers'), false);
  assert.equal(textHasService('the and of services', 'services and the'), false);
  assert.deepEqual(serviceWords('Window cleaning and pressure cleaning'), ['window', 'cleaning', 'pressure', 'cleaning']);
});

test('"Answers common questions": a heading, two question headings, details pairs or FAQPage markup', () => {
  const pad = '<p>' + 'We fix pipes. '.repeat(20) + '</p>';
  const yes = {
    'a heading': `<h2>Frequently asked questions</h2>${pad}`,
    'two question headings': `<h2>What do you charge?</h2><h3>Do you come on weekends?</h3>${pad}`,
    'details pairs': `<details><summary>Price?</summary>x</details><details><summary>Hours?</summary>y</details>${pad}`,
    'FAQPage markup': `<script type="application/ld+json">{"@type":"FAQPage"}</script>${pad}`,
  };
  for (const [name, html] of Object.entries(yes)) assert.equal(readPageFacts(html).faq, true, name);
  for (const [name, html] of Object.entries({
    'one question heading': `<h2>What do you charge?</h2>${pad}`,
    'one details pair': `<details><summary>Price?</summary>x</details>${pad}`,
    'no questions': pad,
  })) assert.equal(readPageFacts(html).faq, false, name);
  const s = build({ facts: readPageFacts(pad) }).website.answersQuestions;
  assert.equal(s.status, 'missing');
  assert.ok(s.fix.startsWith('Add a short questions-and-answers section'));
});

test('words in the page itself: never red; a page built by scripts is amber with the reason; an unreadable page is gray', () => {
  const scripts = readPageFacts('<title>Zephyr</title><div id="root"></div><script src="app.js"></script>');
  assert.equal(scripts.scriptBuilt, true);
  const amber = build({ facts: scripts }).website;
  assert.equal(amber.wordsInPage.status, 'partly');
  assert.equal(amber.wordsInPage.label, 'Not found in the page code');
  assert.equal(amber.wordsInPage.reason, "Your name and phone weren't in the page's own text. Some AI tools can't read text added by scripts.");
  // The text-based signals are gray on such a page, not red.
  for (const id of ['saysWhatYouDo', 'saysWhereYouWork', 'answersQuestions']) assert.equal(amber[id].status, 'not_checked', id);
  const noPhone = readPageFacts('<h1>Zephyr Plumbing</h1><p>' + 'We fix pipes in Nashville. '.repeat(15) + '</p>');
  assert.equal(build({ facts: noPhone }).website.wordsInPage.status, 'partly');
  const unreadable = build({ facts: null }).website;
  assert.equal(unreadable.wordsInPage.status, 'not_checked');
  assert.equal(unreadable.wordsInPage.reason, "We couldn't read your home page.");
});

test('a page for each service: counted from the sitemap and the links; one page only is amber; too little to see is gray', () => {
  const one = readPageFacts('<h1>Zephyr</h1><p>' + 'We are plumbers. '.repeat(20) + '</p><a href="/contact">Contact</a>');
  const noSitemap = null;
  assert.equal(build({ facts: one, sitemap: noSitemap }).website.pagePerService.status, 'partly');
  assert.equal(build({ facts: one, sitemap: noSitemap }).website.pagePerService.label, 'One page only');
  const bare = readPageFacts('<h1>Zephyr</h1><p>' + 'We are plumbers. '.repeat(20) + '</p>');
  assert.equal(build({ facts: bare, sitemap: noSitemap }).website.pagePerService.status, 'not_checked');
  // The sitemap alone can show the service pages.
  const map = `<?xml version="1.0"?><urlset><url><loc>https://zephyr.example/plumbing-repair</loc></url><url><loc>https://zephyr.example/drain-plumbing</loc></url></urlset>`;
  assert.equal(build({ facts: bare, sitemap: { status: 200, text: map } }).website.pagePerService.status, 'good');
  // Pages of another site do not count.
  const other = `<?xml version="1.0"?><urlset><url><loc>https://other.example/plumbing-repair</loc></url><url><loc>https://other.example/drain-plumbing</loc></url></urlset>`;
  assert.equal(build({ facts: bare, sitemap: { status: 200, text: other } }).website.pagePerService.status, 'not_checked');
});

test('recently updated: the newest sitemap date, within 12 months or not; no dates and no sitemap are gray', () => {
  const at = (lastmod, sitemap = true) => build({
    sitemap: sitemap ? { status: 200, text: SITEMAP_XML(lastmod) } : { status: 404, text: '' },
  }).website.recentlyUpdated;
  assert.equal(at('2026-06-01').status, 'good');
  assert.equal(at('2024-01-01').status, 'partly');
  assert.equal(at('2024-01-01').label, 'Not updated in a year');
  assert.equal(at('').status, 'not_checked');
  assert.equal(at('', false).status, 'not_checked');
  assert.equal(at('not a date').status, 'not_checked');
});

// ---- Google (KEY) ----------------------------------------------------------------------------------------------------

test('a full Google profile that matches the website is green all the way down', () => {
  const g = build().google;
  for (const id of ['found', 'open', 'category', 'hours', 'reviewCount', 'rating', 'newestReview', 'phoneMatch', 'addressMatch', 'nameMatch', 'hoursMatch', 'linksToWebsite']) {
    assert.equal(g[id].status, 'good', id);
  }
  assert.equal(g.found.label, 'Found on Google');
  assert.equal(g.reviewCount.label, '10 or more reviews');
});

test('review count, star rating and the newest review use the named thresholds', () => {
  const at = extra => build({ places: found(extra) }).google;
  assert.equal(at({ ratingCount: 10 }).reviewCount.status, 'good');
  assert.equal(at({ ratingCount: 9 }).reviewCount.status, 'partly');
  assert.equal(at({ ratingCount: 1 }).reviewCount.label, '1 to 9 reviews');
  assert.equal(at({ ratingCount: 0 }).reviewCount.status, 'missing');
  assert.equal(at({ ratingCount: 0 }).reviewCount.label, 'No reviews');
  assert.equal(at({ rating: 4.3 }).rating.status, 'good');
  assert.equal(at({ rating: 4.2 }).rating.status, 'partly');
  assert.equal(at({ rating: 3.8 }).rating.status, 'partly');
  assert.equal(at({ rating: 3.7 }).rating.status, 'missing');
  assert.equal(at({ rating: null }).rating.status, 'not_checked');
  assert.equal(at({ newestReviewAt: new Date(NOW - 89 * DAY).toISOString() }).newestReview.status, 'good');
  const old = at({ newestReviewAt: new Date(NOW - 200 * DAY).toISOString() }).newestReview;
  assert.equal(old.status, 'partly', 'an old newest review is amber, never red');
  assert.equal(old.reason, 'Based on the reviews Google returned (up to 5).');
  assert.equal(at({ newestReviewAt: null }).newestReview.status, 'not_checked');
});

test('open, category and hours: closed is red, a different category is amber, no hours is red', () => {
  const at = extra => build({ places: found(extra) }).google;
  assert.equal(at({ businessStatus: 'CLOSED_PERMANENTLY' }).open.status, 'missing');
  assert.equal(at({ businessStatus: 'CLOSED_TEMPORARILY' }).open.label, 'Marked closed');
  assert.equal(at({ businessStatus: '' }).open.status, 'not_checked');
  assert.equal(at({ primaryType: 'hair_salon' }).category.status, 'partly');
  assert.equal(at({ primaryType: 'hair_salon' }).category.label, 'Category differs');
  assert.equal(at({ primaryType: 'plumbing_contractor' }).category.status, 'good');
  assert.equal(at({ primaryType: '' }).category.status, 'not_checked');
  assert.equal(at({ hasHours: false, hoursByDay: {} }).hours.status, 'missing');
});

test('phone, address, name and hours match: a mismatch is red only when both sides are readable; close is amber', () => {
  const at = (extra, over) => build({ places: found(extra), ...over }).google;
  const phone = at({ phone: '(615) 555-0199' }).phoneMatch;
  assert.equal(phone.status, 'missing');
  assert.equal(phone.label, "Doesn't match");
  assert.equal(phone.website, '(615) 555-0142');
  assert.equal(phone.google, '(615) 555-0199');
  // Google's number is also on the page, so it is not a mismatch.
  const both = readPageFacts(GOOD_PAGE.replace('Call (615) 555-0142.', 'Call (615) 555-0142 or (615) 555-0199.'));
  assert.equal(at({ phone: '(615) 555-0199' }, { facts: both }).phoneMatch.status, 'good');
  assert.equal(at({ phone: '' }).phoneMatch.status, 'not_checked');
  assert.equal(build({ found: { ...FOUND, phone: '' }, places: found() }).google.phoneMatch.status, 'not_checked');

  assert.equal(at({ address: '14 Main St, Nashville, TN 37203, USA' }).addressMatch.status, 'missing');
  assert.equal(at({ address: '12 Main St, Nashville, TN 37204' }).addressMatch.status, 'partly');
  assert.equal(at({ address: '12 Main St, Nashville, TN 37204' }).addressMatch.label, 'Close, not the same');
  assert.equal(at({ address: 'Nashville, TN' }).addressMatch.status, 'not_checked');
  assert.equal(build({ found: { ...FOUND, address: '' }, places: found() }).google.addressMatch.status, 'not_checked');

  assert.equal(at({ name: 'Zephyr Plumbing and Heating' }).nameMatch.status, 'partly');
  assert.equal(at({ name: 'Zephyr Plumbing, Inc.' }).nameMatch.status, 'good');

  assert.equal(at({ hoursByDay: { monday: { opens: '09:00', closes: '17:00' } } }).hoursMatch.status, 'partly', 'one day alone is never red');
  assert.equal(at({ hoursByDay: { monday: { opens: '09:00', closes: '17:00' }, tuesday: { opens: '09:00', closes: '17:00' } } }, {
    websiteHours: { monday: '8am-5pm', tuesday: '8am-5pm' },
  }).hoursMatch.status, 'missing');
  assert.equal(build({ places: found(), websiteHours: {} }).google.hoursMatch.status, 'not_checked');
  assert.equal(at({ hasHours: false, hoursByDay: {} }).hoursMatch.status, 'not_checked');
});

test('the Google profile links to the website: same domain is green; none or another site is amber', () => {
  const at = extra => build({ places: found(extra) }).google.linksToWebsite;
  assert.equal(at({ website: 'https://www.zephyr.example/contact' }).status, 'good');
  assert.equal(at({ website: '' }).status, 'partly');
  assert.equal(at({ website: '' }).label, "Doesn't link to your website");
  assert.equal(at({ website: 'https://facebook.com/zephyr' }).status, 'partly');
  assert.equal(build({ input: { ...INPUT, website: '' }, facts: null, places: found() }).google.linksToWebsite.status, 'not_checked');
});

test('not found on Google is red once; every other Google signal is gray with a reason', () => {
  const g = build({ places: { status: 'not_found', reason: 'None of the results looked like your business.' } }).google;
  assert.equal(g.found.status, 'missing');
  assert.equal(g.found.label, 'Not found on Google');
  assert.ok(g.found.fix.length <= 160);
  for (const [id, s] of Object.entries(g)) if (id !== 'found') assert.equal(s.status, 'not_checked', id);
});

test('with no key, an error, a timeout, a limit or several close results, every Google signal is gray: never red', () => {
  for (const places of [
    null, undefined, { status: 'off' }, { status: 'error', reason: "We couldn't reach Google this time." },
    { status: 'limit', reason: "Today's limit for AI questions was reached, so we didn't look this up." },
    { status: 'unsure', reason: "More than one result looked like your business, so we didn't pick one." },
  ]) {
    const g = build({ places }).google;
    for (const [id, s] of Object.entries(g)) {
      assert.equal(s.status, 'not_checked', `${JSON.stringify(places)} ${id}`);
      assert.equal(s.label, 'Not checked');
      assert.ok(s.reason, id);
    }
  }
  assert.equal(build({ places: { status: 'off' } }).google.found.reason, "Google lookups aren't turned on here.");
});

// ---- Bing (KEY) ------------------------------------------------------------------------------------------------------

test('Bing: found, and the details match, differ closely, or differ clearly; no key is gray', () => {
  assert.equal(build().bing.found.label, 'Found on Bing');
  assert.equal(build().bing.details.status, 'good');
  const bing = place => ({ status: 'found', place: { name: 'Zephyr Plumbing', phone: '+1 615-555-0142', address: '12 Main Street, Nashville, TN 37203', website: '', ...place } });
  assert.equal(build({ bing: bing({ phone: '+1 615-555-0100' }) }).bing.details.status, 'missing');
  assert.equal(build({ bing: bing({ name: 'Zephyr Plumbing and Heating' }) }).bing.details.status, 'partly');
  assert.equal(build({ bing: bing({ phone: '', address: '', name: '' }) }).bing.details.status, 'not_checked');
  const gone = build({ bing: { status: 'not_found', reason: 'x' } }).bing;
  assert.equal(gone.found.status, 'missing');
  assert.equal(gone.details.status, 'not_checked');
  for (const bingResult of [null, { status: 'off' }, { status: 'error', reason: "We couldn't reach Bing this time." }, { status: 'unsure', reason: 'x' }]) {
    const b = build({ bing: bingResult }).bing;
    assert.equal(b.found.status, 'not_checked');
    assert.equal(b.details.status, 'not_checked');
  }
  assert.equal(build({ bing: null }).bing.found.reason, "Bing lookups aren't turned on here.");
});

// ---- links between profiles ------------------------------------------------------------------------------------------

test('links: Google, Yelp and the three socials are Linked or Not linked; the socials cluster counts them', () => {
  const l = build().links;
  assert.equal(l.google.label, 'Linked from your website');
  assert.equal(l.yelp.status, 'good');
  assert.equal(l.facebook.status, 'good');
  assert.equal(l.instagram.status, 'partly');
  assert.equal(l.instagram.label, 'Not linked');
  assert.equal(l.tiktok.status, 'partly');
  assert.equal(l.socials.label, '1 of 3 linked');
  assert.equal(l.socials.status, 'partly');
  const three = readPageFacts('<a href="https://facebook.com/zephyr.co">f</a><a href="https://instagram.com/zephyr.co">i</a><a href="https://tiktok.com/@zephyr.co">t</a>');
  assert.equal(build({ facts: three }).links.socials.status, 'good');
  assert.equal(build({ facts: three }).links.socials.label, '3 of 3 linked');
  const zero = readPageFacts('<a href="/about">About</a>');
  assert.equal(build({ facts: zero }).links.socials.status, 'missing');
  assert.equal(build({ facts: zero }).links.socials.label, '0 of 3 linked');
  // Only Facebook's fix may say it helps AI connect the business.
  assert.ok(FIXES.linkFacebook.includes('AI'));
  assert.equal(/\bAI\b/.test(FIXES.linkInstagram), false);
  assert.equal(/\bAI\b/.test(FIXES.linkTikTok), false);
});

test('links are gray, not amber, when the site could not be read or there is no website', () => {
  for (const over of [{ facts: null }, { input: { ...INPUT, website: '' }, facts: null }]) {
    const l = build(over).links;
    for (const [id, s] of Object.entries(l)) assert.equal(s.status, 'not_checked', id);
  }
});

// ---- the free listing ------------------------------------------------------------------------------------------------

test('listing: not listed yet is amber with the claim; listed, verified and Founding Member are green', () => {
  const none = build().listing;
  assert.equal(none.listed.label, 'Not listed yet');
  assert.equal(none.listed.needsClaim, true);
  assert.equal(none.verified.status, 'not_checked');
  assert.equal(none.matchesWebsite.status, 'not_checked');
  assert.equal(none.founding, null, 'no Founding Member row when there is nothing true to say');

  const info = extra => ({ state: 'listed', listing: { id: 'zephyr-1', name: 'Zephyr Plumbing', phone: '(615) 555-0142', address: '12 Main St, Nashville, TN 37203', website: 'https://zephyr.example/' }, verified: false, founder: null, foundersOpen: false, ...extra });
  const listed = build({ listingInfo: info() }).listing;
  assert.equal(listed.listed.status, 'good');
  assert.equal(listed.listed.listingId, 'zephyr-1');
  assert.equal(listed.verified.label, 'Not verified yet');
  assert.equal(listed.verified.status, 'partly');
  assert.equal(listed.matchesWebsite.status, 'good');
  assert.equal(listed.linksToWebsite.label, 'Linked');
  assert.equal(listed.founding, null);

  assert.equal(build({ listingInfo: info({ verified: true }) }).listing.verified.label, 'Verified');
  assert.equal(build({ listingInfo: info({ founder: { number: 12 } }) }).listing.founding.label, 'Founding Member');
  assert.equal(build({ listingInfo: info({ founder: { number: 12 } }) }).listing.founding.status, 'good');
  const open = build({ listingInfo: info({ foundersOpen: true }) }).listing.founding;
  assert.equal(open.label, 'Founding spots still open');
  assert.equal(open.status, 'partly');
  assert.equal('fix' in open, false);
  // Spots open, nothing listed yet: still true, so still shown.
  assert.equal(build({ listingInfo: { state: 'none', listing: null, foundersOpen: true } }).listing.founding.label, 'Founding spots still open');
});

test('listing matches the website: a different phone or address is amber "Differs"; nothing to compare is gray; no website on it is amber', () => {
  const info = extra => ({ state: 'listed', listing: { id: 'z', phone: '(615) 555-0142', address: '12 Main St, Nashville, TN', website: 'https://zephyr.example/', ...extra }, verified: false, founder: null, foundersOpen: false });
  assert.equal(build({ listingInfo: info({ phone: '(615) 555-0100' }) }).listing.matchesWebsite.status, 'partly');
  assert.equal(build({ listingInfo: info({ phone: '(615) 555-0100' }) }).listing.matchesWebsite.label, 'Differs');
  assert.equal(build({ listingInfo: info({ address: '99 Oak Ave, Nashville, TN' }) }).listing.matchesWebsite.status, 'partly');
  assert.equal(build({ listingInfo: info({ phone: '', address: '' }) }).listing.matchesWebsite.status, 'not_checked');
  assert.equal(build({ listingInfo: info({ website: '' }) }).listing.linksToWebsite.label, 'No website on the listing');
  const unsure = build({ listingInfo: { state: 'unsure' } }).listing;
  for (const id of ['listed', 'verified', 'matchesWebsite', 'linksToWebsite']) assert.equal(unsure[id].status, 'not_checked', id);
});

// ---- the rules every signal follows ----------------------------------------------------------------------------------

test('every fix sentence is at most 160 characters and follows the wording rules', () => {
  for (const [name, fix] of Object.entries(FIXES)) {
    assert.ok(Array.from(fix).length <= 160, `${name}: ${Array.from(fix).length}`);
    assert.equal(/guarantee|yellow pages|\bYP\b|\$\d|will (name|recommend|mention|show)|make (?:an? )?AI (?:assistant )?name/i.test(fix), false, name);
  }
});

test('every status is one of four, every red or amber signal has a fix, every gray one has a reason, and the words are plain', () => {
  const scenarios = [
    build(),
    build({ places: null, bing: null, facts: null, sitemap: null }),
    build({ places: { status: 'not_found' }, bing: { status: 'not_found' }, sitemap: { status: 404, text: '' }, facts: readPageFacts('<p>hello</p>') }),
    build({ places: found({ ratingCount: 0, rating: 3, businessStatus: 'CLOSED_PERMANENTLY', phone: '(615) 555-0100', primaryType: 'bakery', hasHours: false, hoursByDay: {} }) }),
  ];
  for (const s of scenarios) {
    for (const [path, v] of allSignals(s)) {
      assert.ok(STATUSES.has(v.status), path);
      if (v.status === 'partly' && path !== 'listing.founding') assert.ok(v.fix && v.fix.length <= 160, `${path} has a fix`);
      if (v.status === 'missing') assert.ok(v.fix && v.fix.length <= 160, `${path} has a fix`);
      if (v.status === 'not_checked') {
        assert.equal(v.label, 'Not checked', path);
        assert.ok(typeof v.reason === 'string' && v.reason.length > 0, `${path} has a reason`);
      } else assert.equal(v.label === 'Not checked', false, path);
      assert.equal(/guarantee|yellow pages|\bYP\b|\$\d/i.test(JSON.stringify(v)), false, path);
    }
  }
});

test('nothing throws, whatever it is given: odd inputs give gray signals, never a crash', () => {
  assert.doesNotThrow(() => buildSignals());
  assert.doesNotThrow(() => buildSignals({}));
  assert.doesNotThrow(() => buildSignals({ input: null, facts: 'x', found: 5, sitemap: { status: 'x' }, places: 7, bing: [] }));
  const s = buildSignals({ input: {}, facts: { text: 5, links: 'no', headings: 7 }, found: null, places: { status: 'found' }, now: NOW });
  for (const [path, v] of allSignals(s)) assert.ok(STATUSES.has(v.status), path);
  fc.assert(fc.property(
    fc.record({
      facts: fc.oneof(fc.constant(null), fc.constant({}), fc.record({ text: fc.string(), links: fc.array(fc.record({ href: fc.string(), text: fc.string() })), scriptBuilt: fc.boolean(), faq: fc.boolean() })),
      places: fc.oneof(fc.constant(null), fc.constantFrom('off', 'limit', 'error', 'unsure', 'not_found').map(status => ({ status, reason: 'x' }))),
      sitemap: fc.oneof(fc.constant(null), fc.record({ status: fc.integer({ min: 0, max: 600 }), text: fc.string() })),
    }),
    args => {
      const out = buildSignals({ input: INPUT, found: FOUND, now: NOW, ...args });
      for (const [path, v] of allSignals(out)) {
        assert.ok(STATUSES.has(v.status), path);
        // A lookup that could not answer is never red for Google.
        if (path.startsWith('google.') && args.places && ['off', 'limit', 'error', 'unsure'].includes(args.places.status)) {
          assert.equal(v.status, 'not_checked', path);
        }
      }
    },
  ), { numRuns: 60 });
});

// ---- checklist coverage (Requirement 7) ------------------------------------------------------------------------------

test('every ADD and KEY item of the checklist has a row in the list; the HAVE items built here do too', async () => {
  const text = await fs.readFile(fileURLToPath(new URL('../.kiro/specs/high-tech-look/healthy-setup-checklist.md', import.meta.url)), 'utf8');
  const items = [...text.matchAll(/^\|\s*([A-G]\d)\s*\|.*\|\s*(HAVE|ADD|KEY|LATER)\s*\|\s*$/gm)].map(m => ({ id: m[1], kind: m[2] }));
  assert.ok(items.length >= 40, `read the checklist (${items.length} items)`);
  const covered = new Set(SIGNAL_ROWS.map(r => r.checklist));
  covered.add('B5'); // B5 and F2 are one fact, shown once as F2
  for (const { id, kind } of items) {
    if (kind === 'ADD' || kind === 'KEY') assert.ok(covered.has(id), `${id} (${kind}) has a row`);
    if (kind === 'LATER') assert.equal(SIGNAL_ROWS.some(r => r.checklist === id), false, `${id} is not shown`);
  }
  assert.ok(items.some(i => i.id === 'A6' && i.kind === 'KEY'));
});

test('the rows come in the design\'s order, each once, with where they sit, and "Not checked" for KEY items without a key', () => {
  const rows = signalRows(build({ places: null, bing: null }));
  assert.equal(rows.length, SIGNAL_ROWS.length - 1, 'the Founding Member row is left out when it has nothing true to say');
  assert.deepEqual(rows.map(r => r.path), SIGNAL_ROWS.map(r => r.path).filter(p => p !== 'listing.founding'));
  assert.equal(new Set(rows.map(r => r.path)).size, rows.length);
  for (const row of rows.filter(r => r.kind === 'KEY')) {
    assert.equal(row.status, 'not_checked', `${row.checklist} reads Not checked without a key`);
    assert.equal(row.label, 'Not checked');
    assert.ok(row.reason);
  }
  const keyed = signalRows(build());
  for (const row of keyed.filter(r => r.kind === 'KEY')) assert.notEqual(row.status, 'not_checked', `${row.checklist} reads its answer with a key`);
  assert.equal(rows.find(r => r.checklist === 'E2').main, 'website');
  assert.equal(rows.find(r => r.checklist === 'A6').main, 'details');
  assert.equal(rows.find(r => r.path === 'links.facebook').cluster, 'Socials');
});

test('a Grade saved before these signals existed reads "Not checked" with a reason on every row, never red', () => {
  for (const old of [undefined, null]) {
    const rows = signalRows(old);
    assert.ok(rows.length > 20);
    for (const row of rows) {
      assert.equal(row.status, 'not_checked', row.path);
      assert.match(row.reason, /Run a new check/);
    }
  }
});
