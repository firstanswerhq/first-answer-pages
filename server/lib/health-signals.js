/**
 * health-signals.js: the new honest signals for the health map (high-tech-look Requirements 3, 7 and 8, and the
 * healthy-setup checklist). `buildSignals` takes what the check already has (the home page facts, robots.txt, the
 * sitemap, the one Google lookup, the one Bing lookup, the listing) and returns one object that is saved with the Grade.
 *
 * Rules that every signal follows:
 *  - A status is 'good' (green), 'partly' (amber), 'missing' (red) or 'not_checked' (gray). The `label` always says it.
 *  - Never a false red: when a signal cannot be sure, it is 'not_checked' with a one-line `reason`, never 'missing'.
 *    'missing' is only for when the check looked and it is truly not there.
 *  - A fix sentence (`fix`) is added to every 'partly' and 'missing' signal, at most 160 characters, with no promise
 *    that anything makes an AI assistant name the business.
 *  - Nothing here changes the score.
 *  - Nothing here throws: a signal that fails to work out is 'not_checked'.
 */

import { registeredDomain } from './name-match.js';
import { parseHoursRange } from './schema.js';
import { detectProfileLinks } from './profile-links.js';
import { parseSitemap, isGzipSitemap } from './sitemap-read.js';
import {
  comparePhone, phoneDigits, phonesInText, compareNames, compareAddresses, addressInText, compareHours, nameTokens,
} from './health-compare.js';
import {
  REVIEW_COUNT_GREEN, RATING_GREEN, RATING_AMBER, NEWEST_REVIEW_DAYS, UPDATED_WITHIN_DAYS, SERVICE_PAGES_GREEN,
  GOOGLE_OPEN, GOOGLE_CLOSED,
} from './health-constants.js';

// ---- the words -----------------------------------------------------------------------------------------------------

export const NOT_CHECKED = 'Not checked';
const REASONS = Object.freeze({
  noWebsite: 'No website given.',
  unreadable: "We couldn't read your home page.",
  script: "Your page loads its words in a way this check can't read yet.",
  failed: "We couldn't work this one out this time.",
  oldReport: 'This report was made before this check existed. Run a new check to see it.',
  noGoogleKey: "Google lookups aren't turned on here.",
  noBingKey: "Bing lookups aren't turned on here.",
  noListing: 'No listing yet.',
  staleGoogle: 'Run a new check to look on Google again.',
  staleBing: 'Run a new check to look on Bing again.',
  reserve: "We kept today's last lookups for new checks, so we didn't look this up.",
  limit: "Today's limit for AI questions was reached, so we didn't look this up.",
});

/** Reasons the grader passes in (as `{ status: 'off', reason }` or `{ status: 'limit', reason }`). */
export const OLD_REPORT_REASON = REASONS.oldReport;
export const STALE_GOOGLE_REASON = REASONS.staleGoogle;
export const STALE_BING_REASON = REASONS.staleBing;
export const LOOKUP_RESERVE_REASON = REASONS.reserve;
export const LOOKUP_LIMIT_REASON = REASONS.limit;

/** The labels that carry a threshold, built from health-constants.js so they always say the real number. */
export const LABELS = Object.freeze({
  reviewsGreen: `${REVIEW_COUNT_GREEN} or more reviews`,
  reviewsAmber: REVIEW_COUNT_GREEN - 1 > 1 ? `1 to ${REVIEW_COUNT_GREEN - 1} reviews` : '1 review',
  ratingGreen: `${RATING_GREEN.toFixed(1)} or higher`,
  ratingAmber: `${RATING_AMBER.toFixed(1)} to ${(Math.round((RATING_GREEN - 0.1) * 10) / 10).toFixed(1)}`,
  ratingRed: `Below ${RATING_AMBER.toFixed(1)}`,
  newestGreen: `Newest review within ${NEWEST_REVIEW_DAYS} days`,
  newestAmber: `Newest review is older than ${NEWEST_REVIEW_DAYS} days`,
});

