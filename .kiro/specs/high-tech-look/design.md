# High-tech look: design

Status: Step 1 (signals) done and reviewed GO. Step 2 (the health map, Requirement 2) built; see "Step 2 as built" at the end. Step 3 (site look) not started.

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
3. `Words are in the page itself` (E3, ADD): green "Found in the page" / amber "Not in the page text" (R5), never red, because a page built by scripts cannot be told apart from a page that is missing the words; the reason line says which case it is (the name is missing, the phone is missing, or the page adds its words with scripts) / gray "Not checked" only when the page could not be read
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
45. `Founding Member` (G1, HAVE): shown only when it says something true. Green "Founding Member" when the listing is a Founding Member; "Founding spots still open" as plain information (status `info`, no health color, no fix, reader review R17) when it is not and Founding spots are still open; otherwise the sub-node is left out (no row, no node).

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

## Reader review R1 to R27 (review-2026-11-25-step1-reader.md)

None of these changes the score or any public page. The signals are not shown on any page yet (Step 2 will show them). Every sentence is 160 characters or less, in American spelling, and none promises that AI will name a business. The same idea uses the same words: "Matches" and "Doesn't match" for one value (phone, address, name, listing), "Match" and "Don't match" for several (hours, Bing details).

| Item | Old | New | Where |
|---|---|---|---|
| R1 | Socials fix always "Add a link to your Facebook page ..." | Names only the networks that are missing, for example "If you have them, add links to your Instagram and TikTok pages on your website so customers can find you." (`socialsFix`) | `health-signals.js` |
| R2 | "We kept today's last lookups for new checks, so we didn't look this up." | "We're almost at today's limit, so we saved the rest for the AI questions and skipped this one." | `health-signals.js` (`LOOKUP_RESERVE_REASON`) |
| R3 | "The name on your website and the name on Google look different, so we didn't mark it." | "Your website and Google may use different names. Check that both show the same name." (`NAMES_MAY_DIFFER`) | `health-signals.js` |
| R4 | On a shared host only the first part of the path was compared | The Google link must go to the same page as the typed one, or a page under it: the whole path, lower case, no trailing "/", and the `id` for `profile.php`. `sites.google.com/view/joe` vs `/view/bob`, `facebook.com/pages/Joe/123` vs `/pages/Bob/456` and `profile.php?id=1` vs `?id=2` are amber. | `health-signals.js` (`pageOf`, `linksToSameSite`) |
| R5 | "Not found in the page code" with one reason for every case | "Not in the page text", and a reason by case: "We couldn't find your business name in your page's text.", "We couldn't find your phone number in your page's text." or "Your page adds its words with scripts, which some AI tools can't read." | `health-signals.js` |
| R6 | wordsInPage fix with "scripts" | "Put your business name and phone number in the plain text of your page, so every tool can read them. Your web designer can help." | `FIXES.wordsInPage` |
| R7 | sitemap fix | "Add a sitemap (a list of your pages for search engines) so search and AI tools can find them all. Most website builders make one for you." | `FIXES.sitemap` |
| R8 | "Not updated in a year" | "Sitemap dates over a year old", with the reason "We go by the dates in your sitemap, which some builders don't update." | `health-signals.js` |
| R9 | "Your sitemap lists other sitemaps, ..." | "Your sitemap is split into parts we didn't open, so we couldn't count your pages." | `health-signals.js` |
| R10 | "One page only" | "Only one service page" | `health-signals.js` |
| R11 | "Google lookups aren't turned on here." / "Bing ..." | "We didn't check Google this time." / "We didn't check Bing this time." | `health-signals.js` |
| R12 | "Today's limit for AI questions was reached, ..." | "Today's limit for checks was reached, so we didn't look this up. Try again tomorrow." | `health-signals.js` (`LOOKUP_LIMIT_REASON`) |
| R13 | "We couldn't reach the lookup this time." | "We couldn't reach Google this time." or "We couldn't reach Bing this time." | `grader.js` |
| R14 | "... on both sides." | "We need a business name on both your website and Google to compare." and "We need a street address on both your website and Google to compare." | `health-signals.js` |
| R15 | "... showed up in another place, so we didn't count it." | "We found a business with your website in a different city, so we didn't use it." and "... with your name ..." | `health-compare.js` |
| R16 | "Newest review within 90 days" / "Newest review is older than 90 days" / "Based on the reviews Google returned (up to 5)." | "A review in the last 90 days" / "No review seen from the last 90 days" / "Google shows us only a few of your reviews, so you may have a newer one." | `health-signals.js` (`LABELS`) |
| R17 | "Founding spots still open" as amber | status `info`: no health color, no fix. Step 2 must show `info` without a color. | `health-signals.js` |
| R18 | listing "Differs" | "Doesn't match" | `health-signals.js` |
| R19 | "opening hours" | "business hours" in the Google hours fix, "hours" in the hours match fix | `FIXES` |
| R20 | "4.3 or higher", "3.8 to 4.2", "Below 3.8" | "4.3 stars or higher", "3.8 to 4.2 stars", "Below 3.8 stars" | `LABELS` |
| R21 | "Category differs" | "Category may not fit what you do" | `health-signals.js` |
| R22 | "Add a link to your Yelp / Facebook / Instagram / TikTok page ..."; "0 of 3 linked" red | "If you have a ... page, link to it from your website ..."; "0 of 3 linked" amber | `FIXES`, `health-signals.js` |
| R23 | "Not found" on the text rows | "Not on your home page" (all three text rows, so the same word is used) | `health-signals.js` |
| R24 | "Marked closed" for temporarily closed | "Marked temporarily closed" (permanently closed stays "Marked closed") | `health-signals.js` |
| R25 | "... so there is one plain page with your details." | "Claim your free listing on First Answer Pages so customers have one simple page with your details." | `FIXES.listed` |
| R26 | admin trust line "fee paid: yes" for a waived fee | "fee: waived" | `routes/admin.js` |
| R27 | verify page "Pay the fee" / "Done No fee for this listing." / the price hint | heading "The fee", "Done. There is no fee for this listing.", and no price hint when the fee is waived | `routes/verify.js` |

