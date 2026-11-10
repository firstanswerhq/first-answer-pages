/**
 * app.js — Express app factory.
 *
 * createApp(deps) resolves every dependency once into a `ctx` bag and hands it
 * to the route factories. Missing deps come from configFromEnv(). The default
 * export is createApp() so `import app from './app.js'` keeps working.
 */

import express from 'express';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createDataStore, getDefaultStore } from './data.js';
import { configFromEnv, DEFAULT_SITE_NAME } from './lib/config.js';
import { createRateLimiter } from './lib/rate-limiter.js';
import { createVisionProvider } from './lib/vision.js';
import { createAiBudget } from './lib/ai-budget.js';
import { createNotifier } from './lib/notifier.js';
import { createAssistantProvider } from './lib/assistant.js';
import { createHomeRouter }     from './routes/home.js';
import { createListingsRouter } from './routes/listings.js';
import { createApiRouter }      from './routes/api.js';
import { createLlmsRouter }     from './routes/llms.js';
import { createSitemapRouter }  from './routes/sitemap.js';
import { createRiseRouter }     from './routes/rise.js';
import { createMcpRouter }      from './routes/mcp.js';
import { createSeanceRouter }   from './routes/seance.js';
import { createAdminRouter }   from './routes/admin.js';
import { mountA2A }             from './routes/a2a.js';
import { layout, markDemo, applySiteName } from './lib/html.js';

/** The only place in server/ that reads the system time. */
const systemClock = Object.freeze({ now: () => Date.now() });

/**
 * @param {{
 *   dataDir?: string,
 *   seedDir?: string,
 *   visionProvider?: object,
 *   notifier?: object,
 *   assistantProvider?: object,
 *   clock?: { now(): number },
 *   rateLimiter?: object,
 *   config?: object,
 *   newId?: () => string,
 *   a2a?: object,
 * }} [deps]
 */
