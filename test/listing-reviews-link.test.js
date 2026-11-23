/**
 * Show and edit the reviews link (Feature B, task F6; Requirement 20): the Reviews row on the listing page, the
 * optional input on the owner's form and the admin row, the left-out note, publishing, and the machine-readable
 * outputs. No network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { listingDetail, reviewsRow } from '../server/lib/html.js';
import { generateLlmsTxt } from '../server/lib/llms.js';
import { buildSchema } from '../server/lib/schema.js';
import { reviewPage, REVIEWS_LINK_LEFT_OUT } from '../server/lib/rise-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const TOKEN = 'reviews-link-test-token';
const YELP = 'https://www.yelp.com/biz/zephyr-plumbing-nashville';
const LEFT_OUT_HTML = 'We left that link out. It must be an https link to your reviews on Google, Yelp, Facebook or Nextdoor.';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const LISTING = {
  id: 'zephyr-plumbing-nashville', name: 'Zephyr Plumbing', category: 'plumbers', phone: '(615) 555-0101',
  services: ['Leak repair'], serviceArea: 'Nashville', description: 'We fix pipes.', city: 'Nashville', state: 'TN',
  hours: { monday: '8am-5pm' },
};

/** Words that would mean a rating, count or review text is shown. */
const NO_RATINGS = /\u2605|\u2B50|aggregateRating|ratingValue|reviewCount|out of 5|\bstars?\b/i;

// ---- the listing page row -------------------------------------------------------------------------

test('F6: the Reviews row names the site for each host, with rel="noopener noreferrer"', () => {
  const cases = [
    ['https://www.google.com/maps/place/Zephyr', 'Google'],
    ['https://maps.app.goo.gl/AbC', 'Google'],
    [YELP, 'Yelp'],
    ['https://www.facebook.com/ZephyrPlumbing', 'Facebook'],
    ['https://nextdoor.com/pages/zephyr-plumbing/', 'Nextdoor'],
  ];
  for (const [link, site] of cases) {
    assert.equal(reviewsRow(link), `\n    <dt>Reviews</dt>\n    <dd><a href="${link}" rel="noopener noreferrer">See our reviews on ${site}</a></dd>`);
    const html = listingDetail({ ...LISTING, reviewsLink: link }, undefined, { categories });
    assert.ok(html.includes(`See our reviews on ${site}`), site);
    assert.ok(html.indexOf('<dt>Service area</dt>') < html.indexOf('<dt>Reviews</dt>'), 'after the Service area row');
  }
});

test('F6: the link is escaped', () => {
  const link = 'https://www.google.com/search?q=zephyr&hl=en#lrd=0x1:0x2,1,"x"';
  const row = reviewsRow(link);
  assert.ok(row.includes('href="https://www.google.com/search?q=zephyr&amp;hl=en#lrd=0x1:0x2,1,&quot;x&quot;"'));
  assert.equal(row.includes('"x"'), false);
});

test('F6: no row when the link is empty, missing or not a valid reviews link, and the page is byte-for-byte as before', () => {
  const before = listingDetail(LISTING, undefined, { categories });
  for (const bad of ['', '   ', 'http://www.yelp.com/biz/x', 'https://www.example.com/reviews', 'javascript:alert(1)',
    'https://www.yelp.com/biz_redir?url=https%3A%2F%2Fevil.tld', 42, null]) {
    assert.equal(reviewsRow(bad), '', String(bad));
    assert.equal(listingDetail({ ...LISTING, reviewsLink: bad }, undefined, { categories }), before, String(bad));
  }
  assert.equal(before.includes('<dt>Reviews</dt>'), false);
});

// ---- llms.txt, JSON-LD -------------------------------------------------------------------------------

test('F6: llms.txt adds a Reviews line only for a listing with a valid link, and is unchanged without one', () => {
  const base = 'https://firstanswer.example';
  const without = generateLlmsTxt([LISTING], base, categories);
  assert.equal(generateLlmsTxt([{ ...LISTING, reviewsLink: '' }], base, categories), without);
  assert.equal(generateLlmsTxt([{ ...LISTING, reviewsLink: 'https://www.example.com/x' }], base, categories), without);
  const withLink = generateLlmsTxt([{ ...LISTING, reviewsLink: YELP }], base, categories);
  const lines = withLink.split('\n');
  const at = lines.indexOf('Service Area: Nashville');
  assert.ok(at > 0);
  assert.equal(lines[at + 1], `Reviews: ${YELP}`);
  assert.equal(lines.length, without.split('\n').length + 1, 'exactly one line more');
  assert.doesNotMatch(withLink, NO_RATINGS);
});

