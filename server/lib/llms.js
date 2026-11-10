/**
 * llms.js — llms.txt Generator
 *
 * Pure function: Listing[] + baseUrl -> plain-text string.
 */

import { getCategories } from '../data.js';

/** Forces a value onto one line: line breaks and control characters become one space. */
function oneLine(value) {
  return String(value ?? '')
    .replace(/[\n\r\u2028\u2029\u0085]|\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates the full /llms.txt content.
 *
 * @param {object[]} listings
 * @param {string} baseUrl  e.g. "https://firstanswerpages.com"
 * @param {object[]} [categories]  defaults to the default store's categories
 * @returns {string}
 */
export function generateLlmsTxt(listings, baseUrl, categories) {
  const categoryList = Array.isArray(categories) ? categories : getCategories();
  const labels = new Map(categoryList.map(c => [c.slug, c.label]));

  // Group by category slug, canonical category order first, unknown slugs after
  const groups = new Map();
  for (const { slug } of categoryList) groups.set(slug, []);
  for (const listing of listings) {
    if (!groups.has(listing.category)) groups.set(listing.category, []);
    groups.get(listing.category).push(listing);
  }

  const lines = [
    '# First Answer Pages',
    '# Free local business directory — Nashville, TN',
    `# Total listings: ${listings.length}`,
    `# ${baseUrl}`,
    '',
  ];

  for (const [slug, group] of groups) {
    if (group.length === 0) continue;
    const label = oneLine(labels.get(slug) ?? slug);
    const sorted = [...group].sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });

    lines.push(`## ${label}`, '');
    for (const l of sorted) {
      lines.push(
        `### ${oneLine(l.name)}`,
        `Phone: ${oneLine(l.phone)}`,
        `Category: ${label}`,
        `City: ${oneLine(l.city)}, ${oneLine(l.state)}`,
        `Service Area: ${oneLine(l.serviceArea)}`,
        `Page: ${oneLine(baseUrl)}/listings/${oneLine(l.id)}`,
        '',
      );
    }
  }

  return lines.join('\n');
}
