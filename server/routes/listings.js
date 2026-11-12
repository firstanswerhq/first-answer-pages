/**
 * listings.js — GET /listings/:id — individual listing page
 */

import express, { Router } from 'express';
import { buildSchema } from '../lib/schema.js';
import { layout, listingDetail, quoteForm, escapeHtml, telLink } from '../lib/html.js';
import { submitQuote } from '../lib/quotes.js';
import { verificationFor } from '../lib/verifier.js';
import { publicListing } from '../lib/public-listing.js';
import { baseUrlFor } from '../lib/base-url.js';
import { createSeanceStore } from '../lib/seance.js';

const formParser = express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 10 });

function messagePage(title, text, backHref) {
  const back = backHref ? `<p><a href="${escapeHtml(backHref)}">Back to the listing</a></p>` : '';
  return layout({
    title,
    body: `<section class="message"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>${back}</section>`,
  });
}

/** Shown when the visitor typed a contact that is neither a phone number nor an email. */
const QUOTE_CONTACT_INVALID = "That doesn't look like a phone number or email.";

const QUOTE_ERRORS = {
  contact: 'Please enter a phone number or email.',
  name: 'Please enter your name.',
  details: 'Please tell the business what you need.',
};

/**
 * @param {object} ctx
 * @returns {import('express').Router}
 */
/** One business of each trade, for the meta description ("a plumber"). */
const TRADE_NOUNS = Object.freeze({
  plumbers: 'a plumber',
  electricians: 'an electrician',
  'auto-repair': 'an auto repair shop',
  'hair-salons': 'a hair salon',
  lawyers: 'a lawyer',
  cleaners: 'a cleaning company',
  landscapers: 'a landscaper',
  'pressure-washing': 'a pressure washing company',
  'pools-and-concrete': 'a pool and concrete company',
  'shops-and-restaurants': 'a local business',
  roofers: 'a roofer',
  hvac: 'a heating and air company',
});

const META_MAX = 160;

/** "a, b and c" */
function joinList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Meta description for a listing page, e.g. "Acme Plumbing is a plumber in
 * Nashville, TN offering drain cleaning, leak repair and water heaters. Call
 * (615) 555-0100." Up to 3 services; services are dropped (then the sentence
 * trimmed) to stay within about 160 characters. Plain text: layout() escapes it.
 * @param {object} listing
 * @returns {string}
 */
export function listingMetaDescription(listing) {
  const name = String(listing?.name ?? '').replace(/\s+/g, ' ').trim();
  const trade = TRADE_NOUNS[listing?.category] ?? 'a local business';
  const place = [listing?.city, listing?.state].filter(v => typeof v === 'string' && v.trim() !== '').map(v => v.trim()).join(', ');
  const phone = String(listing?.phone ?? '').trim();
  const services = (Array.isArray(listing?.services) ? listing.services : [])
    .filter(x => typeof x === 'string' && x.trim() !== '')
    .map(x => x.replace(/\s+/g, ' ').trim())
    // "Drain cleaning" reads as "drain cleaning" mid-sentence; acronyms like "HVAC" stay.
    .map(x => (/^[A-Z][a-z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x))
    .slice(0, 3);
  const build = list => `${name} is ${trade}${place ? ` in ${place}` : ''}${list.length ? ` offering ${joinList(list)}` : ''}.${phone ? ` Call ${phone}.` : ''}`;
  for (let n = services.length; n >= 0; n--) {
    const text = build(services.slice(0, n));
    if (text.length <= META_MAX) return text;
  }
  const text = build([]);
  return text.length <= META_MAX ? text : `${text.slice(0, META_MAX - 1).trimEnd()}\u2026`;
}

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
  function renderListingPage(req, stored, { sent = false, error, values, hasSeance = false } = {}) {
    const listing = publicListing(stored);
    // hashListing strips ownerEmail too, so this equals /api/verify/:id
    const verification = verificationFor(store, listing);
    const jsonLd = JSON.stringify(buildSchema(listing, verification, { baseUrl: baseUrlFor(req, ctx.config) }), null, 2);
    const sentNotice = sent
      ? `<p class="notice success-box" role="status">${escapeHtml("Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at ")}${telLink(listing.phone)}.</p>\n`
      : '';
    // JSON-LD goes to layout() only, so the page has exactly one ld+json block
    const detail = listingDetail(listing, undefined, {
      categories: store.getCategories(), verification, hasSeanceRuns: hasSeance,
    });
    const form = quoteForm(listing, { error, values });
    // After a failed submit the error and form come first so a phone shows them without scrolling.
    const base = baseUrlFor(req, ctx.config);
    const description = listingMetaDescription(listing);
    return layout({
      title: `${listing.name} | First Answer Pages`,
      body: sentNotice + (error ? form + '\n' + detail : detail + '\n' + form),
      jsonLd,
      scripts: ['/js/webmcp.js'],
      // The canonical never carries ?quote=sent or a failed form's path.
      canonical: `${base}/listings/${encodeURIComponent(listing.id)}`,
      description,
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
      return res.status(422).type('html').send(renderListingPage(req, store.findById(id), {
        // Something typed that isn't a phone or email gets a different line than an empty box.
        error: result.argument === 'contact' && kept('contact').trim() !== ''
          ? QUOTE_CONTACT_INVALID
          : QUOTE_ERRORS[result.argument] || `Please check the ${result.argument} field.`,
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
    try {
      // Inside the try: an async handler's throw would otherwise be an unhandled rejection.
      const stored = store.findById(req.params.id);

      if (!stored) {
        return res.status(404).type('html').send(layout({
          title: 'Listing not found',
          body: '<section class="message"><h1>Listing not found</h1><p><a href="/">Back to the directory</a></p></section>',
        }));
      }

      res.status(200).type('html').send(renderListingPage(req, stored, {
        sent: req.query.quote === 'sent',
        hasSeance: await hasSeanceRuns(stored.id),
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