Tests: `health-signals` (R1 every combination, R4 the three cases and the same-page cases, R5 each reason, R16 and R20 labels, R14, R17, and one sweep that no label, reason or fix uses the old words or is over 160 characters), `grade-signals-flow` (R2, R11, R13), `health-compare` (R15), `admin-waive-fee` (R26, R27).

### Older test lines changed by R1 to R27

| Where | Old | New | Why |
|---|---|---|---|
| `test/health-signals.test.js` (title alone) | `saysWhatYouDo.label` `'Not found'` | `'Not on your home page'` | R23 |
| `test/health-signals.test.js` (words in the page itself) | label `'Not found in the page code'` and the one reason | `'Not in the page text'` and the scripts reason | R5 |
| `test/health-signals.test.js` (S16, 1 service page) | `'One page only'` | `'Only one service page'` | R10 |
| `test/health-signals.test.js` (recently updated) | `'Not updated in a year'` | `'Sitemap dates over a year old'` plus the reason | R8 |
| `test/health-signals.test.js` (newest review) | reason `'Based on the reviews Google returned (up to 5).'` | `'Google shows us only a few of your reviews, so you may have a newer one.'` | R16 |
| `test/health-signals.test.js` (open, category) | `CLOSED_TEMPORARILY` label `'Marked closed'`; `'Category differs'` | `'Marked temporarily closed'`; `'Category may not fit what you do'` | R24, R21 |
| `test/health-signals.test.js` (no key; Bing null; S14) | `"Google lookups aren't turned on here."`, `"Bing lookups aren't turned on here."`, the old reserve sentence | `"We didn't check Google this time."`, `"We didn't check Bing this time."`, the new reserve sentence, and the limit sentence pinned | R11, R2, R12 |
| `test/health-signals.test.js` (links) | `'0 of 3 linked'` status `'missing'` | `'partly'` | R22 |
| `test/health-signals.test.js` line 536 (the S3 test, a plain page with no links) | `socials.status` `'missing'`, comment "0 of 3 is a real answer there" | `'partly'`, comment adds "amber since R22, never red" | R22 |
| `test/health-signals.test.js` (listing) | Founding spots status `'partly'`; label `'Differs'` | `'info'`; `"Doesn't match"` | R17, R18 |
| `test/health-signals.test.js` (S13) | the old rating and review label strings | the new ones with "stars", "A review in the last 90 days" and "No review seen from the last 90 days" | R20, R16 |
| `test/health-signals.test.js` (S16 index; U2) | the old index reason; the old U2 sentence | the R9 and R3 sentences | R9, R3 |
| `test/grade-signals-flow.test.js` (no keys; failing lookup; reserve; T6) | `"Google lookups aren't turned on here."`; `"We couldn't reach the lookup this time."`; the old reserve sentence; `"Bing lookups aren't turned on here."` | the R11, R13 and R2 sentences | R11, R13, R2 |
| `test/health-compare.test.js` (T5) | `"A business with your website showed up in another place, ..."` | the R15 sentence | R15 |
| `test/admin-waive-fee.test.js` (S15) | `'No fee for this listing.'` | `'There is no fee for this listing.'`, plus the heading, no price hint and "fee: waived" | R27, R26 |

