/**
 * watch.js: the monthly watch's routes (addon-monthly-watch task 8).
 *
 *   POST /grade/:id/watch         start a watch from the full report (form stamp, 5 an hour per client)
 *   GET  /watch/:id               the owner's watch page
 *   GET  /watch/:id/confirm?t=    a page with a Confirm button (changes nothing)
 *   POST /watch/:id/confirm       confirm the email (20 an hour per client)
 *   GET  /watch/:id/stop?t=       a page with a Stop watching button (changes nothing)
 *   POST /watch/:id/stop          delete the watch and its email (also the one-click List-Unsubscribe-Post);
 *                                 counted, never refused, no sign-in
 *
 * With WATCH_ENABLED off (or the Grader off) every one of these paths falls through to the site's 404. Every reply
 * is noindex, never cached and sends no referrer. Logs hold the watch id only (the service logs).
 */

import express, { Router } from 'express';
import { RULES } from '../lib/rate-limiter.js';
import { signFormStamp, checkFormStamp, hasValidCookie } from '../lib/grade-stamp.js';
import { freeQuestion } from '../lib/grader.js';
import { normalizeEmail } from '../lib/listing-fields.js';
import { maskEmail } from '../lib/watch.js';
import {
  watchPage, confirmPage, confirmedPage, stopPage, stoppedPage, watchMessagePage, watchNotFoundPage, WATCH_FULL_TEXT,
} from '../lib/watch-html.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEADERS = Object.freeze({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' });

const isOn = ctx => ctx.config.watchEnabled === true && ctx.config.graderEnabled !== false && Boolean(ctx.watch);
/** Email alerts only with the Resend notifier (requirement 12). */
const emailOn = ctx => ctx.config.notifierName === 'resend';
const tokenOf = v => (typeof v === 'string' && TOKEN_PATTERN.test(v) ? v : '');

/**
 * What the report's watch block needs, or null when it shows nothing: the watch is off, the Grade is not done, or
 * the business has not claimed a listing. The route that shows the full report calls this.
 */
export async function watchOfferFor(ctx, grade, extra = {}) {
  if (!isOn(ctx) || !grade || grade.status !== 'done') return null;
  if (!(await ctx.grader.watchEligible(grade.id))) return null;
  return {
    full: await ctx.watch.isFull(),
    emailOn: emailOn(ctx),
    stamp: signFormStamp(ctx.config.graderSecret, ctx.clock.now()),
    ...extra,
  };
}

