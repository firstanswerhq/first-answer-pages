/**
 * sitemap.js — GET /sitemap.xml — XML sitemap
 */

import { Router } from 'express';
import { generateSitemap } from '../lib/sitemap.js';
import { publicListing } from '../lib/public-listing.js';
import { baseUrlFor } from '../lib/base-url.js';

/** The main public pages, in sitemap order. `/verified` is served only while verification is on (V89). */
export const MAIN_PAGES = Object.freeze(['/about', '/verified', '/privacy', '/rise']);
const VERIFIED_PAGE = '/verified';

/** The two open pages of the AI Visibility Check. */
export const GRADE_PAGES = Object.freeze(['/grade', '/grade/about']);

/**
 * Whether `/grade` and `/grade/about` are listed in the sitemap. They are open to search engines, so they are
 * listed. A sitemap may list only pages that are not noindex; a report, a draft or an admin address is never listed.
 * Setting this to false takes both pages out of the sitemap.
 */
export const GRADE_PAGES_OPEN = true;

/**
 * The extra paths for the sitemap: none in demo mode (every page is noindex then); otherwise the main pages,
 * plus the two /grade pages when the grader is on and those pages are open. `/verified` is listed only when
 * verification is on, the same condition the verify router uses (`ctx.trust` is present); without it that
 * page is a 404. Pure: tests pass the flag.
 * @param {object} config
 * @param {{ verificationOn?: boolean }} [opts]
 * @returns {string[]}
 */
export function mainPages(config = {}, { verificationOn = false } = {}) {
  if (config.demoMode) return [];
  const main = MAIN_PAGES.filter(p => p !== VERIFIED_PAGE || verificationOn === true);
  const grade = GRADE_PAGES_OPEN && config.graderEnabled !== false ? GRADE_PAGES : [];
  return [...main, ...grade];
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
      listings.map(publicListing), baseUrlFor(req, config), store.getCategories(),
      mainPages(config, { verificationOn: Boolean(ctx.trust) }),
    ));
  });

  return router;
}
