/**
 * html.js — HTML template helpers (plain template literals, no engine)
 */

import { getCategories } from '../data.js';

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
 * Wraps page content in the full HTML shell (head, nav, footer).
 *
 * @param {{ title: string, body: string, jsonLd?: string, scripts?: string[] }} options
 *   `jsonLd` is an optional serialized JSON-LD string placed in the head.
 *   `scripts` is an optional list of module script URLs (deferred by default).
 * @returns {string}
 */
export function layout({ title, body, jsonLd, scripts }) {
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
    <a href="/">First Answer Pages</a>
  </nav>
  <main>
${body}
  </main>
  <footer class="site-footer">
    <p>First Answer Pages. A free local business directory.</p>
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
 * Renders the full listing detail page body.
 * The JSON-LD string is exposed on the returned value so callers can pass it
 * to layout(); it is also embedded inline in a <script type="application/ld+json">
 * block at the top of the fragment when layout() is not given the jsonLd.
 *
 * @param {object} listing
 * @param {string} [jsonLd]  serialized JSON-LD string
 * @param {{ categories?: object[] }} [opts]  optional extras; categories
 *   default to the default store's categories
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

  return `${ld}  <article class="listing-detail">
    <p><a href="/">← Back to directory</a></p>
    <h1>${escapeHtml(listing.name)}</h1>
    <p>${escapeHtml(listing.description)}</p>
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