export function createWatchRouter(ctx) {
  const router = Router();
  const form = express.urlencoded({ extended: false, limit: '8kb' });
  const html = (res, status, body) => res.status(status).type('html').send(body);
  const notFound = res => html(res, 404, watchNotFoundPage());
  const tooMany = (res, retryAfterSeconds) => {
    res.set('Retry-After', String(retryAfterSeconds));
    return html(res, 429, watchMessagePage('Please slow down', 'We have had a lot of requests from your internet connection. Please try again a little later.'));
  };
  const leadGate = () => ctx.config.graderLeadGate !== false;
  const fullAccess = (req, grade) => grade?.status === 'done'
    && (!leadGate() || hasValidCookie(ctx.config.graderSecret, 'unlock', grade.id, req.headers.cookie));

  // Off switch, then the headers for every watch reply.
  const guard = (req, res, next) => {
    res.set(HEADERS);
    if (!isOn(ctx)) return next('router');
    return next();
  };
  router.use('/watch', guard);
  router.post('/grade/:id/watch', guard);

  // ---- start ----------------------------------------------------------------------------------------------------
  router.post('/grade/:id/watch', form, async (req, res, next) => {
    try {
      const { id } = req.params;
      const grade = ID_PATTERN.test(id) ? await ctx.grader.get(id) : undefined;
      if (!grade || grade.status !== 'done') return notFound(res);
      const back = `/grade/${grade.id}#full-report`;
      if (!fullAccess(req, grade)) return res.redirect(303, `/grade/${grade.id}`);
      const backLink = { href: back, text: 'Back to the report' };

      const body = req.body ?? {};
      if (!checkFormStamp(ctx.config.graderSecret, body.t, ctx.clock.now()).ok) {
        return html(res, 422, watchMessagePage('That did not go through', 'Please go back to the report and press the button again.', backLink));
      }
      const typed = emailOn(ctx) && typeof body.email === 'string' ? body.email.trim() : '';
      const email = typed === '' ? null : normalizeEmail(typed);
      if (typed !== '' && !email) {
        return html(res, 422, watchMessagePage('Check the email address', 'Type a real email address, like name@example.com, or leave it empty.', backLink));
      }

      const limited = ctx.rateLimiter.consume(`watch-start:${req.ip}`, RULES['watch-start']);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      const result = await ctx.watch.start({ gradeId: grade.id, email });
      if (result.ok) return res.redirect(303, `/watch/${encodeURIComponent(result.watch.id)}`);
      if (result.reason === 'full') return html(res, 200, watchMessagePage('Monthly watch is full', WATCH_FULL_TEXT, backLink));
      if (result.reason === 'email') {
        return html(res, 422, watchMessagePage('Check the email address', 'Type a real email address, like name@example.com, or leave it empty.', backLink));
      }
      return res.redirect(303, `/grade/${grade.id}`);
    } catch (err) {
      return next(err);
    }
  });

  // ---- the watch page -------------------------------------------------------------------------------------------
  router.get('/watch/:id', async (req, res, next) => {
    try {
      const { id } = req.params;
      const watch = ID_PATTERN.test(id) ? await ctx.watch.get(id) : undefined;
      if (!watch) return notFound(res);
      return html(res, 200, watchPage(watch, { maskedEmail: maskEmail(watch.email), question: freeQuestion(watch.input) }));
    } catch (err) {
      return next(err);
    }
  });

  // ---- confirm --------------------------------------------------------------------------------------------------
  router.get('/watch/:id/confirm', async (req, res, next) => {
    try {
      const { id } = req.params;
      const watch = ID_PATTERN.test(id) ? await ctx.watch.get(id) : undefined;
      if (!watch) return notFound(res);
      // A button, never an action: a mail scanner opening the link confirms nothing.
      return html(res, 200, confirmPage(watch.id, tokenOf(req.query.t)));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/watch/:id/confirm', form, async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!ID_PATTERN.test(id)) return notFound(res);
      const limited = ctx.rateLimiter.consume(`watch-manage:${req.ip}`, RULES['watch-manage']);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);
      const result = await ctx.watch.confirm(id, tokenOf(req.body?.t ?? req.query.t));
      if (result.ok) return html(res, 200, confirmedPage(id));
      if (result.state === 'not_found') return notFound(res);
      return html(res, 400, watchMessagePage('That link did not work', 'Open the newest email from us and press Confirm again.'));
    } catch (err) {
      return next(err);
    }
  });

  // ---- stop -----------------------------------------------------------------------------------------------------
  router.get('/watch/:id/stop', async (req, res, next) => {
    try {
      const { id } = req.params;
      const watch = ID_PATTERN.test(id) ? await ctx.watch.get(id) : undefined;
      if (!watch) return html(res, 200, stoppedPage());
      return html(res, 200, stopPage(watch.id, tokenOf(req.query.t)));
    } catch (err) {
      return next(err);
    }
  });

  // The page's button and the one-click List-Unsubscribe-Post both land here; the token is in the form or the address.
  router.post('/watch/:id/stop', form, async (req, res, next) => {
    try {
      const { id } = req.params;
      // Counted, never refused (requirement 16).
      ctx.rateLimiter.consume(`watch-manage:${req.ip}`, RULES['watch-manage']);
      if (!ID_PATTERN.test(id)) return notFound(res);
      const token = tokenOf(req.body?.t) || tokenOf(req.query.t);
      const result = await ctx.watch.stop(id, token);
      if (result.ok) return html(res, 200, stoppedPage());
      const still = await ctx.watch.get(id);
      // Already stopped (or never there): say so. A wrong token keeps the watch.
      if (!still) return html(res, 200, stoppedPage());
      return html(res, 400, watchMessagePage('That link did not work', 'Open your watch page and press Stop watching there.'));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
