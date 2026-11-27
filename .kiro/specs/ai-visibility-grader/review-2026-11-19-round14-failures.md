# Round 14 cloud run: 3 failures to fix (Nov 19, 2026, 12:45 AM)

Written by Claude (review notes only; Kiro writes all code).

Your round 14 work (V45 to V49) was copied to the cloud and the full suite was run twice: 1118 of 1121 pass, with the same 3 failures both times. Nothing was committed; the branch stays at the last passing commit.

## 1. README is missing the new setting

```
not ok - every environment variable read under server/ appears in the README   (test/app.test.js, line 213)
  README does not mention GRADE_MAX_RUNNING (read in server/lib/config.js).
```
Add `GRADE_MAX_RUNNING` to README.md next to `GRADE_AI_CALLS_PER_DAY`: what it does, default 10, a positive whole number.

## 2 and 3. Both V47 recheck tests time out

```
not ok - V47: a Grade with no AI answer shows the partial line, the admin list says partial, and a Recheck shows no "before" line   (test/grade-load.test.js, line 290)
  error: 'timed out waiting for the recheck'
not ok - V47: a normal Grade shows no partial line and keeps its "before" line after a Recheck   (test/grade-load.test.js, line 317)
  error: 'timed out waiting for the recheck'
```
Cause: `startEnv` in test/grade-load.test.js sets `graderLeadGate: true`, and `POST /grade/:id/recheck` in server/routes/grade.js only starts a recheck when the full report is open: `!leadGate() || hasCookie('unlock', grade.id, req)`. These two tests post the recheck without the unlock cookie, so the route redirects without starting it, and `recheckedAt` never gets set. The code is right; the tests skip a step.

Fix the tests (they are new in this round, so changing them is fine): unlock the report first, the way the V49 test does with `post(env, '/grade/${id}/unlock', LEAD)` and its cookie, or start those two tests with `config: { graderLeadGate: false }`. Then check the asserts still test what V47 asks for.

When all three pass, stop. The cloud reruns the full suite and a reviewer checks round 14 against `review-2026-11-18-round14.md`.

## 4. Reviewer findings on round 14 (fix these in the same pass)

The code reviewer checked your round 14 code and reran the load tests against it. Most of it works as asked:
- The 429/529 retry stays inside the same deadline, refunds never go below zero, and nothing is logged.
- Late second-opinion saves can't lose or double an answer.
- The partial score, the admin "(partial)" mark and the hidden "before" line all work.
- The line is first in, first out, and extra questions and rechecks skip it.
- The lead email goes out in the background (the form p95 dropped from about 600 ms to 330 ms).
- With 30% of calls rate-limited, "Claude did not answer" went from 6 reports in 20 to 0.

Three items to fix:

**4a. A check waiting in line goes stale (must fix).** `isStale` (grader.js, around line 603) counts 4 minutes from `createdAt`, so time spent in line uses up the check's own time. With a fake clock, a limit of 1 and a slow first check, the second Grade, still in line after 5 minutes, reads as stale. Its report page and status.json say "didn't finish", and then it runs and finishes `done`. On launch day this happens once about 20 owners wait behind slow Claude calls, and they click "Start again", which adds duplicate checks.
- Store `startedAt` when `run()` starts a check (around line 940). `isStale` uses `startedAt ?? createdAt` and is never true for an id that is in this process's waiting line. After a restart the line is empty, so old Grades still go stale from `createdAt`, as today.
- Test: limit 1, first check held, clock moved on 5 minutes. The second Grade shows the line step and status.json says `done: false`. A fresh grader (a restart) shows a never-started Grade as failed.

**4b. Late second opinions never appear on an open report (V46).** The scan page stops refreshing once the check is done, and the report page doesn't refresh, so a second opinion saved after the report opened only shows after a manual reload. In the 20-at-once run, reports opened with 1 or 2 second opinions and showed 4 only on reload.
- Keep a `secondPending` list on the Grade, cleared in `saveLateSecond` (around line 809). While it isn't empty, the report shows "Still waiting on N other assistants. This page updates by itself." and refreshes the same way it does while a recheck runs (`data-grade-rechecking`, grade-html.js around line 549). It still works with JavaScript turned off: the plain note, with no refresh.
- Test: a second opinion that takes 30 seconds shows the note first, then its answer.

**4c. A second opinion's 429 retry pause can use up its whole 45 seconds.** In the 30%-429 run, 37 second opinions ran out of time. For second opinions, cap the retry pause at 5 seconds, and skip the retry when it can't fit in the time left (around line 752). Claude's own retry keeps the 20-second cap.
- Test: a second opinion that gets a 429 with retry-after 30 retries after at most 5 seconds, or not at all when less than 5 seconds are left.

**4d. Change the default `GRADE_MAX_RUNNING` from 10 to 20.** With the line at 10, the load test took 68 seconds for 20 owners (40 before) and 172 seconds for 50 (40 before). 20 at once used about 140 MB with no errors, and the 429 retry now handles Claude's per-minute limit, so 20 is a better default. Update config.js, the README line and any test that pins 10 (the V48 test sets its own limit of 2, so it shouldn't change).

When items 1 to 4 all pass, stop.
