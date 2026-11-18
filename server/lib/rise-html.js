/**
 * rise-html.js — HTML for the owner listing pages (/rise): upload form,
 * draft review form, and message pages. Every dynamic value goes through
 * escapeHtml. Plain template literals, no engine.
 */

import { layout, escapeHtml, foundersInvite } from './html.js';
import { DAYS, STATE_HINT, STATE_ERROR } from './listing-fields.js';

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
  ownerEmail: 'Your email',
});

/** Help text under the owner email box. */
export const OWNER_EMAIL_HINT = 'Optional. Never shown publicly. We use it only to contact you about your listing and the quote requests customers send you.';

/** Placeholder in every hours box. */
export const HOURS_PLACEHOLDER = '7am-5pm, or Closed';

/** Hint under the hours boxes. */
export const HOURS_HINT = "Leave a day blank if it varies. Type Closed if you're closed.";

/** True when a draft's fields hold nothing the owner has typed yet. */
function isEmptyFields(fields) {
  if (!fields || typeof fields !== 'object') return true;
  return Object.values(fields).every(v => {
    if (typeof v === 'string') return v.trim() === '';
    if (Array.isArray(v)) return v.length === 0;
    if (v && typeof v === 'object') return Object.values(v).every(x => typeof x !== 'string' || x.trim() === '');
    return v === undefined || v === null;
  });
}

/**
 * A typed-in (manual) draft the owner has not saved or tried to confirm yet:
 * show neutral "Required" tags, not the red "Needs your input" ones.
 */
export function isFreshManualDraft(draft, opts = {}) {
  return draft?.provider === 'manual'
    && isEmptyFields(draft.fields)
    && opts.saved !== true
    && !opts.notice
    && opts.missingFields === undefined;
}

export const DEMO_BANNER_TEXT = 'Demo: no photo reader is connected, so this is a sample business, not your photo.';

/**
 * Page for the upload form: GET /rise.
 * @param {{ photoEnabled?: boolean, discarded?: boolean }} [opts]
 */
