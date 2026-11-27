# Review round 13 of the Kiro grader rebuild (Nov 18, 2026)

Written by Claude (review notes only; Kiro writes all code).

The code reviewer checked commit 926b55d. V41, V42 and V43 are fixed:
- Advice-verb names with business endings are kept.
- "&" and "and" match in lists, sentences and headings, and "Smith & Wesson" is not mistaken for "Smith".
- Sentence bullets ("- X has…") work, and advice under "Before you call:" stays advice.
- A 120 KB line of broken link marks takes 4 ms.

Colby's real Capital City answer now reads named, 3rd of 5. Its "Other names to check" list is read too; the last two names fall past the cap of 5 competitors, which is fine. V1 to V11 and V22 hold, security is unchanged, the suite passes 1098/1098, and a 120 KB answer takes 32 ms.

One gap remains, and it has been in every rebuild so far, so it is not new in this commit. Add V44 to tasks.md under "Review fixes" in a new section "N. Round 13 (`review-2026-11-18-round13.md`)". Add the 8 cases below to `MORE_CASES` in test/grade-name-match-cases.test.js, leaving the 62 existing cases exactly as they are, and change server/lib/name-match.js until all 70 pass. No shell commands; the cloud runs the tests.

## V44. Numbered lines written as sentences

AI answers often write a numbered list as sentences: "1. Hiller Plumbing is the biggest shop in town." Today the rebuild reads no names from these lines, so the business gets no position or the wrong one (N1 to N5). For example, it says 1st when the answer put it 3rd. The original code read them. Also, one-word names in sentence bullets are dropped ("- Bastion has big bar nachos.", N6).

- Apply V43's sentence-name rule to numbered lines too, not only to bullets. The name is the Title Case words before the first lowercase verb ("is", "has", "offers", "serves", "specializes", "handles"…) or before ", which" or ", a". The name must not come back as the whole sentence: never "Husk serves Southern food in a historic house."
- A one-word name before a verb counts (Husk, Bastion, Parlour), in numbered lines and in bullets, under the same section-word rules as V37 (never Overview, Tips, Note…).
- Advice stays advice. Apply the small-word check (for, about, from, on, with, to, the, a, an, in, at) to the name part before the trade-word check, so "Get Quotes From Three Plumbers is a good idea." is not a name (G5). A line that starts with a pronoun ("It is also worth calling…") is never a name (G6). Items under a heading like "Before you hire:" stay advice.

## New cases (business; service; answer; expected)

N1. Joe's Plumbing; plumbers.
```
1. Hiller Plumbing is the biggest shop in town.
2. Radiant Plumbing & Air offers upfront pricing.
3. Joe's Plumbing has a 4.9 rating from 40 reviews.
```
Expected: named true, position 3, competitors ["Hiller Plumbing", "Radiant Plumbing & Air"].

N2. Fox & Jane; hair salons.
```
1. Parlour is known for color work.
2. Hair Bar Nashville offers blowouts.
3. Fox and Jane has modern cuts.
```
Expected: named true, position 3, competitors ["Parlour", "Hair Bar Nashville"].

N3. City House; restaurants.
```
1. Husk serves Southern food in a historic house.
2. Rolf and Daughters is known for pasta.
3. City House has wood-fired pizza.
```
Expected: named true, position 3, competitors ["Husk", "Rolf and Daughters"].

N4. Volunteer Roofing; roofers.
```
1. Music City Roofing, which handles storm repairs.
2. Volunteer Roofing, a smaller crew.
```
Expected: named true, position 2, competitors ["Music City Roofing"].

N5. Volunteer Roofing; roofers.
```
1. Music City Roofing has handled storm repairs for 20 years.
2. Volunteer Roofing offers free inspections.
3. Get It Right Roofing specializes in metal roofs.
```
Expected: named true, position 2, competitors ["Music City Roofing", "Get It Right Roofing"].

N6. Husk; restaurants.
```
- Husk serves Southern food.
- Bastion has big bar nachos.
- City House is known for pizza.
```
Expected: named true, position 1, competitors ["Bastion", "City House"].

G5. Joe's Plumbing; plumbers.
```
1. Hiller Plumbing is the biggest shop in town.
2. Joe's Plumbing has a 4.9 rating.

Before you hire:
1. Ask for a written estimate before work starts.
2. Check that the license is current.
3. Get Quotes From Three Plumbers is a good idea.
```
Expected: named true, position 2, competitors ["Hiller Plumbing"].

G6. Music City Roofing; roofers.
```
1. Music City Roofing is the busiest crew in town.
2. Volunteer Roofing has the most reviews.
3. It is also worth calling two shops before you choose.
```
Expected: named true, position 1, competitors ["Volunteer Roofing"].

Results today (926b55d):

| Case | named | position | competitors |
|---|---|---|---|
| N1 | true | null | [] |
| N2 | true | null | [] |
| N3 | true | 1 | [] |
| N4 | true | 1 | [] |
| N5 | true | 1 | [] |
| N6 | true | 1 | ["City House"] |
| G5 | true | null | [] |
| G6 | true | null | [] |

The original code got N1, N5 and N6 right, gave the whole sentence as a name in N3 and N4, and listed "Get Quotes From Three Plumbers" and "It" as competitors in G5 and G6.
