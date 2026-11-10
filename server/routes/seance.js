/**
 * seance.js — the Seance.
 *
 *   POST /seance/run        admin only: run one assistant query for a listing
 *   GET  /seance/:id        HTML report
 *   GET  /api/seance/:id    JSON history
 */

import express, { Router } from 'express';
import { requireAdmin } from '../lib/admin-auth.js';
import { RULES } from '../lib/rate-limiter.js';
import { runSeance, createSeanceStore, SeanceError } from '../lib/seance.js';
import { buildHistory, seanceReportPage } from '../lib/seance-html.js';
import { messagePage } from '../lib/rise-html.js';
import { publicListing } from '../lib/public-listing.js';

/**
 * @param {object} ctx resolved dependencies from createApp
 * @returns {import('express').Router}
 */
export function createSeanceRouter(ctx) {
  const router = Router();
  const history = createSeanceStore(ctx.store);
  const jsonParser = express.json({ limit: '4kb' });

  // Admin auth (403 when no token configured, 401 otherwise) runs before the body is read.
  router.post('/seance/run', requireAdmin(ctx), (req, res, next) => {
    jsonParser(req, res, async err => {
      try {
        if (err) return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'Bad request' });
        const id = req.body && typeof req.body === 'object' ? req.body.id : undefined;
        if (typeof id !== 'string' || id === '') {
          return res.status(400).json({ error: 'id is required' });
        }
        if (!ctx.store.findById(id)) return res.status(404).json({ error: 'Listing not found' });

        const limited = ctx.rateLimiter.consumeAll([
          { key: `seance:${req.ip}`, ...RULES.seance },
          { key: `seance-listing:${id}`, ...RULES['seance-listing'] },
        ]);
        if (!limited.allowed) {
          res.set('Retry-After', String(limited.retryAfterSeconds));
          return res.status(429).json({ error: 'Too many runs' });
        }

        if (ctx.assistantProvider?.name !== 'mock') {
          const budget = ctx.aiBudget.consume();
          if (!budget.allowed) {
            res.set('Retry-After', String(budget.retryAfterSeconds));
            return res.status(429).json({ error: "We have reached today's limit for AI help. Try again tomorrow." });
          }
        }

        try {
          const run = await runSeance(ctx, id);
          return res.status(201).json({ run });
        } catch (e) {
          if (e instanceof SeanceError) {
            if (e.code === 'not_found') return res.status(404).json({ error: 'Listing not found' });
            return res.status(502).json({ error: 'run failed' });
          }
          throw e;
        }
      } catch (e) {
        next(e);
      }
    });
  });

  router.get('/api/seance/:id', async (req, res, next) => {
    try {
      const listing = ctx.store.findById(req.params.id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      const runs = await history.list(listing.id);
      const { runs: tagged, groups } = buildHistory(runs, ctx.store.getVerifiedDate(listing.id));
      res.json({ id: listing.id, runs: tagged, groups });
    } catch (err) {
      next(err);
    }
  });

  router.get('/seance/:id', async (req, res, next) => {
    try {
      const listing = ctx.store.findById(req.params.id);
      if (!listing) {
        return res.status(404).type('html').send(
          messagePage('Listing not found', 'That listing does not exist.', { href: '/', text: 'Back to the directory' }),
        );
      }
      const runs = await history.list(listing.id);
      res.type('html').send(seanceReportPage(publicListing(listing), runs, ctx.store.getVerifiedDate(listing.id)));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
