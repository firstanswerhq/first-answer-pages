/**
 * rise-html.js — HTML for the owner listing pages (/rise): upload form,
 * draft review form, and message pages. Every dynamic value goes through
 * escapeHtml. Plain template literals, no engine.
 */

import { layout, escapeHtml } from './html.js';
import { DAYS } from './listing-fields.js';

const DAY_LABELS = Object.freeze(
  Object.fromEntries(DAYS.map(d => [d, d[0].toUpperCase() + d.slice(1)])),
);

const FIELD_LABELS = Object.freeze({
  name: 'Business name',
  category: 'Category',
  phone: 'Phone',
  services: 'Services',
  serviceArea: 'Service area',
  description: 'Short description',
  city: 'City',
  state: 'State',
  address: 'Street address',
  ownerEmail: 'Your email (private, we use it only to send you quote requests)',
});

export const DEMO_BANNER_TEXT = 'Demo: no photo reader is connected, so this is a sample business, not your photo.';

/**
 * Page for the upload form: GET /rise.
 * @param {{ photoEnabled?: boolean, discarded?: boolean }} [opts]
 */
export function uploadPage({ photoEnabled = true, discarded = false } = {}) {
  const discardedNote = discarded ? '\n  <p class="notice" role="status">Draft discarded.</p>' : '';
  const typeItIn = `<form class="rise-form type-it-in" method="POST" action="/rise/manual">
    <button type="submit">No photo? Type it in</button>
  </form>`;
  if (!photoEnabled) {
    const manualBody = `<section class="rise">
  <h1>List your business free</h1>${discardedNote}
  <p class="tagline">Type in your business name, phone, hours and what you do. It takes a few minutes.</p>
  <p>You get to look over every field before anything is published.</p>
  <form class="rise-form type-it-in" method="POST" action="/rise/manual">
    <button type="submit">Type it in</button>
  </form>
</section>`;
    return layout({ title: 'List your business free: First Answer Pages', body: manualBody });
  }
  const body = `<section class="rise">
  <h1>List your business free</h1>${discardedNote}
  <p class="tagline">Send a photo of a business card, flyer, sign or storefront. We will read it into a draft listing.</p>
  <p>You get to look over and fix every field before anything is published. The photo is read once and is not saved.</p>
  <form id="rise-form" class="rise-form" method="POST" action="/rise" enctype="application/x-www-form-urlencoded">
    <label for="imageFile" class="big-button">Take or choose a photo</label>
    <input type="file" id="imageFile" class="visually-hidden-file" accept="image/jpeg,image/png,image/webp" capture="environment">
    <p class="hint">JPEG, PNG, or WebP, up to 5 MB.</p>
    <p id="rise-status" class="hint" role="status"></p>
  </form>
  <noscript>
    <p class="hint">Photo upload needs JavaScript. You can still type your listing in below.</p>
  </noscript>
  ${typeItIn}
</section>`;
  return layout({ title: 'List your business free: First Answer Pages', body, scripts: ['/js/rise.js'] });
}

/**
 * Simple message page (errors and notices).
 * @param {string} title
 * @param {string} message plain text, escaped here
 * @param {{ href: string, text: string }} [link]
 */
export function messagePage(title, message, link = { href: '/rise', text: 'Back to the start' }) {
  const body = `<section class="message">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p><a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a></p>
</section>`;
  return layout({ title, body });
}

function row(key, inner, missing) {
  const cls = missing.has(key) ? 'field missing' : 'field';
  const note = missing.has(key) ? ' <span class="missing-note">Needs your input</span>' : '';
  return `    <div class="${cls}">
      <label for="f-${key}">${escapeHtml(FIELD_LABELS[key])}${note}</label>
      ${inner}
    </div>`;
}

function input(key, value, type = 'text') {
  return `<input type="${type}" id="f-${key}" name="${key}" value="${escapeHtml(value ?? '')}" maxlength="500">`;
}

