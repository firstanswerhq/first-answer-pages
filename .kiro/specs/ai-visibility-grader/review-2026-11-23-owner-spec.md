# Review notes: spec review of D1-D5 (Nov 23, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
Read at commit a9ac809 against the code. D1 needs one change before building; D2-D5 are OK with the small changes below. Update the spec lines these touch in the same turn as the task they belong to.

## V151 (D1, before building O1) The "free answer" must never be an extra answer
The design says the extra questions are not asked when the free question failed. The code does the opposite: `grader.js` (about lines 1581-1584) runs them "even when the free question failed or hit the daily limit (requirement 9.2)". So a Grade whose free asks all failed and whose extras answered has an extra answer as its first main answer, and `freeAnswersOf` would score and show it as the free answer. A repeat check that carries only extra answers has the same problem (`ai = [...carried, ...new]`).
Fix:
- store `extra: true` on each new extra-question entry (the loop near line 1551);
- `freeAnswersOf` skips entries with `extra: true`;
- for old Grades with no flag, also skip a main answer whose prompt does not start with "Who are the best " (every version of the free question starts that way; the extra questions start "I need", "I'm looking for" or "Which").
Correct the design sentence about extras. With this, removing the "rescue" line (about line 1564) is right: the AI part stays not checked and partial with its true reason, and the extras are shown but not counted.
Test: free asks all fail, extras answer → AI part not checked, partial score, reason shown, extras listed as not counted.

## V152 (D1) Old Grades can go down as well as up
A stored Grade whose free answer did not name the business but whose extras did goes from 20 of 30 to 0, and `ai-named` turns from pass to fail. That follows from the owner's rule (main question only). Record both directions in the design. Also switch the admin list (`grade-admin.js` about line 96) and a Recheck's "before" number (`previousScore`) to `scoredResults` / `shownScore`, as the design says. Lead emails already sent: no action (they hold the number from before the extras ran).

## V153 (D2) No "Yes." under "Partly"
When the row says "Partly", `checkRow` shows the detail without its leading "Yes. " ("Claude named your business in 1 of 3 answers."). Stored text stays. Update the example to "1 of 3" (10 of 30).

## V154 (D3) No /grade link anywhere with the grader off
The sentence shows always; the button only with the grader on. With the grader off, no `/grade` link anywhere on the home page, footer included. Test it.

## V155 (D4) Hours: record the hidden bug and fix old listings too
The claim stored hours like "07:00-18:00", which `parseHoursRange` in `schema.js` (about line 144) does not parse, so claimed listings published so far have no opening hours in their JSON-LD. `formStyleHours` output parses. Say this in the design, and also let `parseHoursRange` accept "HH:MM-HH:MM" (24-hour), so listings already published get their hours in the business label. Tests for both forms.

## V156 (D5) Kiro's two questions
- Full-address types: yes. Before the lookup, strip a leading `http://schema.org/`, `https://schema.org/` or `schema:` (any case).
- Organization subtypes such as Corporation: treat them like `Organization` (count only with a telephone and an address, as today). `OnlineBusiness` and `OnlineStore` never count as local.
- Odd members of the LocalBusiness tree (FireStation, Hospital, Library and the like) stay in; harmless.
