/**
 * high-tech-look Requirement 2.10: the one-time scan when the health map first comes into view. The final state is the
 * normal map; it never shows a status the list does not show or a final number other than the score; reduced motion,
 * a hidden tab or no JavaScript means no scan; it runs once per page load. The script is read as a plain module here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { scanPlan, shouldScan, SCAN_MS } from '../public/js/health-scan.js';
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

test('2.10: the page has the pieces the scan needs; the caption is aria-hidden; without the script nothing is hidden', async () => {
  const html = healthMapHtml(healthModel({ input: { name: 'Zephyr Plumbing' }, results: [] }, { score: 68 }));
  assert.match(html, /<p class="health-caption" aria-hidden="true" data-health-caption><\/p>/);
  assert.equal((html.match(/<g class="health-branch" data-main="/g) ?? []).length, 14);
  assert.match(html, /class="health-orb-score" data-score="68">Score 68\/100</);
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  // Only the class the script adds while it plays dims the branches.
  assert.match(css, /\.health-scanning \.health-branch \{ opacity: 0\.12;/);
  assert.equal(/(?<!health-scanning )\.health-branch \{[^}]*opacity: 0/.test(css.replace(/\.health-scanning \.health-branch \{[^}]*\}/g, '')), false);
  const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.health-scanning \.health-branch \{ opacity: 1; transition: none; \}/);
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-scan.js', import.meta.url)), 'utf8');
  assert.match(js, /section\.classList\.remove\('health-scanning'\)/, 'the final state takes the class off');
  assert.match(js, /t\.textContent = original\[i\]/, 'the score text is put back as the server wrote it');
  assert.match(js, /played = true/);
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write|fetch\(/.test(js), false, 'adds no report content');
});
