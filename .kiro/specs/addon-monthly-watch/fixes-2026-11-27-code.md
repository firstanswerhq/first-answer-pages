# Monthly watch: code fixes from the independent review (2026-11-27)

No HIGH findings. Do these with tests for each. Do not run shell or git commands. Do not touch askQuestion, the second-opinion loop or run in grader.js.

1. (MEDIUM) The confirm email can be aimed at any address. In `watch-service.js` `start`: at most one pending or active watch per normalized email per Grade (a second start for the same email and Grade sends no new email and goes to the existing watch page); at most 2 confirm emails per address in 24 hours (count with a hashed-address counter, never store the plain address in a counter key or log); a stopped address gets no new confirm email for 24 hours. Tests for each.
2. (MEDIUM) Watch slots can be filled with no email. At most one watch per Grade: a second start redirects to the existing watch page ("you already have a watch"). Tests: second start on the same Grade, with and without an email.
3. (MEDIUM) The daily cap can be bypassed. Keep a watch-specific counter in the watch service (not refusable by the 50-note limit in ai-budget), count the confirming second ask too, and treat a `note` return of 0 as cap reached. Tests: 50 notes already present; a changed reading counts as 2; the cap stops runDue.
4. (LOW) Paused watches keep the email forever. On each tick, clear the email and delete watches that have been paused for more than 14 days. Test with a fake clock.
5. (LOW) In app.js give `ctx.watchReader` `nameChecker: null` so the reader makes no uncounted extra call. Test that readFree makes exactly one assistant call and no name-check call.
6. (LOW) Validate the address in `start` with the same regex the notifier uses (`EMAIL_RE`), so `a,b@x.com` is refused up front. Test.
7. Add the missing tests the reviewer listed: two overlapping `runDue` calls (the `watch-run` lock), and a start with the lead gate on and a valid unlock cookie.
8. README: one sentence that start limits depend on `TRUST_PROXY` being set correctly behind a proxy.
Skip finding 6 (not building the service when off) and 7 (stamp binding): acceptable as is.
