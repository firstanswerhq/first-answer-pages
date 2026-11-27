/**
 * html.js — HTML template helpers (plain template literals, no engine)
 */

import { getCategories } from '../data.js';
import { DEFAULT_SITE_NAME } from './config.js';
import { formatFoundersDeadline } from './founders.js';
import { formatFee } from './trust.js';
import { reviewsLinkHost, normalizeWebsite } from './listing-fields.js';

/**
 * The listing's "Website" row: a link to the business's own site, with its host (no "www.") as the text. The
 * stored value is checked again (the same check as the JSON API), and nothing is shown when it fails.
 * @param {unknown} website
 * @returns {string}
 */
export function websiteRow(website) {
  const clean = normalizeWebsite(website);
  if (clean === '') return '';
  const host = new URL(clean).hostname.replace(/^www\./, '');
  return `\n    <dt>Website</dt>\n    <dd><a href="${escapeHtml(clean)}" rel="noopener noreferrer">${escapeHtml(host)}</a></dd>`;
}

/** How each review site is named in "See our reviews on …". */
const REVIEW_SITE_NAMES = Object.freeze({ google: 'Google', yelp: 'Yelp', facebook: 'Facebook', nextdoor: 'Nextdoor' });

/**
 * The listing's "Reviews" row: a link only, with no rating, count or review text. Empty when the stored link
 * does not pass the reviews-link check again (defense against hand-edited data).
 * @param {unknown} link
 * @returns {string}
 */
export function reviewsRow(link) {
  const site = reviewsLinkHost(link);
  if (site === '') return '';
  return `\n    <dt>Reviews</dt>\n    <dd><a href="${escapeHtml(link.trim())}" rel="noopener noreferrer">See our reviews on ${REVIEW_SITE_NAMES[site]}</a></dd>`;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * The days the owner actually filled in, Monday first, as [Day, text] pairs.
 * Keys match case-insensitively ('monday' or 'Monday'). A blank, missing or
 * whitespace-only day is left out: we never guess "Closed" for a day the owner
 * skipped. A day the owner typed "Closed" stays "Closed".
 * @param {object|undefined} hours
 * @returns {[string, string][]}
 */
export function filledHours(hours) {
  if (hours === null || typeof hours !== 'object') return [];
  const byDay = new Map(Object.entries(hours).map(([key, value]) => [String(key).toLowerCase(), value]));
  const out = [];
  for (const day of DAYS) {
    const value = byDay.get(day.toLowerCase());
    if (typeof value === 'string' && value.trim() !== '') out.push([day, tidyHoursText(value.trim())]);
  }
  return out;
}

/** A typed "closed" in any letter case reads "Closed"; other text is kept as typed. */
function tidyHoursText(text) {
  return /^closed\.?$/i.test(text) ? 'Closed' : text;
}

/** Shown when no day has hours, and for a skipped day when other days have hours. */
export const NO_HOURS_TEXT = 'Call for hours';

/**
 * Hours as shown to people on the listing page. No day filled: [] (the page
 * shows one "Call for hours"). Otherwise every day, Monday first, with a
 * skipped day shown as "Call for hours" (never a guessed "Closed").
 * @param {object|undefined} hours
 * @returns {[string, string][]}
 */
export function displayHours(hours) {
  const filled = new Map(filledHours(hours));
  if (filled.size === 0) return [];
  return DAYS.map(day => [day, filled.get(day) ?? NO_HOURS_TEXT]);
}

/** Marker in the footer; the app swaps it for the CONTACT_EMAIL line (or nothing). */
export const CONTACT_MARKER = '<!--site-contact-->';

/** Escapes text for safe use in HTML content and attributes. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders a phone number as a tappable tel: link. The href keeps only digits
 * and a leading '+'; the display text is the escaped original. With no digits,
 * returns just the escaped text.
 * @param {string} phone
 * @returns {string}
 */
export function telLink(phone) {
  const text = String(phone ?? '');
  const trimmed = text.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits === '') return escapeHtml(text);
  const href = (trimmed.startsWith('+') ? '+' : '') + digits;
  return `<a class="tel" href="tel:${href}">${escapeHtml(text)}</a>`;
}

/** Returns the display label for a category slug (falls back to the slug). */
function categoryLabel(slug, categories) {
  const list = Array.isArray(categories) ? categories : getCategories();
  return list.find(c => c.slug === slug)?.label ?? slug;
}

