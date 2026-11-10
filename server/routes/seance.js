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
 * One Séance run for a listing, shared by POST /seance/run (bearer token) and
 * the admin page's "Run AI check" button (login cookie). Same checks, same
 * rate limits, same daily AI budget. Never throws for expected failures.
 * @param {object} ctx resolved dependencies from createApp
 * @param {string} id listing id
 * @param {string} ip client address for the per-IP rate limit
 * @returns {Promise<{ status: number, json: object, retryAfterSeconds?: number,
 *   reason?: 'notfound'|'off'|'busy'|'limit'|'failed', run?: object }>}
 */
export async function runSeanceForListing(ctx, id, ip) {
  if (typeof id !== 'string' || id === '' || !ctx.store.findById(id)) {
    return { status: 404, json: { error: 'Listing not found' }, reason: 'notfound' };
  }

  // In production the demo assistant must never answer; nothing is counted or run.
  if (ctx.config.production === true && ctx.assistantProvider?.name === 'mock') {
    return { status: 503, json: { error: 'Séance is not connected' }, reason: 'off' };
  }

  const limited = ctx.rateLimiter.consumeAll([
    { key: `seance:${ip}`, ...RULES.seance },
    { key: `seance-listing:${id}`, ...RULES['seance-listing'] },
  ]);
  if (!limited.allowed) {
    return { status: 429, json: { error: 'Too many runs' }, retryAfterSeconds: limited.retryAfterSeconds, reason: 'busy' };
  }

  if (ctx.assistantProvider?.name !== 'mock') {
    const budget = ctx.aiBudget.consume({ kind: 'seance' });
    if (!budget.allowed) {
      return {
        status: 429,
        json: { error: "We have reached today's limit for AI help. Try again tomorrow." },
        retryAfterSeconds: budget.retryAfterSeconds,
        reason: 'limit',
      };
    }
  }

  try {
    const run = await runSeance(ctx, id);
    return { status: 201, json: { run }, run };
  } catch (e) {
    if (e instanceof SeanceError) {
      if (e.code === 'not_found') return { status: 404, json: { error: 'Listing not found' }, reason: 'notfound' };
      return { status: 502, json: { error: 'run failed' }, reason: 'failed' };
    }
    throw e;
  }
}

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
        const result = await runSeanceForListing(ctx, id, req.ip);
        if (result.retryAfterSeconds !== undefined) res.set('Retry-After', String(result.retryAfterSeconds));
        return res.status(result.status).json(result.json);
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
