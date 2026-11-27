Verdict: NO-GO

Second-pass code review of the batch 3 fixes X1-X16 (`git diff 54fdd86..92d1764`) and Requirement 13, the agency report (`git diff d529ad4..54fdd86`). Commit reviewed: 92d1764 on kiro-rebuild-grader. I changed no code.

## What I ran
- `npm test`: 1850/1852. The 2 failures are the known ones already sent back (grade-fair-use.test.js:80/91 for www/path on your own domain; admin-login.test.js:419/426, which expects logout to clear two cookies). They are not repeated below.
- I rendered a Riverbend report from 92d1764 (full, locked, print, CSV and the Checking page) with sources, extra second opinions and a hostile "Prepared by" value. I served it with the real `/css` and `/js`, then ran Playwright and Chromium (`chromium.launch()`, no options) at 1280x900, 1440x800, 390x844 and 360x740.
- The Checking page swap: Playwright routes served the scan page, then `status.json` reported done, then `grade.js` `swapInPage` swapped in the full report.
- I emulated print media on the print page and printed it to PDF (17 pages).
- I ran a Node probe of `sameBusinessInput`, `cleanPreparedBy`, `csvCell`, `markedAnswer`, `shareOfVoice` and `sitesUsed`.

## Why NO-GO
Two small things in the client-ready download are wrong. Both are quick to fix:
- **Y1:** on a business whose website is a Facebook page (or any shared host), every facebook.com source is labeled "(your website)", including competitors' pages.
- **Y2:** the print page runs the scan. Printing in the first 3 seconds gives a PDF whose map says "Score 26/100" under a "68 / 100" header.

Everything else passes.

## Batch 3 items

| Item | Status | Where | Notes |
|---|---|---|---|
| X1 | Fixed | public/js/health-scan.js:89-90, 112 | It watches `.health-map` at 0.5. Playwright at all 4 sizes: the scan plays once when the map scrolls into view, 7 captions in order ("Website: Partly" ... "Free listing: Not started"), the count goes 9→17→...→60→68, and it doesn't play again after scrolling away and back. The final `.health` HTML matches the reduced-motion HTML exactly, apart from the orb's canvas, which health-orb.js adds and which isn't part of the scan. With reduced motion there is no scan. |
| X2 | Fixed | server/lib/grade-html.js:241; health-scan.js:96-108 | The Checking page loads the scan script. After the swap the MutationObserver finds `.health`, and the scan plays on scroll (1280 and 390 wide) and ends at "Score 68/100". With reduced motion on the swapped report there is no scan. See Y5 and Y6 for two edge cases. |
| X3 | Fixed | server/lib/grader.js:1894-1897 | It needs an exact name `match` plus `sameSite` (shared hosts never count), or no website on either. Tests: grade-fair-use.test.js:177. |
| X4 | Fixed | grader.js:1903 | `isStale(g, clock.now())`. Test :187. |
| X5 | Fixed (as decided) | grader.js:172-186, `hostKey` | Probe: nashville./memphis.mrrooter.com in different cities → different; www.nashville vs nashville → same; shop.joe.example in the same city → same, in another city → different; facebook.com/joe vs m.facebook.com/joe/ → same; /joe vs /bob → different. Path-based franchise pages on one host still count as one business, which is what the owner decided. The deviation is recorded. |
| X6 | Fixed | routes/grade.js:232; grader.js:1906, 1943 | Test :199. |
| X7 | Fixed | grader.js:190 | Probe: Springfield IL vs TN → different; "springfield il" vs "Springfield IL" → same. |
| X8 | Fixed (deviation recorded) | server/lib/health-signals.js:225 | "Expired" with no date. TLS is not loosened. |
| X9 | Fixed | health-signals.js:240 | |
| X10 | Fixed | server/lib/safe-fetch.js:124-136; health-signals.js:238; FIXES.addressWorks | It waits 1 second, then looks up `www.` once (nothing is fetched). `www_only` shows as gray. The new sentence is under 160 characters. |
| X11 | Fixed (as decided) | health-signals.js:211 | `CERT_WARN_DAYS = 7`. |
| X12 | Fixed | health-scan.js:58-66; public/css/style.css:2587 | Timers and the listener are cleared. The `:empty` rule is gone. |
| X13 | Fixed | grade-html.js:377-392, 638 | The text is escaped before the `<mark>` goes in. Probe: `&amp;`/`&quot;` are never matched inside an entity, and "Joe's" (`&#39;`) is matched. |
| X14 | Fixed | test/grade-fair-use.test.js:142, 167 | |
| X15 | Fixed (as decided) | routes/grade.js:220-228 | It now runs after Turnstile and the per-address and per-network limits. |
| X16 | Fixed | server/routes/admin.js:241 | The matching test is the known admin-login failure. |

