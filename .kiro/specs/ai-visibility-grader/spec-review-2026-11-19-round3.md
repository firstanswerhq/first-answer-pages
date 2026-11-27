# Spec review round 3: Features G, E and F (Nov 19, 2026)

Written by Claude (review notes only; Kiro writes the spec and the code). Two passes against the code at d6eada1: Claude's, and the code reviewer's, which included two scratch runs.

The spec is close. These parts are right: Feature D's new status, the task names (G, E, W), the build order, and the Content Security Policy note (`app.js` sends only `frame-ancestors 'none'`; `LIVE_CSP` is only on the live-answer page). Fix the items below in requirements.md, design.md and tasks.md only. Then stop so the spec can be checked again. No code, no shell commands.

## Must fix before building

### S18. Google's live answer can use up the day's AI calls (Feature G)
`POST /grade/:id/google-live` (routes/grade.js 248-266) is gated only by the `ran` cookie, which lasts 90 days, and by 3 an hour per Grade and 6 an hour per address. One Grade can make 72 calls a day, more than the 48 usable calls of the default 60, so it pushes every owner down to the 12-call reserve. Every Grade a bot made on earlier days adds 3 more an hour. These calls also skip `watch()`.
- Allow at most 3 live answers per Grade **in total**. Count them on the stored Grade, so a restart doesn't reset the count. This is on top of today's hourly rules, which stay as they are. Say in Requirement 25.10 that this is the second addition, alongside the per-network limit.
- Call `watch()` after the live answer's `consume`.
- Test: the 4th live answer on the same Grade is refused, even hours later and after a new app on the same data folder.

### S19. Carried-over answers to a differently worded question are counted twice (Features E and F)
`reusableAnswers` (grader.js 1106-1122) copies every answer from the earlier Grade, and `aiNamedResult` (grader.js 532-543) counts every main answer, whatever its question. The reviewer ran it: an earlier answer to "…HVAC Repair…" plus a new ask of "…HVAC repair…" gave "named in 1 of 2 answers", and Claude was asked again. Feature F rewords every service that isn't already clean, so for 7 days after the switch those checks would score 1 old answer plus 3 new ones. The design's "one-time cost and not a bug" line is wrong.
- Copy only answers whose prompt is the new Grade's free question or one of its two extra questions.
- Test: an earlier Grade with the old wording gives no carried answers, and the score counts only the new asks.

### S20. Asks 2 and 3 can spend past the 12-call reserve (Feature E)
`consumeExtra` (grader.js 749) charges a second paid call when Claude's reply needs a resend (pause_turn), with no reserve check.
- For asks 2 and up, a resend is made only while more than 12 of the Grader's calls remain. Otherwise that ask ends with what it has, or as not run.
- Ask 1 keeps today's rule.
- Test with a fake that needs a resend.

### S21. The report must not find the free answers by comparing to `freeQuestion(input)` (Features E and F)
Today grade-html.js 316-317 falls back to the first main answer when the prompts differ. After Feature F, older Grades won't match the new wording. Neither will test/grade-report-list.test.js line 160 (its prompt has no "businesses"; the service is at line 136). A strict match would show "We couldn't ask AI" and break the V52 tests.
- The free answers are the main answers whose prompt equals the **first main answer's** prompt.

### S22. The reserve numbers in the tests are wrong (Feature E)
Ask 1 takes one call. Asks 2 and 3 each need **more than 12** calls left before they're made.
- 13 calls left: 1 ask.
- 14 left: 2 asks.
- 15 or more: 3 asks.
- 0 left: refused, as today.

With 15 or fewer calls left, the second opinions are skipped, because the asks come first. Say that in the design. Fix the line "with 13 calls left … 2 of 3", and pin each of these numbers in a test.

### S23. The service phrase needs a few more rules (Feature F)
As written:
- "roofing company" gives "Who are the best roofing company in…".
- "cleaning business" stays singular, because it ends in "s".
- "dentist" gives "dentist businesses".
- "auto glass" gives "the best auto glass in…".

Use a **fixed list**, not general English plural rules:
- The last word "business" becomes "businesses".
- A last word ending in "ss" (glass, fitness) is not a plural, so "businesses" is added.
- Any other last word ending in "s" is kept as is.
- A short list of singular words is made plural:
  - company → companies, agency → agencies, bakery → bakeries
  - handyman → handymen, attorney → attorneys
  - contractor, shop, service, crew, store, salon, studio, clinic, restaurant, cafe, firm, lawyer, doctor, plumber, roofer, painter, cleaner, landscaper, mechanic, barber, photographer, realtor, agent, groomer, inspector: add "s"
  - words ending in "ist" or "ian" (dentist, florist, therapist, electrician, technician): add "s"

  Don't add a general "-er" or "-or" rule ("water heater", "garage door", "computer" would turn into products).
