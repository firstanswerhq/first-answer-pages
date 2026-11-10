/**
 * llms.js — GET /llms.txt — plain-text AI feed
 */

import { Router } from 'express';
import { generateLlmsTxt } from '../lib/llms.js';
import { publicListing } from '../lib/public-listing.js';

/**
 * @param {{ store: object, config: { baseUrl: string } }} ctx
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
    res.status(200).type('text/plain').send(
      generateLlmsTxt(listings.map(publicListing), config.baseUrl, store.getCategories()),
    );
  });

  return router;
}