/** The fix sentences, each at most 160 characters. No promise that anything makes an AI assistant name a business. */
export const FIXES = Object.freeze({
  sitemap: 'Add a sitemap so search engines and AI tools can find all your pages. Most website builders can make one for you.',
  wordsInPage: 'Type your business name and phone number into the page itself, not only through scripts, so every tool can read them.',
  saysWhatYouDo: 'Say plainly on your home page what you do, in the words customers use, like "emergency plumber" or "roof repair".',
  saysWhereYouWork: 'Say which city and nearby areas you serve in the text of your home page.',
  answersQuestions: 'Add a short questions-and-answers section that answers what customers ask, like your prices, hours and the areas you serve.',
  pagePerService: 'Give each main service its own page with a plain description, so people and AI tools can find the exact thing you do.',
  recentlyUpdated: 'Update your website now and then and keep your sitemap dates current, so people and AI tools can tell it is looked after.',
  googleFound: 'Add or claim your free Google Business Profile so your name, phone number and hours show on Google.',
  googleOpen: 'Your Google profile says you are closed. If that is wrong, fix the status in your Google Business Profile.',
  googleCategory: 'Check the main category on your Google profile and pick the one that best matches what you do.',
  googleHours: 'Add your opening hours to your Google Business Profile so customers can see them.',
  reviewCount: 'Ask happy customers to leave a Google review. Real reviews help people trust you.',
  rating: 'Read your lower-rated Google reviews and reply politely. Fix what you can.',
  newestReview: 'Ask recent customers for a Google review, so people see that you are busy now.',
  phoneMatch: 'Use the same phone number on your website and on your Google profile.',
  addressMatch: 'Write the same street address, the same way, on your website and on your Google profile.',
  nameMatch: 'Use your business name the same way on your website and on your Google profile.',
  hoursMatch: 'Make your opening hours the same on your website and on your Google profile.',
  googleLinksToWebsite: 'Add your website address to your Google Business Profile so people can go from Google to your site.',
  bingFound: 'Check that your business is on Bing Places, so it shows on Bing Maps. Add it there if it is not.',
  bingDetails: 'Use the same name, phone number and address on Bing as on your website.',
  linkGoogle: 'Add a link to your Google profile on your website so people and AI can connect the two.',
  linkYelp: 'Add a link to your Yelp page on your website so people and AI can connect the two.',
  linkFacebook: 'Add a link to your Facebook page on your website so people and AI can connect the two.',
  linkInstagram: 'Add a link to your Instagram page on your website so customers can find and trust you.',
  linkTikTok: 'Add a link to your TikTok page on your website so customers can find and trust you.',
  listed: 'Claim your free listing on First Answer Pages so there is one plain page with your details.',
  verified: 'Verify your listing with a phone code and a photo ID so customers know it is really you.',
  listingMatches: 'Make the phone number and address on your listing the same as on your website.',
  listingWebsite: 'Add your website address to your listing so people can go from the directory to your site.',
});

const sig = (id, status, label, extra = {}) => ({ id, status, label, ...extra });
const good = (id, label, extra) => sig(id, 'good', label, extra);
const partly = (id, label, fix, extra) => sig(id, 'partly', label, { fix, ...extra });
const missing = (id, label, fix, extra) => sig(id, 'missing', label, { fix, ...extra });
const unknown = (id, reason) => sig(id, 'not_checked', NOT_CHECKED, { reason });

// ---- small text helpers --------------------------------------------------------------------------------------------

const norm = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

// Words in a typed service that say nothing about what the business does (the same list the title check uses).
const FILLER = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'in', 'on', 'to', 'by', 'at', 'or', 'with',
  'service', 'services', 'company', 'companies', 'co', 'inc', 'llc', 'near', 'me',
]);

/** The words of a typed service that mean something. */
export function serviceWords(service) {
  return norm(service).split(' ').filter(w => w.length >= 2 && !FILLER.has(w));
}

/** The front of a word without its ending: roofers and roofing are both "roof". */
function stem(word) {
  const w = word.toLowerCase();
  for (const end of ['ers', 'ing', 'er', 'es', 's']) {
    if (w.endsWith(end) && w.length - end.length >= 4) return w.slice(0, -end.length);
  }
  return w;
}

/** True when any word of `service` is in `text` (a whole word, its plural or singular, or a word of the same stem). */
export function textHasService(text, service) {
  const words = serviceWords(service);
  if (words.length === 0) return false;
  const textWords = norm(text).split(' ').filter(Boolean);
  const set = new Set(textWords);
  return words.some(w => {
    if (set.has(w) || set.has(`${w}s`) || (w.length > 3 && w.endsWith('s') && set.has(w.slice(0, -1)))) return true;
    const s = stem(w);
    return s.length >= 4 && textWords.some(t => t.startsWith(s));
  });
}

const wholePhrase = (text, phrase) => {
  const p = norm(phrase);
  return p !== '' && ` ${norm(text)} `.includes(` ${p} `);
};

// ---- the website ---------------------------------------------------------------------------------------------------

/**
 * Sitemap (Requirement 3.9). `sitemap` is what the grader got back for the one request, or null when none was made.
 * 'good' (Found) when the reply is real XML with at least one entry; 'missing' (Not found) when the site answered "no
 * such page" or something that is not a sitemap; 'not_checked' when the site would not let us look.
 */
export function sitemapSignal({ hasSite, sitemap }) {
  if (!hasSite) return unknown('sitemap', REASONS.noWebsite);
  if (!sitemap) return unknown('sitemap', "We couldn't look for a sitemap this time.");
  const { status } = sitemap;
  if (sitemap.error || !Number.isInteger(status) || status === 0) return unknown('sitemap', "We couldn't reach your sitemap this time.");
  if ([401, 403, 429].includes(status) || status >= 500) return unknown('sitemap', "Your website didn't let us look for a sitemap this time.");
  if (status >= 200 && status < 300) {
    // Read as XML first: a ".xml.gz" the fetcher already unpacked is plain XML (review T9).
    const info = parseSitemap(sitemap.text);
    if (info.isXml && info.entries > 0) return good('sitemap', 'Found', { url: sitemap.url ?? null });
    // A compressed sitemap (".xml.gz") the site serves is a sitemap; it is not unpacked here, but it is never red.
    if (!info.isXml && isGzipSitemap(sitemap)) return good('sitemap', 'Found', { url: sitemap.url ?? null, gzip: true });
    return missing('sitemap', 'Not found', FIXES.sitemap);
  }
  if (status === 404 || status === 410) return missing('sitemap', 'Not found', FIXES.sitemap);
  return unknown('sitemap', "We couldn't read your sitemap this time.");
}

