/**
 * high-tech-look Step 1A (Requirement 1.1, 1.5, 1.6, 1.7): the dark theme on every page, read from the stylesheet.
 * Colors are tokens in one :root block; the theme block names no color; every text and button pair meets WCAG AA;
 * no text is under 12 px; reduced motion stops everything; nothing forces a page wider than 390 px; the health map keeps
 * its own colors; print uses paper colors.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CSS = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
const THEME_START = 'high-tech-look Step 1A: the dark theme on every page';

/** The first :root block's tokens (the one place for colors). */
function rootTokens() {
  const start = CSS.indexOf(':root {');
  const block = CSS.slice(start, CSS.indexOf('\n}', start));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
}

/** WCAG relative luminance of a #RRGGBB color. */
function luminance(hex) {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test('1.1: every color is a token in the one :root block, and the theme block names no color', () => {
  const t = rootTokens();
  for (const name of ['--color-page-bg', '--color-surface', '--color-text', '--color-text-muted', '--color-primary', '--color-accent', '--color-gold', '--color-focus']) {
    assert.ok(t[name], name);
  }
  // Near-black, with the one glow color (cyan), the accent (pink) and the highlight (amber).
  assert.ok(luminance(t['--color-page-bg']) < 0.01, 'near-black page');
  assert.equal(t['--color-primary'].toUpperCase(), '#38E1FF');
  assert.equal(t['--color-accent'].toUpperCase(), '#FF4FA3');
  assert.equal(t['--color-gold'].toUpperCase(), '#FFB547');
  // Only one :root block sets colors; the other one keeps only the radius.
  const roots = [...CSS.matchAll(/(^|\n)(?:  )?:root \{([^}]*)\}/g)].map(m => m[2]);
  const withColors = roots.filter(b => /--color-[\w-]+:/.test(b));
  assert.equal(withColors.length, 2, 'the screen tokens, and their paper values for print');
  assert.ok(CSS.includes('@media print {\n  :root {'), 'the paper values sit in the print block right after');
  // The theme block uses var() only: no hex, rgb or hsl color, and no named color.
  const theme = CSS.slice(CSS.indexOf(THEME_START), CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.ok(theme.length > 1000, 'the theme block is there');
  const noComments = theme.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|:\s*(?:white|black)\b/.test(noComments), false, 'no literal color in the theme block');
});