test('F6: the business label adds sameAs only with a valid link, and url stays the listing page', () => {
  const opts = { baseUrl: 'https://firstanswer.example' };
  const plain = buildSchema(LISTING, null, opts);
  assert.equal(Object.hasOwn(plain, 'sameAs'), false);
  assert.deepEqual(buildSchema({ ...LISTING, reviewsLink: 'http://x.example' }, null, opts), plain);
  const linked = buildSchema({ ...LISTING, reviewsLink: YELP }, null, opts);
  assert.deepEqual(linked.sameAs, [YELP]);
  assert.equal(linked.url, 'https://firstanswer.example/listings/zephyr-plumbing-nashville');
  assert.doesNotMatch(JSON.stringify(linked), NO_RATINGS);
  // Without a base URL too.
  assert.deepEqual(buildSchema({ ...LISTING, reviewsLink: YELP }, null).sameAs, [YELP]);
});

// ---- the owner's form ----------------------------------------------------------------------------------

test('F6: the review form has the optional input and hint, and the left-out note only when asked', () => {
  const draft = { id: 'd1', fields: { ...LISTING, reviewsLink: YELP }, missingFields: [] };
  const html = reviewPage(draft, categories);
  assert.ok(html.includes('Reviews link (optional)'));
  assert.ok(html.includes(`name="reviewsLink" value="${YELP}"`));
  assert.ok(html.includes('A link to your reviews on Google, Yelp, Facebook or Nextdoor.'));
  assert.equal(html.includes(LEFT_OUT_HTML), false);
  assert.equal(REVIEWS_LINK_LEFT_OUT, LEFT_OUT_HTML);
  assert.ok(reviewPage({ ...draft, fields: LISTING }, categories, { reviewsLeftOut: true }).includes(LEFT_OUT_HTML));
  // The link is escaped in the input.
  const odd = reviewPage({ ...draft, fields: { ...LISTING, reviewsLink: 'https://www.yelp.com/biz/a"><b>' } }, categories);
  assert.equal(odd.includes('"><b>'), false);
});

