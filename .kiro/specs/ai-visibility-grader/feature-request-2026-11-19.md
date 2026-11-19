# Three owner decisions for the AI Visibility Check (approved by the owner, Nov 19, 2026, 4:07 AM)

Written by Claude (request notes only; Kiro writes the spec and the code).

Colby answered "yes" to each of these. Write the spec changes first: new numbered requirements in requirements.md, design sections in design.md, and tasks in tasks.md after Feature D's tasks (G1, G2, ...). Then stop so the spec can be reviewed. Build them after F1 to F13. Feature D is now approved too ("yes"), so F11 to F13 are to be built after F10, no longer spec-only.

Follow .kiro/steering/wording.md and grader-safety.md: plain words, American spelling, and never promise AI will name a business.

## Feature E: Ask Claude three times

Claude answers a little differently every time. One answer can swing the score by up to 30 points: Colby saw his client named 3rd one time and not named the next. To stop one answer from deciding the score, the free check asks Claude the same main question three times.

- The free check sends the main question (`freeQuestion`) to the main assistant 3 times, all at once, and runs the name match on each answer. The daily allowance counts all 3. Use the same reserve rules as today, so the 3 asks never push the second opinions or another owner's check over the limit. If the allowance can't cover 3, ask as many as it can cover (at least 1), and say how many in the detail line.
- Scoring uses the existing rule in `aiNamedResult`: `earned = round(30 × named ÷ ran)`, with the existing "named your business in X of Y answers" wording. The extra questions on unlock add to `ran` and `named` as they do today.
- The report:
  - says "Claude named your business in 2 of 3 answers" (or "in none of 3 answers");
  - shows the ranked list ("What AI says") from the first answer that named the business, or the first answer when none did, with a small line saying which one ("From answer 1 of 3");
  - lets the owner open each answer under "See Claude's answers".
  
  The V38 and V52 rules for the ranked list apply to that one answer.
- A Claude call that fails or times out counts as not run (it doesn't lower the score). When none of the 3 answers, the score is partial (V47).
- The setting `GRADE_MAIN_ASKS` (default 3, from 1 to 3) lets Colby set it back to 1 in Render without a code change. Add it to the README.
- Tests: 3 fake answers named, named, not named give 20 of 30 points and "2 of 3"; one fake answer that fails gives "named in 1 of 2" with no penalty for the failure; `GRADE_MAIN_ASKS=1` behaves exactly as today; and the allowance is charged 3 times.

## Feature F: The question reads naturally

The question is built from the service exactly as typed. Colby's client typed "Window cleaning and pressure cleaning", so Claude was asked: "Who are the best Window cleaning and pressure cleaning in Tallahassee, FL? Name your top 5." The capital letter and the grammar read oddly, and an odd question can get a weaker answer.

- Build all three questions (`freeQuestion`, `extraQuestions`) and the scan step text from a cleaned service phrase:
  - Lowercase the first letter unless the first word is all capitals or a brand with a capital inside (HVAC, iPhone).
  - Keep the owner's other words as they are, and trim spaces.
  - When the phrase doesn't already name people or businesses, add "businesses". Words that already name them include ones ending in "s" (plumbers, roofers, hair salons, restaurants), and words such as company, companies, contractor(s), shop(s), service(s), crew(s) and pros.
  
  Examples:

  | Typed | Phrase in the question |
  |---|---|
  | plumbers | plumbers |
  | Window cleaning and pressure cleaning | window cleaning and pressure cleaning businesses |
  | HVAC repair | HVAC repair businesses |
  | hair salons | hair salons |
  | Pressure washing companies | pressure washing companies |
  
- The free question becomes "Who are the best window cleaning and pressure cleaning businesses in Tallahassee, FL? Name your top 5."
- The service as typed is still stored and shown on the report as the owner wrote it. Only the questions use the cleaned phrase.
- Tests: the table above, plus a test that the stored input keeps the typed text. Existing tests that pin a question with an already clean service ("plumbers", "roofers") must not change. List any that do and why.

## Feature D: now approved

Colby said yes to Feature D (Google and Bing can find the main pages and the check's start page). Build F11 to F13 after F10.

## Feature G: Stop bots from running checks over and over (approved Nov 19, 4:15 AM)

Colby: "we need to make it where a bot can't just sit and run checks over and over". Each full check costs real money: about $0.28 to $1.05 in AI fees, more with Feature E. Grok stays on.

What protects the check today:
- a hidden honeypot field (`nickname`)
- a signed form timer (the form must be at least 3 seconds and at most 2 hours old)
- 5 checks an hour and 6 a day per address
- a 7-day reuse of answers for the same business
- the global daily AI allowance

The allowance caps the spending, but a bot that rotates addresses can still use up the whole day's allowance, so real owners see "AI check limit reached for today". Add:

1. **A human check on the form (Cloudflare Turnstile).** It is free and usually invisible, and it shows a box only when something looks automated.
   - When `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set, the check form includes the Turnstile widget. The server verifies the token with Cloudflare's siteverify endpoint (through the existing outbound rules, with a 5-second timeout) before any AI call or website fetch. A failed or missing token shows the form again with "Please try again: we couldn't confirm you're a person."
   - When the keys are not set, everything works exactly as today. Never log the token or the secret. Add both keys to the README and render.yaml (`sync: false`).
   - Update the Content Security Policy only as far as Turnstile needs (its script and frame from challenges.cloudflare.com), and add one plain sentence to the privacy page about the human check.
   - If Cloudflare can't be reached, let the check through and rely on the other limits below, rather than blocking real owners.
2. **A per-network limit.** At most 20 checks a day from the same network: the same first three parts of an IPv4 address, or the same first four groups of an IPv6 address. This sits on top of the per-address limits and uses the existing rate limiter and its "try again in" page. Make it a setting, `GRADE_NETWORK_PER_DAY`, default 20.
3. **A heads-up email to Colby.** Through the existing notifier, email `ADMIN_EMAIL` once a day when the Grader's AI allowance reaches 50% and again at 90%. The email gives the counts only: calls used, calls left and checks run. It never includes owners' details.
4. **The admin Grades page** shows today's AI calls used and left, and how many checks were turned away by the human check and by the limits today.

Tests:
- with keys set, a missing or bad token blocks the check before any AI call or fetch, and a good token (fake verifier) runs it
- without keys, everything behaves as today
- Cloudflare unreachable lets the check through
- the 21st check from one network in a day is turned away
- the 50% and 90% emails are sent once each per day
- nothing logs a token, a secret or an owner's details

Colby will create the free Cloudflare account and paste the two keys into Render himself. Build it so it is ready and off until then.
