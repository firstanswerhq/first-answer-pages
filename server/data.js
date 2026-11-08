/**
 * data.js — in-memory data layer
 *
 * Loads listings.json and categories.json once at module load time.
 * All exports read from the in-memory cache; no file I/O at request time.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Load and cache data files at startup
// ---------------------------------------------------------------------------

/** @returns {string} absolute path resolved relative to this file */
function dataPath(filename) {
  return fileURLToPath(new URL(`../data/${filename}`, import.meta.url));
}

/** @type {import('../data/listings.json')} */
let listings;

/** @type {Array<{ slug: string, label: string }>} */
let categories;

try {
  const rawListings   = readFileSync(dataPath('listings.json'),   'utf8');
  const rawCategories = readFileSync(dataPath('categories.json'), 'utf8');

  // Filter out any objects that carry a _comment field (seed-data markers)
  listings   = JSON.parse(rawListings).filter(item => !Object.hasOwn(item, '_comment'));
  categories = JSON.parse(rawCategories);
} catch (err) {
  process.stderr.write(`[data] Failed to load data files: ${err.message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3.1 — Accessors
// ---------------------------------------------------------------------------

/** Returns the full cached listings array. */
export function getListings() {
  return listings;
}

/** Returns the full cached categories array. */
export function getCategories() {
  return categories;
}

// ---------------------------------------------------------------------------
// 3.2 — findById
// ---------------------------------------------------------------------------

/**
 * Finds a single listing by its id.
 * @param {string} id
 * @returns {object|undefined}
 */
export function findById(id) {
  return listings.find(listing => listing.id === id);
}

// ---------------------------------------------------------------------------
// 3.3 — filterListings
// ---------------------------------------------------------------------------

/**
 * Filters the in-memory listings by optional category and/or city.
 *
 * @param {{ category?: string, city?: string }} [filters]
 * @returns {object[]} a new array — never mutates the cache
 */
export function filterListings({ category, city } = {}) {
  return listings.filter(listing => {
    if (category && listing.category !== category) return false;
    if (city && listing.city.toLowerCase() !== city.toLowerCase()) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// 3.4 — groupByCategory
// ---------------------------------------------------------------------------

/**
 * Groups an array of listings into a Map keyed by category slug.
 * Keys are ordered by the sequence defined in categories.json.
 * Categories with no matching listings are omitted.
 *
 * @param {object[]} listingsArray
 * @returns {Map<string, object[]>}
 */
export function groupByCategory(listingsArray) {
  const map = new Map();

  // Iterate categories in their canonical order so Map insertion order matches
  for (const { slug } of categories) {
    const group = listingsArray.filter(l => l.category === slug);
    if (group.length > 0) {
      map.set(slug, group);
    }
  }

  return map;
}
