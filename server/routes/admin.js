/**
 * admin.js — approval queue (token-protected).
 *
 *   GET  /admin/pending                    HTML list of listings awaiting review
 *   GET  /admin/quotes                     HTML list of saved quotes, newest first
 *   POST /admin/pending/:id/approve        publish the draft          -> JSON
 *   POST /admin/pending/:id/reject         reject, publish nothing    -> JSON
 *   POST /admin/listings/:id/unpublish     take a published listing down -> JSON
 *
 * The pending entry id is the draft id.
 * Auth is a bearer token in the Authorization header only (see admin-auth.js).
 * Browser forms cannot send that header, so the HTML page is meant for
 * token-holders using a header-injecting tool or curl.
 * Every /admin response is no-store and noindex.
 */

import { Router } from 'express';
import { requireAdmin } from '../lib/admin-auth.js';
import { layout, escapeHtml } from '../lib/html.js';
import { draftProvider } from '../lib/drafts.js';

/** @param {object} ctx resolved dependencies from createApp */
export function createAdminRouter(ctx) {
  const router = Router();

  router.use('/admin', (req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  });
  router.use('/admin', requireAdmin(ctx));

  const pendingEntries = async () => {
    const list = await ctx.store.collection('pending').read();
    return Array.isArray(list) ? list : [];
  };

  router.get('/admin/pending', async (req, res, next) => {
    try {
      const entries = (await pendingEntries()).filter(e => e && e.status === 'pending');
      const drafts = await ctx.store.collection('drafts').read();
      const byId = new Map((Array.isArray(drafts) ? drafts : []).map(d => [d.id, d]));

      const items = entries.map(e => {
        const f = byId.get(e.draftId)?.fields ?? {};
        const provider = draftProvider(byId.get(e.draftId));
        const id = encodeURIComponent(e.id);
        return `<li class="pending-item">
  <h2>${escapeHtml(f.name ?? '(no name)')}</h2>
  <p>${escapeHtml(f.category ?? '')} &middot; ${escapeHtml(f.city ?? '')}, ${escapeHtml(f.state ?? '')} &middot; ${escapeHtml(f.phone ?? '')}</p>
  <p class="hint">Submitted ${escapeHtml(e.submittedAt ?? '')} &middot; Provider: ${escapeHtml(provider)}${f.ownerEmail ? ` &middot; Owner email (private): ${escapeHtml(f.ownerEmail)}` : ''}</p>
  <form method="POST" action="/admin/pending/${id}/approve"><button type="submit">Approve</button></form>
  <form method="POST" action="/admin/pending/${id}/reject"><button type="submit">Reject</button></form>
</li>`;
      }).join('\n');

      const body = `<section class="admin">
  <h1>Listings awaiting review</h1>
  <p class="hint">Browsers cannot send the Authorization header from these buttons. Use curl or a tool that adds the header, for example: curl -X POST -H "Authorization: Bearer YOUR_TOKEN" /admin/pending/ID/approve</p>
  ${entries.length === 0 ? '<p>Nothing is waiting for review.</p>' : `<ul class="pending-list">\n${items}\n</ul>`}
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
          ? `${escapeHtml(listing.name)} (${escapeHtml(q.listingId)})`
          : escapeHtml(q.listingId ?? '');
        return `<li class="pending-item">
  <h2>${target}</h2>
  <p>Quote ${escapeHtml(q.id ?? '')} &middot; ${escapeHtml(q.createdAt ?? '')} &middot; Notified: ${q.notified === true ? 'yes' : 'no'}</p>
  <p>From: ${escapeHtml(q.name ?? '')} &middot; Contact: ${escapeHtml(q.contact ?? '')}</p>
  <p class="quote-details">${escapeHtml(q.details ?? '')}</p>
</li>`;
      }).join('\n');

      const body = `<section class="admin">
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
      if (!entry) return res.status(404).json({ error: 'Pending entry not found' });
      if (entry.status !== 'pending') return res.status(409).json({ error: 'Entry is not pending' });

      if (ctx.config.production === true) {
        const drafts = await ctx.store.collection('drafts').read();
        const draft = (Array.isArray(drafts) ? drafts : []).find(d => d && d.id === entry.draftId);
        if (draftProvider(draft) === 'mock') {
          return res.status(409).json({ error: 'This draft came from the demo photo reader and cannot be approved in production.' });
        }
      }

      const result = await ctx.store.publishDraft(entry.draftId);
      if (result.status === 422) return res.status(422).json({ error: 'Invalid listing', missingFields: result.missingFields ?? [] });
      if (result.status === 404) return res.status(404).json({ error: 'Draft not found' });
      if (result.status !== 200 || !result.listing) return res.status(409).json({ error: result.error ?? 'Cannot approve' });

      await ctx.store.collection('pending').update(list => {
        const e = list.find(x => x && x.id === entry.id);
        if (e) e.status = 'approved';
      });
      res.json({ ok: true, listingId: result.listing.id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/pending/:id/reject', async (req, res, next) => {
    try {
      const entry = (await pendingEntries()).find(e => e && e.id === req.params.id);
      if (!entry) return res.status(404).json({ error: 'Pending entry not found' });
      if (entry.status !== 'pending') return res.status(409).json({ error: 'Entry is not pending' });

      const result = await ctx.store.rejectDraft(entry.draftId);
      if (result.status === 404) return res.status(404).json({ error: 'Draft not found' });
      if (result.status !== 200) return res.status(409).json({ error: result.error ?? 'Cannot reject' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/listings/:id/unpublish', async (req, res, next) => {
    try {
      const result = await ctx.store.unpublish(req.params.id);
      if (result.status === 404) return res.status(404).json({ error: 'Listing not found' });
      if (result.status !== 200) return res.status(409).json({ error: result.error ?? 'Cannot unpublish' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
