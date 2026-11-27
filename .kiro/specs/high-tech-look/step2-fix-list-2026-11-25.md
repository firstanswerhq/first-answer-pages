# Step 2 fix list (Nov 25, 2026)

Tested in the cloud: 1803/1804 (the one failure is V8). Two reviews were NO-GO:
- review-2026-11-25-step2.md (code, accessibility, SEO: V1-V12)
- review-2026-11-25-step2-reader.md (judge-style reader: H1-H14)

Fix every item in both files, using their rewrites. Must-fix first:

1. V1 animation leak in public/js/health-orb.js: stop drawing when the host is no longer on the page; cancel the frame before asking for a new one on visibilitychange; remove both listeners in stop(). Add a test.
2. V2 + H4 the map must be readable: main node names and statuses about 12-13 px on desktop and phone (phone gets its own main-only SVG with a tighter view and two-line names; desktop gets a wider map column). Add a test that pins the sizes.
3. V4 + H3 sub-nodes: drop the words on sub-nodes, keep a larger symbol, and make every color and word on the map match the list exactly (same status word, same color for "Not found" everywhere). Record the 2.2 deviation in design.md.
4. H1 the center number: show the score in the score's own form ("Score 69/100" style, same number as the top), and rewrite the intro so it says what the colors mean instead of "These lights don't change your score."
5. H2 address rows must agree: "Address on the page", the Details match reason and the free-listing preview must not contradict each other.
6. V3 Founding note: "When we ran this check, Founding Member spots were still open. Listing is free; Founding Members pay once for the optional Verified stamp." The Free listing node and its rows get no health color (no amber "Partly", no "Verified stamp: Not checked"); they are information, not health.
7. V8 test/health-map.test.js:61 compare against the escaped sentence (or decode first).

Then the low and polish items: V5-V7, V9-V12, H6-H13 (plain explanations for robots.txt, sitemap, llms.txt, business label, summary, share picture, Bing; no rows that repeat themselves; one word per idea; "N of 12 checks" wording that matches what a reader can count; speak to the owner; phone hint that bubbles can be tapped, tap stays near the map, map fills its box; "business hours" not "opening hours").

Do NOT add the one-time "scan" animation in this round; it is now Requirement 2.10 and comes next, with Requirement 11.

Rules: keep the score and public SEO unchanged; every sentence 160 characters or less, American spelling, nothing promising AI will name a business; no report content added only by JavaScript; reduced motion = no animation. Add tests and record changes in the design table. Do not run any shell commands, including "exit". Stop when done and list the changed files.