## Second reader review Q1 to Q8 (review-2026-11-25-step1-reader2.md, verdict GO)

| Item | Old | New | Where |
|---|---|---|---|
| Q1 | "We're almost at today's limit, so we saved the rest for the AI questions and skipped this one." | "Many checks ran today, so we skipped this to leave room for the AI test. Try again tomorrow." | `health-signals.js` (`LOOKUP_RESERVE_REASON`) |
| Q2 | "Today's limit for checks was reached, so we didn't look this up. Try again tomorrow." | "We reached today's limit for Google and Bing searches, so we skipped this. Try again tomorrow." | `health-signals.js` (`LOOKUP_LIMIT_REASON`) |
| Q3 | two wordings: "... in a way this check can't read yet." and "... adds its words with scripts ..." | one wording everywhere: "Your page loads its words in a way some AI tools can't read." | `health-signals.js` (`REASONS.script`, wordsInPage) |
| Q4 | a scripted page always "Not in the page text"; both missing named only the name | a scripted page is "Hard for some AI tools to read" (true even when both were found); both missing: "We couldn't find your business name or phone number in your page's text." | `health-signals.js` |
| Q5 | "No review seen from the last 90 days" | "No review seen in the last 90 days" | `LABELS.newestAmber` |
| Q6 | "... in a different city, so we didn't use it." | "We found a business with your website in a different city than you typed. Check the city and try again." and the same with "your name" | `health-compare.js` |
| Q7 | Facebook fix ended "... so people and AI can connect the two." | "If you have a Facebook page, link to it from your website so customers can find you." (the same ending as Instagram, TikTok and Socials) | `FIXES.linkFacebook` |
| Q8 | "Founding spots still open" had no words around it | handled in Step 2: never a light; a plain line under Free listing: "When we ran this check, Founding Member spots were still open. Listing is free; Founding Members pay once for the optional Verified stamp." (reworded by Step 2 review V3) | `health-map.js` |

### Older test lines changed by Q1 to Q8

