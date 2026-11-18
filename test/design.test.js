/**
 * Tests for the aged phone-book design: the call button text, the report's
 * check-count wording, and self-hosted fonts with license files.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { listingDetail } from '../server/lib/html.js';
import { reportPage } from '../server/lib/grade-html.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Strip tags and decode the few entities escapeHtml produces. */
const visibleText = html => html
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ');

const digitsArb = n => fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n }).map(a => a.join(''));

const validPhoneArb = fc.oneof(
  fc.tuple(digitsArb(3), digitsArb(3), digitsArb(4)).map(([a, b, c]) => `(${a}) ${b}-${c}`),
  fc.tuple(digitsArb(3), digitsArb(3), digitsArb(4)).map(([a, b, c]) => `${a}-${b}-${c}`),
  fc.tuple(digitsArb(3), digitsArb(3), digitsArb(4)).map(([a, b, c]) => `+1 ${a}.${b}.${c}`),
);

// ---- 6.1: the call button shows the phone number -------------------------------

test('property: the call button text always contains the listing phone number', () => {
  // Validates: Requirement 4.2 (the call box shows the number; its name includes it)
  fc.assert(
    fc.property(validPhoneArb, phone => {
      const listing = {
        id: 'call-test', name: 'Call Test', category: 'plumbers', phone,
        hours: {}, services: ['Drain cleaning'], serviceArea: 'Nashville',
        description: 'We fix pipes.', city: 'Nashville', state: 'TN',
      };
      const html = listingDetail(listing, undefined, { categories: [] });
      const m = /<a class="button call-button"[^>]*>([\s\S]*?)<\/a>/.exec(html);
      assert.ok(m, 'call button present');
      assert.ok(visibleText(m[1]).includes(phone), `button text "${visibleText(m[1])}" has ${phone}`);
    }),
    { numRuns: 100 },
  );
});

// ---- 6.2: singular and plural check count --------------------------------------

test('property: the check-count sentence uses "check needs" for 1 and "checks need" otherwise', () => {
  // Validates: Requirement 6.1 (right singular or plural in report counts)
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 50 }).chain(counted => fc.tuple(fc.constant(counted), fc.integer({ min: 0, max: counted }))),
      ([counted, failed]) => {
        const grade = {
          id: 'g1',
          input: { name: 'Test Plumbing', city: 'Nashville', state: 'TN', service: 'plumber', website: 'https://example.test' },
          score: { score: 50, counted, failed },
          results: {},
          createdAt: '2026-11-01T00:00:00.000Z',
        };
        const html = reportPage(grade, { leadGate: false });
        const m = /<p class="grade-failed">([^<]*)<\/p>/.exec(html);
        assert.ok(m, 'count sentence present');
        const expected = counted === 1
          ? `${failed} of 1 check needs work`
          : `${failed} of ${counted} checks need work`;
        assert.equal(m[1], expected);
      },
    ),
    { numRuns: 100 },
  );
});

// ---- 6.3: fonts are local and licensed -----------------------------------------

test('the stylesheet loads nothing from another host, and every @font-face file exists with a license', () => {
  // Validates: Requirement 5.3 (fonts served from this site with license files)
  const css = fs.readFileSync(path.join(ROOT, 'public', 'css', 'style.css'), 'utf8');

  assert.equal(css.includes('@import'), false, 'no @import');
  const urls = [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)].map(m => m[2]);
  assert.ok(urls.length > 0);
  for (const u of urls) {
    assert.ok(!/^(https?:)?\/\//i.test(u), `no outside host: ${u.slice(0, 60)}`);
  }

  const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  assert.ok(faces.length > 0, 'the stylesheet declares fonts');
  const fontDir = path.join(ROOT, 'public', 'fonts');
  const licenses = fs.readdirSync(fontDir).filter(f => /^LICENSE/i.test(f));
  assert.ok(licenses.length > 0, 'license files exist');

  for (const face of faces) {
    const src = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(face);
    assert.ok(src, 'every @font-face has a url');
    assert.ok(src[1].startsWith('/fonts/'), `font served from this site: ${src[1]}`);
    const file = path.join(fontDir, path.basename(src[1]));
    assert.ok(fs.existsSync(file), `font file exists: ${src[1]}`);
    // The family's license sits beside the file: LICENSE-<Family>.txt, family from the file name.
    const family = path.basename(src[1]).split('-latin-')[0].replace(/-/g, '').toLowerCase();
    assert.ok(
      licenses.some(l => l.replace(/^LICENSE-/i, '').replace(/\.txt$/i, '').toLowerCase() === family),
      `license file for ${src[1]}`,
    );
  }
});