/**
 * Editable review form for a draft.
 * @param {{ id: string, fields: object, missingFields?: string[] }} draft
 * @param {{ slug: string, label: string }[]} categories
 * @param {{ missingFields?: string[], notice?: string, saved?: boolean }} [opts]
 *   `missingFields` overrides the draft's own list (used after a 422).
 */
export function reviewPage(draft, categories, opts = {}) {
  const f = draft.fields ?? {};
  const missing = new Set(opts.missingFields ?? draft.missingFields ?? []);
  const base = `/rise/drafts/${encodeURIComponent(draft.id)}`;

  const categoryOptions = [`<option value=""${f.category ? '' : ' selected'}>Choose a category</option>`]
    .concat(categories.map(c =>
      `<option value="${escapeHtml(c.slug)}"${c.slug === f.category ? ' selected' : ''}>${escapeHtml(c.label)}</option>`))
    .join('');

  const hours = f.hours && typeof f.hours === 'object' ? f.hours : {};
  const hoursRows = DAYS.map(d =>
    `      <label for="f-hours-${d}">${DAY_LABELS[d]}</label>
      <input type="text" id="f-hours-${d}" name="hours_${d}" value="${escapeHtml(hours[d] ?? '')}" maxlength="500">`).join('\n');

  const services = Array.isArray(f.services) ? f.services.join('\n') : '';

  const notice = opts.notice
    ? `<p class="notice" role="alert">${escapeHtml(opts.notice)}</p>`
    : '';
  const summary = missing.size > 0
    ? `<p class="notice" role="alert">These fields need your input: ${[...missing].map(k => escapeHtml(FIELD_LABELS[k] ?? k)).join(', ')}.</p>`
    : '';

  const savedNote = opts.saved === true ? ' <span class="saved-note" role="status">Saved.</span>' : '';

  const banner = draft.provider === 'mock'
    ? `<p class="demo-banner" role="note">${escapeHtml(DEMO_BANNER_TEXT)}</p>`
    : '';

  const body = `<section class="rise">
  <h1>Check your listing</h1>
  ${banner}
  <p class="tagline">This is a draft. Nobody can see it until you confirm it.</p>
  ${notice}
  ${summary}
  <form class="rise-form" method="POST" action="${base}">
${row('name', input('name', f.name), missing)}
${row('category', `<select id="f-category" name="category">${categoryOptions}</select>`, missing)}
${row('phone', input('phone', f.phone, 'tel').replace('maxlength="500"', 'maxlength="500" autocomplete="tel"'), missing)}
${row('services', `<textarea id="f-services" name="services" rows="5">${escapeHtml(services)}</textarea>
      <span class="hint">One service per line.</span>`, missing)}
${row('serviceArea', input('serviceArea', f.serviceArea), missing)}
${row('description', `<textarea id="f-description" name="description" rows="4" maxlength="500">${escapeHtml(f.description ?? '')}</textarea>`, missing)}
${row('city', input('city', f.city), missing)}
${row('state', `<input type="text" id="f-state" name="state" value="${escapeHtml(f.state ?? '')}" maxlength="2" size="3">`, missing)}
${row('address', input('address', f.address), missing)}
${row('ownerEmail', `<input type="email" id="f-ownerEmail" name="ownerEmail" value="${escapeHtml(f.ownerEmail ?? '')}" maxlength="254" autocomplete="email">`, missing)}
    <fieldset class="hours-edit">
      <legend>Hours</legend>
${hoursRows}
    </fieldset>
    <div class="confirm">
      <h2>Publish</h2>
      <p>Confirming saves your changes and sends this listing to us for review. We review every listing before it goes live. Once approved it is marked Owner-confirmed.</p>
      <button type="submit" formaction="${base}">Save changes</button>${savedNote}
      <button type="submit" formaction="${base}/confirm">Confirm and send for review</button>
    </div>
  </form>

  <details class="discard-confirm">
    <summary>Discard this draft</summary>
    <p>Discard this draft?</p>
    <form class="rise-form discard" method="POST" action="${base}/discard">
      <button type="submit">Yes, discard</button>
    </form>
  </details>
</section>`;
  return layout({ title: 'Check your listing: First Answer Pages', body });
}
