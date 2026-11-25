# High-tech look: design

Status: Step 1, part A. This file holds only the list of main nodes and sub-nodes for the health map (Requirement 2.7 and 7.3). No code is written until the owner approves it. The rest of the design (signals, storage, tests) is added after the approval.

## How the list was made

- Source of truth for which checks exist: `healthy-setup-checklist.md` (Requirement 7.2). Source for wording, safety and tests: `requirements.md`.
- Every checklist item marked HAVE, ADD or KEY is one sub-node and one row of the plain text list. Items marked LATER (A7, A8, B6, C5, G3, G4) are not shown. Ads, backlinks, distance and clicks are never shown.
- A sub-node exists only for a thing the check really looked at. Where the same fact appears twice in the checklist (B5 and F2, A6 and G2's lookup), it is one sub-node, shown once.
- Nothing here changes the score (Requirement 2.5). The center shows the existing score as "Health 68".
- Status words follow Requirement 2.2: green = good, amber = partly or not linked, red = missing, gray = not checked. The label always says the status. Gray always has a one-line reason (Requirement 8.2).
- Every item marked KEY comes from ONE Google Places lookup per check, or ONE Azure Maps search for Bing (A6), made once and stored with the Grade. Without `GOOGLE_PLACES_API_KEY` or `AZURE_MAPS_KEY` the KEY sub-nodes read "Not checked" (gray), never red.

## The main nodes (seven)

Requirement 7.3 names seven main nodes. Requirement 2.6 names eight (Yelp and Socials as their own). They are reconciled below as seven, with Yelp and Socials under "Links"; see "Decisions for the owner", 1.

| # | Main node | Built from | Main status rule |
|---|---|---|---|
| 1 | Website | existing checks + new D and E items | green when every sub-node that was checked is green; amber when some are not; red when most are red; gray when the site could not be read |
| 2 | AI answers | existing `ai-named` answers | the report's own words for the `ai-named` row: green "Pass" (named in every counted answer); amber "Partly" (some); red "Needs work" (none); gray "Not checked" |
| 3 | Google profile | B1 to B4 (KEY) | green: all green; amber: some; red: not found on Google; gray: no key or lookup failed |
| 4 | Reviews | C1 to C4 | green when review count and stars are green; amber when partly; red when no Google reviews and none on the website; gray when not checked |
| 5 | Details match | A1 to A6, G2 | green: every checked detail matches; amber: some differ closely; red: a clearly readable detail does not match; gray: nothing could be compared |
| 6 | Links | F1 to F5, Yelp, Socials | green: every checked link is there; amber: some; red: none; gray: site could not be read |
| 7 | Free listing | G1 (Listed, Verified, and Founding Member when it applies) | green: listed and Verified; amber: listed, not Verified, or not listed yet; gray: not checked |

## The sub-nodes, with the checklist item and the status words each can show

Format: `sub-node` (checklist item, status HAVE/ADD/KEY, existing check id if any): green / amber / red / gray words. Gray words are always "Not checked" plus a reason line.

### 1. Website

**Cluster "AI can read it"**
1. `robots.txt lets AI assistants in` (E1, HAVE, `ai-bots-allowed`): green "Open to AI assistants" / red "Blocks some AI assistants" (names them) / gray "Not checked"
2. `Sitemap` (E2, ADD, Requirement 3.9): green "Found" (also a compressed `.xml.gz` sitemap the site serves, S4) / red "Not found" / gray "Not checked"
3. `Words are in the page itself` (E3, ADD): green "Found in the page" / amber "Not found in the page code", never red, because a page built by scripts cannot be told apart from a page that is missing the words; the reason line is "Your name and phone weren't in the page's own text. Some AI tools can't read text added by scripts." / gray "Not checked" only when the page could not be read
4. `Business label` (E4, HAVE, `business-labeled`): green "Found" / red "Not found" / gray "Not checked"

**Cluster "Speaks AI's language"** (Requirement 3.11 and checklist D)
5. `Says what you do` (D1, ADD): green "Found" / red "Not found" / gray "Not checked"
6. `Says where you work` (D2, ADD): green "Found" / red "Not found" / gray "Not checked"
7. `Answers common questions` (D3, ADD): green "Found" (a questions section, or a link to a FAQ or questions page, S9) / red "Not found" / gray "Not checked"
8. `A page for each service` (D4, ADD): green "Several service pages" / amber "One page only" (1 found) or "No separate service pages found" (0 found, S16) / gray "Not checked" (no sitemap and too few links to tell, or a sitemap index with no service link found)
9. `Recently updated` (D5, ADD): green "Updated in the last 12 months" / amber "Not updated in a year" / gray "Not checked" (no dates in the sitemap, or a compressed sitemap)
10. `AI info sheet (llms.txt)` (E5, HAVE, `info-sheet`): green "Found" / red "Not found" / gray "Not checked"

**Cluster "Search basics"**
11. `Title names city and service` (D6, HAVE, `title-city-service`): green "Good" / red "Needs work" / gray "Not checked"
12. `One headline` (D7, HAVE, `one-headline`): green "Good" / red "Needs work" / gray "Not checked"
13. `Summary` (D7, HAVE, `summary`): green "Good" / red "Needs work" / gray "Not checked"
14. `Image descriptions` (D7, HAVE, `image-descriptions`): green "Good" / red "Needs work" / gray "Not checked"
15. `Share picture` (D7, HAVE, `share-picture`): green "Good" / red "Needs work" / gray "Not checked"

**Cluster "Customer basics"**
16. `Tap to call` (D8, HAVE, `tap-to-call`): green "Good" / red "Needs work" / gray "Not checked"
17. `Hours on the page` (D8, HAVE, `hours-shown`): green "Good" (or "Shown in plain text" when not copied, V241) / red "Needs work" / gray "Not checked"
18. `Address on the page` (D8, HAVE, `address-shown`): green "Good" / red "Needs work" / gray "Not checked"
19. `Call button` (D8, HAVE, `call-button`): green "Good" / red "Needs work" / gray "Not checked"

### 2. AI answers

One sub-node per answer to the first question, as many as were asked (1 to 3, `GRADE_MAIN_ASKS`):
20. `Answer 1` / `Answer 2` / `Answer 3` (existing answers, `ai-named`). No new words: each sub-node shows the sentence the report already shows for that answer (the `outcome` sentence: "It listed 3 businesses, and yours was 1st." green; "It named these 2 businesses, not yours." or "It didn't name your business." red; "It named your business in its answer." green), and gray "Not checked" with the report's own reason when there was no answer (today's limit for AI questions was reached, "Claude didn't answer this time", or "The AI check is not connected yet"). The main node uses the row words above, including "Partly" in amber where the report uses it (named in some answers, not all).