/**
 * Replaces every occurrence of the default site name in a finished HTML
 * string with the escaped custom name. Uses split/join so `$` in the name
 * is literal. Returns the input unchanged for the default (or empty) name.
 * @param {string} html
 * @param {string} siteName
 * @returns {string}
 */
export function applySiteName(html, siteName) {
  if (typeof siteName !== 'string' || siteName === '' || siteName === DEFAULT_SITE_NAME) return html;
  return html.split(DEFAULT_SITE_NAME).join(escapeHtml(siteName));
}

/**
 * One style for every tab title: "<page> | First Answer Pages" (V143). A page whose title already holds the
 * site name (the home page "First Answer Pages: Local Business Directory", "Plumbers in Nashville | First Answer
 * Pages") is left as it is; any other gets " | <site name>" added. Only the first <title> (the page's own) is read.
 * The default site name is used here and swapped for SITE_NAME later by applySiteName.
 * @param {string} html
 * @returns {string}
 */
export function applyTitleSuffix(html) {
  if (typeof html !== 'string') return html;
  return html.replace(/<title>([^<]*)<\/title>/, (whole, text) => (
    text.includes(DEFAULT_SITE_NAME) ? whole : `<title>${text} | ${DEFAULT_SITE_NAME}</title>`
  ));
}

export const DEMO_FOOTER_TEXT = 'Sample listings for demonstration';
const DEMO_META = '<meta name="robots" content="noindex">';
const DEMO_FOOTER_LINE = `<p class="demo-note">${DEMO_FOOTER_TEXT}</p>`;

/**
 * Adds the noindex meta and the sample-listings footer line to a finished
 * HTML page. Idempotent: a page that already has them is returned unchanged.
 * Used by the app for every HTML response when DEMO_MODE is on.
 * @param {string} html
 * @returns {string}
 */
export function markDemo(html) {
  let out = html;
  if (!out.includes(DEMO_META)) {
    out = out.replace('</head>', `  ${DEMO_META}\n</head>`);
  }
  if (!out.includes(DEMO_FOOTER_TEXT)) {
    out = out.includes('\n  </footer>')
      ? out.replace('\n  </footer>', `\n    ${DEMO_FOOTER_LINE}\n  </footer>`)
      : out.replace('</footer>', `${DEMO_FOOTER_LINE}</footer>`);
  }
  return out;
}

/**
 * Wraps page content in the full HTML shell (head, nav, footer).
 *
 * @param {{ title: string, body: string, jsonLd?: string, scripts?: string[], demo?: boolean,
 *   canonical?: string, description?: string, head?: string }} options
 *   `jsonLd` is an optional serialized JSON-LD string placed in the head.
 *   `scripts` is an optional list of module script URLs (deferred by default).
 *   `demo` (default false) adds the noindex meta and the sample-listings footer line.
 *   `canonical` (absolute URL) adds <link rel="canonical">; only public pages pass it.
 *   `description` adds <meta name="description">.
 *   `head` is optional trusted markup placed at the end of the head (default none).
 * @returns {string}
 */
export function layout({
  title, body, jsonLd, scripts, demo = false, siteName = DEFAULT_SITE_NAME, canonical, description, head = '', navCta = true,
}) {
  const page = renderLayout({ title, body, jsonLd, scripts, siteName, canonical, description, head, navCta });
  return demo ? markDemo(page) : page;
}

// `navCta: false` leaves out the header's "List your business free" button (an agency's report, high-tech-look batch 6
// fix B). Every other page keeps it, so public pages are unchanged.
function renderLayout({ title, body, jsonLd, scripts, siteName, canonical, description, head, navCta = true }) {
  const name = escapeHtml(siteName);
  const descTag = typeof description === 'string' && description.trim() !== ''
    ? `\n  <meta name="description" content="${escapeHtml(description.replace(/\s+/g, ' ').trim())}">`
    : '';
  const canonicalTag = typeof canonical === 'string' && /^https?:\/\//i.test(canonical)
    ? `\n  <link rel="canonical" href="${escapeHtml(canonical)}">`
    : '';
  const scriptTags = Array.isArray(scripts) && scripts.length > 0
    ? '\n' + scripts.map(src => `  <script type="module" src="${escapeHtml(src)}"></script>`).join('\n')
    : '';

  // Prevent "</script>" sequences in JSON from closing the script block early
  const ldBlock = jsonLd
    ? `\n  <script type="application/ld+json">\n${jsonLd.replace(/</g, '\\u003c')}\n  </script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>${descTag}${canonicalTag}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/style.css">${ldBlock}${scriptTags}${typeof head === 'string' && head !== '' ? `\n  ${head}` : ''}
</head>
<body>
  <nav class="site-nav">
    <a class="brand" href="/">${name}</a>
${navCta === false ? '' : '    <a class="nav-cta" href="/rise">List your business free</a>\n'}  </nav>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <p>${name}. A free local business directory.</p>
    <p><a href="/about">About</a> &middot; <a href="/privacy">Privacy</a>${CONTACT_MARKER}</p>
  </footer>
</body>
</html>
`;
}

