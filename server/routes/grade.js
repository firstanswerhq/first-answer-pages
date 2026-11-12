/**
 * grade.js — the AI Visibility Grader's public routes.
 *
 *   GET  /grade                  form
 *   POST /grade                  validate, start, 303 to the report
 *   GET  /grade/about            what the Grader reads and why
 *   GET  /grade/:id              scan screen, report, or "did not finish" page
 *   GET  /grade/:id/status.json  { status, steps, done } for the optional script
 *
 * Every /grade response is not indexed and sends no referrer. With
 * GRADER_ENABLED=off every /grade path is a 404. Grade_Ids are 22-character
 * base64url strings; anything else is a 404 without a store read.
 */

import express, { Router } from 'express';
import { RULES } from '../lib/rate-limiter.js';
import { normalizeState, STATE_ERROR, US_STATE_CODES } from '../lib/listing-fields.js';
import { makeStamp, checkStamp, unlockToken, hasToken } from '../lib/grade-stamp.js';
import {
  gradeFormPage, scanPage, reportPage, failedPage, aboutPage, gradeMessagePage,
} from '../lib/grade-html.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const CONTROL = /[\p{Cc}\u2028\u2029]/gu;

const tidy = value => (typeof value === 'string' ? value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : '');
const len = text => Array.from(text).length;

/**
 * A typed website as `https://<host>/` (or http), or an error.
 * @returns {{ website: string|null } | { error: string }}
 */
export function normalizeWebsite(text) {
  const typed = tidy(text);
  if (typed === '') return { website: null };
  if (len(typed) > 200) return { error: 'That website address is too long.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'Type your website like example.com, or leave it blank.' };
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '' || url.username || url.password) {
    return { error: 'Type your website like example.com, or leave it blank.' };
  }
  return { website: `${url.protocol}//${url.host}/` };
}

/** Validate the form body. Returns { values, errors, input }. */
export function validateGradeForm(body) {
  const b = body !== null && typeof body === 'object' ? body : {};
  const values = {
    name: tidy(b.name), city: tidy(b.city), state: tidy(b.state), service: tidy(b.service), website: tidy(b.website),
  };
  const errors = {};
  if (values.name === '' || len(values.name) > 120) errors.name = 'Type your business name (up to 120 characters).';
  if (values.city === '' || len(values.city) > 80) errors.city = 'Type your city (up to 80 characters).';
  const state = normalizeState(values.state);
  // normalizeState hands back anything it does not know as typed, so check the code itself.
  if (!US_STATE_CODES.has(state)) errors.state = STATE_ERROR;
  if (values.service === '' || len(values.service) > 60) errors.service = 'Say what you do, like roofers (up to 60 characters).';
  const site = normalizeWebsite(values.website);
  if (site.error) errors.website = site.error;
  const input = Object.keys(errors).length === 0
    ? { name: values.name, city: values.city, state, service: values.service, website: site.website }
    : undefined;
  return { values, errors, input };
}

/**
 * @param {object} ctx resolved dependencies from createApp (needs ctx.grader)
 * @returns {import('express').Router}
 */
export function createGradeRouter(ctx) {
  const router = Router();
  const { grader, config } = ctx;
  const secret = config.graderSecret;
  const formParser = express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 });

  const send = (res, status, html) => res.status(status).type('html').send(html);
  const notFound = res => send(res, 404, gradeMessagePage('Page not found', "We can't find that report.", { href: '/grade', text: 'Grade a business' }));
  const newStamp = () => makeStamp(secret, ctx.clock.now());

  // Every /grade response: not indexed, no referrer, never cached.
  router.use('/grade', (req, res, next) => {
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    if (config.graderEnabled === false) return notFound(res);
    return next();
  });

  router.get('/grade', (req, res) => {
    send(res, 200, gradeFormPage({ stamp: newStamp(), categories: ctx.store.getCategories() }));
  });

  router.post('/grade', formParser, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const again = (status, values, errors) => send(res, status, gradeFormPage({
        values, errors, stamp: newStamp(), categories: ctx.store.getCategories(),
      }));
      const { values, errors, input } = validateGradeForm(body);

      // Honeypot and form timer: start nothing.
      if (typeof body.nickname === 'string' && body.nickname !== '') {
        return again(422, values, { form: 'Something went wrong. Please try again.' });
      }
      if (!checkStamp(secret, body.t, ctx.clock.now())) {
        return again(422, values, { form: 'That was too quick, or the page is old. Please send it again.' });
      }
      if (!input) return again(422, values, errors);

      const limited = ctx.rateLimiter.consumeAll([
        { key: `grade:${req.ip}`, ...RULES.grade },
        { key: `grade-day:${req.ip}`, ...RULES['grade-day'] },
      ]);
      if (!limited.allowed) {
        res.set('Retry-After', String(limited.retryAfterSeconds));
        return send(res, 429, gradeMessagePage(
          'Please wait',
          `You have checked a few businesses already. Please try again in ${limited.retryAfterSeconds} seconds.`,
        ));
      }

      const id = await grader.start(input);
      return res.redirect(303, `/grade/${encodeURIComponent(id)}`);
    } catch (err) {
      return next(err);
    }
  });

  // Registered before /grade/:id so "about" is never read as an id.
  router.get('/grade/about', (req, res) => {
    send(res, 200, aboutPage({ contactEmail: config.contactEmail, userAgent: ctx.graderUserAgent }));
  });

  router.get('/grade/:id/status.json', async (req, res, next) => {
    try {
      if (!ID_PATTERN.test(req.params.id)) return res.status(404).json({ error: 'Not found' });
      const status = await grader.statusOf(req.params.id);
      if (!status) return res.status(404).json({ error: 'Not found' });
      return res.json(status);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/grade/:id', async (req, res, next) => {
    try {
      if (!ID_PATTERN.test(req.params.id)) return notFound(res);
      const grade = await grader.get(req.params.id);
      if (!grade) return notFound(res);
      if (grade.status === 'running') return send(res, 200, scanPage(grade));
      if (grade.status === 'failed') return send(res, 200, failedPage(grade, { stamp: newStamp() }));
      const unlocked = hasToken(req, `g_${grade.id}`, unlockToken(secret, grade.id));
      return send(res, 200, reportPage(grade, {
        unlocked,
        leadGate: config.graderLeadGate !== false,
        contactEmail: config.contactEmail,
        now: Number(ctx.clock.now()),
      }));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
