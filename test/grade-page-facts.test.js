import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readPageFacts, HOURS_PATTERN, STREET_PATTERN, CTA_PATTERN } from '../server/lib/page-facts.js';

const MIB2 = 2 * 1024 * 1024;

const fragment = fc.constantFrom(
  '<', '>', '<a', '<a href="tel:6155550100">', '</a>', '<script', '<script type="application/ld+json">',
  '</script>', '<!--', '-->', '<h1>', '</h1>', '<title>', '</title>', '<img ', 'alt=""', '<meta name="description" content="',
  '"', "'", '&amp;', '&#0;', '&#x110000;', '{"@type":"Roofer"', '}', '<button>', '</button>', '<style', '<svg', '\n', ' ',
);
const messyHtml = fc.array(fc.oneof(fragment, fc.string({ maxLength: 40 })), { maxLength: 400 }).map(p => p.join(''));

// Feature: ai-visibility-grader, Property 4: Page reading never throws and stays fast
test('Property 4: reading any page never throws and returns the full shape', () => {
  fc.assert(fc.property(messyHtml, html => {
    const f = readPageFacts(html);
    assert.equal(typeof f.title, 'string');
    assert.equal(typeof f.text, 'string');
    assert.ok(Array.isArray(f.h1s) && Array.isArray(f.telLinks) && Array.isArray(f.ctaLabels));
    assert.ok(f.imgMissingAlt <= f.imgCount);
    assert.ok(f.jsonLd.unreadableCount <= f.jsonLd.blockCount);
    assert.equal(typeof f.scriptBuilt, 'boolean');
  }), { numRuns: 300 });
});

test('Property 4: non-string input reads as an empty page', () => {
  for (const v of [undefined, null, 42, {}, []]) assert.equal(readPageFacts(v).text, '');
});

test('Property 4: 2 MiB worst cases finish quickly', () => {
  const rep = (piece, tail = '') => piece.repeat(Math.floor((MIB2 - tail.length) / piece.length)) + tail;
  const cases = {
    'unclosed script': rep('<script'),
    'unclosed comment': rep('<!--'),
    'unclosed a': rep('<a'),
    'nested a, one close': rep('<a>', '</a>'),
    'nested button, one close': rep('<button>', '</button>'),
    'nested h1, one close': rep('<h1>', '</h1>'),
    'only <': rep('<'),
    'days and digits': rep('mon 1 '),
    'street-like': rep("1 a.a-a'a "),
  };
  for (const [name, html] of Object.entries(cases)) {
    const start = Date.now();
    const f = readPageFacts(html);
    HOURS_PATTERN.test(f.text);
    STREET_PATTERN.test(f.text);
    const ms = Date.now() - start;
    assert.ok(ms < 3000, `${name} took ${ms} ms`);
  }
});

test('reads a normal home page', () => {
  const html = `<!doctype html><html><head><title>Acme Roofing | Roof Repair in Nashville, TN</title>
    <meta name="description" content="Roof repair &amp; replacement in Nashville.">
    <meta property="og:image" content="https://example.com/a.jpg"><meta name="viewport" content="width=device-width">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"RoofingContractor","name":"Acme Roofing",
      "telephone":"(615) 555-0100","address":{"@type":"PostalAddress","streetAddress":"12 Main St","addressLocality":"Nashville","addressRegion":"TN"},
      "openingHours":"Mo-Fr 08:00-17:00"}</script>
    <script>document.write("<h1>not real</h1>")</script></head>
    <body><!-- <h1>hidden</h1> --><h1>Nashville Roof Repair</h1>
    <img src="a.jpg" alt="Crew on a roof"><img src="b.jpg"><img src="c.jpg" alt="">
    <a href="tel:+16155550100">Call now</a> <a href="/quote">Get a free estimate</a> <button>Menu</button>
    <p>Open Mon-Fri 8am-5pm at 12 Main Street.</p></body></html>`;
  const f = readPageFacts(html);
  assert.equal(f.title, 'Acme Roofing | Roof Repair in Nashville, TN');
  assert.equal(f.metaDescription, 'Roof repair & replacement in Nashville.');
  assert.equal(f.ogImage, 'https://example.com/a.jpg');
  assert.equal(f.hasViewport, true);
  assert.deepEqual(f.h1s, ['Nashville Roof Repair']);
  assert.equal(f.imgCount, 3);
  assert.equal(f.imgMissingAlt, 2);
  assert.deepEqual(f.telLinks, ['tel:+16155550100']);
  assert.ok(f.ctaLabels.includes('Call now') && f.ctaLabels.includes('Get a free estimate'));
  assert.ok(f.ctaLabels.some(l => CTA_PATTERN.test(l)));
  assert.equal(f.jsonLd.business.name, 'Acme Roofing');
  assert.equal(f.jsonLd.business.telephone, '(615) 555-0100');
  assert.equal(f.jsonLd.business.address.city, 'Nashville');
  assert.deepEqual(f.jsonLd.types, ['RoofingContractor']);
  assert.ok(!f.text.includes('not real') && !f.text.includes('hidden') && !f.text.includes('Acme Roofing |'));
  assert.ok(HOURS_PATTERN.test(f.text));
  assert.ok(STREET_PATTERN.test(f.text));
  assert.equal(f.scriptBuilt, true); // under 200 characters of text with scripts present
});

test('broken JSON-LD is counted as unreadable, and @graph is read', () => {
  const f = readPageFacts(`<script type="application/ld+json">{"@type": "Plumber",}</script>
    <script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":["Organization","Plumber"],"name":"P","telephone":"1"}]}</script>`);
  assert.equal(f.jsonLd.blockCount, 2);
  assert.equal(f.jsonLd.unreadableCount, 1);
  assert.deepEqual(f.jsonLd.types, ['WebSite', 'Organization', 'Plumber']);
  assert.equal(f.jsonLd.business.name, 'P');
});

test('a page whose words come from scripts is marked script-built; a wordy page is not', () => {
  assert.equal(readPageFacts('<div id="root"></div><script src="app.js"></script>').scriptBuilt, true);
  assert.equal(readPageFacts(`<p>${'plain words '.repeat(30)}</p><script src="a.js"></script>`).scriptBuilt, false);
  assert.equal(readPageFacts('<p>short</p>').scriptBuilt, false);
});
