/**
 * admin.js — login, approval queue and quotes (token-protected).
 *
 *   GET  /admin/login                      password form for the admin token
 *   POST /admin/login                      right token -> cookie, 303 /admin/pending
 *   POST /admin/logout                     clears the cookie, 303 /admin/login
 *   GET  /admin/pending                    HTML list of listings awaiting review
 *   GET  /admin/quotes                     HTML list of saved quotes, newest first
 *   GET  /admin/whoami                     req.ip, req.ips and the trust proxy setting
 *   POST /admin/pending/:id/approve        publish the draft
 *   POST /admin/pending/:id/reject         reject, publish nothing (browser: asks first)
 *   POST /admin/listings/:id/unpublish     take a published listing down (browser: asks first)
 *   POST /admin/listings/:id/seance        "Run AI check": one Séance run, then the report
 *   POST /admin/quotes/:id/handled         mark a saved quote handled
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
import { indexNowNote } from '../lib/indexnow.js';
import { DAYS } from '../lib/listing-fields.js';
import { markQuoteHandled } from '../lib/quotes.js';
import { runSeanceForListing } from './seance.js';
import { DEFAULT_SITE_NAME } from '../lib/config.js';

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
  seanceoff: 'The AI check is not connected yet (no AI key is set).',
  seancebusy: 'That listing was checked very recently. Please try again later.',
  seancelimit: "Today's limit for AI checks is reached. Try again tomorrow.",
  seancefailed: 'The AI check could not finish. Please try again later.',
});

/** Fixed notes for /admin/quotes?note=... */
const QUOTE_NOTES = Object.freeze({
  handled: 'Marked handled.',
  notfound: 'That quote was not found.',
});

/** Provider name as shown to people. */
function providerText(name) {
  if (name === 'mock') return 'Demo photo reader';
  if (name === 'manual') return 'Typed in by the owner';
  if (name === 'grader') return 'Filled in from the Grader scan';
  if (name === 'anthropic') return 'Read from a photo by Claude';
  if (name === 'openai') return 'Read from a photo by AI';
  return 'Unknown source';
}

/** The last 10 digits of a phone number, for duplicate checks ('' when too short). */
function phoneKey(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}

