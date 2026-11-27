# Review round 8 of the Kiro grader rebuild (Nov 18, 2026)

The code reviewer ran a final pass on commit 7edd7f1. On every earlier case the rebuild is now equal to or better than the original code, the suite passes 1049/1049, V1 to V11 and V22 still hold, the address guard and safe fetcher are unchanged, there are no new log lines, and a 120 KB answer takes 34 ms.

One common answer format still fails, and it has been missing since the first build: "**Name:** description" lines lose the whole competitor list. ChatGPT and Claude use this format a lot. In server/lib/name-match.js, `fromListContent` and `namesFromBullet` drop any line shaped `**...:** text`. Drop it only when the bold text is a detail label (the same short label list as V35: Known For, Best For, Must Try, Price, Price Range, Phone, Address, Hours, Why, Rating, Specialty, Notes, Tips). Otherwise the bold text before the colon is the name.

Add V36 to tasks.md under "Review fixes". Add the 11 cases below to test/grade-name-match-cases.test.js, keeping all 23 existing cases exactly as they are. Some new cases need `named` with no position, or not named with competitors, so give each new case `named`, `position` (a number or null) and `competitors` (the expected list, in order), and check those three. Then change name-match.js until every case passes, the old 23 included. No shell commands; the cloud runs the tests.

## New cases (business; service; answer; expected)

Y1. Joe's Plumbing; plumbers.
```
1. **Hiller Plumbing:** The biggest name in town.
2. **Joe's Plumbing:** Small and honest.
3. **Radiant Plumbing & Air:** Upfront pricing.
```
Expected: named true, position 2, competitors ["Hiller Plumbing", "Radiant Plumbing & Air"].

Y2. Parlour; hair salons.
```
- **Parlour:** Color specialists.
- **Hair Bar Nashville:** Blowouts.
- **Fox & Jane:** Modern cuts.
```
Expected: named true, position 1, competitors ["Hair Bar Nashville", "Fox & Jane"].

Y3. Joe's Plumbing; plumbers.
```
1. **Hiller Plumbing:** The biggest name in town.
2. **Radiant Plumbing & Air:** Upfront pricing.
```
Expected: named false, position null, competitors ["Hiller Plumbing", "Radiant Plumbing & Air"].

X1. Volunteer Roofing; roofers.
```
1. Music City Roofing — storm and hail repair, 20+ years
2. Volunteer Roofing — metal roofs and inspections
3. Mr. Roof — fast replacements
4. Roof Life of Nashville — family run
```
Expected: named true, position 2, competitors ["Music City Roofing", "Mr. Roof", "Roof Life of Nashville"].

X2. Parlour; hair salons.
```
- [Parlour](https://parlournashville.com)
- [Hair Bar Nashville](https://hairbar.com)
- [Fox & Jane](https://foxandjane.com)
- [Salon Lofts](https://salonlofts.com)
```
Expected: named true, position 1, competitors ["Hair Bar Nashville", "Fox & Jane", "Salon Lofts"].

X3. Joe's Plumbing; plumbers.
```
Finding a good plumber in Nashville comes down to reviews, licensing and how fast they answer. Based on what I found, here are five that stand out.

1. **Hiller Plumbing, Heating, Cooling & Electrical** — The biggest name in Middle Tennessee, with 24/7 service.
2. **Radiant Plumbing & Air Conditioning** — Upfront pricing and strong reviews.
3. **Joe's Plumbing** — A smaller, family-run shop known for honest quotes.
4. **Benjamin Franklin Plumbing** — Punctual, with an on-time promise.
5. **Mr. Rooter Plumbing of Nashville** — Good for drain and sewer work.

**Tips before you hire:**
- Confirm a Tennessee plumbing license.
- Ask for a written estimate.
- Check recent Google and Yelp reviews.

Prices and availability change, so call ahead.
```
Expected: named true, position 3, competitors ["Hiller Plumbing, Heating, Cooling & Electrical", "Radiant Plumbing & Air Conditioning", "Benjamin Franklin Plumbing", "Mr. Rooter Plumbing of Nashville"]. The tips heading and the tip bullets are not names.

X4. Joe's Plumbing; plumbers.
```
Here are some well-reviewed plumbers in Nashville:

1. **Hiller Plumbing**
2. **Radiant Plumbing & Air**
3. **Mr. Rooter Plumbing**

Smaller shops like Joe's Plumbing also get good reviews for routine repairs.
```
Expected: named true, position null, competitors ["Hiller Plumbing", "Radiant Plumbing & Air", "Mr. Rooter Plumbing"].

X5. Bastion; restaurants.
```
| Restaurant | Why go |
|---|---|
| The Catbird Seat | Tasting menu |
| Bastion | Big bar nachos |
| Rolf and Daughters | Pasta |
| Husk | Southern cooking |
```
Expected: named true, position 2, competitors ["The Catbird Seat", "Rolf and Daughters", "Husk"]. In a table, the first-column cells are names even when they are one word.

X6. Parlour; hair salons.
```
**Parlour:** Color specialists in 12 South.
**Hair Bar Nashville:** Blowouts.
**Fox & Jane:** Modern cuts.
```
Expected: named true, position 1, competitors ["Hair Bar Nashville", "Fox & Jane"].

X7. Joe's Plumbing; plumbers.
```
### 1. Hiller Plumbing
- 24/7 Emergency Service
- Known For: Big jobs
### 2. Radiant Plumbing & Air
- Upfront Pricing
### 3. Benjamin Franklin Plumbing
- On-Time Promise
```
Expected: named false, position null, competitors ["Hiller Plumbing", "Radiant Plumbing & Air", "Benjamin Franklin Plumbing"].

Z1. Joe's Plumbing; plumbers.
```
### 1. Hiller Plumbing
Big and fast.
### 2. Things To Consider
Check licenses.
### 3. Bottom Line
Call two shops.
```
Expected: named false, position null, competitors ["Hiller Plumbing"]. Section headings such as "Things To Consider", "How To Choose" and "Bottom Line" are never names.

Today (7edd7f1) X1, X2, X4 and X7 already pass; Y1, Y2, Y3, X3, X5, X6 and Z1 fail. Keep the passing ones and all 23 earlier cases passing.
