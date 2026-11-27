# Review round 18: restaurant names (Nov 19, 2026)

Written by Claude (review notes only; Kiro writes all code).

The code reviewer checked commit c19523e. What holds:
- V51 is fixed: "Mike's plumbing", "iFix Hair", "Fox and Jane salon" and the standalone bold "Mike's mobile Plumbing" are kept.
- The side effect you worried about doesn't happen: "Our Town Diner", "My Thai Kitchen", "The Pub" and "Your Pie" are kept in every format.
- Properties 7 and 8 pass 2 × 25,000 runs.
- V1 to V11 and V22 hold, security is unchanged, and a 120 KB answer takes at most 50 ms.

Two narrow gaps remain where the rebuild is worse than the original, both with restaurant-style names. This is the last name-matching round before the features. Add V54 to tasks.md under "Review fixes" in a new section "S. Round 18 (`review-2026-11-19-round18.md`)". Add the 6 cases below to `MORE_CASES`, leaving the 81 existing cases exactly as they are, and change server/lib/name-match.js until all 87 pass. No shell commands.

## V54. Restaurant words, and names starting with This, Here or We

- Bold names that end in a common restaurant or shop word are dropped today, because those words aren't in `BOLD_BUSINESS_WORDS`: "**Mama's kitchen**", "**Your Pie pizza**". Add kitchen, grill, pizza, cafe, café, diner, bbq, bistro, tacos, bakery, deli, eatery and tavern, used with the existing rules.
- In numbered or bulleted sentence lines, names starting with This, Here or We are dropped by `PRONOUN_STARTS`, even when the next word is capitalized ("This Is It BBQ", "Here Kitchen", "We Taco Bout It"). Apply `PRONOUN_STARTS` and `BOLD_NOT_FIRST` only when the second word is lowercase. "This is a great pick", "We recommend calling ahead" and "Here is a tip" stay advice (G9).
- Bold advice items ("**Book a table**", "**Try the pizza**") stay advice (G10).

## New cases (business; service; answer; expected)

P1. City House; restaurants.
```
1. **Husk** - Southern
2. **Mama's kitchen** - comfort food
3. **City House** - pizza
```
Expected: named true, position 3, competitors ["Husk", "Mama's kitchen"].

P2. City House; restaurants.
```
- **Your Pie pizza**: build your own
- **Bastion**: nachos
- **City House**: pizza
```
Expected: named true, position 3, competitors ["Your Pie pizza", "Bastion"].

P3. City House; restaurants.
```
1. This Is It BBQ is a local favorite.
2. Here Kitchen has a great patio.
3. City House has wood-fired pizza.
```
Expected: named true, position 3, competitors ["This Is It BBQ", "Here Kitchen"].

P4. City House; restaurants.
```
- We Taco Bout It serves street tacos.
- City House is known for pizza.
```
Expected: named true, position 2, competitors ["We Taco Bout It"].

G9. City House; restaurants.
```
1. Husk serves Southern food.
2. City House has wood-fired pizza.
3. This is a great pick for families.
4. We recommend calling ahead on weekends.
5. Here is a tip: go early.
```
Expected: named true, position 2, competitors ["Husk"].

G10. City House; restaurants.
```
- **Husk**: Southern
- **City House**: pizza
- **Book a table**: weekends fill fast
- **Try the pizza**: it's the best
```
Expected: named true, position 2, competitors ["Husk"].

Results today (c19523e):

| Case | position | competitors |
|---|---|---|
| P1 | 2 | ["Husk"] |
| P2 | 2 | ["Bastion"] |
| P3 | 1 | [] |
| P4 | 1 | [] |

G9 and G10 already pass and must keep passing. The original gets P1 to P3 right, gives the whole sentence as the name in P4, and lists the advice lines in G9 and G10 as competitors.
