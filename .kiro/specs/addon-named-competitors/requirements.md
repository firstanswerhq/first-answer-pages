# Named competitors (add-on 3, from the Nov 26, 2026 competitor research, rank 3)

Owner: Colby. After a weak result the owner's first question is "who did AI name instead of me, and why?" The report already lists names and counts ("Who AI named"). This add-on adds, for each business AI named, a plain reason it may have been picked, using only what the stored answers say.
Rules that still apply: `.kiro/steering/wording.md`, `grader-safety.md`, `rebuild.md`. Plain words. American spelling. No dollar figures. Never promise or imply that anything makes an AI assistant name a business. Say "days to weeks". Do not use the word "guarantee".
Do not touch the ChatGPT, Gemini, Grok and Perplexity second opinions. Do not touch the progress bar, polling or reload code, or `public/js/grade.js`. `public/js/health-interact.js` stays under 16,000 bytes.

## Why
HubSpot's grader and Local Falcon show share of voice. Ours shows the same counts but never says why a name came up. We have no data about a competitor's website or profiles (we only check the owner's), so the only honest reasons are in the answers themselves: how often and how high they were named, and what the AI wrote about them.

## Requirements
1. In the full report, the existing "Who AI named" section gets, under its table, a list "Why AI may have picked them". It lists up to 5 businesses that AI named and the owner is not (the most-named first, ties by first position). Not shown when no answer named another business.
2. Each business shows only these facts, each from stored answers: how many answers named it ("3 of 4 answers"); its place in the list in the answers that numbered it ("First in 2 answers", "Second or third in 1"), only when positions exist; whether it was named in answers that did not name the owner ("Named in 2 of the 3 answers that did not name you"); and, when an answer's own line about it can be found, that line in quotes, marked as the AI's words.
3. The AI's words: the text after the business's name on the line where the answer lists it, with list marks, bold marks and any web address, email or phone number removed, at most 160 code points, cut at a word boundary. Shown as: `Claude wrote: "..."` with the assistant's label from `providerLabel`. At most one quote per business (the main assistant's first answer that has one). When no line is found, the row says "The answer gave no reason." and nothing is made up.
4. Every quote is followed once, for the whole list, by this line: "These are the AI's own words. We did not check them." No reason is ever written by us beyond the counts and places in requirement 2. We do not say why the AI picked a business, only what it wrote.
5. A tie-in to the owner's own results is allowed only as one fixed sentence under the list, built from checks that really failed, and only when at least one check failed: "On your own site, {n} {check or checks} still need work. They are listed below." No claim that any check explains a name. When no check failed, no sentence.
6. Only answers from `answersOf(grade)` count (the same set as "Who AI named", second opinions included), so the counts equal the table above. A business is matched to a name the same way `shareOfVoice` matches (normalized text), never by a new rule.
7. No new AI call, no new fetch, no new stored field, no change to the score, the answers, or `competitors` on any answer. Nothing is stored; the list is built when the page is drawn.
8. Safety: every name and every quote is untrusted text. Strip control characters, escape on every page, never make a link of it, never follow it. A quote that holds text like "ignore the question" is shown as plain quoted text and has no effect.
9. The agency report (`prepared-by`) and the print page show the list too (they already show "Who AI named"), without the owner-facing sentence in requirement 5.
10. The spreadsheet download (`data.csv`) is not changed.
11. Tests as listed in design.md. The existing suite must still pass except the lines named there.

## Rules that still apply (checks, not new work)
The locked (not yet unlocked) report shows nothing new: the free part keeps its current competitor lists.

## Not in this change
No data about competitors from any outside site, no Google or Bing lookups for them, no scores or grades for competitors, no "how to beat them" advice, no dollar or lost-sales figures, no change to `shareOfVoice`, `analyzeAnswer`, the name checker, the score, the second opinions, the progress bar or `public/js/grade.js`.
