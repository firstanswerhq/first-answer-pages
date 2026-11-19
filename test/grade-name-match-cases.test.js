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
  // V41: advice-verb names with other business endings. V43: "and" and "&" are the same word.
  {
    id: 'E1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Ask Andy Plumbing Services** - repairs',
      '2. **Hiller Plumbing** - big jobs',
      "3. **Joe's Plumbing** - small shop",
    ),
    named: true, position: 3, competitors: ['Ask Andy Plumbing Services', 'Hiller Plumbing'],
  },
  {
    id: 'E2', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '1. **Find Your Glow Spa** - facials and cuts',
      '2. **Parlour** - color specialists',
      '3. **Hair Bar Nashville** - blowouts',
    ),
    named: true, position: 2, competitors: ['Find Your Glow Spa', 'Hair Bar Nashville'],
  },
  {
    id: 'E3', name: 'Volunteer Roofing', service: 'roofers',
    answer: lines(
      '1. Call Dave Roofing Solutions - storm repair',
      '2. Music City Roofing - metal roofs',
      '3. Volunteer Roofing - inspections',
    ),
    named: true, position: 3, competitors: ['Call Dave Roofing Solutions', 'Music City Roofing'],
  },
  {
    id: 'E4', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '- Check Mate Plumbing Group: drains',
      '- Hiller Plumbing: big jobs',
      "- Joe's Plumbing: small shop",
    ),
    named: true, position: 3, competitors: ['Check Mate Plumbing Group', 'Hiller Plumbing'],
  },
  {
    id: 'E5', name: 'Husk', service: 'restaurants',
    answer: lines(
      '1. **Book It Garage** - burgers in an old garage',
      '2. **Husk** - Southern',
    ),
    named: true, position: 2, competitors: ['Book It Garage'],
  },
  {
    id: 'G1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Hiller Plumbing** - big jobs',
      "2. **Joe's Plumbing** - small shop",
      '',
      'How to choose:',
      '1. **Compare Services** - not every shop does gas lines',
      '2. **Get Multiple Quotes** - at least two',
      '3. **Ask About Warranty Services** - labor and parts',
      '4. **Check Licensing** - Tennessee license',
    ),
    named: true, position: 2, competitors: ['Hiller Plumbing'],
  },
  {
    id: 'G2', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      'Here are three roofers:',
      '1. **Music City Roofing**',
      '2. **Volunteer Roofing**',
      '3. **Mr. Roof**',
      '',
      '**Book Early For Spring Services**',
      '**Ask For References From The Company**',
      '**Read Reviews On Google**',
    ),
    named: true, position: 1, competitors: ['Volunteer Roofing', 'Mr. Roof'],
  },
  {
    id: 'G3', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '- **Parlour:** color',
      '- **Kinship:** cuts',
      '- **Book Your Consultation:** most salons offer one free',
      '- **Ask About Studio Policies:** cancellations vary',
    ),
    named: true, position: 1, competitors: ['Kinship'],
  },
  {
    id: 'C1', name: 'Capital city window and pressure cleaning', service: 'Window cleaning and pressure cleaning',
    answer: lines(
      "This is my top 5 for businesses that do both window cleaning and pressure washing in Tallahassee. I built it from what's offered and from Yelp and directory listings, not from my own testing. Most of these companies have only a few reviews, so treat it as a shortlist and not a definitive ranking.",
      '',
      "1. **Joe Pogo's Window Cleaning.** Joe Pogorzelski has provided residential and commercial pressure washing and window cleaning in Tallahassee for more than 16 years. It has a 5.0 rating on Yelp from 3 reviews. That long track record is why it's first.",
      '',
      "2. **Cleanscapes Exterior Cleaning.** It specializes in pressure washing, soft washing, window cleaning and gutter cleaning. It is licensed and insured and has a 4.4 rating from 5 reviews on Yelp. That's the largest review base among the highly rated options.",
      '',
      "3. **Capital City Window & Pressure Cleaning.** It's locally owned and operated and says it will beat or match prices. It appears near the top of Yelp's window-washing and pressure-washing lists. I couldn't see its star rating in the results.",
      '',
      "4. **College Cleaning Crew.** It leads Yelp's window-washing and pressure-washing lists. Its Yelp rating is 4.3 from 6 reviews. It's a good choice if you want an affordable option.",
      '',
      '5. **Premier Pressure Washing & Window Cleaning Services.** It offers house washing, roof cleaning, window cleaning and driveway cleaning and serves Tallahassee, Havana, Midway and Quincy. I found little independent review data for it, so check its reviews yourself.',
      '',
      '**Other names to check:**',
      '- Get It Done Window Washing has a 5.0 rating from 1 review.',
    ),
    named: true, position: 3,
    competitors: [
      "Joe Pogo's Window Cleaning", 'Cleanscapes Exterior Cleaning', 'College Cleaning Crew',
      'Premier Pressure Washing & Window Cleaning Services', 'Get It Done Window Washing',
    ],
  },
  {
    id: 'C2', name: 'Capital city window and pressure cleaning', service: 'Window cleaning and pressure cleaning',
    answer: "Good options include Joe Pogo's Window Cleaning and Capital City Window & Pressure Cleaning, which both do windows and pressure washing.",
    named: true, position: null, competitors: [],
  },
  {
    id: 'C3', name: 'Smith and Sons Plumbing', service: 'plumbers',
    answer: 'For drains, try Smith & Sons Plumbing. They answer the phone fast.',
    named: true, position: null, competitors: [],
  },
  {
    id: 'C4', name: 'Smith & Sons Plumbing', service: 'plumbers',
    answer: 'For drains, try Smith and Sons Plumbing. They answer the phone fast.',
    named: true, position: null, competitors: [],
  },
  {
    id: 'G4', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Hiller Plumbing.** Big jobs.',
      "2. **Joe's Plumbing.** Small shop.",
      '',
      '**Before you call:**',
      '- Get a written estimate before work starts.',
      '- Check that the license is current.',
    ),
    named: true, position: 2, competitors: ['Hiller Plumbing'],
  },
  // V44: numbered lines written as sentences, and one-word names before a verb.
  {
    id: 'N1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. Hiller Plumbing is the biggest shop in town.',
      '2. Radiant Plumbing & Air offers upfront pricing.',
      "3. Joe's Plumbing has a 4.9 rating from 40 reviews.",
    ),
    named: true, position: 3, competitors: ['Hiller Plumbing', 'Radiant Plumbing & Air'],
  },
  {
    id: 'N2', name: 'Fox & Jane', service: 'hair salons',
    answer: lines(
      '1. Parlour is known for color work.',
      '2. Hair Bar Nashville offers blowouts.',
      '3. Fox and Jane has modern cuts.',
    ),
    named: true, position: 3, competitors: ['Parlour', 'Hair Bar Nashville'],
  },
  {
    id: 'N3', name: 'City House', service: 'restaurants',
    answer: lines(
      '1. Husk serves Southern food in a historic house.',
      '2. Rolf and Daughters is known for pasta.',
      '3. City House has wood-fired pizza.',
    ),
    named: true, position: 3, competitors: ['Husk', 'Rolf and Daughters'],
  },
  {
    id: 'N4', name: 'Volunteer Roofing', service: 'roofers',
    answer: lines(
      '1. Music City Roofing, which handles storm repairs.',
      '2. Volunteer Roofing, a smaller crew.',
    ),
    named: true, position: 2, competitors: ['Music City Roofing'],
  },
  {
    id: 'N5', name: 'Volunteer Roofing', service: 'roofers',
    answer: lines(
      '1. Music City Roofing has handled storm repairs for 20 years.',
      '2. Volunteer Roofing offers free inspections.',
      '3. Get It Right Roofing specializes in metal roofs.',
    ),
    named: true, position: 2, competitors: ['Music City Roofing', 'Get It Right Roofing'],
  },
  {
    id: 'N6', name: 'Husk', service: 'restaurants',
    answer: lines(
      '- Husk serves Southern food.',
      '- Bastion has big bar nachos.',
      '- City House is known for pizza.',
    ),
    named: true, position: 1, competitors: ['Bastion', 'City House'],
  },
  {
    id: 'G5', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. Hiller Plumbing is the biggest shop in town.',
      "2. Joe's Plumbing has a 4.9 rating.",
      '',
      'Before you hire:',
      '1. Ask for a written estimate before work starts.',
      '2. Check that the license is current.',
      '3. Get Quotes From Three Plumbers is a good idea.',
    ),
    named: true, position: 2, competitors: ['Hiller Plumbing'],
  },
  {
    id: 'G6', name: 'Music City Roofing', service: 'roofers',
    answer: lines(
      '1. Music City Roofing is the busiest crew in town.',
      '2. Volunteer Roofing has the most reviews.',
      '3. It is also worth calling two shops before you choose.',
    ),
    named: true, position: 1, competitors: ['Volunteer Roofing'],
  },
  // V50: a bold name is the whole name, even with a lowercase word inside it.
  {
    id: 'K1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      "1. **Mike's mobile Plumbing** - fast",
      "2. **Joe's Plumbing** - small",
    ),
    named: true, position: 2, competitors: ["Mike's mobile Plumbing"],
  },
  {
    id: 'K2', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '1. **Sparkle drain Pros** - fast',
      "2. **Joe's Plumbing** - small",
    ),
    named: true, position: 2, competitors: ['Sparkle drain Pros'],
  },
  {
    id: 'K3', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      "1. **Mike's mobile Plumbing** is fast.",
      "2. **Joe's Plumbing** is small.",
    ),
    named: true, position: 2, competitors: ["Mike's mobile Plumbing"],
  },
  {
    id: 'K4', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      "- **Mike's mobile Plumbing**: fast",
      "- **Joe's Plumbing**: small",
    ),
    named: true, position: 2, competitors: ["Mike's mobile Plumbing"],
  },
  {
    id: 'K5', name: 'aA aa', service: 'plumbers',
    answer: lines(
      '1. **aA aa** - well reviewed',
      '2. **Aa Ab aAA Aa** - well reviewed',
    ),
    named: true, position: 1, competitors: ['Aa Ab aAA Aa'],
  },
  // V51: bold names with a lowercase word at the start or end, standalone bold names, and headings that stay out.
  {
    id: 'L1', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      "1. **Mike's plumbing** - small shop",
      '2. **Hiller Plumbing** - big',
      "3. **Joe's Plumbing** - honest",
    ),
    named: true, position: 3, competitors: ["Mike's plumbing", 'Hiller Plumbing'],
  },
  {
    id: 'L2', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '1. **iFix Hair** - cuts',
      '2. **the Hair Bar** - blowouts',
      '3. **Parlour** - color',
    ),
    named: true, position: 3, competitors: ['iFix Hair', 'the Hair Bar'],
  },
  {
    id: 'L3', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '- **Fox and Jane salon** - modern cuts',
      '- **Parlour** - color',
      '- **Salon Lofts** - booth rental',
    ),
    named: true, position: 2, competitors: ['Fox and Jane salon', 'Salon Lofts'],
  },
  {
    id: 'L4', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '**Hiller Plumbing**',
      'The biggest shop in town.',
      '',
      "**Mike's mobile Plumbing**",
      'Comes to you.',
      '',
      "**Joe's Plumbing**",
      'Small and honest.',
    ),
    named: true, position: 3, competitors: ['Hiller Plumbing', "Mike's mobile Plumbing"],
  },
  {
    id: 'G7', name: "Joe's Plumbing", service: 'plumbers',
    answer: lines(
      '**Hiller Plumbing**',
      'The biggest shop in town.',
      '',
      "**Joe's Plumbing**",
      'Small and honest.',
      '',
      '**Before you hire a plumber**',
      'Ask for a written estimate.',
      '',
      '**Our top picks for you**',
      'These are the two we trust most.',
    ),
    named: true, position: 2, competitors: ['Hiller Plumbing'],
  },
  {
    id: 'G8', name: 'Parlour', service: 'hair salons',
    answer: lines(
      '1. **Parlour** - color',
      '2. **Kinship** - cuts',
      '',
      '**a quick note on prices**',
      'Prices change often.',
    ),
    named: true, position: 1, competitors: ['Kinship'],
  },
  // V54: restaurant words, and names that start with This, Here or We.
  {
    id: 'P1', name: 'City House', service: 'restaurants',
    answer: lines(
      '1. **Husk** - Southern',
      "2. **Mama's kitchen** - comfort food",
      '3. **City House** - pizza',
    ),
    named: true, position: 3, competitors: ['Husk', "Mama's kitchen"],
  },
  {
    id: 'P2', name: 'City House', service: 'restaurants',
    answer: lines(
      '- **Your Pie pizza**: build your own',
      '- **Bastion**: nachos',
      '- **City House**: pizza',
    ),
    named: true, position: 3, competitors: ['Your Pie pizza', 'Bastion'],
  },
  {
    id: 'P3', name: 'City House', service: 'restaurants',
    answer: lines(
      '1. This Is It BBQ is a local favorite.',
      '2. Here Kitchen has a great patio.',
      '3. City House has wood-fired pizza.',
    ),
    named: true, position: 3, competitors: ['This Is It BBQ', 'Here Kitchen'],
  },
  {
    id: 'P4', name: 'City House', service: 'restaurants',
    answer: lines(
      '- We Taco Bout It serves street tacos.',
      '- City House is known for pizza.',
    ),
    named: true, position: 2, competitors: ['We Taco Bout It'],
  },
  {
    id: 'G9', name: 'City House', service: 'restaurants',
    answer: lines(
      '1. Husk serves Southern food.',
      '2. City House has wood-fired pizza.',
      '3. This is a great pick for families.',
      '4. We recommend calling ahead on weekends.',
      '5. Here is a tip: go early.',
    ),
    named: true, position: 2, competitors: ['Husk'],
  },
  {
    id: 'G10', name: 'City House', service: 'restaurants',
    answer: lines(
      '- **Husk**: Southern',
      '- **City House**: pizza',
      '- **Book a table**: weekends fill fast',
      "- **Try the pizza**: it's the best",
    ),
    named: true, position: 2, competitors: ['Husk'],
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