| Where | Old | New | Why |
|---|---|---|---|
| `test/health-signals.test.js` (S3, script-built page) | reason "Your page loads its words in a way this check can't read yet." | "Your page loads its words in a way some AI tools can't read." | Q3 |
| `test/health-signals.test.js` (words in the page itself) | label "Not in the page text", reason "... adds its words with scripts ..." | label "Hard for some AI tools to read", the Q3 reason | Q3, Q4 |
| `test/health-signals.test.js` (R5 test) | the scripted reason | the Q3 reason and label, plus a new case for both missing | Q3, Q4 |
| `test/health-signals.test.js` (S13, R16) | "No review seen from the last 90 days" | "No review seen in the last 90 days" | Q5 |
| `test/health-signals.test.js` (S14) | the R2 and R12 sentences | the Q1 and Q2 sentences | Q1, Q2 |
| `test/health-signals.test.js` (links) | `FIXES.linkFacebook` includes "AI" | `FIXES.linkFacebook` is the Q7 sentence (Instagram and TikTok still never mention AI) | Q7 |
| `test/health-signals.test.js` (the old-words sweep) | one scenario passed the R15 sentence | the Q6 sentence; the sweep also bans the replaced Q wordings | Q6 |
| `test/health-compare.test.js` (T5) | the R15 sentence | the Q6 sentence | Q6 |
| `test/grade-signals-flow.test.js` (the reserve test) | the R2 sentence | the Q1 sentence | Q1 |

---

# Step 2 as built: the health map (Requirement 2)

## Files

| File | What it does |
|---|---|
| `server/lib/health-map.js` | `healthModel(grade, { score, aiRows, aiStatus })` works out the seven main nodes, their sub-nodes and statuses once; `healthMapHtml(model, { full, runNew })` writes the section: the plain list first, then the map. `mainStatus`, `linkSvg`, `MAIN_NODES`, `SUB_NODES`, `MAIN_WORDS`, `SYMBOLS`. |
| `server/lib/grade-html.js` | `reportPage` adds the section right under the score block (after the `<h1>`, before "What AI says"), builds the AI answers rows (`aiHealth`) from the report's own answers and `ai-named` row, and loads `/js/health-orb.js` as one more module script. |
| `public/css/style.css` | The "health map" block: the list, the dark map panel, nodes, lines, moving dots, reduced motion and the phone rules. All its colors are custom properties in one place (`.health`). |
| `public/js/health-orb.js` | About 80 lines: a canvas of slowly turning particles behind the still orb. It adds no words; it does nothing with reduced motion or without canvas, stops when motion is switched to reduced, pauses when the tab is hidden, and starts again if the report's content is swapped in place. |

## How it reads

