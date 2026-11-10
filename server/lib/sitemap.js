/**
 * sitemap.js — Sitemap Generator (Sitemap Protocol 0.9)
 *
 * Pure function: Listing[] + baseUrl -> XML string.
 */

/** Escapes characters that are special in XML text. */
function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {object[]} listings
 * @param {string} baseUrl
 * @returns {string} XML string
 */
export function generateSitemap(listings, baseUrl) {
  const urls = [`${baseUrl}/`, ...listings.map(l => `${baseUrl}/listings/${l.id}`)];

  const entries = urls.map(url => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}
