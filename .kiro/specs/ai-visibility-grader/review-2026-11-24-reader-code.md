# Review notes: code review of the reader-notes changes (Nov 24, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
Range ba811d4..1c02f4b reviewed. Verdict GO, 1636/1636. No logic regressions; the about page's Google live answer line matches the code (not saved, not scored, only the browser that ran the check sees it); all 16 fixes are at most 160 characters; V219 and V217 are right. Do these together with the second human-reader notes as one task.

## V225-1 Two older tests got weaker
test/grade-o2-notes.test.js about 60 and 78, test/grade-o1-notes.test.js about 315: put "tomorrow" back. RUN_NEW = `Come back tomorrow and press <a href="/grade?from=${ID}">Run a new check</a> to get your full score.`; line 78 checks that 'Come back tomorrow' is absent; same at o1:315.

## V225-2 The "still being answered" note needs a done marker
grade-html.js about 774, grader.js about 1668. Write `extraAiDoneAt` in a finally block in runExtraQuestions; show the note only while extraAiStartedAt is set and extraAiDoneAt is not; keep a time limit of about 5 minutes only as a fallback for older reports; count only Claude's own extra answers. Tests: an early stop clears the note; the page refreshes while the note shows.

## V225-3 Empty filtered home pages are noindex
home.js about 96: when there are no results and a city or category is set, add noindex (meta tag or X-Robots-Tag). Cap the city shown at 60 characters. Test it.

## V225-4 Old rescued reports: one instruction only
grade-html.js about 909: aiMissing = isPartialScore(grade) and Claude's state is not 'not_connected' or 'off'. Test the old rescued Grade shows "Recheck my website only".

## V225-5 Capitalize the sentence start in demo mode ("The demo assistant didn't answer...") (grade-html.js about 701).

## V225-6 Two of three named
grade-html.js about 478: "In the first answer that named you, you were 1st of 3. In 1 answer, Claude didn't name you." ("In 2 answers" when two).

## V225-7 Small leftovers
Test V214 through GET /grade?from=; test V219 through the hours check itself; rename the V160 test titles in grade-o1-notes (about 246 and 251) to the new endings; ai-named failText in grade-checks.js about 130 to "didn't".
