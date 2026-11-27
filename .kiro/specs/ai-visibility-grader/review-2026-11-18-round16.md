# Review round 16 of the Kiro grader rebuild (Nov 18, 2026)

Written by Claude (review notes only; Kiro writes all code).

The code reviewer checked commit 9fad898. Two rounds of fixes hold up:
- V44 is fixed: numbered lines written as sentences read correctly.
- V50 is fixed: "**Mike's mobile Plumbing**" in a list item is kept whole.
- Property 8 is not flaky. Properties 7 and 8 each passed 3 × 25,000 runs, including seed 1328591659.

On long, mixed, Claude-style answers the rebuild now equals or beats the original everywhere. V1 to V11 and V22 hold, security is unchanged, and a 120 KB answer takes 36 to 100 ms.

The only places still worse than the original are the two limits you named in round 15. They are rare but real: a dropped name moves the business up a place. Add V51 to tasks.md under "Review fixes" in a new section "Q. Round 16 (`review-2026-11-18-round16.md`)". Add the 6 cases below to `MORE_CASES`, leaving the 75 existing cases exactly as they are. Change name-match.js until all 81 pass. No shell commands.

Do this round after review round 14 (V45 to V49), which matters more for launch day.

## V51. Bold names with a lowercase word at the start or end, and standalone bold names

- A bold list item, or a standalone bold line (on its own line, with no number or bullet), is the whole name when it contains a trade word, a business ending (services, solutions, group, spa, salon, studio, garage, pros, bar…) or a legal word (LLC, Inc, Co), or when it starts with a lowercase letter followed by a capital (brand styling such as "iFix" or "eCleaning"). Examples: "**Mike's plumbing**", "**iFix Hair**", "**the Hair Bar**", "**Fox and Jane salon**".
- Keep refusing advice and heading text, using the existing advice-heading and section-word rules. "**Before you hire a plumber**", "**Our top picks for you**" and "**a quick note on prices**" are never names (G7, G8). The original listed all three, so these guards also keep the rebuild better than the original.

## New cases (business; service; answer; expected)

L1. Joe's Plumbing; plumbers.
```
1. **Mike's plumbing** - small shop
2. **Hiller Plumbing** - big
3. **Joe's Plumbing** - honest
```
Expected: named true, position 3, competitors ["Mike's plumbing", "Hiller Plumbing"].

L2. Parlour; hair salons.
```
1. **iFix Hair** - cuts
2. **the Hair Bar** - blowouts
3. **Parlour** - color
```
Expected: named true, position 3, competitors ["iFix Hair", "the Hair Bar"].

L3. Parlour; hair salons.
```
- **Fox and Jane salon** - modern cuts
- **Parlour** - color
- **Salon Lofts** - booth rental
```
Expected: named true, position 2, competitors ["Fox and Jane salon", "Salon Lofts"].

L4. Joe's Plumbing; plumbers.
```
**Hiller Plumbing**
The biggest shop in town.

**Mike's mobile Plumbing**
Comes to you.

**Joe's Plumbing**
Small and honest.
```
Expected: named true, position 3, competitors ["Hiller Plumbing", "Mike's mobile Plumbing"].

G7. Joe's Plumbing; plumbers.
```
**Hiller Plumbing**
The biggest shop in town.

**Joe's Plumbing**
Small and honest.

**Before you hire a plumber**
Ask for a written estimate.

**Our top picks for you**
These are the two we trust most.
```
Expected: named true, position 2, competitors ["Hiller Plumbing"].

G8. Parlour; hair salons.
```
1. **Parlour** - color
2. **Kinship** - cuts

**a quick note on prices**
Prices change often.
```
Expected: named true, position 1, competitors ["Kinship"].

Results today (9fad898):

| Case | named | position | competitors |
|---|---|---|---|
| L1 | true | 2 | ["Hiller Plumbing"] |
| L2 | true | 2 | ["the Hair Bar"] |
| L3 | true | 1 | ["Salon Lofts"] |
| L4 | true | 2 | ["Hiller Plumbing"] |

G7 and G8 already pass and must keep passing. The original gets L1 to L4 right, but lists the headings in G7 and G8 as competitors.
