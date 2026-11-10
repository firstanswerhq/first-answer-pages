/**
 * listings.js — GET /listings/:id — individual listing page
 */

import express, { Router } from 'express';
import { buildSchema } from '../lib/schema.js';
import { layout, listingDetail, quoteForm, escapeHtml } from '../lib/html.js';
import { submitQuote } from '../lib/quotes.js';
import { verificationFor } from '../lib/verifier.js';
import { publicListing } from '../lib/public-listing.js';
import { createSeanceStore } from '../lib/seance.js';

const formParser = express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 10 });

function messagePage(title, text, backHref) {
  const back = backHref ? `<p><a href="${escapeHtml(backHref)}">Back to the listing</a></p>` : '';
  return layout({
    title,
    body: `<section class="message"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${back}</section>`,
  });
}

const QUOTE_ERRORS = {
  contact: 'Please enter a phone number or email.',
  name: 'Please enter your name.',
  details: 'Please tell the business what you need.',
};

/**
 * @param {object} ctx
 * @returns {import('express').Router}
 */
export function createListingsRouter(ctx) {
  const router = Router();
  const { store } = ctx;

  const seanceHistory = createSeanceStore(store);

  /** True when the listing has at least one Séance run. A missing or unreadable history counts as none. */
  async function hasSeanceRuns(id) {
    try {
      return (await seanceHistory.list(id)).length > 0;
    } catch {
      return false;
    }
  }

  /** Full listing page; shared by GET and the 422 quote re-render. */
  function renderListingPage(stored, { sent = false, error, values, hasSeance = false } = {}) {
    const listing = publicListing(stored);
    // hashListing strips ownerEmail too, so this equals /api/verify/:id
    const verification = verificationFor(store, listing);
    const jsonLd = JSON.stringify(buildSchema(listing, verification, { baseUrl: ctx.config?.baseUrl }), null, 2);
    const sentNotice = sent
      ? `<p class="notice success-box" role="status">${escapeHtml(`Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at ${listing.phone}.`)}</p>\n`
      : '';
    // JSON-LD goes to layout() only, so the page has exactly one ld+json block
    const detail = listingDetail(listing, undefined, {
      categories: store.getCategories(), verification, hasSeanceRuns: hasSeance,
    });
    const form = quoteForm(listing, { error, values });
    // After a failed submit the error and form come first so a phone shows them without scrolling.
    return layout({
      title: `${listing.name} | First Answer Pages`,
      body: sentNotice + (error ? form + '\n' + detail : detail + '\n' + form),
      jsonLd,
      scripts: ['/js/webmcp.js'],
    });
  }

  router.post('/listings/:id/quote', (req, res, next) => {
    // 404 first so unknown ids never reach body parsing
    if (!store.findById(req.params.id)) {
      return res.status(404).type('html').send(messagePage('Listing not found', 'There is no listing with that address.', '/'));
    }
    formParser(req, res, err => {
      if (err) {
        if (err.type === 'entity.too.large') {
          return res.status(413).type('html').send(messagePage('Request too large', 'The form is too large.'));
        }
        return res.status(400).type('html').send(messagePage('Bad request', 'The form could not be read.'));
      }
      next();
    });
  }, async (req, res, next) => {
    try {
      const id = req.params.id;
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const back = `/listings/${encodeURIComponent(id)}`;
      // Path id always wins over any id in the body
      const result = await submitQuote(ctx, { ...body, id }, req.ip);

      if (result.status === 'ok') {
        return res.redirect(303, `${back}?quote=sent`);
      }
      if (result.status === 'rate_limited') {
        res.set('Retry-After', String(result.retryAfterSeconds));
        return res.status(429).type('html').send(messagePage(
          'Too many requests',
          `Please wait ${result.retryAfterSeconds} seconds and try again.`,
          back,
        ));
      }
      const kept = field => (typeof body[field] === 'string' ? body[field].slice(0, 2000) : '');
      return res.status(422).type('html').send(renderListingPage(store.findById(id), {
        error: QUOTE_ERRORS[result.argument] || `Please check the ${result.argument} field.`,
        values: { name: kept('name'), contact: kept('contact'), details: kept('details') },
        hasSeance: await hasSeanceRuns(id),
      }));
    } catch (err) {
      next(err);
    }
  });

  // A refresh or a copied link after a failed submit lands here; send people to the listing.
  router.get('/listings/:id/quote', (req, res) => {
    if (!store.findById(req.params.id)) {
      return res.status(404).type('html').send(messagePage('Listing not found', 'There is no listing with that address.', '/'));
    }
    res.redirect(303, `/listings/${encodeURIComponent(req.params.id)}`);
  });

  router.get('/listings/:id', async (req, res, next) => {
    const stored = store.findById(req.params.id);

    if (!stored) {
      return res.status(404).type('html').send(layout({
        title: 'Listing not found',
        body: '<section class="message"><h1>Listing not found</h1><p><a href="/">Back to the directory</a></p></section>',
      }));
    }

    try {
      res.status(200).type('html').send(renderListingPage(stored, {
        sent: req.query.quote === 'sent',
        hasSeance: await hasSeanceRuns(stored.id),
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
