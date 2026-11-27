/**
 * Show, edit and publish the website (Feature C, task F9; Requirement 21). Every place that shows or returns the
 * website checks the stored value again, the same way the JSON API does. No network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { listingDetail, websiteRow } from '../server/lib/html.js';
import { generateLlmsTxt } from '../server/lib/llms.js';
import { buildSchema } from '../server/lib/schema.js';
import {
  reviewPage, WEBSITE_LEFT_OUT, SAVED_WEBSITE_LEFT_OUT, SAVED_BOTH_LEFT_OUT, REVIEWS_LINK_LEFT_OUT,
} from '../server/lib/rise-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const TOKEN = 'website-test-token';
const SITE = 'https://www.zephyrplumbing.com/';
const YELP = 'https://www.yelp.com/biz/zephyr-plumbing-nashville';
const BAD_SITES = ['', '   ', 'http://zephyrplumbing.com/', 'javascript:alert(1)', 'https://10.0.0.5/', 'https://user:pw@zephyr.com/', 'zephyr', 42, null];

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const LISTING = {
  id: 'zephyr-plumbing-nashville', name: 'Zephyr Plumbing', category: 'plumbers', phone: '(615) 555-0101',
  services: ['Leak repair'], serviceArea: 'Nashville', description: 'We fix pipes.', city: 'Nashville', state: 'TN',
  hours: { monday: '8am-5pm' },
};

// ---- the listing page row --------------------------------------------------------------------------------

test('F9: the Website row links to the site with its host (no www.) as the text', () => {
  assert.equal(websiteRow(SITE), '\n    <dt>Website</dt>\n    <dd><a href="https://www.zephyrplumbing.com/" rel="noopener noreferrer">zephyrplumbing.com</a></dd>');
  assert.equal(websiteRow('https://shop.zephyr.com/menu'), '\n    <dt>Website</dt>\n    <dd><a href="https://shop.zephyr.com/menu" rel="noopener noreferrer">shop.zephyr.com</a></dd>');
  const html = listingDetail({ ...LISTING, website: SITE, reviewsLink: YELP }, undefined, { categories });
  assert.ok(html.includes('>zephyrplumbing.com</a>'));
  assert.ok(html.indexOf('<dt>Service area</dt>') < html.indexOf('<dt>Website</dt>'));
  assert.ok(html.indexOf('<dt>Website</dt>') < html.indexOf('<dt>Reviews</dt>'));
});

test('F9: the stored website is checked again and shown only in its clean form, escaped', () => {
  // A stored value with a query string and a fragment is shown without them.
  assert.ok(websiteRow('https://Zephyr.com/a?token=secret#x').includes('href="https://zephyr.com/a"'));
  assert.equal(websiteRow('https://Zephyr.com/a?token=secret#x').includes('secret'), false);
  const odd = websiteRow('https://zephyr.com/"><script>');
  assert.equal(odd.includes('<script>'), false);
  // The href holds exactly one quoted value: nothing typed can close it early.
  assert.match(odd, /^\n {4}<dt>Website<\/dt>\n {4}<dd><a href="https:\/\/zephyr\.com\/[^"<>]*" rel="noopener noreferrer">zephyr\.com<\/a><\/dd>$/);
});

test('F9: no Website row when the field is empty or not valid, and the page is byte-for-byte as before', () => {
  const before = listingDetail(LISTING, undefined, { categories });
  for (const bad of BAD_SITES) {
    assert.equal(websiteRow(bad), '', String(bad));
    assert.equal(listingDetail({ ...LISTING, website: bad }, undefined, { categories }), before, String(bad));
  }
});

// ---- JSON-LD and llms.txt ----------------------------------------------------------------------------------

test('F9: sameAs holds the website, then the reviews link, each only when present; url stays the listing page', () => {
  const opts = { baseUrl: 'https://firstanswer.example' };
  const url = 'https://firstanswer.example/listings/zephyr-plumbing-nashville';
  const neither = buildSchema(LISTING, null, opts);
  assert.equal(Object.hasOwn(neither, 'sameAs'), false);
  assert.deepEqual(buildSchema({ ...LISTING, website: SITE }, null, opts).sameAs, [SITE]);
  assert.deepEqual(buildSchema({ ...LISTING, reviewsLink: YELP }, null, opts).sameAs, [YELP]);
  const both = buildSchema({ ...LISTING, website: SITE, reviewsLink: YELP }, null, opts);
  assert.deepEqual(both.sameAs, [SITE, YELP]);
  for (const s of [neither, both]) assert.equal(s.url, url);
  for (const bad of BAD_SITES) {
    assert.deepEqual(buildSchema({ ...LISTING, website: bad }, null, opts), neither, String(bad));
  }
  assert.deepEqual(buildSchema({ ...LISTING, website: 'https://Zephyr.com/x?y=1' }, null, opts).sameAs, ['https://zephyr.com/x']);
});

test('F9: llms.txt adds a Website line only with a valid website, before the Reviews line', () => {
  const base = 'https://firstanswer.example';
  const without = generateLlmsTxt([LISTING], base, categories);
  for (const bad of BAD_SITES) assert.equal(generateLlmsTxt([{ ...LISTING, website: bad }], base, categories), without, String(bad));
  const lines = generateLlmsTxt([{ ...LISTING, website: SITE, reviewsLink: YELP }], base, categories).split('\n');
  const at = lines.indexOf('Service Area: Nashville');
  assert.equal(lines[at + 1], `Website: ${SITE}`);
  assert.equal(lines[at + 2], `Reviews: ${YELP}`);
  assert.equal(lines.length, without.split('\n').length + 2);
  assert.equal(generateLlmsTxt([{ ...LISTING, website: SITE }], base, categories).split('\n').length, without.split('\n').length + 1);
});

// ---- the owner's form -----------------------------------------------------------------------------------------

test('F9: the review form has the optional Website input and hint', () => {
  const html = reviewPage({ id: 'd1', fields: { ...LISTING, website: SITE }, missingFields: [] }, categories);
  assert.ok(html.includes('Website (optional)'));
  assert.ok(html.includes(`name="website" value="${SITE}"`));
  assert.ok(html.includes('The address of your own website, like example.com'));
  assert.equal(html.includes(WEBSITE_LEFT_OUT), false);
  // A bad stored value is never put back in the box.
  const bad = reviewPage({ id: 'd1', fields: { ...LISTING, website: 'javascript:alert(1)' }, missingFields: [] }, categories);
  assert.ok(bad.includes('name="website" value=""'));
});

test('F9: a left-out website is said plainly at the top and by the box, like the reviews link', () => {
  assert.equal(WEBSITE_LEFT_OUT, 'We left that website out. It must be the address of your own website, like example.com.');
  assert.equal(SAVED_WEBSITE_LEFT_OUT, 'Saved, but we left out your website. See below.');
  for (const text of [WEBSITE_LEFT_OUT, SAVED_WEBSITE_LEFT_OUT, SAVED_BOTH_LEFT_OUT]) {
    assert.doesNotMatch(text, /https (link|address)|public|URL/i, text);
  }
  const draft = { id: 'd1', fields: LISTING, missingFields: [] };
  const one = reviewPage(draft, categories, { saved: true, websiteLeftOut: true });
  assert.ok(one.includes(`<p class="notice" role="status">${SAVED_WEBSITE_LEFT_OUT}</p>`));
  assert.ok(one.includes(WEBSITE_LEFT_OUT));
  assert.equal(one.includes(REVIEWS_LINK_LEFT_OUT), false);
  const both = reviewPage(draft, categories, { saved: true, websiteLeftOut: true, reviewsLeftOut: true });
  assert.ok(both.includes(SAVED_BOTH_LEFT_OUT));
  assert.ok(both.includes(WEBSITE_LEFT_OUT) && both.includes(REVIEWS_LINK_LEFT_OUT));
});

// ---- through the app ---------------------------------------------------------------------------------------------

async function startEnv(published = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-listing-website-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  if (published.length > 0) await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  const app = createApp({ dataDir: dir, config: { adminToken: TOKEN, baseUrl: 'http://example.test', demoMode: true, production: false } });
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
  return /\/rise\/drafts\/([^/?]+)/.exec(res.headers.get('location'))[1];
}

const save = (env, id, fields, action = '') => fetch(`${env.base}/rise/drafts/${id}${action}`, {
  method: 'POST', redirect: 'manual', body: new URLSearchParams(fields),
});

const draftFields = async (env, id) => (await env.ctx.store.collection('drafts').read()).find(d => d.id === id).fields;

test('F9: the owner saves a website; a bad one is left out with the note, and both at once say so', async () => {
  const env = await startEnv();
  const id = await newDraft(env);

  const good = await save(env, id, { ...FORM, website: 'https://ZephyrPlumbing.com/?utm=x' });
  assert.equal(good.headers.get('location'), `/rise/drafts/${id}?saved=1`);
  assert.equal((await draftFields(env, id)).website, 'https://zephyrplumbing.com/');

  // V90: an http:// address is now rewritten to https and kept, so the refused example is a login address.
  const bad = await save(env, id, { ...FORM, website: 'https://user:pw@evil.example/<b>' });
  assert.equal(bad.headers.get('location'), `/rise/drafts/${id}?saved=1&left=website`);
  assert.equal(Object.hasOwn(await draftFields(env, id), 'website'), false);
  const page = await (await fetch(`${env.base}${bad.headers.get('location')}`)).text();
  assert.ok(page.includes(SAVED_WEBSITE_LEFT_OUT));
  assert.ok(page.includes(WEBSITE_LEFT_OUT));
  assert.equal(page.includes('evil.example'), false, 'the typed value is never echoed');

  const both = await save(env, id, { ...FORM, website: 'zephyr', reviewsLink: 'https://www.example.com/reviews' });
  assert.equal(both.headers.get('location'), `/rise/drafts/${id}?saved=1&left=both`);
  const bothPage = await (await fetch(`${env.base}${both.headers.get('location')}`)).text();
  assert.ok(bothPage.includes(SAVED_BOTH_LEFT_OUT));

  // The reviews link alone still gives the same address as before.
  const reviewsOnly = await save(env, id, { ...FORM, reviewsLink: 'https://www.example.com/reviews' });
  assert.equal(reviewsOnly.headers.get('location'), `/rise/drafts/${id}?saved=1&left=reviews`);
});

test('F9: confirming with a bad website stops at the note instead of sending the listing for review', async () => {
  const env = await startEnv();
  const id = await newDraft(env);
  const res = await save(env, id, { ...FORM, website: 'https://127.0.0.1/' }, '/confirm');
  assert.equal(res.headers.get('location'), `/rise/drafts/${id}?saved=1&left=website`);
  const pending = await env.ctx.store.collection('pending').read();
  assert.equal((Array.isArray(pending) ? pending : []).some(p => p.draftId === id), false);
});

test('F9: the admin row, publishing, and the page, llms.txt and MCP output with and without the website', async () => {
  const env = await startEnv();
  const withSite = await newDraft(env);
  const without = await newDraft(env);
  assert.equal((await save(env, withSite, { ...FORM, website: SITE }, '/confirm')).status, 303);
  assert.equal((await save(env, without, { ...FORM, name: 'Aster Plumbing', phone: '615-555-0102' }, '/confirm')).status, 303);

  const admin = { authorization: `Bearer ${TOKEN}` };
  const queue = await (await fetch(`${env.base}/admin/pending`, { headers: { ...admin, accept: 'text/html' } })).text();
  assert.ok(queue.includes(`<dt>Website</dt><dd>${SITE}</dd>`));
  assert.equal((queue.match(/<dt>Website<\/dt>/g) ?? []).length, 1);
  for (const id of [withSite, without]) {
    assert.equal((await fetch(`${env.base}/admin/pending/${id}/approve`, { method: 'POST', headers: admin })).status, 200);
  }
  const zephyr = env.ctx.store.getListings().find(l => l.name === 'Zephyr Plumbing');
  const aster = env.ctx.store.getListings().find(l => l.name === 'Aster Plumbing');
  assert.equal(zephyr.website, SITE);
  assert.equal(Object.hasOwn(aster, 'website'), false);

  const page = await (await fetch(`${env.base}/listings/${zephyr.id}`)).text();
  assert.ok(page.includes(`<a href="${SITE}" rel="noopener noreferrer">zephyrplumbing.com</a>`));
  assert.ok(page.includes(`"sameAs"`));
  assert.equal((await (await fetch(`${env.base}/listings/${aster.id}`)).text()).includes('<dt>Website</dt>'), false);

  const llms = await (await fetch(`${env.base}/llms.txt`)).text();
  assert.ok(llms.includes(`Website: ${SITE}`));
  assert.equal((llms.match(/^Website: /gm) ?? []).length, 1);

  const mcp = await (await fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_listings', arguments: { query: 'Plumbing', city: 'Nashville' } } }),
  })).json();
  const text = JSON.stringify(mcp.result.structuredContent);
  assert.ok(text.includes(`"website":"${SITE}"`));
  // Only the listing's own website field counts; each listing's receipts also have a "website" key (Requirement 9).
  const found = mcp.result.structuredContent.listings;
  assert.equal(found.filter(l => Object.hasOwn(l, 'website')).length, 1);
  assert.equal(found.find(l => l.id === zephyr.id).website, SITE);
  assert.equal(text.split(SITE).length - 1, 1, 'the website value appears once');
  for (const l of found) assert.ok(l.receipts && Object.hasOwn(l.receipts, 'website'), l.id);
});

test('F9: a hand-edited bad website is dropped from the admin row, the page, llms.txt, JSON-LD and MCP', async () => {
  const listing = { ...LISTING, id: 'quillon-plumbing-nashville', name: 'Quillon Plumbing', phone: '(615) 555-0177', website: 'javascript:alert(1)' };
  const env = await startEnv([listing]);
  const page = await (await fetch(`${env.base}/listings/${listing.id}`)).text();
  assert.equal(page.includes('javascript:'), false);
  assert.equal(page.includes('<dt>Website</dt>'), false);
  assert.equal(page.includes('"sameAs"'), false);
  const llms = await (await fetch(`${env.base}/llms.txt`)).text();
  assert.equal(llms.includes('javascript:'), false);
  const mcp = await (await fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_listings', arguments: { query: 'Quillon' } } }),
  })).text();
  assert.ok(mcp.includes('Quillon'));
  assert.equal(mcp.includes('javascript:'), false);

  // A pending Draft with a bad website (edited by hand) shows no Website row to the admin.
  await env.ctx.store.collection('drafts').append({ id: 'hand-edited', status: 'pending', provider: 'manual', fields: { ...LISTING, website: 'http://evil.example/' }, missingFields: [] });
  await env.ctx.store.collection('pending').append({ id: 'hand-edited', draftId: 'hand-edited', submittedAt: new Date().toISOString(), status: 'pending' });
  const queue = await (await fetch(`${env.base}/admin/pending`, { headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/html' } })).text();
  assert.equal(queue.includes('evil.example'), false);
});