function wordsInPageSignal({ input, facts, found }) {
  if (!input.website) return unknown('wordsInPage', REASONS.noWebsite);
  if (!facts) return unknown('wordsInPage', REASONS.unreadable);
  const text = String(facts.text ?? '');
  // Both sides lose "and", "&", "the", "LLC" and the like the same way, so "Smith & Sons" matches "Smith and Sons LLC".
  const nameTokensList = nameTokens(input.name);
  const nameIn = nameTokensList.length > 0
    && ` ${nameTokens(text.slice(0, 200000)).join(' ')} `.includes(` ${nameTokensList.join(' ')} `);
  const phone = phoneDigits(found?.phone);
  const phoneIn = phone ? phonesInText(text, facts.telLinks).has(phone) : phonesInText(text, facts.telLinks).size > 0;
  if (nameIn && phoneIn && !facts.scriptBuilt) return good('wordsInPage', 'Found in the page');
  // Never red: a page built by scripts cannot be told apart from a page that is missing the words.
  return partly('wordsInPage', 'Not found in the page code', FIXES.wordsInPage, {
    reason: "Your name and phone weren't in the page's own text. Some AI tools can't read text added by scripts.",
  });
}

/** True when the page links to a questions page ("/faq", "FAQs", "Common questions"). */
function linksToQuestions(links) {
  if (!Array.isArray(links)) return false;
  // "Questions? Call us" pointing at /contact is not a questions page (review T8).
  return links.some(l => l && /\bfaqs?\b|(?:common|frequently asked)\s+questions|\/questions\b/i.test(`${l.href ?? ''} ${l.text ?? ''}`));
}

function textSignal(id, ok, fix, { input, facts }) {
  if (!input.website) return unknown(id, REASONS.noWebsite);
  if (!facts) return unknown(id, REASONS.unreadable);
  if (facts.scriptBuilt) return unknown(id, REASONS.script);
  return ok() ? good(id, 'Found') : missing(id, 'Not found', fix);
}

/** The internal pages a site shows, from its sitemap and its links: { path, text }. */
function internalPages({ input, facts, sitemapInfo }) {
  const pages = [];
  let base;
  try {
    base = new URL(input.website);
  } catch {
    return pages;
  }
  const domain = registeredDomain(base.href);
  const add = (href, text) => {
    try {
      const url = new URL(href, base);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      if (registeredDomain(url.href) !== domain) return;
      pages.push({ path: url.pathname.replace(/\/+$/, '') || '/', text });
    } catch { /* not an address */ }
  };
  // A sitemap index lists other sitemaps, not pages, so its addresses are not counted as pages.
  if (!sitemapInfo?.isIndex) for (const loc of sitemapInfo?.locs ?? []) add(loc, '');
  for (const link of facts?.links ?? []) add(link.href, link.text ?? '');
  return pages;
}

function pagePerServiceSignal({ input, facts, sitemapInfo }) {
  if (!input.website) return unknown('pagePerService', REASONS.noWebsite);
  if (!facts) return unknown('pagePerService', REASONS.unreadable);
  const pages = internalPages({ input, facts, sitemapInfo });
  const indexReason = "Your sitemap lists other sitemaps, so we couldn't count your pages.";
  if (pages.length === 0) {
    return unknown('pagePerService', sitemapInfo?.isIndex ? indexReason : "We couldn't see enough of your website to tell.");
  }
  const servicePaths = new Set();
  for (const page of pages) {
    if (page.path === '/') continue;
    if (textHasService(`${page.path.replace(/[-_/]+/g, ' ')} ${page.text}`, input.service)) servicePaths.add(page.path.toLowerCase());
  }
  if (servicePaths.size >= SERVICE_PAGES_GREEN) return good('pagePerService', 'Several service pages', { count: servicePaths.size });
  // The pages behind a sitemap index were not seen, so "none found" from the links alone is not sure.
  if (sitemapInfo?.isIndex && servicePaths.size === 0) return unknown('pagePerService', indexReason);
  return servicePaths.size === 1
    ? partly('pagePerService', 'One page only', FIXES.pagePerService, { count: 1 })
    : partly('pagePerService', 'No separate service pages found', FIXES.pagePerService, { count: 0 });
}

function recentlyUpdatedSignal({ input, sitemapInfo, now }) {
  if (!input.website) return unknown('recentlyUpdated', REASONS.noWebsite);
  if (sitemapInfo?.gzip) return unknown('recentlyUpdated', "Your sitemap is compressed, so we couldn't read its dates.");
  if (!sitemapInfo || !sitemapInfo.isXml || sitemapInfo.entries === 0) return unknown('recentlyUpdated', 'No sitemap, so no dates to read.');
  if (sitemapInfo.lastmods.length === 0) return unknown('recentlyUpdated', 'Your sitemap has no dates.');
  const newest = Math.max(...sitemapInfo.lastmods);
  const days = (now - newest) / 86400000;
  return days <= UPDATED_WITHIN_DAYS
    ? good('recentlyUpdated', 'Updated in the last 12 months', { newest: new Date(newest).toISOString() })
    : partly('recentlyUpdated', 'Not updated in a year', FIXES.recentlyUpdated, { newest: new Date(newest).toISOString() });
}

