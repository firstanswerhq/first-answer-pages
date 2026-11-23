# Review notes: final code review of the whole branch (Nov 23, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
A fresh reviewer read and ran the whole branch against main at commit ddba419. Verdict: GO, no blocker. Upgrade and rollback on live-shaped data both work with no migration; 1501 of 1501 tests three runs in a row; the home-page fetch refused 16 private-address tricks; hostile text came out escaped on every page; the daily AI cap held at exactly its number in every flood run.
What is below is cleanup. No behavior change.

## V146 Two spec lines carry old numbers
- `requirements.md`, Requirement 14.2 still says 20 checks a day per client; the code, README and design say 6. Fix the requirement line.
- `design.md` (about line 96) still says "each check can use 3 AI calls". Say what the README says now (up to 5 Claude calls with the default, plus second opinions).

## V147 Seven optional test tasks are unticked
`tasks.md` tasks 1.4, 2.2, 2.4, 5.4, 6.2, 7.5 and 9.5 are unchecked; four were checked on main. The tests exist for all but one: a property test for "Property 10: reuse never copies a visitor's state".
Add that property test (new file, fast-check, fake assistants only). Then tick the seven boxes, each only after you have found its test and named the file in your summary.

## V148 Leftovers
- `server/routes/sitemap.js`: `GRADE_PAGES_OPEN = true` sits under a comment that says the pages are still closed. Fix the comment.
- `server/lib/config.js` (about line 348) and `server/app.js` (about line 148): comments that say "from task E2" and "from task G4" should describe what the code does, not which task added it.
- `server/app.js` passes `store`, `clock` and `config` to `createGradeGuard`, which ignores them. Pass only what it uses.
- `isNamed`, `extractCompetitors` and `serviceAreaText` are used only by tests. Say for each whether it is part of a module's public surface that tests should keep, or dead; remove only the dead ones, with their tests moved to what replaced them. If unsure, leave it and say so.

## V149 README: one cost note
With `GEMINI_API_KEY` set and `GEMINI_NAME_CHECK` on, every stored AI answer makes one extra Gemini call that is not counted in `MAX_AI_CALLS_PER_DAY` or `GRADE_AI_CALLS_PER_DAY`. Say so in the README row for `GEMINI_NAME_CHECK`, in plain words, with no dollar figure.
