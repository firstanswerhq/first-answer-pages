Verdict: NO-GO

Review of Step 2 (health map) and Q1-Q8, commit cf7522b (`git diff 91c7583..cf7522b -- server public test`). I read the code and the spec (requirements.md 2.1-2.9 and 5, design.md "Step 2 as built", review-2026-11-25-step1-reader2.md Q1-Q8). I did not change any code. Tests: 1803/1804. The one failure is the known `test/health-map.test.js:61` (V8).

Browser checks used Playwright and Chromium on the sample report (`scratchpad/orb/report.html`) and on an old report with no signals, two AI answers and a long name with `&`, `<` and `"` in it (`scratchpad/orb/old.html`).

Four items must be fixed before GO: V1 to V4 (and V8, the known test line). The rest are low.

## What passed

- **Q1-Q8:** all done in code, at `health-signals.js:36, 46, 48, 68, 97, 191-199` and `health-compare.js:257, 267`. Q8 is placed correctly (see V3 for its wording). No old Q wording is left in `server/` or `public/`, apart from `grade-checks.js:180` (V9).
- **Width:** no horizontal scroll at 1280 or 390 (scrollWidth equals clientWidth), and no element in `.health` goes past the screen edge.
- **JavaScript off:** with JS on and off, `body.innerText` is the same (4889 characters each). `<main>` HTML is also the same once the added canvas and `data-orb-started` are removed. No report content comes only from JS.
- **Reduced motion:** `document.getAnimations()` returns 0, there is no canvas, `.health-flow` and `.health-orb-host` are `display: none`, and the main thread does about 0.1 ms of work per second.
- **Hidden tab:** requestAnimationFrame drops to 0 calls per second and comes back at about 60 per second. CSS animations stop in hidden tabs. See V1 for two ways the loop can multiply.
- **Console:** no errors, no warnings, and no failed requests on any run.
- **Map is aria-hidden:** it holds 7 `<a tabindex="-1">` and nothing else focusable. 80 presses of Tab never put focus in the map. Clicking a node leaves focus on `BODY` and sets `:target`.
- **Phone tap (touch):** the node is a 42x42 px target. Tapping Reviews scrolls `#health-g-reviews` to the top with a 3 px outline, and the group lists every sub-node. This also works with JS off.
- **Phone tap (keyboard):** there is no keyboard path, because the nodes have `tabindex="-1"`. Keyboard and screen reader users lose nothing, because the full list sits right below the map and is always open. I accept this.
- **Focus:** focus is visible. A "Run a new check" link in the list gets a 3 px `#0C2C73` outline.
- **Contrast in the list (on `#FFFEF9`):** every pair passes AA. Good 6.33, Partly 6.27, Needs work 7.45, gray, reason and fix lines 7.56, cluster heading 7.56, intro on the page background 6.79. The amber group border is 3.61, which passes the 3:1 rule for non-text.
- **Contrast on the map:** node words on the node fill measure ink 14.6, green 9.9, amber 10.4, red 6.25 and gray 7.62. Sub-node words on the panel measure 16.0. The orb name over the bright middle of the glow is about 3.2 by itself, but it has a 4 px dark stroke (`paint-order: stroke`), so it reads. The map is decoration in any case.
- **Color is not the only cue in the list:** every row and heading has a symbol and a status word. On the map it is not, because the words cannot be read (V2).
- **Plain list vs map:** the 7 main nodes have the same words and statuses in both. Every sub-node is in the list. The sub-node words are different (V4).
- **"Founding spots still open":** it never appears on the map and is never a node or a light. It shows only as `<p class="health-note">` in the Free listing group, in plain text color. See V3 for its wording.
- **Score:** "Health 69" in the orb matches `grade-score-number` 69. `healthModel` only reads the grade. `grader.js` and `grade-score.js` did not change.
- **SEO (Requirement 5):** no route, layout, `html.js`, sitemap, robots or JSON-LD code changed. `page()` only gained a `scripts` option, and only `reportPage` uses it. The report keeps `noindex, nofollow`. Every SEO, JSON-LD and sitemap test passes, and no older test line changed apart from the Q wording.
- **Escaping:** the name `Smith & <Sons> "Heating"…` is escaped in the orb and the list, and is cut to two lines.

## Items

**V1. The orb's animation loop leaks: it never stops for a removed orb, and a repeated visible event starts another loop.** Must-fix.
- Where: `public/js/health-orb.js:29-60` (the `draw` loop and the `visibilitychange` handler) and `:69-71` (the MutationObserver).
- Problem: `grade.js` `watchRecheck` swaps `<main>` every 3 seconds, up to 60 times, while a recheck runs. After each swap the observer starts a new orb, but the old `draw` keeps calling requestAnimationFrame on a canvas that is no longer in the page. Its `visibilitychange` listener also stays.
  - Measured: about 60 calls per second at the start, and 540 per second after 5 simulated swaps, with only 1 canvas in the page. That would be up to 60 loops during a recheck.
  - Also, each `visibilitychange` while the tab is visible starts one more loop, because nothing checks whether one is already running. Three events took it to 240 per second.