- Anything else gets " businesses".

### S24. Extra question 1 reads wrong with "businesses" (Feature F)
"I need window cleaning and pressure cleaning businesses in Tallahassee, FL. Which companies would you recommend?" You need the service, not businesses. `servicePhrase` returns two forms:
- the plain phrase (cleaned, plural-fixed, no "businesses" added), used in "I need … in";
- the phrase with "businesses" added when needed, used in the free question, the second extra question and the scan step.

| Typed | Free question, 2nd extra question, scan step | "I need … in" |
|---|---|---|
| plumbers | plumbers | plumbers |
| Window cleaning and pressure cleaning | window cleaning and pressure cleaning businesses | window cleaning and pressure cleaning |
| HVAC repair | HVAC repair businesses | HVAC repair |
| hair salons | hair salons | hair salons |
| Pressure washing companies | pressure washing companies | pressure washing companies |
| roofing company | roofing companies | roofing companies |
| cleaning business | cleaning businesses | cleaning businesses |
| dentist | dentists | dentists |
| auto glass | auto glass businesses | auto glass |
| bakery | bakeries | bakeries |
| handyman | handymen | handymen |
| iPhone repair | iPhone repair businesses | iPhone repair |
| A/C repair | A/C repair businesses | A/C repair |
| Mexican restaurants | Mexican restaurants | Mexican restaurants |
| Pressure Washing Companies | pressure washing companies | pressure washing companies |

The last two rows are explained in S34. Already-clean services ("plumbers", "roofers", "accountants") must give exactly today's questions.

### S25. A mistyped Turnstile secret would lock every owner out (Feature G)
When Cloudflare answers `success: false` with the error code `invalid-input-secret`, `missing-input-secret` or `internal-error`, the design maps it to `failed`, so every owner is blocked.
- Treat those three like `unreachable`: let the check through, log `turnstile=misconfigured` or `turnstile=unreachable`, and never log the secret.
- Show it on the admin page (S35).
- Test each code.

## Also fix in the same pass

### S26. Scan-step wording (Feature E)
Requirement 23.2 says "Asked Claude 2 times (today's AI limit kept the rest)", while the design and tasks say "Claude answered 2 of 3 times". "Answered" mixes up asked and answered. Use one form everywhere, keeping the two numbers apart: "Asked Claude 3 times; 2 answered." When the allowance cut it short: "Asked Claude 2 times (today's AI limit was reached); 2 answered." With one ask, the text is as today.

### S27. The answers section counts answers as questions (Feature E)
In `answersSection` (grade-html.js 493-501), `q = main.length`. With 3 asks, the free report would say "We asked Claude, ChatGPT and Grok the same 3 questions", when it was 1 question. After unlocking it would say 5, when it was 3. Line 493 repeats the count too.
- Count distinct questions.
- When the free question was asked more than once, say so: "We asked Claude, ChatGPT and Grok the same 3 questions. Claude was asked the first one 3 times."
- Update Requirement 7.14's example and Requirement 7.5 ("We asked Claude once") to match.
- Test.

### S28. The about page (Feature E, Requirement 16.1)
grade-html.js 750 says "We ask Claude up to three questions…". It must say the first question is asked up to 3 times, for example: "We ask Claude up to three questions about the best businesses of that kind in that city, and the first one up to 3 times, because AI answers change from one time to the next." This page is about to be open to search engines (Feature D), so it has to be right. Test the sentence.

### S29. Turnstile failures the owner can't see (Feature G)
These all mean the visitor's form arrives with no token, so the visitor sees "we couldn't confirm you're a person":
- a wrong site key;
- the site's address missing from the widget's hostname list (Cloudflare error 110200);
- the script blocked by an ad blocker or a network.

Every `/grade` response also sends `Referrer-Policy: no-referrer` (routes/grade.js 57-61), and Cloudflare's docs don't say whether the widget needs a referrer.

