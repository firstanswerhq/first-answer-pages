Verdict: NO-GO (one must-fix, a print-CSS change; everything else is GO quality)

Review of HEAD d61c1af (kiro-rebuild-grader), batch 5 (`git diff 2d4831d..HEAD -- server public test`). I changed no product code.

## What I ran
- Read the three fix lists, the K and Z reviews, the design.md batch 5 tables, and the full diff of grade-html.js, agency-report.js, health-map.js, health-signals.js, fix-kit.js, mcp.js, style.css, health-scan.js and the test diffs.
- An end-to-end probe: `createApp` with a fake site and a fake assistant, a real Grade, then the real routes `/grade/:id`, `/print` and `/data.csv`, with and without "Prepared by", with a no-website business with unicode and quotes, and with a Facebook-page business.
- Chrome headless `--print-to-pdf` of the real `/print` page, then `pdfinfo`, `pdftotext` and page images.
- A hostile "Prepared by" and business name probe (`=HYPERLINK(...)`, `<script>`, quotes, newline, commas).

## Must-fix

### M1. K5: the printed report is 12 pages, not 6 to 8 (MUST-FIX)
- **Where:** public/css/style.css, the `@media print` block (`.health-map { max-width: 32rem; break-inside: avoid }`, `.grade-kit { break-before: page }`, `.health-group, .grade-check ... { break-inside: avoid }`).
- **Evidence:** the real print page of a small Grade (ONE answer, no sources) renders to 12 Letter pages.
  - Page 1 is the score box and a heading, then more than half the page is white. The map does not fit under it and `break-inside: avoid` pushes it whole to page 2.
  - Page 2 holds only the dark map.
  - Pages 8 to 10 are each about half empty (score cards pushed whole).
  - Page 11 is half empty before the fix kit's second page.
  - With the 5 to 7 answers a real check has, "Every answer" adds more pages, so a real report will be 13 to 15.
- **Why it matters:** the owner's decision was "tight 6 to 8 pages, no near-empty cover page". Page 1 is still a near-empty cover and the map still has a page of its own.
- **Fix, in words:** in print, make the map small (for example `max-width: 18rem`, or put it beside the "Health" list heading) so it fits on page 1 under the score. Let the `.health-group` and the score groups flow (keep `break-inside: avoid` only on a single row or card, not on a group or section). Re-run the PDF and check it is 8 pages or fewer for a report with 5 answers. Also add a test that fails when the map has no print width limit.

## Should-fix

### S1. K4: an agency printout and CSV still carry our directory rows (SHOULD-FIX)
- **Where:** health-map.js `listingSub` (the agency flag only changes wording, the rows stay), `healthModel` (the "Free listing" main node stays), agency print page and `reportCsvFor`.
- **Evidence:** with "Prepared by: Acme Agency", the print text still has the "Free listing: Not started" circle (twice, map and list), "Listed on First Answer Pages: Not yet", "Verified stamp: No listing yet", "Listing matches your website: No listing yet" and "Listing links to your website: No listing yet". The CSV has the same 5 rows under group "Free listing" (see `data.csv`, rows `health,Free listing,...`). The Founding Member note, "claim it below", the claim button and "Want help?" are gone as required.
- **Failing example:** a client opens the agency's PDF and reads "Verified stamp: No listing yet", a product of a third party the agency never mentioned. This is the same kind of line K4 removed.
- **Fix, in words:** when `agency` is true, leave the `listing` node out of `healthModel` entirely (map, list and CSV). Add a test that an agency print page and CSV contain no "Verified stamp" and no "Listed on First Answer Pages".

### S2. K1 fallback can put the wrong question over an answer (SHOULD-FIX, low risk)
- **Where:** grade-html.js, `answersSection`, the `prompts` list and the `question` fallback (about line 985).
- **Problem:** `prompts` is built from `a.prompt`. If a Grade has some answers with prompts and some without, the group with `undefined` gets the first question as its heading. That repeats the first question and mislabels answers that belong to another question. Today only a stored old Grade or a hand-made sample can have a missing prompt, so the chance is small.
- **Fix, in words:** group answers with no prompt under a heading of "Question not saved" or no heading, and only use the free-question fallback when every answer lacks a prompt.

### S3. K2 holds, but the card's "Pass" and the map's tip could still be read as two verdicts for a very small group (NIT-level)
- Both show green with the same words now (probe: the card has "Tip: We saw a tap-to-call link but couldn't read the number" and the map row is green with the same label). No change needed beyond the test already added.

