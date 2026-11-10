/**
 * home.js — GET / — directory home page
 */

import { Router } from 'express';
import { filterListings, groupByCategory, getCategories } from '../data.js';
import { layout, listingCard, escapeHtml } from '../lib/html.js';

const router = Router();

/** Reads a query param as a trimmed string, ignoring arrays/objects. */
function param(value) {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', (req, res) => {
  const category = param(req.query.category);
  const city = param(req.query.city);
  const categories = getCategories();

  const filtered = filterListings({ category, city });
  const grouped = groupByCategory(filtered);

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

  let results;
  if (filtered.length === 0) {
    results = '<p class="no-results">No results found. Try a different category or city.</p>';
  } else {
    const sections = [];
    for (const [slug, group] of grouped) {
      const label = categories.find(c => c.slug === slug)?.label ?? slug;
      sections.push(`<section class="category">
<h2 class="category-head">${escapeHtml(label)}</h2>
${group.map(listingCard).join('\n')}
</section>`);
    }
    results = `<div class="directory">\n${sections.join('\n')}\n</div>`;
  }

  const body = `<h1>Local Business Directory</h1>
<p class="tagline">The phone book is back, and AI can read it.</p>
${filterForm}
${results}`;

  res.status(200).type('html').send(layout({ title: 'First Answer Pages: Local Business Directory', body }));
});

export default router;
