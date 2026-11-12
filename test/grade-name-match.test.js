import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  isNamed, shortName, registeredDomain, extractCompetitors, analyzeAnswer,
} from '../server/lib/name-match.js';
import { normalizeForMatch } from '../server/lib/seance.js';

const word = fc.stringMatching(/^[A-Za-z]{2,10}$/);
const businessName = fc.array(word, { minLength: 2, maxLength: 4 }).map(w => w.join(' '));
const filler = fc.array(word, { maxLength: 6 }).map(w => w.join(' '));

// Change case, swap punctuation, stretch spaces.
const scramble = (text, flip) => text
  .split('')
  .map((ch, i) => (flip(i) ? (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) : ch))
  .join('')
  .replace(/ /g, '   ');

// Feature: ai-visibility-grader, Property 7: Name matching ignores case, punctuation and spacing
test('Property 7: case, punctuation and spacing do not change the result', () => {
  fc.assert(fc.property(
    businessName, filler, filler, fc.boolean(), fc.integer({ min: 1, max: 5 }),
    (name, before, after, includeName, step) => {
      const answer = includeName ? `${before}, ${name}. ${after}` : `${before}; ${after}`;
      const business = { name };
      const base = isNamed(answer, business);
      const flip = i => i % step === 0;
      assert.equal(isNamed(scramble(answer, flip), business), base);
      assert.equal(isNamed(answer, { name: scramble(name, flip) }), base);
      assert.equal(isNamed(answer.replace(/,/g, '!').replace(/\./g, ' ; '), business), base);
      if (includeName) assert.equal(base, true);
    },
  ), { numRuns: 300 });
});

// Feature: ai-visibility-grader, Property 8: Competitors exclude the business and repeat no one
test('Property 8: competitors exclude the business, repeat no one, and number at most 5', () => {
  fc.assert(fc.property(
    businessName,
    fc.array(businessName, { minLength: 0, maxLength: 9 }),
    fc.integer({ min: 0, max: 9 }),
    (name, others, at) => {
      const items = [...others];
      items.splice(Math.min(at, items.length), 0, name);
      const answer = items.map((n, i) => `${i + 1}. **${n}** - well reviewed`).join('\n');
      const business = { name };
      const found = extractCompetitors(answer, business);
      assert.ok(found.length <= 5);
      const keys = found.map(normalizeForMatch);
      assert.equal(new Set(keys).size, keys.length);
      for (const n of found) assert.equal(isNamed(n, business), false, n);
      // answer order
      const order = items.map(normalizeForMatch);
      let last = -1;
      for (const k of keys) {
        const idx = order.indexOf(k);
        assert.ok(idx > last, `${k} out of order`);
        last = idx;
      }
    },
  ), { numRuns: 300 });
});

test('examples: short names, whole-word matching, domains', () => {
  assert.equal(isNamed('You could try Acme Roofing for that.', { name: 'Acme Roofing Company' }), true);
  assert.equal(isNamed('Try Space Plumbing.', { name: 'Ace Plumbing' }), false);
  assert.equal(isNamed('See billragan.com for details', { name: 'Bill Ragan Roofing LLC', website: 'https://www.billragan.com/' }), true);
  assert.equal(shortName('The Acme Roofing Co.'), 'acme roofing');
  assert.equal(shortName('Roofing Co', { service: 'roofers' }), null);
  assert.equal(shortName('Joe LLC'), null);
  assert.equal(registeredDomain('https://www.shop.example.co.uk/x'), 'example.co.uk');
  assert.equal(registeredDomain('example.com'), 'example.com');
});

test('example: a numbered list of five roofers yields five names', () => {
  const answer = [
    'Here are good options:',
    '1. **Alpha Roofing** - family owned',
    '2. **Beta Roof Repair** (Nashville)',
    '3. Gamma Roofers: free estimates',
    '- Delta Roofing | licensed',
    '* Epsilon Exteriors',
    '6. Zeta Roofing Pros',
  ].join('\n');
  const found = extractCompetitors(answer, { name: 'Nobody Roofing' });
  assert.deepEqual(found, ['Alpha Roofing', 'Beta Roof Repair', 'Gamma Roofers', 'Delta Roofing', 'Epsilon Exteriors']);
});

test('analyzeAnswer reports the place in the list', () => {
  const answer = '1. One Roofing\n2. Two Roofing\n3. Acme Roofing - good\n';
  const r = analyzeAnswer(answer, { name: 'Acme Roofing LLC' });
  assert.equal(r.named, true);
  assert.equal(r.position, 3);
  assert.equal(r.total, 3);
  assert.deepEqual(r.competitors, ['One Roofing', 'Two Roofing']);
});