/**
 * Founding Member badge, e.g. "Founding Member No. 12 of 500". Empty string
 * when the listing is not a founder.
 * @param {{ number: number, cap?: number }|null|undefined} founder
 * @returns {string}
 */
export function founderBadge(founder) {
  if (!founder || !Number.isInteger(founder.number) || founder.number <= 0) return '';
  const of = Number.isInteger(founder.cap) && founder.cap >= founder.number ? ` of ${founder.cap}` : '';
  return `<p class="founder-badge"><span class="founder-badge-title">Founding Member</span> <span class="founder-badge-number">No. ${founder.number}${of}</span></p>`;
}

/**
 * Paid Verified stamp. Empty string unless the listing is verified.
 * @param {{ verified?: boolean, verifiedAt?: string }|null|undefined} trust
 * @param {{ detail?: boolean }} [opts] detail: add what was checked and when
 * @returns {string}
 */
export function verifiedBadge(trust, opts) {
  if (!trust || trust.verified !== true) return '';
  if (opts?.detail !== true) return '<p class="verified-badge"><span class="verified-badge-title">Verified</span></p>';
  const day = formatStampDate({ verifiedAt: trust.verifiedAt });
  return `<p class="verified-badge"><span class="verified-badge-title">Verified</span> <span class="verified-badge-note">Business phone confirmed. Photo ID checked for the person who manages this listing${day ? `, ${escapeHtml(day)}` : ''}. <a href="/verified">What this means</a></span></p>`;
}

/**
 * Founding Member invite for owners, shown while spots are open. Empty string otherwise.
 * @param {{ cap: number, left: number, open: boolean, deadline: string }|null|undefined} status
 * @param {{ link?: boolean }} [opts] link: add a "Claim your spot" link to /rise
 * @returns {string}
 */
export function foundersInvite(status, opts) {
  if (!status || status.open !== true) return '';
  const day = formatFoundersDeadline(status.deadline);
  const left = status.left === 1 ? '1 spot left' : `${status.left} spots left`;
  const link = opts?.link === true ? '\n  <p class="founders-invite-link"><a href="/rise">Claim your spot &rarr;</a></p>' : '';
  const fees = opts?.fees;
  const deal = fees
    ? `\n  <p class="founders-invite-deal">Optional: the <a href="/verified">Verified stamp</a> shows customers we confirmed your business phone and checked a photo ID. Founding Members pay ${formatFee(fees.founderCents)} once, good for the life of the listing. Everyone else pays ${formatFee(fees.yearlyCents)} a year, with no automatic renewal.</p>`
    : '';
  return `<aside class="founders-invite">
  <p class="founders-invite-title">Founding Members</p>
  <p>Listing is free for everyone, always. The first ${status.cap} businesses that send in their listing by ${escapeHtml(day)} (Central time) and are approved become Founding Members and get a numbered badge for life. Spots go in the order listings are approved. <strong>${left}.</strong></p>${deal}${link}
</aside>`;
}

/**
 * Renders a compact listing card for the home page directory.
 *
 * @param {object} listing
 * @param {object[]} [categories]  defaults to the default store's categories
 *   (ignored when not an array, so it is safe to use with Array#map)
 * @returns {string}
 */
