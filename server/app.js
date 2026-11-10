/**
 * app.js — Express app setup, middleware and route registration
 */

import express from 'express';
import { fileURLToPath } from 'node:url';

import homeRouter     from './routes/home.js';
import listingsRouter from './routes/listings.js';
import apiRouter      from './routes/api.js';
import llmsRouter     from './routes/llms.js';
import sitemapRouter  from './routes/sitemap.js';
import { layout }     from './lib/html.js';

const app = express();

app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

app.use(homeRouter);
app.use(listingsRouter);
app.use(apiRouter);
app.use(llmsRouter);
app.use(sitemapRouter);

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

export default app;
