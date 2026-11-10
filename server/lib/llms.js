/**
 * llms.js — llms.txt Generator
 *
 * Pure function: Listing[] + baseUrl -> plain-text string.
 */

import { getCategories } from '../data.js';
import { DEFAULT_SITE_NAME } from './config.js';
import { filledHours } from './html.js';

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
 * @param {{ siteName?: string }} [options]  siteName defaults to "First Answer Pages"
 * @returns {string}
 */
export function generateLlmsTxt(listings, baseUrl, categories, options = {}) {
  const siteName = oneLine(options?.siteName ?? DEFAULT_SITE_NAME) || DEFAULT_SITE_NAME;
  const categoryList = Array.isArray(categories) ? categories : getCategories();
  const labels = new Map(categoryList.map(c => [c.slug, c.label]));

  // Group by category slug, canonical category order first, unknown slugs after
  const groups = new Map();
  for (const { slug } of categoryList) groups.set(slug, []);
  for (const listing of listings) {
    if (!groups.has(listing.category)) groups.set(listing.category, []);
    groups.get(listing.category).push(listing);
  }

  // Name a city in the header only when every listing is in the same one.
  const cities = new Map();
  for (const l of listings) {
    const city = oneLine(l.city);
    if (city && !cities.has(city.toLowerCase())) cities.set(city.toLowerCase(), city);
  }
  const headerCity = cities.size === 1 ? [...cities.values()][0] : '';
  const tagline = headerCity ? `Local businesses in ${headerCity}` : 'Local businesses';

  const base = oneLine(baseUrl);
  const confirmed = options?.confirmed;
  const confirmedDates = options?.confirmedDates;
  const isConfirmed = id => {
    if (typeof confirmed === 'function') return Boolean(confirmed(id));
    if (confirmed instanceof Set) return confirmed.has(id);
    return false;
  };
  const dateFor = id => {
    if (!confirmedDates) return '';
    const d = typeof confirmedDates.get === 'function' ? confirmedDates.get(id) : confirmedDates[id];
    return oneLine(d);
  };

  const lines = [
    `# ${siteName}`,
    `# Free local business directory — ${tagline}`,
    `# Total listings: ${listings.length}`,
    `# ${baseUrl}`,
    '',
    '## How to request a quote',
    `MCP tool: request_quote at ${base}/mcp (JSON-RPC over POST)`,
    `HTTP: POST ${base}/api/quotes with a JSON body of id, name, contact, details`,
    '',
  ];

  if (listings.length === 0) lines.push('No businesses are listed yet.', '');

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
      );
      const services = (Array.isArray(l.services) ? l.services : []).map(oneLine).filter(Boolean);
      if (services.length > 0) lines.push(`Services: ${services.join('; ')}`);
      // Only the days the owner filled in; nothing is guessed for a skipped day.
      const days = filledHours(l.hours).map(([day, text]) => `${day} ${oneLine(text)}`).filter(t => t.trim() !== '');
      lines.push(`Hours: ${days.length > 0 ? days.join('; ') : 'Call for hours'}`);
      lines.push(`Page: ${base}/listings/${oneLine(l.id)}`);
      if (isConfirmed(l.id)) {
        const date = dateFor(l.id);
        lines.push(`Owner-confirmed: yes${date ? ` (${date})` : ''}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
