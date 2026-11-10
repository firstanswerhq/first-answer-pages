/**
 * api.js — GET /api/listings/:id — JSON API
 */

import express, { Router } from 'express';
import { submitQuote } from '../lib/quotes.js';

const jsonParser = express.json({ limit: '16kb' });

/**
 * @param {object} ctx
 * @returns {import('express').Router}
 */
export function createApiRouter(ctx) {
  const router = Router();
  const { store } = ctx;

  const sendJson = (res, status, payload) =>
    res.status(status).type('application/json').send(JSON.stringify(payload));

  router.post('/api/quotes', (req, res, next) => {
    jsonParser(req, res, err => {
      if (err) {
        if (err.type === 'entity.too.large') return sendJson(res, 413, { error: 'Request too large' });
        return sendJson(res, 400, { error: 'Invalid JSON' });
      }
      next();
    });
  }, async (req, res, next) => {
    try {
      const result = await submitQuote(ctx, req.body, req.ip);
      if (result.status === 'ok') return sendJson(res, 201, { quoteId: result.quoteId });
      if (result.status === 'rate_limited') {
        res.set('Retry-After', String(result.retryAfterSeconds));
        return sendJson(res, 429, { error: 'Too many requests', retryAfterSeconds: result.retryAfterSeconds });
      }
      return sendJson(res, 422, { error: result.message, argument: result.argument });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/listings/:id', (req, res) => {
    const listing = store.findById(req.params.id);

    if (!listing) {
      return res.status(404).type('application/json').send(JSON.stringify({ error: 'Listing not found' }));
    }

    res.status(200).type('application/json').send(JSON.stringify(listing));
  });

  return router;
}
