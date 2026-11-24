# Review of the V225 + V240-V251 batch (Nov 24, 2026)

Verdict: GO. 1660 of 1660 tests pass. Every must-fix is done (extraAiDoneAt in a finally, the V251 link under both recheck buttons, "tomorrow" restored, noindex only on empty filtered home pages with the city cut at 60, V241 hours, V205b at 143 characters). These are small follow-ups. Apply them together with the next task.

V252. server/lib/grade-html.js:245. "We asked Claude 3 questions. Only that answer counts toward your score." Here "that answer" points back to nothing. When questionsAsked > 1, use "Only its answer to the first question counts toward your score." Keep "Only that answer counts toward your score." when only one question was asked. Update the quoted sentence in test/grade-lead.test.js:540, test/grade-o1-notes.test.js:253, test/grade-reader-notes.test.js:147 and test/grade-report-asks.test.js:167, and record those lines in the design table.

V253. server/lib/grade-html.js:227-228 and 256/259. In demo mode the label sits mid-sentence with a capital letter ("We asked The demo assistant 3 questions", "On the other question, The demo assistant didn't name you."). Use h(midSentence(mainLabel)) in the asked line and in the otherLine line. Keep h(mainLabel) where the label starts a sentence. Add a demo-mode test.

V254. test/grade-lead.test.js:596-597. Two full sentences were swapped for two fragments, so the test got weaker. Check the whole V240 paragraph instead, the way line 540 does.

V255. test/grade-reader-notes2.test.js:308. The title says a page with results is not noindex, but nothing checks it. Add a fetch of a search the test data answers (for example /?category=plumbers&city=Nashville). Assert that x-robots-tag is null and that the body has no name="robots" tag.

V256 (low). server/routes/home.js:150-163. On an empty search, the title and meta description still show the whole typed city. Build one shownCity, cut to 60 characters, and use it for titleCity and where as well.

V257 (low). server/lib/grade-html.js:964. The no-website report says "To ask AI again, run a new check." V251 asked for the askAgain text, "To ask AI again after your changes, run a new check.", on every report. Use askAgain there too.
