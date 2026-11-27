Verdict: GO

Second-pass review of the Step 2 fixes, commit d069a31 (`git diff cf7522b..d069a31 -- server public test`). I read the code, the two Step 2 reviews and the design table. I did not change any code. Tests: 1808/1808 pass.

Browser checks used Playwright and Chromium on the sample report (re-rendered from d069a31, AI named the business in 2 of 3 answers, score 68). I also rendered three variants of it: no AI answer, an old report with no signals, and the unlocked full report.

Every must-fix item from both reviews is fixed: V1-V4, V8, H1, H3 and H4. H5 is fixed in code. H2 is fixed in code, but the sample still shows the contradiction because of how the sample was built (W6). Nothing new is must-fix. W1-W10 are all low.

## What I measured

- **V1 leak (simulated `grade.js` `swapInPage`):**
  - requestAnimationFrame ran at 61 calls/s at the start, 60/s after 10 swaps of `<main>`, and 61/s after 5 extra `visibilitychange` events while visible. There was 1 canvas.
  - With the section scrolled off screen: 0 calls/s, `.health-paused` set, and all 78 CSS animations paused.
  - Hidden tab: 0 calls/s, then 60/s when visible again.
  - One leftover: see W1 (listeners on orbs swapped out while paused).
- **Text sizes on screen.**
  - 1280 (map 530 px): node name 12.7, status 12.7, symbol 13.8, orb name 12.7, score 15.9, sub symbol 10.6.
  - 390 (map 353 px): name 13.1, status 12.1, symbol 13.1, orb name 12.1, score 15.1.
  - No node or orb word goes past its circle, and no circle is clipped by the box.
  - Other widths: see W3.
- **Horizontal scroll:** none at 320, 360, 375, 390, 430, 600, 601, 700, 899, 900, 1024, 1280 or 1440. No element in `.health` goes past the screen edge.
- **JS off vs JS on:** `body.innerText` is identical (5473 characters each).
- **Reduced motion (390 and 1280):** 0 animations, no canvas, `.health-flow` and `.health-orb-host` are `display: none`, and 0 requestAnimationFrame calls/s.
- **Focus:** 120 presses of Tab never put focus in the map or inside anything aria-hidden. "Run a new check" in the list gets a solid 3 px `#0C2C73` outline.
- **Map is aria-hidden:** `aria-hidden="true"`, with 0 focusables apart from `tabindex="-1"` links. Tapping a phone node sets `#health-g-website` at the top with focus on BODY. "Back to the map" brings the map back to the top.
- **AA contrast, every word.**
  - List words (on the group background): ink 17.3, green 6.33, amber 6.27, red 7.45, gray, reason and cluster lines 7.56, link 12.8.
  - Intro and the new "That counts the scored checks" note: 6.79.
  - Map words (on the node fill or the panel): ink 14.6, green 9.9, amber 10.4, red 6.25, gray 7.62, orb name 16.0, score 13.1, phone tap hint 16.0.
- **Map vs list for every node:**
  - The 7 main nodes have the same name, status class, status word and symbol on the map and in the list, on both drawings.
  - The 43 sub-nodes match the 43 list rows one to one, in order, with the same status and symbol.
  - Each status has exactly one color on the map. No status word is used with two different statuses in the list.
- **Free listing:**
  - The node is `health-node-info`, with an ink ring (no green, amber, red or gray) and the words "Not started".
  - The group and rows are `health-info` in plain text color.
  - "Founding" never appears on the map. The Founding note appears once, with the V3 wording.
- **Score:** the orb shows "Score 68/100" and the top of the page shows 68.
- **Console:** no errors, no warnings and no failed requests.
- **Public SEO:**
  - No change in routes, `html.js`, robots, sitemap or JSON-LD code. The only non-report changes are in `grade-checks.js`: the hours fix text and the script-built reason, which show only on noindex report pages.
  - The report keeps `noindex, nofollow`.
  - The two indexable pages (form, about) are untouched. All SEO, sitemap and JSON-LD tests pass.

## V items (review-2026-11-25-step2.md)

