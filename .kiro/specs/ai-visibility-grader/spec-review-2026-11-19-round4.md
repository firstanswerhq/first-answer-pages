# Spec review round 4: last small edits to Features G and E (Nov 19, 2026)

Written by Claude (review notes only; Kiro writes the spec and the code). The code reviewer rechecked the revised spec against the code at d6eada1.

Every item from round 3 (S18 to S38) is handled, and nothing in the revised spec breaks an existing test. Confirmed against the code:
- Peeking the network rule first gives the right message and still counts nothing when it refuses (`peek` records nothing).
- The reserve numbers are right for 13, 14 and 15 calls left.
- The existing reuse tests use the same wording on both Grades, so they still carry over.
- The existing live-answer tests still pass with the cap.

Five small things remain. S39 and S40 must be fixed before G1. Fix all five in requirements.md, design.md and tasks.md only, then stop. No code, no shell commands.

## S39. The "human check may be set up wrong" email never fires in a lockout (G3, G4)
`watch()` runs only after a counted AI call or a new Grade. When the human check turns everyone away, neither happens, so the email never goes out. Also run that rule from `turnedAway('human')`.

Test: 10 refusals by the human check and no passes send the email once, with no AI call and no Grade started.

## S40. The live-answer cap needs three details (the live-answer task)
1. **When it counts.** Check and raise `liveAnswers` inside one `grades().update`, and only after the budget's `consume` succeeds.
   - Two requests at once must not both see 2 and make 4.
   - A request the budget refuses must not use up one of the owner's 3.
   - A call that then fails at Google still counts, because it was paid for.
2. **The message.** "Not today" says "try again tomorrow", which never helps with a cap for the life of the report. Use: "You've seen Google's live answer 3 times for this report. Run a new check to see it again."
3. **The button.** Hide "Show Google's live answer" once 3 have been used.

Test: two requests at the same moment, with the count at 2, give one 200 and one 429.

## S41. A refused resend on asks 2 and up must not lower the score (Req 23.11, design "Asking", E2)
When a resend is refused, the paused reply's text is usually a preamble like "I'll search…". `anthropicAnswer` (assistant.js 312-321) returns that text as the answer, so it would be scored "not named" and lower the score, which breaks 23.4.
- For asks 2 and up, a refused resend makes that ask count as not run.
- The `consumeExtra` wrapper sets a flag when it refuses, and the grader drops that ask's result.

Test with a fake that needs a resend while 12 or fewer calls are left.

## S42. With 0 calls left the check is not refused (Req 23.2, E2 and its tests)
With 0 calls left the check still runs. Only the AI part is skipped ("AI check limit reached for today", partial score). Fix the wording and write the test that way.

## S43. Small text fixes
- **G2:** the first bullet still lists the `verify` results as ok, failed and unreachable. Add `misconfigured`.
- **Admin line:** an `internal-error` can be an outage at Cloudflare, not a wrong key. Use: "Human check: on, but Cloudflare reported a problem (wrong secret key or an error on its side); checks are let through."
- **Free report wording:** with only the free question, "Claude was asked the first one 3 times" reads oddly. Use "Claude was asked it 3 times." Keep "the first one" once there are more questions.
- **Feature D leftover:** design.md line 26 (the overview table) still says Feature D is "not built until the owner confirms". It's approved.