// ---- Google --------------------------------------------------------------------------------------------------------

/** Why a lookup gave nothing to read, in one line. */
function lookupReason(result, offReason) {
  // The grader says why a lookup was off or held back (no key, an old report, the reserve, the daily limit).
  if (!result || result.status === 'off') return result?.reason || offReason;
  if (result.status === 'limit') return result.reason || REASONS.limit;
  if (result.status === 'not_found') return 'No profile was found to read.';
  return result.reason || REASONS.failed;
}

const wordsOf = type => String(type ?? '').split('_').filter(Boolean);

/** The main Google category fits when a word of it is a word of what the business does (roofing and roofers fit). */
function categoryFits(primaryType, service) {
  const types = wordsOf(primaryType).filter(w => !['store', 'service', 'services', 'shop', 'contractor', 'company'].includes(w));
  const words = serviceWords(service);
  if (types.length === 0 || words.length === 0) return null;
  return types.some(t => words.some(w => stem(t) === stem(w) || w === t || `${w}s` === t || `${t}s` === w));
}

/** The website's hours as { monday: { opens, closes } } from the saved day-by-day text. */
function websiteHoursByDay(websiteHours) {
  const out = {};
  for (const [day, value] of Object.entries(websiteHours ?? {})) {
    const range = parseHoursRange(value);
    if (range) out[day] = range;
  }
  return out;
}

/** True when the words of `name` (without "and", "the", "LLC" and the like) are written together in the page text. */
function nameInText(name, text) {
  const wanted = nameTokens(name).join(' ');
  return wanted !== '' && ` ${nameTokens(String(text ?? '').slice(0, 200000)).join(' ')} `.includes(` ${wanted} `);
}

/**
 * "Name matches Google" (A3, review T2). The website's name is its own business label (schema) when it has one, never
 * the name typed on the form. Google's name written in the page counts as a match. Without a label, the typed name is
 * used only when the page shows it, and a clear difference is then gray, not red: red only when the site's own label
 * differs from Google's.
 */
function nameMatchSignal({ input, facts, p }) {
  if (!facts) return unknown('nameMatch', input.website ? REASONS.unreadable : REASONS.noWebsite);
  if (nameInText(p.name, facts.text)) return good('nameMatch', 'Matches');
  const label = typeof facts.jsonLd?.business?.name === 'string' ? facts.jsonLd.business.name.trim() : '';
  const notFound = "We couldn't find your business name written on your website.";
  let siteName = label;
  if (!siteName) {
    if (!nameInText(input.name, facts.text)) return unknown('nameMatch', notFound);
    siteName = input.name;
  }
  const nm = compareNames(siteName, p.name);
  if (nm === 'unknown') return unknown('nameMatch', "We couldn't read a business name on both sides.");
  if (nm === 'match') return good('nameMatch', 'Matches');
  if (nm === 'close') return partly('nameMatch', 'Close, not the same', FIXES.nameMatch, { website: siteName, google: p.name });
  if (!label) return unknown('nameMatch', notFound);
  return missing('nameMatch', "Doesn't match", FIXES.nameMatch, { website: siteName, google: p.name });
}

