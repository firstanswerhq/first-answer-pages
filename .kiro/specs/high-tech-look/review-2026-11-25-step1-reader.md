Verdict: NO-GO

Reader review of Step 1 after 9e7322f (diff vs 9e7322f~1). I checked the code and ran small node scripts. I did not change any code. Tests: 1778/1778 (as reported).

The verdict is NO-GO for four small items: R1, R2 and R3 are sentences that are wrong or contradict themselves, and R4 is a new false green. Each one takes a one-line fix. Everything else below is polish that can wait.

Note: `grade-html.js` does not show the signals yet (no `signalRows` call outside `health-signals.js`). So none of this is on a public page today. These sentences are what Step 2 will show.

## Part A: U1 to U5

| Item | State | Where | Checked how |
|---|---|---|---|
| U1 | Fixed | `name-match.js:370-372` | All 11 hosts were added. Script: `sameSite` gives false for joe vs bob on myshopify.com, g.page and github.io. |
| U2 | Fixed (but see R3) | `health-signals.js:346-347` | Script: no business label, the page shows "Joes Plumbing", Google says "Josephs Plumbing Co". The result is gray with the new sentence. With no name on the page, the result is the old "couldn't find" sentence. With a business label that differs, the result is red. |
| U3 | Fixed | `health-signals.js:191-194` | Script, green: `/frequently-asked-questions`, `/common-questions`, "Questions & Answers", "Questions and answers", "Q&A", "Q & A", `/faq`, `/faqs/`, `/questions`, `/help/questions-answers`. Red: "Questions? Call us" on `/contact`, which is correct. Small misses that still go red: `/frequently_asked_questions` (underscores), "Q and A" and `/team-qa`. These are low and can wait. |
| U4 | Fixed as asked | `grader.js:1448-1453` | Code: old entries are dropped from the front of the map whenever a new lookup is saved. The scan stops at the first fresh one, and deleting while looping over a Map is safe. If the server runs no new checks at all, old entries still stay in memory until the next check. That matches the agreed fix. |
| U5 | Partly | `health-signals.js:292-318, 432` | Script: `facebook.com/joeplumbing` vs `facebook.com/someoneelse` is amber (fixed). Upper or lower case, `www.`, `m.` and `?ref=` all still match. `joe.business.site` vs `bob.business.site` is amber. New false greens: see R4. |

## Part B: the sentences, read as a judge and as an owner

Must fix before Step 2 shows these (R1 to R4):

**R1. Wrong fix sentence on Socials.** `health-signals.js:506-507`
The Socials row always uses `FIXES.linkFacebook`. Script: the site links to Facebook only, and the row reads "1 of 3 linked" with the fix "Add a link to your Facebook page on your website so people and AI can connect the two." A judge sees us ask for a link that is already there.
Rewrite: give a fix that names what is missing, for example "Add links to your Instagram and TikTok pages on your website, if you have them." Or one fixed sentence: "Link the social pages you have (Facebook, Instagram, TikTok) from your website." (75 characters)

**R2. The reserve reason contradicts itself during a new check.** `health-signals.js:42`, used at `grader.js:1415`
"We kept today's last lookups for new checks, so we didn't look this up." But `lookupProfiles` runs during a new check (`grader.js:1600`), so a new check is told we kept the lookups "for new checks". The lookups are really kept for the AI question.
Rewrite: "We're almost at today's limit, so we saved the rest for the AI questions and skipped this one." (95 characters)

**R3. The U2 sentence sits under "Not checked" but says we compared.** `health-signals.js:347`
Label "Not checked", reason "The name on your website and the name on Google look different, so we didn't mark it." We did check, and "didn't mark it" means nothing to an owner.
Rewrite: "Your website and Google may use different names. Check that both show the same name." (85 characters)

**R4. New false green on "Links to your website" (real bug).** `health-signals.js:297, 316-317`
Only the first part of the path is compared, so the result is green in these cases (script):
- `sites.google.com/view/joe` vs `sites.google.com/view/bob`. Every Google Sites address starts with `view`, so this case is common.
- `facebook.com/pages/Joe/123` vs `facebook.com/pages/Bob/456`
- `facebook.com/profile.php?id=1` vs `?id=2`

Fix: compare the whole path without a trailing `/`, in lower case, plus the `id` query value for `profile.php`. Or: when the first part is `view`, `pages`, `p` or `profile.php`, require the full path and query to be the same. Add these three cases as tests.

Should fix (confusing, jargon, or wrong audience):

**R5. "Not found in the page code" is jargon, and the reason can be untrue.** `health-signals.js:183-185`
The label "page code" is jargon to an owner. The reason "Your name and phone weren't in the page's own text. Some AI tools can't read text added by scripts." is given for every amber case. That includes a page that simply has no phone number, and a scripted page where both were found. Script: `scriptBuilt` true with name and phone in the text still says they "weren't in the page's own text".
Label rewrite: "Not in the page text".
Reason rewrite, chosen by case:
- Name missing: "We couldn't find your business name in your page's text."
- Phone missing: "We couldn't find your phone number in your page's text."
- Scripted page: "Your page adds its words with scripts, which some AI tools can't read."

**R6. The fix uses "scripts", which is jargon.** `health-signals.js:67`
"Type your business name and phone number into the page itself, not only through scripts, so every tool can read them."
Rewrite: "Put your business name and phone number in the plain text of your page, so every tool can read them. Your web designer can help." (130 characters)

**R7. "Sitemap" is never explained.** `health-signals.js:66`
"Add a sitemap so search engines and AI tools can find all your pages. Most website builders can make one for you."
Rewrite: "Add a sitemap (a list of your pages for search engines) so search and AI tools can find them all. Most website builders make one for you." (139 characters)

