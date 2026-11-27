/**
 * addon-fix-pack task 5: the existing fix kit's output is unchanged. `suggestedTitle`, `suggestedSummary`,
 * `jsonLdBlock`, `llmsDraft` and `robotsLines` must return exactly what they returned before the fix pack was added,
 * for the same input. If one of these fails, the kit changed: fix the code, not the expected text.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  suggestedTitle, suggestedSummary, jsonLdBlock, llmsDraft, robotsLines,
  PHONE_PLACEHOLDER, STREET_PLACEHOLDER, ZIP_PLACEHOLDER,
} from '../server/lib/fix-kit.js';

const block = data => `<script type="application/ld+json">\n${JSON.stringify(data, null, 2)}\n</script>`;

const FULL = {
  name: 'Acme Roofing', service: 'Roofers', city: 'Nashville', state: 'tn', phone: '(615) 555-0100',
  website: 'https://acme.example/', address: '12 Main Street, Nashville, TN 37203', hours: ['Mo-Fr 08:00-17:00'],
};
const SMALL = { name: 'Bob', service: 'HVAC repair', city: '', state: '' };
const POOLS = { name: 'Sun Pools', service: 'pool cleaning', city: 'Tampa', state: 'fl' };

test('guard: suggestedTitle', () => {
  assert.equal(suggestedTitle(FULL), 'Acme Roofing | Roofers in Nashville, TN');
  assert.equal(suggestedTitle(SMALL), 'Bob | HVAC repair');
  assert.equal(suggestedTitle(POOLS), 'Sun Pools | Pool cleaning in Tampa, FL');
  assert.equal(
    suggestedTitle({ name: 'Acme Roofing And Exteriors Of Middle Tennessee', service: 'roofers', city: 'Nashville', state: 'TN' }),
    'Acme Roofing And Exteriors Of Middle Tennessee | Nashville',
  );
});

test('guard: suggestedSummary', () => {
  assert.equal(suggestedSummary(FULL), 'Acme Roofing: roofers in Nashville, TN. Call (615) 555-0100 today. Serving Nashville and nearby areas.');
  assert.equal(suggestedSummary(SMALL), 'Bob: HVAC repair.');
  assert.equal(suggestedSummary(POOLS), 'Sun Pools: pool cleaning in Tampa, FL. Serving Tampa and nearby areas.');
});

test('guard: llmsDraft', () => {
  assert.equal(llmsDraft(FULL), [
    '# Acme Roofing', '', '> Acme Roofing: roofers in Nashville, TN.', '',
    '- Service: Roofers', '- Area: Nashville, TN', '- Phone: (615) 555-0100', '- Website: https://acme.example/',
    '- Hours: Mo-Fr 08:00-17:00',
  ].join('\n') + '\n');
  assert.equal(llmsDraft(SMALL), ['# Bob', '', '> Bob: HVAC repair.', '', '- Service: HVAC repair'].join('\n') + '\n');
});

test('guard: robotsLines', () => {
  assert.equal(robotsLines(['GPTBot', 'ClaudeBot', 'GPTBot', 'bad agent!']), 'User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /');
  assert.equal(robotsLines([]), '');
  assert.equal(robotsLines(undefined), '');
});

test('guard: jsonLdBlock with a full address', () => {
  assert.equal(jsonLdBlock(FULL), block({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Acme Roofing',
    telephone: '(615) 555-0100',
    url: 'https://acme.example/',
    address: {
      '@type': 'PostalAddress', streetAddress: '12 Main Street', addressLocality: 'Nashville', addressRegion: 'TN', postalCode: '37203',
    },
    openingHours: ['Mo-Fr 08:00-17:00'],
    areaServed: 'Nashville',
  }));
});

test('guard: jsonLdBlock with nothing but a name and a service', () => {
  assert.equal(jsonLdBlock(SMALL), block({
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: 'Bob', telephone: PHONE_PLACEHOLDER,
  }));
});

test('guard: jsonLdBlock with the report\'s placeholders, with and without a storefront', () => {
  assert.equal(jsonLdBlock(POOLS, { placeholders: true }), block({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Sun Pools',
    telephone: PHONE_PLACEHOLDER,
    address: {
      '@type': 'PostalAddress', streetAddress: STREET_PLACEHOLDER, addressLocality: 'Tampa', addressRegion: 'FL', postalCode: ZIP_PLACEHOLDER,
    },
    areaServed: 'Tampa',
  }));
  const sameAs = ['https://www.facebook.com/sunpools', 'http://bad.example', 'https://www.facebook.com/sunpools'];
  assert.equal(jsonLdBlock({ ...POOLS, noStorefront: true, sameAs }, { placeholders: true }), block({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: 'Sun Pools',
    telephone: PHONE_PLACEHOLDER,
    areaServed: 'Tampa, FL',
    sameAs: ['https://www.facebook.com/sunpools'],
  }));
});

test('guard: an `about` passed to the kit changes nothing in it', () => {
  const about = { ...FULL, about: 'We fix roofs and gutters' };
  assert.equal(suggestedTitle(about), suggestedTitle(FULL));
  assert.equal(suggestedSummary(about), suggestedSummary(FULL));
  assert.equal(jsonLdBlock(about), jsonLdBlock(FULL));
  assert.equal(llmsDraft(about), llmsDraft(FULL));
});
