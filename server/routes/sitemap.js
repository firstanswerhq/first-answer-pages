/**
 * sitemap.js — GET /sitemap.xml — XML sitemap
 */

import { Router } from 'express';
import { generateSitemap } from '../lib/sitemap.js';
import { publicListing } from '../lib/public-listing.js';
import { baseUrlFor } from '../lib/base-url.js';

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
    res.status(200).type('application/xml').send(generateSitemap(listings.map(publicListing), baseUrlFor(req, config), store.getCategories()));
  });

  return router;
}
