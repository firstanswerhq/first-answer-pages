# Spec review: owner-approved features (Nov 18, 2026)

Written by Claude (review notes only; Kiro writes the spec and the code).

The spec for Features A and B (Requirements 18 to 20, the design section "Owner-approved features (Nov 18)", tasks F1 to F7) is careful and mostly ready. The point split is right: Customer basics still totals 15 and all Checks still total 100. I checked the fixture arithmetic by hand: restaurant 33 of 85 is 39, roofer 16 of 85 is 19, large company 55 of 85 is 65. Every changed test number is listed with its reason, and old Grades are handled. The "is" to "are" change in Requirement 7.2 is fine, because the code already says "are".

Fix the items below (S1 to S13; S6 to S12 come from a second reviewer who ran the code and the design's patterns) in requirements.md, design.md and tasks.md before any code. Spec changes only; no code and no shell commands. Then stop for one more look.

## S1. Feature C is missing (must fix)

`feature-request-2026-11-18.md` has three features. The spec covers A and B but not C ("Link each listing to the business's own website", approved Nov 18, 10:27 PM). Add it as Requirement 21, a design section and tasks F8 onward (after F7, so A and B keep their numbers):

- Listings get an optional `website` field: a public `https` link to the business's own site. The validator refuses IP addresses (v4 and v6), `localhost`, user names, passwords and ports. It keeps the scheme, host and path only, dropping the query string and the `#` part, so no login or tracking parameters are kept. It allows 300 characters at most. Reuse the existing public-address rules wherever they fit.
- The listing page shows a plain "Website" row linking to the site (escaped, `rel="noopener noreferrer"`). The listing's business label (JSON-LD) adds it under `sameAs`; the label's `url` stays the listing page.
- The owner form (`/rise` draft form), the Draft review page and the admin Draft page show and edit it like the other optional fields.
- Claim from the AI Visibility Check fills it from the website the owner typed on the check (`grade.input.website`), run through the same validator.
- `llms.txt` and the MCP tools include the website for listings that have one.
- A listing without the field renders exactly as today. The field is never in `missingFields`. Follow the same pattern as `reviewsLink` in `normalizeFields`: add the key only when it has a value, so `test/listing-fields.test.js` stays valid.
- Tests: valid and invalid links (http, an IP address, localhost, credentials, a port, a link with a query string that comes back without it, over 300 characters); the listing page row and the `sameAs` entry; the claim fill; llms.txt and MCP output. Additions only.

## S2. A Facebook or Nextdoor footer link should not pass "Reviews AI can see"

Most small business sites have a Facebook icon in the footer that links to the business's page, not its reviews. As written, that one link passes `reviews-visible` and fills the listing's reviews link. That makes the Check pass for almost everyone and says nothing about reviews AI can read. Change the rule for the Check and the claim fill, not for the owner-typed field:

- For the Check and for `reviewLinks` read from a page, a Facebook link counts only when its path contains `/reviews`. A Nextdoor link counts only when its path starts with `/pages/`.
- Google's "write a review" form (`search.google.com/local/writereview`) never counts and is never filled in, because it opens a form, not the reviews.
- The claim fill prefers a Google link, then Yelp, then Facebook or Nextdoor.
- The owner-typed `reviewsLink` field may still accept any `facebook.com` or `nextdoor.com` page, since the owner chooses it.
- Tests: a page whose only signal is a footer link to `https://www.facebook.com/CapitalCityWindow` fails; `https://www.facebook.com/CapitalCityWindow/reviews` passes; a `writereview` link alone fails; with a Facebook reviews link and a Google maps link on the same page, the claim fills the Google one.

## S3. Let AI read the reviews link on the listing

The point of Feature B is reviews that AI can see. Requirement 20.6 keeps the reviews link out of the business label, llms.txt and MCP, so an AI reading the listing through those can't find the reviews. Change 20.6: include `reviewsLink` in llms.txt and the MCP tools (as a link only, labeled "Reviews"), and add it to the business label's `sameAs` next to the website from S1. Still never a rating, a review count or review text anywhere. Update F6's "confirm unchanged" line to match and add tests for the new output.

## S4. Use the business's own city in the service-area fix

The design's fix text says "like \"Serving Tallahassee and nearby areas\"" for every business. Use the Grade's own city ("Serving Nashville and nearby areas"), escaped, and fall back to "your city" when the city is empty. Keep the fix at 160 characters or fewer for long city names. If it would go over, drop the example rather than cut words.

## S5. American wording in the form hint

The hint "Tick this if you travel to customers and don't show a street address." uses British wording. Use "Check this box if you go to your customers and don't show a street address." Words like "ticked" inside the spec are fine; only the page text matters. Add "tick" to the F7 wording pass.

## S6. Old Grades and the new points: pick one rule (must fix)

The design says an old Grade keeps its stored Score, but the code won't do that as written:
- `runExtraQuestions` in grader.js recomputes `g.score` with the new points the first time the extra questions run (on unlock, or the first view with the lead gate off). An old restaurant Grade goes from 42 to 40 (33 of 82).
- The report mixes the two tables: Check rows use the new points (`checkRow`, grade-html.js around lines 395 to 403, e.g. "4 of 4 points" for tap-to-call), while "Score by area" uses the stored `byGroup` ("15 of 15", `groupLines`, around lines 378 to 390).
- After a Recheck, an unchanged site reads "Your score was 42 before. It is 39 now."

Use this rule, the simpler one: every Score, area line and Check row is always computed from the stored results with the current points (a Grade stored without `reviews-visible` simply doesn't count it, so an old restaurant Grade shows 40 everywhere, consistently). The "Your score was X before" line is shown only when both Grades have a `reviews-visible` result, so the report never compares scores across the points change. Update Requirement 19.5, the "Old Grades" design paragraph and F3. Add tests: an old Grade with no `reviews-visible` result shows the same score in the headline, the area lines and the Check rows, before and after the extra questions run; and a Recheck of an old Grade shows no "before" line.

## S7. The JSON API and MCP already show every public listing field

Requirement 20.6 and F6 say the JSON API and the MCP tools stay unchanged, but `/api/listings/:id` (routes/api.js, around line 54) and `get_listing` (mcp.js, around line 178) return every public key, so `reviewsLink` and `website` will appear there on their own. That is what we want (S3). Only the MCP `summarize` text (mcp.js, around lines 122 to 134), llms.js (around lines 89 to 104) and schema.js need code. Add each line only when the field has a value: the llms.txt line-count properties in test/llms.test.js (around lines 125 and 219) and `MODEL_KEYS` in test/listing-fields.test.js (around line 262) hold only then. The reviewer checked: with that, no existing llms, schema, MCP or API test breaks.

## S8. Escape the city in `serviceAreaPattern(city)` (must fix)

`normalizeGradeInput` accepts cities like "A++" and "Nash|ville", and `normalizeForMatch` keeps those symbols. Built without escaping, "A++" throws (the website step fails), and a "|" in the city matches the empty string, so the Check always passes. Escape every special character in the city before building the pattern, and match against `normalizeForMatch(facts.text)` with the city normalized the same way; otherwise "St. Louis" never matches. Tests: "A++", "Nash|ville", "St. Louis" and an empty city; none throws, and none passes a page with no service-area words.

## S9. Three false passes to close

- "We serve breakfast all day" passes the service-area Check. After "we serve" (and "we proudly serve"), require the city name or an area word (area, areas, county, counties, surrounding, nearby, communities) within 80 characters, as for "serving". Test that line on a no-storefront Grade: fail.
- The rating pattern `\/\s?5` passes "Closed 1/5". For the slash form, require a decimal ("4.8/5", "5.0/5"); keep "out of 5" and "stars". Test "Closed 1/5" and "Open 9/5": fail.
- A bare "Reviews" menu link passes, which is S2's footer problem in text form. The words "reviews" and "testimonials" count only inside a heading (h1 to h3) or as a section title, never inside a link or a menu. A heading such as "What our customers say" also counts. Page_Facts may need the h2 and h3 text for this. Test that a page whose only signal is a "Reviews" link in the menu fails, and a page with an h2 "Customer reviews" passes.

## S10. Bounded windows instead of "no lazy regular expressions"

F2 says "do not add lazy regular expressions", but the design's "within 80 characters" and "within 40 characters" rules need a window. Allow bounded windows like `[^\n]{0,80}` and keep the no-lazy rule otherwise. The reviewer ran every design pattern on 1 MB adversarial pages, and all finished in under 20 ms; keep a 1 MB speed test for the new patterns.

## S11. Accept the Google review links owners actually have

The reviews link validator rejects common Google links:
- `https://maps.google.com/?cid=…` (any path on maps.google.com)
- `https://www.google.com/search?…#lrd=…` (only when the part after `#` contains `lrd=` or the query contains `ludocid=`)
- `https://g.co/kgs/…`

Accept those. Keep the query string and `#` part for review links: Google needs them, unlike the website field in S1. Tests: each of these passes, and a plain `https://www.google.com/search?q=plumbers` fails.

## S12. Test the service-area fix length too

test/grade-checks.test.js (around line 20) checks only each Check's main `fix` against 160 characters, not the `serviceArea` variant. Add a test with an 80-character city that keeps the variant fix at 160 characters or fewer (S4).

## S13. Feature D

Add Feature D (end of `feature-request-2026-11-18.md`) to the spec as its own requirement and tasks after Feature C. Don't build it yet: Claude will confirm with Colby first.
