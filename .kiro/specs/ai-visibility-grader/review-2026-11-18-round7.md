# Review round 7 of the Kiro grader rebuild (Nov 18, 2026)

The code reviewer re-ran its scripts on commit c0f0a73. The four V34 cases pass (The Catbird Seat and Rolf and Daughters stay businesses with "Known For" bullets, Mr. Rooter keeps position 1 with Hiller kept, "### 1. The Local" is named at position 1), all V32 group cases still pass, V1 to V11 and V22 still hold, security is unchanged, and the suite passes 1026/1026.

But the competitor-name fixes keep trading one case for another, because each round was tested against only a few answers. This round fixes that for good: one table of 23 realistic AI answers, each with the exact result we want. Add V35 to tasks.md under "Review fixes". No shell commands.

## V35. Make server/lib/name-match.js pass this whole table, and add it as a test

1. Create test/grade-name-match-cases.test.js (a new file; do not change existing tests). For each case below, call `analyzeAnswer(answer, { name, city: 'Nashville', state: 'TN', service })` and check: `named`, `position`, and the list of names in order (the business's own name at `position`, `competitors` = the rest in order). Copy each answer text exactly as written below.
2. Then change name-match.js until every case would pass. Work through the cases by hand, line by line, because you can't run the tests; the cloud will run them and send you any failures.

### The rule to use for headings (decide once per answer, for all numbered headings of the same kind)
- If the business being checked appears as a numbered heading (or a numbered bold line), those headings are businesses and the bullets under them are details (dishes, offers, "Label: value" lines), never names.
- If the business being checked appears as a bullet under a numbered heading, those headings are groups (categories, places, price bands) and the bullets under them are business names.
- If the business isn't in the answer, a numbered heading is a group when it holds a plural group noun (Plumbers, Picks, Options, Restaurants, Spots, Salons, Roofers) or a known place or category word; otherwise it is a business.
- Unnumbered section headings ("## Best Overall", "## Best Value", "Overview", "Final Thoughts") are never names.

### Bullets
- "Name: description", "Name - description", "Name – description" and "[Name](link): description" bullets: the name is the part before the separator, unless that part is a label from a short fixed list (Known For, Best For, Must Try, Price, Price Range, Phone, Address, Hours, Why, Rating, Specialty, Notes). Then it is a detail, not a name.
- Indented bullets under a numbered name are details.
- Lines that are only an offer phrase (Free Estimates, Same Day Service, Same-Day Service Available, 24/7 Emergency Service, Licensed and Insured, Family Owned) are never names.
- A plain-sentence bullet that starts with a business name ("Music City Roofing, which handles storm repairs.") gives that name; a sentence like "Check Google reviews before hiring." gives none.
- The business's own name is never filtered out by any of these rules.

### The cases (business; service; answer; expected names in order; expected position)

P1. Joe's Plumbing; plumbers.
```
### 1. Hiller Plumbing
- Same Day Service
- Free Estimates
### 2. Joe's Plumbing
- Licensed and insured
### 3. Radiant Plumbing & Air
- 24/7 Emergency Service
```
Expected: Hiller Plumbing, Joe's Plumbing, Radiant Plumbing & Air. Position 2.

P2. Joe's Plumbing; plumbers.
```
### 1. Emergency Plumbers
- Hiller Plumbing
- Mr. Rooter Plumbing
### 2. Budget Picks
- Joe's Plumbing
- Plumbing Pros of Nashville
```
Expected: Hiller Plumbing, Mr. Rooter Plumbing, Joe's Plumbing, Plumbing Pros of Nashville. Position 3.

P3. Joe's Plumbing; plumbers.
```
1. **Hiller Plumbing**
- Phone: (615) 555-0100
- Free Estimates
2. **Joe's Plumbing**
- Family Owned
3. **Benjamin Franklin Plumbing**
```
Expected: Hiller Plumbing, Joe's Plumbing, Benjamin Franklin Plumbing. Position 2.

P4. Joe's Plumbing; plumbers.
```
Good options include **Hiller Plumbing**, **Mr. Rooter Plumbing** and **Joe's Plumbing**. Many offer free estimates.
```
Expected: Hiller Plumbing, Mr. Rooter Plumbing, Joe's Plumbing. Position 3.

P5. Joe's Plumbing; plumbers.
```
- [Hiller Plumbing](https://www.hillerplumbing.com) - 24/7 service
- [Joe's Plumbing](https://joesplumbing.com): small, family run
- [Mr. Rooter](https://mrrooter.com): drains
```
Expected: Hiller Plumbing, Joe's Plumbing, Mr. Rooter. Position 2.

P6. Joe's Plumbing; plumbers.
```
For emergencies, **Hiller Plumbing** is the big name. Smaller shops like **Joe's Plumbing** and **Radiant Plumbing & Air** get strong reviews. For drains, try **Mr. Rooter Plumbing**.
```
Expected: Hiller Plumbing, Joe's Plumbing, Radiant Plumbing & Air, Mr. Rooter Plumbing. Position 2.

R1. Music City Roofing; roofers.
```
Here are top roofers in Nashville:

1. **Music City Roofing** - Family owned since 1998.
2. **Nashville Roofing Pros** - Free inspections.
3. **Top Notch Roofing**
4. Free Estimates
5. **Family Owned Roofing & Repair**
```
Expected: Music City Roofing, Nashville Roofing Pros, Top Notch Roofing, Family Owned Roofing & Repair. Position 1.

R2. Music City Roofing; roofers.
```
## Best Overall
### 1. Music City Roofing
Known for storm repair.
- Free Estimates
- Licensed and Insured
## Best Value
### 2. Volunteer Roofing
- Same Day Service
```
Expected: Music City Roofing, Volunteer Roofing. Position 1.

R3. Music City Roofing; roofers.
```
| Company | Known For | Rating |
|---|---|---|
| Music City Roofing | Storm repair | 4.8 |
| Volunteer Roofing | Metal roofs | 4.7 |
| Mr. Roof | Replacements | 4.6 |
```
Expected: Music City Roofing, Volunteer Roofing, Mr. Roof. Position 1.

S5. Music City Roofing; roofers.
```
1. **Music City Roofing**
   - Storm Damage Repair
   - Metal Roofs
2. **Volunteer Roofing**
   - Gutter Installation
```
Expected: Music City Roofing, Volunteer Roofing. Position 1.

S6. Music City Roofing; roofers.
```
Some options worth calling:
- Music City Roofing, which handles storm repairs.
- Volunteer Roofing is a smaller crew.
- Check Google reviews before hiring.
```
Expected: Music City Roofing, Volunteer Roofing. Position 1.

F1. The Catbird Seat; restaurants.
```
### 1. Fine Dining
- **The Catbird Seat** - tasting menu
- **Bastion** - small plates
### 2. Hot Chicken
- **Hattie B's Hot Chicken**
- **Prince's Hot Chicken Shack**
```
Expected: The Catbird Seat, Bastion, Hattie B's Hot Chicken, Prince's Hot Chicken Shack. Position 1.

F2. The Local; restaurants.
```
1. **The Local** - neighborhood spot
2. **Rolf and Daughters**
3. **Family Wash**
4. **Open Kitchen**
```
Expected: The Local, Rolf and Daughters, Family Wash, Open Kitchen. Position 1.

F3. Rolf and Daughters; restaurants.
```
**1. Germantown**
- Rolf and Daughters
- City House
**2. East Nashville**
- Lockeland Table
```
Expected: Rolf and Daughters, City House, Lockeland Table. Position 1.

F4. Bastion; restaurants.
```
### 1. Fine Dining
- The Catbird Seat: tasting menu
- Bastion: small plates
### 2. Casual
- Hattie B's: hot chicken
- Arnold's Country Kitchen: meat and three
```
Expected: The Catbird Seat, Bastion, Hattie B's, Arnold's Country Kitchen. Position 2.

F5. Bastion; restaurants.
```
### 1. City House
- Belly Ham Pizza
- Wood Fired Oven
### 2. Bastion
- Big Bar Nachos
### 3. Husk Nashville
- Southern Tasting Menu
```
Expected: City House, Bastion, Husk Nashville. Position 2.

S1. Bastion; restaurants.
```
### 1. The Catbird Seat
- Known For: Tasting Menu
- Price Range: High
### 2. Bastion
- Known For: Big Bar Nachos
### 3. Rolf and Daughters
- Must Try: Garganelli Verde
```
Expected: The Catbird Seat, Bastion, Rolf and Daughters. Position 2. (A one-word heading that is the business itself still gets its position.)

S2. Mr. Rooter; plumbers.
```
**1. Mr. Rooter**
- Best For: Drain Clogs
**2. Hiller**
- Best For: Big Jobs
**3. Benjamin Franklin**
```
Expected: Mr. Rooter, Hiller, Benjamin Franklin. Position 1.

S3. Joe's Plumbing; plumbers.
```
### 1. Bastion
Great small plates.
### 2. Overview
Some text.
### 3. Final Thoughts
Call ahead.
```
Expected: named false, position null. Competitors must not include "Overview" or "Final Thoughts" (Bastion may be listed or not).

S4. The Local; restaurants.
```
### 1. The Local
- Neighborhood Favorite
- Great Patio
### 2. City House
- Wood Fired Pizza
```
Expected: The Local, City House. Position 1.

S7. Joe's Plumbing; plumbers.
```
### 1. Nashville's Top Picks
- Hiller Plumbing
- Joe's Plumbing
```
Expected: Hiller Plumbing, Joe's Plumbing. Position 2.

H1. Parlour Salon; hair salons.
```
Here are some well-reviewed hair salons in Nashville:

1. **Parlour Salon** – Known for color work in 12 South.
2. **Hair Bar Nashville** – Blowouts and styling.
3. **Salon Lofts Green Hills** – Independent stylists.
4. **Fox & Jane** – Modern cuts.
```
Expected: Parlour Salon, Hair Bar Nashville, Salon Lofts Green Hills, Fox & Jane. Position 1.

H2. Fox & Jane; hair salons.
```
A few popular options:
- Parlour: color specialists in 12 South
- Fox & Jane: modern cuts, easy online booking
- Hair Bar Nashville: blowouts
- Salon Lofts: booth renters
```
Expected: Parlour, Fox & Jane, Hair Bar Nashville, Salon Lofts. Position 2.

Today (c0f0a73) these already pass: P1, P2, P3, P4, P6, R1, R2, R3, F1, F2, F3, S2, S3, H1. These fail: P5 (Mr. Rooter dropped), S5 (nested bullets listed), S6 (no names read), F4 (Fine Dining listed, The Catbird Seat dropped), F5 (dishes listed, restaurants dropped), S1 (Bastion has no position), S4 (Wood Fired Pizza listed), S7 (heading listed), H2 (Parlour and Hair Bar Nashville dropped). Keep the passing ones passing.
