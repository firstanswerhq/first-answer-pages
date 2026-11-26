/**
 * high-tech-look Step 1C (Requirement 1.4, and the cards part of 1.11): listing cards. A soft glow on every card, a
 * stronger glow on Verified cards with the existing Verified stamp, a "Details AI can read: ..." line built only from
 * the listing's real fields, and a small lift on hover and keyboard focus that stops with reduced motion.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { listingCard, readableFields } from '../server/lib/html.js';

const CSS = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
const CATEGORIES = [{ slug: 'plumbers', label: 'Plumbers' }];
const FULL = {
  id: 'zephyr-plumbing-nashville', name: 'Zephyr Plumbing', category: 'plumbers', phone: '(615) 555-0142', city: 'Nashville',
  state: 'TN', services: ['Drain cleaning'], serviceArea: 'Nashville and nearby areas', hours: { monday: '8am-5pm' },
  address: '12 Main Street, Nashville, TN 37203', website: 'https://zephyr.example/',
};

test('1.4: "Details AI can read" lists only the fields the listing really has, in a fixed order', () => {
  assert.deepEqual(readableFields(FULL), ['phone', 'hours', 'services', 'area', 'address', 'website']);
  const thin = { ...FULL, hours: { monday: '', tuesday: '  ' }, services: ['', ' '], serviceArea: '', address: undefined, website: '' };
  assert.deepEqual(readableFields(thin), ['phone'], 'empty days, blank services and empty fields never count');
  assert.deepEqual(readableFields({ ...FULL, phone: '' }).includes('phone'), false);
  assert.deepEqual(readableFields({}), []);
  assert.deepEqual(readableFields(null), []);
  const card = listingCard(FULL, CATEGORIES);
  assert.ok(card.includes('<p class="listing-ai">Details AI can read: phone, hours, services, area, address, website</p>'));
  assert.ok(listingCard(thin, CATEGORIES).includes('<p class="listing-ai">Details AI can read: phone</p>'));
  // Nothing to list: no line at all (never an empty or made-up one).
  assert.equal(listingCard({ ...thin, phone: '' }, CATEGORIES).includes('listing-ai'), false);
});

test('1.4: a Verified card glows more and keeps the existing Verified stamp; others are as before', () => {
  const verified = listingCard(FULL, CATEGORIES, { trust: { verified: true, verifiedAt: '2026-11-12T09:00:00.000Z' } });
  assert.ok(verified.startsWith('<article class="listing-card is-verified">'));
  assert.ok(verified.includes('<p class="verified-badge"><span class="verified-badge-title">Verified</span></p>'));
  const plain = listingCard(FULL, CATEGORIES, { trust: { verified: false } });
  assert.ok(plain.startsWith('<article class="listing-card">'));
  assert.equal(plain.includes('verified-badge'), false);
  assert.ok(listingCard(FULL, CATEGORIES).startsWith('<article class="listing-card">'));
  // The card keeps its name link, phone and details link.
  for (const part of ['<a href="/listings/zephyr-plumbing-nashville">Zephyr Plumbing</a>', '<span class="phone">', 'View details →']) {
    assert.ok(verified.includes(part), part);
  }
});

test('1.4, 1.11: the card CSS: soft glow, stronger Verified glow, lift on hover and focus, none with reduced motion', () => {
  const block = CSS.slice(CSS.indexOf('high-tech-look Step 1C: listing cards'), CSS.indexOf('high-tech-look Step 1B: the open-book home page'));
  assert.ok(block.length > 500, 'the 1C block');
  assert.match(block, /\.listing-card \{[^}]*box-shadow: 0 0 12px var\(--color-glow-soft\);/);
  assert.match(block, /\.listing-card\.is-verified \{\s*border-color: var\(--color-primary\);\s*box-shadow: 0 0 20px var\(--color-glow\);/);
  assert.match(block, /\.listing-card:hover, \.listing-card:focus-within \{\s*transform: translateY\(-2px\);/);
  // Tokens only.
  assert.equal(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  // The "Details AI can read" line: 12 px, in a color that passes AA on the card (checked from the tokens in 1A).
  assert.match(block, /\.listing-card \.listing-ai \{[^}]*font: 600 0\.75rem/);
  assert.match(block, /\.listing-card \.listing-ai \{[^}]*color: var\(--color-success\);/);
  // Reduced motion: the cards don't lift (the transition is already off for everything).
  const reduced = CSS.slice(CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.listing-card:hover, \.listing-card:focus-within \{ transform: none !important; \}/);
  // The new token has a paper value for print.
  assert.match(CSS, /--color-glow-soft:\s*rgba\(56, 225, 255, 0\.12\);/);
  assert.match(/@media print \{\n  :root \{([\s\S]*?)\n  \}/.exec(CSS)?.[1] ?? '', /--color-glow-soft:/);
});