/** tel: href for a phone number; US 10-digit numbers get +1. */
function telHref(phone) {
  const text = String(phone ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`;
  return `tel:${text.startsWith('+') ? '+' : ''}${digits}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** mailto: href with the local part and domain encoded separately (the @ stays literal). */
function mailtoHref(email, params = {}) {
  const [local, domain] = String(email).split('@');
  const query = new URLSearchParams(params).toString().replace(/\+/g, '%20');
  return `mailto:${encodeURIComponent(local)}@${encodeURIComponent(domain ?? '')}${query ? `?${query}` : ''}`;
}

/**
 * mailto: link that forwards one quote to the business. Every part is
 * encodeURIComponent'd (the address's local part and domain separately).
 */
function forwardHref(email, q, siteName) {
  const [local, domain] = String(email).split('@');
  const subject = `Quote request from ${String(q?.name ?? 'a customer')} via ${siteName}`;
  const body = [
    'A customer asked for a quote:',
    '',
    `Name: ${String(q?.name ?? '')}`,
    `Contact: ${String(q?.contact ?? '')}`,
    `Details: ${String(q?.details ?? '')}`,
  ].join('\n');
  return `mailto:${encodeURIComponent(local)}@${encodeURIComponent(domain ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A customer's contact as a tel: or mailto: link when it looks like one, else plain text. */
function contactHtml(contact) {
  const text = String(contact ?? '').trim();
  if (EMAIL_RE.test(text)) return `<a href="${escapeHtml(mailtoHref(text))}">${escapeHtml(text)}</a>`;
  const digits = text.replace(/\D/g, '');
  if (/^[\d\s().+-]+$/.test(text) && digits.length >= 7 && digits.length <= 15) {
    return `<a href="${escapeHtml(telHref(text))}">${escapeHtml(text)}</a>`;
  }
  return escapeHtml(text);
}

/** Hours as "Monday: 9-5" lines, filled days only. */
function hoursHtml(hours) {
  const byDay = new Map(Object.entries(hours && typeof hours === 'object' ? hours : {})
    .map(([k, v]) => [String(k).toLowerCase(), typeof v === 'string' ? v.trim() : '']));
  const rows = DAYS.filter(d => byDay.get(d)).map(d => `${d[0].toUpperCase()}${d.slice(1)}: ${escapeHtml(byDay.get(d))}`);
  return rows.length ? rows.join('<br>') : 'None given';
}

/** A small "are you sure" page; the button posts confirm=yes back to the same action. */
function confirmPage({ title, question, action, button }) {
  const body = `<section class="admin">
  ${adminNav()}
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(question)}</p>
  <form method="POST" action="${escapeHtml(action)}">
    <input type="hidden" name="confirm" value="yes">
    <button type="submit" class="admin-button">${escapeHtml(button)}</button>
  </form>
  <p><a href="/admin/pending">Cancel</a></p>
</section>`;
  return layout({ title, body });
}

/** Central time without the zone name, e.g. 'Nov 10, 2026, 2:15 PM'. */
function adminTime(iso) {
  if (typeof iso !== 'string' || Number.isNaN(new Date(iso).getTime())) return String(iso ?? '');
  return formatRunTime(iso).replace(/ [A-Z]{2,5}$/, '');
}

/** True for browser form posts: no Authorization header and Accept: text/html. */
const wantsHtml = req =>
  typeof req.headers.authorization !== 'string' && String(req.headers.accept ?? '').includes('text/html');

const adminNav = () => `<nav class="admin-nav">
  <a href="/admin/pending">Pending</a> &middot; <a href="/admin/quotes">Quotes</a> &middot; <a href="/admin/indexnow">Bing pings</a> &middot; <a href="/admin/whoami">My IP</a>
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
  <p class="hint">Your admin token is in Render: open your service, then Environment, then ADMIN_TOKEN.</p>
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
    if (ctx.config.adminToken && cookieMatches(req, ctx.config.adminToken, ctx.clock?.now?.() ?? Date.now())
      && !sameOrigin(ctx, req)) {
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

  /** Fire-and-forget Bing ping (IndexNow); never delays or breaks the admin action. */
  const ping = (paths, tag) => {
    const base = String(ctx.config.baseUrl ?? '').replace(/\/+$/, '');
    const urls = paths.map(p => `${base}${p}`);
    try {
      ctx.indexNow?.submit(urls, tag)?.catch?.(() => {});
    } catch {
      // never let the ping break the action
    }
  };

  router.get('/admin/pending', async (req, res, next) => {
    try {
      const entries = (await pendingEntries()).filter(e => e && e.status === 'pending');
      const drafts = await ctx.store.collection('drafts').read();
      const byId = new Map((Array.isArray(drafts) ? drafts : []).map(d => [d.id, d]));
      // Owner listings that are live now (the store's snapshot; sample listings are never unpublishable).
      const published = ctx.store.getListings().filter(l => l && typeof l.id === 'string' && !ctx.store.isSeed(l.id));

      const categories = ctx.store.getCategories();
      const categoryLabel = slug => categories.find(c => c.slug === slug)?.label ?? String(slug ?? '');

      // Duplicate check by phone (last 10 digits): live listings and the other pending entries.
      const liveByPhone = new Map();
      for (const l of ctx.store.getListings()) {
        const key = phoneKey(l?.phone);
        if (key && !liveByPhone.has(key)) liveByPhone.set(key, l);
      }
      const pendingFields = entries.map(e => ({ entry: e, f: byId.get(e.draftId)?.fields ?? {} }));

      const items = pendingFields.map(({ entry: e, f }) => {
        const provider = providerText(draftProvider(byId.get(e.draftId)));
        const id = encodeURIComponent(e.id);
        const key = phoneKey(f.phone);
        const dupes = [];
        if (key && liveByPhone.has(key)) {
          const l = liveByPhone.get(key);
          const href = `/listings/${encodeURIComponent(l.id)}`;
          dupes.push(`Same phone number as ${escapeHtml(l.name ?? l.id)}, already live (<a href="${href}">view it</a>)`);
        }
        for (const other of pendingFields) {
          if (other.entry.id === e.id || !key || phoneKey(other.f.phone) !== key) continue;
          const href = `#pending-${encodeURIComponent(other.entry.id)}`;
          dupes.push(`Same phone number as ${escapeHtml(other.f.name ?? '(no name)')}, also waiting for review (<a href="${href}">jump to it</a>)`);
        }
        const services = Array.isArray(f.services) ? f.services.filter(x => typeof x === 'string' && x.trim()) : [];
        const row = (label, value) => `    <dt>${label}</dt><dd>${value}</dd>`;
        const preview = [
          row('Services', services.length ? escapeHtml(services.join(', ')) : 'None given'),
          row('Description', f.description ? escapeHtml(f.description).replace(/\n/g, '<br>') : 'None given'),
          row('Hours', hoursHtml(f.hours)),
          row('Service area', f.serviceArea ? escapeHtml(f.serviceArea) : 'None given'),
          ...(f.address ? [row('Address', escapeHtml(f.address))] : []),
          ...(f.website ? [row('Website', escapeHtml(f.website))] : []),
          ...(f.ownerEmail ? [row('Owner email (private)', escapeHtml(f.ownerEmail))] : []),
        ].join('\n');
        return `<li class="pending-item" id="pending-${escapeHtml(e.id)}">
  <h2>${escapeHtml(f.name ?? '(no name)')}</h2>
  <p>${escapeHtml(categoryLabel(f.category))} &middot; ${escapeHtml(f.city ?? '')}, ${escapeHtml(f.state ?? '')} &middot; ${escapeHtml(f.phone ?? '')}</p>
${dupes.map(d => `  <p class="admin-warning notice" role="note">${d}</p>`).join('\n')}
  <dl class="admin-preview">
${preview}
  </dl>
  <p class="hint">Submitted ${escapeHtml(adminTime(e.submittedAt ?? ''))} &middot; Source: ${escapeHtml(provider)}</p>
  <form method="POST" action="/admin/pending/${id}/approve"><button type="submit" class="admin-button">Approve</button></form>
  <form method="POST" action="/admin/pending/${id}/reject"><button type="submit" class="admin-button admin-button-secondary">Reject</button></form>
</li>`;
      }).join('\n');

      const liveItems = published.map(l => {
        const lid = encodeURIComponent(l.id);
        return `<li class="pending-item">
  <h2>${escapeHtml(l.name ?? l.id)}</h2>
  <p>${escapeHtml(categoryLabel(l.category))} &middot; ${escapeHtml(l.city ?? '')}, ${escapeHtml(l.state ?? '')} &middot; ${escapeHtml(l.phone ?? '')}</p>
  <p><a href="/listings/${lid}">View listing</a></p>
  <form method="POST" action="/admin/listings/${lid}/seance"><button type="submit" class="admin-button">Run AI check (Séance)</button></form>
  <form method="POST" action="/admin/listings/${lid}/unpublish"><button type="submit" class="admin-button admin-button-secondary">Unpublish</button></form>
</li>`;
      }).join('\n');

      const noteKey = typeof req.query.note === 'string' && Object.hasOwn(NOTES, req.query.note) ? req.query.note : '';
      const noteId = typeof req.query.id === 'string' ? req.query.id : '';
      const link = noteKey === 'approved' && noteId
        ? ` <a href="/listings/${encodeURIComponent(noteId)}">View listing &rarr;</a>`
        : '';
      // One line on whether Bing was told (IndexNow), for approve and unpublish.
      const pingEntry = (noteKey === 'approved' || noteKey === 'unpublished') && noteId
        ? ctx.indexNow?.latestFor?.(noteId)
        : undefined;
      const pingLine = (noteKey === 'approved' || noteKey === 'unpublished') && noteId
        ? `<p class="hint">${escapeHtml(pingEntry ? indexNowNote(pingEntry) : `Bing not notified (${ctx.indexNow?.reason || 'off'}).`)}</p>`
        : '';
      // After approve: remind the admin to tell the owner (selectable address plus a mailto link).
      const approvedListing = noteKey === 'approved' && noteId ? ctx.store.findById(noteId) : undefined;
      const ownerEmail = typeof approvedListing?.ownerEmail === 'string' ? approvedListing.ownerEmail : '';
      const base = String(ctx.config.baseUrl ?? '').replace(/\/+$/, '');
      const ownerLine = ownerEmail
        ? `<p class="hint">Let the owner know it's live: <span class="owner-email">${escapeHtml(ownerEmail)}</span> &middot; <a href="${escapeHtml(mailtoHref(ownerEmail, {
          subject: 'Your listing is live',
          body: `Good news: your listing is live at ${base}/listings/${encodeURIComponent(noteId)}`,
        }))}">Email the owner</a></p>`
        : '';
      // After reject: the same reminder, so the owner hears back either way.
      const rejectedEmail = noteKey === 'rejected' && noteId ? byId.get(noteId)?.fields?.ownerEmail : '';
      const rejectLine = typeof rejectedEmail === 'string' && rejectedEmail.includes('@')
        ? `<p class="hint">Let the owner know: <span class="owner-email">${escapeHtml(rejectedEmail)}</span> &middot; <a href="${escapeHtml(mailtoHref(rejectedEmail, {
          subject: 'About your listing',
          body: "Thanks for sending your listing. We couldn't publish it as it was sent. Reply to this email and we'll help you fix it.",
        }))}">Email the owner</a></p>`
        : '';
      const note = noteKey ? `<p class="admin-note" role="status">${escapeHtml(NOTES[noteKey])}${link}</p>${ownerLine}${rejectLine}${pingLine}` : '';

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
      const siteName = typeof ctx.config.siteName === 'string' && ctx.config.siteName.trim() ? ctx.config.siteName.trim() : DEFAULT_SITE_NAME;
      const quotes = (Array.isArray(all) ? all : [])
        .filter(q => q && typeof q === 'object')
        .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));

      const item = q => {
        const listing = ctx.store.findById(q.listingId);
        const target = listing
          ? `<a href="/listings/${encodeURIComponent(q.listingId)}">${escapeHtml(listing.name)}</a> (${escapeHtml(q.listingId)})`
          : escapeHtml(q.listingId ?? '');
        const emailed = q.emailed === true
          ? 'yes'
          : q.notifier === 'resend' ? 'no (sending failed)' : 'no (email not set up)';
        const businessPhone = listing?.phone
          ? `<a href="${escapeHtml(telHref(listing.phone))}">${escapeHtml(listing.phone)}</a>`
          : '';
        const business = listing
          ? `<p>Business phone: ${businessPhone} &middot; Owner email (private): ${listing.ownerEmail ? escapeHtml(listing.ownerEmail) : 'none'}</p>\n  `
          : '';
        const handled = q.handled === true;
        // Until email is set up, the admin forwards each open quote to the business by hand.
        // Not when the quote was already emailed, so the business never gets it twice.
        const forward = !handled && q.emailed !== true && typeof listing?.ownerEmail === 'string' && listing.ownerEmail.includes('@')
          ? `<p><a href="${escapeHtml(forwardHref(listing.ownerEmail, q, siteName))}">Forward this quote to the business &rarr;</a> (<span class="owner-email">${escapeHtml(listing.ownerEmail)}</span>)</p>\n  `
          : '';
        const action = handled
          ? `<p class="hint">Handled ${escapeHtml(adminTime(q.handledAt ?? ''))}</p>`
          : `<form method="POST" action="/admin/quotes/${encodeURIComponent(q.id ?? '')}/handled"><button type="submit" class="admin-button admin-button-secondary">Mark handled</button></form>`;
        return `<li class="pending-item">
  <h2>${target}</h2>
  ${business}${forward}<p>Quote ${escapeHtml(q.id ?? '')} &middot; ${escapeHtml(adminTime(q.createdAt ?? ''))} &middot; Emailed: ${emailed}</p>
  <p>From: ${escapeHtml(q.name ?? '')} &middot; Contact: ${contactHtml(q.contact)}</p>
  <p class="quote-details">${escapeHtml(q.details ?? '')}</p>
  ${action}
</li>`;
      };
      const open = quotes.filter(q => q.handled !== true);
      const done = quotes.filter(q => q.handled === true);
      const noteKey = typeof req.query.note === 'string' && Object.hasOwn(QUOTE_NOTES, req.query.note) ? req.query.note : '';
      const note = noteKey ? `<p class="admin-note" role="status">${escapeHtml(QUOTE_NOTES[noteKey])}</p>` : '';

      const body = `<section class="admin">
  ${adminNav()}
  <h1>Saved quote requests</h1>
  ${note}
  ${open.length === 0
    ? `<p>${quotes.length === 0 ? 'No quote requests yet.' : 'No open quote requests.'}</p>`
    : `<ul class="pending-list">\n${open.map(item).join('\n')}\n</ul>`}
  ${done.length === 0 ? '' : `<h2>Handled</h2>\n  <ul class="pending-list">\n${done.map(item).join('\n')}\n</ul>`}
</section>`;
      res.type('html').send(layout({ title: 'Saved quote requests', body }));
    } catch (err) {
      next(err);
    }
  });

  // Shows the address the server sees, to pick the right TRUST_PROXY hop count.
  router.get('/admin/whoami', (req, res) => {
    const trust = req.app.get('trust proxy');
    const trustText = trust === undefined || trust === false ? 'not set' : String(trust);
    const ips = Array.isArray(req.ips) ? req.ips : [];
    if (String(req.headers.accept ?? '').includes('application/json')) {
      return res.json({ ip: req.ip ?? '', ips, trustProxy: trustText });
    }
    const list = ips.length === 0
      ? '<p>None (no forwarded addresses are being trusted).</p>'
      : `<ul>${ips.map(ip => `<li>${escapeHtml(ip)}</li>`).join('')}</ul>`;
    const body = `<section class="admin">
  ${adminNav()}
  <h1>Your IP address</h1>
  <p>Open this page from your phone. Set TRUST_PROXY to the smallest number that shows your real IP address.</p>
  <p>What to look for: the address after "req.ip" should match the one a site like whatismyipaddress.com shows on the same phone (with Wi-Fi off). If it matches, you're done. If it doesn't, ask for help before changing TRUST_PROXY.</p>
  <p>req.ip: <strong>${escapeHtml(req.ip ?? '')}</strong></p>
  <p>req.ips:</p>
  ${list}
  <p>Current TRUST_PROXY (trust proxy): <strong>${escapeHtml(trustText)}</strong></p>
</section>`;
    res.type('html').send(layout({ title: 'Your IP address', body }));
  });

  // The last 20 IndexNow submissions (Bing pings), newest first.
  router.get('/admin/indexnow', (req, res) => {
    const entries = typeof ctx.indexNow?.recent === 'function' ? ctx.indexNow.recent() : [];
    const status = ctx.indexNow?.enabled
      ? '<p>Bing pings are on. Approving or unpublishing a listing tells Bing right away.</p>'
      : `<p>Bing pings are off (${escapeHtml(ctx.indexNow?.reason || 'off')}).</p>`;
    const items = entries.map(e => `<li class="pending-item">
  <p><strong>${escapeHtml(adminTime(e.at))}</strong> &middot; ${escapeHtml(indexNowNote(e) || e.reason || '')}${e.status ? ` (status ${escapeHtml(String(e.status))})` : ''}</p>
  <ul>${e.urls.map(u => `<li>${escapeHtml(u)}</li>`).join('')}</ul>
</li>`).join('\n');
    const body = `<section class="admin">
  ${adminNav()}
  <h1>Bing pings (IndexNow)</h1>
  ${status}
  ${entries.length === 0 ? '<p>No pings sent since the last restart.</p>' : `<ul class="pending-list">\n${items}\n</ul>`}
</section>`;
    res.type('html').send(layout({ title: 'Bing pings', body }));
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
      const listingId = result.listing.id;
      const category = typeof result.listing.category === 'string' ? result.listing.category : '';
      ping([
        `/listings/${encodeURIComponent(listingId)}`,
        ...(category ? [`/?category=${encodeURIComponent(category)}`] : []),
        '/llms.txt',
        '/sitemap.xml',
      ], listingId);
      reply(req, res, { json: { ok: true, listingId }, note: 'approved', id: listingId });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/pending/:id/reject', form, async (req, res, next) => {
    try {
      const entry = (await pendingEntries()).find(e => e && e.id === req.params.id);
      if (!entry) return reply(req, res, { status: 404, json: { error: 'Pending entry not found' }, note: 'notfound' });
      if (entry.status !== 'pending') return reply(req, res, { status: 409, json: { error: 'Entry is not pending' }, note: 'notpending' });

      // Browsers ask first; API clients (bearer / JSON) act right away as before.
      if (wantsHtml(req) && req.body?.confirm !== 'yes') {
        const drafts = await ctx.store.collection('drafts').read();
        const name = (Array.isArray(drafts) ? drafts : []).find(d => d && d.id === entry.draftId)?.fields?.name || 'this listing';
        return res.type('html').send(confirmPage({
          title: 'Reject this listing?',
          question: `Reject ${name}? This can't be undone.`,
          action: `/admin/pending/${encodeURIComponent(entry.id)}/reject`,
          button: 'Yes, reject',
        }));
      }

      const result = await ctx.store.rejectDraft(entry.draftId);
      if (result.status === 404) return reply(req, res, { status: 404, json: { error: 'Draft not found' }, note: 'notfound' });
      if (result.status !== 200) return reply(req, res, { status: 409, json: { error: result.error ?? 'Cannot reject' }, note: 'failed' });
      reply(req, res, { json: { ok: true }, note: 'rejected', id: entry.id });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/listings/:id/unpublish', form, async (req, res, next) => {
    try {
      if (wantsHtml(req) && req.body?.confirm !== 'yes') {
        const live = ctx.store.findById(req.params.id);
        if (!live || ctx.store.isSeed(live.id)) {
          return reply(req, res, { status: live ? 409 : 404, json: { error: live ? 'Cannot unpublish' : 'Listing not found' }, note: live ? 'failed' : 'notfound' });
        }
        return res.type('html').send(confirmPage({
          title: 'Unpublish this listing?',
          question: `Unpublish ${live.name || 'this listing'}? It comes off the site right away. This can't be undone.`,
          action: `/admin/listings/${encodeURIComponent(live.id)}/unpublish`,
          button: 'Yes, unpublish',
        }));
      }
      const result = await ctx.store.unpublish(req.params.id);
      if (result.status === 404) return reply(req, res, { status: 404, json: { error: 'Listing not found' }, note: 'notfound' });
      if (result.status !== 200) return reply(req, res, { status: 409, json: { error: result.error ?? 'Cannot unpublish' }, note: 'failed' });
      // The removed page now 404s; telling Bing lets it drop the page sooner.
      ping([`/listings/${encodeURIComponent(req.params.id)}`, '/llms.txt', '/sitemap.xml'], req.params.id);
      reply(req, res, { json: { ok: true }, note: 'unpublished', id: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  // "Run AI check" from the admin page: the same Séance run as POST /seance/run.
  router.post('/admin/listings/:id/seance', async (req, res, next) => {
    try {
      const result = await runSeanceForListing(ctx, req.params.id, req.ip);
      if (!wantsHtml(req)) {
        if (result.retryAfterSeconds !== undefined) res.set('Retry-After', String(result.retryAfterSeconds));
        return res.status(result.status).json(result.json);
      }
      if (result.status === 201) return res.redirect(303, `/seance/${encodeURIComponent(req.params.id)}`);
      const note = {
        notfound: 'notfound', off: 'seanceoff', busy: 'seancebusy', limit: 'seancelimit', failed: 'seancefailed',
      }[result.reason] ?? 'seancefailed';
      return res.redirect(303, `/admin/pending?note=${note}`);
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/quotes/:id/handled', async (req, res, next) => {
    try {
      const result = await markQuoteHandled(ctx, req.params.id);
      if (!wantsHtml(req)) {
        return result.status === 200
          ? res.json({ ok: true })
          : res.status(404).json({ error: 'Quote not found' });
      }
      return res.redirect(303, `/admin/quotes?note=${result.status === 200 ? 'handled' : 'notfound'}`);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
