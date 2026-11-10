/**
 * Tests for the owner-flow fixes from the third review round (helper A):
 *   1. a fresh typed-in form is neutral ("Required"), not red, and says "Type in your listing"
 *   2. "Saved." sits in a status box at the top of the draft page
 *   3. services split on new lines and commas; city capitalization is tidied
 *   4. hours boxes carry a placeholder
 *   5. the thank-you page promises an email only when email is set up (resend) and an address was given
 *   6. honest help text under the owner email box
 *   7. the owner's draft link after approval points at the live listing
 *   8. the stamp fits inside its border on a phone
 *
 * Every app runs on a temporary DATA_DIR; nothing touches the network or the repo data/ folder.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createMockVisionProvider } from '../server/lib/vision.js';
import { escapeHtml } from '../server/lib/html.js';
import { tidyCity, validateFields } from '../server/lib/listing-fields.js';
import { parseServices } from '../server/routes/rise.js';
import { OWNER_EMAIL_HINT, HOURS_PLACEHOLDER, isFreshManualDraft } from '../server/lib/rise-html.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_DATA = path.join(REPO_ROOT, 'data');
const TOKEN = 'owner-flow-test-token';
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/** A notifier that records instead of sending. */
const quietNotifier = { name: 'resend', notify: async () => ({ ok: true }) };

async function makeEnv({ config = {}, notifier } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-owner-flow-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock: { now: () => Date.UTC(2026, 10, 10, 18, 0, 0) },
    newId: () => `draft-${++n}`,
    visionProvider: createMockVisionProvider(),
    rateLimiter: permissiveLimiter,
    ...(notifier ? { notifier } : {}),
    config: { adminToken: TOKEN, production: false, baseUrl: 'http://example.test', ...config },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p) => fetch(env.base + p, { redirect: 'manual' });
const postForm = (env, p, params = '') => fetch(env.base + p, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: params instanceof URLSearchParams ? params.toString() : params,
});

async function newManualDraft(env) {
  const res = await postForm(env, '/rise/manual');
  assert.equal(res.status, 303);
  return res.headers.get('location');
}

function form(extra = {}) {
  const fields = {
    name: 'Copper Kettle Plumbing',
    category: 'plumbers',
    phone: '(615) 555-0101',
    services: 'Leak repair\nWater heaters',
    serviceArea: 'Greater Springfield',
    description: 'We fix pipes.',
    city: 'Springfield',
    state: 'TN',
    address: '',
    ownerEmail: '',
    ...extra,
  };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) p.set(k, v);
  p.set('hours_monday', '7:00 AM - 5:00 PM');
  return p;
}

const readDrafts = async env => JSON.parse(await fs.readFile(path.join(env.dir, 'drafts.json'), 'utf8'));
const mainOf = html => html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
const count = (text, part) => text.split(part).length - 1;

// ---- 1. fresh typed-in form ---------------------------------------------------------

test('a fresh typed-in form has neutral "Required" tags, no red box, and the right headings', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  const html = await (await get(env, draftPath)).text();

  assert.match(html, /<h1>Type in your listing<\/h1>/);
  assert.match(html, /<title>Type in your listing/);
  assert.ok(!html.includes('need your input'), 'no red summary box');
  assert.ok(!html.includes('Needs your input'), 'no red tags');
  assert.ok(!html.includes('field missing'), 'no red field outline');
  for (const label of ['Business name', 'Category', 'Phone', 'Services', 'Service area', 'Short description', 'City', 'State']) {
    assert.ok(html.includes(`${escapeHtml(label)} <span class="required-note">Required</span>`), label);
  }
  assert.ok(!html.includes('Street address <span'), 'optional fields get no tag');
  assert.match(html, /<h2>Send for review<\/h2>/);
  assert.ok(!html.includes('<h2>Publish</h2>'));
});

test('after a save or a confirm attempt, missing fields turn red', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);

  // Save with only a name: the rest is missing and now shown in red.
  assert.equal((await postForm(env, draftPath, new URLSearchParams({ name: 'Acme' }))).status, 303);
  const saved = await (await get(env, `${draftPath}?saved=1`)).text();
  assert.match(saved, /<h1>Check your listing<\/h1>/);
  assert.ok(saved.includes('These fields need your input'));
  assert.ok(saved.includes('Needs your input'));
  assert.ok(!saved.includes('required-note'));

  // A fresh draft confirmed empty is red too.
  const second = await newManualDraft(env);
  const res = await postForm(env, `${second}/confirm`);
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.ok(html.includes('These fields need your input'));
  assert.ok(!html.includes('required-note'));
});

