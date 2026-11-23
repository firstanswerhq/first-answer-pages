# Review notes: page read of Features A, B, C and bot protection (Nov 22, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
Read at commit e942626, phone (390px) and desktop (1280px). Verdict: READY. Nothing blocks.
The code review of V80, V81 and F7 was also READY.

These are small wording fixes. Change page text only, plus any test that quotes the old text.

## V82 Owner form: the left-out note uses jargon
Now: "We left that link out. It must be an https link to your reviews on Google, Yelp, Facebook or Nextdoor."
Change to: "We left that link out. It must start with https:// and go to your reviews on Google, Yelp, Facebook or Nextdoor."

## V83 Owner form: "Saved." at the top hides that the link was left out
When the reviews link is left out, the green line at the top says only "Saved." and the red note is far down the page.
Change the top line in that case to: "Saved, but we left out your reviews link. See below."

## V84 Owner form: "Street address" has no hint for a no-storefront owner
Add the hint: "Optional. Leave it blank if you go to your customers."

## V85 Per-address limit page: "address" misleads on a site about street addresses
Now: "We have had a lot of checks from your address."
Change to: "We have had a lot of checks from your internet connection."

## V86 Per-network limit page
Now: "A lot of checks have come from your network today."
Change to: "A lot of checks have come from your internet provider today. Please try again tomorrow, or from another connection."

## V87 Report: check names disagree
"Service area on your home page" sits beside "Hours on the home page" and "Street address on the home page".
Use "the home page" in all three.

## V88 To check, not wording
A test page labeled with the schema.org type `AutoWash` got "no business label found". `AutoWash` is a kind of LocalBusiness (under AutomotiveBusiness).
Check how the business-label Check decides which types count. If it uses a fixed list, say so in a note and list what is missing; do not change scoring without a requirement.
