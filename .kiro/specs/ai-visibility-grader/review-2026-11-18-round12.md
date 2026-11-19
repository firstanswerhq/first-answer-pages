# Review round 12 of the Kiro grader rebuild (Nov 18, 2026)

Written by Claude (review notes only; Kiro writes all code).

The code reviewer checked commit afd8971. V40 is fixed: "Check Mate Plumbing" and "Call Today Roofing" are kept, bare one-word bullets like "- Husk" work, "Tips:" and "How to choose:" items are no longer listed, and "Free" is gone. Keeping bold advice-verb names without a trade word dropped ("**Look Boutique**") is fine: the original drops them too. V1 to V11 and V22 hold, security is unchanged (address guard fuzz shows 0 differences, no new log lines, the ranked list escapes every name), the suite passes 1084/1084, and a 120 KB answer takes 29 ms.

Two gaps remain, plus one small speed fix. V43 comes from the owner's own live check tonight (10:51 PM) and matters most. Add a new section "M. Round 12 (`review-2026-11-18-round12.md`)" to tasks.md under "Review fixes" with V41, V42 and V43. Add the 13 cases below to `MORE_CASES` in test/grade-name-match-cases.test.js, leaving the 49 existing cases exactly as they are, and change server/lib/name-match.js until all 62 pass. For V42 change server/lib/grade-html.js and add one test to test/grade-report-list.test.js (additions only). No shell commands; the cloud runs the tests.

## V43. "and" and "&" are the same word (the owner's live check)

Colby checked his client "Capital city window and pressure cleaning" on the live site. Claude's answer listed "**Capital City Window & Pressure Cleaning.**" 3rd, but the live report said "It named these 2 businesses, not yours" and scored 61 instead of about 92. The live code fails because of "and" versus "&". The rebuild gets the numbered list right (case C1 already passes for named and position), but it still fails when the AI writes the name in a sentence: an owner who types "and" is missed when the AI writes "&", and the reverse (C2 to C4).

- When matching the business's own name, treat "&" and "and" between words as the same word, both in the name the owner typed and in the answer. This applies to numbered lists, bullets, headings and plain sentences.
- In a bullet that is a sentence ("- Get It Done Window Washing has a 5.0 rating from 1 review."), the name is the Title Case words before the first lowercase verb. Apply the advice-verb rule to that name part only, so "Get It Done Window Washing" is a name (it ends in a trade word) and "- Get a written estimate before work starts." stays advice (G4).
- A bold "**Name.**" with the period inside the bold is a name, without the period (C1 and G4 already pass; keep them passing).

## V41. Advice-verb names with other business endings

`endsWithTradeOrLegal` only accepts the TRADE and LEGAL words, so real names that start with an advice verb and end in a business word such as Services, Solutions, Group, Spa or Garage are dropped (E1 to E5 below). The original code kept them. Because the report now numbers the list in the AI's order with "(you)" in place, a dropped name moves the business up a place, which overstates its rank.

The fix must not bring back advice lines that end in the same words. The original code listed "Compare Services", "Ask About Warranty Services", "Book Early For Spring Services", "Ask For References From The Company" and "Book Your Consultation" as competitors; the rebuild drops them today, and it must keep dropping them (G1 to G3).

A rule that passes every case (use it or any other rule that passes all 57):
- A line that starts with an advice verb is a name when its last word is a trade or legal word (as today), or a business ending: services, service, solutions, group, spa, garage, auto, movers, moving, builders, pest, control, locksmith, pros, studio, and
- when that last word is a business ending (not a trade or legal word), there is at least one word between the verb and the ending, and
- the line has none of these small words: for, about, from, on, with, to, the, a, an, in, at.

## V42. Cap the link pattern in `readableAnswer`

In `readableAnswer` (server/lib/grade-html.js) the `[name](link)` pattern slows down badly on a long line with many "[" and no "]": 32 KB takes 775 ms and 120 KB takes 11 seconds. Stored answers are capped at 4,000 characters, so only Google's live answer (not capped) is exposed, and only to broken model output. Cap the link text length, for example `\[([^\]\n]{1,200})\]\([^)\n]{0,2000}\)`, and check the other patterns in `readableAnswer` the same way. Add one test: a 120,000-character line made of "[a" repeated finishes in under 1 second, and normal links ("[Parlour](https://parlournashville.com)") still turn into just the name.

## New cases (business; service; answer; expected)

E1. Joe's Plumbing; plumbers.
```
1. **Ask Andy Plumbing Services** - repairs
2. **Hiller Plumbing** - big jobs
3. **Joe's Plumbing** - small shop
```
Expected: named true, position 3, competitors ["Ask Andy Plumbing Services", "Hiller Plumbing"].

E2. Parlour; hair salons.
```
1. **Find Your Glow Spa** - facials and cuts
2. **Parlour** - color specialists
3. **Hair Bar Nashville** - blowouts
```
Expected: named true, position 2, competitors ["Find Your Glow Spa", "Hair Bar Nashville"].