test('photo drafts keep the red tags and the "Check your listing" heading', async () => {
  const draft = { id: 'p', provider: 'anthropic', fields: {}, missingFields: ['name'] };
  assert.equal(isFreshManualDraft(draft), false);
  assert.equal(isFreshManualDraft({ ...draft, provider: 'manual' }), true);
  assert.equal(isFreshManualDraft({ ...draft, provider: 'manual', fields: { name: 'A' } }), false);
  assert.equal(isFreshManualDraft({ ...draft, provider: 'manual' }, { saved: true }), false);
  assert.equal(isFreshManualDraft({ ...draft, provider: 'manual' }, { missingFields: [] }), false);
});

// ---- 2. "Saved." at the top -----------------------------------------------------------

test('"Saved." is a status box at the top of the draft page, before the form', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  assert.equal((await postForm(env, draftPath, form())).status, 303);
  const html = mainOf(await (await get(env, `${draftPath}?saved=1`)).text());
  const box = html.indexOf('<p class="notice saved-note" role="status">Saved.</p>');
  assert.ok(box > 0, 'status box present');
  assert.ok(box < html.indexOf('<form'), 'above the form');
  assert.ok(box < html.indexOf('class="tagline"'), 'right under the heading');
  assert.equal(count(html, 'Saved.'), 1);
});

// ---- 3. services and city -------------------------------------------------------------

test('services split on new lines and commas, trimmed, with no empty items', async () => {
  assert.deepEqual(parseServices('leak repair, drain cleaning, water heaters'), ['leak repair', 'drain cleaning', 'water heaters']);
  assert.deepEqual(parseServices('Leak repair\r\nDrains,  Heaters ,,\n\n'), ['Leak repair', 'Drains', 'Heaters']);
  assert.deepEqual(parseServices(''), []);
  assert.deepEqual(parseServices(undefined), []);

  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  await postForm(env, draftPath, form({ services: 'leak repair, drain cleaning, water heaters' }));
  const [draft] = await readDrafts(env);
  assert.deepEqual(draft.fields.services, ['leak repair', 'drain cleaning', 'water heaters']);
  const html = await (await get(env, draftPath)).text();
  assert.ok(html.includes('One per line, or separate with commas.'));
});

test('property: parsed services never contain commas, line breaks, or empty items', () => {
  fc.assert(
    fc.property(fc.string(), text => {
      for (const s of parseServices(text)) {
        if (s === '' || /[,\r\n]/.test(s) || s !== s.trim()) return false;
      }
      return true;
    }),
    { numRuns: 200 },
  );
});

test('city capitalization is tidied; mixed case is left alone', async () => {
  assert.equal(tidyCity('nashville'), 'Nashville');
  assert.equal(tidyCity('st. louis'), 'St. Louis');
  assert.equal(tidyCity('winston-salem'), 'Winston-Salem');
  assert.equal(tidyCity('NASHVILLE'), 'Nashville');
  assert.equal(tidyCity('McMinnville'), 'McMinnville');
  assert.equal(tidyCity('Nash ville'), 'Nash ville');
  assert.equal(tidyCity(''), '');

  const { fields } = validateFields({ city: 'nashville', state: 'tn' }, categories);
  assert.equal(fields.city, 'Nashville');
  assert.equal(fields.state, 'TN');

  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  await postForm(env, draftPath, form({ city: 'nashville', state: 'tn' }));
  const [draft] = await readDrafts(env);
  assert.equal(draft.fields.city, 'Nashville');
  assert.equal(draft.fields.state, 'TN');
});

test('property: tidyCity is idempotent and keeps mixed-case input as typed', () => {
  fc.assert(
    fc.property(fc.string(), text => {
      const once = tidyCity(text);
      if (tidyCity(once) !== once) return false;
      if (/\p{Ll}/u.test(text) && /\p{Lu}/u.test(text)) return once === text;
      return true;
    }),
    { numRuns: 300 },
  );
});

// ---- 4. hours placeholder ---------------------------------------------------------