## Requirement 13 checks that pass
- **13.1 share of voice:**
  - Names come only from `competitors`, plus `named` for the business itself, counted once per answer with case ignored.
  - The checked business is always a row ("2 of 4", highlighted, "(you)"). An answer that is only whitespace is skipped (4 answers, not 5).
  - `<b>` and `=HYPERLINK(` names are escaped. The section appears only on the full report; the locked report has none of the 13.x sections.
- **13.2 sites AI used:**
  - Only http(s) URLs from the stored `sources` are listed (Gemini stores none; Google's live answer isn't stored).
  - Each domain counts once per answer. Links use `rel="nofollow noopener noreferrer"`.
  - The gap line appears only for the 5 directories, and only when the link signal is `partly` ("Not linked").
  - With no sources, the page says "These answers didn't list their sources."
- **13.3 evidence:** for example, "Evidence: Claude (model claude-sonnet-4-5), asked Nov 25, 2026, 10:52 AM CT, with a live web search." `webSearch` comes from the provider (true for Claude, Perplexity and Grok; false for ChatGPT and Gemini). See Y7.
- **13.4 print page (print media):**
  - Hidden: `.site-nav` and `.site-footer`, every form, the download block, the orb host, the flow dots and the phone drawing.
  - The wide drawing shows as a block, all 8 `<details>` are open, and no visible element has an animation. Each section starts on a new page.
- **13.4 CSV:**
  - The columns are `section,group,item,status,detail,engine,model,question,named,date`, with one row per health row and one per answer.
  - Cells starting with = + - @ tab or CR get a `'` in front, and commas and quotes are quoted correctly.
  - The download is sent as `text/csv` with `attachment`, noindex and no-store.
- **13.5 Prepared by:**
  - Control characters, direction marks and `<>` are removed, the value is one line, capped at 60 code points (probe: 80 x → 60), and escaped in the value attribute and on the print page.
  - The first CSV line is guarded against formulas. The value is stored only on the grade, and grep finds it in no public page, status.json or admin page.
- **Access rules:**
  - `/print`, `/data.csv` and `/prepared-by` use `fullAccess`, the same rule as the full report: done, plus gate off or the unlock cookie. Otherwise they redirect.
  - IDs are checked against `ID_PATTERN`. Every /grade response still gets the noindex, no-store and no-referrer headers.
  - Prepared-by is rate limited. No new public route exposes a report.
- **No new paid calls.** The score didn't change (tests pass), and nothing touched robots.txt, the sitemap or JSON-LD.
- **Wording:**
  - Every new sentence is 160 characters or less, in American spelling.
  - No sentence promises that AI will name the business.
  - No report content is added only by JavaScript.

## Items

### Y1. A competitor's Facebook page is labeled "(your website)" (must-fix)
- **Where:** server/lib/agency-report.js:74 (`own: Boolean(website) && (sameSite(website, s.url) || registeredDomain(website) === domain)`).
- **Problem:** `sameSite` correctly returns false for shared hosts, but `registeredDomain(website) === domain` then marks the row anyway.
  - Probe: website `https://www.facebook.com/` with websitePage `/riverbend`, and the source `https://www.facebook.com/someothercompetitor`. Result: `facebook.com: cited in 1 answer (your website)`.
  - The same happens on wixsite, linktr.ee, sites.google.com and every other shared host. Small trades often use a Facebook page as their website, so this false claim would land in the client PDF.
- **Fix:**
  - Mark a row `own` only when `sameSite(website, s.url)` is true (drop the `registeredDomain` alternative). Or, for a shared host, mark it only when `pageKey(s.url) === pageKey(grade.input.websitePage)` (import `pageKey` from name-match.js) for at least one source of that domain.
  - Add a test: a Facebook-page business, where a competitor's facebook.com source is not marked "(your website)".