function googleSignals({ input, facts, found, places, websiteHours, now }) {
  const ids = ['found', 'open', 'category', 'hours', 'reviewCount', 'rating', 'newestReview', 'phoneMatch', 'addressMatch', 'nameMatch', 'hoursMatch', 'linksToWebsite'];
  const out = {};
  const base = place => place;
  const allUnknown = reason => { for (const id of ids) out[id] = unknown(id, reason); return out; };

  if (!places || places.status === 'off') return allUnknown(lookupReason(places, REASONS.noGoogleKey));
  if (places.status !== 'found' || !places.place) {
    if (places.status === 'not_found') {
      out.found = missing('found', 'Not found on Google', FIXES.googleFound);
      for (const id of ids.slice(1)) out[id] = unknown(id, 'No Google profile was found to read.');
      return out;
    }
    return allUnknown(lookupReason(places, REASONS.noGoogleKey));
  }
  const p = base(places.place);
  out.found = good('found', 'Found on Google');

  if (GOOGLE_CLOSED.has(p.businessStatus)) out.open = missing('open', 'Marked closed', FIXES.googleOpen);
  else if (p.businessStatus === GOOGLE_OPEN) out.open = good('open', 'Open');
  else out.open = unknown('open', "Google didn't say whether you are open.");

  const fits = categoryFits(p.primaryType, input.service);
  out.category = fits === null ? unknown('category', "Google didn't give a category to compare.")
    : fits ? good('category', 'Category fits') : partly('category', 'Category differs', FIXES.googleCategory);

  out.hours = p.hasHours ? good('hours', 'Hours listed') : missing('hours', 'No hours listed', FIXES.googleHours);

  const count = Number.isInteger(p.ratingCount) ? p.ratingCount : 0;
  if (count >= REVIEW_COUNT_GREEN) out.reviewCount = good('reviewCount', LABELS.reviewsGreen, { count });
  else if (count >= 1) out.reviewCount = partly('reviewCount', LABELS.reviewsAmber, FIXES.reviewCount, { count });
  else out.reviewCount = missing('reviewCount', 'No reviews', FIXES.reviewCount, { count: 0 });

  if (!Number.isFinite(p.rating)) out.rating = unknown('rating', 'Google shows no star rating yet.');
  else if (p.rating >= RATING_GREEN) out.rating = good('rating', LABELS.ratingGreen, { rating: p.rating });
  else if (p.rating >= RATING_AMBER) out.rating = partly('rating', LABELS.ratingAmber, FIXES.rating, { rating: p.rating });
  else out.rating = missing('rating', LABELS.ratingRed, FIXES.rating, { rating: p.rating });

  const newest = Date.parse(p.newestReviewAt ?? '');
  if (!Number.isFinite(newest)) out.newestReview = unknown('newestReview', 'Google gave no review dates to read.');
  else if ((now - newest) / 86400000 <= NEWEST_REVIEW_DAYS) out.newestReview = good('newestReview', LABELS.newestGreen, { newest: p.newestReviewAt });
  else {
    out.newestReview = partly('newestReview', LABELS.newestAmber, FIXES.newestReview, {
      newest: p.newestReviewAt, reason: 'Based on the reviews Google returned (up to 5).',
    });
  }

  // -- details match: the website against Google
  const sitePhone = found?.phone ?? '';
  if (!phoneDigits(sitePhone)) out.phoneMatch = unknown('phoneMatch', 'We found no phone number on your website.');
  else if (!phoneDigits(p.phone)) out.phoneMatch = unknown('phoneMatch', 'Google lists no phone number.');
  else if (comparePhone(sitePhone, p.phone) === 'match' || phonesInText(facts?.text, facts?.telLinks).has(phoneDigits(p.phone))) {
    out.phoneMatch = good('phoneMatch', 'Matches');
  } else {
    out.phoneMatch = missing('phoneMatch', "Doesn't match", FIXES.phoneMatch, { website: sitePhone, google: p.phone });
  }

  const siteAddress = found?.address ?? '';
  let addr = compareAddresses(siteAddress, p.address);
  if (addr === 'differ' && addressInText(p.address, facts?.text)) addr = 'match';
  if (addr === 'unknown') out.addressMatch = unknown('addressMatch', "We couldn't read a street address on both sides.");
  else if (addr === 'match') out.addressMatch = good('addressMatch', 'Matches');
  else if (addr === 'close') out.addressMatch = partly('addressMatch', 'Close, not the same', FIXES.addressMatch, { website: siteAddress, google: p.address });
  else out.addressMatch = missing('addressMatch', "Doesn't match", FIXES.addressMatch, { website: siteAddress, google: p.address });

  out.nameMatch = nameMatchSignal({ input, facts, p });

  const siteHours = websiteHoursByDay(websiteHours);
  if (Object.keys(siteHours).length === 0) out.hoursMatch = unknown('hoursMatch', 'We found no hours we can read on your website.');
  else if (!p.hasHours) out.hoursMatch = unknown('hoursMatch', 'Google lists no hours.');
  else {
    const h = compareHours(siteHours, p.hoursByDay ?? {});
    if (h.result === 'unknown') out.hoursMatch = unknown('hoursMatch', "The hours couldn't be compared day by day.");
    else if (h.result === 'match') out.hoursMatch = good('hoursMatch', 'Match', { compared: h.compared });
    else if (h.result === 'some') out.hoursMatch = partly('hoursMatch', 'Some days differ', FIXES.hoursMatch, { compared: h.compared, differing: h.differing });
    else out.hoursMatch = missing('hoursMatch', "Don't match", FIXES.hoursMatch, { compared: h.compared, differing: h.differing });
  }

  // -- the Google profile links to the website (F2 and B5, one signal)
  if (!input.website) out.linksToWebsite = unknown('linksToWebsite', REASONS.noWebsite);
  else {
    const same = p.website !== '' && registeredDomain(p.website) !== null && registeredDomain(p.website) === registeredDomain(input.website);
    out.linksToWebsite = same ? good('linksToWebsite', 'Links to your website')
      : partly('linksToWebsite', "Doesn't link to your website", FIXES.googleLinksToWebsite);
  }
  return out;
}

// ---- Bing ----------------------------------------------------------------------------------------------------------

