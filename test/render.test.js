/**
 * render.test.js — Property 26: rendered values are escaped.
 *
 * Sections:
 *   1. Shared helpers and generators
 *   2. Rise pages (reviewPage, messagePage)
 *   3. Listing_Page and quote result page (added by task 7.4)
 *   4. Seance report (added by task 9.7)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { escapeHtml } from '../server/lib/html.js';
import { reviewPage, messagePage } from '../server/lib/rise-html.js';

// ---------------------------------------------------------------------------
// 1. Shared helpers and generators
// ---------------------------------------------------------------------------

const MARKER = '<b id="x">\'&`';

const DANGEROUS_SNIPPETS = [
  '<script>', '</script>', '<script>alert(1)</script>', '"', "'", '&', '&amp;',
  '`', '<', '>', 'onerror=', '<img src=x onerror=alert(1)>', '" onfocus="alert(1)',
];

/** Arbitrary string that always starts with MARKER and mixes in dangerous snippets. */
const arbDangerous = fc
  .array(
    fc.oneof(fc.constantFrom(...DANGEROUS_SNIPPETS), fc.string({ maxLength: 12 })),
    { maxLength: 6 },
  )
  .map(parts => MARKER + parts.join(''));

/** Counts case-insensitive occurrences of "<script" in html. */
function countScriptOpens(html) {
  return (html.match(/<script/gi) ?? []).length;
}

/**
 * Asserts that every value appears in escaped form and that no raw markup from
 * the value leaked: the marker tag is absent and the "<script" count equals the
 * template's own count (baseline).
 */
function assertEscaped(html, values, baselineScripts) {
  for (const v of values) {
    assert.ok(html.includes(escapeHtml(v)), `missing escaped form of ${JSON.stringify(v)}`);
    assert.ok(!html.includes(v), `raw value leaked: ${JSON.stringify(v)}`);
  }
  assert.ok(!html.includes('<b id="x">'), 'raw marker tag leaked');
  assert.equal(countScriptOpens(html), baselineScripts, '<script count differs from template');
}

// ---------------------------------------------------------------------------
// 2. Rise pages
// ---------------------------------------------------------------------------

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function buildDraft(v) {
  return {
    id: 'draft-1',
    fields: {
      name: v.name,
      category: 'plumbers',
      phone: v.phone,
      services: [v.service],
      serviceArea: v.serviceArea,
      description: v.description,
      city: v.city,
      state: v.state,
      address: v.address,
      hours: Object.fromEntries(DAY_KEYS.map(d => [d, v.hour])),
    },
    missingFields: [],
  };
}

const BENIGN = {
  name: 'Ben', phone: '555', service: 'Fix', serviceArea: 'Town', description: 'Text',
  city: 'City', state: 'TN', address: '1 Main', hour: '9-5',
};

test('Property 26 (Rise): reviewPage escapes every draft field, category label, and notice', () => {
  // Validates: Requirements 4.12
  const baseline = countScriptOpens(reviewPage(buildDraft(BENIGN), [{ slug: 'plumbers', label: 'Plumbers' }]));

  fc.assert(
    fc.property(
      fc.record({
        name: arbDangerous, phone: arbDangerous, service: arbDangerous, serviceArea: arbDangerous,
        description: arbDangerous, city: arbDangerous, state: arbDangerous, address: arbDangerous,
        hour: arbDangerous,
      }),
      arbDangerous, // category label
      arbDangerous, // notice
      (v, label, notice) => {
        const html = reviewPage(buildDraft(v), [{ slug: 'plumbers', label }], { notice });
        assertEscaped(html, [...Object.values(v), label, notice], baseline);
      },
    ),
    { numRuns: 100 },
  );
});

test('Property 26 (Rise): messagePage escapes title, message, and link text', () => {
  // Validates: Requirements 4.12
  const baseline = countScriptOpens(messagePage('t', 'm'));

  fc.assert(
    fc.property(arbDangerous, arbDangerous, arbDangerous, arbDangerous, (title, message, text, href) => {
      const html = messagePage(title, message, { href, text });
      assertEscaped(html, [title, message, text, href], baseline);
    }),
    { numRuns: 100 },
  );
});

// ---------------------------------------------------------------------------
// 3. Listing_Page and quote result page (task 7.4 extends here)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 4. Seance report (task 9.7 extends here)
// ---------------------------------------------------------------------------
