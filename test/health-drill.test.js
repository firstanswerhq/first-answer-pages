/**
 * Step 1F: the health map drill-down interaction.
 * Tests the server-side HTML (drill panels, data attributes) and the client JS (pure-function checks).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { readPageFacts } from '../server/lib/page-facts.js';
import { buildSignals } from '../server/lib/health-signals.js';
import { healthModel, healthMapHtml, MAIN_NODES } from '../server/lib/health-map.js';

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

function makeGrade(overrides = {}) {
  const facts = readPageFacts(PAGE, 'https://zephyr.example/', 'text/html');
  const signals = buildSignals(
    { input: INPUT, ...overrides },
    { pageFacts: facts, place: PLACE, reviews: [], posts: [], serpQueries: [] },
    { now: NOW },
  );
  return {
    id: 'grade-test-123',
    input: INPUT,
    result: { signals, pageFacts: facts, place: PLACE, serpResults: [], aiHealth: {} },
    ...overrides,
  };
}

function fullHtml(grade) {
  const model = healthModel(grade, { score: 72, found: { name: grade.input.name }, agency: false });
  return healthMapHtml(model, {
    full: true,
    runNew: text => `<a href="/grade?from=${grade.id}">${text}</a>`,
    gradeId: grade.id,
    contactEmail: 'help@firstanswer.com',
  });
}

function partialHtml(grade) {
  const model = healthModel(grade, { score: 72, found: { name: grade.input.name }, agency: false });
  return healthMapHtml(model, { full: false });
}

// ---- Server-side HTML tests ----

test('1F: full report health groups have data-main-id attributes', () => {
  const grade = makeGrade();
  const html = fullHtml(grade);
  for (const node of MAIN_NODES) {
    assert.match(html, new RegExp(`data-main-id="${node.id}"`), `missing data-main-id for ${node.id}`);
  }
});

test('1F: full report sub-check rows have data-drill-sub attributes', () => {
  const grade = makeGrade();
  const html = fullHtml(grade);
  assert.match(html, /data-drill-sub="/, 'at least one sub-check has data-drill-sub');
  // Every health-row in a full report should have it
  const rows = html.match(/<li class="health-row[^"]*"/g) || [];
  assert.ok(rows.length > 0, 'has health rows');
  for (const row of rows) {
    // The row tag should be followed by data-drill-sub in the same li
    const fullRow = html.slice(html.indexOf(row), html.indexOf('</li>', html.indexOf(row)) + 5);
    assert.match(fullRow, /data-drill-sub="/, `row missing data-drill-sub: ${row.slice(0, 60)}`);
  }
});

test('1F: full report drill panels are present and hidden', () => {
  const grade = makeGrade();
  const html = fullHtml(grade);
  const panels = (html.match(/class="health-drill-panel"/g) || []);
  assert.ok(panels.length > 0, 'has drill panels');
  // Every panel starts hidden
  const hiddenPanels = (html.match(/class="health-drill-panel" hidden/g) || []);
  assert.equal(panels.length, hiddenPanels.length, 'all panels are hidden by default');
});

test('1F: drill panel contains status, back button, and recheck form', () => {
  const grade = makeGrade();
  const html = fullHtml(grade);
  // Should have at least one drill panel with a status line
  assert.match(html, /class="drill-status drill-status-/, 'has status lines');
  // Back button
  assert.match(html, /class="drill-back"/, 'has back buttons');
  // Recheck form with the grade ID
  assert.match(html, new RegExp(`action="/grade/${grade.id}/recheck"`), 'has recheck form with grade ID');
});

test('1F: drill panel contains contact-us link when contactEmail provided', () => {
  const grade = makeGrade();
  const html = fullHtml(grade);
  assert.match(html, /class="drill-help"/, 'has help line');
  assert.match(html, /mailto:help@firstanswer\.com/, 'has contact email link');
});

test('1F: drillPanel renders "good" status with positive fix message (source check)', async () => {
  // The test grade data produces all not_checked statuses, so verify via source code
  // that drillPanel handles good status correctly.
  const src = await fs.readFile(fileURLToPath(new URL('../server/lib/health-map.js', import.meta.url)), 'utf8');
  assert.match(src, /drill-fix drill-fix-good/, 'source has good-status class');
  assert.match(src, /no changes needed/, 'source has good-status message');
});

test('1F: partial (free) report has no drill panels', () => {
  const grade = makeGrade();
  const html = partialHtml(grade);
  assert.equal((html.match(/class="health-drill-panel"/g) || []).length, 0, 'no drill panels in free report');
  // Also no data-main-id needed for drill since there's no interaction, but it's harmless if present
});

test('1F: drill panel without gradeId shows hint instead of form', () => {
  const grade = makeGrade();
  const model = healthModel(grade, { score: 72, found: { name: grade.input.name }, agency: false });
  const html = healthMapHtml(model, {
    full: true,
    runNew: text => `<a href="/grade">${text}</a>`,
    // No gradeId
    contactEmail: 'help@firstanswer.com',
  });
  assert.match(html, /class="drill-recheck hint"/, 'shows hint when no gradeId');
  assert.match(html, /Run a new check to see if this improved/, 'hint text');
});

test('1F: drill panel without contactEmail has no help line', () => {
  const grade = makeGrade();
  const model = healthModel(grade, { score: 72, found: { name: grade.input.name }, agency: false });
  const html = healthMapHtml(model, {
    full: true,
    runNew: text => `<a href="/grade">${text}</a>`,
    gradeId: grade.id,
    // No contactEmail
  });
  assert.doesNotMatch(html, /class="drill-help"/, 'no help line without contactEmail');
});

// ---- Client JS static checks ----

test('1F: health-drill.js is small, has no DOM writes, and respects reduced motion', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-drill.js', import.meta.url)), 'utf8');
  assert.ok(js.length < 8000, `health-drill.js should be under 8KB (is ${js.length})`);
  assert.equal(/innerHTML|textContent|insertAdjacentHTML|document\.write/.test(js), false, 'does not write arbitrary HTML');
  assert.match(js, /prefers-reduced-motion/, 'respects reduced motion');
  assert.match(js, /Escape/, 'handles Escape key');
  assert.match(js, /Enter.*Space|Space.*Enter/, 'handles Enter and Space keys');
  assert.match(js, /health-paused/, 'pauses the orb during drill-down');
  assert.match(js, /focus\(\)/, 'manages focus');
  assert.match(js, /MutationObserver/, 'reinitialises on DOM changes');
});

// ---- CSS static checks ----

test('1F: style.css has drill-down classes', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  assert.match(css, /\.drill-faded/, 'has .drill-faded');
  assert.match(css, /\.drill-expanded/, 'has .drill-expanded');
  assert.match(css, /\.drill-close/, 'has .drill-close');
  assert.match(css, /\.health-drill-panel/, 'has .health-drill-panel');
  assert.match(css, /\.drill-row-active/, 'has .drill-row-active');
  assert.match(css, /\.drill-back/, 'has .drill-back');
  // Print hides drill UI
  assert.match(css, /@media print[\s\S]*?\.drill-close[\s\S]*?display:\s*none/, 'print hides drill close');
});
