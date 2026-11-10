/**
 * admin.js — login, approval queue and quotes (token-protected).
 *
 *   GET  /admin/login                      password form for the admin token
 *   POST /admin/login                      right token -> cookie, 303 /admin/pending
 *   POST /admin/logout                     clears the cookie, 303 /admin/login
 *   GET  /admin/pending                    HTML list of listings awaiting review
 *   GET  /admin/quotes                     HTML list of saved quotes, newest first
 *   POST /admin/pending/:id/approve        publish the draft
 *   POST /admin/pending/:id/reject         reject, publish nothing
 *   POST /admin/listings/:id/unpublish     take a published listing down
 *
 * The pending entry id is the draft id.
 * Every /admin page accepts the login cookie or the bearer header (see
 * admin-auth.js). Requests with a bearer header, or without Accept: text/html,
 * get JSON from the POST routes exactly as before; browser form posts get a
 * 303 back to /admin/pending with a note chosen from a fixed list.
 * Every /admin response is no-store and noindex.
 */

import express, { Router } from 'express';
import {
  requireAdmin, plainTokenMatches, setAdminCookie, clearAdminCookie, throttled, sameOrigin, cookieMatches,
} from '../lib/admin-auth.js';
import { layout, escapeHtml } from '../lib/html.js';
import { draftProvider } from '../lib/drafts.js';
import { formatRunTime } from '../lib/seance-html.js';

/** Fixed notes for /admin/pending?note=...; never echo the query value. */
const NOTES = Object.freeze({
  approved: 'Approved.',
  rejected: 'Rejected.',
  unpublished: 'Unpublished.',
  notfound: 'That entry was not found.',
  notpending: 'That entry is not waiting for review.',
  invalid: 'That listing is missing required fields, so it was not approved.',
  demo: 'This draft came from the demo photo reader and cannot be approved in production.',
  failed: 'That could not be done.',
});

/** Provider name as shown to people. */
const providerText = name => (name === 'mock' ? 'Demo photo reader' : name === 'manual' ? 'Typed in by owner' : name);

/** Central time without the zone name, e.g. 'Nov 10, 2026, 2:15 PM'. */
function adminTime(iso) {
  if (typeof iso !== 'string' || Number.isNaN(new Date(iso).getTime())) return String(iso ?? '');
  return formatRunTime(iso).replace(/ [A-Z]{2,5}$/, '');
}

/** True for browser form posts: no Authorization header and Accept: text/html. */
const wantsHtml = req =>
  typeof req.headers.authorization !== 'string' && String(req.headers.accept ?? '').includes('text/html');

const adminNav = () => `<nav class="admin-nav">
  <a href="/admin/pending">Pending</a> &middot; <a href="/admin/quotes">Quotes</a>
  <form method="POST" action="/admin/logout" class="admin-logout"><button type="submit" class="admin-button">Log out</button></form>
</nav>`;

function loginPage(error) {
  const body = `<section class="admin">
  <h1>Admin log in</h1>
  ${error ? `<p class="admin-error" role="alert">${escapeHtml(error)}</p>` : ''}
  <form method="POST" action="/admin/login" class="admin-login">
    <label for="token">Admin token</label>
    <input type="password" id="token" name="token" autocomplete="current-password" required>
    <button type="submit" class="admin-button">Log in</button>
  </form>
</section>`;
  return layout({ title: 'Admin log in', body });
}

