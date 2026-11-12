/**
 * grade.js — the AI Visibility Grader's public routes.
 *
 *   GET  /grade                  form
 *   POST /grade                  validate, start, 303 to the report
 *   GET  /grade/about            what the Grader reads and why
 *   GET  /grade/:id              scan screen, report, or "did not finish" page
 *   GET  /grade/:id/status.json  { status, steps, done } for the optional script
 *   POST /grade/:id/unlock       the Lead_Form: opens the full report for this browser
 *   POST /grade/:id/claim        make a Draft from what the scan found
 *   POST /grade/:id/recheck      read the website again (no AI question)
 *
 * Every /grade response is not indexed and sends no referrer. With
 * GRADER_ENABLED=off every /grade path is a 404. Grade_Ids are 22-character
 * base64url strings; anything else is a 404 without a store read.
 */

import express, { Router } from 'express';
import { RULES } from '../lib/rate-limiter.js';
import {
  normalizeState, normalizeEmail, normalizePhone, STATE_ERROR, US_STATE_CODES,
} from '../lib/listing-fields.js';
import {
  makeStamp, checkStamp, unlockToken, hasToken, claimCookieValue, readClaim,
} from '../lib/grade-stamp.js';
import {
  gradeFormPage, scanPage, reportPage, failedPage, aboutPage, gradeMessagePage,
} from '../lib/grade-html.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
// Control characters, plus the invisible marks that flip text direction.
const CONTROL = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200E\u200F]/gu;

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
  if (values.name === '' || len(values.name) > 120) errors.name = values.name === '' ? 'Type your business name.' : 'That business name is too long.';
  if (values.city === '' || len(values.city) > 80) errors.city = values.city === '' ? 'Type your city.' : 'That city name is too long.';
  const state = normalizeState(values.state);
  // normalizeState hands back anything it does not know as typed, so check the code itself.
  if (!US_STATE_CODES.has(state)) errors.state = STATE_ERROR;
  if (values.service === '' || len(values.service) > 60) errors.service = values.service === '' ? 'Say what you do, like roofers.' : 'Please say what you do in fewer words.';
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
  const notFound = res => send(res, 404, gradeMessagePage('Page not found', "We can't find that report. The link may be old: reports are deleted after 90 days.", { href: '/grade', text: 'Grade a business' }));
  const newStamp = () => makeStamp(secret, ctx.clock.now());
  const isUnlocked = (req, id) => hasToken(req, `g_${id}`, unlockToken(secret, id));
  const tooMany = (res, seconds) => {
    res.set('Retry-After', String(seconds));
    return send(res, 429, gradeMessagePage('Please wait', `Please try again in ${seconds} seconds.`));
  };
  /** A cookie only this browser sends back, and only for this Grade's pages. */
  const setCookie = (res, name, value, id) => {
    const secure = config.production === true || res.req.secure === true ? '; Secure' : '';
    res.append('Set-Cookie', `${name}=${value}; HttpOnly${secure}; SameSite=Lax; Path=/grade/${id}; Max-Age=${90 * 24 * 60 * 60}`);
  };
  const renderReport = (grade, unlocked, extra = {}) => reportPage(grade, {
    unlocked,
    leadGate: config.graderLeadGate !== false,
    contactEmail: config.contactEmail,
    now: Number(ctx.clock.now()),
    rechecking: grader.isRechecking(grade),
    ...extra,
  });

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
      const unlocked = isUnlocked(req, grade.id);
      // With the gate off (or once unlocked) the extra AI questions start on the first view.
      if ((unlocked || config.graderLeadGate === false) && !grade.extraAiStartedAt) grader.startExtraQuestions(grade.id);
      return send(res, 200, renderReport(grade, unlocked));
    } catch (err) {
      return next(err);
    }
  });

  // ---- lead form and unlock ------------------------------------------------------------

  router.post('/grade/:id/unlock', formParser, async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!ID_PATTERN.test(id)) return notFound(res);
      const grade = await grader.get(id);
      if (!grade) return notFound(res);
      if (grade.status !== 'done' || isUnlocked(req, id)) return res.redirect(303, `/grade/${id}`);

      const body = req.body ?? {};
      const values = { name: tidy(body.name), email: tidy(body.email), phone: tidy(body.phone) };
      const lead = {
        name: values.name,
        email: normalizeEmail(values.email),
        phone: normalizePhone(values.phone),
        okToContact: body.okToContact === '1',
      };
      const errors = {};
      if (lead.name === '' || len(lead.name) > 120) errors.name = 'Type your name.';
      if (lead.email === '') errors.email = 'Type a real email address, like you@example.com.';
      if (lead.phone === '') errors.phone = 'Type a 10-digit phone number, like (615) 555-0100.';
      if (Object.keys(errors).length > 0) {
        return send(res, 422, renderReport(grade, false, { leadValues: values, leadErrors: errors }));
      }

      const limited = ctx.rateLimiter.consume(`grade-unlock:${req.ip}`, RULES['grade-unlock']);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      const result = await grader.unlock(id, lead);
      if (result.status !== 200) return res.redirect(303, `/grade/${id}`);
      setCookie(res, `g_${id}`, unlockToken(secret, id), id);
      return res.redirect(303, `/grade/${id}`);
    } catch (err) {
      return next(err);
    }
  });

  // ---- claim the free page ----------------------------------------------------------------

  router.post('/grade/:id/claim', async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!ID_PATTERN.test(id)) return notFound(res);
      const grade = await grader.get(id);
      if (!grade) return notFound(res);
      if (grade.status !== 'done') return res.redirect(303, `/grade/${id}`);

      // The same browser goes back to its own Draft; nobody is ever sent to another visitor's Draft.
      const mine = readClaim(req, secret, id);
      if (mine && await grader.draftExists(mine)) {
        return res.redirect(303, `/rise/drafts/${encodeURIComponent(mine)}`);
      }

      const limited = ctx.rateLimiter.consume(`rise:${req.ip}`, RULES.rise);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      const created = await grader.claim(id);
      if (created.status !== 201) return notFound(res);
      setCookie(res, `gc_${id}`, claimCookieValue(secret, id, created.draft.id), id);
      return res.redirect(303, `/rise/drafts/${encodeURIComponent(created.draft.id)}`);
    } catch (err) {
      return next(err);
    }
  });

  // ---- check again ----------------------------------------------------------------------

  router.post('/grade/:id/recheck', async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!ID_PATTERN.test(id)) return notFound(res);
      const grade = await grader.get(id);
      if (!grade) return notFound(res);
      const allowed = config.graderLeadGate === false || isUnlocked(req, id);
      if (grade.status !== 'done' || !allowed) return res.redirect(303, `/grade/${id}`);

      const limited = ctx.rateLimiter.consumeAll([
        { key: `grade-recheck:${req.ip}`, ...RULES['grade-recheck'] },
        { key: `grade-recheck-grade:${id}`, ...RULES['grade-recheck-grade'] },
      ]);
      if (!limited.allowed) return tooMany(res, limited.retryAfterSeconds);

      await grader.recheck(id);
      return res.redirect(303, `/grade/${id}`);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