test('1.5: text and buttons meet WCAG AA on the dark background, and outlines and field borders show (3:1)', () => {
  const t = rootTokens();
  const text = [
    ['--color-text', '--color-page-bg'], ['--color-text', '--color-surface'], ['--color-text', '--color-surface-2'],
    ['--color-text', '--color-input-bg'], ['--color-text', '--color-tan'],
    ['--color-text-muted', '--color-page-bg'], ['--color-text-muted', '--color-surface'], ['--color-text-muted', '--color-surface-2'],
    ['--color-text-muted', '--color-tan'],
    ['--color-link', '--color-page-bg'], ['--color-link', '--color-surface'], ['--color-link', '--color-surface-2'], ['--color-link', '--color-tan'],
    ['--color-button-text', '--color-primary'], ['--color-button-text', '--color-primary-hover'],
    ['--color-success', '--color-surface'], ['--color-success', '--color-success-bg'],
    ['--color-fail', '--color-surface'], ['--color-fail', '--color-fail-bg'],
    ['--color-partly-text', '--color-surface'], ['--color-partly-text', '--color-partly-bg'],
    ['--color-warn', '--color-surface'], ['--color-warn', '--color-warn-bg'], ['--color-text', '--color-warn-bg'],
    ['--color-gold', '--color-page-bg'], ['--color-gold', '--color-surface'],
    ['--color-mark-text', '--color-mark-bg'], ['--color-serp-title', '--color-surface-2'], ['--color-serp-url', '--color-surface-2'],
    ['--color-ink', '--color-surface'], ['--color-text', '--color-success-bg'],
    ['--color-partly', '--color-surface'], ['--color-partly', '--color-surface-2'],
  ];
  for (const [fg, bg] of text) {
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(ratio >= 4.5, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
  }
  for (const [fg, bg] of [['--color-focus', '--color-page-bg'], ['--color-focus', '--color-surface'], ['--color-divider', '--color-surface'],
    ['--color-divider', '--color-input-bg'], ['--color-divider', '--color-page-bg']]) {
    const ratio = contrast(t[fg], t[bg]);
    assert.ok(ratio >= 3, `${fg} on ${bg}: ${ratio.toFixed(2)}`);
  }
  // Focus outlines are drawn with the focus token on every control.
  assert.match(CSS, /a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible \{\s*outline: 3px solid var\(--color-focus\);/);
});

test('1.5: no text on the site is smaller than 12 px', () => {
  const sizes = [...CSS.matchAll(/font-size:\s*([^;}]+)/g)].map(m => m[1].trim());
  assert.ok(sizes.length > 50);
  const px = value => {
    const m = /^(-?[\d.]+)(px|rem|em)$/.exec(value.replace(/\s*!important$/, ''));
    if (!m) return null;
    return m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16;
  };
  for (const raw of sizes) {
    const value = raw.replace(/\s*\/\*.*$/, '').trim();
    if (value === '0') continue; // the "out of 100" text drawn as "/ 100" by ::after at a large size
    const first = value.startsWith('clamp(') ? value.slice(6).split(',')[0].trim() : value;
    const size = px(first);
    if (size === null) continue; // inherit, %, vw and the like
    assert.ok(size >= 12, `font-size: ${raw}`);
  }
  assert.equal(/font-size:\s*(?:smaller|x-small|xx-small)/.test(CSS), false);
});

test('1.6: with reduced motion nothing on the site moves', () => {
  const reduced = CSS.slice(CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\*, \*::before, \*::after \{ animation: none !important; transition: none !important; scroll-behavior: auto !important; \}/);
  // The health map's own rules stay (2.4, 2.8, 2.10.3).
  assert.match(reduced, /\.health-flow \{ animation: none; display: none; \}/);
  assert.match(reduced, /\.health-scanning \.health-branch \{ opacity: 1; transition: none; \}/);
});

test('1.7: nothing forces a page wider than 390 px', () => {
  assert.match(CSS, /pre, table, img, svg, video \{ max-width: 100%; \}/);
  assert.match(CSS, /main \{ min-width: 0; overflow-wrap: anywhere; \}/);
  // Fixed widths and minimum widths in px (media query conditions, which start with "(", are not widths).
  for (const m of CSS.matchAll(/(?<![\w(-])(min-width|width):\s*(\d+)px/g)) {
    assert.ok(Number(m[2]) <= 390, `${m[1]}: ${m[2]}px`);
  }
});

test('the health map keeps its own colors, and print uses paper colors', () => {
  assert.match(CSS, /\.health \{\s*--health-panel: #0B1020;/);
  const paper = /@media print \{\n  :root \{([\s\S]*?)\n  \}/.exec(CSS)?.[1] ?? '';
  const t = Object.fromEntries([...paper.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
  assert.equal(t['--color-page-bg'], '#FFFFFF');
  assert.ok(contrast(t['--color-text'], t['--color-page-bg']) >= 4.5);
  assert.ok(contrast(t['--color-text-muted'], t['--color-page-bg']) >= 4.5);
  assert.ok(contrast(t['--color-link'], t['--color-page-bg']) >= 4.5);
  // Every screen color token has a paper value, so nothing prints light on white.
  const screen = rootTokens();
  for (const name of Object.keys(screen).filter(n => n.startsWith('--color-') && !['--color-accent', '--color-glow', '--color-partly-pill'].includes(n))) {
    assert.ok(t[name], `${name} has a paper value`);
  }
});
