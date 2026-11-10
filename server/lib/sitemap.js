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
 * @param {{ slug: string }[]} [categories]  when given, adds `/?category=<slug>`
 *   for every category with at least one of `listings`, in category order
 * @returns {string} XML string
 */
export function generateSitemap(listings, baseUrl, categories) {
  const used = new Set(listings.map(l => l.category));
  const categoryUrls = Array.isArray(categories)
    ? categories
      .filter(c => c && typeof c.slug === 'string' && used.has(c.slug))
      .map(c => `${baseUrl}/?category=${encodeURIComponent(c.slug)}`)
    : [];
  const urls = [`${baseUrl}/`, ...categoryUrls, ...listings.map(l => `${baseUrl}/listings/${l.id}`)];

  const entries = urls.map(url => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');
}