Fixes:
- Add to the 422 text: "If no box appears, turn off ad blockers or try another browser."
- Count passes too (`note('humanPass')`), and show today's passes and refusals on the admin page.
- Send one email a day to `ADMIN_EMAIL` when the human check has refused 10 or more checks today and passed none ("The human check may be set up wrong"). Counts only. Never switch the check off by itself, because a bot could make that happen.
- Add to G6 an owner step: right after Colby pastes the two keys into Render, Colby and Claude run one real check in a normal browser on the live site. If it fails, deleting either key in Render turns the check off and the site works as before. That same check confirms whether the referrer policy matters.

### S30. "Start again" on the failed page always bounces (Feature G)
`failedPage` (grade-html.js 156-168) posts to `/grade` without the widget. With the check on, every "Start again" would get the "couldn't confirm" message.
- Add the widget, its script and the `<noscript>` line to that form when the check is on.
- Test.

### S31. The heads-up emails (Feature G)
- What's actually left is also limited by the shared caps (ai-budget.js 130-134), so used + left can be less than `GRADE_AI_CALLS_PER_DAY`, and the 90% email might never come while checks are already being refused. Work the thresholds out as used ÷ (used + left), and send nothing when used + left is 0.
- With `NOTIFIER` unset, no email goes out at all (config.js 213-216). The admin page says "Heads-up emails: off (no email service set)".
- Don't read grades.json after every AI call to count today's checks. Keep a `checks` day counter in the budget's notes, which goes up when a Grade starts.

### S32. A bad `notes` entry must not reset today's spending (Feature G)
`loadCounts` drops the whole ai-budget.json when it fails validation (ai-budget.js 58-72), which would reset today's counts.
- A missing or malformed `notes` is ignored, and the counts are kept.
- Test it with a file whose `notes` is a string.

### S33. The network limit on shared networks (Feature G)
Mobile carriers put many unrelated people behind one IPv4 /24, so strangers can reach 20 a day together. The refusal also reuses "a lot of checks from your address" (routes/grade.js 45-48), which is wrong for a network.
- Give the network refusal its own plain message, for example: "A lot of checks have come from your network today. Please try again tomorrow, or from another connection."
- Count network refusals apart from address refusals on the admin page.
- Add a README line: if the site is ever put behind Cloudflare's proxy, `TRUST_PROXY` must be 2, or every visitor shares a few Cloudflare addresses.

### S34. Capital letters in the phrase (Feature F)
- "Mexican restaurants" must not become "mexican restaurants". Keep the capital for a short list of nationality and cuisine words (Mexican, Italian, Chinese, Thai, Japanese, Indian, Greek, French, Korean, Vietnamese, Cuban, Cajun, Caribbean, Mediterranean, American, Spanish, German, Irish).
- When every word is capitalized ("Pressure Washing Companies"), make every word lowercase, except all-caps words, words with a capital inside, and the words on that list.

### S35. The admin page shows how the protection is set up (Feature G)
Above today's counts, add:
- "Human check: on", "off (no Turnstile keys)" or "on, but Cloudflare says the secret key is wrong (checks are let through)";
- "Heads-up emails: on" or "off";
- today's human-check passes and refusals, address refusals and network refusals, on separate lines.

### S36. Existing test files that change (Feature E)
E1 adds `gradeMainAsks: 1` to `startEnv` in test/grade-flow.test.js, test/grade-lead.test.js, test/grade-review-fixes.test.js and test/grade-load.test.js. The reviewer confirmed by searching that these are the only files that start a Grade. List each file and the one added property in the design's "Numbers that change in existing tests (and why)" table, the table the rules point to. Nothing else in those files changes. The cloud will also rerun the load test with 3 asks after E2.

### S37. The partial-score rule needs a number (Feature E)
Requirement 23.4 cites "Requirement 19.8" for the partial score, but 19.8 is about working scores out from stored results. The V47 partial rule isn't a numbered requirement anywhere. Add it as a criterion (for example in Requirement 8) and cite that number.

### S38. Smaller items (Feature E)
- The demo assistant gives the same answer for the same prompt, so ask it once (3 identical answers say nothing).
- When answers carried over from an earlier Grade were asked 3 times, introduce them the same way, for example "We asked Claude 3 times on Nov 19."
- When an ask failed, number "From answer 1 of 2" among the answers that came back, not by ask number.

## For the owner (not a spec change)
With Feature E:
- The free part of a check uses 7 AI calls (3 Claude asks and 4 second opinions).
- A full check after unlocking uses about 17, plus resends.
- At today's setting of 60 a day, that is about 3 full checks before later checks drop to 1 ask with no second opinions.

Colby already decided to raise `GRADE_AI_CALLS_PER_DAY` on Dec 3. A reminder is set, with numbers that already include Feature E.
