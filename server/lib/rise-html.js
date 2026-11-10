/**
 * rise-html.js — HTML for the Rise from the Grave pages: upload form,
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

/** Page for the upload form: GET /rise. */
export function uploadPage() {
  const body = `<section class="rise">
  <h1>Rise from the Grave</h1>
  <p class="tagline">Have an old printed ad? Send us a photo and we will read it into a draft listing.</p>
  <p>You get to look over and fix every field before anything is published. The photo is read once and is not saved.</p>
  <form id="rise-form" class="rise-form" method="POST" action="/rise" enctype="application/x-www-form-urlencoded">
    <label for="imageBase64">Image as base64 text</label>
    <textarea id="imageBase64" name="imageBase64" rows="8" required></textarea>
    <p class="hint">Pictures can be JPEG, PNG, or WebP, up to 5 MiB.</p>
    <button type="submit">Read my ad</button>
    <p id="rise-status" class="hint" role="status"></p>
  </form>
  <noscript>
    <p class="hint">Picking a file needs JavaScript. Without it, paste the image as base64 text above, or send the file with curl:</p>
    <pre>curl --data-binary @ad.jpg -H "Content-Type: image/jpeg" -i http://localhost:3000/rise</pre>
  </noscript>
</section>`;
  return layout({ title: 'Rise from the Grave: First Answer Pages', body, scripts: ['/js/rise.js'] });
}

/**
 * Simple message page (errors and notices).
 * @param {string} title
 * @param {string} message plain text, escaped here
 * @param {{ href: string, text: string }} [link]
 */
export function messagePage(title, message, link = { href: '/rise', text: 'Back to Rise from the Grave' }) {
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

function input(key, value) {
  return `<input type="text" id="f-${key}" name="${key}" value="${escapeHtml(value ?? '')}" maxlength="500">`;
}

/**
 * Editable review form for a draft.
 * @param {{ id: string, fields: object, missingFields?: string[] }} draft
 * @param {{ slug: string, label: string }[]} categories
 * @param {{ missingFields?: string[], notice?: string }} [opts]
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
${row('phone', input('phone', f.phone), missing)}
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
    <button type="submit">Save changes</button>
  </form>

  <form class="rise-form confirm" method="POST" action="${base}/confirm">
    <h2>Publish</h2>
    <p>Confirming sends this listing to us for review. Once we approve it, it goes live and is marked Owner-confirmed. This is not an ownership check. We do not verify who you are or that the business is yours.</p>
    <p>Save your changes first. Confirm sends the saved draft.</p>
    <button type="submit">Confirm and send for review</button>
  </form>

  <form class="rise-form discard" method="POST" action="${base}/discard">
    <button type="submit">Discard this draft</button>
  </form>
</section>`;
  return layout({ title: 'Check your listing: First Answer Pages', body });
}