| Item | State | Where | Note |
|---|---|---|---|
| V1 animation leak | Fixed | `public/js/health-orb.js:36, 59-63, 69-73, 90-98`; test `test/health-map.test.js:374-377` | The rAF loop never multiplies (measured). Listeners leak only for orbs swapped out while off screen (W1). |
| V2 map words unreadable | Fixed | `server/lib/health-map.js:317-320, 367-379, 427-443`; `style.css:2540, 2544, 2623-2624`; test `health-map.test.js:109-128` | 12.7 px at 1280 and 12.1 px at 390. The test pins `minShownPx: 540`, but the map is 530 px at 1024 and up, and 494 px at 900 (W3). |
| V3 Founding note | Fixed | `health-map.js:34, 242`; `design.md:321, 416` | The old wording is still in `design.md:377` (W8). |
| V4 sub-node words | Fixed | `health-map.js:408-415` (no words), `:324` (`R_SUB` 14); `style.css:2587` (symbol 20); `design.md:417` (deviation recorded) | |
| V5 dot jump | Fixed | `style.css:2611-2612, 2616` | The sub period is now 26.5, and -53 is 2 whole periods. |
| V6 runs off screen | Fixed | `health-orb.js:78-88`; `style.css:2550` | Measured 0 rAF/s and all animations paused off screen. |
| V7 red sub break | Fixed | `health-map.js:345` | |
| V8 test | Fixed | `test/health-map.test.js:69-70` | |
| V9 vague not-checked and Q3 wording | Fixed | `health-map.js:122`; `grade-checks.js:181` | `NO_WEBSITE` has no period (W9). |
| V10 30 repeated links | Fixed | `health-map.js:36-37, 131, 455` | The old-report variant shows one note with one link, and the rows say "Made before this check existed." |
| V11 Socials heading | Fixed | `health-map.js:291-294, 251` | The fix is a `<p class="health-fix">` after the `<h4>`. On an old report Socials has its reason. |
| V12 scan page script | Fixed | `grade-html.js:238` | |

## H items (review-2026-11-25-step2-reader.md)

| Item | State | Where | Note |
|---|---|---|---|
| H1 "Health 69" vs intro | Fixed | `health-map.js:32, 387-389` | "Score 68/100", and the intro says what the colors mean. The no-score wording differs from the top of the page (W10). |
| H2 address Good and missing | Fixed in code; the sample still shows it | `health-signals.js:440-445`; `grade-html.js:606` | In a real check, `found.address` is the `STREET_PATTERN` match, so "Street address on the home page: Good" always comes with a readable address and a filled-in preview. The sample (`render.mjs`) passes `address: ''` with `address-shown` passing, so the judge's page still shows the contradiction (W6). |
| H3 "Partly" for "Not linked" | Fixed | `health-map.js:93, 408-415` | No words on sub-nodes. "Not found" is red everywhere. Bing says "Not on Bing Maps yet". |
| H4 unreadable map | Fixed | as V2 | Main words are 12 px or more at 1280 and 390. Sub-nodes are symbol and color only. |
| H5 empty AI answer | Fixed | `grade-html.js:1149-1157`; `health-map.js:240, 302` | The no-answer variant shows "AI answers: Not checked" with one line and the link, and no "Answer 1". The sample now has answers. |
| H6 jargon | Fixed | `health-map.js:58-93` | Plain words first, with the technical name in brackets. |
| H7 rows repeat themselves | Fixed | `health-map.js:58-98` (`words`) | One new repeat: "Founding Member: Founding Member" (W5). |
| H9 one idea, several words | Partly | `health-map.js:74-76, 92, 99`; `grade-checks.js:121` | Listing, hours and the calling rows are fixed. Still open, and recorded as the owner's call in `design.md` H9: the fix card title "Can AI see your reviews?". Not mentioned: "Speaks AI's language" still has no score line, and "AI" and "AI assistants" are still mixed. |
| H10 "4 of 12" | Fixed | `grade-html.js:1067, 1130`; `style.css:2519` | |
| H11 tone | Fixed | `health-map.js:38`; `health-signals.js:454, 486` | |
| H12 phone tap | Fixed | `health-map.js:35, 307, 467`; `style.css:2625-2627` | The tap hint, "Back to the map" and the phone drawing all work. New: the particle canvas sits 12 px below the orb on phones (W2). |
| H13 "opening hours" | Fixed | `grade-checks.js:96` | |
| H14 no "AI will name you" | Fixed (nothing found) | | The new sentences promise nothing. |

## New items

**W1. Orbs swapped out while off screen keep their listeners and their detached DOM.** Low.
- Where: `public/js/health-orb.js:78-88, 100-101, 112-114`.
- Problem: a paused orb has no frame queued, so `draw` never runs its `isConnected` check. The IntersectionObserver also does not fire for a target that was already not intersecting when it was removed.
  - Measured: after 5 swaps with the section scrolled away, the net `visibilitychange` listeners went from 1 to 6. They stayed at 6 after scrolling back.
  - Each leftover keeps its old `<main>` tree alive until the next tab switch. A recheck can do up to 60 swaps.
- Fix:
  1. Keep a module-level `const running = new Set();`. In `start`, do `running.add(stop)`, and in `stop` do `running.delete(stop)`.
  2. In `init()`, first stop every orb whose host has left the page. Track the hosts: keep `const orbs = new Map()` (host to stop). At the top of `init`, run `for (const [h, s] of orbs) if (!h.isConnected) s();`, and in `stop`, run `orbs.delete(host)`.
  3. Add a test that the script calls `isConnected` inside `init`.

**W2. On phones the particle canvas sits 12 px below the orb.** Low (it shows in a phone video).
- Where: `style.css:2545, 2625`; `health-map.js:463-468`.
- Problem: `.health-orb-host` is placed by percent of `.health-map`. On phones `.health-map` also holds the `.health-tap` line, so 34.3% of a taller box is 12 px too low. Measured: host top minus orb top is 12 px at 320 to 600, and 0 on desktop.
- Fix: wrap the host and both SVGs in `<div class="health-art">` and keep `<p class="health-tap">` outside it, still inside `.health-map`. Add the CSS `.health-art { position: relative; }`.

