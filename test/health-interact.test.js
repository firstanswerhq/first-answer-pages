/**
 * Step 1F-canvas: the interactive canvas overlay for the health map.
 * Tests the client JS (static checks) and CSS (class presence).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// ---- Client JS static checks ----

test('1F-canvas: health-interact.js is reasonably sized and respects reduced motion', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.ok(js.length < 16000, `health-interact.js should be under 16KB (is ${js.length})`);
  assert.match(js, /prefers-reduced-motion/, 'respects reduced motion');
  assert.match(js, /Escape/, 'handles Escape key');
  assert.match(js, /health-paused/, 'pauses the orb during drill-down');
  assert.match(js, /focus\(\)/, 'manages focus');
  assert.match(js, /MutationObserver/, 'reinitialises on DOM changes');
  assert.match(js, /requestAnimationFrame/, 'uses requestAnimationFrame for animation');
  assert.match(js, /aria-/, 'uses ARIA attributes');
});

test('1F-canvas: health-interact.js extracts model from DOM', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.match(js, /extractModel/, 'has extractModel function');
  assert.match(js, /data-main-id/, 'reads data-main-id attributes');
  assert.match(js, /data-drill-sub/, 'reads data-drill-sub attributes');
  assert.match(js, /health-drill-panel/, 'reads drill panel content');
});

test('1F-canvas: health-interact.js has proper geometry matching SVG layout', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.match(js, /polar/, 'has polar coordinate function');
  assert.match(js, /nodePositions/, 'has nodePositions layout function');
  // Uses the same layout constants as the SVG map
  assert.match(js, /280/, 'uses rMain radius matching SVG');
  assert.match(js, /1000/, 'uses 1000-unit coordinate system matching SVG viewBox');
});

test('1F-canvas: health-interact.js has hit testing for interactivity', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.match(js, /getNodeAt/, 'has hit-testing function');
  assert.match(js, /click/, 'handles click events');
  assert.match(js, /mousemove/, 'handles mousemove for cursor feedback');
});

test('1F-canvas: health-interact.js has neon sci-fi colour palette', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.match(js, /COLORS/, 'defines colour palette');
  assert.match(js, /good.*partly.*missing/s, 'has status colours');
  assert.match(js, /67[Ee]8[Ff]9/, 'uses cyan glow colour');
});

test('1F-canvas: health-interact.js has animation drawing functions', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.match(js, /drawActiveNode/, 'has active node drawing');
  assert.match(js, /drawSubNodes/, 'has sub-node drawing');
  assert.match(js, /pulseAngle/, 'has pulse animation');
  assert.match(js, /subOrbitAngle/, 'has orbital animation for sub-nodes');
  assert.match(js, /lineWidth/, 'uses line width for emphasis');
});

test('1F-canvas: health-interact.js has panel overlay for sub-check details', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.match(js, /showPanel/, 'has showPanel function');
  assert.match(js, /hidePanel/, 'has hidePanel function');
  assert.match(js, /interact-panel/, 'creates panel overlay element');
  assert.match(js, /role.*dialog/s, 'panel has dialog role');
});

test('1F-canvas: health-interact.js wires into SVG node links', async () => {
  const js = await fs.readFile(fileURLToPath(new URL('../public/js/health-interact.js', import.meta.url)), 'utf8');
  assert.match(js, /health-node-link/, 'hooks into SVG node link clicks');
  assert.match(js, /data-main/, 'reads main node IDs from SVG');
});

// ---- CSS static checks ----

test('1F-canvas: style.css has interactive overlay classes', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  assert.match(css, /\.interact-panel\b/, 'has .interact-panel');
  assert.match(css, /\.interact-panel-inner/, 'has .interact-panel-inner');
  assert.match(css, /\.interact-panel-close/, 'has .interact-panel-close');
  assert.match(css, /\.interact-panel-title/, 'has .interact-panel-title');
  assert.match(css, /\.interact-dot/, 'has .interact-dot status indicators');
  assert.match(css, /\.interact-panel-body/, 'has .interact-panel-body');
  assert.match(css, /backdrop-filter/, 'uses backdrop blur for panel overlay');
});

// ---- Server-side wiring check ----

test('1F-canvas: grade-html.js exports HEALTH_INTERACT_SCRIPT', async () => {
  const src = await fs.readFile(fileURLToPath(new URL('../server/lib/grade-html.js', import.meta.url)), 'utf8');
  assert.match(src, /HEALTH_INTERACT_SCRIPT/, 'exports HEALTH_INTERACT_SCRIPT');
  assert.match(src, /health-interact\.js/, 'points to the correct file');
});
