/**
 * high-tech-look Requirement 2.10: the one-time scan when the health map first comes into view. The final state is the
 * normal map; it never shows a status the list does not show or a final number other than the score; reduced motion,
 * a hidden tab or no JavaScript means no scan; it runs once per page load. The script is read as a plain module here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { scanPlan, shouldScan, SCAN_MS, SCAN_TARGET, SCAN_THRESHOLD, PRINT_PAGE } from '../public/js/health-scan.js';
import {
  scanPage, printPage, reportPage, HEALTH_SCAN_SCRIPT, HEALTH_ORB_SCRIPT, markedAnswer,
} from '../server/lib/grade-html.js';
import { healthModel, healthMapHtml, MAIN_NODES } from '../server/lib/health-map.js';

const NODES = MAIN_NODES.map(n => ({ id: n.id, caption: `${n.name}: Good` }));

test('2.10.1: the main nodes light up one at a time in a fixed order, in about 3 seconds, and the center counts up', () => {
  const steps = scanPlan(NODES, 68);
  assert.equal(SCAN_MS, 3000);
  assert.equal(steps.length, NODES.length + 1);
  steps.slice(0, -1).forEach((s, i) => {
    assert.deepEqual(s.lit, NODES.slice(0, i + 1).map(n => n.id), 'one more each step, in the fixed order');
    assert.equal(s.caption, NODES[i].caption, 'the caption names the check that just lit up');
    if (i > 0) assert.ok(s.at > steps[i - 1].at);
    if (i > 0) assert.ok(s.count >= steps[i - 1].count, 'counts up');
    assert.ok(s.count <= 68, 'never past the score');
  });
  assert.ok(steps[steps.length - 1].at <= 3500);
});

test('2.10.2, 2.10.4: the final state equals the no-scan state: every node lit, no caption, exactly the score', () => {
  for (const score of [0, 1, 68, 100, null]) {
    const last = scanPlan(NODES, score).at(-1);
    assert.deepEqual(last.lit, NODES.map(n => n.id));
    assert.equal(last.caption, '');
    assert.equal(last.count, score);
  }
  // The captions are the nodes' own words, so the scan never says anything the list doesn't.
  const html = healthMapHtml(healthModel({ input: { name: 'Zephyr Plumbing' }, results: [] }, { score: 68 }));
  const titles = [...html.matchAll(/<g class="health-node health-node-\w+" data-name="[^"]+"><title>([^<]+)<\/title>/g)].map(m => m[1]);
  assert.equal(titles.length, 14, 'seven nodes in each of the two drawings');
  for (const t of titles.slice(0, 7)) {
    const [name, label] = t.split(': ');
    assert.ok(html.includes(`<span class="health-group-name">${name}:</span> <span class="health-status">${label}</span>`), t);
  }
  assert.equal(scanPlan([], 50).length, 1);
});

test('2.10.3, 2.10.4: reduced motion, a hidden tab or no observer skip the scan; it runs once', () => {
  assert.equal(shouldScan({}), true);
  assert.equal(shouldScan({ reducedMotion: true }), false);
  assert.equal(shouldScan({ hidden: true }), false);
  assert.equal(shouldScan({ hasObserver: false }), false);
  assert.equal(shouldScan({ played: true }), false, 'once per page load');
});

test('batch 3 X1: the scan watches the map itself, at a share of it that always fits on screen', async () => {
  assert.equal(SCAN_TARGET, '.health-map');
  // The map is about 564 px tall on desktop and 387 px on phones, so 0.6 or less of it always fits on screen.
  assert.ok(SCAN_THRESHOLD > 0 && SCAN_THRESHOLD <= 0.6, String(SCAN_THRESHOLD));
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.match(js, /section\.querySelector\(SCAN_TARGET\)/);
  assert.match(js, /observer\.observe\(target\)/);
  assert.match(js, /\{ threshold: SCAN_THRESHOLD \}/);
  assert.equal(/observer\.observe\(section\)/.test(js), false, 'never the tall section with its list');
});

test('batch 3 X2: the Checking page loads the scan, which waits for the report to be swapped in, and plays once', async () => {
  const html = scanPage({ id: 'g1', input: { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' }, steps: [] });
  assert.ok(html.includes(`<script type="module" src="${HEALTH_SCAN_SCRIPT}"></script>`));
  assert.ok(html.includes(`<script type="module" src="${HEALTH_ORB_SCRIPT}"></script>`));
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.match(js, /new MutationObserver\(/);
  assert.match(js, /observe\(document\.body, \{ childList: true, subtree: true \}\)/);
  assert.match(js, /waiting\.disconnect\(\)/);
  assert.match(js, /if \(!played && !waiting/, 'a later swap never replays it');
});

test('batch 4 Y2: the print page never loads the scan; the script also stops on the print page and before printing', async () => {
  const g = {
    id: 'print000000000000000001', status: 'done', createdAt: '2026-11-24T18:00:00.000Z', finishedAt: '2026-11-24T18:00:00.000Z',
    input: { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' },
    ai: [], results: [], steps: [], facts: null, found: { phone: '', address: '', hours: [] }, score: null,
    aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' },
  };
  const print = printPage(g);
  assert.equal(print.includes(HEALTH_SCAN_SCRIPT), false, 'no scan script on the print page');
  assert.ok(print.includes('grade-print'));
  assert.ok(reportPage(g, { leadGate: false }).includes(`<script type="module" src="${HEALTH_SCAN_SCRIPT}"></script>`), 'the report still has it');
  assert.equal(PRINT_PAGE, '.grade-print');
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.match(js, /if \(document\.querySelector\(PRINT_PAGE\)\) return;/);
  assert.match(js, /addEventListener\?\.\('beforeprint'/);
  assert.match(js, /stopScan = finish;/);
});

test('batch 5 K20: during the scan the center keeps the real score; circles not lit yet stay readable', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.equal(/textContent = `Score \$\{step\.count\}/.test(js), false, 'the scan never writes a counting score');
  assert.match(js, /t\.textContent = original\[i\]/, 'the score text is still put back as the server wrote it');
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const dim = Number(/\.health-scanning \.health-branch \{ opacity: ([\d.]+);/.exec(css)?.[1]);
  assert.ok(dim >= 0.4, `dimmed to ${dim}`);
});

test('batch 4 Y6: a swapped-in map is watched instead of the removed one, until the scan has played', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.match(js, /if \(!now \|\| now === watched\) return;/, 'a new .health node is noticed');
  assert.match(js, /if \(observer\) observer\.disconnect\(\);/, 'the old map is no longer watched');
  assert.match(js, /watched = section;/);
  assert.match(js, /if \(!section\.isConnected \|\| document\.querySelector\(PRINT_PAGE\)\) return;/);
  // Once played, nothing waits any more, so a later swap never replays it.
  assert.match(js, /stopWaiting\(\);\s*\/\/ Checked again/);
});

test('batch 3 X12: the scan clears its timers and its motion listener; the caption keeps one height', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.match(js, /for \(const t of timers\) window\.clearTimeout\(t\)/);
  assert.match(js, /removeEventListener\?\.\('change', onMotion\)/);
  assert.match(js, /timers\.push\(window\.setTimeout\(/);
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  assert.equal(css.includes('.health-caption:empty'), false, 'no rule that changes its height when it empties');
  assert.match(css, /\.health-caption \{[^}]*min-height: 1\.4em;/);
});

test('batch 3 X13 (J3): the business name is marked in the answers that named it, after escaping', () => {
  const input = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers' };
  const named = { named: true, position: 1, total: 2, answer: '1. Zephyr Plumbing\n2. Other Co & Sons\nCall <b>fast</b>.' };
  const out = markedAnswer(named, input);
  assert.ok(out.includes('<mark>Zephyr Plumbing</mark>'));
  assert.ok(out.includes('&lt;b&gt;fast&lt;/b&gt;'), 'the answer is still escaped');
  assert.ok(out.includes('Other Co &amp; Sons'));
  assert.equal((out.match(/<mark>/g) ?? []).length, 1);
  // Not named: shown plain. A name that is only part of a word is not marked.
  assert.equal(markedAnswer({ ...named, named: false }, input).includes('<mark>'), false);
  assert.equal(markedAnswer({ named: true, position: 1, total: 1, answer: 'Amp & Co' }, { name: 'amp' }).includes('&<mark>'), false);
  // A name with markup in it is escaped before it is matched.
  const odd = markedAnswer({ named: true, position: 1, total: 1, answer: '1. Joe\'s <Pipes>' }, { name: 'Joe\'s <Pipes>' });
  assert.ok(odd.includes('<mark>Joe&#39;s &lt;Pipes&gt;</mark>'));
});

test('2.10: the page has the pieces the scan needs; the caption is aria-hidden; without the script nothing is hidden', async () => {
  const html = healthMapHtml(healthModel({ input: { name: 'Zephyr Plumbing' }, results: [] }, { score: 68 }));
  assert.match(html, /<p class="health-caption" aria-hidden="true" data-health-caption><\/p>/);
  assert.equal((html.match(/<g class="health-branch" data-main="/g) ?? []).length, 14);
  assert.match(html, /class="health-orb-score" data-score="68">Score 68\/100</);
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  // Only the class the script adds while it plays dims the branches.
  // Batch 5 K20: dimmed, but never so dim that a circle looks switched off.
  assert.match(css, /\.health-scanning \.health-branch \{ opacity: 0\.45;/);
  assert.equal(/(?<!health-scanning )\.health-branch \{[^}]*opacity: 0/.test(css.replace(/\.health-scanning \.health-branch \{[^}]*\}/g, '')), false);
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.health-scanning \.health-branch \{ opacity: 1; transition: none; \}/);
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.match(js, /section\.classList\.remove\('health-scanning'\)/, 'the final state takes the class off');
  assert.match(js, /t\.textContent = original\[i\]/, 'the score text is put back as the server wrote it');
  assert.match(js, /played = true/);
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write|fetch\(/.test(js), false, 'adds no report content');
});
