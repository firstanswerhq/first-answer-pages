/**
 * grade.js — the AI Visibility Grader's public routes.
 *
 *   GET  /grade                    the form
 *   POST /grade                    check the form, start a Grade, 303 to the report
 *   GET  /grade/about              what the Grader reads and why
 *   GET  /grade/:id                scan screen, report, or "did not finish"
 *   GET  /grade/:id/status.json    { status, steps, done } for the optional script
 *   POST /grade/:id/unlock         lead form: store a Lead, open the full report
 *   POST /grade/:id/claim          create (or return) the free listing draft
 *   POST /grade/:id/recheck        read the website again, keep the AI answers
 *   POST /grade/:id/google-live    Google's live answer, shown once to the browser that ran the check
 *
 * Every /grade response is noindex and sends no referrer. With GRADER_ENABLED=off every
 * /grade path falls through to the site's 404. Logs hold only the Grade_Id.
 */

import express, { Router } from 'express';
import { RULES } from '../lib/rate-limiter.js';
import {
  signFormStamp, checkFormStamp, setCookieHeader, claimCookieHeader, readClaimedDraftId, hasValidCookie,
} from '../lib/grade-stamp.js';
import { normalizeGradeInput, freeQuestion } from '../lib/grader.js';
import { normalizeEmail, normalizePhone } from '../lib/listing-fields.js';
import {
  gradeFormPage, scanPage, reportPage, failedPage, aboutPage, googleLivePage, messagePage, notFoundPage,
} from '../lib/grade-html.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SECOND_OPINION_RESERVE = 12; // the day's last AI calls stay for new checks
const LIVE_TIMEOUT_MS = 60 * 1000;
const LIVE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'";

const cleanLine = v => String(v ?? '').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();

