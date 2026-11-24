/**
 * high-tech-look Requirement 5, for Step 1: nothing Google, Bing or AI read has changed. Step 1 adds saved signals, two
 * optional lookups and an admin button, and no public page, so the pages and files below read as they always did.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const LISTING = {
  id: 'zephyr-plumbing-nashville', name: 'Zephyr Plumbing', category: 'plumbers', phone: '(615) 555-0142',
  description: 'We fix pipes and drains in Nashville.', city: 'Nashville', state: 'TN', services: ['Drain cleaning', 'Water heaters'],
  serviceArea: 'Nashville and nearby areas', hours: { monday: '8am-5pm', tuesday: '8am-5pm' }, address: '12 Main Street, Nashville, TN 37203',
  website: 'https://zephyr.example/',
};

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function start() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-step1-'));
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify([LISTING]));
  const app = createApp({
    dataDir: dir,
    config: { baseUrl: 'https://pages.example.test', graderSecret: 'test-secret', adminToken: 't', gradeMainAsks: 1, demoMode: false },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p, headers = {}) => { const r = await fetch(base + p, { headers }); return { status: r.status, headers: r.headers, text: await r.text() }; };
  return { get };
}

test('the home page and the listing page keep their index rules, title, canonical link and description', async () => {
  const s = await start();
  const home = await s.get('/');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('x-robots-tag'), null, 'the home page is open to Google and Bing');
  assert.match(home.text, /<title>[^<]+<\/title>/);
  assert.match(home.text, /<link[^>]*rel="canonical"[^>]*href="https:\/\/pages\.example\.test\/"/);
  assert.match(home.text, /<meta name="description" content="[^"]+"/);
  assert.equal(/name="robots"/.test(home.text), false);
  const page = await s.get(`/listings/${LISTING.id}`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-robots-tag'), null);
  assert.match(page.text, /<link[^>]*rel="canonical"[^>]*href="https:\/\/pages\.example\.test\/listings\/zephyr-plumbing-nashville"/);
  assert.equal(/name="robots"/.test(page.text), false);
});

test('a listing keeps its business label and its phone, hours, services and area as plain text', async () => {
  const s = await start();
  const page = (await s.get(`/listings/${LISTING.id}`)).text;
  const ld = /<script type="application\/ld\+json">([^]*?)<\/script>/.exec(page)?.[1];
  assert.ok(ld, 'the JSON-LD block is there');
  const data = JSON.parse(ld);
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data.name, 'Zephyr Plumbing');
  assert.equal(data.telephone, '+16155550142');
  assert.equal(data.address.addressLocality, 'Nashville');
  assert.equal(data.areaServed, 'Nashville and nearby areas');
  assert.ok(Array.isArray(data.openingHoursSpecification) && data.openingHoursSpecification.length === 2);
  assert.equal(data.hasOfferCatalog.itemListElement.length, 2);
  const visible = page.replace(/<script[^]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ');
  for (const text of ['(615) 555-0142', 'Drain cleaning', 'Water heaters', 'Nashville and nearby areas', '8am-5pm']) {
    assert.ok(visible.includes(text), text);
  }
  // None of the health map's data leaks into a public page or the JSON-LD.
  assert.equal(/signals|waive|healthMap|health map/i.test(page), false);
});

test('robots.txt and sitemap.xml still list what they listed, and the public JSON has no new fields', async () => {
  const s = await start();
  const robots = await s.get('/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.text, /Sitemap:\s*https:\/\/pages\.example\.test\/sitemap\.xml/i);
  const sitemap = await s.get('/sitemap.xml');
  assert.equal(sitemap.status, 200);
  assert.ok(sitemap.text.includes('https://pages.example.test/listings/zephyr-plumbing-nashville'));
  assert.equal(/\/admin|\/rise\/drafts/.test(sitemap.text), false);
  const api = await s.get(`/api/listings/${LISTING.id}`);
  if (api.status === 200) {
    const json = JSON.parse(api.text);
    for (const key of Object.keys(json)) assert.equal(/signals|profiles|waive|trust/i.test(key), false, key);
  }
});

test('the admin pages and the reports stay out of search', async () => {
  const s = await start();
  const admin = await s.get('/admin/pending', { Authorization: 'Bearer t' });
  assert.match(admin.headers.get('x-robots-tag') ?? '', /noindex/);
  const form = await s.get('/grade?from=zzzzzzzzzzzzzzzzzzzzzz');
  assert.match(form.headers.get('x-robots-tag') ?? '', /noindex/);
  const empty = await s.get('/?category=plumbers&city=Atlantis');
  assert.match(empty.headers.get('x-robots-tag') ?? '', /noindex/);
});
