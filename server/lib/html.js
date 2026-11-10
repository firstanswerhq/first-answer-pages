/**
 * html.js — HTML template helpers (plain template literals, no engine)
 */

import { getCategories } from '../data.js';
import { DEFAULT_SITE_NAME } from './config.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Escapes text for safe use in HTML content and attributes. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
 * @param {{ title: string, body: string, jsonLd?: string, scripts?: string[], demo?: boolean }} options
 *   `jsonLd` is an optional serialized JSON-LD string placed in the head.
 *   `scripts` is an optional list of module script URLs (deferred by default).
 *   `demo` (default false) adds the noindex meta and the sample-listings footer line.
 * @returns {string}
 */
export function layout({ title, body, jsonLd, scripts, demo = false, siteName = DEFAULT_SITE_NAME }) {
  const page = renderLayout({ title, body, jsonLd, scripts, siteName });
  return demo ? markDemo(page) : page;
}

function renderLayout({ title, body, jsonLd, scripts, siteName }) {
  const name = escapeHtml(siteName);
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
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/css/style.css">${ldBlock}${scriptTags}
</head>
<body>
  <nav class="site-nav">
    <a href="/">${name}</a>
    <a class="nav-cta" href="/rise">List your business free</a>
  </nav>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <p>${name}. A free local business directory.</p>
  </footer>
</body>
</html>
`;
}

/**
 * Renders a compact listing card for the home page directory.
 *
 * @param {object} listing
 * @param {object[]} [categories]  defaults to the default store's categories
 *   (ignored when not an array, so it is safe to use with Array#map)
 * @returns {string}
 */
export function listingCard(listing, categories) {
  return `<article class="listing-card">
  <h3><strong>${escapeHtml(listing.name)}</strong> <span class="phone">${escapeHtml(listing.phone)}</span></h3>
  <p>${escapeHtml(listing.city)}, ${escapeHtml(listing.state)} &middot; ${escapeHtml(categoryLabel(listing.category, categories))}</p>
  <p><a href="/listings/${encodeURIComponent(listing.id)}">View details →</a></p>
</article>`;
}

/**
 * Renders the plain HTML quote request form for a listing. Works without
 * JavaScript; webmcp.js reads the data attributes.
 *
 * @param {{ id: string, name: string }} listing
 * @returns {string}
 */
export function quoteForm(listing) {
  const id = escapeHtml(listing.id);
  const name = escapeHtml(listing.name);
  return `<section class="quote-request">
  <h2>Ask for a quote</h2>
  <p class="hint">Tell ${name} what you need. Leave a phone number or email so they can reach you.</p>
  <form class="quote-form" method="post" action="/listings/${encodeURIComponent(listing.id)}/quote" data-listing-id="${id}" data-listing-name="${name}">
    <label for="quote-name">Your name</label>
    <input id="quote-name" name="name" type="text" required maxlength="100" autocomplete="name">
    <label for="quote-contact">Phone or email</label>
    <input id="quote-contact" name="contact" type="text" required maxlength="254" autocomplete="off">
    <label for="quote-details">What do you need done?</label>
    <textarea id="quote-details" name="details" rows="5" required maxlength="2000"></textarea>
    <button type="submit">Send request</button>
  </form>
</section>`;
}

/**
 * Renders the owner-confirmed stamp, or the unconfirmed notice.
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
  const date = escapeHtml(verification.verifiedDate);
  const hash = escapeHtml(verification.hash);
  const href = `/api/verify/${encodeURIComponent(id)}?hash=${encodeURIComponent(verification.hash)}`;
  return `<aside class="stamp">
      <p class="stamp-title">Owner-confirmed ${date}</p>
      <p class="stamp-note">Tamper check: unchanged since the owner confirmed it. This is not proof of ownership.</p>
      <p class="stamp-hash"><code data-hash="${hash}">${hash}</code></p>
      <p class="stamp-note"><a href="${escapeHtml(href)}">Check this hash</a></p>
    </aside>`;
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
 * @returns {string}
 */
export function listingDetail(listing, jsonLd, opts = {}) {
  const categories = opts?.categories;
  // Match hour keys case-insensitively ('monday' or 'Monday'); display capitalized names
  const hoursByDay = new Map(
    Object.entries(listing.hours ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const hoursRows = DAYS
    .filter(day => hoursByDay.has(day.toLowerCase()))
    .map(day => `      <tr><th scope="row">${day}</th><td>${escapeHtml(hoursByDay.get(day.toLowerCase()))}</td></tr>`)
    .join('\n');

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

  return `${ld}  <article class="listing-detail">
    <p><a href="/">← Back to directory</a></p>
    <h1>${escapeHtml(listing.name)}</h1>
    <p>${escapeHtml(listing.description)}</p>
    <p class="seance-link"><a href="/seance/${encodeURIComponent(listing.id)}">See what AI says about this business</a></p>${stampBlock}
    <dl>
    <dt>Category</dt>
    <dd>${escapeHtml(categoryLabel(listing.category, categories))}</dd>
    <dt>Phone</dt>
    <dd>${escapeHtml(listing.phone)}</dd>${addressRow}
    <dt>Service area</dt>
    <dd>${escapeHtml(listing.serviceArea)}</dd>
    <dt>Services</dt>
    <dd>
    <ul>
${services}
    </ul>
    </dd>
    <dt>Hours</dt>
    <dd>
    <table class="hours">
${hoursRows}
    </table>
    </dd>
    </dl>
  </article>`;
}