function bingSignals({ input, found, bing }) {
  // Azure Maps data is not Bing Places itself: small businesses are often missing from it or out of date there even
  // when their Bing Places listing is fine. So nothing about Bing is ever red; amber at most.
  if (!bing || bing.status === 'off') {
    const reason = lookupReason(bing, REASONS.noBingKey);
    return { found: unknown('found', reason), details: unknown('details', reason) };
  }
  if (bing.status === 'not_found') {
    return {
      found: partly('found', 'Not found in Bing map data', FIXES.bingFound),
      details: unknown('details', 'No Bing listing was found to compare.'),
    };
  }
  if (bing.status !== 'found' || !bing.place) {
    const reason = lookupReason(bing, REASONS.noBingKey);
    return { found: unknown('found', reason), details: unknown('details', reason) };
  }
  const p = bing.place;
  const results = [];
  const phone = comparePhone(found?.phone, p.phone);
  if (phone !== 'unknown') results.push(phone);
  const address = compareAddresses(found?.address, p.address);
  if (address !== 'unknown') results.push(address);
  const name = compareNames(input.name, p.name);
  if (name !== 'unknown') results.push(name);
  let details;
  if (results.length === 0) details = unknown('details', "We couldn't compare anything with the Bing listing.");
  else if (results.includes('differ')) details = partly('details', "Don't match", FIXES.bingDetails);
  else if (results.includes('close')) details = partly('details', 'Close, not the same', FIXES.bingDetails);
  else details = good('details', 'Match');
  return { found: good('found', 'Found on Bing'), details };
}

// ---- links between profiles ----------------------------------------------------------------------------------------

function linkSignals({ input, facts }) {
  const reason = !input.website ? REASONS.noWebsite : (!facts ? REASONS.unreadable : null);
  const ids = ['google', 'yelp', 'facebook', 'instagram', 'tiktok'];
  const fixes = { google: FIXES.linkGoogle, yelp: FIXES.linkYelp, facebook: FIXES.linkFacebook, instagram: FIXES.linkInstagram, tiktok: FIXES.linkTikTok };
  const out = {};
  if (reason) {
    for (const id of ids) out[id] = unknown(id, reason);
    out.socials = unknown('socials', reason);
    return out;
  }
  const links = detectProfileLinks(facts.links);
  // On a page built by scripts the social links are usually added by the scripts, so "none of the three found" can't
  // be trusted: the three and the Socials cluster are gray. Google and Yelp are read as usual (review T7).
  const socialIds = ['facebook', 'instagram', 'tiktok'];
  if (facts.scriptBuilt && socialIds.every(id => !links[id])) {
    for (const id of ids) {
      out[id] = socialIds.includes(id) ? unknown(id, REASONS.script)
        : links[id] ? good(id, 'Linked from your website', { url: links[id] }) : partly(id, 'Not linked', fixes[id]);
    }
    out.socials = unknown('socials', REASONS.script);
    return out;
  }
  for (const id of ids) {
    out[id] = links[id]
      ? good(id, 'Linked from your website', { url: links[id] })
      : partly(id, 'Not linked', fixes[id]);
  }
  const linked = ['facebook', 'instagram', 'tiktok'].filter(id => links[id]).length;
  const label = `${linked} of 3 linked`;
  out.socials = linked === 3 ? good('socials', label, { linked, of: 3 })
    : linked > 0 ? partly('socials', label, FIXES.linkFacebook, { linked, of: 3 })
      : missing('socials', label, FIXES.linkFacebook, { linked, of: 3 });
  return out;
}

// ---- the free listing ----------------------------------------------------------------------------------------------

function listingSignals({ found, listingInfo, input }) {
  const info = listingInfo && typeof listingInfo === 'object' ? listingInfo : {};
  const out = {};
  const listing = info.listing ?? null;
  if (info.state === 'unsure') {
    const reason = "More than one listing looked like yours, so we didn't pick one.";
    out.listed = unknown('listed', reason);
    out.verified = unknown('verified', reason);
    out.matchesWebsite = unknown('matchesWebsite', reason);
    out.linksToWebsite = unknown('linksToWebsite', reason);
  } else if (!listing) {
    out.listed = partly('listed', 'Not listed yet', FIXES.listed, { needsClaim: true });
    out.verified = unknown('verified', REASONS.noListing);
    out.matchesWebsite = unknown('matchesWebsite', REASONS.noListing);
    out.linksToWebsite = unknown('linksToWebsite', REASONS.noListing);
  } else {
    out.listed = good('listed', 'Listed', { listingId: listing.id });
    out.verified = info.verified === true ? good('verified', 'Verified') : partly('verified', 'Not verified yet', FIXES.verified);
    const results = [];
    const phone = comparePhone(found?.phone, listing.phone);
    if (phone !== 'unknown') results.push(phone);
    const address = compareAddresses(found?.address, listing.address);
    if (address !== 'unknown') results.push(address);
    if (results.length === 0) out.matchesWebsite = unknown('matchesWebsite', 'There is nothing to compare yet.');
    else if (results.every(r => r === 'match')) out.matchesWebsite = good('matchesWebsite', 'Matches');
    else out.matchesWebsite = partly('matchesWebsite', 'Differs', FIXES.listingMatches);
    out.linksToWebsite = listing.website ? good('linksToWebsite', 'Linked')
      : partly('linksToWebsite', 'No website on the listing', FIXES.listingWebsite);
  }
  // Founding Member: only when it says something true. Otherwise there is no sub-node at all.
  if (info.founder) out.founding = good('founding', 'Founding Member', { number: info.founder.number ?? null });
  else if (info.foundersOpen === true) out.founding = partly('founding', 'Founding spots still open', undefined);
  else out.founding = null;
  if (out.founding && !out.founding.fix) delete out.founding.fix;
  void input;
  return out;
}