test('every hours box has the "7am-5pm, or Closed" placeholder', async () => {
  assert.equal(HOURS_PLACEHOLDER, '7am-5pm, or Closed');
  const env = await makeEnv();
  const html = await (await get(env, await newManualDraft(env))).text();
  for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    assert.match(html, new RegExp(`id="f-hours-${day}"[^>]*placeholder="7am-5pm, or Closed"`), day);
  }
});

// ---- 5. thank-you page --------------------------------------------------------------

test('the thank-you page says when we review and that an owner with an email will hear back', async () => {
  const review = escapeHtml("We'll review your listing, usually within one business day.");
  const hearBack = escapeHtml("If you gave us your email, we'll let you know when it's live.");
  const oldPromise = escapeHtml("We'll email you when it's live.");

  const cases = [
    { config: {}, email: 'owner@example.test' },
    { config: {}, email: '' },
    { config: { notifierName: 'resend' }, email: '' },
    { config: { notifierName: 'resend' }, email: 'owner@example.test' },
  ];
  for (const c of cases) {
    const env = await makeEnv({ config: c.config, notifier: c.config.notifierName ? quietNotifier : undefined });
    const draftPath = await newManualDraft(env);
    assert.equal((await postForm(env, `${draftPath}/confirm`, form({ ownerEmail: c.email }))).status, 303);
    const page = mainOf(await (await get(env, draftPath)).text());
    assert.equal(count(page, 'Thanks!'), 1);
    assert.equal(count(page, review), 1);
    assert.equal(count(page, hearBack), 1, JSON.stringify(c));
    assert.equal(count(page, oldPromise), 0, JSON.stringify(c));
  }
});

// ---- 6. owner email help text -------------------------------------------------------

test('the owner email box has honest help text tied to the input', async () => {
  assert.equal(OWNER_EMAIL_HINT, 'Optional. Never shown publicly. We use it only to contact you about your listing and the quote requests customers send you.');
  const env = await makeEnv();
  const html = await (await get(env, await newManualDraft(env))).text();
  assert.match(html, /<input type="email" id="f-ownerEmail"[^>]*aria-describedby="f-ownerEmail-hint"/);
  assert.ok(html.includes(`<span class="hint" id="f-ownerEmail-hint">${escapeHtml(OWNER_EMAIL_HINT)}</span>`));
  assert.ok(!html.includes('only to send you quote requests'));
});

// ---- 7. after approval ------------------------------------------------------------

test('after approval the draft link shows "Your listing is live" and edits return that page', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  assert.equal((await postForm(env, `${draftPath}/confirm`, form())).status, 303);
  const approved = await fetch(`${env.base}/admin/pending/${draftPath.split('/').pop()}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(approved.status, 200);
  const { listingId } = await approved.json();

  const page = await get(env, draftPath);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<h1>Your listing is live<\/h1>/);
  assert.ok(html.includes(`<a href="/listings/${listingId}">See your listing</a>`));
  assert.ok(!html.includes('<form'), 'no editable fields');
  assert.ok(!html.includes('This is a draft'));

  for (const p of [draftPath, `${draftPath}/confirm`]) {
    const res = await postForm(env, p, form({ name: 'Changed Name' }));
    assert.equal(res.status, 409);
    const body = await res.text();
    assert.match(body, /<h1>Your listing is live<\/h1>/, p);
    assert.ok(!body.includes('Draft locked'), p);
  }
});

test('an edit to a draft waiting for review returns the thank-you page, not "Draft locked"', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  assert.equal((await postForm(env, `${draftPath}/confirm`, form())).status, 303);
  const res = await postForm(env, draftPath, form({ name: 'Changed' }));
  assert.equal(res.status, 409);
  const body = await res.text();
  assert.match(body, /<h1>Thanks!<\/h1>/);
  assert.ok(!body.includes('Draft locked'));
});

// ---- 8. stamp on a phone ----------------------------------------------------------

test('the stamp gets smaller type, less tilt, and may wrap between words on a narrow screen', async () => {
  const css = await fs.readFile(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8');
  const block = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css);
  assert.ok(block, 'narrow-screen block present');
  assert.match(block[1], /\.stamp \{[^}]*transform: rotate\(-1deg\)/);
  assert.match(block[1], /\.stamp-title \{[^}]*font-size: 0\.95rem[^}]*white-space: normal/);
  // The date itself still never breaks.
  assert.match(css, /\.stamp-date\b[^{}]*\{[^}]*white-space:\s*nowrap/);
});