- Fix:
  1. At the top of `draw`, add `if (!host.isConnected) { stop(); return; }`.
  2. In the visibility handler, add `if (!host.isConnected) return; window.cancelAnimationFrame(frame);` before asking for a new frame, so there is never more than one loop.
  3. Give the visibility and motion listeners named functions, and remove both in `stop()` with `removeEventListener`.
  4. Add a test in `health-map.test.js` that the script contains `isConnected` and `removeEventListener`.

**V2. The main nodes on the map cannot be read: 6.2 px on desktop and 5.7 px on phones.** Must-fix.
- Where: `server/lib/health-map.js:259-264` (`SIZE`, `R_NODE`), `:321-326`, and `public/css/style.css:2572-2574, 2606-2609`.
- Problem: the SVG is 1000 units wide but shows at 442 px on desktop (scale 0.442) and 353 px at 390 px wide (scale 0.353). So:
  - The node name and status at 14 or 16 units show at 6.2 px (desktop) and 5.7 px (phone).
  - The node symbol shows at 7.1 px and 5.7 px.
  - The score shows at 10.6 px on phones.
- On phones the map shows only the 7 main nodes, so in practice the whole phone map is colored circles with words nobody can read. That goes against 2.2 ("the label text always says the status") and the design's "Color is never the only cue".
- Fix:
  - **Phones:** write a second, main-only SVG in `mapSvg` (`health-svg-phone`) with `viewBox="150 150 700 700"`, `R_MAIN` 260 and `R_NODE` 82.
    - Put the node name on two lines: "Google / profile", "Details / match", "Free / listing", "AI / answers". Use font-size 26 for the name, 24 for the status and 26 for the symbol.
    - At 353 px that shows at about 13 px and 12 px.
    - CSS: `.health-svg-phone { display: none }`, and inside `@media (max-width: 600px)` use `.health-svg-full { display: none } .health-svg-phone { display: block }`. Both SVGs stay in the aria-hidden div.
  - **Desktop:** give the map more width with `grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)` (so the map is about 540 px) and raise the main node name and status to 22 units with `R_NODE` 66, using the same two-line names. That shows at about 12 px.
  - **Test:** pin the constants: font-size × (smallest map width ÷ viewBox) is 12 px or more for the main node name and status, at 1280 and at 390.

**V3. The Founding note is frozen at check time but is written in the present tense. It also reads as if you must pay.** Must-fix.
- Where: `server/lib/health-map.js:33` (`FOUNDING_NOTE`) and `:197`.
- Problem: `foundersOpen` is saved with the Grade when the check runs (`grader.js:1511`). The report has no live founders status, so a report opened after the deadline, or after the spots fill up, still says "Founding Member spots are still open." That would be untrue.
- "Founding Members pay once for the Verified stamp" also leaves out that the listing is free and the stamp is optional. `html.js:269` and `verify.js:189` always say both.
- Fix: `FOUNDING_NOTE = 'When we ran this check, Founding Member spots were still open. Listing is free; Founding Members pay once for the optional Verified stamp.'` (136 characters). Then update the Q8 row in `design.md` and the Q8 test.

**V4. The words on the sub-nodes on the map are different from the list's words, and nobody can read them.** Must-fix (cheap).
- Where: `server/lib/health-map.js:26` (`SUB_WORDS = MAIN_WORDS`), `:317`, `:343-350` (`subLabel`), and `style.css:2577`.
- Problem: each sub-node on the map shows a general word ("Good", "Partly", "Needs work", "Not checked"). The list shows the real label. For example, Business label is "Not found" in the list but "Needs work" on the map. Yelp is "Not linked" but "Partly". Listing is "Not listed yet" but "Partly".
  - Requirement 2.3 asks for "the same status words" in the map and the list.
  - The words show at 4.9 px on desktop. The sub-node symbols show at 5.3 px, so on the map the sub-nodes are really told apart by color alone.
- My judgment on the tiny labels:
  - Text that small is acceptable only as pure decoration. The map is aria-hidden, the list beside it holds every name and status, and sub-nodes are hidden on phones.
  - What is not acceptable is small print that says something different from the list.
  - Showing all 45 real labels legibly in a 440 px map cannot be done.
- Fix:
  - Remove `subLabel` and `SUB_WORDS`, so the sub-nodes on the map show the symbol and color only.
  - Raise `R_SUB` to 14 and `.health-sub-sym` to 20 units (about 9 px on desktop).
  - Add one line to `design.md` "Decisions made while building": on the map, sub-nodes are decoration (symbol and color); their names and status words are in the list beside it. This is a deviation from 2.2 for sub-nodes only, for the owner to accept.
  - Update the `health-map.test.js` assertions about sub words.

