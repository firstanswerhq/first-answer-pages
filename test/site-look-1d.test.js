/**
 * high-tech-look Step 1D (Requirement 1.8 to 1.13): the live network on the home page. The script's math is in small
 * pure functions (node cap, which nodes, positions, link opacity, the drift step, pointer lean, still mode, the frame
 * cap); the page holds the real nodes as a plain list of links that works with JavaScript off; the canvas is
 * aria-hidden and added by the script; SEO parts are unchanged (the stored baseline in step1-public-unchanged).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  nodeCap, pickNodes, initialPositions, linkOpacity, links, step, nearestNode, stillMode, shouldDraw, frameCheck, shouldRun,
  MAX_NODES_WIDE, MAX_NODES_PHONE, MIN_NODES, FRAME_MS, LINK_DISTANCE, MIN_SPACING, LABEL_PX,
} from '../public/js/home-network.js';
import { createApp } from '../server/app.js';
import { networkList, NETWORK_LISTINGS_PER_CATEGORY, HOME_NETWORK_SCRIPT } from '../server/routes/home.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const JS = await fs.readFile(fileURLToPath(new URL('../public/js/home-network.js', import.meta.url)), 'utf8');
const CSS = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');

/** Items as the script reads them from the page's list. */
function items(categories, listingsEach) {
  const out = [];
  for (let k = 0; k < categories; k += 1) {
    out.push({ kind: 'category', label: `Category ${k}`, href: `/?category=c${k}` });
    for (let j = 0; j < listingsEach; j += 1) out.push({ kind: 'listing', label: `Listing ${k}-${j}`, href: `/listings/l${k}-${j}`, category: k });
  }
  return out;
}

test('1.12: at most 60 nodes wide and 24 on phones; slow frames halve it, never under 8', () => {
  assert.equal(MAX_NODES_WIDE, 60);
  assert.equal(MAX_NODES_PHONE, 24);
  assert.equal(nodeCap(1280), 60);
  assert.equal(nodeCap(390), 24);
  assert.equal(nodeCap(1280, { slowSteps: 1 }), 30);
  assert.equal(nodeCap(1280, { slowSteps: 2 }), 15);
  assert.equal(nodeCap(390, { slowSteps: 5 }), MIN_NODES);
});

test('1.9: the nodes are only the real links from the list: categories first, then listings in turn, up to the cap', () => {
  const list = items(4, 20);
  const nodes = pickNodes(list, 24);
  assert.equal(nodes.length, 24);
  assert.deepEqual(nodes.slice(0, 4).map(n => n.kind), ['category', 'category', 'category', 'category']);
  // Listings one per category in turn, each tied to its own category.
  assert.deepEqual(nodes.slice(4, 8).map(n => n.parent), [0, 1, 2, 3]);
  for (const n of nodes) assert.ok(list.some(i => i.href === n.href && i.label === n.label), 'every node is a link from the list');
  // Fewer items than the cap: exactly the items, nothing made up.
  assert.equal(pickNodes(items(2, 1), 60).length, 4);
  assert.deepEqual(pickNodes([], 60), []);
  assert.deepEqual(pickNodes([{ kind: 'category', label: 'x' }], 60), [], 'an item without a link is never a node');
});

test('1.8: starting places are inside the box and the same on every visit; listings start near their category', () => {
  const nodes = pickNodes(items(5, 3), 60);
  const a = initialPositions(nodes, 800, 320);
  const b = initialPositions(nodes, 800, 320);
  assert.deepEqual(a, b, 'the same picture every time');
  for (const n of a) {
    assert.ok(n.x >= 0 && n.x <= 800 && n.y >= 0 && n.y <= 320, `${n.label} inside`);
  }
  const cat = a.find(n => n.kind === 'category' && n.index === 0);
  for (const l of a.filter(n => n.kind === 'listing' && n.parent === 0)) {
    assert.ok(Math.hypot(l.x - cat.x, l.y - cat.y) <= 80, 'near its category');
  }
});

