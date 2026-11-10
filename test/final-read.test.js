/**
 * Tests for the fixes from the final human read (helper D):
 *   1. real state codes only; full names become codes; hint and error wording
 *   2. /privacy never says "contact us" without an address
 *   3. empty-category invites on the home page
 *   4. the draft tagline says review and approval, not "confirm"
 *   5. hours: every day shown once one is filled, a skipped day reads "Call for hours",
 *      a typed "closed" reads "Closed", and a hint under the hours boxes
 *   6. /admin/quotes "Forward to the business" mailto
 *   7. thank-you wording (in owner-flow-fixes) and the owner email line after reject
 *   8. duplicate wording (in admin-review)
 *   9. listing meta description (in public-pages)
 *  10. name links in results, quote error for typed-but-invalid contact,
 *      tap-to-call phone in the thank-you banner, readable Séance dates,
 *      one clear llms.txt header line, and the admin Log out button inline
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
import { escapeHtml, displayHours, listingCard } from '../server/lib/html.js';
import {
  normalizeState, validateFields, US_STATE_CODES, STATE_HINT, STATE_ERROR,
} from '../server/lib/listing-fields.js';
import { HOURS_HINT } from '../server/lib/rise-html.js';
import { emptyTradeText } from '../server/routes/home.js';
import { seanceReportPage } from '../server/lib/seance-html.js';
import { generateLlmsTxt } from '../server/lib/llms.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_DATA = path.join(REPO_ROOT, 'data');
const TOKEN = 'final-read-token';
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'))
  .filter(c => c && typeof c.slug === 'string');

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function makeEnv({ config = {}, published = [], drafts = [], quotes } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-final-read-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify(drafts));
  await fs.writeFile(path.join(dir, 'pending.json'), JSON.stringify(
    drafts.map(d => ({ id: d.id, draftId: d.id, submittedAt: d.createdAt, status: 'pending' })),
  ));
  if (quotes) await fs.writeFile(path.join(dir, 'quotes.json'), JSON.stringify(quotes));
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock: { now: () => Date.UTC(2026, 10, 10, 20, 0, 0) },
    newId: () => `draft-${++n}`,
    rateLimiter: permissiveLimiter,
    config: { adminToken: TOKEN, production: false, demoMode: true, baseUrl: 'http://example.test', ...config },
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

const bearer = { authorization: `Bearer ${TOKEN}` };
const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });
const postForm = (env, p, params = '', headers = {}) => fetch(env.base + p, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: params instanceof URLSearchParams ? params.toString() : params,
});
const mainOf = html => html.slice(html.indexOf('<main>'), html.indexOf('</main>'));

function draftForm(extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({
    name: 'Copper Kettle Plumbing',
    category: 'plumbers',
    phone: '(615) 555-0101',
    services: 'Leak repair, Water heaters',
    serviceArea: 'Greater Springfield',
    description: 'We fix pipes.',
    city: 'Springfield',
    state: 'TN',
    address: '',
    ownerEmail: '',
    ...extra,
  })) p.set(k, v);
  p.set('hours_monday', '7:00 AM - 5:00 PM');
  return p;
}

async function newManualDraft(env) {
  const res = await postForm(env, '/rise/manual');
  assert.equal(res.status, 303);
  return res.headers.get('location');
}

const OWNER = Object.freeze({
  id: 'kettle-plumbing-springfield',
  name: 'Kettle Plumbing',
  category: 'plumbers',
  phone: '(615) 555-0177',
  hours: { monday: '7:00 AM - 5:00 PM' },
  services: ['Leak repair'],
  serviceArea: 'Springfield',
  description: 'We fix pipes.',
  city: 'Springfield',
  state: 'TN',
  ownerEmail: 'owner+jobs@kettle.example',
});

// ---- 1. state ---------------------------------------------------------------------

test('state: codes in any case and full names become the 2-letter code; anything else fails', () => {
  assert.equal(US_STATE_CODES.size, 51);
  for (const [typed, code] of [
    ['TN', 'TN'], ['tn', 'TN'], ['Tennessee', 'TN'], ['tennessee', 'TN'], ['TENNESSEE', 'TN'],
    ['New York', 'NY'], ['north  carolina', 'NC'], ['District of Columbia', 'DC'], ['D.C.', 'DC'],
    ['Washington', 'WA'],
  ]) {
    assert.equal(normalizeState(typed), code, typed);
    const { fields, missingFields } = validateFields({ ...OWNER, state: typed }, categories);
    assert.equal(fields.state, code, typed);
    assert.ok(!missingFields.includes('state'), typed);
  }
  for (const bad of ['TE', 'ZZ', 'Tenn', 'XX', 'Tennesee', '12', '']) {
    const { fields, missingFields } = validateFields({ ...OWNER, state: bad }, categories);
    assert.equal(fields.state, '', bad);
    assert.ok(missingFields.includes('state'), bad);
  }
});

test('Property: a validated state is always one of the 51 real codes', () => {
  fc.assert(fc.property(fc.oneof(fc.string({ maxLength: 20 }), fc.constantFrom(...US_STATE_CODES)), raw => {
    const { fields, missingFields } = validateFields({ ...OWNER, state: raw }, categories);
    if (missingFields.includes('state')) assert.equal(fields.state, '');
    else assert.ok(US_STATE_CODES.has(fields.state), fields.state);
  }), { numRuns: 200 });
});

test('the State box has the hint, no 2-character cutoff, and the 2-letter error after a bad save', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  const fresh = await (await get(env, draftPath)).text();
  assert.ok(!/id="f-state"[^>]*maxlength="2"/.test(fresh), 'no maxlength that cuts "Tennessee" to "TE"');
  assert.ok(fresh.includes(`<span class="hint" id="f-state-hint">${escapeHtml(STATE_HINT)}</span>`));
  assert.equal(STATE_HINT, '2 letters, like TN');

  // A full name is fixed on save.
  assert.equal((await postForm(env, draftPath, draftForm({ state: 'Tennessee' }))).status, 303);
  const saved = await (await get(env, draftPath)).text();
  assert.match(saved, /id="f-state" name="state" value="TN"/);

  // Something that isn't a state gets the field-specific message.
  await postForm(env, draftPath, draftForm({ state: 'Tenn' }));
  const bad = await (await get(env, draftPath)).text();
  assert.ok(bad.includes(escapeHtml(STATE_ERROR)), 'state error shown');
  assert.equal(STATE_ERROR, 'Use the 2-letter state, like TN.');
});

// ---- 2. privacy -------------------------------------------------------------------

test('/privacy never says "contact us" without an address', async () => {
  const without = await makeEnv();
  const plain = mainOf(await (await get(without, '/privacy')).text());
  assert.ok(!plain.includes('contact us'), 'no dead-end "contact us"');
  assert.ok(plain.includes('ask the business you contacted, or reply to any email from us'));

  const withEmail = await makeEnv({ config: { contactEmail: 'hello@example.test' } });
  const page = mainOf(await (await get(withEmail, '/privacy')).text());
  assert.ok(page.includes('contact us and we will delete it'));
  assert.ok(page.includes('hello@example.test'));
});

// ---- 3. empty-category invites ----------------------------------------------------

test('empty categories invite owners in plain words', async () => {
  assert.equal(emptyTradeText(''), 'No businesses listed yet. Own one?');
  assert.equal(emptyTradeText('Plumbers'), 'No plumbers listed yet. Own one?');
  assert.equal(emptyTradeText('Pressure Washing'), 'No pressure washing businesses listed yet. Own one?');
  assert.equal(emptyTradeText('Pools and Concrete'), 'No pools and concrete businesses listed yet. Own one?');
  assert.equal(emptyTradeText('Other'), 'No other businesses listed yet. Own one?');

  const env = await makeEnv({ config: { demoMode: false } });
  const home = await (await get(env, '/')).text();
  assert.ok(home.includes('No businesses listed yet. Own one? <a href="/rise">List it free &rarr;</a>'));
  const cat = await (await get(env, '/?category=pressure-washing')).text();
  assert.ok(cat.includes('No pressure washing businesses listed yet. Own one? <a href="/rise">List it free &rarr;</a>'));
  const other = await (await get(env, '/?category=other')).text();
  assert.ok(other.includes('No other businesses listed yet. Own one?'));
  assert.ok(!cat.includes('Are you one?'));
});

// ---- 4 and 5. draft page wording and hours ----------------------------------------

test('the draft page says review and approval, and the hours boxes have their hint', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  assert.equal((await postForm(env, draftPath, draftForm())).status, 303);
  const page = await (await get(env, draftPath)).text();
  assert.ok(page.includes('This is a draft. Nobody can see it until you send it for review and we approve it.'));
  assert.ok(!page.includes('until you confirm it'));
  assert.ok(page.includes(escapeHtml(HOURS_HINT)));
  assert.equal(HOURS_HINT, "Leave a day blank if it varies. Type Closed if you're closed.");
});

test('displayHours: nothing filled gives []; otherwise every day, skipped days say "Call for hours"', () => {
  assert.deepEqual(displayHours({}), []);
  assert.deepEqual(displayHours({ monday: '  ' }), []);
  const out = displayHours({ monday: '8-4', saturday: 'closed', sunday: 'CLOSED.' });
  assert.equal(out.length, 7);
  assert.deepEqual(out[0], ['Monday', '8-4']);
  assert.deepEqual(out[1], ['Tuesday', 'Call for hours']);
  assert.deepEqual(out[5], ['Saturday', 'Closed']);
  assert.deepEqual(out[6], ['Sunday', 'Closed']);
  fc.assert(fc.property(fc.dictionary(fc.constantFrom('monday', 'tuesday', 'friday', 'sunday'), fc.string()), hours => {
    const shown = displayHours(hours);
    const anyFilled = Object.values(hours).some(v => typeof v === 'string' && v.trim() !== '');
    assert.equal(shown.length, anyFilled ? 7 : 0);
    for (const [day, text] of shown) {
      const typed = hours[day.toLowerCase()];
      if (typeof typed !== 'string' || typed.trim() === '') assert.equal(text, 'Call for hours');
    }
  }));
});

test('llms.txt keeps only the filled days (data), with "Closed" tidied', () => {
  const text = generateLlmsTxt([{ ...OWNER, hours: { monday: '8-4', sunday: 'closed' } }], 'http://example.test', categories);
  const line = text.split('\n').find(l => l.startsWith('Hours:'));
  assert.equal(line, 'Hours: Monday 8-4; Sunday Closed');
});

// ---- 6 and 7. admin: forward a quote, tell a rejected owner ------------------------

test('/admin/quotes offers "Forward to the business" with an encoded mailto for open quotes', async () => {
  const quote = {
    id: 'q1', listingId: OWNER.id, name: 'Pat & "Sam"', contact: '615-555-0199',
    details: 'Leak under the sink?\nToday if possible.', createdAt: '2026-11-10T19:00:00.000Z', emailed: false, notifier: 'none',
  };
  const handled = { ...quote, id: 'q2', handled: true, handledAt: '2026-11-10T19:30:00.000Z' };
  // Already emailed by Resend: no forward link, so the business never gets it twice.
  const emailed = { ...quote, id: 'q3', emailed: true, notifier: 'resend' };
  const env = await makeEnv({ published: [OWNER], quotes: [quote, handled, emailed] });
  const html = await (await get(env, '/admin/quotes', bearer)).text();
  assert.ok(html.includes(`Forward this quote to the business &rarr;</a> (<span class="owner-email">${escapeHtml(OWNER.ownerEmail)}</span>)`));
  const hrefs = [...html.matchAll(/<a href="(mailto:[^"]*)">Forward this quote to the business &rarr;<\/a>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  assert.equal(hrefs.length, 1, 'only the open, not-yet-emailed quote gets a forward link');
  const href = hrefs[0];
  assert.ok(href.startsWith('mailto:owner%2Bjobs@kettle.example?subject='));
  const url = new URL(href);
  assert.equal(url.searchParams.get('subject'), 'Quote request from Pat & "Sam" via First Answer Pages');
  const body = url.searchParams.get('body');
  assert.ok(body.includes('Name: Pat & "Sam"') && body.includes('Contact: 615-555-0199') && body.includes('Details: Leak under the sink?\nToday if possible.'));
  assert.ok(!href.includes(' ') && !href.includes('"') && !href.includes('\n'), 'every part is encoded');
});

test('after a reject the queue offers "Let the owner know" with the owner email', async () => {
  const d = {
    id: 'd1', status: 'pending', provider: 'manual',
    fields: { ...OWNER, ownerEmail: 'owner@kettle.example' },
    missingFields: [], createdAt: '2026-11-10T19:00:00.000Z', reservedId: 'kettle-1',
  };
  const env = await makeEnv({ drafts: [d] });
  const res = await postForm(env, '/admin/pending/d1/reject', '', bearer);
  assert.equal(res.status, 200);
  const page = await (await get(env, '/admin/pending?note=rejected&id=d1', bearer)).text();
  assert.ok(page.includes('Let the owner know: <span class="owner-email">owner@kettle.example</span>'));
  assert.match(page, /<a href="mailto:owner@kettle\.example\?subject=About%20your%20listing[^"]*">Email the owner<\/a>/);
  // No email, no line.
  const none = await (await get(env, '/admin/pending?note=rejected&id=nope', bearer)).text();
  assert.ok(!none.includes('Let the owner know:'));
});

// ---- 10. smaller items ------------------------------------------------------------

test('in results the business name links to the listing', () => {
  const html = listingCard({ ...OWNER, name: 'Kettle <Plumbing>' }, categories);
  assert.ok(html.includes(`<strong><a href="/listings/${OWNER.id}">Kettle &lt;Plumbing&gt;</a></strong>`));
});

test('quote form: empty contact says "Please enter…", a typed but invalid one says it does not look right', async () => {
  const env = await makeEnv({ published: [OWNER] });
  const path_ = `/listings/${OWNER.id}/quote`;
  const typed = await postForm(env, path_, new URLSearchParams({ name: 'Pat', contact: 'call me maybe', details: 'Leak' }));
  assert.equal(typed.status, 422);
  assert.ok((await typed.text()).includes('That doesn&#39;t look like a phone number or email.'));
  const empty = await postForm(env, path_, new URLSearchParams({ name: 'Pat', contact: '   ', details: 'Leak' }));
  assert.equal(empty.status, 422);
  const emptyHtml = await empty.text();
  assert.ok(emptyHtml.includes('Please enter a phone number or email.'));
  assert.ok(!emptyHtml.includes('look like a phone number'));
});

test('the quote thank-you banner has a tap-to-call phone', async () => {
  const env = await makeEnv({ published: [OWNER] });
  const html = await (await get(env, `/listings/${OWNER.id}?quote=sent`)).text();
  assert.match(html, /<p class="notice success-box" role="status">[^<]*call them at <a class="tel" href="tel:6155550177">\(615\) 555-0177<\/a>\.<\/p>/);
});

test('the Séance page shows the confirmed date like "Nov 10, 2026", never an ISO date', () => {
  const html = seanceReportPage({ id: 'x', name: 'X' }, [], '2026-11-10');
  const main = mainOf(html);
  assert.ok(main.includes('Owner-confirmed Nov 10, 2026.'));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(main.replace(/datetime="[^"]*"/g, '')), 'no ISO date visible');
});

test('llms.txt has one clear header line', () => {
  const one = generateLlmsTxt([OWNER], 'http://example.test', categories).split('\n');
  assert.equal(one[1], '# A free directory of local businesses in Springfield');
  const none = generateLlmsTxt([], 'http://example.test', categories).split('\n');
  assert.equal(none[1], '# A free directory of local businesses');
  for (const line of [one[1], none[1]]) {
    assert.ok(!line.includes('Free local business directory'));
    assert.ok(!line.includes('—'));
  }
});

test('the admin Log out button sits in the same row as the admin links (CSS)', async () => {
  const css = await fs.readFile(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8');
  const nav = /\.admin-nav \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(nav, /display: flex/);
  assert.match(nav, /flex-wrap: wrap/);
  const logout = /\.admin-nav \.admin-logout \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(logout, /margin: 0/);
  assert.ok(!/margin-left: 1rem/.test(logout));
});

test('city tidying stays the same on a second pass for letters whose capital is two letters', async () => {
  const { tidyCity } = await import('../server/lib/listing-fields.js');
  for (const typed of ['ᾀ', 'ß', 'straße', 'nashville', 'st. louis']) {
    const once = tidyCity(typed);
    assert.equal(tidyCity(once), once, typed);
  }
  assert.equal(tidyCity('nashville'), 'Nashville');
  assert.equal(tidyCity('ᾀ'), 'Ἀι');
});
