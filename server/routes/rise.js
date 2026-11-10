/**
 * rise.js — Rise from the Grave: upload an image, review the draft, confirm.
 *
 *   GET  /rise                       upload form (works without JavaScript)
 *   POST /rise                       raw image, or urlencoded base64 field
 *   GET  /rise/drafts/:id            editable review form
 *   POST /rise/drafts/:id            save edits
 *   POST /rise/drafts/:id/confirm    validate and send for review (admin approval publishes)
 *   POST /rise/drafts/:id/discard    delete an unpublished draft
 *
 * Image bytes live only in the request scope: nothing is written to disk.
 */

import express, { Router } from 'express';
import { RULES } from '../lib/rate-limiter.js';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_FORM_BYTES, detectImageType, decodeBase64Image } from '../lib/upload.js';
import { extractDraft, ExtractionError } from '../lib/extractor.js';
import { createDraftStore, draftProvider } from '../lib/drafts.js';
import { validateFields, DAYS } from '../lib/listing-fields.js';
import { uploadPage, reviewPage, messagePage } from '../lib/rise-html.js';

const FORM_TYPE = 'application/x-www-form-urlencoded';
const DRAFT_FORM_LIMIT = 64 * 1024;

/** Base media type of a Content-Type header, lower-cased, or ''. */
function baseType(header) {
  return typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : '';
}

/** Run a body parser as a promise. */
function runParser(parser, req, res) {
  return new Promise((resolve, reject) => {
    parser(req, res, err => (err ? reject(err) : resolve()));
  });
}

const PENDING_MESSAGE = "Thanks! We'll review your listing and it will be live soon.";
const HOME_LINK = { href: '/', text: 'Back to the directory' };

function sendPage(res, status, html) {
  res.status(status).type('html').send(html);
}

/** Splits services textarea text into trimmed non-empty lines. */
function parseServices(value) {
  if (typeof value !== 'string') return [];
  return value.split(/\r?\n/).map(s => s.trim()).filter(s => s !== '');
}

/** Builds raw listing fields from an urlencoded review-form body. */
function fieldsFromForm(body) {
  const b = body !== null && typeof body === 'object' ? body : {};
  const str = key => (typeof b[key] === 'string' ? b[key] : '');
  const hours = {};
  for (const day of DAYS) hours[day] = str(`hours_${day}`);
  return {
    name: str('name'),
    category: str('category'),
    phone: str('phone'),
    services: parseServices(b.services),
    serviceArea: str('serviceArea'),
    description: str('description'),
    city: str('city'),
    state: str('state'),
    address: str('address'),
    ownerEmail: str('ownerEmail'),
    hours,
  };
}

/**
 * @param {object} ctx resolved dependencies from createApp
 * @returns {import('express').Router}
 */
