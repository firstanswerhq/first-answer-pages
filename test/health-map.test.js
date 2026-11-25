/**
 * high-tech-look Requirement 2 (Step 2): the health map, with the Step 2 review fixes (V1-V12, H1-H13).
 * The plain list and the map show the same statuses, the map is decoration (aria-hidden), status is always in words
 * and a symbol in the list and on every main node, the main words are readable (12 px or more), the links move only
 * when green, reduced motion stops everything, phones get a main-nodes-only drawing, the colors meet AA, and the free
 * listing is information, never a health light.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readPageFacts } from '../server/lib/page-facts.js';
import { buildSignals } from '../server/lib/health-signals.js';
import { escapeHtml } from '../server/lib/html.js';
import {
  healthModel, healthMapHtml, mainStatus, linkSvg, MAIN_NODES, SUB_NODES, MAIN_WORDS, SYMBOLS, FOUNDING_NOTE, MAP_INTRO,
  MAP_SIZES, TAP_HINT, OLD_REPORT_NOTE,
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
  { id: 'title-city-service', result: 'pass' }, { id: 'one-headline', result: 'pass' }, { id: 'summary', result: 'not_checked', detail: 'Your page has no summary we could read.' },
  { id: 'image-descriptions', result: 'pass' }, { id: 'share-picture', result: 'fail' }, { id: 'tap-to-call', result: 'pass' },
  { id: 'hours-shown', result: 'fail' }, { id: 'address-shown', result: 'fail' }, { id: 'call-button', result: 'pass' },
  { id: 'reviews-visible', result: 'fail' },
];
const AI_ROWS = [{ name: 'Answer 1 (Claude)', status: 'missing', label: "Didn't name you" }];
const grade = (over = {}) => ({ input: INPUT, results: RESULTS, signals: signals(), ...over });
const model = (g = grade(), opts = {}) => healthModel(g, { score: 61, aiRows: AI_ROWS, aiStatus: 'missing', ...opts });

const listOf = html => /<div class="health-list">([\s\S]*?)<\/div>\s*<div class="health-map"/.exec(html)?.[1] ?? '';
const fullMapOf = html => /<svg class="health-svg health-svg-full"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
const phoneMapOf = html => /<svg class="health-svg health-svg-phone"[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
const mapOf = html => /<div class="health-map" id="health-map" aria-hidden="true">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/.exec(html)?.[1] ?? '';
const textOf = html => html.replace(/<[^>]*>/g, ' ').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const nodesOf = svg => [...svg.matchAll(/<a href="#health-g-(\w+)"[^>]*><g class="health-node health-node-(\w+)" data-name="([^"]+)">[\s\S]*?class="health-node-status" font-size="\d+">([^<]+)<\/text>/g)]
  .map(x => ({ id: x[1], status: x[2], name: x[3], label: x[4] }));

test('the section: the plain list comes first, the map after it, and the map is aria-hidden', () => {
  const html = healthMapHtml(model());
  assert.ok(html.indexOf('class="health-list"') < html.indexOf('class="health-map"'), 'the list is first');
  assert.match(html, /<div class="health-map" id="health-map" aria-hidden="true">/);
  assert.match(html, /<h2 id="health-title">Health of your setup<\/h2>/);
  // V8: compare with the escaped sentence.
  assert.ok(html.includes(escapeHtml(MAP_INTRO)));
  assert.ok(textOf(html).includes(MAP_INTRO));
  assert.equal(/<img|<i class|icon-|fa-|logo/i.test(html), false, 'no logo images or icon fonts');
  assert.equal(/<script/i.test(html), false, 'no script in the section');
  // Every id on the page is used once (two drawings, two gradients).
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('H1: the intro says what the colors mean, and the orb shows the score in the report\'s own form', () => {
  assert.equal(MAP_INTRO, "Every check we ran, at a glance. Green is good, amber is part way there, red needs work, gray means we couldn't check it. Your score is at the top of the page.");
  assert.ok(MAP_INTRO.length <= 160);
  const html = healthMapHtml(model());
  assert.equal(/Health \d/.test(html), false, 'no second name for the score');
  assert.match(fullMapOf(html), /class="health-orb-score">Score 61\/100<\/text>/);
  assert.match(phoneMapOf(html), /class="health-orb-score">Score 61\/100<\/text>/);
  assert.match(fullMapOf(healthMapHtml(model(grade(), { score: null }))), /Not scored yet/);
  assert.match(fullMapOf(html), /class="health-orb-name" font-size="24">Zephyr Plumbing<\/text>/);
  const odd = healthMapHtml(model(grade({ input: { ...INPUT, name: '<script>x</script> & Co' } })));
  assert.equal(odd.includes('<script>'), false);
  assert.ok(odd.includes('&lt;script&gt;'));
});

test('seven main nodes in the design\'s order, in the list and on both drawings, with the same words and statuses', () => {
  const html = healthMapHtml(model());
  const list = [...listOf(html).matchAll(/<div class="health-group health-(\w+)" id="health-g-(\w+)">\s*<h3>[\s\S]*?<span class="health-group-name">([^<]+):<\/span> <span class="health-status">([^<]+)<\/span><\/h3>/g)]
    .map(x => ({ id: x[2], status: x[1], name: x[3], label: x[4] }));
  assert.deepEqual(list.map(x => x.name), ['Website', 'AI answers', 'Google profile', 'Reviews', 'Details match', 'Links', 'Free listing']);
  assert.deepEqual(list.map(x => x.name), MAIN_NODES.map(n => n.name));
  assert.deepEqual(nodesOf(fullMapOf(html)), list);
  assert.deepEqual(nodesOf(phoneMapOf(html)), list);
  for (const x of list) {
    if (x.id === 'listing') assert.equal(x.status, 'info');
    else if (x.label !== 'Pass') assert.equal(x.label, MAIN_WORDS[x.status]);
  }
  // Two-line names on the map.
  assert.match(fullMapOf(html), /<tspan[^>]*>Google<\/tspan><tspan[^>]*>profile<\/tspan>/);
  assert.match(phoneMapOf(html), /<tspan[^>]*>Free<\/tspan><tspan[^>]*>listing<\/tspan>/);
});

test('V2/H4: the main node words are at least 12 px on screen, on desktop (1280) and on a 390 px phone', () => {
  for (const [name, sz] of Object.entries(MAP_SIZES)) {
    const px = font => (font * sz.minShownPx) / sz.view;
    for (const key of ['nameFont', 'statusFont', 'symbolFont', 'orbFont']) {
      assert.ok(px(sz[key]) >= 12, `${name} ${key}: ${px(sz[key]).toFixed(1)} px`);
    }
    // The longest status word fits inside a node (about 0.55 of the font size per letter).
    assert.ok(sz.statusFont * 0.55 * 'Not checked'.length <= 2 * Math.sqrt(sz.rNode ** 2 - (sz.rNode * 0.52) ** 2));
  }
  const html = healthMapHtml(model());
  assert.match(phoneMapOf(html), /viewBox="150 150 700 700"/);
  for (const svg of [fullMapOf(html), phoneMapOf(html)]) {
    const sz = svg === phoneMapOf(html) ? MAP_SIZES.phone : MAP_SIZES.full;
    assert.ok(svg.includes(`class="health-node-name" font-size="${sz.nameFont}"`));
    assert.ok(svg.includes(`class="health-node-status" font-size="${sz.statusFont}"`));
  }
  assert.equal(/health-sub/.test(phoneMapOf(html)), false, 'the phone drawing has the main nodes only');
});

test('V4/H3: sub-nodes on the map have a symbol and the list\'s color, and no words that could differ from the list', () => {
  const m = model();
  const html = healthMapHtml(m);
  const subs = m.mains.flatMap(x => x.subs);
  const mapSubs = [...fullMapOf(html).matchAll(/<g class="health-sub health-sub-(\w+)">([\s\S]*?)<\/g>/g)];
  assert.equal(mapSubs.length, subs.length, 'one map sub-node per list row');
  mapSubs.forEach((x, i) => {
    assert.equal(x[1], subs[i].status, subs[i].name);
    assert.ok(x[2].includes(`class="health-sub-sym">${SYMBOLS[x[1]]}<`), 'a symbol');
    assert.equal(/health-sub-word|Good<|Partly<|Needs work<|Not checked</.test(x[2]), false, 'no status words on sub-nodes');
  });
  // The same words never carry two severities: "Not found" is always red; Bing is "Not on Bing Maps yet".
  const list = listOf(html);
  for (const row of list.match(/<li class="health-row health-\w+">[\s\S]*?<\/li>/g) ?? []) {
    if (/<span class="health-status">Not found<\/span>/.test(row)) assert.match(row, /health-row health-missing/, row);
  }
  assert.ok(textOf(list).includes('On Bing Maps: Not on Bing Maps yet'));
});

test('every sub-node of the design is a row in the list with its words; rows do not repeat themselves (H7)', () => {
  const m = model();
  const list = textOf(listOf(healthMapHtml(m)));
  for (const def of SUB_NODES.filter(d => d.path !== 'listing.founding')) assert.ok(list.includes(`${def.name}:`), def.name);
  for (const sub of m.mains.flatMap(x => x.subs)) {
    assert.ok(list.includes(`${sub.name}: ${sub.label}`), `${sub.name}: ${sub.label}`);
    assert.notEqual(sub.name, sub.label, `${sub.name} repeats itself`);
  }
  for (const pair of ['On Google: Yes', 'Category: Fits', 'Hours on Google: Listed', 'Google links to your site: Yes', 'Your website lets AI assistants read it (robots.txt): Yes']) {
    assert.ok(list.includes(pair), pair);
  }
  // H6: plain words first.
  for (const name of ['Page list for search engines (sitemap)', 'A short info file for AI (llms.txt)', 'Name, phone and address tagged for AI (business label)',
    'Search summary (the 2 lines under your link in Google)', 'Picture shown when someone shares your link', 'One main headline on the page']) {
    assert.ok(list.includes(`${name}:`), name);
  }
  // H9: one word per idea.
  for (const name of ['Your First Answer Pages listing matches your website', 'Your First Answer Pages listing links to your website', 'Hours on the home page', 'Tap-to-call phone number', 'Call or book button on the home page']) {
    assert.ok(list.includes(`${name}:`), name);
  }
  assert.equal(/Hours on the page:|Tap to call:|Call button:/.test(list), false);
});

test('V9: a Website row that was not checked uses the check\'s own reason', () => {
  const list = textOf(listOf(healthMapHtml(model())));
  assert.ok(list.includes('Search summary (the 2 lines under your link in Google): Not checked Your page has no summary we could read.'));
  const bare = textOf(listOf(healthMapHtml(model(grade({ results: [] })))));
  assert.ok(bare.includes("Couldn't check this time."));
  assert.equal(bare.includes('We couldn\'t check this on your website this time.'), false);
});

test('color is never the only cue in the list or on a main node', () => {
  const html = healthMapHtml(model());
  const rows = listOf(html).match(/<li class="health-row health-\w+">[\s\S]*?<\/li>/g) ?? [];
  assert.ok(rows.length > 40);
  for (const row of rows) {
    const status = /health-row health-(\w+)/.exec(row)[1];
    assert.ok(row.includes(`<span class="health-sym" aria-hidden="true">${SYMBOLS[status]}</span>`), row);
    assert.match(row, /<span class="health-status">[^<]+<\/span>/);
  }
  for (const node of fullMapOf(html).match(/<g class="health-node health-node-\w+"[\s\S]*?<\/g>/g) ?? []) {
    assert.match(node, /class="health-node-sym" font-size="\d+">[^<]+</);
    assert.match(node, /class="health-node-status" font-size="\d+">[^<]+</);
  }
});

test('links: green moves both ways, amber slowly and partway, red is broken (wider on sub-nodes), gray dashed, info plain', () => {
  const a = [0, 0];
  const b = [100, 0];
  const green = linkSvg(a, b, 'good');
  assert.match(green, /health-flow-out/);
  assert.match(green, /health-flow-in/);
  const amber = linkSvg(a, b, 'partly');
  assert.match(amber, /health-flow-slow/);
  assert.match(amber, /x2="60"/);
  const red = linkSvg(a, b, 'missing');
  assert.equal(/health-flow/.test(red), false);
  assert.match(red, /x2="44"/);
  assert.match(red, /x1="56"/);
  const redSub = linkSvg(a, b, 'missing', 'sub');
  assert.match(redSub, /x2="30"/, 'V7: a wider break');
  assert.match(redSub, /x1="70"/);
  const gray = linkSvg(a, b, 'not_checked');
  assert.equal(/health-flow/.test(gray), false);
  assert.match(gray, /health-line-gray/);
  const info = linkSvg(a, b, 'info');
  assert.match(info, /health-line-info/);
  assert.equal(/health-flow|health-line-(?:good|partly|missing|gray)/.test(info), false, 'no health color, no dots');
});

test('the CSS: reduced motion stops dots and orb, phones switch drawings, sub dots do not jump, off screen pauses', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const block = css.slice(css.indexOf('/* ---- The health map on the report'));
  assert.match(block, /\.health-line-gray \{[^}]*stroke-dasharray/);
  assert.match(block, /\.health-flow-out \{ animation: health-flow/);
  assert.match(block, /\.health-flow-slow \{[^}]*health-fade/);
  assert.match(block, /\.health-paused \.health-flow \{ animation-play-state: paused; \}/);
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(block)?.[1] ?? '';
  assert.match(reduced, /\.health-flow \{ animation: none; display: none; \}/);
  assert.match(reduced, /\.health-orb-host \{ display: none; \}/);
  const phone = /@media \(max-width: 600px\) \{([\s\S]*?)\n\}/.exec(block)?.[1] ?? '';
  assert.match(phone, /\.health-svg-full \{ display: none; \}/);
  assert.match(phone, /\.health-svg-phone \{ display: block; \}/);
  assert.match(phone, /\.health-tap \{ display: block; \}/);
  assert.match(block, /\.health-svg-phone \{ display: none; \}/);
  assert.match(block, /grid-template-columns: minmax\(0, 3fr\) minmax\(0, 2fr\)/, 'the wider map column');
  // V5: the sub-node dots use the main period (0.5 26), so the -53 keyframe is two whole periods.
  assert.equal(/\.health-flow-sub \{[^}]*stroke-dasharray/.test(block), false);
  assert.match(block, /\.health-flow \{[^}]*stroke-dasharray: 0\.5 26;/);
  assert.match(block, /@keyframes health-flow \{ to \{ stroke-dashoffset: -53; \} \}/);
  // Node words are sized on the words themselves (pinned above), not overridden by the CSS.
  assert.equal(/\.health-node-name \{[^}]*font-size/.test(block), false);
  assert.equal(/\.health-node-status, \.health-node-sym \{[^}]*font-size/.test(block), false);
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
    assert.ok(ratio(c, surface) >= 4.5, `${name} ${c} on ${surface}: ${ratio(c, surface).toFixed(2)}`);
  }
  const panel = first('--health-panel', block);
  const nodeFill = first('--health-node-fill', block);
  for (const name of ['--health-ink', '--health-good', '--health-partly', '--health-missing', '--health-gray', '--health-glow']) {
    const c = first(name, block);
    for (const bg of [panel, nodeFill]) assert.ok(ratio(c, bg) >= 4.5, `${name} ${c} on ${bg}: ${ratio(c, bg).toFixed(2)}`);
  }
});

test('the main status rules follow the design; the free listing is always information', () => {
  const s = (status, name = 'x') => ({ name, status });
  assert.equal(mainStatus('website', [s('good'), s('good'), s('not_checked')]), 'good');
  assert.equal(mainStatus('website', [s('good'), s('missing')]), 'partly');
  assert.equal(mainStatus('website', [s('missing'), s('missing'), s('good')]), 'missing');
  assert.equal(mainStatus('website', [s('not_checked')]), 'not_checked');
  assert.equal(mainStatus('google', [s('missing', 'On Google'), s('not_checked')]), 'missing');
  assert.equal(mainStatus('google', [s('good', 'On Google'), s('missing', 'Open for business')]), 'partly');
  assert.equal(mainStatus('reviews', [s('good', 'Google review count'), s('good', 'Google star rating'), s('partly', 'A recent review')]), 'good');
  assert.equal(mainStatus('reviews', [s('missing', 'Google review count'), s('missing', 'Reviews shown on your website')]), 'missing');
  assert.equal(mainStatus('reviews', [s('not_checked', 'Google review count'), s('missing', 'Reviews shown on your website')]), 'partly');
  assert.equal(mainStatus('details', [s('good'), s('missing')]), 'missing');
  assert.equal(mainStatus('links', [s('partly'), s('partly')]), 'partly');
  assert.equal(mainStatus('listing', [s('info'), s('info')]), 'info');
  assert.equal(mainStatus('ai', [], { aiStatus: 'partly' }), 'partly');
  const pass = model(grade(), { aiStatus: 'good', aiRows: [{ name: 'Answer 1 (Claude)', status: 'good', label: 'Named you' }] });
  assert.equal(pass.mains.find(x => x.id === 'ai').label, 'Pass');
});

test('V3/H8: the free listing has no health color; plain words; the Founding note is true at any later time', () => {
  const notListed = model();
  const listing = notListed.mains.find(x => x.id === 'listing');
  assert.equal(listing.status, 'info');
  assert.equal(listing.label, 'Not started');
  assert.deepEqual(listing.subs.map(x => [x.name, x.status, x.label]), [
    ['Listed on First Answer Pages', 'info', "Not yet. It's free, claim it below."],
    ['Verified stamp', 'info', 'Available after you claim your listing.'],
  ]);
  const html = healthMapHtml(notListed, { full: true });
  const group = /<div class="health-group health-info" id="health-g-listing">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.ok(group, 'the listing group has no health class');
  assert.equal(/Fix:/.test(group), false, 'no fix for information');
  assert.equal(/health-(?:good|partly|missing|not_checked)/.test(group), false);
  assert.match(fullMapOf(html), /health-node health-node-info" data-name="Free listing"/);

  assert.equal(FOUNDING_NOTE, 'When we ran this check, Founding Member spots were still open. Listing is free; Founding Members pay once for the optional Verified stamp.');
  assert.ok(FOUNDING_NOTE.length <= 160);
  const open = healthMapHtml(model(grade({ signals: signals({ listingInfo: { state: 'none', listing: null, foundersOpen: true } }) })));
  assert.equal(open.split(escapeHtml(FOUNDING_NOTE)).length - 1, 1);
  assert.ok(/<div class="health-group[^"]*" id="health-g-listing">[\s\S]*?<p class="health-note">/.test(open));
  assert.equal(/Founding/.test(mapOf(open)), false, 'not on the map');

  const member = model(grade({ signals: signals({ listingInfo: { state: 'listed', listing: { id: 'z', phone: '(615) 555-0142', address: '', website: 'https://zephyr.example/' }, verified: true, founder: { number: 3 } } }) }));
  const ml = member.mains.find(x => x.id === 'listing');
  assert.equal(ml.label, 'Verified');
  assert.deepEqual(ml.subs.map(x => [x.label, x.status]), [['Listed', 'info'], ['Verified', 'info'], ['Founding Member', 'info']]);
});

test('H5: no AI answer is one plain line with a link, not an empty "Answer 1" row', () => {
  const runNew = text => `<a href="/grade?from=abc">${text}</a>`;
  const reason = "The AI assistant didn't reply this time. Run a new check later to see what it says about you.";
  const m = model(grade(), { aiRows: [], aiStatus: 'not_checked', aiReason: reason });
  const html = healthMapHtml(m, { runNew });
  const group = /<div class="health-group health-not_checked" id="health-g-ai">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  assert.equal(/Answer 1/.test(group), false);
  assert.match(group, /<p class="health-why">The AI assistant didn(?:'|&#39;|&#x27;|&apos;)t reply this time\. <a href="\/grade\?from=abc">Run a new check<\/a> later to see what it says about you\.<\/p>/);
  assert.ok(reason.length <= 160);
});

test('V10/V11: a report from before these signals has one note with one link; Socials says why it is gray', () => {
  const runNew = text => `<a href="/grade?from=abc">${text}</a>`;
  const m = model(grade({ signals: undefined }));
  assert.equal(m.old, true);
  const html = healthMapHtml(m, { runNew, full: true });
  assert.equal((html.match(/>Run a new check<\/a>/g) ?? []).length, 1, 'one link, not one per row');
  assert.ok(html.includes('<p class="health-note health-old">This report was made before these checks existed. <a href="/grade?from=abc">Run a new check</a> to see them.</p>'));
  assert.ok(OLD_REPORT_NOTE.length <= 160);
  for (const sub of m.mains.filter(x => ['google', 'details'].includes(x.id)).flatMap(x => x.subs)) {
    assert.equal(sub.status, 'not_checked', sub.name);
    assert.equal(sub.reason, 'Made before this check existed.');
  }
  assert.match(html, /Socials: <span class="health-status">Not checked<\/span><\/h4>\s*<p class="health-why">Made before this check existed\.<\/p>/);
  assert.equal(/run a new check/i.test(html.replace(/<a [^>]*>[^<]*<\/a>/g, '')), false, 'every mention is a link');
  assert.doesNotThrow(() => healthMapHtml(healthModel({}, {})));
});

test('V11: the Socials fix sits under its heading, not inside it', () => {
  const html = healthMapHtml(model(), { full: true });
  const h4 = /<h4 class="health-cluster health-\w+">[\s\S]*?<\/h4>/.exec(html.slice(html.indexOf('Socials:') - 200))?.[0] ?? '';
  assert.ok(h4.includes('Socials:'));
  assert.equal(h4.includes('Fix:'), false);
  assert.match(html, /<\/h4>\s*<p class="health-fix"><strong>Fix:<\/strong> If you have them, add links to your Instagram and TikTok pages/);
});

test('H12: phones get a hint that circles can be tapped, and a way back to the map', () => {
  const html = healthMapHtml(model());
  assert.ok(mapOf(html).includes(`<p class="health-tap">${TAP_HINT}</p>`));
  assert.equal((html.match(/<a href="#health-map" class="health-back" tabindex="-1" aria-hidden="true">Back to the map<\/a>/g) ?? []).length, 7);
});

test('fix sentences show only in the full report; the locked report shows the statuses and the reasons', () => {
  const m = model();
  assert.equal(healthMapHtml(m, { full: false }).includes('<strong>Fix:</strong>'), false);
  assert.ok(healthMapHtml(m, { full: true }).includes('<strong>Fix:</strong>'));
});

test('the words follow the rules: plain, no promise, no "did not", every sentence 160 characters or less', () => {
  const text = textOf(healthMapHtml(model(), { full: true }));
  assert.equal(/guarantee|yellow pages|\bYP\b|\$\d|\bdid not\b|will (?:name|recommend|mention)|opening hours/i.test(text), false);
  for (const sentence of [MAP_INTRO, FOUNDING_NOTE, TAP_HINT, OLD_REPORT_NOTE]) assert.ok(sentence.length <= 160);
});

test('V1/V6: the orb script never leaks a loop, cleans up its listeners, and pauses off screen', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-orb.js', import.meta.url)), 'utf8');
  assert.equal(/innerHTML|textContent|insertAdjacentHTML|document\.write|fetch\(/.test(js), false, 'adds no words');
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /getContext/);
  assert.match(js, /if \(!host\.isConnected\) \{ stop\(\); return; \}/, 'stops when its orb leaves the page');
  assert.match(js, /if \(frame\) window\.cancelAnimationFrame\(frame\);\s*frame = window\.requestAnimationFrame\(draw\);/, 'one loop only');
  assert.match(js, /removeEventListener\('visibilitychange', onVisibility\)/);
  assert.match(js, /removeEventListener\('change', onMotion\)/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /health-paused/);
  assert.ok(js.length < 6000, 'small');
});
