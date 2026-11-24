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
2. `Sitemap` (E2, ADD, Requirement 3.9): green "Found" / red "Not found" / gray "Not checked"
3. `Words are in the page itself` (E3, ADD): green "Found in the page" / amber "Not found in the page code", never red, because a page built by scripts cannot be told apart from a page that is missing the words; the reason line is "Your name and phone weren't in the page's own text. Some AI tools can't read text added by scripts." / gray "Not checked" only when the page could not be read
4. `Business label` (E4, HAVE, `business-labeled`): green "Found" / red "Not found" / gray "Not checked"

**Cluster "Speaks AI's language"** (Requirement 3.11 and checklist D)
5. `Says what you do` (D1, ADD): green "Found" / red "Not found" / gray "Not checked"
6. `Says where you work` (D2, ADD): green "Found" / red "Not found" / gray "Not checked"
7. `Answers common questions` (D3, ADD): green "Found" / red "Not found" / gray "Not checked"
8. `A page for each service` (D4, ADD): green "Several service pages" / amber "One page only" / gray "Not checked" (no sitemap and too few links to tell)
9. `Recently updated` (D5, ADD): green "Updated in the last 12 months" / amber "Not updated in a year" / gray "Not checked" (no dates in the sitemap)
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
21. `Found on Google` (B1): green "Found on Google" / red "Not found on Google" (only on a clear no-match) / gray "Not checked" (no key, lookup failed or timed out, or several close results and no clear match)
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
31. `Name matches Google` (A3, KEY): green "Matches" / amber "Close, not the same" / red "Doesn't match" / gray "Not checked"
32. `Hours match Google` (A4, KEY): green "Match" / amber "Some days differ" / red "Don't match" / gray "Not checked" (either side not readable)
33. `Your listing matches your website` (A5, ADD): green "Matches" / amber "Differs" / gray "Not checked" (no listing yet)
34. `Found on Bing` (G2, KEY, `AZURE_MAPS_KEY`): green "Found on Bing" / red "Not found on Bing" (only on a clear no-match) / gray "Not checked"
35. `Details match on Bing` (A6, KEY, same Azure search as 34): green "Match" / amber "Close, not the same" / red "Don't match" / gray "Not checked"

### 6. Links
36. `Website links to your Google profile` (F1, ADD): green "Linked from your website" / amber "Not linked" / gray "Not checked"
37. `Website links to Yelp` (F3, ADD, Requirement 3.1): green "Linked from your website" / amber "Not linked" / gray "Not checked"
38. `Google profile links to your website` (F2 and B5, KEY): green "Links to your website" / amber "Doesn't link to your website" / gray "Not checked"
39. `Your listing links to your website` (F5, HAVE): green "Linked" / amber "No website on the listing" / gray "Not checked" (no listing)

**Cluster "Socials"** (F4, ADD, Requirement 3.1 and 2.6 item 7): the cluster shows "2 of 3 linked" and is green at 3, amber at 1 or 2, red at 0, gray when the site could not be read. Facebook first.
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

`grade.profiles` is what the two lookups returned (`{ places, bing }`, each `{ status, place?, reason? }` with no key in it), and `grade.signals` is the object `buildSignals` made: `website`, `google`, `bing`, `links` and `listing`, each signal `{ id, status, label, reason?, fix?, ... }`. `status` is `good`, `partly`, `missing` or `not_checked`. A recheck reads the website again, rebuilds the signals from the saved lookups and makes no second paid lookup. A Grade saved before this step has neither field; `signalRows` then gives every row "Not checked" with the reason "This report was made before this check existed. Run a new check to see it."

## The rules that were built

- **Never a false red.** `missing` is only for when the check looked and it is truly not there. A lookup that is off, failed, timed out, hit the daily limit or found several close results gives gray "Not checked" with a reason, for every Google or Bing signal at once. A near match is amber, never red. The newest-review signal is amber (never red) and says it is based on the up to 5 reviews Google returned.
- **One Google lookup, one Bing search.** Each counts as one paid call from the Grader's daily share, and, like a second opinion, never uses the day's last 12 calls (they stay for the AI question of a new check). Each is skipped without its key (`GOOGLE_PLACES_API_KEY`, `AZURE_MAPS_KEY`) and in test runs.
- **Picking the business.** A result counts when its name matches or nearly matches (case, punctuation, LLC and Inc ignored, a small typo allowed) and it is in the typed city. Several that do are narrowed by the website's domain, then by an exact name; if more than one is left, nothing is picked ("unsure", gray). The right name in another city is "unsure", never "not found". "Not found" only when Google answered and nothing looked like the business.
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
