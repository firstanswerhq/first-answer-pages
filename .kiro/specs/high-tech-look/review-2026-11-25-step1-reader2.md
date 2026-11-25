Verdict: GO

Second reader review of Step 1, after 0432099 and 91c7583 (`git diff 9e7322f..HEAD -- server test`). I read the code and ran two small node scripts. I did not change any code. Tests: 1785/1785 (I ran them).

All 27 items are fixed. R5 is mostly fixed, with one rare case left (Q4). There are no new false reds, nothing about keys changed, and the score and SEO code did not change. Part B has no sentence a judge would find wrong. It lists eight small items (Q1 to Q8) that are worth doing before Step 2 shows these rows.

## Part A: R1 to R27

| Item | State | Where | Checked how |
|---|---|---|---|
| R1 | Fixed | `health-signals.js:526-546` | Script: a site that links only to Facebook shows "1 of 3 linked", amber, with the fix "If you have them, add links to your Instagram and TikTok pages on your website so customers can find you." Facebook is not named. Instagram only names Facebook and TikTok. Two linked names only the missing one. All 3 linked is green with no fix. |
| R2 | Fixed | `health-signals.js:45`, used at `grader.js:1416` | The reason now reads "...saved the rest for the AI questions..." (see Q1 for wording). |
| R3 | Fixed | `health-signals.js:339, 368` | `NAMES_MAY_DIFFER` is shown when there is no business label. |
| R4 | Fixed | `health-signals.js:309-337` | Script, not green: `sites.google.com/view/joe` vs `/view/bob`, `/view/joe` vs `/view/joey`, `facebook.com/pages/A/1` vs `/pages/B/2`, `profile.php?id=1` vs `?id=2`, `profile.php` with no id, `facebook.com/joeplumbing` vs `/someoneelse`, `joe.business.site` vs `bob.business.site`, bare `facebook.com/`. Still green: the same page with a trailing `/`, a sub-page (`/view/joe/home`), mixed case, `www.` or `m.`, `?ref=`, `profile.php?id=1&ref=x`, and own domains. Tests are at `health-signals.test.js:741-748`. One low edge: a typed address that is only a prefix (`facebook.com/pages`) matches any page under it. Nobody types that as their website, so this can wait. |
| R5 | Mostly fixed | `health-signals.js:191-194` | The label is now "Not in the page text" and the reason depends on the case (scripted, name missing, phone missing). Left over: see Q4 for the scripted case and the case where both are missing. |
| R6 | Fixed | `:73` | 129 characters, with no "scripts". |
| R7 | Fixed | `:72` | 137 characters. This is the longest fix. |
| R8 | Fixed | `:269-271` | The label is "Sitemap dates over a year old" and a reason was added. |
| R9 | Fixed | `:242` | |
| R10 | Fixed | `:255` | |
| R11 | Fixed | `:39-40` | |
| R12 | Fixed | `:47` | See Q2 for a small leftover. |
| R13 | Fixed | `grader.js:1425` | Uses `PLACES_ERROR_REASON` / `BING_ERROR_REASON` ("We couldn't reach Google/Bing this time."). |
| R14 | Fixed | `:364, 434` | |
| R15 | Fixed | `health-compare.js:257, 267` | See Q6. |
| R16 | Fixed | `:66-67, 417` | The labels no longer say "newest". See Q5. |
| R17 | Fixed | `:583` | The status is `info`, with no fix. `design.md:108, 276` tells Step 2 to show it without a color. No code outside `health-signals.js` reads signal statuses yet, so nothing breaks. |
| R18 | Fixed | `:576` | "Doesn't match". The plural "Match"/"Don't match" for hours and details is kept, which is grammatical. |
| R19 | Fixed | `:82, 89` | "business hours" / "hours". No British spelling is left. |
| R20 | Fixed | `:62-64` | "4.3 stars or higher", "3.8 to 4.2 stars", "Below 3.8 stars". |
| R21 | Fixed | `:398` | "Category may not fit what you do" (still amber). |
| R22 | Fixed | `:95-98, 530-531` | The fixes start with "If you have...". "0 of 3 linked" is now amber, not red. |
| R23 | Fixed | `:211` | "Not on your home page". |
| R24 | Fixed | `:391` | "Marked temporarily closed". |
| R25 | Fixed | `:99` | |
| R26 | Fixed | `admin.js:319` | The trust line shows "fee: waived". The separate "Fee waived by admin." line at `:322` repeats it, which is harmless because only the admin sees it. |
| R27 | Fixed | `verify.js:75, 151, 164` | The waived page shows the heading "The fee", then "Done. There is no fee for this listing.", with no price hint. `trust.js:86` counts a waived fee as paid, so the phone and ID steps open. |

