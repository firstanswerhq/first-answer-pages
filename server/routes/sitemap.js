/**
 * sitemap.js — GET /sitemap.xml — XML sitemap
 */

import { Router } from 'express';
import { generateSitemap } from '../lib/sitemap.js';
import { publicListing } from '../lib/public-listing.js';
import { baseUrlFor } from '../lib/base-url.js';

/** The main public pages, each served with status 200 and no noindex. */
export const MAIN_PAGES = Object.freeze(['/about', '/verified', '/privacy', '/rise']);

/** The two open pages of the AI Visibility Check. */
export const GRADE_PAGES = Object.freeze(['/grade', '/grade/about']);

/**
 * Whether `/grade` and `/grade/about` are listed yet. They still send `noindex, nofollow` until task F12 opens
 * them to search engines, and a sitemap may list only pages that are not noindex, so they stay out until then.
 * F12 turns this on together with the header change and the two existing tests the design names.
 */
export const GRADE_PAGES_OPEN = false;

/**
 * The extra paths for the sitemap: none in demo mode (every page is noindex then); otherwise the main pages,
 * plus the two /grade pages when the grader is on and those pages are open.
 * @param {object} config
 * @returns {string[]}
 */
export function mainPages(config = {}) {
  if (config.demoMode) return [];
  const grade = GRADE_PAGES_OPEN && config.graderEnabled !== false ? GRADE_PAGES : [];
  return [...MAIN_PAGES, ...grade];
}

/**
 * @param {{ store: object, config: { baseUrl: string } }} ctx
 * @returns {import('express').Router}
 */
export function createSitemapRouter(ctx) {
  const router = Router();
  const { store, config } = ctx;

  router.get('/sitemap.xml', (req, res) => {
    // In production the sample (seed) listings stay out of the sitemap.
    const listings = config.production && typeof store.isSeed === 'function'
      ? store.getListings().filter(l => !store.isSeed(l.id))
      : store.getListings();
    res.status(200).type('application/xml').send(generateSitemap(
      listings.map(publicListing), baseUrlFor(req, config), store.getCategories(), mainPages(config),
    ));
  });

  return router;
}