## Passed (verified, with the evidence)
- **Z1:** a Facebook-page business with three cited pages gives a plain `facebook.com` row (own false) and a `facebook.com/riverbendplumbing` row (own true), and the gap line still counts 3 answers. Test and code agree.
- **Z2-Z5:** `google.evil.com/maps` and `google.com.evil.example/maps` are false. Search listings return hours. "Listing not found" has `structuredContent.fetchedAt`. An unreadable stored date gives the unconfirmed shape. Only edge: a record that has a readable `verifiedAt` but an unreadable `verifiedDate` now counts as unconfirmed. I saw no such record.
- **K1:** the report of a Grade with no prompt never contains "undefined" (grep of report and print in two probes).
- **K3:** cited sites are counted only from answers with `webSearch === true`. The CSV `sites_cited` is blank for a memory answer. The evidence line says "without a live web search" only on those answers.
- **K4 (the rest):** `Want help?`, the free listing card, claim button, "claim it below", Founding Member note, "can apply the fixes" and the no-website free listing sentence are gone from the agency print page. One line "Powered by First Answer Pages" ends it. On screen "Want help?" is hidden and the listing card stays. Without "Prepared by" every offer stays. CSV contains no sales lines.
- **K6, K7:** `pdftotext` finds no "See the full answer" and no "Copy" word. The orb label "Score 68/100" appears once on page 2 (no doubled text).
- **K8-K16, K18-K23:** present and consistent with the design table. K16 shows the stored model and time ("Claude (model claude-sonnet-4-5), asked Nov 24, 2026, 12:00 PM CT, with a live web search"). The time zone is fixed to CT and is labeled, which is accurate.
- **K17:** the CSV has one header row first, 23 columns on every row (my probe: all rows the same width), business, website, city, state, date, score, prepared_by, check rows with points, named rows with "N of M", site rows and cited sites.

## Security and robustness
- **"Prepared by":** `cleanPreparedBy` removes control characters, bidi marks and `<` `>`, collapses spaces, and cuts to 60 code points. It is written through `h()` on the print page and the form value, and through `csvCell` in the CSV. Probe: `=cmd|"x",\n+evil <script>alert(1)</script> & "q"` becomes `'=cmd|""x"", +evil scriptalert(1)/script & ""q""` in the CSV (one cell, formula guarded), and the print HTML has no raw `<script>alert(1)`. The business name `=HYPERLINK("x") <b>Zed</b>` is formula guarded in every row and escaped in HTML.
- **CSV:** `csvCell` guards a leading `= + - @ tab CR`. It does not guard a leading space or a newline. Both are inert in Excel and Sheets (the spaces make it text), so I list it as a NIT only.
- **fix kit `sameAs`:** only `https://` profile links found on the business's own site, and `<` is escaped inside the JSON-LD block, so no `</script>` break-out.
- **Secrets and stored data:** the batch 5 diff adds no logging and stores no raw Google or Bing data (signals only, as before). `server/routes/grade.js` was not changed.
- **Honesty:** no new red for an unknown (K9: "We didn't test your website address on this check."). No "may have closed". No promise that AI will name a business. K8 says the missing points "don't count for or against you".

## Regressions
- **SEO:** robots, sitemap, JSON-LD and noindex files are untouched (diff has only report code, CSS, health-scan.js and mcp.js). mcp.js adds `hours` to search results (public data) and a fetchedAt to the not-found error.
- **The 7 fix B tests:** none was weakened. Y4 and K17 now read rows by the section column, keep the count of 2, keep the order of engines, and require 23 columns on every row. F3 and V136 expect the new names and the "names are read when drawn" point is kept. V251, V157 and V225-4 follow the one wording "run a full new check". V137 was a real code bug and the code was fixed. NIT: grade-reader-notes.test.js has one mis-indented `assert` line.
- **FULL_NEW_CHECK:** the recheck line and the footer both use it. The other "Run a new check" links (health rows, limit and failure notices) are a different, older wording. They are links to the same page, so it works, but the names differ from "run a full new check" (NIT).
- **`agency` name clash:** fixed cleanly. `agencySections` is the sections string, `agency` is the boolean. I found no other shadowed name in grade-html.js, and `node --check` passes for every changed file (the suite loads).

## Random real business
- No website: the report, print page and CSV build with no error and no "undefined", "NaN" or "[object" text. Score is blank in the CSV and the notice says "Add a website to get a score." (the free listing sentence is removed with "Prepared by").
- Unicode, quotes and `&` in the business name and "Prepared by": escaped in HTML, quoted in CSV. A name over the Grade form's limit is rejected before a Grade exists (not a report problem).
- Facebook-page business: no "(your website)" on competitor pages.

## Counts
MUST-FIX 1, SHOULD-FIX 2, NIT 4 (CSV leading space, mixed "run a new check" wording, mis-indented test line, `<title>` still says "| First Answer Pages", which shows in a browser's print header; and an agency who prints the screen page instead of /print still gets our listing card).
