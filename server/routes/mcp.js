/**
 * mcp.js — POST /mcp — MCP endpoint (JSON-RPC 2.0 over HTTP)
 */

import express, { Router } from 'express';
import { RULES } from '../lib/rate-limiter.js';
import { baseUrlFor } from '../lib/base-url.js';
import {
  handleRpc,
  parseErrorResponse,
  invalidRequestResponse,
  internalErrorResponse,
} from '../lib/mcp.js';

const MAX_BODY_BYTES = 65536;

function sendJson(res, status, body) {
  res.status(status).type('application/json').send(JSON.stringify(body));
}

/**
 * @param {object} ctx
 * @returns {import('express').Router}
 */
export function createMcpRouter(ctx) {
  const router = Router();

  function rateLimit(req, res, next) {
    try {
      const limited = ctx.rateLimiter.consume(`mcp:${req.ip}`, RULES.mcp);
      if (!limited.allowed) {
        res.set('Retry-After', String(limited.retryAfterSeconds));
        return sendJson(res, 429, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Too many requests' },
        });
      }
      next();
    } catch {
      sendJson(res, 200, internalErrorResponse().body);
    }
  }

  const rawBody = express.raw({ type: () => true, limit: MAX_BODY_BYTES });

  function cors(req, res, next) {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  }

  // Preflight: never rate limited, registered before the 405 catch-all.
  router.options('/mcp', (req, res) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, accept, mcp-session-id',
      'Access-Control-Max-Age': '86400',
    });
    res.status(204).end();
  });

  router.post('/mcp', cors, rateLimit, rawBody, async (req, res) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        const r = parseErrorResponse();
        return sendJson(res, r.status, r.body);
      }
      if (Array.isArray(message)) {
        const r = invalidRequestResponse();
        return sendJson(res, r.status, r.body);
      }
      // Absolute listing URLs use BASE_URL, or this request's host when BASE_URL is unset (local runs).
      const r = await handleRpc({ ...ctx, requestBaseUrl: baseUrlFor(req, ctx.config) }, message, req.ip);
      if (r.body === null) return res.status(r.status).end();
      sendJson(res, r.status, r.body);
    } catch {
      const r = internalErrorResponse();
      sendJson(res, r.status, r.body);
    }
  });

  // Body-parser errors (too large, etc.) become JSON-RPC errors, never HTML 500s.
  // eslint-disable-next-line no-unused-vars
  router.use('/mcp', (err, req, res, next) => {
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      return sendJson(res, 413, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Request body too large' },
      });
    }
    if (err && err.status === 400) {
      const r = parseErrorResponse();
      return sendJson(res, r.status, r.body);
    }
    const r = internalErrorResponse();
    sendJson(res, r.status, r.body);
  });

  router.all('/mcp', (req, res) => {
    res.set('Allow', 'POST');
    res.set('Access-Control-Allow-Origin', '*');
    sendJson(res, 405, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Method not allowed; use POST' },
    });
  });

  return router;
}