**V5. The dots on sub-node links jump once every loop.** Low.
- Where: `public/css/style.css:2598, 2602`.
- Problem: sub-node flows use `stroke-dasharray: 0.5 18` (a period of 18.5), but the shared keyframe moves `stroke-dashoffset` by -53. That is not a whole number of periods (2.86), so the dots jump every 2.6 seconds.
- Fix: add `@keyframes health-flow-sub { to { stroke-dashoffset: -37; } }` and use it for `.health-flow-sub.health-flow-out` and `.health-flow-sub.health-flow-in`, or change the sub dasharray to `0.5 26`.

**V6. The animation runs when nobody can see it.** Low.
- Where: `public/js/health-orb.js` and `style.css:2599-2601`.
- Problem: 76 SVG dash animations run without stopping. They repaint on the main thread, which cost about 115-120 ms per second in headless Chromium without a GPU, even after scrolling past the section. The canvas also keeps drawing at 60 fps when it is off screen.
- Fix:
  - In `health-orb.js`, add an IntersectionObserver on `.health`. When the section is not visible, cancel the requestAnimationFrame and add the class `health-paused`. When it is visible again, take the class off and start one loop. Use the guard from V1.
  - CSS: `.health-paused .health-flow { animation-play-state: paused; }`.
  - Optionally draw every second frame, since the turn is slow.

**V7. Red sub-node links barely show their break.** Low.
- Where: `server/lib/health-map.js:282`.
- Problem: the gap is 12% of a 44-unit link, which is about 2 px on desktop.
- Fix: for `size === 'sub'`, use `at(0.3)` and `at(0.7)`.

**V8. A known test failure.** Must-fix (already reported).
- Where: `test/health-map.test.js:61`.
- Problem: the test compares the raw `MAP_INTRO` text with HTML that has escaped apostrophes.
- Fix: `assert.ok(html.includes(h(MAP_INTRO)))`, using `escapeHtml`, or check against `textOf(html)`.

**V9. A Website row that was not checked says something vague, and the old Q3 wording is still in use.** Low.
- Where: `server/lib/health-map.js:34, 115` and `server/lib/grade-checks.js:180`.
- Problem:
  - Every HAVE row that was not checked says "We couldn't check this on your website this time." That is vague, and when no website was given it is untrue ("your website", "this time").
  - On a page built by scripts, the report now has three wordings for one fact. E3 says "...some AI tools can't read." These HAVE rows say "couldn't check this...". The checks list below says "...in a way this check can't read yet." That last wording is the one Q3 retired.
- Fix:
  - In `checkSub`, use `result.detail` as the reason when it is a string (it is already the report's plain wording), and keep `HAVE_NOT_CHECKED` only as the fallback.
  - Set `SCRIPT_BUILT_REASON` in `grade-checks.js:180` to "Your page loads its words in a way some AI tools can't read.", and update any test that pins it.

**V10. An old report repeats the same link 30 times.** Low.
- Where: `server/lib/health-map.js:215-218` (`reasonHtml`).
- Problem: on a report from before the signals, 30 gray rows each say "This report was made before this check existed. Run a new check to see it." That gives 30 identical "Run a new check" links, which is noisy for a screen reader's links list.
- Fix: when `grade.signals` is missing, show one `<p class="health-note">` under the intro that holds that sentence and the link. Give the rows the short reason "Made before this check existed." with no link.

**V11. The Socials heading holds its fix line, and an old report shows it gray with no reason.** Low.
- Where: `server/lib/health-map.js:239-241` and `:204-206`.
- Problem: in the full report, "Fix: ..." sits inside the `<h4>`, so it becomes part of the heading. On an old report the gray "Socials: Not checked" has no reason line. Every other gray item has one (8.2).
- Fix:
  - Move the fix into a `<p class="health-fix">` after the `<h4>`.
  - Have `socialsCluster` return `reason: 'This report was made before this check existed.'` when there are no signals, and print it like a row's reason.

**V12. After a scan finishes in place, the orb does not turn.** Low.
- Where: `server/lib/grade-html.js:206` (`scanPage`) and `:1120`.
- Problem: when a scan finishes, `grade.js` swaps the report into the scan page. The scan page never loaded `/js/health-orb.js`, so the orb stays still until the next reload. This fails gracefully, but the MutationObserver comment suggests it was meant to work.
- Fix: pass `scripts: [HEALTH_ORB_SCRIPT]` to the scan page's `page()` call as well. The script does nothing when there is no `[data-health-orb]`.

## Not issues (checked)

- Old reports show "Health: not scored yet" when there is no score, and a Website node that is green when its only checked row is green. Both follow the design's rules.
- A Reviews node that is green while "Reviews shown on your website" is red follows design rule 4.
- The `<a tabindex="-1">` links inside the aria-hidden map are allowed: they are not in the tab order, and clicking one does not move focus into the map.
