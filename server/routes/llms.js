/**
 * llms.js — GET /llms.txt — plain-text AI feed
 */

import { Router } from 'express';
import { generateLlmsTxt } from '../lib/llms.js';

/**
 * @param {{ store: object, config: { baseUrl: string } }} ctx
 * @returns {import('express').Router}
 */
export function createLlmsRouter(ctx) {
  const router = Router();
  const { store, config } = ctx;

  router.get('/llms.txt', (req, res) => {
    res.status(200).type('text/plain').send(
      generateLlmsTxt(store.getListings(), config.baseUrl, store.getCategories()),
    );
  });

  return router;
}
