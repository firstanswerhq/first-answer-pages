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

import { createDataStore, getDefaultStore } from './data.js';
import { configFromEnv } from './lib/config.js';
import { createRateLimiter } from './lib/rate-limiter.js';
import { createVisionProvider } from './lib/vision.js';
import { createNotifier } from './lib/notifier.js';
import { createHomeRouter }     from './routes/home.js';
import { createListingsRouter } from './routes/listings.js';
import { createApiRouter }      from './routes/api.js';
import { createLlmsRouter }     from './routes/llms.js';
import { createSitemapRouter }  from './routes/sitemap.js';
import { createRiseRouter }     from './routes/rise.js';
import { createMcpRouter }      from './routes/mcp.js';
import { mountA2A }             from './routes/a2a.js';
import { layout }               from './lib/html.js';

/** The only place in server/ that reads the system time. */
const systemClock = Object.freeze({ now: () => Date.now() });

/**
 * @param {{
 *   dataDir?: string,
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
  const store = deps.dataDir || deps.clock
    ? createDataStore({ dataDir: deps.dataDir ?? config.dataDir, clock })
    : getDefaultStore();

  const ctx = {
    store,
    visionProvider: deps.visionProvider ?? createVisionProvider(config),
    notifier: deps.notifier ?? createNotifier(config),
    assistantProvider: deps.assistantProvider,
    clock,
    rateLimiter: deps.rateLimiter ?? createRateLimiter({ clock }),
    config,
    newId: deps.newId ?? (() => randomUUID()),
    a2a: deps.a2a,
  };

  const app = express();

  if (config.trustProxy !== undefined) app.set('trust proxy', config.trustProxy);

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.use(createHomeRouter(ctx));
  app.use(createListingsRouter(ctx));
  app.use(createApiRouter(ctx));
  app.use(createLlmsRouter(ctx));
  app.use(createSitemapRouter(ctx));
  app.use(createRiseRouter(ctx));
  app.use(createMcpRouter(ctx));

  if (ctx.a2a) mountA2A(app, ctx.a2a); // registers BOTH the card route and ctx.a2a.path together

  // Catch-all 404
  app.use((req, res) => {
    res.status(404).type('html').send(layout({
      title: 'Page not found',
      body: '<section class="message"><h1>Page not found</h1><p><a href="/">Back to the directory</a></p></section>',
    }));
  });

  // Generic 500 handler — no stack trace in the response
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    process.stderr.write(`[error] ${err.stack ?? err}\n`);
    res.status(500).type('html').send(layout({
      title: 'Something went wrong',
      body: '<section class="message"><h1>Something went wrong</h1><p><a href="/">Back to the directory</a></p></section>',
    }));
  });

  // Exposed for later tasks and tests (not part of Express's own API)
  app.locals.ctx = ctx;

  return app;
}

export default createApp();