test('1.8: lines join near nodes and fade as they drift apart', () => {
  assert.ok(linkOpacity(0) > linkOpacity(50));
  assert.ok(linkOpacity(50) > linkOpacity(100));
  assert.equal(linkOpacity(LINK_DISTANCE), 0);
  assert.equal(linkOpacity(LINK_DISTANCE + 10), 0);
  assert.equal(linkOpacity(-1), 0);
  assert.equal(linkOpacity(NaN), 0);
  assert.ok(linkOpacity(0) <= 1);
  const nodes = [
    { kind: 'category', index: 0, x: 0, y: 0 }, { kind: 'category', index: 1, x: 50, y: 0 }, { kind: 'category', index: 2, x: 500, y: 0 },
  ];
  assert.deepEqual(links(nodes).map(l => [l.a, l.b]), [[0, 1]], 'only the near pair');
});

test('1.8, 1.10: the drift keeps nodes in the box, eases crowded nodes apart, and leans them toward the pointer', () => {
  // Two nodes on top of each other drift apart.
  let pair = [
    { kind: 'category', index: 0, x: 100, y: 100, vx: 0, vy: 0 }, { kind: 'category', index: 1, x: 102, y: 100, vx: 0, vy: 0 },
  ];
  const start = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
  for (let i = 0; i < 60; i += 1) pair = step(pair, { width: 400, height: 300 });
  assert.ok(Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) > start, 'eased apart');
  // Nodes stay inside the box, even when pushed at an edge.
  let edge = [{ kind: 'category', index: 0, x: 399, y: 299, vx: 5, vy: 5 }];
  for (let i = 0; i < 30; i += 1) edge = step(edge, { width: 400, height: 300 });
  assert.ok(edge[0].x <= 400 && edge[0].y <= 300 && edge[0].x >= 0 && edge[0].y >= 0);
  // A node near the pointer moves toward it; one far away does not lean.
  const alone = [{ kind: 'category', index: 0, x: 100, y: 100, vx: 0, vy: 0 }];
  const leaned = step(alone, { width: 400, height: 300, pointer: { x: 160, y: 100 } });
  const free = step(alone, { width: 400, height: 300, pointer: null });
  assert.ok(leaned[0].x > free[0].x, 'leans toward the pointer');
  const far = step(alone, { width: 400, height: 300, pointer: { x: 390, y: 290 } });
  assert.equal(far[0].x, free[0].x, 'too far to lean');
  // Pure: the input is not changed.
  assert.equal(alone[0].x, 100);
  // The pointer, a tap or the keyboard light the nearest node; a click must be close.
  const nodes = [{ x: 10, y: 10 }, { x: 100, y: 100 }];
  assert.equal(nearestNode(nodes, 104, 98), 1);
  assert.equal(nearestNode(nodes, 300, 300), -1);
  assert.ok(MIN_SPACING > 0);
});

test('1.12: still picture with reduced motion or no canvas; never faster than 30 fps; no drawing hidden or off screen', () => {
  assert.equal(stillMode({ reducedMotion: true }), true);
  assert.equal(stillMode({ hasCanvas: false }), true);
  assert.equal(stillMode({}), false);
  assert.ok(Math.abs(FRAME_MS - 1000 / 30) < 0.001);
  assert.equal(shouldDraw(1000, NaN), true);
  assert.equal(shouldDraw(1010, 1000), false, 'too soon');
  assert.equal(shouldDraw(1034, 1000), true);
  assert.equal(shouldRun({}), true);
  assert.equal(shouldRun({ hidden: true }), false);
  assert.equal(shouldRun({ onScreen: false }), false);
  assert.equal(shouldRun({ still: true }), false);
  // Ten slow frames in a row drop to fewer nodes; a fast frame resets the count.
  let s = { slowInARow: 0, drop: false };
  for (let i = 0; i < 9; i += 1) s = frameCheck(80, s.slowInARow);
  assert.equal(s.drop, false);
  s = frameCheck(80, s.slowInARow);
  assert.equal(s.drop, true);
  assert.equal(frameCheck(10, 5).slowInARow, 0);
});