/** @param {object} ctx resolved dependencies from createApp */
export function createAdminRouter(ctx) {
  const router = Router();

  router.use('/admin', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  });

  // ---- login / logout (before the auth gate) --------------------------------------------
  const form = express.urlencoded({ extended: false, limit: '4kb' });

  router.get('/admin/login', (req, res) => {
    res.type('html').send(loginPage());
  });

  router.post('/admin/login', form, (req, res) => {
    const expected = ctx.config.adminToken;
    if (!expected) return res.status(403).type('html').send(loginPage('Admin access is turned off.'));

    // A correct token always works, even from a throttled IP.
    if (plainTokenMatches(req.body?.token, expected)) {
      setAdminCookie(ctx, req, res, expected);
      return res.redirect(303, '/admin/pending');
    }
    const block = throttled(ctx, req, { consume: true });
    if (block) {
      res.set('Retry-After', String(block.retryAfterSeconds));
      return res.status(429).type('html').send(loginPage('Too many tries. Please wait and try again later.'));
    }
    res.status(401).type('html').send(loginPage('That token is not right. Please try again.'));
  });

  router.post('/admin/logout', (req, res) => {
    // Only a logged-in browser needs the origin check; anyone else just lands on the login page.
    if (ctx.config.adminToken && cookieMatches(req, ctx.config.adminToken) && !sameOrigin(ctx, req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    clearAdminCookie(ctx, req, res);
    res.redirect(303, '/admin/login');
  });

  router.use('/admin', requireAdmin(ctx, { cookie: true }));

  const pendingEntries = async () => {
    const list = await ctx.store.collection('pending').read();
    return Array.isArray(list) ? list : [];
  };

  /** JSON for API clients; 303 back to the queue with a fixed note for browsers. */
  const reply = (req, res, { status = 200, json, note, id }) => {
    if (!wantsHtml(req)) return res.status(status).json(json);
    const q = new URLSearchParams({ note });
    if (id) q.set('id', id);
    return res.redirect(303, `/admin/pending?${q}`);
  };

  router.get('/admin/pending', async (req, res, next) => {
    try {
      const entries = (await pendingEntries()).filter(e => e && e.status === 'pending');
      const drafts = await ctx.store.collection('drafts').read();
      const byId = new Map((Array.isArray(drafts) ? drafts : []).map(d => [d.id, d]));
      const publishedAll = await ctx.store.collection('published').read();
      const published = (Array.isArray(publishedAll) ? publishedAll : []).filter(l => l && typeof l.id === 'string');

      const items = entries.map(e => {
        const f = byId.get(e.draftId)?.fields ?? {};
        const provider = providerText(draftProvider(byId.get(e.draftId)));
        const id = encodeURIComponent(e.id);
        return `<li class="pending-item">
  <h2>${escapeHtml(f.name ?? '(no name)')}</h2>
  <p>${escapeHtml(f.category ?? '')} &middot; ${escapeHtml(f.city ?? '')}, ${escapeHtml(f.state ?? '')} &middot; ${escapeHtml(f.phone ?? '')}</p>
  <p class="hint">Submitted ${escapeHtml(adminTime(e.submittedAt ?? ''))} &middot; Provider: ${escapeHtml(provider)}${f.ownerEmail ? ` &middot; Owner email (private): ${escapeHtml(f.ownerEmail)}` : ''}</p>
  <form method="POST" action="/admin/pending/${id}/approve"><button type="submit" class="admin-button">Approve</button></form>
  <form method="POST" action="/admin/pending/${id}/reject"><button type="submit" class="admin-button admin-button-secondary">Reject</button></form>
</li>`;
      }).join('\n');

      const liveItems = published.map(l => `<li class="pending-item">
  <h2>${escapeHtml(l.name ?? l.id)}</h2>
  <p><a href="/listings/${encodeURIComponent(l.id)}">View listing</a></p>
  <form method="POST" action="/admin/listings/${encodeURIComponent(l.id)}/unpublish"><button type="submit" class="admin-button admin-button-secondary">Unpublish</button></form>
</li>`).join('\n');

      const noteKey = typeof req.query.note === 'string' && Object.hasOwn(NOTES, req.query.note) ? req.query.note : '';
      const noteId = typeof req.query.id === 'string' ? req.query.id : '';
      const link = noteKey === 'approved' && noteId
        ? ` <a href="/listings/${encodeURIComponent(noteId)}">View listing &rarr;</a>`
        : '';
      const note = noteKey ? `<p class="admin-note" role="status">${escapeHtml(NOTES[noteKey])}${link}</p>` : '';

      const body = `<section class="admin">
  ${adminNav()}
  <h1>Listings awaiting review</h1>
  <p><a href="/admin/quotes">See saved quote requests &rarr;</a></p>
  ${note}
  ${entries.length === 0 ? '<p>Nothing is waiting for review.</p>' : `<ul class="pending-list">\n${items}\n</ul>`}
  ${published.length === 0 ? '' : `<h2>Published by owners</h2>\n  <ul class="pending-list">\n${liveItems}\n</ul>`}
</section>`;
      res.type('html').send(layout({ title: 'Listings awaiting review', body }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/quotes', async (req, res, next) => {
    try {
      const all = await ctx.store.collection('quotes').read();
      const quotes = (Array.isArray(all) ? all : [])
        .filter(q => q && typeof q === 'object')
        .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

      const items = quotes.map(q => {
        const listing = ctx.store.findById(q.listingId);
        const target = listing
          ? `<a href="/listings/${encodeURIComponent(q.listingId)}">${escapeHtml(listing.name)}</a> (${escapeHtml(q.listingId)})`
          : escapeHtml(q.listingId ?? '');
        const emailed = q.emailed === true
          ? 'yes'
          : q.notifier === 'resend' ? 'no (sending failed)' : 'no (email not set up)';
        const business = listing
          ? `<p>Business phone: ${escapeHtml(listing.phone ?? '')} &middot; Owner email (private): ${listing.ownerEmail ? escapeHtml(listing.ownerEmail) : 'none'}</p>\n  `
          : '';
        return `<li class="pending-item">
  <h2>${target}</h2>
  ${business}<p>Quote ${escapeHtml(q.id ?? '')} &middot; ${escapeHtml(adminTime(q.createdAt ?? ''))} &middot; Emailed: ${emailed}</p>
  <p>From: ${escapeHtml(q.name ?? '')} &middot; Contact: ${escapeHtml(q.contact ?? '')}</p>
  <p class="quote-details">${escapeHtml(q.details ?? '')}</p>
</li>`;
      }).join('\n');

      const body = `<section class="admin">
  ${adminNav()}
  <h1>Saved quote requests</h1>
  ${quotes.length === 0 ? '<p>No quote requests yet.</p>' : `<ul class="pending-list">\n${items}\n</ul>`}
</section>`;
      res.type('html').send(layout({ title: 'Saved quote requests', body }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/pending/:id/approve', async (req, res, next) => {
    try {
      const entry = (await pendingEntries()).find(e => e && e.id === req.params.id);
      if (!entry) return reply(req, res, { status: 404, json: { error: 'Pending entry not found' }, note: 'notfound' });
      if (entry.status !== 'pending') return reply(req, res, { status: 409, json: { error: 'Entry is not pending' }, note: 'notpending' });

      if (ctx.config.production === true) {
        const drafts = await ctx.store.collection('drafts').read();
        const draft = (Array.isArray(drafts) ? drafts : []).find(d => d && d.id === entry.draftId);
        if (draftProvider(draft) === 'mock') {
          return reply(req, res, {
            status: 409,
            json: { error: 'This draft came from the demo photo reader and cannot be approved in production.' },
            note: 'demo',
          });
        }
      }

      const result = await ctx.store.publishDraft(entry.draftId);
      if (result.status === 422) {
        return reply(req, res, { status: 422, json: { error: 'Invalid listing', missingFields: result.missingFields ?? [] }, note: 'invalid' });
      }
      if (result.status === 404) return reply(req, res, { status: 404, json: { error: 'Draft not found' }, note: 'notfound' });
      if (result.status !== 200 || !result.listing) {
        return reply(req, res, { status: 409, json: { error: result.error ?? 'Cannot approve' }, note: 'failed' });
      }

      await ctx.store.collection('pending').update(list => {
        const e = list.find(x => x && x.id === entry.id);
        if (e) e.status = 'approved';
      });
      reply(req, res, { json: { ok: true, listingId: result.listing.id }, note: 'approved', id: result.listing.id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/pending/:id/reject', async (req, res, next) => {
    try {
      const entry = (await pendingEntries()).find(e => e && e.id === req.params.id);
      if (!entry) return reply(req, res, { status: 404, json: { error: 'Pending entry not found' }, note: 'notfound' });
      if (entry.status !== 'pending') return reply(req, res, { status: 409, json: { error: 'Entry is not pending' }, note: 'notpending' });

      const result = await ctx.store.rejectDraft(entry.draftId);
      if (result.status === 404) return reply(req, res, { status: 404, json: { error: 'Draft not found' }, note: 'notfound' });
      if (result.status !== 200) return reply(req, res, { status: 409, json: { error: result.error ?? 'Cannot reject' }, note: 'failed' });
      reply(req, res, { json: { ok: true }, note: 'rejected' });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/listings/:id/unpublish', async (req, res, next) => {
    try {
      const result = await ctx.store.unpublish(req.params.id);
      if (result.status === 404) return reply(req, res, { status: 404, json: { error: 'Listing not found' }, note: 'notfound' });
      if (result.status !== 200) return reply(req, res, { status: 409, json: { error: result.error ?? 'Cannot unpublish' }, note: 'failed' });
      reply(req, res, { json: { ok: true }, note: 'unpublished' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
