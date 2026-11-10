/**
 * home.js — GET / — directory home page
 */

import { Router } from 'express';
import { groupListings } from '../data.js';
import { layout, listingCard, escapeHtml } from '../lib/html.js';
import { publicListing } from '../lib/public-listing.js';

/** Reads a query param as a trimmed string, ignoring arrays/objects. */
function param(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {{ store: object }} ctx
 * @returns {import('express').Router}
 */
export function createHomeRouter(ctx) {
  const router = Router();
  const { store } = ctx;

  router.get('/', (req, res) => {
    const category = param(req.query.category);
    const city = param(req.query.city);
    const categories = store.getCategories();

    const filtered = store.searchListings({ category, city }).map(publicListing);
    const grouped = groupListings(filtered, categories);

    const options = categories
      .map(c => `<option value="${escapeHtml(c.slug)}"${c.slug === category ? ' selected' : ''}>${escapeHtml(c.label)}</option>`)
      .join('');

    const filterForm = `<form class="filters" method="GET" action="/">
  <label>Category
    <select name="category">
      <option value="">All categories</option>
      ${options}
    </select>
  </label>
  <label>City
    <input type="text" name="city" value="${escapeHtml(city)}">
  </label>
  <button type="submit">Search</button>
</form>`;

    // Page heading for filtered views, e.g. "Plumbers in Nashville".
    const categoryLabel = category ? categories.find(c => c.slug === category)?.label ?? '' : '';
    let pageHeading = '';
    if (categoryLabel && city) pageHeading = `${categoryLabel} in ${city}`;
    else if (categoryLabel) pageHeading = categoryLabel;
    else if (city) pageHeading = `Businesses in ${city}`;

    let results;
    if (filtered.length === 0) {
      results = '<p class="no-results">No results found. Try a different category or city.</p>';
    } else if (categoryLabel && grouped.size <= 1) {
      // One category selected: a single heading over the whole grid.
      results = `<div class="directory-single">
<h2 class="category-title">${escapeHtml(pageHeading)}</h2>
<div class="category-grid">
${filtered.map(l => listingCard(l, categories)).join('\n')}
</div>
</div>`;
    } else {
      const sections = [];
      const headTag = pageHeading ? 'h3' : 'h2';
      for (const [slug, group] of grouped) {
        const label = categories.find(c => c.slug === slug)?.label ?? slug;
        sections.push(`<section class="category">
<${headTag} class="category-head">${escapeHtml(label)}</${headTag}>
${group.map(l => listingCard(l, categories)).join('\n')}
</section>`);
      }
      const title = pageHeading ? `<h2 class="category-title">${escapeHtml(pageHeading)}</h2>\n` : '';
      results = `<div class="directory">\n${title}${sections.join('\n')}\n</div>`;
    }

    const body = `<h1>Local Business Directory</h1>
<p class="tagline">The phone book is back, and AI can read it.</p>
${filterForm}
${results}`;

    res.status(200).type('html').send(layout({ title: 'First Answer Pages: Local Business Directory', body }));
  });

  return router;
}