test('1.12, 1.13: the script uses no library or outside file, draws labels at 12 px or more, and keeps the canvas aria-hidden', () => {
  assert.equal(/\bimport\b/.test(JS), false, 'no imports');
  assert.equal(/fetch\(|XMLHttpRequest|https?:\/\//.test(JS.replace(/\/\/[^\n]*/g, '')), false, 'no outside files');
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(JS), false, 'adds no page content: only the canvas');
  assert.match(JS, /canvas\.setAttribute\('aria-hidden', 'true'\)/);
  assert.ok(LABEL_PX >= 12);
  assert.match(JS, /visibilitychange/);
  assert.match(JS, /IntersectionObserver/);
  assert.match(JS, /prefers-reduced-motion: reduce/);
  // Colors come from the page's tokens.
  assert.match(JS, /token\('--color-primary'/);
  assert.match(JS, /token\('--color-accent'/);
});

// ---- the page --------------------------------------------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const listing = (id, name, category) => ({
  id, name, category, phone: '(615) 555-0142', description: 'We do good work.', city: 'Nashville', state: 'TN',
  services: ['Repairs'], serviceArea: 'Nashville', hours: { monday: '8am-5pm' },
});

async function start(published) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-1d-'));
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
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

test('1.9, 1.13: the home page holds the real nodes as a plain list of links (it works with JavaScript off)', async () => {
  const published = [
    listing('zephyr-plumbing-nashville', 'Zephyr Plumbing', 'plumbers'),
    ...Array.from({ length: 8 }, (_, i) => listing(`pipe-${i}-nashville`, `Pipe Co ${i}`, 'plumbers')),
    listing('ember-electric-nashville', 'Ember Electric', 'electricians'),
  ];
  const get = await start(published);
  const html = await get('/');
  const nav = /<nav class="home-network" aria-label="Categories and listings">[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  assert.ok(nav, 'the list is in the page');
  // Under the headline, before the search form.
  assert.ok(html.indexOf('</header>') < html.indexOf('<nav class="home-network"'));
  assert.ok(html.indexOf('<nav class="home-network"') < html.indexOf('<form class="filters"'));
  // Every link is real: a category page or a listing page of a published listing.
  const hrefs = [...nav.matchAll(/<a href="([^"]+)" data-node="(category|listing)">([^<]+)<\/a>/g)];
  assert.ok(hrefs.length >= 4);
  for (const [, href, kind] of hrefs) {
    if (kind === 'category') assert.match(href, /^\/\?category=(plumbers|electricians)$/);
    else assert.ok(published.some(l => href === `/listings/${l.id}`), href);
  }
  // At most six listings per category in the list (the directory below has every one).
  const plumbers = /<li class="network-category"><a href="\/\?category=plumbers"[\s\S]*?<\/ul><\/li>/.exec(nav)?.[0] ?? '';
  assert.equal((plumbers.match(/data-node="listing"/g) ?? []).length, NETWORK_LISTINGS_PER_CATEGORY);
  // No canvas in the HTML: the script adds it (aria-hidden). The script is loaded as a module from this site.
  assert.equal(/<canvas/.test(html), false);
  assert.ok(html.includes(`<script type="module" src="${HOME_NETWORK_SCRIPT}"></script>`));
  // Only on the unfiltered home page.
  const filtered = await get('/?category=plumbers');
  assert.equal(filtered.includes('home-network'), false);
  assert.equal(filtered.includes(HOME_NETWORK_SCRIPT), false);
});

test('1.9: the list is built only from what the directory has; nothing when there are no listings', () => {
  const grouped = new Map([['plumbers', [{ id: 'a b', name: 'A & B <Pipes>' }]]]);
  const html = networkList(grouped, [{ slug: 'plumbers', label: 'Plumbers' }]);
  assert.ok(html.includes('<a href="/listings/a%20b" data-node="listing">A &amp; B &lt;Pipes&gt;</a>'), 'escaped, and a real link');
  assert.equal(networkList(new Map(), []), '');
  assert.equal(networkList(new Map([['unknown', [{ id: 'x', name: 'X' }]]]), []), '', 'never a category the site does not have');
});

test('1.5, 1.7: the network CSS uses tokens only, 12 px or more, and fits 390 px', () => {
  const block = CSS.slice(CSS.indexOf('high-tech-look Step 1D: the live network'), CSS.indexOf('high-tech-look Step 1B: the open-book home page'));
  assert.ok(block.length > 300);
  const bare = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(bare), false);
  assert.match(bare, /\.network-canvas \{[^}]*width: 100%;/);
  assert.equal(/animation|transition/.test(bare), false, 'the CSS moves nothing; the script moves the nodes');
});
