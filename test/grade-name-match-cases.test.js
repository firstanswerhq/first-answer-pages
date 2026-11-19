// A fixed table of 23 realistic AI answers, each with the exact result wanted (review round 7, V35).
// For each case: is the business named, where does it sit in the list, and which names come out, in order.
// The business's own name sits at `position`; `names` is the whole list in order, own name included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAnswer } from '../server/lib/name-match.js';

const lines = (...rows) => rows.join('\n');

const CASES = [
  {
    id: 'P1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '### 1. Hiller Plumbing',
      '- Same Day Service',
      '- Free Estimates',
      "### 2. Joe's Plumbing",
      '- Licensed and insured',
      '### 3. Radiant Plumbing & Air',
      '- 24/7 Emergency Service',
    ),
    names: ['Hiller Plumbing', "Joe's Plumbing", 'Radiant Plumbing & Air'], position: 2,
  },
  {
    id: 'P2', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '### 1. Emergency Plumbers',
      '- Hiller Plumbing',
      '- Mr. Rooter Plumbing',
      '### 2. Budget Picks',
      "- Joe's Plumbing",
      '- Plumbing Pros of Nashville',
    ),
    names: ['Hiller Plumbing', 'Mr. Rooter Plumbing', "Joe's Plumbing", 'Plumbing Pros of Nashville'], position: 3,
  },
  {
    id: 'P3', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Hiller Plumbing**',
      '- Phone: (615) 555-0100',
      '- Free Estimates',
      "2. **Joe's Plumbing**",
      '- Family Owned',
      '3. **Benjamin Franklin Plumbing**',
    ),
    names: ['Hiller Plumbing', "Joe's Plumbing", 'Benjamin Franklin Plumbing'], position: 2,
  },
  {
    id: 'P4', name: "Joe's Plumbing", service: 'plumbers',
    answer: "Good options include **Hiller Plumbing**, **Mr. Rooter Plumbing** and **Joe's Plumbing**. Many offer free estimates.",
    names: ['Hiller Plumbing', 'Mr. Rooter Plumbing', "Joe's Plumbing"], position: 3,
  },
  {
    id: 'P5', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '- [Hiller Plumbing](https://www.hillerplumbing.com) - 24/7 service',
      "- [Joe's Plumbing](https://joesplumbing.com): small, family run",
      '- [Mr. Rooter](https://mrrooter.com): drains',
    ),
    names: ['Hiller Plumbing', "Joe's Plumbing", 'Mr. Rooter'], position: 2,
  },
  {
    id: 'P6', name: "Joe's Plumbing", service: 'plumbers',
    answer: "For emergencies, **Hiller Plumbing** is the big name. Smaller shops like **Joe's Plumbing** and **Radiant Plumbing & Air** get strong reviews. For drains, try **Mr. Rooter Plumbing**.",
    names: ['Hiller Plumbing', "Joe's Plumbing", 'Radiant Plumbing & Air', 'Mr. Rooter Plumbing'], position: 2,
  },
  {
    id: 'R1', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      'Here are top roofers in Nashville:',
      '',
      '1. **Music City Roofing** - Family owned since 1998.',
      '2. **Nashville Roofing Pros** - Free inspections.',
      '3. **Top Notch Roofing**',
      '4. Free Estimates',
      '5. **Family Owned Roofing & Repair**',
    ),
    names: ['Music City Roofing', 'Nashville Roofing Pros', 'Top Notch Roofing', 'Family Owned Roofing & Repair'], position: 1,
  },
  {
    id: 'R2', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      '## Best Overall',
      '### 1. Music City Roofing',
      'Known for storm repair.',
      '- Free Estimates',
      '- Licensed and Insured',
      '## Best Value',
      '### 2. Volunteer Roofing',
      '- Same Day Service',
    ),
    names: ['Music City Roofing', 'Volunteer Roofing'], position: 1,
  },
  {
    id: 'R3', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      '| Company | Known For | Rating |',
      '|---|---|---|',
      '| Music City Roofing | Storm repair | 4.8 |',
      '| Volunteer Roofing | Metal roofs | 4.7 |',
      '| Mr. Roof | Replacements | 4.6 |',
    ),
    names: ['Music City Roofing', 'Volunteer Roofing', 'Mr. Roof'], position: 1,
  },
  {
    id: 'S5', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      '1. **Music City Roofing**',
      '   - Storm Damage Repair',
      '   - Metal Roofs',
      '2. **Volunteer Roofing**',
      '   - Gutter Installation',
    ),
    names: ['Music City Roofing', 'Volunteer Roofing'], position: 1,
  },
  {
    id: 'S6', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      'Some options worth calling:',
      '- Music City Roofing, which handles storm repairs.',
      '- Volunteer Roofing is a smaller crew.',
      '- Check Google reviews before hiring.',
    ),
    names: ['Music City Roofing', 'Volunteer Roofing'], position: 1,
  },
  {
    id: 'F1', name: 'The Catbird Seat', service: 'restaurants',
    answer: lines(
      '### 1. Fine Dining',
      '- **The Catbird Seat** - tasting menu',
      '- **Bastion** - small plates',
      '### 2. Hot Chicken',
      "- **Hattie B's Hot Chicken**",
      "- **Prince's Hot Chicken Shack**",
    ),
    names: ['The Catbird Seat', 'Bastion', "Hattie B's Hot Chicken", "Prince's Hot Chicken Shack"], position: 1,
  },
  {
    id: 'F2', name: 'The Local', service: 'restaurants',
    answer: lines(
      '1. **The Local** - neighborhood spot',
      '2. **Rolf and Daughters**',
      '3. **Family Wash**',
      '4. **Open Kitchen**',
    ),
    names: ['The Local', 'Rolf and Daughters', 'Family Wash', 'Open Kitchen'], position: 1,
  },
  {
    id: 'F3', name: 'Rolf and Daughters', service: 'restaurants',
    answer: lines(
      '**1. Germantown**',
      '- Rolf and Daughters',
      '- City House',
      '**2. East Nashville**',
      '- Lockeland Table',
    ),
    names: ['Rolf and Daughters', 'City House', 'Lockeland Table'], position: 1,
  },
  {
    id: 'F4', name: 'Bastion', service: 'restaurants',
    answer: lines(
      '### 1. Fine Dining',
      '- The Catbird Seat: tasting menu',
      '- Bastion: small plates',
      '### 2. Casual',
      "- Hattie B's: hot chicken",
      "- Arnold's Country Kitchen: meat and three",
    ),
    names: ['The Catbird Seat', 'Bastion', "Hattie B's", "Arnold's Country Kitchen"], position: 2,
  },
  {
    id: 'F5', name: 'Bastion', service: 'restaurants',
    answer: lines(
      '### 1. City House',
      '- Belly Ham Pizza',
      '- Wood Fired Oven',
      '### 2. Bastion',
      '- Big Bar Nachos',
      '### 3. Husk Nashville',
      '- Southern Tasting Menu',
    ),
    names: ['City House', 'Bastion', 'Husk Nashville'], position: 2,
  },
  {
    id: 'S1', name: 'Bastion', service: 'restaurants',
    answer: lines(
      '### 1. The Catbird Seat',
      '- Known For: Tasting Menu',
      '- Price Range: High',
      '### 2. Bastion',
      '- Known For: Big Bar Nachos',
      '### 3. Rolf and Daughters',
      '- Must Try: Garganelli Verde',
    ),
    names: ['The Catbird Seat', 'Bastion', 'Rolf and Daughters'], position: 2,
  },
  {
    id: 'S2', name: 'Mr. Rooter', service: 'plumbers',
    answer: lines(
      '**1. Mr. Rooter**',
      '- Best For: Drain Clogs',
      '**2. Hiller**',
      '- Best For: Big Jobs',
      '**3. Benjamin Franklin**',
    ),
    names: ['Mr. Rooter', 'Hiller', 'Benjamin Franklin'], position: 1,
  },
  {
    id: 'S3', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '### 1. Bastion',
      'Great small plates.',
      '### 2. Overview',
      'Some text.',
      '### 3. Final Thoughts',
      'Call ahead.',
    ),
    names: null, position: null, // not named; "Overview" and "Final Thoughts" must never be competitors
  },
  {
    id: 'S4', name: 'The Local', service: 'restaurants',
    answer: lines(
      '### 1. The Local',
      '- Neighborhood Favorite',
      '- Great Patio',
      '### 2. City House',
      '- Wood Fired Pizza',
    ),
    names: ['The Local', 'City House'], position: 1,
  },
  {
    id: 'S7', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      "### 1. Nashville's Top Picks",
      '- Hiller Plumbing',
      "- Joe's Plumbing",
    ),
    names: ['Hiller Plumbing', "Joe's Plumbing"], position: 2,
  },
  {
    id: 'H1', name: 'Parlour Salon', service: 'hair salons',
    answer: lines(
      'Here are some well-reviewed hair salons in Nashville:',
      '',
      '1. **Parlour Salon** \u2013 Known for color work in 12 South.',
      '2. **Hair Bar Nashville** \u2013 Blowouts and styling.',
      '3. **Salon Lofts Green Hills** \u2013 Independent stylists.',
      '4. **Fox & Jane** \u2013 Modern cuts.',
    ),
    names: ['Parlour Salon', 'Hair Bar Nashville', 'Salon Lofts Green Hills', 'Fox & Jane'], position: 1,
  },
  {
    id: 'H2', name: 'Fox & Jane', service: 'hair salons',
    answer: lines(
      'A few popular options:',
      '- Parlour: color specialists in 12 South',
      '- Fox & Jane: modern cuts, easy online booking',
      '- Hair Bar Nashville: blowouts',
      '- Salon Lofts: booth renters',
    ),
    names: ['Parlour', 'Fox & Jane', 'Hair Bar Nashville', 'Salon Lofts'], position: 2,
  },
];

