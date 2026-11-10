/**
 * llms.js — GET /llms.txt — plain-text AI feed
 */

import { Router } from 'express';
import { generateLlmsTxt } from '../lib/llms.js';
import { publicListing } from '../lib/public-listing.js';
import { baseUrlFor } from '../lib/base-url.js';

/**
 * @param {{ store: object, config: { baseUrl: string, siteName?: string } }} ctx
 * @returns {import('express').Router}
 */
export function createLlmsRouter(ctx) {
  const router = Router();
  const { store, config } = ctx;

  router.get('/llms.txt', (req, res) => {
    // In production the sample (seed) listings stay out of llms.txt.
    const listings = config.production && typeof store.isSeed === 'function'
      ? store.getListings().filter(l => !store.isSeed(l.id))
      : store.getListings();
    const confirmedDates = new Map();
    for (const l of listings) {
      const date = typeof store.getVerifiedDate === 'function' ? store.getVerifiedDate(l.id) : undefined;
      if (date) confirmedDates.set(l.id, date);
    }
    res.status(200).type('text/plain').send(
      generateLlmsTxt(listings.map(publicListing), baseUrlFor(req, config), store.getCategories(), {
        siteName: config.siteName,
        confirmed: new Set(confirmedDates.keys()),
        confirmedDates,
      }),
    );
  });

  return router;
}
