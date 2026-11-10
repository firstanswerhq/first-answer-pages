/**
 * listings.js — GET /listings/:id — individual listing page
 */

import { Router } from 'express';
import { buildSchema } from '../lib/schema.js';
import { layout, listingDetail } from '../lib/html.js';

/**
 * @param {{ store: object }} ctx
 * @returns {import('express').Router}
 */
export function createListingsRouter(ctx) {
  const router = Router();
  const { store } = ctx;

  router.get('/listings/:id', (req, res, next) => {
    const listing = store.findById(req.params.id);

    if (!listing) {
      return res.status(404).type('html').send(layout({
        title: 'Listing not found',
        body: '<section class="message"><h1>Listing not found</h1><p><a href="/">Back to the directory</a></p></section>',
      }));
    }

    try {
      const jsonLd = JSON.stringify(buildSchema(listing), null, 2);
      // JSON-LD goes to layout() only, so the page has exactly one ld+json block
      res.status(200).type('html').send(layout({
        title: `${listing.name} | First Answer Pages`,
        body: listingDetail(listing, undefined, { categories: store.getCategories() }),
        jsonLd,
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