for (const c of CASES) {
  test(`name-match table ${c.id}: ${c.name} (${c.service})`, () => {
    const r = analyzeAnswer(c.answer, { name: c.name, city: 'Nashville', state: 'TN', service: c.service });
    if (c.names === null) {
      assert.equal(r.named, false, 'not named');
      assert.equal(r.position, null, 'no position');
      for (const bad of ['Overview', 'Final Thoughts']) {
        assert.ok(!r.competitors.includes(bad), `${bad} is not a competitor`);
      }
      return;
    }
    assert.equal(r.named, true, 'named');
    assert.equal(r.position, c.position, 'position');
    // The competitors are every name except the business's own, in order.
    const expectedCompetitors = c.names.filter((_, i) => i !== c.position - 1);
    assert.deepEqual(r.competitors, expectedCompetitors, 'competitors in order');
    assert.equal(r.total, c.names.length, 'total names');
  });
}

// ---- Review round 8 (V36): "**Name:** description" lines and related shapes -------------------
// Here each case states `named`, `position` (a number or null) and `competitors` (in order) directly.

const MORE_CASES = [
  {
    id: 'Y1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Hiller Plumbing:** The biggest name in town.',
      "2. **Joe's Plumbing:** Small and honest.",
      '3. **Radiant Plumbing & Air:** Upfront pricing.',
    ),
    named: true, position: 2, competitors: ['Hiller Plumbing', 'Radiant Plumbing & Air'],
  },
  {
    id: 'Y2', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '- **Parlour:** Color specialists.',
      '- **Hair Bar Nashville:** Blowouts.',
      '- **Fox & Jane:** Modern cuts.',
    ),
    named: true, position: 1, competitors: ['Hair Bar Nashville', 'Fox & Jane'],
  },
  {
    id: 'Y3', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Hiller Plumbing:** The biggest name in town.',
      '2. **Radiant Plumbing & Air:** Upfront pricing.',
    ),
    named: false, position: null, competitors: ['Hiller Plumbing', 'Radiant Plumbing & Air'],
  },
  {
    id: 'X1', name: 'Volunteer Roofing', service: 'roofers',
    answer: lines(
      '1. Music City Roofing \u2014 storm and hail repair, 20+ years',
      '2. Volunteer Roofing \u2014 metal roofs and inspections',
      '3. Mr. Roof \u2014 fast replacements',
      '4. Roof Life of Nashville \u2014 family run',
    ),
    named: true, position: 2, competitors: ['Music City Roofing', 'Mr. Roof', 'Roof Life of Nashville'],
  },
  {
    id: 'X2', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '- [Parlour](https://parlournashville.com)',
      '- [Hair Bar Nashville](https://hairbar.com)',
      '- [Fox & Jane](https://foxandjane.com)',
      '- [Salon Lofts](https://salonlofts.com)',
    ),
    named: true, position: 1, competitors: ['Hair Bar Nashville', 'Fox & Jane', 'Salon Lofts'],
  },
  {
    id: 'X3', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      'Finding a good plumber in Nashville comes down to reviews, licensing and how fast they answer. Based on what I found, here are five that stand out.',
      '',
      '1. **Hiller Plumbing, Heating, Cooling & Electrical** \u2014 The biggest name in Middle Tennessee, with 24/7 service.',
      '2. **Radiant Plumbing & Air Conditioning** \u2014 Upfront pricing and strong reviews.',
      "3. **Joe's Plumbing** \u2014 A smaller, family-run shop known for honest quotes.",
      '4. **Benjamin Franklin Plumbing** \u2014 Punctual, with an on-time promise.',
      '5. **Mr. Rooter Plumbing of Nashville** \u2014 Good for drain and sewer work.',
      '',
      '**Tips before you hire:**',
      '- Confirm a Tennessee plumbing license.',
      '- Ask for a written estimate.',
      '- Check recent Google and Yelp reviews.',
      '',
      'Prices and availability change, so call ahead.',
    ),
    named: true,
    position: 3,
    competitors: [
      'Hiller Plumbing, Heating, Cooling & Electrical',
      'Radiant Plumbing & Air Conditioning',
      'Benjamin Franklin Plumbing',
      'Mr. Rooter Plumbing of Nashville',
    ],
  },
  {
    id: 'X4', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      'Here are some well-reviewed plumbers in Nashville:',
      '',
      '1. **Hiller Plumbing**',
      '2. **Radiant Plumbing & Air**',
      '3. **Mr. Rooter Plumbing**',
      '',
      "Smaller shops like Joe's Plumbing also get good reviews for routine repairs.",
    ),
    named: true, position: null, competitors: ['Hiller Plumbing', 'Radiant Plumbing & Air', 'Mr. Rooter Plumbing'],
  },
  {
    id: 'X5', name: 'Bastion', service: 'restaurants',
    answer: lines(
      '| Restaurant | Why go |',
      '|---|---|',
      '| The Catbird Seat | Tasting menu |',
      '| Bastion | Big bar nachos |',
      '| Rolf and Daughters | Pasta |',
      '| Husk | Southern cooking |',
    ),
    named: true, position: 2, competitors: ['The Catbird Seat', 'Rolf and Daughters', 'Husk'],
  },
  {
    id: 'X6', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '**Parlour:** Color specialists in 12 South.',
      '**Hair Bar Nashville:** Blowouts.',
      '**Fox & Jane:** Modern cuts.',
    ),
    named: true, position: 1, competitors: ['Hair Bar Nashville', 'Fox & Jane'],
  },
  {
    id: 'X7', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '### 1. Hiller Plumbing',
      '- 24/7 Emergency Service',
      '- Known For: Big jobs',
      '### 2. Radiant Plumbing & Air',
      '- Upfront Pricing',
      '### 3. Benjamin Franklin Plumbing',
      '- On-Time Promise',
    ),
    named: false, position: null, competitors: ['Hiller Plumbing', 'Radiant Plumbing & Air', 'Benjamin Franklin Plumbing'],
  },
  {
    id: 'Z1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '### 1. Hiller Plumbing',
      'Big and fast.',
      '### 2. Things To Consider',
      'Check licenses.',
      '### 3. Bottom Line',
      'Call two shops.',
    ),
    named: false, position: null, competitors: ['Hiller Plumbing'],
  },
  // V37: one-word names, pick labels, notes and acronym names.
  {
    id: 'W1', name: 'City House', service: 'restaurants',
    answer: lines(
      '### 1. Husk',
      '- Southern cooking in a historic house',
      '### 2. Bastion',
      '- Big bar nachos',
      '### 3. City House',
      '- Wood-fired pizza',
    ),
    named: true, position: 3, competitors: ['Husk', 'Bastion'],
  },
  {
    id: 'W2', name: 'City House', service: 'restaurants',
    answer: lines(
      '**1. Husk** - Southern cooking',
      '**2. Bastion** - nachos',
      '**3. City House** - pizza',
    ),
    named: true, position: 3, competitors: ['Husk', 'Bastion'],
  },
  {
    id: 'W3', name: 'City House', service: 'restaurants',
    answer: lines(
      '1. Husk - Southern cooking',
      '2. Bastion - nachos',
      '3. City House - pizza',
    ),
    named: true, position: 3, competitors: ['Husk', 'Bastion'],
  },
  {
    id: 'W4', name: 'City House', service: 'restaurants',
    answer: lines(
      '### 1. Husk',
      'Southern cooking in a historic house.',
      '### 2. Bastion',
      'Big bar nachos.',
      '### 3. City House',
      'Wood-fired pizza.',
    ),
    named: true, position: 3, competitors: ['Husk', 'Bastion'],
  },
  {
    id: 'T3', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '**Top pick:** Hiller Plumbing',
      '**Top Pick:** Radiant Plumbing & Air',
      "**Best Value:** Joe's Plumbing",
      '**Runner Up:** Benjamin Franklin Plumbing',
    ),
    named: true, position: 3, competitors: ['Hiller Plumbing', 'Radiant Plumbing & Air', 'Benjamin Franklin Plumbing'],
  },
  {
    id: 'T4', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      'Here are three strong plumbers:',
      '1. **Hiller Plumbing**',
      '2. **Mr. Rooter Plumbing**',
      "3. **Joe's Plumbing**",
      '',
      "**Note:** I can't check live availability.",
      '**Important:** Prices change often, so call ahead.',
      '**Heads Up:** Weekend rates are higher.',
      '**Disclaimer:** This is not an endorsement.',
      '**Pro Tip:** Book early in spring.',
    ),
    named: true, position: 3, competitors: ['Hiller Plumbing', 'Mr. Rooter Plumbing'],
  },
  {
    id: 'A1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **ABC plumbing** - fast service',
      '2. **Hiller Plumbing** - big jobs',
    ),
    named: false, position: null, competitors: ['ABC plumbing', 'Hiller Plumbing'],
  },
  {
    id: 'A2', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      'Here are good roofers:',
      '1. **Music City Roofing**',
      '2. **Volunteer Roofing**',
      '',
      'How to choose:',
      '**1. Ask For Quotes**',
      '**2. Check Reviews**',
    ),
    named: true, position: 1, competitors: ['Volunteer Roofing'],
  },
  // V40: advice-verb names, bare one-word bullets, and items under a "Tips" line.
  {
    id: 'V1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Check Mate Plumbing** - fast',
      '2. **Hiller Plumbing** - big',
      '3. **Call Today Roofing** - also does gutters',
    ),
    named: false, position: null, competitors: ['Check Mate Plumbing', 'Hiller Plumbing', 'Call Today Roofing'],
  },
  {
    id: 'V2', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. Check Mate Plumbing - fast',
      '2. Hiller Plumbing - big',
      '- Look Salon: color',
      '- Get Fit Plumbing: drains',
    ),
    named: false, position: null, competitors: ['Check Mate Plumbing', 'Hiller Plumbing', 'Look Salon', 'Get Fit Plumbing'],
  },
  {
    id: 'V4', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '1. Parlour - color specialists',
      '2. Overview - not a salon',
      '3. Kinship - cuts',
      '4. Recap - not a salon',
      '5. Free - offer',
      '6. Estimates - offer',
    ),
    named: true, position: 1, competitors: ['Kinship'],
  },
  {
    id: 'V5', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '## Our favorite salons',
      '- Parlour',
      '- Kinship',
      '- Important',
      '- Tips',
      '## Tips',
      '- Book early',
      '- Bring photos',
    ),
    named: true, position: 1, competitors: ['Kinship'],
  },
  {
    id: 'V7', name: 'Husk', service: 'restaurants',
    answer: lines(
      '1. Husk \u2014 Southern',
      '2. Bastion \u2014 nachos',
      '3. Rolf \u2014 pasta',
      '',
      'Tips:',
      '1. Reserve \u2014 weekends fill fast',
      '2. Parking \u2014 limited',
    ),
    named: true, position: 1, competitors: ['Bastion', 'Rolf'],
  },
  {
    id: 'B1', name: 'City House', service: 'restaurants',
    answer: lines(
      'Top picks:',
      '- Husk',
      '- Bastion',
      '- City House',
    ),
    named: true, position: 3, competitors: ['Husk', 'Bastion'],
  },
  {
    id: 'B2', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Hiller Plumbing**',
      "2. **Joe's Plumbing**",
      '',
      'Tips:',
      '- Ask for a written estimate',
      '- Check Google reviews',
    ),
    named: true, position: 2, competitors: ['Hiller Plumbing'],
  },
];

for (const c of MORE_CASES) {
  test(`name-match table ${c.id}: ${c.name} (${c.service})`, () => {
    const r = analyzeAnswer(c.answer, { name: c.name, city: 'Nashville', state: 'TN', service: c.service });
    assert.equal(r.named, c.named, 'named');
    assert.equal(r.position, c.position, 'position');
    assert.deepEqual(r.competitors, c.competitors, 'competitors in order');
  });
}
