# Review round 9 of the Kiro grader rebuild (Nov 18, 2026)

The code reviewer checked commit 995a9f9. V36 is fixed: "**Name:** description" lists now match the original, "**Tips before you hire:**" is no longer a competitor, label bullets ("**Why we like it:**", "**Best for:**") and "**Note:**" are dropped as details. V1 to V11 and V22 still hold, security is unchanged, the suite passes 1060/1060, and a 120 KB answer takes 29 ms.

One gap remains, and it has been there since the first rebuild: one-word business names are dropped. Restaurants and salons often have one-word names (Husk, Bastion, Parlour). With `1. Husk - Southern cooking` / `2. Bastion - nachos` / `3. City House - pizza`, the rebuild says the business was 1st of 1, when the answer listed it 3rd of 3. That hides real competitors and claims a better rank than the answer gives.

Add V37 to tasks.md under "Review fixes". Add the 8 cases below to `MORE_CASES` in test/grade-name-match-cases.test.js, leaving the 34 existing cases exactly as they are. Then change server/lib/name-match.js until all 42 pass. No shell commands.

## Rules for V37
- Accept a one-word name when it is the whole name part of a numbered item (before a dash or colon), a numbered heading, a bold numbered line (strip the number, so never "1. Husk"), or a first-column table cell.
- Never accept a one-word section word as a name: Overview, Summary, Conclusion, Tips, Notes, Note, Important, Disclaimer, Bottom, Verdict, Recap (case-insensitive), and the two-word ones already handled ("Final Thoughts", "Heads Up", "Pro Tip", "Bottom Line").
- "**Top pick:** Hiller Plumbing" style lines: when the bold part is a pick label (Top Pick, Best Overall, Best Value, Budget Pick, Runner Up, Also Great, Honorable Mention), the name is the text after the colon, not the label.
- A numbered or bold line that starts with an advice verb (Ask, Check, Get, Call, Compare, Read, Look, Confirm, Make, Choose, Find, Avoid, Book, Verify) is advice, not a name.
- A name with a lowercase word in it ("ABC plumbing") is still a name when it sits in a numbered or bulleted list item.

## New cases (business; service; answer; expected)

W1. City House; restaurants.
```
### 1. Husk
- Southern cooking in a historic house
### 2. Bastion
- Big bar nachos
### 3. City House
- Wood-fired pizza
```
Expected: named true, position 3, competitors ["Husk", "Bastion"].

W2. City House; restaurants.
```
**1. Husk** - Southern cooking
**2. Bastion** - nachos
**3. City House** - pizza
```
Expected: named true, position 3, competitors ["Husk", "Bastion"].

W3. City House; restaurants.
```
1. Husk - Southern cooking
2. Bastion - nachos
3. City House - pizza
```
Expected: named true, position 3, competitors ["Husk", "Bastion"].

W4. City House; restaurants.
```
### 1. Husk
Southern cooking in a historic house.
### 2. Bastion
Big bar nachos.
### 3. City House
Wood-fired pizza.
```
Expected: named true, position 3, competitors ["Husk", "Bastion"].

T3. Joe's Plumbing; plumbers.
```
**Top pick:** Hiller Plumbing
**Top Pick:** Radiant Plumbing & Air
**Best Value:** Joe's Plumbing
**Runner Up:** Benjamin Franklin Plumbing
```
Expected: named true, position 3, competitors ["Hiller Plumbing", "Radiant Plumbing & Air", "Benjamin Franklin Plumbing"].

T4. Joe's Plumbing; plumbers.
```
Here are three strong plumbers:
1. **Hiller Plumbing**
2. **Mr. Rooter Plumbing**
3. **Joe's Plumbing**

**Note:** I can't check live availability.
**Important:** Prices change often, so call ahead.
**Heads Up:** Weekend rates are higher.
**Disclaimer:** This is not an endorsement.
**Pro Tip:** Book early in spring.
```
Expected: named true, position 3, competitors ["Hiller Plumbing", "Mr. Rooter Plumbing"].

A1. Joe's Plumbing; plumbers.
```
1. **ABC plumbing** - fast service
2. **Hiller Plumbing** - big jobs
```
Expected: named false, position null, competitors ["ABC plumbing", "Hiller Plumbing"].

A2. Music City Roofing; roofers.
```
Here are good roofers:
1. **Music City Roofing**
2. **Volunteer Roofing**

How to choose:
**1. Ask For Quotes**
**2. Check Reviews**
```
Expected: named true, position 1, competitors ["Volunteer Roofing"].

Today (995a9f9) T4 already passes except "Important" and "Heads Up" (they are listed); T3 lists the labels instead of the names; W1 to W4 drop the one-word names (W2 lists "1. Husk"); A1 drops "ABC plumbing"; A2 lists "Ask For Quotes". The S3 case may now list Bastion; it must still never list "Overview" or "Final Thoughts".
