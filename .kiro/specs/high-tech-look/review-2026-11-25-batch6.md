# Review of batch 6 (commit 8884974, branch kiro-rebuild-grader)

## Verdict: NO-GO (small). The code is clean; one required measurement is missing and one item was skipped.

`timeout 600 node --test`: 1885 of 1885 pass, 0 fail, 0 skipped (92 s). No product code was edited by this review.
Ship once fixes 1 and 2 below are done; nothing found is dangerous.

## Checklist (diff base 50f366f~1..HEAD)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Print length, 6 to 8 pages | PARTLY | Rules are in place: style.css @media print has no `break-before`, no group `break-inside`, map `max-width: 15rem; order: -1` in a flex column, `.grade-ai details, .grade-ai .grade-answer` hidden, `.grade-check.pass, .grade-check.not_checked` hidden, and a print-only note (`PRINT_CARDS_NOTE`, grade-html.js). The required page counts (1 answer, 5 answers) were NOT measured; design.md row "1 (page count)" says "Not measured". Page 1 is also at risk, see fix 1. |
| 2 | "Prepared by" is the agency's own report | DONE | Kicker: grade-html.js ~1213 (`grade-eyebrow-sub grade-prepared-by`). Free listing group dropped: health-map.js 296 (`filter(node => !(agency && node.id === 'listing'))`), `MAP_INTRO_NO_LISTING` at 37. CSV drops it with or without a name: grade-html.js reportCsvFor `m.id !== 'listing'`. I rendered a print page: no "Free listing", and the kicker reads "Prepared by" with the name escaped. |
| 3 | Broken footer sentence | DONE | `PRINT_FOOTER_TAIL` and the regex in printPage (grade-html.js ~1443). I rendered it: "so check again after you make fixes." Test added. |
| 4 | No green check beside "but" | DONE | health-map.js 170-177 returns `partly` when `checkTip` fires. checkRow (grade-html.js ~770) shows "Partly" with the same tip, points unchanged. CSV uses "Partly". Only two labels contain "but" (health-map.js 146, 148), both covered. |
| 5 | Voice and sites under the score box, plus the plain line | DONE | `agencySections` moved above `healthMap` (grade-html.js ~1277). `voiceSummary` (~1340) uses real counts only and is empty with fewer than 2 answers. Rendered: "One competitor was named in every answer. You were named in 4 of 5." |
| 6 | Evidence line wording, one time zone | DONE (CST, not CT) | agency-report.js `evidence` gives "Evidence: Claude m, Nov 24, 2026, 12:00 PM CST, live web search on." Uses `formatRunTime` like the footer. The list said CT; Kiro chose CST/CDT to match the footer and logged it in design.md. Acceptable. |
| 7 | CSV cleanup | DONE | (a) health rows that show a scored Check are skipped via `CHECK_ROW_NAMES`; one vocabulary Pass/Partly/Needs work/Not checked. (b) `csvDate` gives "2026-11-24 12:00" Central, on `check_date` and the answer date; checked in output. (c) Header first, 23 columns, formula guard kept (tests cover each). |
| 8 | "How we checked" | DONE | `howWeChecked` (grade-html.js ~1310), in the footer (screen and print). Real counts: "We asked one question and got answers from Claude 3 times, ChatGPT once and Perplexity once. ... a snapshot, not a ranking." Empty when no answers. No promise language. |
| 9 | Share box line | DONE | `PRINT_FOR_CLIENTS` in downloadBlock. |
| 10 | Answer with no prompt | DONE | `NO_QUESTION_SAVED` and `noneSaved` in answersSection. Rendered: "Answer, question not saved" next to "Q1?"; fallback only when none kept a prompt. |
| 11 | "your fix kit" | DONE | grade-html.js `IN_KIT`. |
| 12 | Lining numerals | DONE | style.css: `.grade-report, .health, h2, h3, .health-row-name { font-variant-numeric: lining-nums; }`. |
| 13 | failedNote wording | DONE | grade-html.js `failedNote`. Test asserts the exact sentence. |
| 14 | "run a new check" wording in health rows and notices | MISSING | Kiro skipped it on purpose (design.md "Nit 14") because older tests pin the words. Footer and recheck line use `FULL_NEW_CHECK`; health rows and notices still say "run a new check". Declared, but not done. |
| 15 | CSV leading-whitespace guard | DONE | agency-report.js csvCell: `/^\s*[=+\-@\t\r]/`. Note `\s*` also guards cells that start with plain spaces then a symbol. Test added. |

## Regression checks

- Duplicated identifiers: none. The module imports cleanly, the full suite loads, `NO_QUESTION_SAVED`, `PRINT_*` and `SNAPSHOT_LINE` are each declared once. No repeat of the batch 5 `agency` clash.
- SEO output: print and report pages keep `noindex, nofollow` (test still asserts it). The kicker text changed only for agencies. Public pages were not touched (only style.css, grade-html.js, health-map.js, agency-report.js changed in server and public).
- XSS and escaping: "Prepared by", voice summary, how-we-checked and the new heading all go through `h()`. I rendered `preparedBy: '<b>Acme</b>'`: it comes out as text, no raw tag. CSV cells go through `csvCell`.
- Honest checks: "Not checked" is never turned red. Partly is yellow and points are unchanged (earned still from `r.result`). In print, `Not checked` score cards are hidden, but the health list above still shows them gray, and the print note says where every check is. OK.
- CSV: header first, 23 columns on every row (test loops `row.length === CSV_COLUMNS.length`), dates are Central minute precision, no milliseconds.
- Weakened tests (diff of test/): mostly updated to new wording, but three are looser:
  1. agency-report.test.js: `csvSection(text,'health').length >= 40` became `>= 1` (justified by the dedupe, but now barely a test).
  2. Same file: the "Website: Search basics" cluster-name assertion became "every health row has a group".
  3. grade-report-asks.test.js: `includes('and got') === false` became a regex on "and got N answers", because How we checked now contains "and got answers from". Replaced with a positive assertion on the lead line, so it is acceptable.
  Removed assertions of `break-before: page` and `.grade-meta a` hidden are replaced by the new rules; fine.

## Fixes by severity

### Should fix before GO
1. (Item 1) Measure the real /print page and record the counts in design.md. `/usr/bin/google-chrome` and `wkhtmltopdf` are installed here. Do it with a real stored grade of 1 answer and of 5 answers (Claude x3, ChatGPT, Perplexity); the thin test fixtures have no check results and would understate the length. Also confirm page 1 holds the score box AND the map.
2. (Items 1 and 5 collide) In the DOM the voice table and sites list now sit between the score box and the map, so on paper the 15rem map may be pushed to page 2, which defeats "score box and map on page 1". If the measurement shows that, either put the map before the voice table in print only (CSS `order` on a wrapper) or keep the order and shrink the voice and sites blocks in print.

### Nice to fix
3. (Item 14) Make the "run a new check" links in health rows and notices use `FULL_NEW_CHECK`, updating the pinned tests (health-signals, V157, V244). It is a wording pass; the deviation is already logged, so the owner may accept the skip.
4. Restore a stronger CSV assertion: for example that a health group still carries its cluster (`Website: ...` for some row) and that `health.length` is above a sensible floor.
5. Edge case: `reportCsvFor` drops a health row whose name is in `CHECK_ROW_NAMES` even when the grade has no stored result for that check (old reports). That row then has neither a "check" row nor a "health" row. Low risk; only drop the health row when the matching check row exists.
6. howWeChecked mixes "3 times" (digits) with "once"/"one question". Cosmetic.
