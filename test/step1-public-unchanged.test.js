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

/** The tags in a page's <head>, as plain strings, in order. */
function headTags(html) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
  return [...head.matchAll(/<(meta|title|link|script|style|base)\b[^>]*>/g)].map(m => m[0]);
}

test('Step 1A (Requirement 5): the dark theme is the stylesheet only; every public page has the same kinds of head tags', async () => {
  const s = await start();
  const pages = ['/', `/listings/${LISTING.id}`, '/about', '/privacy', '/rise', '/grade', '/grade/about'];
  for (const p of pages) {
    const res = await s.get(p);
    assert.equal(res.status, 200, p);
    const tags = headTags(res.text);
    // Only the tags the site has always used: charset, viewport, title, description, robots, canonical, icon, the one
    // stylesheet, JSON-LD and module scripts from this site (and Cloudflare's own human-check script).
    for (const tag of tags) {
      const ok = /^<meta charset="utf-8">$/.test(tag)
        || /^<meta name="viewport" content="width=device-width, initial-scale=1">$/.test(tag)
        || /^<title>/.test(tag)
        || /^<meta name="description" content="[^"]*">$/.test(tag)
        || /^<meta name="robots" content="[^"]*">$/.test(tag)
        || /^<meta http-equiv="refresh" content="\d+">$/.test(tag)
        || /^<link rel="canonical" href="https:\/\/pages\.example\.test\/[^"]*">$/.test(tag)
        || tag === '<link rel="icon" href="/favicon.svg" type="image/svg+xml">'
        || tag === '<link rel="stylesheet" href="/css/style.css">'
        || tag === '<script type="application/ld+json">'
        || /^<script type="module" src="\/js\/[\w-]+\.js">$/.test(tag)
        || /^<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js" async defer>$/.test(tag)
        // Sharing and feed tags some pages may already carry (never added by the theme).
        || /^<meta (?:property="og:[\w:]+"|name="twitter:[\w:]+") content="[^"]*">$/.test(tag)
        || /^<link rel="alternate" [^>]*>$/.test(tag);
      assert.ok(ok, `${p}: unexpected head tag ${tag}`);
    }
    // Exactly one stylesheet, the site's own, and no inline style anywhere in the head.
    assert.equal(tags.filter(t => t.startsWith('<link rel="stylesheet"')).length, 1, p);
    assert.equal(tags.some(t => t.startsWith('<style')), false, p);
    assert.equal(tags.filter(t => t.startsWith('<title>')).length, 1, p);
    // The page still opens with the same document shape: the theme adds no wrapper, class or attribute to <html> or <body>.
    assert.match(res.text, /^<!DOCTYPE html>\n<html lang="en">\n<head>/, p);
    assert.match(res.text, /<\/head>\n<body>\n  <nav class="site-nav">/, p);
  }
  // The pages open to search keep their canonical link and description (the earlier tests check the listing's JSON-LD).
  for (const p of ['/', `/listings/${LISTING.id}`]) {
    const text = (await s.get(p)).text;
    assert.match(text, /<link rel="canonical" href="https:\/\/pages\.example\.test\//, p);
    assert.match(text, /<meta name="description" content="[^"]+">/, p);
  }
  // The stylesheet is served as CSS from this site, and the fonts it uses are this site's own files.
  const css = await s.get('/css/style.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type') ?? '', /text\/css/);
  for (const m of css.text.matchAll(/url\("([^"]+)"\)/g)) {
    assert.ok(m[1].startsWith('/fonts/') || m[1].startsWith('data:'), `no outside file: ${m[1].slice(0, 60)}`);
  }
});

const BASELINE = JSON.parse(await fs.readFile(fileURLToPath(new URL('./fixtures/seo-baseline.json', import.meta.url)), 'utf8'));

/** HTML text or attribute value back to plain text (the entities escapeHtml writes). */
const unescape = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&amp;/g, '&');

/** The parts of a page that Google, Bing and AI read, as plain values. */
function seoParts(res) {
  const head = /<head>([\s\S]*?)<\/head>/.exec(res.text)?.[1] ?? '';
  return {
    title: unescape(/<title>([^<]*)<\/title>/.exec(head)?.[1] ?? ''),
    description: (() => { const m = /<meta name="description" content="([^"]*)">/.exec(head); return m ? unescape(m[1]) : null; })(),
    canonical: (() => { const m = /<link rel="canonical" href="([^"]*)">/.exec(head); return m ? unescape(m[1]) : null; })(),
    robotsMeta: (() => { const m = /<meta name="robots" content="([^"]*)">/.exec(head); return m ? m[1] : null; })(),
    xRobotsTag: res.headers.get('x-robots-tag'),
    h1: [...res.text.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m => unescape(m[1].replace(/<[^>]*>/g, '')).trim()),
  };
}

test('Requirement 5 (Steps 1A to 1E): titles, descriptions, canonical links, robots rules and h1 headings equal the stored baseline', async () => {
  const s = await start();
  for (const [p, expected] of Object.entries(BASELINE.pages)) {
    const res = await s.get(p);
    assert.equal(res.status, 200, p);
    assert.deepEqual(seoParts(res), expected, p);
  }
});

test('Requirement 5 (Steps 1A to 1E): the listing JSON-LD, robots.txt and the sitemap equal the stored baseline', async () => {
  const s = await start();
  const page = (await s.get(`/listings/${LISTING.id}`)).text;
  const blocks = [...page.matchAll(/<script type="application\/ld\+json">([^]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.equal(blocks.length, 1, 'one JSON-LD block');
  assert.deepEqual(blocks[0], BASELINE.listingJsonLd);
  // The home page has no JSON-LD (as before).
  assert.equal(/application\/ld\+json/.test((await s.get('/')).text), false);
  assert.equal((await s.get('/robots.txt')).text, BASELINE.robotsTxt);
  const sitemap = (await s.get('/sitemap.xml')).text;
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => unescape(m[1])), BASELINE.sitemapLocs);
  assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
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
