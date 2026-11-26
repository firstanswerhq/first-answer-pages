# Batch 6 fix list (from review-2026-11-25-batch5.md and review-2026-11-25-batch5-reader.md)

Read both review files for the details and the exact wording suggested. Keep every honesty rule (never a false red, "Not checked" when unsure).
For each item, fix the code, add or update a test, and add a line to the deviations table in design.md if you change something on purpose.
Do not edit requirements.md. Do not run shell commands.

## Must fix first
1. Print length (K5). The real /print page is 12 Letter pages with 1 answer; a normal report would be 13 to 15. Target 6 to 8.
   - Put the score box AND the health map on page 1 (shrink the map in print; page 1 is more than half blank today).
   - In style.css @media print the map has `max-width: 32rem; break-inside: avoid`, and groups and cards are kept whole. Only keep single rows and single cards unbroken.
   - The same answers print twice ("What AI says" and "Every answer"). In print, keep one line of summary plus "Other businesses it named" under "What AI says", and keep the full answer text only in "Every answer".
   - In print, the score-card list shows only the failed and partial items.
   - Check the PDF page count with 1 answer and with 5 answers (Claude x3, ChatGPT, Perplexity) and write the counts in design.md.
2. "Prepared by" must read as the agency's own report (K4).
   - The title box kicker "REPORT · FIRST ANSWER PAGES" becomes "Prepared by <name>" (same size as the kicker). Without Prepared by it stays as it is.
   - Leave the whole Free listing group out when agency is true: the "Free listing" bubble on the map, the four rows ("Listed on First Answer Pages", "Verified stamp", "Listing matches your website", and the other listing row), and the "i = about your free listing" legend line. Do this in healthModel (so the print page and the CSV both follow) and add a test.
   - In the CSV, drop the Free listing group in both cases (with and without Prepared by), so the no-name CSV carries no "claim it below" line either.
3. Broken sentence at the end of the print page: "AI assistants pick up changes over days to weeks, so after you make fixes." The link was stripped and the sentence was left. Use: "AI assistants pick up changes over days to weeks, so check again after you make fixes." Test that no printed sentence ends in "so after you make fixes".

## Should fix
4. No green check next to a problem. In the health list and map, show the "partly" mark whenever the status text says "but" (for example "Found a link, but not the number", "Found, but not on one line"). Keep the score card and tips consistent with it.
5. Move "Who AI named, across N answers" and "Sites AI used" directly under the score box, on screen and in print, and add one plain line under the table such as "Two competitors were named in every answer. You were named in 3 of 5." (built from the real counts; never say anything we cannot count).
6. Evidence line wording: "Evidence: Claude claude-sonnet-4-5, Nov 25, 2026, 7:23 PM CT, live web search on." Use ONE time zone label everywhere (the report footer says CST while the evidence says CT).
7. CSV cleanup: (a) the same 13 items appear twice (section "check" and section "health") with different status words. Keep one set, or use one vocabulary (Pass / Needs work / Not checked) so a pivot does not double count. (b) Dates: write "2026-11-25 19:23" in Central time, no milliseconds, on every row that has a date (check_date and the answer date). (c) Keep header first, formula guard and 23 columns (update the count if you remove columns).
8. Add a short "How we checked" paragraph at the end of the report and the print page: one question, asked 3 times to Claude and once each to ChatGPT and Perplexity (use the real counts). AI answers change, so this is a snapshot, not a ranking. Never promise that AI will name a business.
9. In the "Share this report" box add: "Use the print page for clients; the web page above is for you."
10. K1 low risk, answersSection: an answer with no prompt that sits next to answers with prompts takes the first question as its heading, which mislabels it. Group those under a neutral heading ("Answer, question not saved"), and use the fallback only when every answer lacks a prompt.

## Nits (do if quick)
11. "Fix: Add the business label (the code is in Your fix kit...)" becomes "your fix kit".
12. Numerals: in the display font the "5" in "Who AI named, across 5 answers" and "the 2 lines" look like letters. Use lining numerals (font-variant-numeric: lining-nums) on those headings.
13. "The lights below also show extra checks that don't count toward it" becomes "The map also shows extra checks that don't count toward your score."
14. Make "run a new check" links in health rows and notices use the same words as FULL_NEW_CHECK.
15. A leading-space or newline CSV cell is not formula-guarded. Spreadsheets treat it as text, but trim leading whitespace before the guard check anyway.

When done: stop and list every file you changed. Claude will rerun the full suite twice, then send the reviewers again.