**W3. The size test pins a width the map is never shown at, and some common widths fall below 12 px.** Low.
- Where: `health-map.js:318-319` (`minShownPx`); `style.css:2538-2540`.
- Problem:
  - The full drawing is 530 px wide at 1024 and up (not 540), and 494 px at 900, where words are 11.9 px.
  - The phone drawing is 323 px at 360 (status and orb name 11.1 px) and 283 px at 320 (9.7 px). 360 is the most common Android width.
- Fix:
  - Start the two-column layout at `(min-width: 960px)` instead of 900 for `.health-layout` and `.health-map`. From 601 to 959 the map is then single-column and 564 to 640 px wide, so 13.5 px or more.
  - Set `MAP_SIZES.full.minShownPx` to 530.
  - For phones, set `minShownPx: 323` and raise `statusFont` and `orbFont` to 26. Keep the "Not checked" fit assertion; if it fails, raise `rNode` to 90 and lower `rMain` to 255 so the top ring stays inside 150.

**W4. The two First Answer Pages listing rows inside health groups are still gray "Not checked", with nothing to check.** Low.
- Where: `health-map.js:92, 99` (the rows), with values from `health-signals.js:573-575` (`REASONS.noListing`).
- Problem: with no listing, "Your First Answer Pages listing matches your website: Not checked. No listing yet." sits in Details match, and the same row sits in Links. This is the H8 complaint ("we didn't fail to check, there's nothing to check") in two more places, and it is our own directory again.
- Fix: in `healthModel`, when `rows.get('listing.listed')?.needsClaim` is true, leave `listing.matchesWebsite` and `listing.linksToWebsite` out of Details match and Links. The Free listing group already says "Not yet. It's free, claim it below." Then update the sub-node count assertions.

**W5. A Founding Member row repeats itself.** Low.
- Where: `health-map.js:161`.
- Problem: when `info.founder` is set, the row reads "Founding Member: Founding Member". This is the H7 pattern.
- Fix: `return { ...base, label: 'Yes' };`, or "Yes, member No. N" when the signal carries `number`. Add a test.

**W6. The contest sample is built so that it shows the H2 contradiction.** Low (sample only, no code change).
- Where: `scratchpad/orb/render.mjs`, the `found: { ..., address: '' }` argument together with `address-shown: 'pass'`.
- Problem: a real check can't produce this, but the sample page shows "Street address on the home page: Good", then "couldn't read a full street address", then "Add your street address".
- Fix:
  - Pass `found.address: '12 Main St, Nashville, TN 37203'` and put that address in `PAGE`, so the sample reads "Address matches Google: Matches".
  - Or make `address-shown` fail in the sample.

**W7. The free listing's neutral "i" is not explained, and an old report shows it as "Not checked" in plain ink.** Low.
- Where: `health-map.js:32` (`MAP_INTRO`) and `:149, 203`.
- Problem: the intro names four colors. The listing has a fifth look (ink ring, "i") that nothing explains. On an old report "Free listing: Not checked" uses the info look, while every other "Not checked" is gray.
- Fix:
  - Add to the intro, within 160 characters per sentence: "The free listing is shown in white: it is information, not health."
  - For `old`, return `status: 'not_checked'` for the listing node and its rows, so they are gray like the others. In `mainStatus`, return `'info'` only when not old.

**W8. Stale design text.** Low.
- Where: `.kiro/specs/high-tech-look/design.md`:
  - `:371` (Free listing rule: "green when listed and Verified; amber otherwise")
  - `:376` (decision 2, the old HAVE reason)
  - `:377` (decision 3: Founding Member "a green sub-node", and the old note wording)
  - `:379` (decision 5, the old intro)
  - The V2 row at `:415` says 540 px.
- Fix: update those lines to the behavior as built: the listing is info with "Not started", "Listed", "Verified" or "Not sure"; the check's own reason with the H11 fallback; Founding Member is an info row; the new intro; 530 px.

**W9. "No website given" has no period in the health list.** Low.
- Where: `grade-checks.js:182`, now shown by `health-map.js:122`.
- Problem: on a check with no website, every HAVE row's reason is "No website given". The signal rows say "No website given." (`health-signals.js:34`), so the two sit side by side in the same list.
- Fix: in `checkSub`, normalize the reason to end with a period (`reason.replace(/([^.!?])$/, '$1.')`). Don't change `NO_WEBSITE`: the steps list and tests pin it.

**W10. With no score, the orb says "Not scored yet" and the top says "Not enough to score yet".** Low (H1's "one name per thing").
- Where: `health-map.js:388`; `grade-html.js:1026`.
- Fix: write "Not enough / to score yet" in the orb on two lines (`tspan`s at font 24). Or put nothing in the orb when there is no score, since the top already says it.
