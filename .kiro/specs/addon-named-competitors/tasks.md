# Tasks: named competitors

Read `.kiro/steering/rebuild.md` first: the terminal on this laptop returns no output. Do not run shell commands. Write the code and the tests for one task, then stop and say which task is done. Tests are run in the cloud and the result comes back in chat. Do one task at a time. Do not touch the second opinions, the progress bar, `public/js/grade.js`, or `public/js/health-interact.js`. Do not edit `shareOfVoice`, `analyzeAnswer` or `listedNames`; only call them.

- [ ] 1. `server/lib/named-competitors.js`: `namedCompetitors(grade)` with counts, `missed`, `missedCount` and positions (no words yet). Tests in `test/grade-named-competitors.test.js`: counts equal `shareOfVoice`, owner excluded, at most 5 rows, order, positions from a numbered fixture.
- [ ] 2. The AI's words in the same module: line finder, cleaning (markdown, web address, email, phone), 160 code points at a word boundary, the 3-word minimum, main assistant first. Tests: each rule, plus a property that the result never contains a URL, an email or control characters.
- [ ] 3. `ownerChecksLine(grade)`. Tests: zero failed checks gives `''`, singular and plural, agency mode gives `''`.
- [ ] 4. `server/lib/named-competitors-html.js`: `competitorReasons(grade, { agency })`. Escape every value; no links. Tests: escaping of a hostile name and a hostile quote, the "own words, not checked" line once, the "no reason" row, empty when no rows.
- [ ] 5. Call it from `reportPage` after the `voiceSection` output (full report, print and prepared-by pages). Add CSS only if needed. Tests: shown in the full report, absent when locked, present on the print page, no owner sentence in agency mode.
- [ ] 6. Safety and unchanged-data tests: a grade is deep-equal before and after drawing; wording test (no promise words, no dollar signs); README sentence.
- [ ] 7. Final step: run the full suite in the cloud, compare with the known older failures, and list in chat every older test line you changed.
