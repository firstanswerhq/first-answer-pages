# Review round 17: the Capital City report, read like an owner (Nov 19, 2026)

Written by Claude (review notes only; Kiro writes all code).

The page reviewer rendered the report for Colby's client with Claude's real answer from his live check (the same answer as case C1, plus its "Other names to check" list), side by side: the live code and the rebuild at ef5c1c7. The rebuild gets the important parts right:
- It says "yours was 3rd."
- Claude's top five show in Claude's order, with Capital City 3rd, marked "(you)" and shaded.
- The answer reads cleanly.

The live code still shows the bug Colby saw: "It named these 3 businesses, not yours", with the heading "Other names to check" listed as a business.

One thing on the rebuild's page would confuse an owner. Add V52 to tasks.md under "Review fixes" in a new section "R. Round 17 (`review-2026-11-18-round17.md`)". Do it after round 16. Change server/lib/name-match.js and server/lib/grade-html.js as needed, and add example tests to test/grade-report-list.test.js (additions only). Keep all existing name-match cases exactly as they are: the stored `competitors` list does not change. No shell commands.

## V52. "It listed N businesses" must match the list on the page

Claude's answer was its "top 5", followed by a separate short list headed "**Other names to check:**" with three more names. Today the rebuild says "It listed **8** businesses, and yours was 3rd", but shows only **6** numbered rows: the top 5 plus "Get It Done Window Washing" from the extra list as #6. Cloud Nine and Fish, from the same extra list, are left out.

- The count in "It listed N businesses" and the numbered rows come from one list only: the main ranked list that holds the business (or, when the business isn't named, the first numbered or bulleted list of businesses). For this answer that's "It listed 5 businesses, and yours was 3rd", with rows 1 to 5 exactly as Claude ranked them.
- Names from a separate later list (one that comes after a heading or a lead-in line such as "Other names to check:", "Also worth a call:" or "Honorable mentions:") are not numbered and not counted. Show them under the numbered rows as a plain list headed "Also mentioned:", in answer order, escaped, at most 5.
- When the answer has only one list, nothing changes.
- The `position` the score uses stays the place in the main list. The stored `competitors` list stays as it is today.
- Tests:
  - Colby's answer (C1's answer text plus these two lines at the end: "- Cloud Nine Window Cleaning has a 5.0 rating from 2 reviews." and "- Fish Window Cleaning is a national franchise with a Tallahassee location.") renders "It listed 5 businesses, and yours was 3rd", exactly 5 numbered rows with Capital City 3rd and "(you)", and "Also mentioned:" with Get It Done Window Washing, Cloud Nine Window Cleaning and Fish Window Cleaning.
  - A one-list answer renders exactly as before.
  - A not-named answer with an extra list numbers nothing and shows the plain "Other businesses it named:" list as today.

## For Colby to decide (not for Kiro now)

Both versions build the AI question from the service exactly as typed: "Who are the best Window cleaning and pressure cleaning in Tallahassee, FL? Name your top 5." The capital W and the grammar read oddly, and an odd question can get a weaker answer. Changing the question wording changes what the AI is asked, so it waits for Colby.
