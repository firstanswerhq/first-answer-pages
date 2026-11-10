/**
 * listings.js — GET /listings/:id — individual listing page
 */

import express, { Router } from 'express';
import { buildSchema } from '../lib/schema.js';
import { layout, listingDetail, quoteForm, escapeHtml } from '../lib/html.js';
import { submitQuote } from '../lib/quotes.js';
import { verificationFor } from '../lib/verifier.js';
import { publicListing } from '../lib/public-listing.js';

const formParser = express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 10 });

function messagePage(title, text, backHref) {
  const back = backHref ? `<p><a href="${escapeHtml(backHref)}">Back to the listing</a></p>` : '';
  return layout({
    title,
    body: `<section class="message"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${back}</section>`,
  });
}

/**
 * @param {object} ctx
 * @returns {import('express').Router}
 */
export function createListingsRouter(ctx) {
  const router = Router();
  const { store } = ctx;

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
      return res.status(422).type('html').send(messagePage(
        'Request not sent',
        `Please check the ${result.argument} field. ${result.message}`,
        back,
      ));
    } catch (err) {
      next(err);
    }
  });

  router.get('/listings/:id', (req, res, next) => {
    const stored = store.findById(req.params.id);

    if (!stored) {
      return res.status(404).type('html').send(layout({
        title: 'Listing not found',
        body: '<section class="message"><h1>Listing not found</h1><p><a href="/">Back to the directory</a></p></section>',
      }));
    }

    try {
      const listing = publicListing(stored);
      // hashListing strips ownerEmail too, so this equals /api/verify/:id
      const verification = verificationFor(store, listing);
      const jsonLd = JSON.stringify(buildSchema(listing, verification), null, 2);
      const sentNotice = req.query.quote === 'sent'
        ? `\n<p class="notice" role="status">${escapeHtml(`Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at ${listing.phone}.`)}</p>`
        : '';
      // JSON-LD goes to layout() only, so the page has exactly one ld+json block
      res.status(200).type('html').send(layout({
        title: `${listing.name} | First Answer Pages`,
        body: listingDetail(listing, undefined, { categories: store.getCategories(), verification }) + sentNotice + '\n' + quoteForm(listing),
        jsonLd,
        scripts: ['/js/webmcp.js'],
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
