/**
 * api.js — GET /api/listings/:id — JSON API
 */

import { Router } from 'express';
import { findById } from '../data.js';

const router = Router();

router.get('/api/listings/:id', (req, res) => {
  const listing = findById(req.params.id);

  if (!listing) {
    return res.status(404).type('application/json').send(JSON.stringify({ error: 'Listing not found' }));
  }

  res.status(200).type('application/json').send(JSON.stringify(listing));
});

export default router;
