import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  isNamed, shortName, coreName, registeredDomain, extractCompetitors, analyzeAnswer,
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

test('section headings in an AI answer are never read as business names', () => {
  const answer = [
    'Here are well-reviewed plumbers in Nashville:',
    '',
    '1. **Parthenon Plumbing, Heating & AC** - long-standing local company',
    '2. **Hiller Plumbing, Heating, Cooling & Electrical** - large regional company',
    '',
    '**Also worth a look:**',
    '- **Eason Plumbing & Drain Cleaning** - drain work',
    '',
    '**Caveats**',
    'Check reviews before you hire.',
    '## Bottom line',
    '**Honorable mentions:**',
  ].join('\n');
  const found = extractCompetitors(answer, { name: 'Benjamin Franklin Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers' });
  assert.deepEqual(found, ['Parthenon Plumbing, Heating & AC', 'Hiller Plumbing, Heating, Cooling & Electrical', 'Eason Plumbing & Drain Cleaning']);
});

test('a bold business name on its own line, with no colon, still counts', () => {
  const answer = '**Doctor Drips Plumbing**\nFast and friendly.\n\n**Smooth Saling Plumbing**\nGood reviews.';
  assert.deepEqual(extractCompetitors(answer, { name: 'Nobody Roofing' }), ['Doctor Drips Plumbing', 'Smooth Saling Plumbing']);
});

test('a bold name with a colon and prose under it is a business, not a heading', () => {
  const answer = '**Joe Plumbing:**\nFamily owned.\n\n**Acme Plumbing:**\nGood.';
  const r = analyzeAnswer(answer, { name: 'Acme Plumbing' });
  assert.equal(r.total, 2);
  assert.equal(r.position, 2);
  assert.deepEqual(r.competitors, ['Joe Plumbing']);
});

test('a bold business name over its detail bullets keeps its place', () => {
  const shapes = [
    '**Bob Plumbing:**\n- Fast\n\n**Acme Plumbing:**\n- Licensed and insured',
    '### **Bob Plumbing:**\n- Fast\n### **Acme Plumbing:**\n- Good',
    '**Bob Plumbing**:\n- Fast\n**Acme Plumbing**:\n- Good',
    '**1. Bob Plumbing:**\n- Fast\n**2. Acme Plumbing:**\n- Good',
  ];
  for (const answer of shapes) {
    const r = analyzeAnswer(answer, { name: 'Acme Plumbing' });
    assert.equal(r.named, true, answer);
    assert.ok(r.competitors.some(c => /Bob Plumbing/.test(c)), answer);
  }
});

test('indented detail bullets under a business are not counted as businesses', () => {
  const answer = [
    '1. **Acme Plumbing** - family owned',
    '   - Licensed and insured',
    '   - Phone: (615) 555-0100',
    '2. **Bob Plumbing**',
    '    - Same-day service',
    '3. Cedar Drains',
  ].join('\n');
  const r = analyzeAnswer(answer, { name: 'Bob Plumbing' });
  assert.equal(r.total, 3);
  assert.equal(r.position, 2);
  assert.deepEqual(r.competitors, ['Acme Plumbing', 'Cedar Drains']);
});

test('a new list after prose starts fresh, even if it is indented', () => {
  const answer = 'Top picks below.\n  - Acme Plumbing\n  - Bob Plumbing\n\nAlso:\n    - Cedar Drains';
  assert.deepEqual(extractCompetitors(answer, { name: 'Nobody Roofing' }), ['Acme Plumbing', 'Bob Plumbing', 'Cedar Drains']);
});

test('businesses listed under a label or a category heading still count', () => {
  const shapes = [
    ['- Plumbers:\n  - Acme Plumbing\n  - Bob Plumbing', ['Acme Plumbing', 'Bob Plumbing']],
    ['1. Best overall:\n   - **Acme Plumbing**\n2. Best value:\n   - **Bob Plumbing**', ['Acme Plumbing', 'Bob Plumbing']],
    ['- **Emergency plumbers**\n  - Acme Plumbing\n  - Bob Plumbing', ['Acme Plumbing', 'Bob Plumbing']],
  ];
  for (const [answer, want] of shapes) {
    const found = extractCompetitors(answer, { name: 'Nobody Roofing' });
    for (const name of want) assert.ok(found.includes(name), `${answer} -> ${found}`);
  }
});

