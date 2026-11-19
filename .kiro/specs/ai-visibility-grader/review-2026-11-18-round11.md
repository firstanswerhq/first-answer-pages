# Review round 11 of the Kiro grader rebuild (Nov 18, 2026)

The code reviewer checked commit ff068de. V37 is fixed: one-word names work in numbered lines, headings and bold numbered lines (Husk and Bastion, position 3 of 3); "Top pick:" lines give the name; "Important", "Heads Up", "Pro Tip", "Overview", "Summary" and "Ask For Quotes" are gone; "ABC plumbing" is kept. On every earlier case the rebuild now equals or beats the original. V1 to V11 and V22 hold, security is unchanged, the suite passes 1068/1068.

Two narrow gaps remain where the rebuild is worse than the original. Add V40 to tasks.md under "Review fixes" (V38 and V39 are the page items). Add the 7 cases below to `MORE_CASES` in test/grade-name-match-cases.test.js, leaving the 42 existing cases exactly as they are, and change server/lib/name-match.js until all 49 pass. No shell commands.

## Rules for V40
- The advice-verb rule (V37) must not drop real names. A line that starts with an advice verb is a business name when it ends in a trade or legal word (Plumbing, Roofing, Salon, Cleaning, Air, Electric, Co, Company, LLC, Inc), or when it is bold. "Check Mate Plumbing", "Call Today Roofing", "Look Salon" and "Get Fit Plumbing" are names; "Ask For Quotes" and "Book early" are advice.
- A bare one-word bullet ("- Husk") is a name when the other items in the same list are names (or one of them is the business itself), and the word is not a section, label or offer word (Important, Tips, Overview, Recap, Summary, Note, Free, Estimates).
- Items under a "Tips" line or heading ("Tips:", "## Tips", "**Tips:**") are advice, never names, whether numbered or bulleted.

## New cases (business; service; answer; expected)

V1. Joe's Plumbing; plumbers.
```
1. **Check Mate Plumbing** - fast
2. **Hiller Plumbing** - big
3. **Call Today Roofing** - also does gutters
```
Expected: named false, position null, competitors ["Check Mate Plumbing", "Hiller Plumbing", "Call Today Roofing"].

V2. Joe's Plumbing; plumbers.
```
1. Check Mate Plumbing - fast
2. Hiller Plumbing - big
- Look Salon: color
- Get Fit Plumbing: drains
```
Expected: named false, position null, competitors ["Check Mate Plumbing", "Hiller Plumbing", "Look Salon", "Get Fit Plumbing"].

V4. Parlour; hair salons.
```
1. Parlour - color specialists
2. Overview - not a salon
3. Kinship - cuts
4. Recap - not a salon
5. Free - offer
6. Estimates - offer
```
Expected: named true, position 1, competitors ["Kinship"].

V5. Parlour; hair salons.
```
## Our favorite salons
- Parlour
- Kinship
- Important
- Tips
## Tips
- Book early
- Bring photos
```
Expected: named true, position 1, competitors ["Kinship"].

V7. Husk; restaurants.
```
1. Husk — Southern
2. Bastion — nachos
3. Rolf — pasta

Tips:
1. Reserve — weekends fill fast
2. Parking — limited
```
Expected: named true, position 1, competitors ["Bastion", "Rolf"].

B1. City House; restaurants.
```
Top picks:
- Husk
- Bastion
- City House
```
Expected: named true, position 3, competitors ["Husk", "Bastion"].

B2. Joe's Plumbing; plumbers.
```
1. **Hiller Plumbing**
2. **Joe's Plumbing**

Tips:
- Ask for a written estimate
- Check Google reviews
```
Expected: named true, position 2, competitors ["Hiller Plumbing"].

Today (ff068de): V1 and V2 drop the advice-verb names; V4 lists "Free" and "Estimates"; V5 drops Kinship; V7 lists "Reserve" and "Parking"; B1 drops Husk and Bastion (City House shows 1st of 1). Check B2 by hand.
