# Review round 14: launch-day load (Nov 18, 2026)

Written by Claude (review notes only; Kiro writes all code).

Colby asked: "What happens if 20 owners are on the site at the same time running checks? Will it break it or bog it down?" A helper load-tested the live code and the rebuild in the cloud. It used fake AI answers (20 to 40 seconds each, Claude plus 4 second opinions) and fake websites (1 to 3 seconds each), and touched nothing live.

The good news: 20 checks at once and 50 at once both finished with no errors in about 40 seconds. The server used 140 to 375 MB, normal pages answered in under 5 ms, and the data files were always valid, with nothing lost. One AI answer that never came held up only its own owner.

These five gaps would hurt on launch day. Add V45 to V49 to tasks.md under "Review fixes" in a new section "O. Round 14 (`review-2026-11-18-round14.md`)". Fix them with example tests using fake providers and a fake clock (no real AI, no real network), additions only. No shell commands.

## V45. Rate limits: retry once and don't charge

When 20 owners start at once, 20 Claude searches go out in the same second, and Anthropic answers some of them with HTTP 429 (rate limited) or 529 (overloaded). Today the call fails at once: the report says "Claude did not answer this time", and the failed call is still charged to the daily AI allowance.
- On a 429 or 529 from any provider, wait the time the provider asks for (its `retry-after` value, at most 20 seconds, 5 seconds when none is given) and try once more.
- A call that ends in 429 or 529 is not charged to the daily allowance. Other failures are charged as today.
- Never log the answer text or the typed input.
- Tests: a fake provider that answers 429 with retry-after 2, then succeeds, gives a normal answer and one charge. One that answers 429 twice gives "did not answer" and no charge. A 500 error is charged as today.

## V46. Second opinions never hold up the report

The scan waits for all five AI calls, including the unscored second opinions, so one slow second opinion can hold a report for up to 120 seconds.
- The scan finishes when the website step and Claude's answer are done. Each second opinion gets at most 45 seconds and shows on the report when it arrives (the status page already refreshes), or "didn't answer in time" after 45 seconds.
- Claude's own answer keeps its current time limit.
- Tests with a fake clock: a second opinion that takes 100 seconds doesn't delay the finished report, and it shows "didn't answer in time".

## V47. A check without Claude's answer is marked partial

When Claude doesn't answer, the AI part is left out and the score is worked out from the other points, so it reads higher than a check where Claude answered but didn't name the business (40 versus 26 in the test). An owner could think they did better.
- When `ai-named` is not checked, show the score as partial: under the big number, say "Partial score: Claude didn't answer this time, so the AI part isn't counted. Check again later for your full score."
- Keep the number as it is (the website points it could check). The admin list shows "partial" next to it.
- Never show a partial score as better than a full one in "Your score was X before" lines. Show no "before" line when either score is partial.
- Tests: a Grade with `ai-named` not checked shows the partial line and no "before" line. A normal Grade shows neither.

## V48. Run at most 10 checks at once

There is no limit on checks running at the same time.
- Run at most 10 at once and put the rest in a first-in, first-out line. A waiting owner sees the normal scan page with the step "You're in line. Your check starts in a moment.", which works without JavaScript, like the other steps.
- Make the number a setting, `GRADE_MAX_RUNNING`, default 10, read like the other whole-number settings in config.js.
- A check in line counts toward the per-address limits as today, and a server restart clears the line the same way it clears running checks today.
- Tests: with the limit set to 2 and 5 checks started, 2 run, 3 wait and show the line step, and all 5 finish in order.

## V49. Send the lead email in the background

In the rebuild, the lead form waits for the lead email before answering: 0.6 to 0.8 seconds, against 0.2 to 0.3 live, and 19.6 seconds when many reports are stored.
- Answer the owner at once and send the email in the background, as the live code does, inside try/catch with the existing timeout. Never log the lead's details.
- Tests: with a fake notifier that takes 5 seconds, the form answers right away, and the email is still sent once.

## Not in this round (for Colby to decide)

- **The daily AI allowance.** Unless Render sets them, the defaults are 200 AI calls a day in total, 60 of them for the check. A full check uses about 15 calls, so 60 covers about 4 full checks a day. Raising it is a Render setting (`GRADE_AI_CALLS_PER_DAY`, `MAX_AI_CALLS_PER_DAY`) and a spending decision, so it is Colby's call. No code change is needed.
- **Many stored reports.** The whole reports file is read and rewritten on every step. With 1,000 stored reports, 20 checks took 70 to 77 seconds, the Check button took up to 20 seconds, and memory reached 1.4 to 1.9 GB. Reports are kept 90 days. It is fine at contest scale, but needs a storage change (one file per report, or SQLite) before real traffic. That's a bigger change for later.