export function listingCard(listing, categories, opts) {
  const badge = [verifiedBadge(opts?.trust), founderBadge(opts?.founder)].filter(Boolean).join('\n  ');
  const fields = readableFields(listing);
  // high-tech-look Step 1C (Requirement 1.4): a Verified listing's card glows more (class only; the label is the
  // existing Verified stamp), and every card says which of its details AI can read, from its real fields only.
  const verified = opts?.trust?.verified === true;
  return `<article class="listing-card${verified ? ' is-verified' : ''}">
  <h3><strong><a href="/listings/${encodeURIComponent(listing.id)}">${escapeHtml(listing.name)}</a></strong> <span class="phone">${telLink(listing.phone)}</span></h3>
  <p>${escapeHtml(listing.city)}, ${escapeHtml(listing.state)} &middot; ${escapeHtml(categoryLabel(listing.category, categories))}</p>${badge ? `\n  ${badge}` : ''}${fields.length > 0 ? `\n  <p class="listing-ai">Details AI can read: ${fields.join(', ')}</p>` : ''}
  <p><a href="/listings/${encodeURIComponent(listing.id)}">View details →</a></p>
</article>`;
}

/**
 * high-tech-look Step 1C (Requirement 1.4): the details a listing really has, in plain words, in a fixed order: phone,
 * hours, services, area, address, website. Only fields with a real value count (hours: at least one filled-in day).
 * Never a field the listing doesn't have.
 * @param {object} listing
 * @returns {string[]}
 */
export function readableFields(listing) {
  const l = listing && typeof listing === 'object' ? listing : {};
  const text = v => typeof v === 'string' && v.trim() !== '';
  const out = [];
  if (text(l.phone)) out.push('phone');
  if (l.hours && typeof l.hours === 'object' && filledHours(l.hours).length > 0) out.push('hours');
  if (Array.isArray(l.services) && l.services.some(text)) out.push('services');
  if (text(l.serviceArea)) out.push('area');
  if (text(l.address)) out.push('address');
  if (text(l.website)) out.push('website');
  return out;
}

/**
 * Renders the plain HTML quote request form for a listing. Works without
 * JavaScript; webmcp.js reads the data attributes.
 *
 * @param {{ id: string, name: string }} listing
 * @returns {string}
 */
export function quoteForm(listing, opts = {}) {
  const id = escapeHtml(listing.id);
  const name = escapeHtml(listing.name);
  const values = opts.values || {};
  const keptName = escapeHtml(values.name ?? '');
  const keptContact = escapeHtml(values.contact ?? '');
  const keptDetails = escapeHtml(values.details ?? '');
  const errorHtml = opts.error
    ? `\n  <div id="quote-error" role="alert" tabindex="-1" autofocus><p class="form-error" role="alert">${escapeHtml(opts.error)}</p></div>`
    : '';
  return `<section class="quote-request">
  <h2>Ask for a quote</h2>
  <p class="hint">Tell ${name} what you need. Leave a phone number or email so they can reach you.</p>${errorHtml}
  <form class="quote-form" method="post" action="/listings/${encodeURIComponent(listing.id)}/quote" id="quote-form" data-listing-id="${id}" data-listing-name="${name}">
    <label for="quote-name">Your name</label>
    <input id="quote-name" name="name" type="text" required maxlength="100" autocomplete="name" value="${keptName}">
    <label for="quote-contact">Phone or email</label>
    <input id="quote-contact" name="contact" type="text" required maxlength="254" autocomplete="off" value="${keptContact}">
    <label for="quote-details">What do you need done?</label>
    <textarea id="quote-details" name="details" rows="5" required maxlength="2000">${keptDetails}</textarea>
    <button type="submit">Send request</button>
  </form>
</section>`;
}

/**
 * Renders the "Details confirmed by the business" stamp, or the unconfirmed notice.
 * The hash is a tamper check only; it makes no claim about identity or ownership.
 *
 * @param {{ verifiedDate: string, hash: string }|null|undefined} verification
 * @param {string} id  listing id (for the verify link)
 * @returns {string}
 */
