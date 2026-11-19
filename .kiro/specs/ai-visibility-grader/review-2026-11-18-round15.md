# Review round 15: one failing test after round 13 (Nov 18, 2026)

Written by Claude (review notes only; Kiro writes all code).

Round 13 is close. In the cloud, all 8 new cases pass and the 62 earlier cases are unchanged. Colby's Capital City answer still reads named, 3rd. But the full suite fails one existing test: 1105 of 1106 pass. Nothing was committed; the branch stays at the last passing commit.

## The failure

```
not ok - Property 8: competitors exclude the business, repeat no one, and number at most 5
  (test/grade-name-match.test.js, line 38)
  Property failed after 3 tests
  { seed: 1328591659, path: "2:0:0:0:0:0:0:6:4:4:5:5:6:5:5:7:7:7:7:7:7:7:7:7:5", endOnFailure: true }
  Counterexample: ["aA aa",["Aa Ab aAA Aa"],0]
  AssertionError: aa ab out of order   (line 58)
```

The answer was:
```
1. **aA aa** - well reviewed
2. **Aa Ab aAA Aa** - well reviewed
```
The new sentence-name rule cut the bold name "Aa Ab aAA Aa" at its first lowercase word and returned "Aa Ab", a name the answer never wrote. Don't change or loosen Property 8; it found a real gap.

## V50. A bold name is the whole name

The same gap drops real names. A bold name with a lowercase word inside it is lost, and the business moves up a place. The original code kept these names. Before round 13 the rebuild dropped them completely, and now it cuts them short.

- Text between `**` and `**` (or `__` and `__`) at the start of a list item or line is the whole name, kept as written (minus a trailing period or colon). Never cut it at a lowercase word, and never apply the sentence-name rule (V43, V44) inside it. The sentence-name rule applies only to plain text that is not bold.
- The section-word, label and advice rules for bold lines (V35 to V41) still apply to the bold text as a whole.

Add V50 to tasks.md under "Review fixes" in a new section "P. Round 15 (`review-2026-11-18-round15.md`)". Add the 5 cases below to `MORE_CASES`, leaving the 70 existing cases (after round 13) exactly as they are. Change name-match.js until all 75 pass and Property 8 passes with the seed above. No shell commands.

## New cases (business; service; answer; expected)

K1. Joe's Plumbing; plumbers.
```
1. **Mike's mobile Plumbing** - fast
2. **Joe's Plumbing** - small
```
Expected: named true, position 2, competitors ["Mike's mobile Plumbing"].

K2. Joe's Plumbing; plumbers.
```
1. **Sparkle drain Pros** - fast
2. **Joe's Plumbing** - small
```
Expected: named true, position 2, competitors ["Sparkle drain Pros"].

K3. Joe's Plumbing; plumbers.
```
1. **Mike's mobile Plumbing** is fast.
2. **Joe's Plumbing** is small.
```
Expected: named true, position 2, competitors ["Mike's mobile Plumbing"].

K4. Joe's Plumbing; plumbers.
```
- **Mike's mobile Plumbing**: fast
- **Joe's Plumbing**: small
```
Expected: named true, position 2, competitors ["Mike's mobile Plumbing"].

K5. aA aa; plumbers.
```
1. **aA aa** - well reviewed
2. **Aa Ab aAA Aa** - well reviewed
```
Expected: named true, position 1, competitors ["Aa Ab aAA Aa"].

Today (after round 13): K1 to K4 give position 1 with no competitors, and K5 gives competitors ["Aa Ab"]. The original code got all five right. Unbolded names with a lowercase word ("1. Mike's mobile Plumbing - fast", "Hair by Dana", "Salon de Belle", "ABC plumbing Co") already work. Keep them working.
