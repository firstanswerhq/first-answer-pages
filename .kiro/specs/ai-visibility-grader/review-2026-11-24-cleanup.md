# Review notes: cleanup V146-V149 and V201-V202 review (Nov 24, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
Commit 94e1bac reviewed. Verdict GO, 1619/1619. Only comments changed in app.js, config.js, rate-limiter.js and sitemap.js (plus the unused guard arguments); no env names, defaults, limits or sitemap URLs changed. The V201 test fails on the old code; the Property 10 test fails when the reuse code is broken on purpose. Do these as one small task after the reader-notes task.

## V221 Note wording
The V201 note's stated order would still pick the empty Plumber; the code follows the note's title (local with a name or phone, else the Organization-rule node, else the bare local node), which is right. Add one line to tasks.md saying so.

## V222 (owner decision: accept) A nameless local node beside an organization
When a Plumber node has hours or areaServed but no name or phone, and a Corporation has phone and address, the Corporation is read now. Accept this; add one test pinning it.

## V223 Unlock is never copied
test/grade-reuse-property.test.js about 140-147: send the first Grade's unlock cookie with GET /grade/<secondId> and check the lead form still shows.

## V224 Close the two test gaps
Write the two tests that let tasks 5.4 and 6.2 be ticked: (a) fill the photo and grade share, then show a seance call is still allowed; (b) make the main AI call time out (a call that never resolves, with the time limit shortened) and check ai-named is not_checked and the Grade is still done. Tick 5.4 and 6.2.

## Aside: server/routes/grade.js about line 14 still says every /grade response is noindex; /grade and /grade/about are open pages now. Fix the comment.
