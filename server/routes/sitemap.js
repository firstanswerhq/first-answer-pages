/**
 * sitemap.js — GET /sitemap.xml — XML sitemap
 */

import { Router } from 'express';
import { generateSitemap } from '../lib/sitemap.js';

/**
 * @param {{ store: object, config: { baseUrl: string } }} ctx
 * @returns {import('express').Router}
 */
export function createSitemapRouter(ctx) {
  const router = Router();
  const { store, config } = ctx;

  router.get('/sitemap.xml', (req, res) => {
    res.status(200).type('application/xml').send(generateSitemap(store.getListings(), config.baseUrl));
  });

  return router;
}