function stamp(verification, id) {
  if (!verification || !verification.verifiedDate || !verification.hash) {
    return '<aside class="stamp stamp-unconfirmed"><p class="unconfirmed-note">Not yet confirmed by the owner.</p> <a class="button confirm-cta" href="/rise">Is this your business? Confirm it free →</a></aside>';
  }
  const date = escapeHtml(formatStampDate(verification));
  const hash = escapeHtml(verification.hash);
  const href = `/api/verify/${encodeURIComponent(id)}?hash=${encodeURIComponent(verification.hash)}`;
  return `<aside class="stamp">
      <p class="stamp-title">Details confirmed by the business <span class="stamp-date">${date}</span></p>
      <details class="stamp-details"><summary>Details for AI tools</summary>
      <p class="stamp-note">Tamper check: unchanged since the owner confirmed it. This is not proof of ownership.</p>
      <p class="stamp-hash"><code data-hash="${hash}">${hash}</code></p>
      <p class="stamp-note"><a href="${escapeHtml(href)}">Check this hash</a></p>
      </details>
    </aside>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Display date for the stamp, e.g. "Nov 9, 2026". Uses America/Chicago when a
 * confirmation timestamp exists; a legacy date-only value is shown as-is.
 *
 * @param {{ verifiedDate?: string, verifiedAt?: string }} verification
 * @returns {string}
 */
export function formatStampDate(verification) {
  const at = verification && verification.verifiedAt ? new Date(verification.verifiedAt) : null;
  if (at && !Number.isNaN(at.getTime())) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
    }).formatToParts(at);
    const get = type => parts.find(p => p.type === type)?.value;
    return `${get('month')} ${get('day')}, ${get('year')}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(verification?.verifiedDate ?? ''));
  if (!m) return String(verification?.verifiedDate ?? '');
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * Renders the full listing detail page body.
 * The JSON-LD string is exposed on the returned value so callers can pass it
 * to layout(); it is also embedded inline in a <script type="application/ld+json">
 * block at the top of the fragment when layout() is not given the jsonLd.
 *
 * @param {object} listing
 * @param {string} [jsonLd]  serialized JSON-LD string
 * @param {{ categories?: object[], verification?: {verifiedDate: string, hash: string}|null }} [opts]
 *   optional extras; categories default to the default store's categories.
 *   When the `verification` key is present, the stamp (or the unconfirmed
 *   notice for null) is rendered; when absent, output is unchanged.
 *   The Séance link is rendered only when `hasSeanceRuns` is true.
 * @returns {string}
 */
export function listingDetail(listing, jsonLd, opts = {}) {
  const categories = opts?.categories;
  // Every day once any is filled; a skipped day reads "Call for hours", never a guessed "Closed".
  const days = displayHours(listing.hours);
  const hoursBlock = days.length === 0
    ? `    <p class="hours-none">${NO_HOURS_TEXT}</p>`
    : `    <table class="hours">
${days.map(([day, text]) => `      <tr><th scope="row">${day}</th><td>${escapeHtml(text)}</td></tr>`).join('\n')}
    </table>`;

  const services = listing.services
    .map(s => `      <li>${escapeHtml(s)}</li>`)
    .join('\n');

  const addressRow = listing.address
    ? `\n    <dt>Address</dt>\n    <dd>${escapeHtml(listing.address)}</dd>`
    : `\n    <dt>City</dt>\n    <dd>${escapeHtml(listing.city)}, ${escapeHtml(listing.state)}</dd>`;

  const ld = jsonLd
    ? `  <script type="application/ld+json">\n${jsonLd.replace(/</g, '\\u003c')}\n  </script>\n`
    : '';

  // Stamp only when the caller passes a `verification` key (null = unconfirmed).
  const stampBlock = opts && typeof opts === 'object' && 'verification' in opts
    ? '\n    ' + stamp(opts.verification, listing.id)
    : '';

  // The Séance link shows only when the caller says this listing has at least one run.
  const seanceLink = opts?.hasSeanceRuns === true
    ? `\n    <p class="seance-link"><a href="/seance/${encodeURIComponent(listing.id)}">See what AI says about this business</a></p>`
    : '';

  const badge = [verifiedBadge(opts?.trust, { detail: true }), founderBadge(opts?.founder)].filter(Boolean).join('\n    ');
  const founderLine = badge ? `\n    ${badge}` : '';

  return `${ld}  <article class="listing-detail">
    <p><a href="/">← Back to directory</a></p>
    <h1>${escapeHtml(listing.name)}</h1>${founderLine}
    <p>${escapeHtml(listing.description)}</p>${seanceLink}${stampBlock}
    <dl>
    <dt>Category</dt>
    <dd>${escapeHtml(categoryLabel(listing.category, categories))}</dd>
    <dt>Phone</dt>
    <dd>${telLink(listing.phone)}</dd>${addressRow}
    <dt>Service area</dt>
    <dd>${escapeHtml(listing.serviceArea)}</dd>${websiteRow(listing.website)}${reviewsRow(listing.reviewsLink)}
    <dt>Services</dt>
    <dd>
    <ul>
${services}
    </ul>
    </dd>
    <dt>Hours</dt>
    <dd>
${hoursBlock}
    </dd>
    </dl>
  </article>`;
}
