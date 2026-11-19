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