/** @param {object} ctx resolved dependencies from createApp */
export function createGradeRouter(ctx) {
  const router = Router();
  const form = express.urlencoded({ extended: false, limit: '8kb' });
  const secret = () => ctx.config.graderSecret;
  const production = () => ctx.config.production === true;
  const leadGate = () => ctx.config.graderLeadGate !== false;
  const now = () => ctx.clock.now();
  const html = (res, status, body) => res.status(status).type('html').send(body);
  const tooMany = (res, retryAfterSeconds) => {
    res.set('Retry-After', String(retryAfterSeconds));
    return html(res, 429, messagePage('Please slow down', 'We have had a lot of checks from your address. Please try again a little later.'));
  };
  const hasCookie = (kind, id, req) => hasValidCookie(secret(), kind, id, req.headers.cookie);

  // Off switch, then headers for every /grade response.
  router.use('/grade', (req, res, next) => {
    if (ctx.config.graderEnabled === false) return next('router');
    res.set({
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    return next();
  });

  // ---- the form ---------------------------------------------------------------------------
  const formPage = (res, status, { values = {}, errors = {} } = {}) => html(res, status, gradeFormPage({
    values, errors, stamp: signFormStamp(secret(), now()), categories: ctx.store.getCategories(),
  }));

  router.get('/grade', (req, res) => formPage(res, 200));

  router.post('/grade', form, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const checked = normalizeGradeInput(body);
      const honeypot = typeof body.nickname === 'string' && body.nickname.trim() !== '';
      if (honeypot || !checkFormStamp(secret(), body.t, now()).ok) {
        return formPage(res, 422, {
          values: checked.values, errors: { form: 'That did not go through. Please check your details and send the form again.' },
        });
      }
      if (!checked.ok) return formPage(res, 422, { values: checked.values, errors: checked.errors });

      const limited = ctx.rateLimiter.consumeAll([
        { key: `grade:${req.ip}`, ...RULES.grade },
        { key: `grade-day:${req.ip}`, ...RULES['grade-day'] },
      ]);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      const id = await ctx.grader.start(checked.input);
      // The browser that ran the check is the only one that may ask for Google's live answer.
      res.append('Set-Cookie', setCookieHeader(secret(), 'ran', id, { production: production() }));
      return res.redirect(303, `/grade/${id}`);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/grade/about', (req, res) => {
    html(res, 200, aboutPage({ contactEmail: ctx.config.contactEmail ?? '' }));
  });

  // ---- one Grade ---------------------------------------------------------------------------
  const notFound = res => html(res, 404, notFoundPage());

  /** The stored Grade, or undefined (a malformed id never reaches the store). */
  const load = async id => (ID_PATTERN.test(id) ? ctx.grader.get(id) : undefined);

  const reportOptions = (req, grade, extra = {}) => ({
    unlocked: hasCookie('unlock', grade.id, req),
    leadGate: leadGate(),
    contactEmail: ctx.config.contactEmail ?? '',
    opened: req.query.opened === '1',
    googleLive: Boolean(ctx.googleLive),
    requester: hasCookie('ran', grade.id, req),
    ...extra,
  });

  router.get('/grade/:id/status.json', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!ID_PATTERN.test(id)) return res.status(404).json({ error: 'Not found' });
      const grade = ctx.grader.peek(id) ?? await ctx.grader.get(id);
      if (!grade) return res.status(404).json({ error: 'Not found' });
      const status = ctx.grader.isStale(grade, now()) ? 'failed' : grade.status;
      return res.json({ status, steps: Array.isArray(grade.steps) ? grade.steps : [], done: status !== 'running' });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/grade/:id', async (req, res, next) => {
    try {
      const grade = await load(req.params.id);
      if (!grade) return notFound(res);
      if (grade.status === 'failed' || ctx.grader.isStale(grade, now())) {
        return html(res, 200, failedPage(grade, { stamp: signFormStamp(secret(), now()) }));
      }
      if (grade.status === 'running') return html(res, 200, scanPage(grade));

      const opts = reportOptions(req, grade);
      const full = !opts.leadGate || opts.unlocked;
      // With the gate off (or an unlocked visitor whose questions never started), the first view starts the extra AI questions.
      if (full && !grade.extraAiStartedAt) {
        ctx.grader.startExtraQuestions(grade.id).catch(() => {
          process.stderr.write(`[grader] extra-ai-failed id=${grade.id}\n`);
        });
      }
      return html(res, 200, reportPage(grade, opts));
    } catch (err) {
      return next(err);
    }
  });

  // ---- unlock -----------------------------------------------------------------------------------
  router.post('/grade/:id/unlock', form, async (req, res, next) => {
    try {
      const grade = await load(req.params.id);
      if (!grade || grade.status !== 'done') return notFound(res);
      const back = `/grade/${grade.id}?opened=1#full-report`;
      if (hasCookie('unlock', grade.id, req)) return res.redirect(303, back);

      const limited = ctx.rateLimiter.consume(`grade-unlock:${req.ip}`, RULES['grade-unlock']);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      const body = req.body ?? {};
      const name = cleanLine(body.name);
      const email = normalizeEmail(body.email);
      const phone = normalizePhone(body.phone);
      const okToContact = typeof body.okToContact === 'string' && body.okToContact !== '';
      const errors = {};
      if (name === '' || Array.from(name).length > 100) errors.name = 'Type your name.';
      if (email === '') errors.email = 'Type a real email address, like name@example.com.';
      if (phone === '') errors.phone = 'Type a 10-digit phone number, like (615) 555-0100.';
      if (Object.keys(errors).length > 0) {
        const values = { name, email: cleanLine(body.email), phone: cleanLine(body.phone), okToContact };
        return html(res, 422, reportPage(grade, reportOptions(req, grade, {
          unlocked: false, leadValues: values, leadErrors: errors,
        })));
      }

      const stored = await ctx.grader.unlock(grade.id, { name, email, phone, okToContact });
      if (!stored) return notFound(res);
      res.append('Set-Cookie', setCookieHeader(secret(), 'unlock', grade.id, { production: production() }));
      return res.redirect(303, back);
    } catch (err) {
      return next(err);
    }
  });

  // ---- claim the free page ---------------------------------------------------------------------------
  router.post('/grade/:id/claim', async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!ID_PATTERN.test(id)) return notFound(res);
      const limited = ctx.rateLimiter.consume(`rise:${req.ip}`, RULES.rise);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      const claimedDraftId = readClaimedDraftId(secret(), id, req.headers.cookie);
      const result = await ctx.grader.claim(id, { claimedDraftId });
      if (result.status === 404) return notFound(res);
      if (result.created) {
        res.append('Set-Cookie', claimCookieHeader(secret(), id, result.draftId, { production: production() }));
      }
      return res.redirect(303, `/rise/drafts/${encodeURIComponent(result.draftId)}`);
    } catch (err) {
      return next(err);
    }
  });

  // ---- check again -------------------------------------------------------------------------------------------
  router.post('/grade/:id/recheck', async (req, res, next) => {
    try {
      const grade = await load(req.params.id);
      if (!grade) return notFound(res);
      const back = `/grade/${grade.id}`;
      const full = !leadGate() || hasCookie('unlock', grade.id, req);
      if (!full || grade.status !== 'done' || !grade.input.website) return res.redirect(303, back);

      const limited = ctx.rateLimiter.consumeAll([
        { key: `grade-recheck:${req.ip}`, ...RULES['grade-recheck'] },
        { key: `grade-recheck-grade:${grade.id}`, ...RULES['grade-recheck-grade'] },
      ]);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      await ctx.grader.recheck(grade.id);
      return res.redirect(303, back);
    } catch (err) {
      return next(err);
    }
  });

  // ---- Google's live answer ---------------------------------------------------------------------------------------
  // Shown once, only to the browser that ran the check. Never stored, logged, matched or scored.
  router.post('/grade/:id/google-live', async (req, res, next) => {
    try {
      if (!ctx.googleLive) return notFound(res);
      const grade = await load(req.params.id);
      if (!grade || grade.status !== 'done') return notFound(res);
      if (!hasCookie('ran', grade.id, req)) {
        return html(res, 403, messagePage('Not available', "Google's live answer is private to the person who ran the check.", { href: `/grade/${grade.id}`, text: 'Back to the report' }));
      }

      const limited = ctx.rateLimiter.consumeAll([
        { key: `grade-google:${req.ip}`, ...RULES['grade-google'] },
        { key: `grade-google-grade:${grade.id}`, ...RULES['grade-google-grade'] },
      ]);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      const peek = ctx.aiBudget.peek({ kind: 'grade' });
      if (peek.remaining <= SECOND_OPINION_RESERVE || ctx.aiBudget.consume({ kind: 'grade' }).allowed !== true) {
        res.set('Retry-After', String(peek.retryAfterSeconds ?? 3600));
        return html(res, 429, messagePage("Not today", "We are keeping the rest of today's AI checks for new reports. Please try again tomorrow.", { href: `/grade/${grade.id}`, text: 'Back to the report' }));
      }

      res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': LIVE_CSP });
      let answer;
      try {
        answer = await ctx.googleLive.ask({ prompt: freeQuestion(grade.input), signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) });
      } catch {
        process.stderr.write(`[grader] google-live-failed id=${grade.id}\n`);
        return html(res, 502, messagePage("Google's AI didn't answer this time", 'Please try again in a little while.', { href: `/grade/${grade.id}`, text: 'Back to the report' }));
      }
      return html(res, 200, googleLivePage({
        grade, text: String(answer?.text ?? ''), sources: answer?.sources, suggestionsHtml: typeof answer?.suggestionsHtml === 'string' ? answer.suggestionsHtml : '',
      }));
    } catch (err) {
      return next(err);
    }
  });

  // Anything else under /grade is a plain 404 with the same headers.
  router.use('/grade', (req, res) => notFound(res));

  return router;
}
