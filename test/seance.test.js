import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { buildPrompt, detectNamed, normalizeForMatch } from '../server/lib/seance.js';

const categories = JSON.parse(
  readFileSync(new URL('../data/categories.json', import.meta.url), 'utf8')
);

// ---- Generators ----

const arbWord = fc.stringMatching(/^[a-zA-Z]{1,8}$/);
// Separators that all normalize to exactly one space (whitespace and/or punctuation, never empty).
const arbSeparator = fc.constantFrom(' ', '  ', '     ', '\t', ' \n ', '-', ', ', ' - ', '...', ' & ', '. ', '!!', '/');
const arbCasing = fc.constantFrom('lower', 'upper', 'same');

function applyCasing(word, casing) {
  if (casing === 'lower') return word.toLowerCase();
  if (casing === 'upper') return word.toUpperCase();
  return word;
}

// A name built from letters and single spaces (always non-empty after normalization).
const arbName = fc
  .array(arbWord, { minLength: 1, maxLength: 5 })
  .map(words => words.join(' '));

// Printable ASCII surrounding text (fc.string in fast-check 3.x is printable ASCII).
const arbText = fc.string({ maxLength: 30 });

// ---- Property 21 ----

test('Property 21: a name contained in the answer is detected (plain embedding)', () => {
  // **Validates: Requirements 11.3, 11.7**
  fc.assert(
    fc.property(arbName, arbText, arbText, (name, prefix, suffix) => {
      assert.equal(detectNamed(name, prefix + name + suffix), true);
    }),
    { numRuns: 200 }
  );
});

test('Property 21: detected after re-casing, punctuation changes, and wider whitespace', () => {
  // **Validates: Requirements 11.3, 11.7**
  fc.assert(
    fc.property(
      fc.array(fc.tuple(arbWord, arbCasing), { minLength: 1, maxLength: 5 }),
      fc.array(arbSeparator, { minLength: 5, maxLength: 5 }),
      arbText,
      arbText,
      (parts, seps, prefix, suffix) => {
        const name = parts.map(([w]) => w).join(' ');
        let altered = '';
        parts.forEach(([w, casing], i) => {
          if (i > 0) altered += seps[i - 1];
          altered += applyCasing(w, casing);
        });
        assert.equal(detectNamed(name, prefix + altered + suffix), true);
      }
    ),
    { numRuns: 200 }
  );
});

// ---- Property 22 ----

test('Property 22a: a named answer stays named after any prefix and suffix', () => {
  // **Validates: Requirements 11.4, 11.8**
  fc.assert(
    fc.property(
      fc.string({ maxLength: 20 }),
      arbText,
      arbText,
      arbText,
      arbText,
      (name, a, b, prefix, suffix) => {
        // Build an answer that contains the name, so the antecedent is exercised often.
        const answer = a + name + b;
        if (detectNamed(name, answer)) {
          assert.equal(detectNamed(name, prefix + answer + suffix), true);
        }
      }
    ),
    { numRuns: 300 }
  );
});

test('Property 22a: monotonic for names embedded in arbitrary answers', () => {
  // **Validates: Requirements 11.4, 11.8**
  fc.assert(
    fc.property(arbName, arbText, arbText, arbText, arbText, (name, a, b, prefix, suffix) => {
      const answer = a + name + b;
      assert.equal(detectNamed(name, answer), true);
      assert.equal(detectNamed(name, prefix + answer + suffix), true);
    }),
    { numRuns: 200 }
  );
});

test('Property 22b: disjoint alphabets cannot create or change a match', () => {
  // **Validates: Requirements 11.4, 11.8**
  const arbDigits = fc.stringMatching(/^[0-9]{0,20}$/);
  fc.assert(
    fc.property(
      fc.stringMatching(/^[a-f]{1,10}$/),
      arbDigits,
      arbDigits,
      arbDigits,
      (name, answer, prefix, suffix) => {
        const before = detectNamed(name, answer);
        const after = detectNamed(name, prefix + answer + suffix);
        assert.equal(before, false);
        assert.equal(after, before);
      }
    ),
    { numRuns: 200 }
  );
});

// ---- Other properties and examples ----

test('empty, punctuation-only, and whitespace-only names never match', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[ \t\n.,!?;:'"()&\-]{0,12}$/),
      fc.string({ maxLength: 40 }),
      (name, answer) => {
        assert.equal(detectNamed(name, answer), false);
      }
    ),
    { numRuns: 200 }
  );
  assert.equal(detectNamed('', 'anything'), false);
  assert.equal(detectNamed('   ', 'anything'), false);
  assert.equal(detectNamed('...', 'anything...'), false);
});

test('normalizeForMatch is idempotent', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 60 }), s => {
      const once = normalizeForMatch(s);
      assert.equal(normalizeForMatch(once), once);
    }),
    { numRuns: 300 }
  );
});

test('detectNamed examples', () => {
  // Punctuation becomes a space, so "Joe's Plumbing" normalizes to "joe s plumbing".
  assert.equal(normalizeForMatch("Joe's Plumbing"), 'joe s plumbing');
  assert.equal(detectNamed("Joe's Plumbing", 'joes plumbing'), false);
  assert.equal(detectNamed("Joe's Plumbing", "Call JOE'S   PLUMBING today"), true);
  assert.equal(detectNamed("Joe's Plumbing", 'joe s plumbing'), true);
  // "&" is punctuation: "neon & ohm electric" collapses to "neon ohm electric".
  assert.equal(normalizeForMatch('Neon & Ohm Electric'), 'neon ohm electric');
  assert.equal(detectNamed('Neon & Ohm Electric', 'neon ohm electric'), true);
  assert.equal(detectNamed('Neon & Ohm Electric', 'Try Neon and Ohm Electric'), false);
});