E3. Volunteer Roofing; roofers.
```
1. Call Dave Roofing Solutions - storm repair
2. Music City Roofing - metal roofs
3. Volunteer Roofing - inspections
```
Expected: named true, position 3, competitors ["Call Dave Roofing Solutions", "Music City Roofing"].

E4. Joe's Plumbing; plumbers.
```
- Check Mate Plumbing Group: drains
- Hiller Plumbing: big jobs
- Joe's Plumbing: small shop
```
Expected: named true, position 3, competitors ["Check Mate Plumbing Group", "Hiller Plumbing"].

E5. Husk; restaurants.
```
1. **Book It Garage** - burgers in an old garage
2. **Husk** - Southern
```
Expected: named true, position 2, competitors ["Book It Garage"].

G1. Joe's Plumbing; plumbers.
```
1. **Hiller Plumbing** - big jobs
2. **Joe's Plumbing** - small shop

How to choose:
1. **Compare Services** - not every shop does gas lines
2. **Get Multiple Quotes** - at least two
3. **Ask About Warranty Services** - labor and parts
4. **Check Licensing** - Tennessee license
```
Expected: named true, position 2, competitors ["Hiller Plumbing"].

G2. Music City Roofing; roofers.
```
Here are three roofers:
1. **Music City Roofing**
2. **Volunteer Roofing**
3. **Mr. Roof**

**Book Early For Spring Services**
**Ask For References From The Company**
**Read Reviews On Google**
```
Expected: named true, position 1, competitors ["Volunteer Roofing", "Mr. Roof"].

G3. Parlour; hair salons.
```
- **Parlour:** color
- **Kinship:** cuts
- **Book Your Consultation:** most salons offer one free
- **Ask About Studio Policies:** cancellations vary
```
Expected: named true, position 1, competitors ["Kinship"].

C1 is Claude's real answer from the owner's live check (Nov 18, 10:51 PM), up to the last line visible on his screen.

C1. Capital city window and pressure cleaning; Window cleaning and pressure cleaning.
```
This is my top 5 for businesses that do both window cleaning and pressure washing in Tallahassee. I built it from what's offered and from Yelp and directory listings, not from my own testing. Most of these companies have only a few reviews, so treat it as a shortlist and not a definitive ranking.

1. **Joe Pogo's Window Cleaning.** Joe Pogorzelski has provided residential and commercial pressure washing and window cleaning in Tallahassee for more than 16 years. It has a 5.0 rating on Yelp from 3 reviews. That long track record is why it's first.

2. **Cleanscapes Exterior Cleaning.** It specializes in pressure washing, soft washing, window cleaning and gutter cleaning. It is licensed and insured and has a 4.4 rating from 5 reviews on Yelp. That's the largest review base among the highly rated options.

3. **Capital City Window & Pressure Cleaning.** It's locally owned and operated and says it will beat or match prices. It appears near the top of Yelp's window-washing and pressure-washing lists. I couldn't see its star rating in the results.

4. **College Cleaning Crew.** It leads Yelp's window-washing and pressure-washing lists. Its Yelp rating is 4.3 from 6 reviews. It's a good choice if you want an affordable option.

5. **Premier Pressure Washing & Window Cleaning Services.** It offers house washing, roof cleaning, window cleaning and driveway cleaning and serves Tallahassee, Havana, Midway and Quincy. I found little independent review data for it, so check its reviews yourself.

**Other names to check:**
- Get It Done Window Washing has a 5.0 rating from 1 review.
```
Expected: named true, position 3, competitors ["Joe Pogo's Window Cleaning", "Cleanscapes Exterior Cleaning", "College Cleaning Crew", "Premier Pressure Washing & Window Cleaning Services", "Get It Done Window Washing"].

C2. Capital city window and pressure cleaning; Window cleaning and pressure cleaning.
```
Good options include Joe Pogo's Window Cleaning and Capital City Window & Pressure Cleaning, which both do windows and pressure washing.
```
Expected: named true, position null, competitors [].

C3. Smith and Sons Plumbing; plumbers.
```
For drains, try Smith & Sons Plumbing. They answer the phone fast.
```
Expected: named true, position null, competitors [].

C4. Smith & Sons Plumbing; plumbers.
```
For drains, try Smith and Sons Plumbing. They answer the phone fast.
```
Expected: named true, position null, competitors [].

G4. Joe's Plumbing; plumbers.
```
1. **Hiller Plumbing.** Big jobs.
2. **Joe's Plumbing.** Small shop.

**Before you call:**
- Get a written estimate before work starts.
- Check that the license is current.
```
Expected: named true, position 2, competitors ["Hiller Plumbing"].

Today (afd8971): E1 to E5 drop the advice-verb names (E1 shows position 2, E2 position 1, E3 position 2, E4 position 2, E5 position 1 with no competitors). G1 to G4 already pass and must keep passing. C1 gives named true, position 3, but leaves out "Get It Done Window Washing". C2 to C4 say not named. On the live site (the original code) C1 says not named and lists "Other names to check" as a competitor, which is what the owner saw.