The two extra questions and the second opinions stay in the report's "Every answer" list; they are not sub-nodes because they do not count toward the score.

### 3. Google profile (all KEY, one Places lookup; replaces the hidden `google-profile` check, Requirement 3.10)
21. `Found on Google` (B1): green "Found on Google" / red "Not found on Google" (only when Google returned no results at all, S1) / gray "Not checked" (no key, lookup failed or timed out, several close results, or results came back but none is clearly the business)
22. `Open for business` (B2): green "Open" / red "Marked closed" / gray "Not checked"
23. `Category fits` (B3): green "Category fits" / amber "Category differs" / gray "Not checked"
24. `Hours listed` (B4): green "Hours listed" / red "No hours listed" / gray "Not checked"

B5 (profile links to the website) is the same fact as F2 and is shown once, under Links (sub-node 38).

### 4. Reviews
25. `Google review count` (C1, KEY): green "10 or more reviews" / amber "1 to 9 reviews" / red "No reviews" / gray "Not checked" (thresholds in the named constants file)
26. `Google star rating` (C2, KEY): green "4.3 or higher" / amber "3.8 to 4.2" / red "Below 3.8" / gray "Not checked"
27. `Newest review is recent` (C3, KEY): green "Newest review within 90 days" / amber "Newest review is older than 90 days" / gray "Not checked"
28. `Reviews shown on your website` (C4, HAVE, `reviews-visible`): green "Shown" / red "Not shown" / gray "Not checked"