export function createApp(deps = {}) {
  const config = { ...configFromEnv(process.env), ...(deps.config ?? {}) };
  const clock = deps.clock ?? systemClock;

  // No dataDir (and no custom clock): share the default store with the legacy
  // data.js exports so there is exactly one store loaded from the default dir.
  // Tests that pass dataDir keep their seed files in that dir; the env-driven
  // app reads seeds from the repo data/ folder and writes to DATA_DIR.
  const seedDir = deps.seedDir ?? (deps.dataDir ? deps.dataDir : config.seedDir);
  // Sample listings are loaded only in demo mode. A config override that
  // disagrees with the environment also gets its own store.
  const envDemoMode = configFromEnv(process.env, { warn: () => {} }).demoMode;
  const store = deps.dataDir || deps.clock || deps.seedDir || config.demoMode !== envDemoMode
    ? createDataStore({
      dataDir: deps.dataDir ?? config.dataDir, seedDir, clock, includeSamples: Boolean(config.demoMode),
    })
    : getDefaultStore();

  if (store.getCategories().length === 0) {
    throw new Error('No categories found: refusing to start');
  }

  // Retention on startup: fire-and-forget, never blocks or crashes startup.
  if (typeof store.pruneExpired === 'function') {
    store.pruneExpired().catch(err => {
      process.stderr.write(`[retention] startup prune failed: ${err?.name ?? 'Error'}\n`);
    });
  }

  const ctx = {
    store,
    visionProvider: deps.visionProvider ?? createVisionProvider(config),
    notifier: deps.notifier ?? createNotifier(config),
    assistantProvider: deps.assistantProvider ?? createAssistantProvider(config),
    clock,
    rateLimiter: deps.rateLimiter ?? createRateLimiter({ clock }),
    config,
    // The day's count is kept in DATA_DIR/ai-budget.json (written only when a real provider call is counted).
    aiBudget: deps.aiBudget ?? createAiBudget({
      clock,
      limit: config.maxAiCallsPerDay ?? 200,
      file: path.join(deps.dataDir ?? config.dataDir, 'ai-budget.json'),
    }),
    newId: deps.newId ?? (() => randomUUID()),
    a2a: deps.a2a,
  };

  const app = express();

  // Don't advertise the framework; set baseline security headers on every
  // response. Routes may override (e.g. draft pages use Referrer-Policy: no-referrer).
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "frame-ancestors 'none'",
    });
    next();
  });

  // Hop count only; never `true` (it would trust any client-supplied X-Forwarded-For).
  if (Number.isInteger(config.trustProxy) && config.trustProxy >= 0) {
    app.set('trust proxy', config.trustProxy);
  }

  // SITE_NAME: swap the default site name in every HTML page. Installed
  // before the DEMO_MODE wrapper so markDemo runs first, then this one.
  // Only HTML string bodies are touched; JSON and plain text pass through.
  if (typeof config.siteName === 'string' && config.siteName !== '' && config.siteName !== DEFAULT_SITE_NAME) {
    app.use((req, res, next) => {
      const send = res.send.bind(res);
      res.send = body => {
        if (typeof body === 'string') {
          const type = String(res.get('Content-Type') ?? '');
          if (type.includes('html') || (!type && /^\s*<!doctype html/i.test(body))) {
            body = applySiteName(body, config.siteName);
          }
        }
        return send(body);
      };
      next();
    });
  }

  // DEMO_MODE: mark every HTML page (noindex meta + footer line) and send
  // X-Robots-Tag. Done here so no route needs to remember to pass a flag.
  if (config.demoMode) {
    app.use((req, res, next) => {
      res.set('X-Robots-Tag', 'noindex');
      const send = res.send.bind(res);
      res.send = body => {
        if (typeof body === 'string') {
          const type = String(res.get('Content-Type') ?? '');
          if (type.includes('html') || (!type && /^\s*<!doctype html/i.test(body))) {
            body = markDemo(body);
          }
        }
        return send(body);
      };
      next();
    });
  }

  // Liveness probe: no data access, no rate limit.
  app.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  });

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.use(createHomeRouter(ctx));
  app.use(createListingsRouter(ctx));
  app.use(createApiRouter(ctx));
  app.use(createLlmsRouter(ctx));
  app.use(createSitemapRouter(ctx));
  app.use(createRiseRouter(ctx));
  app.use(createMcpRouter(ctx));
  app.use(createSeanceRouter(ctx));
  app.use(createAdminRouter(ctx));

  if (ctx.a2a) mountA2A(app, ctx.a2a); // registers BOTH the card route and ctx.a2a.path together

  // Catch-all 404
  app.use((req, res) => {
    res.status(404).type('html').send(layout({
      title: 'Page not found',
      body: '<section class="message"><h1>Page not found</h1><p><a href="/">Back to the directory</a></p></section>',
    }));
  });

  // Generic error handler — honours 4xx/5xx err.status, never leaks message or stack
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const raw = err?.status ?? err?.statusCode;
    const status = Number.isInteger(raw) && raw >= 400 && raw <= 599 ? raw : 500;

    // Status and error name only: message/stack may contain user data.
    process.stderr.write(`[error] ${status} ${typeof err?.name === 'string' ? err.name : 'Error'}\n`);

    let message;
    if (status >= 500) message = 'Something went wrong';
    else if (status === 400) message = 'Bad request';
    else if (status === 404) message = 'Page not found';
    else if (status === 413) message = 'Request too large';
    else message = 'Request could not be processed';

    if (req.path.startsWith('/api/') || req.path === '/mcp') {
      return res.status(status).json({ error: message });
    }

    res.status(status).type('html').send(layout({
      title: message,
      body: `<section class="message"><h1>${message}</h1><p><a href="/">Back to the directory</a></p></section>`,
    }));
  });

  // Exposed for later tasks and tests (not part of Express's own API)
  app.locals.ctx = ctx;

  return app;
}

export default createApp();