// ---- through the app ---------------------------------------------------------------------------------------

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-reviews-link-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const app = createApp({
    dataDir: dir,
    config: { adminToken: TOKEN, baseUrl: 'http://example.test', demoMode: true, production: false },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { dir, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const FORM = {
  name: 'Zephyr Plumbing', category: 'plumbers', phone: '615-555-0101', services: 'Leak repair', serviceArea: 'Nashville',
  description: 'We fix pipes.', city: 'Nashville', state: 'TN', address: '', ownerEmail: '',
};

async function newDraft(env) {
  const res = await fetch(`${env.base}/rise/manual`, { method: 'POST', redirect: 'manual' });
  assert.equal(res.status, 303);
  return /\/rise\/drafts\/([^/?]+)/.exec(res.headers.get('location'))[1];
}

const save = (env, id, fields, action = '') => fetch(`${env.base}/rise/drafts/${id}${action}`, {
  method: 'POST', redirect: 'manual', body: new URLSearchParams(fields),
});

const draftFields = async (env, id) => (await env.ctx.store.collection('drafts').read()).find(d => d.id === id).fields;

test('F6: the owner saves a valid link, and a bad one is left out with the note (the typed value is never echoed)', async () => {
  const env = await startEnv();
  const id = await newDraft(env);

  const good = await save(env, id, { ...FORM, reviewsLink: ` ${YELP} ` });
  assert.equal(good.status, 303);
  assert.equal(good.headers.get('location'), `/rise/drafts/${id}?saved=1`);
  assert.equal((await draftFields(env, id)).reviewsLink, YELP);

  const bad = await save(env, id, { ...FORM, reviewsLink: 'http://evil.example/<script>' });
  assert.equal(bad.status, 303);
  assert.equal(bad.headers.get('location'), `/rise/drafts/${id}?saved=1&left=reviews`);
  assert.equal(Object.hasOwn(await draftFields(env, id), 'reviewsLink'), false);
  const page = await (await fetch(`${env.base}${bad.headers.get('location')}`)).text();
  assert.ok(page.includes(LEFT_OUT_HTML));
  assert.equal(page.includes('evil.example'), false);

  // Clearing the box leaves no key and no note.
  const cleared = await save(env, id, { ...FORM, reviewsLink: '' });
  assert.equal(cleared.headers.get('location'), `/rise/drafts/${id}?saved=1`);
  assert.equal((await (await fetch(`${env.base}/rise/drafts/${id}`)).text()).includes(LEFT_OUT_HTML), false);
});

test('F6: confirming with a bad link stops at the note instead of sending the listing for review', async () => {
  const env = await startEnv();
  const id = await newDraft(env);
  const res = await save(env, id, { ...FORM, reviewsLink: 'https://www.example.com/reviews' }, '/confirm');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/rise/drafts/${id}?saved=1&left=reviews`);
  const pending = await env.ctx.store.collection('pending').read();
  assert.equal((Array.isArray(pending) ? pending : []).some(p => p.draftId === id), false, 'nothing was sent for review');
});

test('F6: the admin sees the Reviews link row, an approved Draft publishes the link, and one without gains no key', async () => {
  const env = await startEnv();
  const withLink = await newDraft(env);
  const without = await newDraft(env);
  assert.equal((await save(env, withLink, { ...FORM, reviewsLink: YELP }, '/confirm')).status, 303);
  assert.equal((await save(env, without, { ...FORM, name: 'Aster Plumbing', phone: '615-555-0102' }, '/confirm')).status, 303);

  const admin = { authorization: `Bearer ${TOKEN}` };
  const queue = await (await fetch(`${env.base}/admin/pending`, { headers: { ...admin, accept: 'text/html' } })).text();
  assert.ok(queue.includes(`<dt>Reviews link</dt><dd>${YELP}</dd>`));
  assert.equal((queue.match(/<dt>Reviews link<\/dt>/g) ?? []).length, 1, 'only the Draft that has one');

  for (const id of [withLink, without]) {
    const res = await fetch(`${env.base}/admin/pending/${id}/approve`, { method: 'POST', headers: admin });
    assert.equal(res.status, 200, await res.text());
  }
  const zephyr = env.ctx.store.getListings().find(l => l.name === 'Zephyr Plumbing');
  const aster = env.ctx.store.getListings().find(l => l.name === 'Aster Plumbing');
  assert.equal(zephyr.reviewsLink, YELP);
  assert.equal(Object.hasOwn(aster, 'reviewsLink'), false);
  const published = JSON.parse(await fs.readFile(path.join(env.dir, 'published.json'), 'utf8'));
  assert.equal(published.find(l => l.name === 'Aster Plumbing').reviewsLink, undefined);

  // The listing page, the JSON API, llms.txt, the JSON-LD and the MCP summary.
  const page = await (await fetch(`${env.base}/listings/${zephyr.id}`)).text();
  assert.ok(page.includes(`<a href="${YELP}" rel="noopener noreferrer">See our reviews on Yelp</a>`));
  assert.ok(page.includes(`"sameAs"`));
  const plainPage = await (await fetch(`${env.base}/listings/${aster.id}`)).text();
  assert.equal(plainPage.includes('<dt>Reviews</dt>'), false);
  assert.equal(plainPage.includes('"sameAs"'), false);

  const api = await (await fetch(`${env.base}/api/listings/${zephyr.id}`)).json();
  assert.equal(JSON.stringify(api).includes(YELP), true);

  const llms = await (await fetch(`${env.base}/llms.txt`)).text();
  assert.ok(llms.includes(`Reviews: ${YELP}`));
  assert.equal((llms.match(/^Reviews: /gm) ?? []).length, 1);

  const mcp = await (await fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_listings', arguments: { query: 'Plumbing', city: 'Nashville' } } }),
  })).json();
  const found = mcp.result.structuredContent;
  const text = JSON.stringify(found);
  assert.ok(text.includes(`"reviews":"${YELP}"`));
  assert.equal((text.match(/"reviews":/g) ?? []).length, 1, 'only the listing that has one');

  // Nothing about the reviews but the link: no rating, count or star on this listing's page, API entry or llms block.
  const block = llms.slice(llms.indexOf('### Zephyr Plumbing'), llms.indexOf('\n\n', llms.indexOf('### Zephyr Plumbing')));
  assert.ok(block.includes(`Reviews: ${YELP}`));
  for (const out of [page.slice(page.indexOf('<article class="listing-detail">')), JSON.stringify(api), block]) {
    assert.doesNotMatch(out, NO_RATINGS);
  }
});
