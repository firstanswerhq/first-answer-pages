# Reader review of batch 6 fix C (commit 0549e61), 2026-11-26

## NO-GO

Fix C did not meet its main must-fix. The print length target is missed and page 1 is still wrong in all four printouts. The small items (lining "1.", web footer) are done.

## How it was measured
Real printPage()/reportPage() output for a stored grade (Riverbend Plumbing; 1 answer, and 5 answers = Claude x3, ChatGPT, Perplexity), with and without Prepared by. Chromium via Playwright, print media, Letter, page.pdf(), then pdftoppm/pdftotext. Contact sheets and PDFs: /mnt/user-data/outputs/batch6c-shots/.

## Results
| Printout | Pages | Target |
|---|---|---|
| 1 answer, no name | 8 | n/a |
| 1 answer, Prepared by | 8 | n/a |
| 5 answers, no name | 9 | 8 or fewer: FAIL |
| 5 answers, Prepared by | 9 | 8 or fewer: FAIL |

## Checks
1. Page counts: 5 answers is 9 in both versions. FAIL.
2. Page 1: FAIL in all four. The map does not sit under the score box.
   - No name (1 and 5 answers): page 1 = score box, then the "Health of your setup" heading and its intro line, then about 55% blank. Map starts at the top of page 2. This is the orphaned heading, unchanged.
   - Prepared by: the heading moved to page 2 with the map, so no orphan, but page 1 is only the score box with about 75% blank.
   - "Your fix kit" heading: not stranded in any of the four (5 answers/Prepared by: first line of page 8; 5 answers/no name: mid-page 8; 1 answer: followed by its first box on the same page). PASS.
3. "1." before the question: PASS. Zoomed crop (marker-1-crop.png) shows a normal lining 1.
4. Web footer with Prepared by: PASS. Reads "To have this report removed, contact First Answer Pages." with the link on "contact First Answer Pages" and the full stop outside it. Not present without Prepared by, as intended.
5. Dark theme: PASS for the page. Print body is rgb(255,255,255) with ink rgb(28,25,23) and headings rgb(15,27,51); every page is light. The health map itself prints as a dark navy panel (the step 1A panel), which is intentional but uses a lot of ink; not a break.

## Root cause of the page 1 miss (diagnosis only, no code edited)
The print rule `.health-map { max-width: 12rem ... }` (public/css, inside @media print near line 2610) is losing. A later general rule `.health-map { max-width: 40rem ... }` (about line 2662, same specificity, no !important) wins. Measured in print media: the map computes to max-width 640px and is 640 x 640 px (about 6.7 inches square), not 192px. A map that size cannot fit under the score box with its heading, so it jumps to page 2. Fix suggestion for Kiro: make the print max-width win (move the print block after it or raise specificity, e.g. `.health .health-map`), then re-measure. A map near 12rem should fit on page 1 and should pull 5-answer printouts down by about one page.
Also: design.md still needs the four real counts above (they differ from the 1-answer counts quoted in the fix C brief, 8/7).

## What to send back to Kiro
- Make the print map width rule actually apply; confirm page 1 = score box + heading + map, no blank half-page.
- Re-measure: 5 answers must be 8 or fewer.
- Record the four counts in design.md.