### 5. Details match
Comparisons are tolerant (A1 digits only without a leading 1; A2 street number, street name and ZIP with St/Street and Ave/Avenue; A3 ignores case, punctuation, LLC and Inc). A mismatch is red only when both values are clearly readable; a near match is amber (see the decisions).
29. `Phone matches Google` (A1, KEY): green "Matches" / red "Doesn't match" (shows both numbers) / gray "Not checked" (either side missing)
30. `Address matches Google` (A2, KEY): green "Matches" / amber "Close, not the same" / red "Doesn't match" / gray "Not checked"
31. `Name matches Google` (A3, KEY): green "Matches" (Google's name is written on the website) / amber "Close, not the same" / red "Doesn't match" only when the website's own business label differs clearly from Google's / gray "Not checked" (the website does not show a name to compare; the typed name is never compared on its own, T2)
32. `Hours match Google` (A4, KEY): green "Match" / amber "Some days differ" / red "Don't match" / gray "Not checked" (either side not readable)
33. `Your listing matches your website` (A5, ADD): green "Matches" / amber "Differs" / gray "Not checked" (no listing yet)
34. `Found on Bing` (G2, KEY, `AZURE_MAPS_KEY`): green "Found on Bing" / amber "Not found in Bing map data" (only when the search returned no results) / gray "Not checked". Never red (S2): Azure Maps data is not Bing Places itself.
35. `Details match on Bing` (A6, KEY, same Azure search as 34): green "Match" / amber "Close, not the same" or "Don't match" / gray "Not checked". Never red (S2).

### 6. Links
36. `Website links to your Google profile` (F1, ADD): green "Linked from your website" / amber "Not linked" / gray "Not checked"
37. `Website links to Yelp` (F3, ADD, Requirement 3.1): green "Linked from your website" / amber "Not linked" / gray "Not checked"
38. `Google profile links to your website` (F2 and B5, KEY): green "Links to your website" / amber "Doesn't link to your website" / gray "Not checked"
39. `Your listing links to your website` (F5, HAVE): green "Linked" / amber "No website on the listing" / gray "Not checked" (no listing)

**Cluster "Socials"** (F4, ADD, Requirement 3.1 and 2.6 item 7): the cluster shows "2 of 3 linked" and is green at 3, amber at 1 or 2, red at 0, gray when the site could not be read, or when the page is built by scripts and no profile link was found (S3: every link row is gray then too). Facebook first.
40. `Facebook`: green "Linked from your website" / amber "Not linked" / gray "Not checked"
41. `Instagram`: same words
42. `TikTok`: same words

(Only Facebook's fix sentence may say it helps AI connect the business; Instagram and TikTok say they help customers find and trust the business.)

### 7. Free listing
43. `Listed on First Answer Pages` (G1, HAVE, Requirement 3.6): green "Listed" / amber "Not listed yet" (with the claim link)
44. `Verified stamp` (G1, HAVE): green "Verified" / amber "Not verified yet" / gray "Not checked" (no listing)
45. `Founding Member` (G1, HAVE): shown only when it says something true. Green "Founding Member" when the listing is a Founding Member; amber "Founding spots still open" when it is not and Founding spots are still open; otherwise the sub-node is left out (no row, no node).

## Totals

45 numbered rows in 7 main nodes (Website 19, AI answers 1 row that is 1 to 3 sub-nodes, Google profile 4, Reviews 4, Details match 7, Links 7 with the three socials, Free listing 3), so 44 to 47 sub-nodes on the map (the Founding Member row is left out when it has nothing true to say). Of the 45 rows: HAVE 18 (existing checks and data), ADD 13 (built from the pages the check already reads, the listing data and the sitemap), KEY 14 (12 read from the one Google Places lookup per check, 2 from the one Azure Maps search).

## Decisions for the owner

1. **Seven main nodes.** Decided by the owner: Yelp and Socials stay inside "Links" (Requirement 7.3), with Yelp as a sub-node and Socials as a cluster. The Socials "2 of 3 linked" rule is kept for that cluster.
2. **Checklist items beyond 7.3's ranges.** A6 and G2 (Bing) are in the checklist as KEY but 7.3 says Details match is A1 to A5. I put both under Details match. D4 (a page for each service), D5 (recently updated) and E3 (words are in the page itself) are in the checklist as ADD but not in Requirement 3.11's four sub-nodes; I added D4 and D5 to "Speaks AI's language" and E3 to "AI can read it".
3. **One sub-node for one fact.** B5 and F2 are the same fact, so it appears once, under Links (38), not under Google profile. A6 and G2 use one Azure search.
4. **When a mismatch is red.** Never a false red (Requirement 8): a phone mismatch is red when both numbers are readable. For address, name and hours a close match is amber "Close, not the same" and only a clear difference is red. A category that differs is amber, never red. An old newest review is amber, never red.
5. **Founding Member.** Decided by the owner: shown only when the listing is a Founding Member (green) or Founding spots are still open (amber "Founding spots still open"); otherwise left out.
6. **The orb on phones** shows the seven main nodes; the sub-nodes open as a list (Requirement 2.9). The text list always has all 45.

## Not shown

LATER items (Apple Maps A7 and G3, Yelp and BBB details A8 and G4, profile claimed, photos and posts B6, owner replies C5), ads, backlinks, distance to the searcher, and clicks and calls from Google.

---

# Step 1 as built: the signals, their saving, and the admin fee waiver

Step 1 covers Requirements 3, 6 and 7, with the rules of Requirements 5 and 8. There is no health map and no new look yet. Nothing here changes the score (2.5), and no public page changed (5).

## Files

| File | What it does |
|---|---|
| `server/lib/health-constants.js` | Every threshold in one place: 10 reviews, 4.3 and 3.8 stars, 90 days, 12 months, 2 service pages, the 5-second lookup time limit, the 160-character fix limit. |
| `server/lib/profile-links.js` | Reads the page's own links for Yelp, Facebook, Instagram, TikTok and Google profile links (3.1). Share buttons, "sharer" links and home pages never count. Nothing is fetched. |
| `server/lib/sitemap-read.js` | Picks the sitemap address (the first `Sitemap:` line of robots.txt, else `/sitemap.xml`) and reads what came back, with every scan bounded (3.9). |
| `server/lib/health-compare.js` | Phone, name, address and hours comparisons, and the rule for picking one result out of a lookup's results. |
| `server/lib/places.js`, `server/lib/azure-maps.js` | The one Google Places lookup and the one Azure Maps (Bing) search of a check. Injectable `fetch`, a 5-second limit, the key never in a result, a log or an error. |
| `server/lib/health-signals.js` | `buildSignals` (all the new signals), `SIGNAL_ROWS` and `signalRows` (the sub-nodes of the design's list that this step builds, in order), and the fix sentences. |
| `server/lib/page-facts.js` | Now also keeps `facts.links` (at most 400) and `facts.faq`. |
| `server/lib/grader.js` | Reads the sitemap once, runs the two lookups in parallel with the AI question, builds and saves the signals. |
| `server/lib/trust.js`, `server/routes/admin.js` | The fee waiver (Requirement 6). |

## What is saved with a Grade

Changed by the reviews (S5, T3): the lookup results are no longer saved, and the saved signals hold no value read from Google or Bing (`withoutGoogleValues`). `grade.profilesAt` is when the lookups were made, and `grade.signals` is the object `buildSignals` made: `website`, `google`, `bing`, `links` and `listing`, each signal `{ id, status, label, reason?, fix?, ... }`. `status` is `good`, `partly`, `missing` or `not_checked`. The lookup results stay in the grader's memory only, for at most 30 days (`LOOKUP_KEEP_MS`) and at most 2,000 Grades. A recheck reads the website again and makes no new paid lookup. It compares with the kept lookups when they are 30 days old or less. Otherwise (older, or after a restart) every Google and Bing signal is gray with "Run a new check to look on Google again." or "... on Bing again.". Grades saved by the first build of this step had `grade.profiles`; it is removed from every Grade the first time a check or recheck runs after a start, and `profilesAt` is set to the Grade's `finishedAt`. A Grade saved before this step has no signals; `signalRows` then gives every row "Not checked" with the reason "This report was made before this check existed. Run a new check to see it."

## The rules that were built

- **Never a false red.** `missing` is only for when the check looked and it is truly not there. A lookup that is off, failed, timed out, hit the daily limit or found several close results gives gray "Not checked" with a reason, for every Google or Bing signal at once. A near match is amber, never red. The newest-review signal is amber (never red) and says it is based on the up to 5 reviews Google returned.
- **One Google lookup, one Bing search.** Each counts as one paid call from the Grader's daily share, and, like a second opinion, never uses the day's last 12 calls (they stay for the AI question of a new check). Each is skipped without its key (`GOOGLE_PLACES_API_KEY`, `AZURE_MAPS_KEY`) and in test runs.
- **Picking the business** (changed by S1). The website's domain is tried first: one result with the same registered domain is the business, when it is in the typed city (or no city was typed); in another city it is "unsure". Otherwise a result counts when its name matches or nearly matches (case, punctuation, LLC and Inc ignored, a small typo allowed) and it is in the typed city. Several that do are narrowed by the domain, then by an exact name; if more than one is left, nothing is picked ("unsure", gray). The right name in another city is "unsure". Results that come back but match nothing are "unsure" ("We couldn't tell which result is your business, so we didn't pick one."). "Not found" only when no result came back at all.
- **Sitemap.** One request, through the safe fetcher, in the same shared deadline as llms.txt. Found = real XML with at least one entry. Not found = a 404, a 410, or a reply that is not a sitemap. Blocked (401, 403, 429, 5xx), an error or a timeout = gray.
- **"Words are in the page itself" is never red.** A page built by scripts cannot be told apart from a page that is missing the words, so it is amber "Not found in the page code" with the reason, and gray only when the page could not be read. The text-based signals ("Says what you do", "Says where you work", "Answers common questions") are gray on a page built by scripts, with the same reason the existing text checks use.
- **Founding Member** has no row unless it says something true: green when the listing is a Founding Member, amber "Founding spots still open" when it is not and spots are open, otherwise left out.
- **Every fix sentence** is at most 160 characters (tested for each one) and says nothing about AI naming the business. Only the Facebook fix mentions AI; Instagram and TikTok say they help customers find and trust the business.

## Requirement 6 as built

`POST /admin/listings/:id/waive-fee` (admin sign-in and the same-origin rule of the other admin routes; a browser press goes back to the admin page with a fixed note). It saves `waivedAt` and `waivedBy: 'admin'` in the listing's trust record. `trustStatus` then counts the listing as paid (`paid: true`, `waived: true`) with no payment, so the pay button takes no money; the phone code and the photo ID check still have to pass before `verified` is true. The admin page shows the button "Waive the verification fee" for a listing that is not verified, not paid and not switched off, and "Fee waived by admin." after. Nothing shows to the public. The Founding Member spot is given at approval, as before, so a waived listing counts like a paid one. A second press, a verified or switched-off listing, or an unknown listing is refused (409 or 404).

## Tests

`test/profile-links.test.js`, `test/health-compare.test.js`, `test/places-lookup.test.js` (Google and Bing: no key, a match, no match, several, a chain, a typo, an error, a timeout, the key never in a result), `test/health-signals.test.js` (every signal, the rules above, checklist coverage read from `healthy-setup-checklist.md`, a property test that nothing throws and an unanswered Google lookup is never red), `test/grade-signals-flow.test.js` (through the whole check with a fake site and fake lookups: saved with the Grade, the sitemap asked for once, the score and Checks unchanged, a recheck makes no second lookup, a failing lookup, a site that times out or blocks us, no website, a published listing), `test/admin-waive-fee.test.js`, and `test/step1-public-unchanged.test.js` (the home page, a listing page, robots.txt, sitemap.xml and the noindex rules are as before). Every lookup in every test is a fake.

## Older test lines changed in this step

| Where | Old | New | Why |
|---|---|---|---|
| `test/grade-lead.test.js` line 540 (the V240 paragraph under "Every answer", Claude and ChatGPT) | `We asked Claude 3 questions. Only that answer counts toward your score. Claude didn't name you. …` | `We asked Claude 3 questions. Only its answer to the first question counts toward your score. Claude didn't name you. …` | V252: "that answer" points back to nothing when several questions were asked |
| `test/grade-lead.test.js` lines 596 and 597 (Claude, ChatGPT and Gemini) | two fragments: `The other assistants' answers are here to compare.` and `Only that answer counts toward your score.` | one regular expression for the whole paragraph, in order | V254: the fragments had made the test weaker |
| `test/grade-o1-notes.test.js` line 253 (`THREE_PARAGRAPH`) | `…Only that answer counts toward your score. Claude named you. …` | `…Only its answer to the first question counts toward your score. Claude named you. …` | V252 |
| `test/grade-reader-notes.test.js` line 147 (the V209 test, two questions) | `…Only that answer counts toward your score. Claude named you. On the other question…` | `…Only its answer to the first question counts toward your score. …` | V252 |
| `test/grade-report-asks.test.js` line 167 | `…Only that answer counts toward your score. Claude didn't name you. …` | `…Only its answer to the first question counts toward your score. …` | V252 |
| `test/grade-reader-notes2.test.js` (the V251 test, no website) | `To ask AI again, <link>.` | `To ask AI again after your changes, <link>.` | V257 |
| `test/grade-reader-notes2.test.js` (the V225-3 home test) | a plain data folder | a published plumber in Nashville, and two more checks (an answered search is indexable; the title and description cut a long city at 60 characters) | V255, V256 |
| `test/places-lookup.test.js` (the field mask test) | `places.reviews.publishTime` in the list of 10 fields | `places.reviews`, and the nested mask is not asked for | S6 |
| `test/places-lookup.test.js` line 97 ("results that are nothing like the business") | `other.status` is `'not_found'` | `'unsure'`, with the new reason and no place | S1 |
| `test/places-lookup.test.js` (Bing: "a different business") | `'not_found'` | `'unsure'` | S1 |
| `test/health-compare.test.js` (picking a result: Ridgeline Roofing) | `'not_found'` | `'unsure'`, with the new reason | S1 |
| `test/health-signals.test.js` (Bing: details differ clearly; not found) | `details.status` `'missing'`; `found.status` `'missing'` | `'partly'` "Don't match"; `'partly'` "Not found in Bing map data" | S2 |
| `test/health-signals.test.js` (a page for each service, 0 service pages) | label `'One page only'` | `'No separate service pages found'`; a new line keeps `'One page only'` for 1 page | S16 |
| `test/grade-signals-flow.test.js` (saved with the Grade; no keys; a failing lookup; the recheck) | `g.profiles.places.status` is `found`, `off`, `error`; `after.profiles` equals `g.profiles` | `profiles` is not on the Grade; `profilesAt` is the check time; the failing lookup's reason is read from the signals | S5 |
| `test/grade-signals-flow.test.js` (the lookups never use the day's last 12 calls) | `g.profiles.places.status` is `limit`; reason matches `/Today's limit for AI questions/` | the reason is "We kept today's last lookups for new checks, so we didn't look this up." for Google and Bing | S14 |
| `test/grade-lead.test.js` line 597 (V254, Claude, ChatGPT and Gemini) | a regular expression that allowed four outcomes | the one outcome the stub gives: `Claude didn't name you. On the 2 other questions, Claude didn't name you.` | S17 |

## Review fixes S1 to S17 (review-2026-11-24-step1.md)

None of these changes the score or any public page. Every fix sentence is still at most 160 characters (the `FIXES` test).

| Item | What changed | Where | Tests |
|---|---|---|---|
| S1 | `pickCandidate` tries the website's registered domain first (found when in the typed city or no city typed; "unsure" in another city). Results that match nothing are "unsure", not "not found". "Not found" only for zero results. | `health-compare.js` | `places-lookup` (Joe's typed, "Joseph's Plumbing Co" listed: with the domain found, without it unsure, in another city unsure), `health-compare` (domain first; "not_found" only for an empty list) |
| S2 | Bing is never red: no results is amber "Not found in Bing map data"; a clear mismatch is amber "Don't match". `FIXES.bingFound` now says to check Bing Places. Rows 34 and 35 above updated. | `health-signals.js` | `health-signals` (a never-red loop over Bing outcomes) |
| S3 | On a script-built page with no profile link found, every link row and Socials are gray with the script reason. A script-built page that does show a link is read as usual. | `health-signals.js` | `health-signals` |
| S4 | `isGzipSitemap` (`.gz` address, a gzip content type, or the gzip bytes at the start). A 2xx gzip sitemap is green "Found" with `gzip: true`; its pages and dates are not read, and "Recently updated" is gray "Your sitemap is compressed, so we couldn't read its dates." | `sitemap-read.js`, `health-signals.js` | `health-signals` |
| S5 | Lookup results are never saved with the Grade: only `signals` and `profilesAt`. They are kept in memory for at most 30 days for rechecks; older, or after a restart, the Google and Bing signals say "Run a new check to look on Google again." (or Bing). No new lookup on a recheck. Old stored `profiles` are purged once per process. | `grader.js` | `grade-signals-flow` (nothing of Google's in `grades.json`; a recheck at 30 days reuses, at 31 days says run a new check; a restart; an old Grade; the purge) |
| S6 | Field mask `places.reviews` (not the nested mask). Each lookup's outcome is counted per day with `aiBudget.note`: `placesOk`, `placesError`, `bingOk`, `bingError` (found, not found and unsure are ok; error is an error; off and held back are not counted). The admin protection block shows "Lookups today: Google N ok, N errors; Bing N ok, N errors." when a lookup is on. `gradeGuard.summary()` returns them as `lookups`. | `places.js`, `grader.js`, `grade-guard.js`, `grade-admin.js`, `app.js` (`ctx.lookupsOn`, true/false only) | `places-lookup`, `grade-signals-flow` (counts, summary, the admin line, no key on the page) |
| S7 | One timer for the whole lookup (request and body), so it never runs past 5 seconds. | `places.js`, `azure-maps.js` | `places-lookup` (60 ms request plus 60 ms body is cut off by one 90 ms limit) |
| S8 | The Azure key is sent in the `subscription-key` header, never in the address; `countrySet=US` is added. | `azure-maps.js` | `places-lookup` |
| S9 | "Answers common questions" is also found when the page links to a FAQ or questions page. | `health-signals.js` | `health-signals` |
| S10 | `facebook.com/p/<name-id>/` counts as a Facebook page. | `profile-links.js` | `profile-links` |
| S11 | E3 compares the typed name with the page text after both lose "and", "&", "the", "LLC" and the like. | `health-signals.js` | `health-signals` |
| S12 | A number right after Suite, Ste, Apt, Apartment, Unit, #, Fl, Floor, Rm or Room is not the street number. A difference of only a direction word (N, S, E, W, NE, NW, SE, SW) is "close" (amber). `addressInText` allows a direction word between the number and the street. | `health-compare.js` | `health-compare` |
| S13 | The threshold labels are built from `health-constants.js` (`LABELS`); at the default values they read as before. | `health-signals.js` | `health-signals` |
| S14 | The reserve reason is "We kept today's last lookups for new checks, so we didn't look this up."; a refused call keeps "Today's limit for AI questions was reached, ...". The signals use the reason the grader passes for `off` and `limit`. A recheck of a Grade from before this step says the old-report reason. | `grader.js`, `health-signals.js` | `health-signals`, `grade-signals-flow` |
| S15 | The owner's verify page says "No fee for this listing." for a waived fee, never "Fee paid". Note: on a Stripe test key, `lockedByMode` locks a listing with a waived (real) record, because only practice records can be used in test mode. That is fine for production. | `routes/verify.js` | `admin-waive-fee` |
| S16 | 0 service pages reads "No separate service pages found" (amber); 1 stays "One page only". A sitemap index's addresses are not counted as pages; with no service link found it is gray "Your sitemap lists other sitemaps, so we couldn't count your pages." | `health-signals.js` | `health-signals` |
| S17 | The "To ask AI again after your changes" sentence is one constant used in both places of `recheckBlock`. The V254 test is pinned. | `grade-html.js` | `grade-lead` |

## Before go-live (S6)

- Make one real `places:searchText` call with the field mask above and confirm a 200. Asking for reviews puts every call on the Enterprise + Atmosphere price.
- Make one real Azure Maps `search/poi/json?api-version=1.0` call with the key as the `subscription-key` query parameter (T4) and confirm it answers. Search v1 is "superseded by 2026-01-01" with no retirement date, and the 2026-01-01 API has no POI search. If v1 stops answering, drop G2 and A6.
- Watch the "Lookups today" line on the admin page for the first days.

## Open point for the owner (closed by T3)

The saved signals used to carry values read from Google (the other side of a mismatch, the star rating, the review count and the newest review date). Since T3 they are dropped before saving; see below.

## Second review fixes T1 to T9 (review-2026-11-25-step1-pass2.md)

None of these changes the score or any public page. Every new sentence is 160 characters or less.

| Item | What changed | Where | Tests |
|---|---|---|---|
| T1 | `SKIP_DOMAINS` is exported from `name-match.js`, unchanged, because the AI answer reading uses it and the score must not move. A second set, `SHARED_DOMAINS`, adds `business.site`, `square.site`, `linktr.ee`, `carrd.co`, `canva.site` and `my.canva.site`, `sites.google.com`, `fb.com`, `fb.me`, `wix.com`, `editorx.io`, `webflow.io`, `squareup.com`, `godaddy.com` and `site123.me`. It is used only by the new `sameSite(a, b)`, which is false when the domain is a shared host. `pickCandidate`, in the domain-first step and the tie-break, and `listingInfoFor` both use `sameSite`, so a shared host is never proof. | `name-match.js`, `health-compare.js`, `grader.js` | `health-compare` (a Facebook website and a wixsite website pick nothing; the right name on a shared host is still found by the name rule; a tie is not broken by a shared host; every listed host) |
| T2 | "Name matches Google" uses the website's own business label (schema). Google's name written in the page counts as a match. With no label, the typed name is used only when the page shows it. Then a close name is amber and a clear difference is gray "We couldn't find your business name written on your website.". Red only when the label differs clearly from Google's. The typed name is never shown as the website's name unless the page shows it. | `health-signals.js` (`nameMatchSignal`) | `health-signals` |
| T3 | `withoutGoogleValues(signals)` drops `google`, `bing`, `rating`, `count` and `newest` from every Google and Bing signal. The status, label, reason, fix and the website's own value stay. `signalsFor` saves only that, on a check and on a recheck. The full values exist only while the signals are built from the lookups kept in memory (30 days at most). The purge that runs once per start also cleans signals saved before this fix. | `health-signals.js`, `grader.js` | `health-signals`, `grade-signals-flow` (mismatch fixtures: no Google or Bing value in `grades.json` after the check or after a recheck; old dirty signals are cleaned) |
| T4 | The Azure key is back in the query string (`subscription-key`), the only way Search POI v1.0 documents it. That address stays inside the lookup function. It is never logged, put in a result or error, stored or shown, and every failure becomes one fixed sentence. Search v1 is "superseded by 2026-01-01" with no retirement date, and the 2026-01-01 API has no POI search. | `azure-maps.js` | `places-lookup` (the key is in the query and not in a header; failures whose message or body hold the address give only the fixed sentence; the module has no logging) |
| T5 | When the one result with the website's domain is in another city, the name rule still runs. The "another place" reason is given only when the name rule finds nothing in the typed city either. | `health-compare.js` | `health-compare` |
| T6 | After a restart, a recheck of a lookup that is off (no key) says it is off ("... lookups aren't turned on here."), not "Run a new check ...". The same applies to an old report. | `grader.js` | `grade-signals-flow` |
| T7 | On a script-built page, only the three socials and the Socials cluster are gray when none of the three is found. Google and Yelp are read as usual. | `health-signals.js` | `health-signals` (S3 test updated) |
| T8 | A questions link must say FAQ, "common questions" or "frequently asked questions", or point at `/questions`. "Questions? Call us" on `/contact` does not count. | `health-signals.js` | `health-signals` |
| T9 | The sitemap reply is read as XML first. `isGzipSitemap` is used only when it is not XML, so a `.xml.gz` the fetcher already unpacked is read in full, dates included. | `health-signals.js` | `health-signals` |

## Third review fixes U1 to U5 (review-2026-11-25-step1-pass3.md, verdict GO)

None of these changes the score or any public page (`SKIP_DOMAINS` is unchanged). Every new sentence is 160 characters or less.

| Item | What changed | Where | Tests |
|---|---|---|---|
| U1 | `SHARED_DOMAINS` also holds `myshopify.com`, `blogspot.com`, `netlify.app`, `vercel.app`, `github.io`, `mystrikingly.com`, `wixstudio.io`, `g.page`, `jimdosite.com`, `yolasite.com` and `webnode.com`. (`my.canva.site` and `sites.google.com` never match, because `registeredDomain` shortens them, but they do no harm.) | `name-match.js` | `health-compare` (one row per host: never proof, and another business on it is not picked) |
| U2 | When the page shows the typed name, there is no business label, and Google's name differs clearly, the gray reason is "The name on your website and the name on Google look different, so we didn't mark it." "We couldn't find your business name written on your website." is kept for when neither name is on the page. | `health-signals.js` (`nameMatchSignal`) | `health-signals` |
| U3 | The questions-link pattern also finds `/frequently-asked-questions`, `/common-questions`, "Questions & Answers", "Questions and answers" and "Q&A". It still ignores "Questions? Call us" on `/contact`. | `health-signals.js` (`linksToQuestions`) | `health-signals` |
| U4 | `keepLookups` drops entries older than 30 days each time it keeps a new one. The map is in time order, so the scan stops at the first fresh entry. No lookup stays in memory past 30 days only because nobody rechecked it. | `grader.js` | `grade-signals-flow` (a check 31 days later drops the first Grade's lookups; a recheck with the clock moved back says to run a new check) |
| U5 | On a shared host, "Links to your website" also needs the same host and first part of the path, lower case, without `www.` and `m.` (`facebook.com/joeplumbing`). A bare shared host such as `facebook.com/` never counts. A site of its own on a shared host with no path typed (`joe.business.site`) compares the host. Other websites still compare by registered domain. | `health-signals.js` (`linksToSameSite`) | `health-signals` |

No older test line changed for U1 to U5.

### Older test lines changed by T1 to T9

| Where | Old | New | Why |
|---|---|---|---|
| `test/places-lookup.test.js` (Bing: one search) | key not in the address; `subscription-key` header equals the key | `subscription-key` query parameter equals the key; no header | T4 |
| `test/health-signals.test.js` (the S3 test) | all six link rows gray on a script-built page with no links | the three socials and Socials gray; Google and Yelp amber "Not linked" | T7 |
| `test/grade-signals-flow.test.js` (the S5 old-Grade test) | restarted with no lookups | restarted with both lookups on, so the old-report and stale reasons are still shown | T6 |
