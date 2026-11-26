/**
 * high-tech-look Step 1B (Requirement 1.2, 1.3): the open-book home page. A glowing spine down the left edge, A-Z
 * index tabs down the right edge on wide screens (real links; the shown category's tab lit; hidden on phones), and
 * the headline "The phone book is back." with "And AI can read it." in the glow color, the owner's sentence under it.
 * The h1, titles and everything search engines read stay the same (test/step1-public-unchanged.test.js holds the
 * stored baseline). Also the two 1A nits: the field icons in the muted text color, and a light printed health map.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const CSS = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
const SENTENCE = 'People now ask AI who to call. List your business free so AI can find it.';

const base = (id, name, category) => ({
  id, name, category, phone: '(615) 555-0142', description: 'We do good work in Nashville.', city: 'Nashville', state: 'TN',
  services: ['Repairs'], serviceArea: 'Nashville', hours: { monday: '8am-5pm' },
});
const LISTINGS = [
  base('zephyr-plumbing-nashville', 'Zephyr Plumbing', 'plumbers'),
  base('ember-electric-nashville', 'Ember Electric', 'electricians'),
];

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function start() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-1b-'));
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(LISTINGS));
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  return async p => (await fetch(origin + p)).text();
}

const get = await start();
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const labelOf = slug => categories.find(c => c.slug === slug)?.label;

/** One CSS rule's body by its exact selector (the last one in the file wins, as in the browser). */
function lastRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const all = [...CSS.matchAll(new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))];
  return all.at(-1)?.[1] ?? '';
}

test('1.2: the home page main area is a book, with A-Z tabs that are real links to the categories that have listings', async () => {
  const html = await get('/');
  assert.match(html, /<main>\n<div class="book">\n<nav class="book-tabs" aria-label="Categories A to Z">/);
  const nav = /<nav class="book-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  const tabs = [...nav.matchAll(/<a class="book-tab( is-on)?" href="([^"]+)"( aria-current="page")?><span aria-hidden="true">([A-Z])<\/span><span class="book-tab-name">([^<]+)<\/span><\/a>/g)];
  // One tab per first letter of a category that has a listing, in A-Z order.
  assert.deepEqual(tabs.map(t => t[4]), [labelOf('electricians')[0], labelOf('plumbers')[0]].sort());
  for (const t of tabs) {
    assert.match(t[2], /^\/\?category=[a-z0-9-]+$/, 'a real category page');
    assert.equal(t[1], undefined, 'nothing is lit on the unfiltered home page');
    assert.equal(t[3], undefined);
  }
  assert.deepEqual(tabs.map(t => t[5]).sort(), [labelOf('electricians'), labelOf('plumbers')].sort(), 'each tab names its category');
  // Never a tab for a category with no listing.
  assert.equal(nav.includes(labelOf('lawyers') ?? 'no such label'), false);
  // The book wraps the head, the search, the check button and the listings.
  const book = html.slice(html.indexOf('<div class="book">'), html.indexOf('</main>'));
  for (const part of ['<header class="home-head">', '<form class="filters"', 'Zephyr Plumbing', 'Ember Electric']) assert.ok(book.includes(part), part);
});

test('1.2: the tab for the category shown is lit (and marked as the current page)', async () => {
  const html = await get('/?category=plumbers');
  const nav = /<nav class="book-tabs"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  const plumbers = new RegExp(`<a class="book-tab is-on" href="/\\?category=plumbers" aria-current="page"><span aria-hidden="true">${labelOf('plumbers')[0]}</span>`);
  assert.match(nav, plumbers);
  assert.equal((nav.match(/is-on/g) ?? []).length, 1, 'only one tab lit');
  assert.equal((nav.match(/aria-current/g) ?? []).length, 1);
});

test('1.3: the headline is "The phone book is back." and "And AI can read it.", with the owner\'s sentence under it; the h1 keeps its words', async () => {
  const html = await get('/');
  const header = /<header class="home-head">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  assert.ok(header.includes('<h1>Local Business Directory</h1>'), 'the h1 is unchanged (Requirement 5)');
  assert.ok(header.includes('<p class="tagline"><span class="tagline-back">The phone book is back.</span> <span class="tagline-ai">And AI can read it.</span></p>'));
  assert.ok(header.includes(`<p class="home-why">${SENTENCE}</p>`), 'the owner\'s sentence, as written');
  assert.ok(header.indexOf('class="tagline"') < header.indexOf('class="home-why"'), 'under the headline');
  // The second line is on its own line, in the glow color.
  assert.match(lastRule('.tagline-back, .tagline-ai'), /display: block;/);
  assert.match(lastRule('.tagline-ai'), /color: var\(--color-primary\);/);
});

test('1.2, 1.7: the spine is drawn by CSS; the tabs show only on wide screens, and nothing pushes the page sideways', () => {
  assert.match(lastRule('.book::before'), /content: "";/);
  assert.match(lastRule('.book::before'), /border-right: 1px solid var\(--color-primary\);/);
  // Hidden by default (phones), shown from 900 px.
  assert.match(CSS, /\.book-tabs \{ display: none; \}/);
  const wide = /@media \(min-width: 900px\) \{\n  \/\* Room on the right[\s\S]*?\n\}/.exec(CSS)?.[0] ?? '';
  assert.match(wide, /\.book-tabs \{\s*display: flex;/);
  assert.match(wide, /\.book \{ max-width: min\(66rem, calc\(100% - 3rem\)\);/, 'room for the tabs that stand out 1rem');
  // The tab names are there for screen readers, hidden on screen.
  assert.match(lastRule('.book-tab-name'), /clip-path: inset\(50%\);/);
  // The lit tab: dark text on amber (AA), from tokens only.
  assert.match(wide, /\.book-tab\.is-on \{\s*color: var\(--color-button-text\);\s*background: var\(--color-gold\);/);
  // Tokens only in the 1B block.
  const block = CSS.slice(CSS.indexOf('high-tech-look Step 1B: the open-book home page'), CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(block.length > 500);
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  // Nothing in it moves (1.6): no animation or transition at all.
  assert.equal(/animation|transition/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), false);
});

test('1A nit: the field icons are drawn in the muted text color (the pictures can\'t read a token, so its value is written in)', () => {
  const muted = /--color-text-muted:\s*(#[0-9A-Fa-f]{6})/.exec(CSS)?.[1];
  assert.equal(muted, '#A9B6D3');
  const encoded = `%23${muted.slice(1)}`;
  for (const selector of ['.filters label:nth-of-type(1)', '.filters label:nth-of-type(2)', '#l-name', '#l-email', '#l-phone']) {
    const body = lastRule(selector);
    assert.ok(body.includes('data:image/svg+xml'), selector);
    assert.ok(body.includes(`stroke='${encoded}'`), `${selector} uses ${muted}`);
    assert.equal(body.includes("stroke='%230F1B33'"), false, `${selector} no dark ink`);
  }
});

test('1A nit: in print the health map is light: white panel and node fills, dark words', () => {
  const last = CSS.slice(CSS.lastIndexOf('@media print {'));
  assert.match(last, /\.health \{\s*--health-panel: #FFFFFF;\s*--health-node-fill: #FFFFFF;\s*--health-ink: #0F1B33;/);
  // It comes after the screen values, so print uses it.
  assert.ok(CSS.lastIndexOf('--health-node-fill: #FFFFFF') > CSS.indexOf('--health-node-fill: #111A30'));
});