export function uploadPage({ photoEnabled = true, discarded = false, founders, fees } = {}) {
  const inviteHtml = foundersInvite(founders, { fees });
  const invite = inviteHtml ? `\n  ${inviteHtml}` : '';
  const discardedNote = discarded ? '\n  <p class="notice" role="status">Draft discarded.</p>' : '';
  const typeItIn = `<form class="rise-form type-it-in" method="POST" action="/rise/manual">
    <button type="submit">No photo? Type it in</button>
  </form>`;
  if (!photoEnabled) {
    const manualBody = `<section class="rise">
  <h1>List your business free</h1>${discardedNote}
  <p class="tagline">Type in your business name, phone, hours and what you do. It takes a few minutes.</p>
  <p>You get to look over every field before anything is published.</p>${invite}
  <form class="rise-form type-it-in" method="POST" action="/rise/manual">
    <button type="submit">Type it in</button>
  </form>
</section>`;
    return layout({ title: 'List your business free: First Answer Pages', body: manualBody });
  }
  const body = `<section class="rise">
  <h1>List your business free</h1>${discardedNote}
  <p class="tagline">Send a photo of a business card, flyer, sign or storefront. We will read it into a draft listing.</p>
  <p>You get to look over and fix every field before anything is published. The photo is read once and is not saved.</p>${invite}
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
 * @param {{ href: string, text: string, note?: string }} [second] optional button above the link, with a small note
 */
export function messagePage(title, message, link = { href: '/rise', text: 'Back to the start' }, second, extraHtml = '') {
  const more = second
    ? `\n  <p><a class="button" href="${escapeHtml(second.href)}">${escapeHtml(second.text)}</a></p>${second.note ? `\n  <p class="hint">${escapeHtml(second.note)}</p>` : ''}`
    : '';
  // extraHtml is built by our own code with every value escaped; never pass outside text here.
  const body = `<section class="message">
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>${extraHtml ? `\n  ${extraHtml}` : ''}${more}
  <p><a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a></p>
</section>`;
  return layout({ title, body });
}

/** Field-specific wording for a flagged field (default: "Needs your input"). */
const MISSING_NOTES = Object.freeze({ state: STATE_ERROR });

function row(key, inner, missing, fresh = false) {
  // A fresh typed-in form gets neutral "Required" tags; after a save or a
  // confirm attempt, missing fields turn red with "Needs your input".
  const flagged = missing.has(key);
  const cls = flagged && !fresh ? 'field missing' : 'field';
  const note = !flagged ? '' : fresh
    ? ' <span class="required-note">Required</span>'
    : ` <span class="missing-note">${escapeHtml(MISSING_NOTES[key] ?? 'Needs your input')}</span>`;
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
      <input type="text" id="f-hours-${d}" name="hours_${d}" value="${escapeHtml(hours[d] ?? '')}" maxlength="500" placeholder="${escapeHtml(HOURS_PLACEHOLDER)}">`).join('\n');

  const services = Array.isArray(f.services) ? f.services.join('\n') : '';

  const notice = opts.notice
    ? `<p class="notice" role="alert">${escapeHtml(opts.notice)}</p>`
    : '';
  const fresh = isFreshManualDraft(draft, opts);
  const summary = missing.size > 0 && !fresh
    ? `<p class="notice" role="alert">These fields need your input: ${[...missing].map(k => escapeHtml(FIELD_LABELS[k] ?? k)).join(', ')}.</p>`
    : '';

  // At the top of the page so a phone shows it without scrolling after the reload.
  const savedNote = opts.saved === true ? '<p class="notice saved-note" role="status">Saved.</p>' : '';
  const heading = fresh ? 'Type in your listing' : 'Check your listing';
  const tagline = fresh
    ? 'Fill in your business details, then press Confirm. Nobody can see it until we review it.'
    : 'This is a draft. Nobody can see it until you send it for review and we approve it.';

  const banner = draft.provider === 'mock'
    ? `<p class="demo-banner" role="note">${escapeHtml(DEMO_BANNER_TEXT)}</p>`
    : '';

  const body = `<section class="rise">
  <h1>${heading}</h1>
  ${savedNote}
  ${banner}
  <p class="tagline">${tagline}</p>
  ${notice}
  ${summary}
  <form class="rise-form" method="POST" action="${base}">
${row('name', input('name', f.name), missing, fresh)}
${row('category', `<select id="f-category" name="category">${categoryOptions}</select>`, missing, fresh)}
${row('phone', input('phone', f.phone, 'tel').replace('maxlength="500"', 'maxlength="500" autocomplete="tel"'), missing, fresh)}
${row('services', `<textarea id="f-services" name="services" rows="5">${escapeHtml(services)}</textarea>
      <span class="hint">One per line, or separate with commas.</span>`, missing, fresh)}
${row('serviceArea', input('serviceArea', f.serviceArea), missing, fresh)}
${row('description', `<textarea id="f-description" name="description" rows="4" maxlength="500">${escapeHtml(f.description ?? '')}</textarea>`, missing, fresh)}
${row('city', input('city', f.city), missing, fresh)}
${row('state', `<input type="text" id="f-state" name="state" value="${escapeHtml(f.state ?? '')}" maxlength="40" size="6" autocomplete="address-level1" aria-describedby="f-state-hint">
      <span class="hint" id="f-state-hint">${escapeHtml(STATE_HINT)}</span>`, missing, fresh)}
${row('address', input('address', f.address), missing, fresh)}
${row('ownerEmail', `<input type="email" id="f-ownerEmail" name="ownerEmail" value="${escapeHtml(f.ownerEmail ?? '')}" maxlength="254" autocomplete="email" aria-describedby="f-ownerEmail-hint">
      <span class="hint" id="f-ownerEmail-hint">${escapeHtml(OWNER_EMAIL_HINT)}</span>`, missing, fresh)}
    <fieldset class="hours-edit">
      <legend>Hours</legend>
      <p class="hint" id="hours-hint">${escapeHtml(HOURS_HINT)}</p>
${hoursRows}
    </fieldset>
    <div class="confirm">
      <h2>Send for review</h2>
      <p>Confirming saves your changes and sends this listing to us for review. We review every listing before it goes live. Once approved, it shows a stamp saying which details you confirmed and when.</p>
      <button type="submit" formaction="${base}">Save changes</button>
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
  return layout({ title: `${heading}: First Answer Pages`, body });
}

/**
 * The "Still correct" part of the owner's live-listing page: when the details
 * were last confirmed, and a button to confirm the same details again today.
 * @param {string} draftId
 * @param {{ current: boolean, date: string, fields: string }} view
 * @param {{ done?: boolean|'same', contactEmail?: string }} [opts]
 *   done: true when the owner just confirmed, 'same' when they had already confirmed in the last day
 * @returns {string}
 */
export function stillCorrectBlock(draftId, view, { done = false, contactEmail } = {}) {
  const what = view.fields ? view.fields.toLowerCase() : 'details';
  const one = Boolean(view.fields) && !view.fields.includes(' and ') && !view.fields.includes(',');
  const when = view.current
    ? `Your ${what} ${one ? 'was' : 'were'} confirmed on ${view.date}.`
    : `Your ${what} ${one ? 'was' : 'were'} last confirmed on ${view.date}. That is more than 90 days ago, so your listing no longer shows ${one ? 'it' : 'them'} as current.`;
  const note = done === 'same'
    ? '<p class="notice saved-note" role="status">You already confirmed your details in the last day. Nothing changed.</p>\n  '
    : done ? '<p class="notice saved-note" role="status">Thanks. Your details are confirmed as of today.</p>\n  ' : '';
  const email = contactEmail
    ? `<a href="mailto:${escapeHtml(contactEmail)}">email us</a>`
    : '<a href="/about">contact us</a>';
  return `${note}<p>${escapeHtml(when)}</p>
  <p>${escapeHtml(view.current
    ? `Your listing shows ${one ? 'it' : 'these details'} as current for 90 days. Save this page. Come back and press "Yes, still correct" whenever ${one ? 'it is' : 'your details are'} still right.`
    : `Press "Yes, still correct" if ${one ? 'it is' : 'they are'} still right, and your listing will show ${one ? 'it' : 'them'} as current again for 90 days.`)} If something changed, ${email}.</p>
  <form method="POST" action="/rise/drafts/${encodeURIComponent(draftId)}/still-correct">
    <button type="submit" class="button">Yes, still correct</button>
  </form>`;
}
