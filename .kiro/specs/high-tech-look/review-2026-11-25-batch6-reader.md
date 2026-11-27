# Batch 6 reader review (agency owner / contest judge), commit 8884974

## Verdict: NO-GO (close)
Prepared by and the wording fixes landed well. Two must-fixes are still open: the print length target (K5) and the CSV double list (7a). Fix those two and it is a GO.

Screenshots: /mnt/user-data/outputs/batch6-shots/ (desktop, phone, print pages for 1 and 5 answers, with and without Prepared by).

## Print page count (Letter, Playwright PDF)
| Case | Pages | Target 6-8 |
|---|---|---|
| 1 answer, no name | 8 | ok (top) |
| 1 answer, Prepared by | 8 | ok (top) |
| 5 answers, no name | 10 | NOT met |
| 5 answers, Prepared by | 9 | NOT met |
Down from 12 to 15, but a normal 5-answer report still runs long. Why: page 1 ends with the "Health of your setup" heading and a blank gap because the map is kept whole and jumps to page 2 (so the map is NOT on page 1 as asked); the health list prints in full (about 1.5 pages) on top of the map and the score card; page 4 and the fix-kit pages are half empty.

## Must-fix status
1. Print length: NOT done. Score box is on page 1, but the map is on page 2 and the heading is orphaned on page 1. Duplicate answer text is gone (one summary plus "Other businesses it named", full text only in "Every answer"). Score-card list shows only failed or partial items: DONE. Page counts above (not seen in design.md; check it).
2. Prepared by reads as the agency's own report: DONE on print. Kicker becomes "PREPARED BY MUSIC CITY WEB CO."; Free listing bubble, rows, legend line and the "Founding Member" note are all gone; the no-name print still has them. CSV has no Free listing or "claim it below" line in either case: DONE.
3. Broken last sentence: DONE ("check again after you make fixes").
4. No green check beside "but" statuses: DONE (Tap-to-call and Street address show "!" and Partly).
5. Who AI named + Sites AI used under the score box, plus one plain line: DONE ("Two competitors were named in every answer. You were named in 3 of 5.").
6. Evidence line and one time zone: DONE (CST everywhere; model name now included).
7. CSV: (a) NOT done: the 13 checks still appear in section "check" (Pass / Needs work) and again in "health" (Yes / Found / Not linked), 14 + 31 rows. A pivot still double counts. (b) DONE (2026-11-25 22:01 format). (c) DONE (header first, 23 columns).
8. How we checked: DONE, counts are real in both cases (1 answer: "from Claude once").
9. Share box line "Use the print page for clients; the web page above is for you.": DONE.
10. Answer with no prompt: not exercised in my sample; not judged.
11. "your fix kit": DONE. 12. Lining numerals: NOT done in practice. "5 ANSWERS" still shows an old-style 5 and "the 2 lines" in the fix-kit headings still looks like a z (print and phone). 13. DONE. 14. Not exercised ("Run a new check later" present). 15. Not exercised.

## Reader notes (sentences)
Broken or wrong
- The 1-answer report prints "WHO AI NAMED, ACROSS 1 ANSWER" with a "1 of 1" table. It is true but looks thin; with 1 answer it reads as a ranking, which the report says it is not. Consider hiding the table below 3 answers.
- "Tap-to-call phone number: PARTLY, 4 of 4 points" and "Street address: PARTLY, 3 of 3 points": a Partly badge with full points confuses a client. Either show "Full points, tip below" or drop points on tip-only items.
- "Tip:" and "Fix:" are both used for similar advice; pick one pattern.

Sales-line risk when Prepared by is filled
- Print page: clean, except the last line "Powered by First Answer Pages". It is small and honest, but an agency may not want it; offer it as optional or tell the agency it is there.
- Web page (not print) with Prepared by filled still shows the "First Answer Pages / List your business free" header button, the kicker "REPORT · FIRST ANSWER PAGES", the Free listing bubble and the "Claim my free listing" panel. Fine if the web page is only for the agency (the share box now says so), but it is the first thing the agency sees and it addresses the business owner. Clearly the weakest spot left.
- Only the no-name report has "Want help? First Answer ... can apply the fixes for you". Correct that it vanishes with a name.

Wrong audience
- "Your web team can use the fix kit at the end." and "Send this kit to whoever looks after your website" are fine for a client. "Ask us to remove this report: contact page" (web footer) is aimed at the owner of the business, not the agency.
- "Claude named your business in 2 of 3 answers" at 9:01 PM and "Automated check ... 10:01 PM" differ by an hour in my test data only (my harness set it); not a product bug.

Layout
- Phone (390 px): no horizontal scroll, map readable, table wraps cleanly. No console errors on any of the 8 renders.
- Print: page 1 half blank at the bottom (map pushed away), page 4 half blank in the 5-answer version.

## To reach GO
1. Make the health map fit on page 1 in print (smaller map, allow the list to break between groups) and trim the printed health list to one short column or only non-green rows, so 5 answers prints in 8 pages or fewer.
2. CSV: keep one set of 13 items with one vocabulary (Pass / Needs work / Not checked).
3. Lining numerals on those headings (font-variant-numeric did not take effect where it shows).
4. Optional: hide the table for a single answer; hide the "Powered by" line or flag it.