test('buildPrompt uses the category label from data/categories.json', () => {
  assert.ok(categories.length > 0);
  for (const c of categories) {
    assert.equal(
      buildPrompt({ category: c.slug, city: 'Nashville' }, categories),
      `best ${c.label.toLowerCase()} in Nashville`
    );
  }
});

test('buildPrompt falls back to the slug for an unknown category', () => {
  assert.equal(
    buildPrompt({ category: 'chimney-sweeps', city: 'Austin' }, categories),
    'best chimney-sweeps in Austin'
  );
});

// ---- Trade-matched mock: label and end-to-end (task 14.5) ----

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSeance, createSeanceStore } from '../server/lib/seance.js';
import { seanceReportPage, DEMO_LABEL } from '../server/lib/seance-html.js';
import { createMockAssistantProvider } from '../server/lib/assistant.js';
import { createDataStore } from '../server/data.js';

// Independent oracle of the fixture business names, by category slug.
const E2E_TRADE_NAMES = {
  plumbers: ['Nashville Pipe Pros', 'Honky Tonk Plumbing', 'Cumberland Drain Co', 'Copper Kettle Plumbing', 'Blue Anchor Pipe Works', 'Delmar Drain Service'],
  electricians: ['Volt Brothers Electric', 'Music City Wiring', 'Neon & Ohm Electric', 'Lantern Electric', 'Brightline Wiring', 'Ridgeway Electrical'],
  restaurants: ['The Griddle House', 'Biscuit & Brine', 'Hot Plate Nashville', 'Skillet & Smoke', 'Fifth Street Diner', 'The Corner Table'],
  'auto-repair': ['Cumberland Auto Works', 'Five Points Auto', 'Pedal to the Metal Garage', 'Lug Nut Garage', 'Riverside Brake & Tire', 'Old Hickory Auto Service'],
  'hair-salons': ['Shear Nashville', 'The Clip Joint', 'Bangs & Bobs Studio', 'Velvet Scissors', 'Lucky Comb Salon', 'Main Street Barber & Style'],
  lawyers: ['Barrett & Hollow Law', 'Hatch & Greer Attorneys', 'Stone River Legal', 'Marlow & Pike Law', 'Capitol Hill Legal', 'Dunmore Attorneys'],
};

function e2eOtherTradeNames(category) {
  return Object.entries(E2E_TRADE_NAMES)
    .filter(([slug]) => slug !== category)
    .flatMap(([, names]) => names);
}

test('seanceReportPage labels mock runs as a demo answer and real providers not', () => {
  const listing = { id: 'acme-plumbing', name: 'Acme Plumbing' };
  const makeRun = provider => ({
    id: `run-${provider}`,
    listingId: listing.id,
    prompt: 'best plumbers in Nashville',
    provider,
    timestamp: '2026-11-10T05:05:00.000Z',
    answer: 'Some answer.',
    named: false,
  });
  const mockPage = seanceReportPage(listing, [makeRun('mock')], '2026-11-01');
  assert.ok(mockPage.includes('Demo answer (no AI connected)'));
  assert.ok(!/mock/i.test(mockPage), 'the word mock is not shown');
  assert.equal(DEMO_LABEL, 'Demo answer (no AI connected)');

  const realPage = seanceReportPage(listing, [makeRun('openai')], '2026-11-01');
  assert.ok(!realPage.includes('Demo answer (no AI connected)'));
});

test('runSeance with the mock provider stores a trade-matched answer and matching named flag', async () => {
  const listings = JSON.parse(readFileSync(new URL('../data/listings.json', import.meta.url), 'utf8'))
    .filter(l => l && typeof l === 'object' && typeof l.id === 'string');
  // One seed listing per known trade (safe access: skip trades with no seed listing).
  const seeds = Object.keys(E2E_TRADE_NAMES)
    .map(slug => listings.find(l => l.category === slug))
    .filter(Boolean);
  assert.ok(seeds.length > 0, 'expected at least one seed listing in a known trade');

  const dir = mkdtempSync(join(tmpdir(), 'seance-e2e-'));
  try {
    writeFileSync(join(dir, 'listings.json'), readFileSync(new URL('../data/listings.json', import.meta.url)));
    writeFileSync(join(dir, 'categories.json'), readFileSync(new URL('../data/categories.json', import.meta.url)));
    const store = createDataStore({ dataDir: dir });
    let counter = 0;
    const ctx = {
      store,
      assistantProvider: createMockAssistantProvider(),
      config: { providerTimeoutMs: 1000 },
      clock: { now: () => Date.UTC(2026, 10, 10, 5, 5, 0) },
      newId: () => `run-${++counter}`,
    };

    for (const listing of seeds) {
      const run = await runSeance(ctx, listing.id);
      assert.equal(run.provider, 'mock');
      assert.equal(run.listingId, listing.id);
      assert.equal(typeof run.answer, 'string');
      assert.ok(run.answer.length > 0);
      assert.equal(run.named, detectNamed(listing.name, run.answer));
      for (const other of e2eOtherTradeNames(listing.category)) {
        assert.ok(!run.answer.includes(other), `"${run.answer}" names ${other} from another trade`);
      }
      const stored = (await createSeanceStore(store).list(listing.id)).find(r => r.id === run.id);
      assert.deepEqual(stored, run);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