- **The plain list comes first** in the page and holds every fact: for each main node a heading "Website: Partly" and every sub-node "Sitemap: Found", with its reason line when gray, and its fix line only in the full report (the locked report shows the statuses and reasons; the fixes stay behind the lead form like the rest of the fix text). Socials is a cluster heading "Socials: 1 of 3 linked". The Website clusters are "AI can read it", "Speaks AI's language", "Search basics" and "Customer basics".
- **The map** is `aria-hidden` (decoration; the list is what screen readers and search tools read): the orb in the center with the business name (escaped, up to two short lines) and "Health 68", the report's own score from `currentScore`, or "Health: not scored yet". The seven main nodes sit around it in the design's order; each sub-node fans out from its main node. On wide screens the map sits beside the list (sticky); on phones it sits above the list.
- **Color is never the only cue.** Every main node says its name and status word ("Good", "Partly", "Needs work", "Not checked"; the AI answers node says "Pass" for green, as the report's row does). Every sub-node on the map has a status symbol (check, "!", cross, "?") and its short status word along its spoke; the list beside it has the full words. Every list row has the symbol and the words.
- **Links** (CSS only, so they work with JavaScript off): green has small glowing dots moving steadily both ways; amber sends slow dots only partway that fade; red shows a break in the line and no dots; gray is dashed and still. Sub-node links behave the same at a smaller size. With `prefers-reduced-motion`, no dots are drawn and the orb canvas is hidden; the line colors, symbols and words show the status.
- **Phones (390 px):** the map shows the main nodes only (sub-nodes hidden). Each main node is a link to its group in the plain list right below the map (the group is outlined when it is the target), so tapping a node opens its sub-nodes as a list below the map. The list always has every sub-node. Nothing in the section is wider than the screen.
- **Contrast (AA):** the list uses the page's own text colors on the page surface; the map's words use light colors on its near-black panel. A test reads the colors from `style.css` and checks every pair is at least 4.5 to 1.
- **JavaScript off:** the whole section is server HTML and CSS; only the turning particles need the script. No report content is added by JavaScript.
- **Score and SEO:** nothing here is in `results` or the score; the report keeps its `noindex, nofollow` and title. No public page changed.

## Main node status rules (as built)

| Main node | Rule |
|---|---|
| Website | gray when nothing was checked; green when every checked sub-node is green; red when more than half of the checked ones are red; amber otherwise |
| AI answers | the `ai-named` row: "Pass" (named in every counted answer), "Partly" (some), "Needs work" (none), "Not checked" |
| Google profile | red when "Not found on Google"; green when every checked one is green; amber otherwise; gray when nothing was checked |
| Reviews | green when the review count and star rating are green; red when there are no Google reviews and none shown on the website; otherwise green if every checked one is green, amber if not; gray when nothing was checked |
| Details match | red when any checked detail is red; green when all match; amber otherwise; gray when nothing was compared |
| Links | green when every checked link is there; amber otherwise (no link row is ever red); gray when nothing was checked |
| Free listing | green when listed and Verified; amber otherwise; gray when not checked (several listings looked alike) |

## Decisions made while building (for the owner)

1. **AI answers sub-nodes** say "Named you" or "Didn't name you" (with the assistant, "Answer 1 (Claude)"), not the full outcome sentence the design listed. The full sentence is already in "What AI says" right below; repeating it on every row made the report longer and read twice. With no answer, the one row is gray with the reason (today's limit, not connected, or the assistant didn't answer).
2. **HAVE rows that were not checked** (the existing Checks) say "We couldn't check this on your website this time." The existing check's own detail stays in the full list of checks.
3. **Founding Member (Q8):** a Founding Member is a green sub-node. "Founding spots still open" is never a light or a node: it shows only under Free listing in the list as a plain line, "Founding Member spots are still open. Founding Members pay once for the Verified stamp."
4. **"Run a new check"** in a reason is the report's own link to a new check (the report's rule V244: every mention of it is a link).
5. **The section heading** is "Health of your setup" with the line "These lights don't change your score. Each one says what we found, or why we couldn't check it."

## Tests

- `test/health-map.test.js`:
  - The list comes first and the map is aria-hidden, with no logos, icon fonts or scripts.
  - The seven main nodes are in order in the list and on the map, with the same status words and statuses in both.
  - Every sub-node of the design is a list row with its words, and is a map node with the same status.
  - Every row and node has a symbol and words.
  - The orb shows the name (escaped) and the report's score, or "not scored yet".
  - Link drawing: green moves both ways, amber moves slowly partway, red is broken, gray is dashed. Sub-node links behave the same.
  - The CSS: reduced motion stops the dots and hides the orb canvas, phones hide the sub-nodes, nothing is wider than 390 px and there are no outside images.
  - AA contrast for every color pair.
  - The main status rules.
  - Q8.
  - A report from before the signals.
  - Fixes only in the full report.
  - The "Run a new check" link.
  - The wording rules.
  - The orb script adds no words.
- `test/grade-signals-flow.test.js` (a real check through the grader):
  - The section sits under the score and before "What AI says". The orb shows the stored score, and the score is unchanged.
  - The AI answers node reads the report's answers. Google and Facebook rows read the saved signals.
  - The orb script is a module script, and noindex and the title are unchanged.
  - The locked report has no fixes and the full report has them.
  - An old report still shows the map, with "Not checked" rows, links for "Run a new check", and the same score.

No older test line changed for Step 2 as first built.

## Step 2 review fixes (step2-fix-list-2026-11-25.md: V1 to V12, H1 to H13)

Nothing here changes the score or any public page. Every new sentence is 160 characters or less, in American spelling, with no promise that AI will name a business. The one-time "scan" animation the reader review suggested is not built (the owner decides).

