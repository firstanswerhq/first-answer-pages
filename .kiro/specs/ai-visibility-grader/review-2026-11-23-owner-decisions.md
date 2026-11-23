# Owner decisions, Nov 23, 2026 (D1-D6) plus one test fix (V150)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
The owner (Colby) approved D1 to D5 on Nov 23, 2026 ("Yes to all"). D6 means no change.
These change behavior, so the spec comes first: update requirements.md, design.md and tasks.md (new tasks in a new section, one task per decision), then build one task at a time. Each task adds tests; an older test changes only on a line the design's "Numbers that change in existing tests" table names, with its reason.

## V150 (first) One new test is too strict
`test/review-final-pages.test.js`, "V134: an address we could not reach adds ...": `assert.equal(html.includes('secret=1'), false)` checks the whole report. The listing preview's "Website:" line prints the test's made-up `input.website` with its query. The real check form keeps only the site's front address, so no real Grade has a query there. Narrow the assertion to the reach sentence (the `<p class="hint grade-partial">` line). Do not change the page.

## D1 The score never drops when the full report opens
Today the two extra questions asked after unlocking count toward the AI part, so "named in 2 of 3 answers" (20 of 30 points) becomes "2 of 5" (12 of 30) and the score falls right after the owner gives contact details.
Decision: the AI part (30 points) is scored from Claude's answers to the free question only (the main asks, 1 to 3 of them). The two extra questions, and every second opinion, are still asked and shown in the full report, labeled plainly as not counted toward the score (the same way second opinions already say "for comparison only (not scored)").
- A Grade's score is the same before and after unlocking. Pin it with a test that unlocks and compares.
- Every count line in the full report ("Claude named your business in N of its M answers") counts the free-question answers only, so it agrees with the lead line at the top. The extra questions get their own line, for example "On the 2 other questions, Claude named your business in 1 of 2." (exact wording in the design; plain, no promise).
- Old stored Grades that were unlocked: their shown score is recomputed the same way (`shownScore`), so some go up. Say in the design that this is accepted. The lead's stored score and the admin pages show the same number as the report.
- A repeat check within 7 days that carries answers: carried extra-question answers never count either.

## D2 "Partly" instead of "PASS" on a weak AI result
"PASS · 8 of 30 points · Yes. Claude named your business in 1 of 4 answers." reads wrong. The AI-named Check shows:
- PASS only when every counted answer named the business,
- PARTLY when some did (the points stay exactly as today's rule gives them),
- the fail label when none did.
This is a display label. Points, the score, "N of M checks need work" counting and stored results do not change unless the design shows a reason; if PARTLY needs a new stored value, say why in the design first.

## D3 Home page says why this matters
Under the home page headline, add: "People now ask AI who to call. List your business free so AI can find it."
Give the AI Visibility Check equal weight with the search box on the home page: a clear button or link ("Check if AI can find your business") next to or right under the search, not one small text link. Keep the phone-book look. Shown only when the grader is on. Phone width (390px) must not scroll sideways.

## D4 A listing claimed from a report pre-fills less
Today Services is pre-filled with what the owner typed in "What you do", so a published listing says "Bluebird Plumbing is a plumber in Nashville, TN offering plumbers."
- Leave Services empty and marked as needing the owner's input on the draft form.
- Pre-fill hours in the form's own style ("7am-6pm"), not "07:00-18:00".
- Anything else the claim fills stays as it is.

## D5 The business-label Check recognizes every local-business type
Today the Check recognizes only 31 schema.org types; a site labeled `AutoWash` (a car wash), a nail salon, a vet, a gym, a hotel, a florist and many others is told it has no business label and loses those points.
Accept every schema.org type that is `LocalBusiness` or a subtype of it, plus `Organization` subtypes the design already accepts. Keep it a fixed list in the code (no fetching at runtime), built from the schema.org type tree, and say in the design which schema.org release it was taken from. This raises scores for those sites; that is approved. Tests: AutoWash, NailSalon, VeterinaryCare, ExerciseGym, Hotel, Florist, Pharmacy, AccountingService, HomeAndConstructionBusiness subtypes, plus an unknown made-up type that still fails.

## D6 The /grade title stays as it is
"Can AI find your local business? Free AI Visibility Check | First Answer Pages". No change.

## After D1-D5
The cleanup list in review-2026-11-23-final-code.md (V146-V149) comes next, then a final review pass.
