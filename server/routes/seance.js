/**
 * seance.js — the Seance.
 *
 *   POST /seance/run        admin only: run one assistant query for a listing
 *   GET  /seance/:id        HTML report
 *   GET  /api/seance/:id    JSON history
 */

import express, { Router } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { RULES } from '../lib/rate-limiter.js';
import { runSeance, createSeanceStore, SeanceError } from '../lib/seance.js';
import { buildHistory, seanceReportPage } from '../lib/seance-html.js';
import { messagePage } from '../lib/rise-html.js';

const sha256 = s => createHash('sha256').update(String(s)).digest();

/** True when the Authorization header carries the configured bearer token. */
function tokenMatches(header, expected) {
  const match = typeof header === 'string' ? /^Bearer (.+)$/i.exec(header.trim()) : null;
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]), sha256(expected));
}

/**
 * @param {object} ctx resolved dependencies from createApp
 * @returns {import('express').Router}
 */
export function createSeanceRouter(ctx) {
  const router = Router();
  const history = createSeanceStore(ctx.store);
  const jsonParser = express.json({ limit: '4kb' });

  router.post('/seance/run', (req, res, next) => {
    // 1. Disabled entirely without a configured token (before reading the body).
    if (!ctx.config.adminToken) {
      return res.status(403).json({ error: 'Seance runs are disabled' });
    }
    // 2. Auth.
    if (!tokenMatches(req.headers.authorization, ctx.config.adminToken)) {
      res.set('WWW-Authenticate', 'Bearer');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // 3. Body.
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
      res.type('html').send(seanceReportPage(listing, runs, ctx.store.getVerifiedDate(listing.id)));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