// ---- all together --------------------------------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {{ website?: string, name: string, city: string, state?: string, service: string }} args.input
 * @param {object|null} args.facts        readPageFacts result for the home page, or null
 * @param {{ phone?: string, address?: string, hours?: string[] }} args.found
 * @param {{ status: number, text: string }|null} args.robots
 * @param {{ status: number, text: string, url?: string, error?: boolean }|null} args.sitemap
 * @param {object|null} args.places       the one Google lookup's result (places.js), or null
 * @param {object|null} args.bing         the one Bing lookup's result (azure-maps.js), or null
 * @param {object} args.listingInfo       { state: 'listed'|'none'|'unsure', listing, verified, founder, foundersOpen }
 * @param {Record<string, string>} args.websiteHours  the website's hours by day, as text ("monday": "8am-5pm")
 * @param {number} args.now               ms
 */
export function buildSignals(args = {}) {
  const input = args.input && typeof args.input === 'object' ? args.input : {};
  const now = Number.isFinite(args.now) ? args.now : Date.now();
  const ctx = { ...args, input, now };
  const out = { version: 1, checkedAt: new Date(now).toISOString() };
  const part = (name, fn, fallbackIds) => {
    try {
      out[name] = fn();
    } catch {
      out[name] = Object.fromEntries(fallbackIds.map(id => [id, unknown(id, REASONS.failed)]));
    }
  };

  let sitemapInfo = null;
  try {
    const ok = args.sitemap && args.sitemap.status >= 200 && args.sitemap.status < 300;
    // Read as XML first (review T9). A compressed sitemap that is not XML is not unpacked: it counts as found, but
    // its pages and dates are not read.
    sitemapInfo = ok ? parseSitemap(args.sitemap.text) : null;
    if (sitemapInfo && !sitemapInfo.isXml && isGzipSitemap(args.sitemap)) {
      sitemapInfo = { isXml: false, isIndex: false, entries: 0, locs: [], lastmods: [], gzip: true };
    }
  } catch {
    sitemapInfo = null;
  }
  const websiteIds = ['sitemap', 'wordsInPage', 'saysWhatYouDo', 'saysWhereYouWork', 'answersQuestions', 'pagePerService', 'recentlyUpdated'];
  part('website', () => ({
    sitemap: sitemapSignal({ hasSite: Boolean(input.website), sitemap: args.sitemap ?? null }),
    wordsInPage: wordsInPageSignal({ input, facts: args.facts ?? null, found: args.found }),
    saysWhatYouDo: textSignal('saysWhatYouDo', () => textHasService(args.facts.text, input.service), FIXES.saysWhatYouDo, { input, facts: args.facts ?? null }),
    saysWhereYouWork: textSignal('saysWhereYouWork', () => wholePhrase(args.facts.text, input.city), FIXES.saysWhereYouWork, { input, facts: args.facts ?? null }),
    answersQuestions: textSignal('answersQuestions', () => args.facts.faq === true || linksToQuestions(args.facts.links), FIXES.answersQuestions, { input, facts: args.facts ?? null }),
    pagePerService: pagePerServiceSignal({ input, facts: args.facts ?? null, sitemapInfo }),
    recentlyUpdated: recentlyUpdatedSignal({ input, sitemapInfo, now }),
  }), websiteIds);
  part('google', () => googleSignals({ input, facts: args.facts ?? null, found: args.found, places: args.places ?? null, websiteHours: args.websiteHours, now }),
    ['found', 'open', 'category', 'hours', 'reviewCount', 'rating', 'newestReview', 'phoneMatch', 'addressMatch', 'nameMatch', 'hoursMatch', 'linksToWebsite']);
  part('bing', () => bingSignals({ input, found: args.found, bing: args.bing ?? null }), ['found', 'details']);
  part('links', () => linkSignals({ input, facts: args.facts ?? null }), ['google', 'yelp', 'facebook', 'instagram', 'tiktok', 'socials']);
  part('listing', () => listingSignals({ found: args.found, listingInfo: args.listingInfo, input }), ['listed', 'verified', 'matchesWebsite', 'linksToWebsite']);
  void ctx;
  return out;
}

// ---- what may be saved ---------------------------------------------------------------------------------------------

/** The fields of a Google or Bing signal that hold values read from the lookup (Places content). */
const LOOKUP_VALUE_KEYS = ['google', 'bing', 'rating', 'count', 'newest'];

/**
 * A copy of the signals without any value read from Google or Bing (review T3): the other side of a mismatch, the star
 * rating, the review count and the newest review date. The status, label, reason, fix and the website's own values
 * stay. This is what is saved with a Grade; the lookups themselves are only kept in memory, for at most 30 days.
 */
export function withoutGoogleValues(signals) {
  if (!signals || typeof signals !== 'object') return signals ?? null;
  const out = structuredClone(signals);
  for (const group of ['google', 'bing']) {
    const entries = out[group];
    if (!entries || typeof entries !== 'object') continue;
    for (const s of Object.values(entries)) {
      if (!s || typeof s !== 'object') continue;
      for (const key of LOOKUP_VALUE_KEYS) delete s[key];
    }
  }
  return out;
}

