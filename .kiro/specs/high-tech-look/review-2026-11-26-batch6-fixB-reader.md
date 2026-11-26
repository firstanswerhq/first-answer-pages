# Batch 6 fix B, reader review (2026-11-26)

Commit a6a0cf8 "batch 6 fix B". Real rendering with the orb harness (reportPage and printPage, real stored-grade shape: 13 checks plus ai-named, 31 health rows, Claude x3 + ChatGPT + Perplexity for 5 answers). PDFs by Playwright Chromium, Letter. Shots, PDFs, CSVs and text dumps: /mnt/user-data/outputs/batch6b-shots/

## VERDICT: NO-GO

One must-fix is still open: page 1. In the real printout, page 1 ends with the "Health of your setup" heading, its intro and a big blank gap. The map is still on page 2. The page count for 5 answers is 9, not 8 or fewer. Everything else checked is fixed.

Page counts: 1 answer 8 (no name) and 7 (Prepared by). 5 answers 9 (no name) and 9 (Prepared by). Before fix B: 8 / 10 / 9.

## Items

1. Print length: NOT.
   - 5 answers: 9 pages, both with and without Prepared by. Target was 8 or fewer. 1 answer: 8 and 7 pages.
   - Page 1 holds the score box, then the "Health of your setup" heading, intro and "Only the rows that are not green are listed here" line, then about 55 percent of the page is blank. The map sits at the top of page 2. This is the orphaned heading the list asked to remove (n5-nopb-print.pdf, n5-pb-print.pdf, n1-nopb-print.pdf, sheet-*.png).
   - The "not green only" list and the dropped answer text did help: pages 2 to 3 are dense. "Your fix kit" heading is stranded at the foot of page 8 in the 5-answer printout.
   - design.md still says the page count was "Not measured". It needs these counts.
2. CSV counts a check twice: DONE.
   - Real-shape grade: n5-pb.csv has 14 check rows (13 checks plus AI answers) and 31 health rows. n1: 14 and 29. The overlap of item names between the two sections is empty in all four CSVs. Health rows still carry clusters ("Website: Website basics", "Links: Socials"). The Prepared by name is in column 7 only when set.
3. Lining numerals: DONE. "Who AI named, across 5 answers" and "Search summary (the 2 lines under your link in Google)" show lining figures in print and at 390 px (num-phone-*.png, num-print-*.png). Computed font-variant-numeric is lining-nums and the headings carry "lnum". Small leftover: the numbered question marker "1." before the question in "Every answer" still draws an old-style figure that looks like a small capital I.
4. Web page with Prepared by: DONE. n5-pb and n1-pb web text: kicker "PREPARED BY MARY JONES MARKETING", no "List your business free" button, no Free listing bubble or rows, no claim panel, no "Want help" line. Footer reads "Only people with this link can see this report. To have it removed, contact First Answer Pages: contact page." then "Powered by First Answer Pages". Not owner-addressed. Wording nit: "contact First Answer Pages: contact page" reads clumsy.
5. Partly with full points: DONE. Cards read "Full points, one fix below" (Tap-to-call, Street address).
6. One answer: DONE. The "Who AI named" table is gone. The plain sentence reads "The one answer named you, and also named Hollow Creek Drains and Maple Street Pipe & Drain." With 5 answers the table stays, with the "not a ranking" note in How we checked.
7. Tip / Fix: DONE. "Fix" everywhere in the rendered output. No "Tip" found in any page.
8. "Run a new check": DONE by explanation. design.md row 795 gives the reason (saved reasons, pinned tests). The rendered output still has "Couldn't check this time. Run a new check later." and AI-limit lines. The recheck line and footer use "run a full new check".
9. Stronger CSV test: DONE. test/agency-report.test.js lines 242 and 243 assert health rows >= 30 and a "Website: " cluster; line 615 asserts no check in both sections, by id.
10. howWeChecked numbers: DONE. "Claude three times, ChatGPT once and Perplexity once", and "Claude once" for 1 answer. Nit: nearby body text still uses digits ("We asked Claude 3 times", "cited in 1 answer") next to "for one answer" in the Yelp line. This is not wrong but not uniform.

## Read-through
No broken or sales-like sentence found in Prepared by output. Without Prepared by the sales lines remain on purpose (free listing card, "can apply the fixes for you"). In print with 1 answer, "Every answer" repeats the answer text already shown in "What AI says".

## To fix for GO
Make page 1 hold the score box and the map, with no heading alone. Options: print the map before the health heading and let the intro stay with it, shrink the map, or put the heading inside the unbreakable block with the map. Then bring 5 answers to 8 pages, for example by keeping "Your fix kit" heading with its first box and tightening the half-empty page 4. Record the counts in design.md.
