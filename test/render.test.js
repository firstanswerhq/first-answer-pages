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
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, layout, listingDetail, quoteForm } from '../server/lib/html.js';
import { buildSchema } from '../server/lib/schema.js';
import { createApp } from '../server/app.js';
import { createMockNotifier } from '../server/lib/notifier.js';
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
// 3. Listing_Page and quote result page
// ---------------------------------------------------------------------------

function buildListing(v) {
  return {
    id: 'l-1',
    name: v.name,
    category: 'plumbers',
    phone: v.phone,
    services: v.services,
    serviceArea: v.serviceArea,
    description: v.description,
    city: v.city,
    state: v.state,
    address: v.address,
    hours: Object.fromEntries(DAY_KEYS.map(d => [d, v.hour])),
  };
}

const BENIGN_LISTING = buildListing({
  name: 'Ben', phone: '555', services: ['Fix'], serviceArea: 'Town', description: 'Text',
  city: 'City', state: 'TN', address: '1 Main', hour: '9-5',
});

/** Renders the full listing page the way the route does (layout + JSON-LD + webmcp script). */
function fullListingPage(listing, categories, verification) {
  const jsonLd = JSON.stringify(buildSchema(listing, verification), null, 2);
  return layout({
    title: `${listing.name} | First Answer Pages`,
    body: listingDetail(listing, undefined, { categories, verification }) + '\n' + quoteForm(listing),
    jsonLd,
    scripts: ['/js/webmcp.js'],
  });
}

/** Returns the text inside the ld+json script block. */
function ldBlockText(html) {
  const open = '<script type="application/ld+json">';
  const start = html.indexOf(open);
  assert.ok(start >= 0, 'ld+json block missing');
  const end = html.indexOf('</script>', start);
  assert.ok(end > start, 'ld+json block not closed');
  return html.slice(start + open.length, end);
}

test('Property 26 (Listing_Page): body and JSON-LD escape every listing field and verification value', () => {
  // Validates: Requirements 14.4, 14.8
  const cats = [{ slug: 'plumbers', label: 'Plumbers' }];
  const fullBaseline = countScriptOpens(fullListingPage(BENIGN_LISTING, cats, null));
  const bodyBaseline = countScriptOpens(
    listingDetail(BENIGN_LISTING, undefined, { categories: cats, verification: null }) + quoteForm(BENIGN_LISTING),
  );

  fc.assert(
    fc.property(
      fc.record({
        name: arbDangerous, phone: arbDangerous, description: arbDangerous,
        services: fc.array(arbDangerous, { minLength: 1, maxLength: 3 }),
        serviceArea: arbDangerous, city: arbDangerous, state: arbDangerous,
        address: fc.oneof(arbDangerous, fc.constant('')),
        hour: arbDangerous,
      }),
      arbDangerous, // category label
      fc.option(fc.record({ verifiedDate: arbDangerous, hash: arbDangerous }), { nil: null }),
      (v, label, verification) => {
        const listing = buildListing(v);
        const categories = [{ slug: 'plumbers', label }];

        // Body only (no JSON-LD): full escaped-form assertions.
        const body = listingDetail(listing, undefined, { categories, verification }) + '\n' + quoteForm(listing);
        const shown = [v.name, v.phone, v.description, ...v.services, v.serviceArea, v.hour, label];
        // City and state are only rendered in the body when there is no street address.
        shown.push(...(v.address ? [v.address] : [v.city, v.state]));
        if (verification) shown.push(verification.verifiedDate, verification.hash);
        assertEscaped(body, shown, bodyBaseline);

        // Full page with JSON-LD in the head: values appear raw in JSON, so only check no markup leaks.
        const page = fullListingPage(listing, categories, verification);
        assert.ok(!page.includes('<b id="x">'), 'raw marker tag leaked into full page');
        assert.equal(countScriptOpens(page), fullBaseline, '<script count differs from template');
        assert.ok(!ldBlockText(page).includes('<'), 'JSON-LD contains a literal "<"');
        assert.ok(!/<\/script/i.test(ldBlockText(page)), 'JSON-LD contains a literal "</script"');
        assert.equal((page.match(/<\/script/gi) ?? []).length, fullBaseline, '</script count differs from template');
      },
    ),
    { numRuns: 100 },
  );
});

test('Property 26 (quote result pages): 422 page escapes echoed argument; sent page leaks no input', async () => {
  // Validates: Requirements 14.4, 14.8
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-render-'));
  const repoData = fileURLToPath(new URL('../data/', import.meta.url));
  for (const file of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(repoData, file), path.join(dir, file));
  }
  const app = createApp({
    dataDir: dir,
    config: { providerTimeoutMs: 1000 },
    notifier: createMockNotifier(),
    rateLimiter: { consume: () => ({ allowed: true }), consumeAll: () => ({ allowed: true }), size: () => 0 },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const listings = JSON.parse(await fs.readFile(path.join(dir, 'listings.json'), 'utf8'));
    const listingId = listings.find(l => l.id).id;
    const post = (form) => fetch(`${base}/listings/${encodeURIComponent(listingId)}/quote`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const goodForm = { name: 'Pat', contact: '615-555-0100', details: 'Fix a leak' };
    const sentBaseline = countScriptOpens(
      await (await fetch(`${base}/listings/${encodeURIComponent(listingId)}?quote=sent`)).text(),
    );

    await fc.assert(
      fc.asyncProperty(arbDangerous, arbDangerous, async (extraKey, text) => {
        // Unknown field name is echoed in the 422 message; it must be escaped.
        const bad = await post({ ...goodForm, [extraKey]: text });
        assert.equal(bad.status, 422);
        const badHtml = await bad.text();
        assert.ok(badHtml.includes(escapeHtml(extraKey)), 'escaped argument missing from 422 page');
        assert.ok(!badHtml.includes(extraKey), 'raw argument leaked into 422 page');
        assert.ok(!badHtml.includes('<b id="x">'), 'raw marker tag leaked into 422 page');
        assert.equal(countScriptOpens(badHtml), 0, '<script in 422 page');

        // Invalid contact with dangerous name/details: static message, nothing echoed raw.
        const badContact = await post({ name: text, contact: text, details: text });
        assert.equal(badContact.status, 422);
        const contactHtml = await badContact.text();
        assert.ok(!contactHtml.includes('<b id="x">'), 'raw marker tag leaked into contact 422 page');
        assert.equal(countScriptOpens(contactHtml), 0, '<script in contact 422 page');

        // Valid quote with dangerous name/details: redirect, then the sent page leaks nothing.
        const ok = await post({ name: text.slice(0, 90) || 'Pat', contact: '615-555-0100', details: text });
        assert.equal(ok.status, 303);
        const location = ok.headers.get('location');
        assert.ok(location?.endsWith('?quote=sent'), 'redirect lacks ?quote=sent');
        const sent = await fetch(`${base}${location}`);
        assert.equal(sent.status, 200);
        const sentHtml = await sent.text();
        assert.ok(sentHtml.includes('Quote request sent'), 'sent notice missing');
        assert.ok(!sentHtml.includes('<b id="x">'), 'raw marker tag leaked into sent page');
        assert.equal(countScriptOpens(sentHtml), sentBaseline, '<script count differs from template');
      }),
      { numRuns: 30 },
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. Seance report (task 9.7 extends here)
// ---------------------------------------------------------------------------