export function createRiseRouter(ctx) {
  const router = Router();
  const drafts = createDraftStore({ store: ctx.store, clock: ctx.clock, newId: ctx.newId });
  const rawParser = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES });
  const formParser = express.urlencoded({ extended: false, limit: MAX_FORM_BYTES, parameterLimit: 10 });
  const draftFormParser = express.urlencoded({ extended: false, limit: DRAFT_FORM_LIMIT, parameterLimit: 20 });

  // Draft pages are capability links: never cached, indexed, or leaked via Referer.
  router.use('/rise/drafts', (req, res, next) => {
    res.set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });

  // In production, the mock reader must never accept owner uploads.
  const photoListingClosed = () => ctx.config.production === true && ctx.visionProvider?.name === 'mock';
  const comingSoon = res => sendPage(res, 503, messagePage('Photo listing is coming soon', 'Photo listing is coming soon.', HOME_LINK));

  router.get('/rise', (req, res) => {
    if (photoListingClosed()) return comingSoon(res);
    sendPage(res, 200, uploadPage({ baseUrl: ctx.config.baseUrl }));
  });

  router.post('/rise', async (req, res, next) => {
    try {
      if (photoListingClosed()) return comingSoon(res);
      // 1. Rate limit: every attempt counts, including rejected ones.
      const limited = ctx.rateLimiter.consume(`rise:${req.ip}`, RULES.rise);
      if (!limited.allowed) {
        res.set('Retry-After', String(limited.retryAfterSeconds));
        return sendPage(res, 429, messagePage('Too many uploads', `Please wait ${limited.retryAfterSeconds} seconds and try again.`));
      }

      // 2. Content type, before reading the body.
      const type = baseType(req.headers['content-type']);
      const isImage = ACCEPTED_IMAGE_TYPES.includes(type);
      if (!isImage && type !== FORM_TYPE) {
        return sendPage(res, 415, messagePage('Unsupported file type', `Send a ${ACCEPTED_IMAGE_TYPES.join(', ')} image.`));
      }

      // 3. Read the body with the matching limit.
      try {
        await runParser(isImage ? rawParser : formParser, req, res);
      } catch (err) {
        if (err && err.type === 'entity.too.large') {
          return sendPage(res, 413, messagePage('Image too large', 'The upload is larger than 5 MiB.'));
        }
        return sendPage(res, 400, messagePage('Upload could not be read', 'The upload could not be read. Please try again.'));
      }

      // 4. Get the image bytes.
      let bytes;
      if (isImage) {
        bytes = Buffer.isBuffer(req.body) ? req.body : null;
        if (!bytes || bytes.length === 0) {
          return sendPage(res, 400, messagePage('No image', 'No image was received.'));
        }
      } else {
        const field = req.body && typeof req.body.imageBase64 === 'string' ? req.body.imageBase64 : '';
        if (field.trim() === '') {
          return sendPage(res, 400, messagePage('No image', 'No image was received.'));
        }
        bytes = decodeBase64Image(field);
        if (!bytes) {
          return sendPage(res, 400, messagePage('Bad image data', 'The image data could not be decoded.'));
        }
      }

      // 5. Signature check, then decoded size.
      const detected = detectImageType(bytes);
      if (!detected || (isImage && detected !== type)) {
        return sendPage(res, 415, messagePage('Unsupported file type', 'The file content does not match a JPEG, PNG, or WebP image.'));
      }
      if (bytes.length > MAX_IMAGE_BYTES) {
        return sendPage(res, 413, messagePage('Image too large', 'The image is larger than 5 MiB.'));
      }

      // 6. Extract. Failure stores nothing.
      let extracted;
      try {
        extracted = await extractDraft({
          provider: ctx.visionProvider,
          bytes,
          mimeType: detected,
          categories: ctx.store.getCategories(),
          timeoutMs: ctx.config.providerTimeoutMs,
        });
      } catch (err) {
        if (err instanceof ExtractionError) {
          return sendPage(res, 502, messagePage('Could not read the ad', 'We could not read that image. Please try again later.'));
        }
        throw err;
      }

      const created = await drafts.create({ fields: extracted.fields, missingFields: extracted.missingFields, provider: ctx.visionProvider?.name });
      res.redirect(303, `/rise/drafts/${encodeURIComponent(created.draft.id)}`);
    } catch (err) {
      next(err);
    }
  });

  router.get('/rise/drafts/:id', async (req, res, next) => {
    try {
      const found = await drafts.get(req.params.id);
      if (found.status !== 200) {
        return sendPage(res, 404, messagePage('Draft not found', 'That draft does not exist or was discarded.'));
      }
      if (found.draft.status === 'pending') {
        return sendPage(res, 200, messagePage('Thanks!', PENDING_MESSAGE, HOME_LINK));
      }
      if (found.draft.status === 'rejected') {
        return sendPage(res, 200, messagePage('Not approved', 'This listing was not approved.', HOME_LINK));
      }
      sendPage(res, 200, reviewPage(found.draft, ctx.store.getCategories()));
    } catch (err) {
      next(err);
    }
  });

  router.post('/rise/drafts/:id', async (req, res, next) => {
    try {
      try {
        await runParser(draftFormParser, req, res);
      } catch (err) {
        if (err && err.type === 'entity.too.large') {
          return sendPage(res, 413, messagePage('Form too large', 'The form is too large.'));
        }
        return sendPage(res, 400, messagePage('Form could not be read', 'The form could not be read. Please try again.'));
      }
      const { fields, missingFields } = validateFields(fieldsFromForm(req.body), ctx.store.getCategories());
      const result = await drafts.updateFields(req.params.id, fields, missingFields);
      if (result.status === 404) {
        return sendPage(res, 404, messagePage('Draft not found', 'That draft does not exist or was discarded.'));
      }
      if (result.status === 409) {
        return sendPage(res, 409, messagePage('Draft locked', 'This draft was already sent for review or published and can no longer be edited.', HOME_LINK));
      }
      res.redirect(303, `/rise/drafts/${encodeURIComponent(req.params.id)}`);
    } catch (err) {
      next(err);
    }
  });

  router.post('/rise/drafts/:id/confirm', async (req, res, next) => {
    try {
      // Confirm validates and queues the draft for review; it never publishes.
      if (ctx.config.production === true) {
        const existing = await drafts.get(req.params.id);
        if (existing.status === 200 && draftProvider(existing.draft) === 'mock') {
          return sendPage(res, 409, messagePage('Cannot confirm', 'This draft came from the demo photo reader and cannot be sent for review in production.', HOME_LINK));
        }
      }
      const result = await ctx.store.submitDraft(req.params.id);
      if (result.status === 200 && result.listing) {
        return res.redirect(303, `/listings/${encodeURIComponent(result.listing.id)}`);
      }
      if (result.status === 200) {
        return res.redirect(303, `/rise/drafts/${encodeURIComponent(req.params.id)}`);
      }
      if (result.status === 422) {
        const found = await drafts.get(req.params.id);
        if (found.status !== 200) {
          return sendPage(res, 404, messagePage('Draft not found', 'That draft does not exist or was discarded.'));
        }
        return sendPage(res, 422, reviewPage(found.draft, ctx.store.getCategories(), {
          missingFields: result.missingFields ?? [],
          notice: 'The listing cannot be sent for review yet. Fix the highlighted fields and save, then confirm again.',
        }));
      }
      if (result.status === 404) {
        return sendPage(res, 404, messagePage('Draft not found', 'That draft does not exist or was discarded.'));
      }
      sendPage(res, 409, messagePage('Cannot confirm', result.error ?? 'This draft cannot be confirmed.', HOME_LINK));
    } catch (err) {
      next(err);
    }
  });

  router.post('/rise/drafts/:id/discard', async (req, res, next) => {
    try {
      const result = await drafts.discard(req.params.id);
      if (result.status === 200) return res.redirect(303, '/rise');
      if (result.status === 409) {
        return sendPage(res, 409, messagePage('Cannot discard', 'This draft is published or being published, so it cannot be discarded.', { href: '/', text: 'Back to the directory' }));
      }
      sendPage(res, 404, messagePage('Draft not found', 'That draft does not exist or was discarded.'));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