| Item | What changed | Where |
|---|---|---|
| V1 | The orb's drawing loop stops for good when its orb leaves the page (`host.isConnected`). A frame already asked for is cancelled before a new one is asked for, so there is never more than one loop. The visibility, motion and on-screen listeners are named and removed in `stop()`. The MutationObserver watches the body, and the new orb starts after an in-place swap. | `public/js/health-orb.js` |
| V2, H4 | The main node words are readable. The wide drawing (viewBox 1000) has bigger nodes (radius 86), names on one or two lines ("Google / profile") and font 24 for the name and status. The map column is wider (`3fr` to `2fr`). Phones get their own main-nodes-only drawing (viewBox 150 150 700 700, radius 86, name 26, status 24) that fills the box. At the narrowest width each drawing is shown at (540 px, and 353 px on a 390 px phone) the words are 12 px or more. A test pins this from `MAP_SIZES`. Font sizes are set on the words, not in the CSS. | `health-map.js`, `style.css` |
| V3, H8 | The Founding note is true at any later time: "When we ran this check, Founding Member spots were still open. Listing is free; Founding Members pay once for the optional Verified stamp." The Free listing node and its rows are information (status `info`): no health color, no fix, a neutral ring and line, and plain words. The node reads "Not started", "Listed" or "Verified". The rows read "Listed on First Answer Pages: Not yet. It's free, claim it below." and "Verified stamp: Available after you claim your listing." | `health-map.js`, `style.css` |
| V4, H3 | Sub-nodes on the map show the symbol and the list's own color only, with no words. The generic words ("Partly" for "Not linked") are gone. `R_SUB` is 14 and the symbol is 20. "Not found" is red everywhere; the amber Bing row now says "Not on Bing Maps yet". **Deviation from 2.2, for the owner to accept:** on the map, sub-nodes are decoration (symbol and color). Their names and status words are in the list beside it, and every main node still says its status in words. | `health-map.js` |
| V5 | The sub-node dots use the main period (dasharray 0.5 26), so the keyframe moves two whole periods and the dots no longer jump. | `style.css` |
| V6 | Off screen (an IntersectionObserver on the section), the orb loop pauses and the CSS dots pause (`.health-paused`). | `health-orb.js`, `style.css` |
| V7 | A red sub-node link breaks from 30% to 70% of its length, so the break shows. | `health-map.js` |
| V8 | The intro test compares with the escaped sentence. | `test/health-map.test.js` |
| V9 | A Website row that was not checked uses the check's own reason. The fallback is "Couldn't check this time. Run a new check later." (H11). The Checks' script-built reason is now the Q3 wording, "Your page loads its words in a way some AI tools can't read." | `health-map.js`, `grade-checks.js` |
| V10 | A report from before these signals shows one note with one link ("This report was made before these checks existed. Run a new check to see them."). The rows say "Made before this check existed." | `health-map.js` |
| V11 | The Socials fix sits under its heading, not inside it. On an old report the gray Socials line has its reason. | `health-map.js` |
| V12 | The scan page loads the orb script too, so the orb turns after a scan finishes in place. | `grade-html.js` (`scanPage`) |
| H1 | The orb shows "Score 69/100" (the report's own score, in its own form), or "Not scored yet". The intro says what the colors mean: "Every check we ran, at a glance. Green is good, amber is part way there, red needs work, gray means we couldn't check it. Your score is at the top of the page." | `health-map.js` |
| H2 | The address rows agree. "Address matches Google" says which side is missing: "We couldn't read a full street address on your website to compare. Write it on one line, like "123 Main St, Nashville, TN 37201"." or "Google doesn't show a street address for you." The listing preview says "Add your street address". | `health-signals.js`, `grade-html.js` |
| H5 | With no AI answer there is no "Answer 1" row. One plain line says why, with the report's own link: "The AI assistant didn't reply this time. Run a new check later to see what it says about you." (or the daily limit, or "The AI check isn't connected yet."). For the contest sample and video, use a run where the AI answered. That is not a code change. | `grade-html.js` (`aiHealth`), `health-map.js` |
| H6 | Plain words first: "Your website lets AI assistants read it (robots.txt)", "Page list for search engines (sitemap)", "A short info file for AI (llms.txt)", "Name, phone and address tagged for AI (business label)", "Search summary (the 2 lines under your link in Google)", "Picture shown when someone shares your link", "One main headline on the page", "On Bing Maps: Not on Bing Maps yet". | `health-map.js` |
| H7 | No row repeats itself: "On Google: Yes", "Category: Fits", "Hours on Google: Listed", "Text AI can read: Yes", "Google links to your site: Yes", "Your website lets AI assistants read it (robots.txt): Yes". The saved signals keep their words; only the list and the map show the short answer. | `health-map.js` |
| H9 | "Your First Answer Pages listing matches your website" and "... links to your website". The list uses the Checks' own names for the customer basics ("Tap-to-call phone number", "Hours on the home page", "Street address on the home page", "Call or book button on the home page"). The Website cluster "Can AI read your website" matches "Score by area". The AI line says "The AI assistant". **Not changed, for the owner:** the Check label "Can AI see your reviews?". An earlier approved review set it, and six existing tests pin it (`review-final-pages`, `grade-reviews-check`, `grade-old-grades`). | `health-map.js` |
| H10 | The "N of M checks need work" line is kept as it is (four tests pin it). A note under it says what it counts: "That counts the scored checks. The lights below show every check, including ones that don't count toward the score." | `grade-html.js`, `style.css` |
| H11 | The reasons speak to the owner: "Add your hours as plain text on your home page and we'll compare them with Google." and "Once you're on Bing Maps, we'll compare your details." The not-checked fallback is H11's own sentence. | `health-signals.js`, `health-map.js` |
| H12 | On phones the map says "Tap a circle to see its checks." Each group in the list has a "Back to the map" link (phones only, out of the tab order). The phone drawing fills its box. | `health-map.js`, `style.css` |
| H13 | The "Fix these first" hours fix says "business hours". | `grade-checks.js` |

### Older test lines changed by the Step 2 review fixes

| Where | Old | New | Why |
|---|---|---|---|
| `test/health-map.test.js` | the first Step 2 tests: intro compared raw, "Health 61", sub-node words, the Free listing as amber, "Answer 1" with no answer, the old reason on every row | rewritten for the fixes above: the escaped intro, "Score 61/100", symbols with no sub-node words, the listing as information, one AI line, one old-report note, readable sizes pinned, no leak in the orb script | V1-V11, H1-H12 |
| `test/grade-signals-flow.test.js` (Step 2 tests) | "Health N"; "Found on Google: Found on Google"; the map div without its id; "Not found in Bing map data"; the old Sitemap row with the long reason and link | "Score N/100"; "On Google: Yes"; `id="health-map"`; "Not on Bing Maps yet"; "Page list for search engines (sitemap): Not checked Made before this check existed." plus one note with the link | H1, H7, H12, H6, V10 |
| `test/health-signals.test.js` (R14 and R15) | "We need a street address on both your website and Google to compare." | "Google doesn't show a street address for you.", plus new lines for the website side, the hours reason and the Bing details reason | H2, H11 |
| `test/grade-reviews-check.test.js` line 98 | "Your page loads its words in a way this check can't read yet." | "Your page loads its words in a way some AI tools can't read." | V9 (Q3) |
| `test/grade-no-storefront.test.js` (F4) | `empty.includes('Add your address')` | `empty.includes('Add your street address')`, and the no-storefront page also never says it | H2 |

### Older test lines changed by T1 to T9

| Where | Old | New | Why |
|---|---|---|---|
| `test/places-lookup.test.js` (Bing: one search) | key not in the address; `subscription-key` header equals the key | `subscription-key` query parameter equals the key; no header | T4 |
| `test/health-signals.test.js` (the S3 test) | all six link rows gray on a script-built page with no links | the three socials and Socials gray; Google and Yelp amber "Not linked" | T7 |
| `test/grade-signals-flow.test.js` (the S5 old-Grade test) | restarted with no lookups | restarted with both lookups on, so the old-report and stale reasons are still shown | T6 |
