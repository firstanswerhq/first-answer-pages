/**
 * home.js — GET / — directory home page
 */

import { Router } from 'express';
import { groupListings } from '../data.js';
import { layout, listingCard, escapeHtml, foundersInvite } from '../lib/html.js';
import { publicListing } from '../lib/public-listing.js';
import { DEFAULT_SITE_NAME } from '../lib/config.js';
import { normalizeCategory, normalizeCity } from '../lib/search-match.js';
import { baseUrlFor } from '../lib/base-url.js';

/** Reads a query param as a trimmed string, ignoring arrays/objects. */
function param(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {{ store: object }} ctx
 * @returns {import('express').Router}
 */
/**
 * Empty-trade invite for owners. Plural labels read as they are ("No plumbers
 * listed yet."); trade names get "businesses" ("No pressure washing businesses
 * listed yet."); "Other" reads "No other businesses listed yet."
 * @param {string} label category label, or '' for the whole directory
 */
export function emptyTradeText(label) {
  const l = typeof label === 'string' ? label.trim().toLowerCase() : '';
  let what;
  if (l === '') what = 'businesses';
  else if (l === 'other') what = 'other businesses';
  else if (l.endsWith('s')) what = l;
  else what = `${l} businesses`;
  return `No ${what} listed yet. Own one?`;
}

/**
 * Empty search for a city: "No plumbers in Nashville yet. Own one?" (a trade name gets "businesses", as in
 * emptyTradeText; with no trade it reads "No businesses in Nashville yet. Own one?").
 */
export function emptyTradeInCityText(label, city) {
  const what = emptyTradeText(label).replace(/^No (.*) listed yet\. Own one\?$/, '$1');
  // The typed city, at most 60 characters, with the first letter of each word in capitals (V250, V225-3).
  const shown = Array.from(String(city ?? '')).slice(0, 60).join('')
    .replace(/(^|[\s-])(\p{L})/gu, (m, before, letter) => `${before}${letter.toUpperCase()}`);
  return `No ${what} in ${shown} yet. Own one?`;
}

export function createHomeRouter(ctx) {
  const router = Router();
  const { store } = ctx;

  router.get('/', (req, res) => {
    const categories = store.getCategories();
    const rawCategory = param(req.query.category);
    // Any forgiving form ("plumber", "Auto Repair") maps to the slug; unknown stays as typed.
    const category = normalizeCategory(rawCategory, categories) ?? rawCategory;
    const city = normalizeCity(param(req.query.city));

    const founderOf = id => (typeof store.getFounder === 'function' ? store.getFounder(id) : undefined);
    const trustOf = l => (typeof store.getTrustStatus === 'function' ? store.getTrustStatus(l) : undefined);
    // Verified businesses come first; otherwise the order is unchanged.
    const isVerified = l => (trustOf(l)?.verified === true ? 1 : 0);
    const filtered = store.searchListings({ category, city }).map(publicListing)
      .map((l, i) => [l, i]).sort((a, b) => isVerified(b[0]) - isVerified(a[0]) || a[1] - b[1]).map(([l]) => l);
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
  <button type="submit">Search Directory</button>
</form>`;

    // Page heading for filtered views, e.g. "Plumbers in Nashville".
    const categoryLabel = category ? categories.find(c => c.slug === category)?.label ?? '' : '';
    let pageHeading = '';
    if (categoryLabel && city) pageHeading = `${categoryLabel} in ${city}`;
    else if (categoryLabel) pageHeading = categoryLabel;
    else if (city) pageHeading = `Businesses in ${city}`;

    let results;
    if (filtered.length === 0) {
      // A search that finds nothing is not a page for search engines to keep: any typed city would make a new one (V225-3).
      if (city || category) res.set('X-Robots-Tag', 'noindex');
      if (!city && (categoryLabel || !category)) {
        results = `<p class="no-results">${escapeHtml(emptyTradeText(categoryLabel))} <a href="/rise">List it free &rarr;</a></p>`;
      } else if (city && (categoryLabel || !category)) {
        // A search for a city (with a known trade, or none) that finds nothing says what was searched for (V217).
        results = `<p class="no-results">${escapeHtml(emptyTradeInCityText(categoryLabel, city))} <a href="/rise">List it free &rarr;</a></p>`;
      } else {
        results = '<p class="no-results">No results found. Try a different category or city.</p>';
      }
    } else if (categoryLabel && grouped.size <= 1) {
      // One category selected: a single heading over the whole grid.
      results = `<div class="directory-single">
<h2 class="category-title">${escapeHtml(pageHeading)}</h2>
<div class="category-grid">
${filtered.map(l => listingCard(l, categories, { founder: founderOf(l.id), trust: trustOf(l) })).join('\n')}
</div>
</div>`;
    } else {
      const sections = [];
      const headTag = pageHeading ? 'h3' : 'h2';
      for (const [slug, group] of grouped) {
        const label = categories.find(c => c.slug === slug)?.label ?? slug;
        sections.push(`<section class="category">
<${headTag} class="category-head">${escapeHtml(label)}</${headTag}>
${group.map(l => listingCard(l, categories, { founder: founderOf(l.id), trust: trustOf(l) })).join('\n')}
</section>`);
      }
      const title = pageHeading ? `<h2 class="category-title">${escapeHtml(pageHeading)}</h2>\n` : '';
      results = `<div class="directory">\n${title}${sections.join('\n')}\n</div>`;
    }

    // The AI Visibility Check, as large and as clear as the search button, right under the search form (D3). With the
    // grader off there is no link to /grade anywhere on the page.
    // The button shows on the unfiltered home page only (V174); the sentence stays on every view.
    const graderButton = ctx.config?.graderEnabled === false || category || city
      ? ''
      : '\n<p class="home-check"><a class="button" href="/grade">Check if AI can find your business</a></p>';
    // Owners see the founders invite on the unfiltered home page only.
    const inviteHtml = !category && !city && typeof store.getFoundersStatus === 'function'
      ? foundersInvite(store.getFoundersStatus(), { link: true, fees: ctx.trust ? ctx.config?.trust : undefined })
      : '';
    const invite = inviteHtml ? `\n${inviteHtml}` : '';
    const body = `<header class="home-head">
<h1>Local Business Directory</h1>
<p class="tagline">The phone book is back, and AI can read it.</p>
<p class="home-why">People now ask AI who to call. List your business free so AI can find it.</p>
</header>
${filterForm}${graderButton}${invite}
${results}`;

    // Category pages: "Plumbers in Nashville | First Answer Pages". The default site
    // name is swapped for SITE_NAME by the app-level HTML wrapper.
    let title = `${DEFAULT_SITE_NAME}: Local Business Directory`;
    // The typed city, cut at 60 characters, is the only form of it in the title and the description (V256).
    const shownCity = Array.from(city).slice(0, 60).join('');
    if (categoryLabel) {
      let titleCity = shownCity;
      if (!titleCity) {
        const cities = new Set(filtered.map(l => (typeof l.city === 'string' ? l.city.trim() : '')).filter(Boolean));
        if (cities.size === 1) [titleCity] = cities;
      }
      title = `${titleCity ? `${categoryLabel} in ${titleCity}` : categoryLabel} | ${DEFAULT_SITE_NAME}`;
    }

    // Canonical: the home page, or the category page for any filtered view of a
    // known category (city filters point at the category page).
    const base = baseUrlFor(req, ctx.config);
    const canonical = categoryLabel ? `${base}/?category=${encodeURIComponent(category)}` : `${base}/`;
    const where = shownCity ? ` in ${shownCity}` : '';
    const description = categoryLabel
      ? `${categoryLabel}${where}: phone numbers, services and hours. Call them or ask for a quote, free.`
      : `Free local business directory that AI assistants can read. Find a local business${where}, call them, or ask for a quote.`;

    res.status(200).type('html').send(layout({ title, body, canonical, description }));
  });

  return router;
}