test('a sentence under a business does not turn its details into businesses', () => {
  const answer = '1. **Acme Plumbing**\n   Known for fast service.\n   - Licensed and insured\n   - Family owned\n2. **Bob Plumbing**';
  assert.deepEqual(extractCompetitors(answer, { name: 'Nobody Roofing' }), ['Acme Plumbing', 'Bob Plumbing']);
});

test('businesses nested under a group heading of any kind still count', () => {
  const shapes = [
    '1. **Water heater specialists**\n   - Acme Plumbing\n   - Bob Plumbing',
    '- **East Nashville**\n  - Acme Plumbing\n- **Germantown**\n  - Bob Plumbing',
    '- **If you need it done today**\n  - Acme Plumbing\n  - Bob Plumbing',
  ];
  for (const answer of shapes) {
    const r = analyzeAnswer(answer, { name: 'Acme Plumbing' });
    assert.notEqual(r.position, null, answer);
    assert.ok(r.competitors.includes('Bob Plumbing'), answer);
  }
});

test('nested businesses with a short description keep counting', () => {
  const shapes = [
    '- **East Nashville**\n  - **Acme Plumbing** - 4.8 stars on Google\n  - **Bob Plumbing** - family owned',
    '1. Best overall:\n   - **Acme Plumbing**: highly rated, 500+ reviews\n   - Bob Plumbing - licensed, insured',
    '- Nashville\n  - Acme Plumbing (serves Nashville)\n  - [Bob Plumbing](https://bob.example) - 4.7 rating',
    '- Top picks\n  - 5 Star Plumbing\n  - 24/7 Plumbing Pros\n  - Acme Plumbing',
  ];
  for (const answer of shapes) {
    const r = analyzeAnswer(answer, { name: 'Acme Plumbing' });
    assert.notEqual(r.position, null, answer);
    assert.ok(r.competitors.length >= 1, answer);
  }
});

test('plain detail bullets under a business are still skipped', () => {
  const answer = '1. **Acme Plumbing**\n   - Licensed and insured\n   - Over 20 years in business\n   - Free estimates\n2. **Bob Plumbing**';
  assert.deepEqual(extractCompetitors(answer, { name: 'Nobody Roofing' }), ['Acme Plumbing', 'Bob Plumbing']);
});

test('trade names that open with a detail word still count when nested', () => {
  const names = ['Family Plumbing Co', 'Free Flow Plumbing', 'Over the Top Roofing', 'Same Day Plumbing',
    'Veteran Plumbing Services', '24/7 Locksmith Nashville', 'One Hour Heating & Air Conditioning of Nashville'];
  for (const n of names) {
    const answer = `- Picks\n  - ${n}\n  - Acme Plumbing`;
    const found = extractCompetitors(answer, { name: 'Nobody Roofing' });
    assert.ok(found.includes(n), `${n} -> ${found}`);
  }
});

test('detail bullets in sentence case are still skipped', () => {
  const answer = '1. **Acme Plumbing**\n   - Same-day service\n   - Free estimates\n   - Licensed and insured plumbing\n2. **Bob Plumbing**';
  assert.deepEqual(extractCompetitors(answer, { name: 'Nobody Roofing' }), ['Acme Plumbing', 'Bob Plumbing']);
});

// ---- Shapes from real answers in the live check (Nov 16, 2026) ----

const HILLER = { name: 'Hiller Plumbing, Heating, Cooling & Electrical', city: 'Nashville', state: 'TN', service: 'plumbers' };

test('real Claude answer: bold names with sentences, honorable mentions, and tips', () => {
  const answer = [
    "I can't vouch for any of these plumbers from personal experience.",
    '',
    '1. **Doctor Drips Plumbing** is the most consistent name across the sources. It has a 4.9 rating.',
    '2. **100 Percent Plumbing** is the top pick on CityVetted, which recommends it for most homes.',
    '3. **Hoffmann Brothers** has by far the most reviews of the group.',
    '',
    '**Honorable mentions:**',
    '- **Honest Plumbing** is Yahoo\'s pick for small jobs.',
    '- **Hiller** is Yahoo\'s pick as the best full-service plumber.',
    '',
    '**Before you hire:**',
    '- Check that the plumber holds a valid Tennessee license and insurance.',
    '- Read recent Google and BBB reviews.',
  ].join('\n');
  const r = analyzeAnswer(answer, HILLER);
  assert.equal(r.named, true);
  assert.equal(r.position, 5);
  assert.deepEqual(r.competitors, ['Doctor Drips Plumbing', '100 Percent Plumbing', 'Hoffmann Brothers', 'Honest Plumbing']);
});