// ---- the rows the health map and its text list will show -----------------------------------------------------------

/**
 * Every sub-node of the checklist that is built here (ADD, KEY, and the listing items), where it sits, and which
 * checklist item it is. The order is the order of the design's list. `path` is where the signal is in `buildSignals`.
 */
export const SIGNAL_ROWS = Object.freeze([
  { main: 'website', cluster: 'AI can read it', checklist: 'E2', kind: 'ADD', path: 'website.sitemap' },
  { main: 'website', cluster: 'AI can read it', checklist: 'E3', kind: 'ADD', path: 'website.wordsInPage' },
  { main: 'website', cluster: "Speaks AI's language", checklist: 'D1', kind: 'ADD', path: 'website.saysWhatYouDo' },
  { main: 'website', cluster: "Speaks AI's language", checklist: 'D2', kind: 'ADD', path: 'website.saysWhereYouWork' },
  { main: 'website', cluster: "Speaks AI's language", checklist: 'D3', kind: 'ADD', path: 'website.answersQuestions' },
  { main: 'website', cluster: "Speaks AI's language", checklist: 'D4', kind: 'ADD', path: 'website.pagePerService' },
  { main: 'website', cluster: "Speaks AI's language", checklist: 'D5', kind: 'ADD', path: 'website.recentlyUpdated' },
  { main: 'google', cluster: null, checklist: 'B1', kind: 'KEY', path: 'google.found' },
  { main: 'google', cluster: null, checklist: 'B2', kind: 'KEY', path: 'google.open' },
  { main: 'google', cluster: null, checklist: 'B3', kind: 'KEY', path: 'google.category' },
  { main: 'google', cluster: null, checklist: 'B4', kind: 'KEY', path: 'google.hours' },
  { main: 'reviews', cluster: null, checklist: 'C1', kind: 'KEY', path: 'google.reviewCount' },
  { main: 'reviews', cluster: null, checklist: 'C2', kind: 'KEY', path: 'google.rating' },
  { main: 'reviews', cluster: null, checklist: 'C3', kind: 'KEY', path: 'google.newestReview' },
  { main: 'details', cluster: null, checklist: 'A1', kind: 'KEY', path: 'google.phoneMatch' },
  { main: 'details', cluster: null, checklist: 'A2', kind: 'KEY', path: 'google.addressMatch' },
  { main: 'details', cluster: null, checklist: 'A3', kind: 'KEY', path: 'google.nameMatch' },
  { main: 'details', cluster: null, checklist: 'A4', kind: 'KEY', path: 'google.hoursMatch' },
  { main: 'details', cluster: null, checklist: 'A5', kind: 'ADD', path: 'listing.matchesWebsite' },
  { main: 'details', cluster: null, checklist: 'G2', kind: 'KEY', path: 'bing.found' },
  { main: 'details', cluster: null, checklist: 'A6', kind: 'KEY', path: 'bing.details' },
  { main: 'links', cluster: null, checklist: 'F1', kind: 'ADD', path: 'links.google' },
  { main: 'links', cluster: null, checklist: 'F3', kind: 'ADD', path: 'links.yelp' },
  { main: 'links', cluster: null, checklist: 'F2', kind: 'KEY', path: 'google.linksToWebsite' },
  { main: 'links', cluster: null, checklist: 'F5', kind: 'HAVE', path: 'listing.linksToWebsite' },
  { main: 'links', cluster: 'Socials', checklist: 'F4', kind: 'ADD', path: 'links.facebook' },
  { main: 'links', cluster: 'Socials', checklist: 'F4', kind: 'ADD', path: 'links.instagram' },
  { main: 'links', cluster: 'Socials', checklist: 'F4', kind: 'ADD', path: 'links.tiktok' },
  { main: 'listing', cluster: null, checklist: 'G1', kind: 'HAVE', path: 'listing.listed' },
  { main: 'listing', cluster: null, checklist: 'G1', kind: 'HAVE', path: 'listing.verified' },
  { main: 'listing', cluster: null, checklist: 'G1', kind: 'HAVE', path: 'listing.founding' },
]);

const pathValue = (signals, path) => path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), signals);

/**
 * The rows for one Grade's saved signals, in the design's order. A Grade saved before these signals existed has none:
 * every row reads "Not checked" with a reason (never red). The Founding Member row is left out when it has nothing
 * true to say.
 * @param {object|null|undefined} signals `grade.signals`
 */
export function signalRows(signals) {
  const rows = [];
  for (const def of SIGNAL_ROWS) {
    const id = def.path.split('.').pop();
    let signal = signals ? pathValue(signals, def.path) : undefined;
    if (def.path === 'listing.founding') {
      if (!signal) continue; // null: nothing true to say
    } else if (!signal) {
      signal = unknown(id, REASONS.oldReport);
    }
    rows.push({ ...signal, path: def.path, main: def.main, cluster: def.cluster, checklist: def.checklist, kind: def.kind });
  }
  return rows;
}
