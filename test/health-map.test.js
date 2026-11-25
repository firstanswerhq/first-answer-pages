/**
 * high-tech-look Requirement 2 (Step 2): the health map. The plain list and the map show the same statuses, the map is
 * decoration (aria-hidden), status is always in words and a symbol (never color only), the links move only when green
 * (slow and fading when amber, broken when red, dashed when gray), reduced motion stops everything, phones show the
 * main nodes only, the colors meet AA, and "Founding spots still open" is never a health light.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readPageFacts } from '../server/lib/page-facts.js';
import { buildSignals, signalRows } from '../server/lib/health-signals.js';
import {
  healthModel, healthMapHtml, mainStatus, linkSvg, MAIN_NODES, SUB_NODES, MAIN_WORDS, SYMBOLS, FOUNDING_NOTE, MAP_INTRO,
} from '../server/lib/health-map.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const PAGE = `<h1>Zephyr Plumbing</h1><p>We are plumbers serving Nashville. Call (615) 555-0142. ${'We fix pipes. '.repeat(20)}</p>
<a href="/plumbing-repair">Plumbing repair</a> <a href="/drain-plumbing">Drain plumbing</a>
<a href="https://www.facebook.com/ZephyrPlumbing">Facebook</a>`;
const PLACE = {
  name: 'Zephyr Plumbing LLC', address: '12 Main St, Nashville, TN 37203, USA', phone: '(615) 555-0142', website: 'https://zephyr.example/',
  hasHours: true, hoursByDay: {}, businessStatus: 'OPERATIONAL', primaryType: 'plumber', rating: 4.6, ratingCount: 40,
  newestReviewAt: new Date(NOW - 10 * 86400000).toISOString(),
};

const signals = (over = {}) => buildSignals({
  input: INPUT,
  facts: readPageFacts(PAGE),
  found: { phone: '(615) 555-0142', address: '', hours: [] },
  sitemap: { status: 200, text: '<?xml version="1.0"?><urlset><url><loc>https://zephyr.example/</loc><lastmod>2026-10-01</lastmod></url></urlset>' },
  places: { status: 'found', place: PLACE },
  bing: { status: 'not_found' },
  listingInfo: { state: 'none', listing: null, verified: false, founder: null, foundersOpen: false },
  now: NOW,
  ...over,
});
const RESULTS = [
  { id: 'ai-bots-allowed', result: 'pass' }, { id: 'business-labeled', result: 'fail' }, { id: 'info-sheet', result: 'fail' },
  { id: 'title-city-service', result: 'pass' }, { id: 'one-headline', result: 'pass' }, { id: 'summary', result: 'not_checked' },
  { id: 'image-descriptions', result: 'pass' }, { id: 'share-picture', result: 'fail' }, { id: 'tap-to-call', result: 'pass' },
  { id: 'hours-shown', result: 'fail' }, { id: 'address-shown', result: 'fail' }, { id: 'call-button', result: 'pass' },
  { id: 'reviews-visible', result: 'fail' },
];
const AI_ROWS = [{ name: 'Answer 1 (Claude)', status: 'missing', label: "Didn't name you" }];
const grade = (over = {}) => ({ input: INPUT, results: RESULTS, signals: signals(), ...over });
const model = (g = grade(), opts = {}) => healthModel(g, { score: 61, aiRows: AI_ROWS, aiStatus: 'missing', ...opts });

const listOf = html => /<div class="health-list">([\s\S]*?)<\/div>\s*<div class="health-map"/.exec(html)?.[1] ?? '';
const mapOf = html => /<div class="health-map" aria-hidden="true">([\s\S]*?)<\/svg>/.exec(html)?.[1] ?? '';
const textOf = html => html.replace(/<[^>]*>/g, ' ').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('the section: the plain list comes first, the map after it, and the map is aria-hidden', () => {
  const html = healthMapHtml(model());
  assert.ok(html.indexOf('class="health-list"') < html.indexOf('class="health-map"'), 'the list is first');
  assert.match(html, /<div class="health-map" aria-hidden="true">/);
  assert.match(html, /<h2 id="health-title">Health of your setup<\/h2>/);
  assert.ok(html.includes(MAP_INTRO));
  assert.equal(/<img|<i class|icon-|fa-|logo/i.test(html), false, 'no logo images or icon fonts');
  assert.equal(/<script/i.test(html), false, 'no script in the section');
});

test('seven main nodes in the design\'s order, in the list and on the map', () => {
  const html = healthMapHtml(model());
  const listNames = [...listOf(html).matchAll(/<span class="health-group-name">([^<]+):<\/span>/g)].map(m => m[1]);
  assert.deepEqual(listNames, MAIN_NODES.map(n => n.name));
  assert.deepEqual(listNames, ['Website', 'AI answers', 'Google profile', 'Reviews', 'Details match', 'Links', 'Free listing']);
  const mapNames = [...mapOf(html).matchAll(/<text [^>]*class="health-node-name">([^<]+)<\/text>/g)].map(m => m[1]);
  assert.deepEqual(mapNames, listNames);
});

test('the list and the map give every main node the same status words and the same status', () => {
  const m = model();
  const html = healthMapHtml(m);
  const list = [...listOf(html).matchAll(/<div class="health-group health-(\w+)" id="health-g-(\w+)">\s*<h3>[\s\S]*?<span class="health-status">([^<]+)<\/span><\/h3>/g)]
    .map(x => ({ status: x[1], id: x[2], label: x[3] }));
  const map = [...mapOf(html).matchAll(/<a href="#health-g-(\w+)"[^>]*><g class="health-node health-node-(\w+)">[\s\S]*?class="health-node-status">([^<]+)<\/text>/g)]
    .map(x => ({ id: x[1], status: x[2], label: x[3] }));
  assert.equal(list.length, 7);
  assert.deepEqual(map, list.map(({ id, status, label }) => ({ id, status, label })));
  for (const x of list) {
    assert.ok(['Good', 'Partly', 'Needs work', 'Not checked', 'Pass'].includes(x.label), x.label);
    if (x.label !== 'Pass') assert.equal(x.label, MAIN_WORDS[x.status]);
  }
});

test('every sub-node of the design is a row in the list, with its status words; each one is a node on the map', () => {
  const m = model();
  const html = healthMapHtml(m);
  const list = textOf(listOf(html));
  for (const def of SUB_NODES.filter(d => d.path !== 'listing.founding')) {
    assert.ok(list.includes(`${def.name}:`), def.name);
  }
  const subs = m.mains.flatMap(x => x.subs);
  for (const sub of subs) assert.ok(list.includes(`${sub.name}: ${sub.label}`), `${sub.name}: ${sub.label}`);
  const dots = (mapOf(html).match(/<g class="health-sub health-sub-/g) ?? []).length;
  assert.equal(dots, subs.length, 'one map sub-node per list row');
  // The sub-node statuses on the map are the list's.
  const mapStatuses = [...mapOf(html).matchAll(/<g class="health-sub health-sub-(\w+)">/g)].map(x => x[1]);
  assert.deepEqual(mapStatuses, subs.map(s => s.status));
  // The rows read the saved signals' words, unchanged.
  const rows = new Map(signalRows(signals()).map(r => [r.path, r]));
  assert.equal(subs.find(s => s.name === 'Sitemap').label, rows.get('website.sitemap').label);
  assert.equal(subs.find(s => s.name === 'Found on Bing').label, 'Not found in Bing map data');
});

test('color is never the only cue: every row and every node has its status in words and a symbol', () => {
  const html = healthMapHtml(model());
  const rows = listOf(html).match(/<li class="health-row health-\w+">[\s\S]*?<\/li>/g) ?? [];
  assert.ok(rows.length > 40);
  for (const row of rows) {
    const status = /health-row health-(\w+)/.exec(row)[1];
    assert.ok(row.includes(`<span class="health-sym" aria-hidden="true">${SYMBOLS[status]}</span>`), row);
    assert.match(row, /<span class="health-status">[^<]+<\/span>/);
  }
  for (const node of mapOf(html).match(/<g class="health-node health-node-\w+">[\s\S]*?<\/g>/g) ?? []) {
    assert.match(node, /class="health-node-sym">[^<]+</);
    assert.match(node, /class="health-node-status">[^<]+</);
  }
  for (const sub of mapOf(html).match(/<g class="health-sub health-sub-\w+">[\s\S]*?<\/g>/g) ?? []) {
    const status = /health-sub-(\w+)/.exec(sub)[1];
    assert.ok(sub.includes(`class="health-sub-sym">${SYMBOLS[status]}<`), 'a symbol');
    assert.ok(sub.includes(`>${MAIN_WORDS[status]}</text>`), 'and the status word');
  }
});

test('the center orb has the business name and the report\'s own score', () => {
  const map = mapOf(healthMapHtml(model()));
  assert.match(map, /class="health-orb-name">Zephyr Plumbing<\/text>/);
  assert.match(map, /class="health-orb-score">Health 61<\/text>/);
  const none = mapOf(healthMapHtml(model(grade(), { score: null })));
  assert.match(none, /Health: not scored yet/);
  // A typed name is escaped everywhere.
  const odd = healthMapHtml(model(grade({ input: { ...INPUT, name: '<script>x</script> & Co' } })));
  assert.equal(odd.includes('<script>'), false);
  assert.ok(odd.includes('&lt;script&gt;'));
});

test('links: green moves both ways, amber moves slowly and fades partway, red is broken, gray is dashed and still', () => {
  const a = [0, 0];
  const b = [100, 0];
  const green = linkSvg(a, b, 'good');
  assert.match(green, /health-flow-out/);
  assert.match(green, /health-flow-in/);
  assert.match(green, /health-line-good/);
  const amber = linkSvg(a, b, 'partly');
  assert.match(amber, /health-flow-slow/);
  assert.match(amber, /x2="60"/, 'the dots go only partway');
  assert.equal(/health-flow-out|health-flow-in/.test(amber), false);
  const red = linkSvg(a, b, 'missing');
  assert.equal(/health-flow/.test(red), false, 'no dots on red');
  assert.equal((red.match(/<line/g) ?? []).length, 2, 'two pieces with a break');
  assert.match(red, /x2="44"/);
  assert.match(red, /x1="56"/);
  const gray = linkSvg(a, b, 'not_checked');
  assert.equal(/health-flow/.test(gray), false, 'still');
  assert.match(gray, /health-line-gray/);
  // Sub-node links behave the same at a smaller size.
  assert.match(linkSvg(a, b, 'good', 'sub'), /health-flow-sub/);
});

test('the CSS: dashed gray, moving dots, reduced motion stops them and the orb, phones show main nodes only', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const block = css.slice(css.indexOf('/* ---- The health map on the report'));
  assert.ok(block.length > 1000, 'the health map styles are there');
  assert.match(block, /\.health-line-gray \{[^}]*stroke-dasharray/);
  assert.match(block, /\.health-flow-out \{ animation: health-flow/);
  assert.match(block, /\.health-flow-slow \{[^}]*health-fade/);
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(block)?.[1] ?? '';
  assert.match(reduced, /\.health-flow \{ animation: none; display: none; \}/);
  assert.match(reduced, /\.health-orb-host \{ display: none; \}/);
  const phone = /@media \(max-width: 600px\) \{([\s\S]*?)\n\}/.exec(block)?.[1] ?? '';
  assert.match(phone, /\.health-sub \{ display: none; \}/);
  // Nothing wider than a 390 px phone, and no outside images or fonts.
  assert.equal(/(?:^|[^-])width:\s*(?:[4-9]\d\d|\d{4,})px/.test(block), false);
  assert.equal(/url\(\s*['"]?https?:/i.test(block), false);
});

test('the colors meet WCAG AA: the list on the page, the map\'s words on its dark panel', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const first = (name, from = 0) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css.slice(from))?.[1];
  const block = css.indexOf('/* ---- The health map on the report');
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const surface = first('--color-surface');
  for (const name of ['--color-success', '--color-partly-text', '--color-fail', '--color-text-muted', '--color-text']) {
    const c = first(name);
    assert.ok(c, name);
    assert.ok(ratio(c, surface) >= 4.5, `${name} ${c} on ${surface}: ${ratio(c, surface).toFixed(2)}`);
  }
  const panel = first('--health-panel', block);
  const nodeFill = first('--health-node-fill', block);
  for (const name of ['--health-ink', '--health-good', '--health-partly', '--health-missing', '--health-gray', '--health-glow']) {
    const c = first(name, block);
    assert.ok(c, name);
    for (const bg of [panel, nodeFill]) assert.ok(ratio(c, bg) >= 4.5, `${name} ${c} on ${bg}: ${ratio(c, bg).toFixed(2)}`);
  }
});

test('the main status rules follow the design', () => {
  const s = (status, name = 'x') => ({ name, status });
  assert.equal(mainStatus('website', [s('good'), s('good'), s('not_checked')]), 'good');
  assert.equal(mainStatus('website', [s('good'), s('missing')]), 'partly');
  assert.equal(mainStatus('website', [s('missing'), s('missing'), s('good')]), 'missing', 'most are red');
  assert.equal(mainStatus('website', [s('not_checked')]), 'not_checked');
  assert.equal(mainStatus('google', [s('missing', 'Found on Google'), s('not_checked')]), 'missing');
  assert.equal(mainStatus('google', [s('good', 'Found on Google'), s('missing', 'Open for business')]), 'partly');
  assert.equal(mainStatus('reviews', [s('good', 'Google review count'), s('good', 'Google star rating'), s('partly', 'A recent review')]), 'good');
  assert.equal(mainStatus('reviews', [s('missing', 'Google review count'), s('not_checked', 'Google star rating'), s('missing', 'Reviews shown on your website')]), 'missing');
  assert.equal(mainStatus('reviews', [s('not_checked', 'Google review count'), s('missing', 'Reviews shown on your website')]), 'partly', 'not proven missing');
  assert.equal(mainStatus('details', [s('good'), s('missing')]), 'missing');
  assert.equal(mainStatus('details', [s('good'), s('partly')]), 'partly');
  assert.equal(mainStatus('links', [s('partly'), s('partly')]), 'partly', 'links are never red');
  assert.equal(mainStatus('listing', [s('good', 'Listed on First Answer Pages'), s('good', 'Verified stamp')]), 'good');
  assert.equal(mainStatus('listing', [s('partly', 'Listed on First Answer Pages'), s('not_checked', 'Verified stamp')]), 'partly');
  assert.equal(mainStatus('ai', [], { aiStatus: 'partly' }), 'partly');
  const m = model(grade(), { aiStatus: 'good', aiRows: [{ name: 'Answer 1 (Claude)', status: 'good', label: 'Named you' }] });
  assert.equal(m.mains.find(x => x.id === 'ai').label, 'Pass');
});

test('Q8: "Founding spots still open" is only a plain line under Free listing, never a light; a Founding Member is', () => {
  const open = healthMapHtml(model(grade({ signals: signals({ listingInfo: { state: 'none', listing: null, foundersOpen: true } }) })));
  assert.equal(open.split(FOUNDING_NOTE).length - 1, 1);
  const listing = /<div class="health-group[^"]*" id="health-g-listing">([\s\S]*?)<\/div>/.exec(open)[1];
  assert.ok(listing.includes(`<p class="health-note">${FOUNDING_NOTE}</p>`));
  assert.equal(/Founding/.test(mapOf(open)), false, 'not on the map');
  assert.equal(/health-row[^>]*>[\s\S]{0,120}Founding/.test(open), false, 'not a status row');
  assert.ok(FOUNDING_NOTE.length <= 160);
  const member = model(grade({ signals: signals({ listingInfo: { state: 'listed', listing: { id: 'z', phone: '(615) 555-0142', address: '', website: 'https://zephyr.example/' }, verified: true, founder: { number: 3 } } }) }));
  const row = member.mains.find(x => x.id === 'listing').subs.find(s => s.name === 'Founding Member');
  assert.equal(row.status, 'good');
  assert.equal(row.label, 'Founding Member');
  assert.equal(member.mains.find(x => x.id === 'listing').note, undefined);
});

test('a report from before these signals: every signal row is Not checked with a reason, nothing is red, nothing breaks', () => {
  const m = model(grade({ signals: undefined }));
  for (const sub of m.mains.flatMap(x => x.subs)) {
    if (sub.status === 'not_checked') assert.ok(sub.reason, sub.name);
  }
  const signalSubs = m.mains.filter(x => ['google', 'details'].includes(x.id)).flatMap(x => x.subs);
  for (const sub of signalSubs) assert.equal(sub.status, 'not_checked', sub.name);
  assert.equal(m.mains.find(x => x.id === 'google').status, 'not_checked');
  assert.doesNotThrow(() => healthMapHtml(m));
  assert.doesNotThrow(() => healthMapHtml(healthModel({}, {})));
});

test('"Run a new check" in a reason becomes the report\'s own link, and the rest of the reason stays escaped text', () => {
  const html = healthMapHtml(model(grade({ signals: undefined })), { runNew: text => `<a href="/grade?from=abc">${text}</a>` });
  assert.ok(html.includes('This report was made before this check existed. <a href="/grade?from=abc">Run a new check</a> to see it.'));
  assert.equal(/run a new check/i.test(html.replace(/<a [^>]*>[^<]*<\/a>/g, '')), false);
});

test('fix sentences show only in the full report; the locked report shows the statuses and the reasons', () => {
  const m = model();
  const locked = healthMapHtml(m, { full: false });
  const full = healthMapHtml(m, { full: true });
  assert.equal(locked.includes('<strong>Fix:</strong>'), false);
  assert.ok(full.includes('<strong>Fix:</strong>'));
  assert.ok(locked.includes('Not found in Bing map data'));
});

test('the words follow the rules: plain, no promise, no "did not", every sentence 160 characters or less', () => {
  const html = healthMapHtml(model(), { full: true });
  const text = textOf(html);
  assert.equal(/guarantee|yellow pages|\bYP\b|\$\d|\bdid not\b|will (?:name|recommend|mention)/i.test(text), false);
  for (const sentence of [MAP_INTRO, FOUNDING_NOTE]) assert.ok(sentence.length <= 160);
});

test('the orb script only draws: it adds no words to the page and stops for reduced motion', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-orb.js', import.meta.url)), 'utf8');
  assert.equal(/innerHTML|textContent|insertAdjacentHTML|document\.write|fetch\(/.test(js), false);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /getContext/);
  assert.ok(js.length < 6000, 'small');
});