test('real ChatGPT answer: bold words inside a sentence are not names', () => {
  const answer = [
    'Here are my **top five Nashville plumbers**, based on local review coverage.',
    '',
    '1. **Doctor Drips Plumbing** — My overall pick. **(615) 970-0047**.',
    '2. **100 Percent Plumbing** — A strong local choice. **(615) 431-1100**.',
    '',
    'For a non-emergency job, compare **written estimates** before booking.',
  ].join('\n');
  assert.deepEqual(extractCompetitors(answer, HILLER), ['Doctor Drips Plumbing', '100 Percent Plumbing']);
});

test('real Gemini answer: numbered markdown headings are names, tips are not', () => {
  const answer = [
    'Here are five of the top-rated plumbing companies in Nashville:',
    '',
    '### 1. Frog Heating, Air, & Plumbing',
    'Frog is arguably the most recognizable name.',
    '### 2. Greenway Home Services',
    '### 3. Mr. Rooter Plumbing of Nashville',
    '',
    '### Tips for choosing a plumber in Nashville:',
    '* **Check Licensing:** Always ensure the company is licensed.',
    '* **Ask about "Trip Fees":** Some companies charge a dispatch fee.',
    '* **Get Multiple Quotes for Large Jobs:** It is standard practice.',
    '',
    '***Disclaimer:** I am an AI, not a local resident.*',
  ].join('\n');
  assert.deepEqual(extractCompetitors(answer, HILLER), ['Frog Heating, Air, & Plumbing', 'Greenway Home Services', 'Mr. Rooter Plumbing of Nashville']);
});

test('coreName takes the distinctive words before the trade words', () => {
  assert.equal(coreName('Hiller Plumbing, Heating, Cooling & Electrical'), 'hiller');
  assert.equal(coreName('Benjamin Franklin Plumbing'), 'benjamin franklin');
  assert.equal(coreName('Ace Plumbing'), '');
  assert.equal(coreName('Plumbing Pros'), '');
  assert.equal(coreName('Acme'), '');
});

test('the core name never matches running text', () => {
  const biz = { name: 'Music City Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers' };
  const r = analyzeAnswer('Plumbers in Music City stay busy.\n\n1. **Acme Plumbing**\n2. **Bob Drains**', biz);
  assert.equal(r.named, false);
  assert.equal(analyzeAnswer('1. **Music City** - great service', biz).named, true);
});

test('the core name never matches a different business with the same first word', () => {
  const answer = '1. **Johnson Controls**\n2. **Johnson & Sons Roofing**\n3. **Acme Plumbing**';
  assert.equal(analyzeAnswer(answer, { name: 'Johnson Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers' }).named, false);
  assert.equal(analyzeAnswer('1. **Benjamin Franklin Electric**', { name: 'Benjamin Franklin Plumbing' }).named, false);
  assert.equal(analyzeAnswer('1. **Smith Hiller Roofing**', HILLER).named, false);
  assert.equal(analyzeAnswer('1. **Hiller Plumbing** - great', HILLER).position, 1);
});

test('names in a markdown table and bold names inside sentences count', () => {
  const table = '| Company | Rating |\n|---|---|\n| **Acme Plumbing** | 4.8 |\n| Bob Drains | 4.6 |';
  assert.deepEqual(extractCompetitors(table, { name: 'Nobody Roofing' }), ['Acme Plumbing', 'Bob Drains']);
  const prose = "I'd start with **Acme Plumbing** and **Bob Drains**. Ask for **written estimates**.";
  assert.deepEqual(extractCompetitors(prose, { name: 'Nobody Roofing' }), ['Acme Plumbing', 'Bob Drains']);
});

test('a bold word that is only part of the name keeps the whole name', () => {
  assert.deepEqual(extractCompetitors('- **Acme** Plumbing & Drain\n- Keep It Clean', { name: 'Nobody Roofing' }), ['Acme Plumbing & Drain', 'Keep It Clean']);
});