**R8. "Not updated in a year" states as fact what we only guess.** `health-signals.js:258`
This comes from the sitemap's dates only. An owner who changed their site last week can be told it was not updated.
Label rewrite: "Sitemap dates over a year old". Add a reason: "We go by the dates in your sitemap, which some builders don't update."

**R9. The sitemap-index reason is jargon.** `health-signals.js:232`
"Your sitemap lists other sitemaps, so we couldn't count your pages."
Rewrite: "Your sitemap is split into parts we didn't open, so we couldn't count your pages."

**R10. "One page only" sounds like the whole website has one page.** `health-signals.js:245`
Rewrite: "Only one service page".

**R11. These reasons talk to us, not to the owner.** `health-signals.js:37-38`
"Google lookups aren't turned on here." and "Bing lookups aren't turned on here." The words "turned on here" and "lookups" are about our setup.
Rewrite: "We didn't check Google this time." and "We didn't check Bing this time."

**R12. The daily-limit reason calls a Google lookup an "AI question".** `health-signals.js:43`
"Today's limit for AI questions was reached, so we didn't look this up." This is shown on Google and Bing rows, and those are not AI questions.
Rewrite: "Today's limit for checks was reached, so we didn't look this up. Try again tomorrow." (84 characters)

**R13. "The lookup" is internal wording and doesn't say Google or Bing.** `grader.js:1422`
"We couldn't reach the lookup this time."
Rewrite: use "We couldn't reach Google this time." or "We couldn't reach Bing this time.", the same as `PLACES_ERROR_REASON` and `BING_ERROR_REASON`.

**R14. "On both sides" is unclear.** `health-signals.js:343, 411`
"We couldn't read a business name on both sides." and "We couldn't read a street address on both sides."
Rewrite: "We need a business name on both your website and Google to compare." and "We need a street address on both your website and Google to compare."

**R15. "In another place" is vague.** `health-compare.js:257, 267`
"A business with your website showed up in another place, so we didn't count it." and "A business with your name showed up in another place, so we didn't count it."
Rewrite: "We found a business with your website in a different city, so we didn't use it." and "We found a business with your name in a different city, so we didn't use it."

**R16. The newest-review reason uses our words, and the label can be wrong.** `health-signals.js:394`
"Based on the reviews Google returned (up to 5)." Google gives up to 5 "most relevant" reviews, not the newest ones, so a newer review may exist. "Returned" is our word.
Rewrite: "Google shows us only a few of your reviews, so you may have a newer one." (73 characters)

**R17. "Founding spots still open" shows as amber.** `health-signals.js:544`
It has the status 'partly' with no fix, so a sales line looks like a health problem. A judge may read it as an upsell posing as an issue.
Fix: show it as information with no color, or drop the row when it isn't Founding Member.

Polish (low):

**R18. The same idea uses different words.**
- "Matches" and "Doesn't match" (`:403, 405, 412, 414`).
- "Match" and "Don't match" (`:424, 426, 468, 470`).
- "Matches" and "Differs" (`:537-538`).

The plurals are grammatical (hours, details), but "Differs" on the listing stands alone. Use "Doesn't match".

**R19. "Opening hours" is British.** `health-signals.js:76, 83`
Use "business hours" or just "hours". Example: "Add your business hours to your Google Business Profile so customers can see them."

**R20. Rating labels have no unit.** `health-signals.js:57-59`
"4.3 or higher", "3.8 to 4.2" and "Below 3.8" don't say what they measure.
Rewrite: "4.3 stars or higher", "3.8 to 4.2 stars" and "Below 3.8 stars".

**R21. "Category differs" doesn't say from what.** `health-signals.js:375`
Rewrite: "Category may not fit what you do". It is amber only, which is right, because "dentist" vs `dental_clinic` gives a false amber.

**R22. Yelp, Instagram and TikTok fixes assume the business has those pages.** `health-signals.js:88, 90-91`
A plumber with no TikTok is told "Add a link to your TikTok page".
Rewrite: "If you have a TikTok page, link to it from your website so customers can find you."
Also, "0 of 3 linked" is red (`:507`). Amber would be fairer for a business that is not on social media.

**R23. "Not found" alone is vague on two text rows.** `health-signals.js:201`
On "Says where you work" and "Answers questions", "Not found" doesn't say where we looked, and we read only the home page.
Label rewrite: "Not on your home page".

**R24. "Marked closed" also covers temporarily closed.** `health-signals.js:369`
Rewrite for `CLOSED_TEMPORARILY`: "Marked temporarily closed".

**R25. The listing fix uses the odd phrase "one plain page".** `health-signals.js:92`
Rewrite: "Claim your free listing on First Answer Pages so customers have one simple page with your details."

**R26. The admin page contradicts itself for a waived fee.** `admin.js:316, 321`
A waived listing shows "fee paid: yes" (because `paid = waived || ...`) and also "Fee waived by admin."
Fix: show "fee: waived" in the trust line when `t.waived`.

**R27. The verify page for a waived fee still sells.** `verify.js:75, 150-152, 163`
The step is headed "Pay the fee", followed by "Done No fee for this listing.", and the price hint ("$X once for Founding Members...") still shows above it.
Rewrite: "Done. There is no fee for this listing." and hide the price hint when `status.waived`. The admin notes at `admin.js:45-46` read well.

Checked and fine: all FIXES are 160 characters or less (the longest is 123). No sentence promises that AI will name the business. "Not checked" is the only gray label. Apart from R19, the spelling is American ("canceled" in `verify.js:34`). None of the reasons blames the owner.