### Y2. The print page plays the scan, so a quick print shows the wrong score in the map (must-fix)
- **Where:** server/lib/grade-html.js:1247-1257 (`printPage` reuses `reportPage`, which loads `HEALTH_SCAN_SCRIPT` at :1177).
- **Problem:** "Download report" opens the print page with the map near the top, so the scan starts at once.
  - Measured: about 1.2 seconds after opening, print media showed the map's score text as "Score 26/100" (`display: block`), while the header said 68 / 100.
  - The print CSS forces the branches to full opacity, but the count-up text is changed by JavaScript. Pressing Ctrl+P within about 3 seconds saves a PDF with two different scores, which breaks 2.10.2.
- **Fix:**
  - In `printPage`, drop the scan script. For example, pass a `print: true` option so that `reportPage` uses `scripts: [HEALTH_ORB_SCRIPT]` only (or none), since the print page needs no animation.
  - As a second guard, in health-scan.js `watch()`, return early when `document.querySelector('.grade-print')` exists, and call `finish()` on `beforeprint`.
  - Add a test that `printPage(...)` doesn't contain `/js/health-scan.js`.

### Y3. The Google gap line fires for any google.com page, not just a Google profile (low)
- **Where:** agency-report.js:51-57, 81-88 (`{ domain: 'google.com', ... page: 'your Google profile' }`).
- **Problem:** a source at `support.google.com/...` or `google.com/search?...` counts as "AI read Google for N answers. Your website doesn't link to your Google profile." The probe showed 3 Google answers, but only 1 of them was a Maps page.
- **Fix:** for the Google gap, count only sources whose URL is a profile or Maps page: host `maps.google.com`, `business.google.com`, `g.page`, `maps.app.goo.gl`, or a path starting `/maps` on google.com. Keep the domain row as it is.

### Y4. The CSV and share of voice can disagree on how many answers came back (low)
- **Where:** grade-html.js:1263 (`aiOf(g)`) and agency-report.js:18-19 (`answersOf`).
- **Problem:** the CSV keeps an answer with empty or whitespace-only text (as "named: no"), but share of voice skips it. Probe: the CSV has 5 answer rows and the page says "across 4 answers". Stored answers normally have text, so this is rare.
- **Fix:** build the CSV answer rows from the same filter: export `answersOf` from agency-report.js and use it in `reportCsvFor`.

### Y5. If the tab is in the background when the report is swapped in, the scan never plays (low, owner call)
- **Where:** public/js/health-scan.js:109-111 (`shouldScan({ hidden: document.hidden, ... })` at setup, with no retry).
- **Problem:** a check takes about a minute, and many people switch tabs while they wait.
  - Measured: with `document.hidden` true at the swap, then visible again and the map scrolled into view, the scan did not play.
  - This matches 2.10.3 as written ("a hidden tab: no scan"). The same applies to a report opened in a background tab.
- **Fix (if the owner wants the scan in that case):** when hidden at setup, add a one-time `visibilitychange` listener that calls `watch()` again once `document.hidden` is false. Keep the hidden check inside the IntersectionObserver callback.

### Y6. A "Check again" swap before the scan played leaves the observer on the old map (low)
- **Where:** health-scan.js:112-123, and public/js/grade.js:73 (`watchRecheck` swaps `main`).
- **Problem:** if the visitor starts "Check again" before scrolling to the map, the swap replaces `.health`. The IntersectionObserver keeps watching the removed node, so the new map never scans. `run()` would also bail on `section.isConnected`.
- **Fix:** while `played` is false, keep a MutationObserver on `document.body`. When the `.health` node changes, disconnect the old IntersectionObserver and call `watch()` again.

### Y7. 13.3 Evidence leaves out the exact question, and this isn't in the deviations table (low)
- **Where:** agency-report.js:110-114; design.md (the 13.3 row).
- **Problem:** 13.3 says the Evidence line includes "the exact question asked". As built, the question is the `<strong>` heading above the group in "Every answer", and the CSV has it on each row. The design.md row explains this, but it isn't in a "Deviations for the owner to approve" table, so the owner hasn't signed off on it.
- **Fix:** add a row to the deviations table: "13.3 | the exact question on each Evidence line | the question is the heading right above its answers on the page, and on every CSV row | it would repeat the same question up to 9 times." Or add `Question: "<prompt>".` to each evidence line, which keeps it under 160 characters for the current prompts.