**S1-S17, T1-T9, U1-U5 still hold.** Every removed test line in the diff is a wording change, apart from two status changes, and both are softer (Socials `missing` to `partly`, Founding `partly` to `info`). No new `missing` was added: "Marked temporarily closed" was already red as "Marked closed". The only change to `grader.js` is the error reason and two imports, so the score, SEO, budget, reserve, cache and key handling are untouched. The S5/T3 rule against saving Google values is unchanged (`withoutGoogleValues`). U1-U5 behave as before (the U5 cases are in the R4 script above). All FIXES are 160 characters or less (longest 137; the longest Socials fix is 115). No sentence says AI will name the business.

## Part B: every sentence, read as a judge and as an owner

None of these is wrong. Each is small. Q1, Q2 and Q6 are the ones a judge is most likely to notice.

**Q1. The reserve reason talks about our setup.** `health-signals.js:45`. It shows on all 12 Google rows and both Bing rows.
"We're almost at today's limit, so we saved the rest for the AI questions and skipped this one."
An owner doesn't know what "the AI questions" or "the rest" are, and "this one" is vague on 14 rows.
Rewrite: "Many checks ran today, so we skipped this to leave room for the AI test. Try again tomorrow." (93 characters)

**Q2. The daily-limit reason seems to contradict the report it is on.** `health-signals.js:47`
"Today's limit for checks was reached, so we didn't look this up. Try again tomorrow."
It appears inside a check that did run, so a judge reads "limit for checks reached" and asks "then what is this?".
Rewrite: "We reached today's limit for Google and Bing searches, so we skipped this. Try again tomorrow." (94 characters)

**Q3. Two wordings for one idea, and "scripts" is back.** `health-signals.js:35` vs `:191`
`REASONS.script`: "Your page loads its words in a way this check can't read yet."
The wordsInPage reason: "Your page adds its words with scripts, which some AI tools can't read."
R6 took "scripts" out of the fix because it is jargon, but it is still in this reason.
Rewrite of `:191`: "Your page loads its words in a way some AI tools can't read." (61 characters)

**Q4. The wordsInPage label and reason miss two cases.** `health-signals.js:191-194`
- On a scripted page where both the name and the phone were found (rare, because `scriptBuilt` needs under 200 characters of text), the label "Not in the page text" is untrue. Label for the scripted case: "Hard for some AI tools to read".
- When both the name and the phone are missing, the reason names only the name. Add the case: "We couldn't find your business name or phone number in your page's text."

**Q5. The newest-review label reads awkwardly.** `health-signals.js:67`
"No review seen from the last 90 days"
Rewrite: "No review seen in the last 90 days"

**Q6. "Different city" makes a judge ask "why not use it?".** `health-compare.js:257, 267`. It shows on every Google or Bing row.
"We found a business with your website in a different city, so we didn't use it."
A judge who types "Brooklyn" for a business Google lists under "New York", or "St. Louis" for "Saint Louis", sees this on 12 rows and thinks we got it wrong.
Rewrite: "Google lists your website under a different city than the one you typed. Check the city and try again." (103 characters)
For the name case: "Google lists a business with your name in a different city than the one you typed. Check the city and try again." (113 characters)
The Bing rows need the same sentences with "Bing" in place of "Google". Or use "We found a business with your website in a different city than you typed. Check the city and try again." (104 characters)

**Q7. Two endings for the same Facebook, Instagram and TikTok fix.** `health-signals.js:96` vs `:542, 545`
The Facebook row says "...so people and AI can connect the two." The Socials row says "...so customers can find you." Both may sit side by side under Socials.
Rewrite of `:96`: "If you have a Facebook page, link to it from your website so customers can find you." (84 characters). This also matches Instagram and TikTok at `:97-98`.

**Q8. "Founding spots still open" says nothing on its own.** `health-signals.js:583`
With no color, fix or reason, a judge or owner doesn't know what a founding spot is. Step 2 should either add a short line ("Founding Members pay once for the Verified stamp.") or show the row only on the listing part of the report, not among the health rows.

Checked and fine: the verify waiver ("The fee" / "Done. There is no fee for this listing.") and the admin notes (`admin.js:45-46`) are clear and true. The rating, review, hours, address, Bing and listing labels are plain. "Not checked" is the only gray label. No reason blames the owner. Spelling is American throughout. Every sentence is 160 characters or less.
