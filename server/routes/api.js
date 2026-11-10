/**
 * api.js — GET /api/listings/:id — JSON API
 */

import { Router } from 'express';

/**
 * @param {{ store: object }} ctx
 * @returns {import('express').Router}
 */
export function createApiRouter(ctx) {
  const router = Router();
  const { store } = ctx;

  router.get('/api/listings/:id', (req, res) => {
    const listing = store.findById(req.params.id);

    if (!listing) {
      return res.status(404).type('application/json').send(JSON.stringify({ error: 'Listing not found' }));
    }

    res.status(200).type('application/json').send(JSON.stringify(listing));
  });

  return router;
}
