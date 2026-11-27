# Round 14 recheck: one small fix (Nov 19, 2026, 4:30 AM)

Written by Claude (review notes only; Kiro writes all code).

The code reviewer rechecked round 14 at commit 0c6d51a. Fixed:
- **4a:** a check waiting in line is never stale, and a restart still marks old checks as failed.
- **4c:** second opinions that ran out of time in the 30%-429 run went from 37 to 2.
- **4d:** the default is 20.

The load test against the committed code:
- 20 checks at once finish in 40 seconds, 50 at once in 95 seconds, and the 30%-429 run in 59 seconds.
- No run had errors or lost Grades, and memory stayed at 222 MB at most.

The 4b note ("Still waiting on N other assistants") shows and stays escaped. Its refresh also works with JavaScript off, which is fine. One gap is left.

## V53. The "still waiting" note can stop too early

`trackSecond` (grader.js, around lines 818 to 827) keeps a set of provider names. During the extra questions, the same provider answers two questions at once. When its first answer arrives, its name is taken off the list while its second answer is still coming, so the note and the refresh stop. The last answer then only shows after a manual reload. The reviewer saw the list empty at 700 ms while the third ChatGPT answer arrived at 1,400 ms.

- Track each pending answer separately: count per provider, or key by question and provider. The list shows a provider until all of its pending answers have arrived or timed out.
- The note's number counts assistants (ChatGPT, Gemini…), not calls, so it still reads "Still waiting on 2 other assistants".
- Test (additions only, fake providers, short timers): during the extra questions, ChatGPT takes 600 ms on question 1 and 1,200 ms on question 2. At 700 ms `secondPending` still lists chatgpt and the note is shown. After 1,200 ms it's empty, and both answers are on the report.

Add V53 to tasks.md under "Review fixes" (in section O with round 14). No shell commands.
