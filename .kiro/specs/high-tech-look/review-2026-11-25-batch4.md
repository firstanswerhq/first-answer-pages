Verdict: NO-GO

Review of HEAD 650074e on kiro-rebuild-grader ("Built by Kiro: receipts test updates + batch4 Y1-Y7"). It covers Requirement 9, the receipts in server/lib/mcp.js (`git diff 92d1764..HEAD -- server/lib/mcp.js test/mcp-receipts.test.js`), and the batch 4 fixes Y1-Y7 (`git diff 58ea797..HEAD`). I changed no code.

## What I ran
- `npm test`: 1862/1862 pass.
- A Node probe of `handleRpc` on a temporary store with these cases:
  - a business-confirmed and Verified listing, with extra private-looking keys on the listing, and a trust record holding `stripeCustomer`, a phone `code`, an identity `ref` and `dob`
  - a listing whose verified.json value is unreadable
  - a search, and an unknown id
  - `tools/list`
- A Node probe of `sitesUsed`, `sitesSection`, `isGoogleProfileUrl` and `reportCsvFor`, with a Facebook-page business (input from `normalizeGradeInput`, so `websitePage` is real), competitor pages, the own page on `m.` with a trailing slash, an own domain, Google support, search and Maps pages, and empty answers.
- Playwright (Chromium) on the rendered Riverbend report and print page, served at :8765:
  - The print page: which requests it makes, the map score under print media, and the scan module injected by force.
  - The normal report: the scan mid-play, then `beforeprint`.
  - The Y6 swap of `main` before the map was seen, then a second swap after the scan played.

## Requirement 9 (receipts): passes
- **9.1:**
  - Each listing has `receipts` for phone, hours, services, area and website: `{ lastConfirmed, confirmedBy }`.
  - "business" comes with the stored `verifiedAt`, or with the plain stored date for the legacy record.
  - The phone uses the Verified check's stored time with "First Answer phone and ID check".
  - A field the listing doesn't have, an unconfirmed listing, or an unreadable stored date gives `null`/`null`. No date is ever made up: `storedDate` only passes a stored string through, and `fetchedAt` is never used as a confirmation date.
- **9.2:** `fetchedAt` (ISO, from the app clock) is on every successful search and get, including an empty search. The "Listing not found" error doesn't have it (Z4).
- **9.3:**
  - `verifiedCheck` is `{ checkedBy, checkedAt }` or `null`. Practice runs, unpaid listings, a changed phone number and an ID name mismatch all give `null` (trust.js `trustStatus`).
  - The owner confirmation keeps its `verifiedDate` and adds `confirmedBy: "business"` and `label: "Details confirmed by the business"`.
- **Free:** both lookup descriptions start with "Free: there is no charge for this lookup." `request_quote` isn't a lookup and is unchanged.
- **Privacy:** only `verifiedAt` is read from the trust status. None of the probe's trust fields (`stripeCustomer`, the phone code, identity `ref`, `dob`, paid or waived state) appear in the output. `ownerEmail` is still stripped by `publicListing`. The listing body is the same pre-existing `publicListing` copy, so nothing new is exposed.
- **Schema:** no tool declares an `outputSchema`. `structuredContent` is still a plain object, and `content[0].text` is its JSON. Old shapes are kept: the unconfirmed `verification` is unchanged, and the new keys are only additions.
- **Public pages:** llms.txt, JSON-LD, the sitemap and public pages are unchanged. No file outside mcp.js changed for Requirement 9, and the tool descriptions appear on no public page.
- **Tests:** the two older test edits (listing-website.test.js:236 and production-samples.test.js:206) are in the design.md table and still check the same thing.

## Batch 4 Y1-Y7

| Item | Status | Notes |
|---|---|---|
| Y1 | **Partly fixed** | A competitor's Facebook page alone is no longer marked, and a bare facebook.com home page isn't either. But the business's own page and the competitors' pages share one row: see Z1. |
| Y2 | Fixed | See the details after this table. |
| Y3 | Fixed, with one hole | support.google.com and google.com/search no longer count. Maps, `business.`, `g.page`, `maps.app.goo.gl` and google.co.uk/maps do. `google.evil.com/maps` also counts (Z2). |
| Y4 | Fixed | Answers with empty or whitespace-only text are left out of the CSV. The probe gives 1 CSV answer row, and share of voice has a total of 1. |
| Y5 | Kept (owner decision) | It is in the design.md table. |
| Y6 | Fixed | After swapping `main` before scrolling, the new map scans and ends at "Score 68/100". After a second swap once the scan has played, it doesn't play again. |
| Y7 | Fixed | It is a row in the design.md deviations table. |

**Y2 details:**
- The print page makes no request for health-scan.js, and its map says "Score 68/100" under print media.
- When I injected the module into the print page by force, the `.grade-print` guard stopped the scan.
- On the normal report, `beforeprint` during the scan took the score from "Score 17/100" to "Score 68/100" at once.

## Items

### Z1. The "(your website)" label still covers competitors' pages on a shared host (must-fix)
- **Where:** server/lib/agency-report.js:104-107 (one row per registered domain, with `row.own` set when any source is own), and server/lib/grade-html.js:1217 (the row links to `r.url`, the first source seen).
- **Problem:** take a business whose website is its Facebook page, with three answers citing facebook.com/MapleStreetPipe, facebook.com/HollowCreek and facebook.com/RiverbendPlumbing (its own page). The page renders this:
  `<a href="https://www.facebook.com/MapleStreetPipe">facebook.com</a>: cited in 3 answers <strong>(your website)</strong>`
  - The link is a competitor's page.
  - The count includes two competitor answers.
  - The label is applied to the whole facebook.com row.

  Y1 asked for "(your website)" only on the business's own page. This is still a false claim in the client PDF whenever the own page and a competitor's page are both cited, which is likely for Facebook-page businesses.
- **Fix:**
  - In `sitesUsed`, when the website is on a shared host (`SHARED_DOMAINS.has(registeredDomain(input.website))`) and `ownSource(input, s.url)` is true, put that source in its own row instead of the domain row. Use the key `pageKey(s.url)`, the domain shown as that page (for example `facebook.com/riverbendplumbing`), `url: s.url` and `own: true`, counted once per answer.
  - Every other source on that host stays in the plain `facebook.com` row, with `own: false`.
  - For an own (non-shared) domain, keep today's per-domain row.
  - The Facebook gap line should keep counting the answers that cited any facebook.com page: count them separately, as Y3 does for Google.
  - Add a test with the three answers above. Expect a `facebook.com` row with count 2 and own false, linked to a competitor page, and a `facebook.com/riverbendplumbing` row with count 1, own true, linked to the own page.

### Z2. `isGoogleProfileUrl` accepts any host that starts with "google." (low)
- **Where:** server/lib/agency-report.js:71 (`/^google\.[a-z.]+$/`).
- **Problem:** `https://google.evil.com/maps` returns true, so it would count toward "AI read Google for N answers". The sources come from AI answers, so the impact is small, but the check is wrong.
- **Fix:** require the registered domain to be a Google one, for example `/^google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host)`, or `registeredDomain(url)` matching that same pattern. Add `google.evil.com/maps` to the Y3 test as false.

### Z3. Search results carry an `hours` receipt but no hours (low)
- **Where:** server/lib/mcp.js:196-214 (`summarize` returns no `hours`), and :213 (`receipts: receiptsFor(...)` includes `hours`).
- **Problem:** 9.1 says a receipt is for "each field it returns". `search_listings` gives a dated `hours` receipt for a field that isn't in the answer. An agent may read this as hours being confirmed and look for them.
- **Fix:** either add `hours` to `summarize` (the same filled-days form as `get_listing`, lines 265-266), or drop `hours` from the search receipts (`receiptsFor(..., { fields: RECEIPT_FIELDS.filter(f => f !== 'hours') })`) and change the search description to match. Add a test that every receipt key in a search listing has a matching field.

### Z4. "Listing not found" has no fetchedAt (low)
- **Where:** server/lib/mcp.js:252 (`toolFailure('Listing not found')`).
- **Problem:** 9.2 says "every lookup answer includes fetchedAt". The not-found answer is a lookup answer, and it has only text.
- **Fix:** return `{ content: [{ type: 'text', text: 'Listing not found' }], structuredContent: { error: 'Listing not found', fetchedAt }, isError: true }`, or put fetchedAt in the text. Add a test.

### Z5. An unreadable stored confirmation date still says "verified: true" with that string as the date (low)
- **Where:** server/lib/mcp.js:254-261.
- **Problem:** when verified.json holds a value that isn't a date (probe: `"garbage"`), `verification` is `{ verified: true, verifiedDate: "garbage", confirmedBy: "business", label: ... }`, while all its receipts are null. 9.3 says "Verified" only with who and when, and here the "when" can't be read. This needs a hand-edited or corrupt file, so it is rare.
- **Fix:** treat `v` as confirmed only when `storedDate(v.verifiedDate)` is not null. Otherwise return the unconfirmed shape. Add a test with an unreadable date.

## Notes (no change needed)
- The phone receipt uses the Verified check's time even if an owner confirmation is newer. Today that can't happen, because confirmation happens at publish and the check comes after it. If listings later become editable after publish, pick the later of the two times.
- The receipt dates come in two forms: a full ISO time (`verifiedAt`, `checkedAt`) and a plain date for the legacy record. This is as stored, which 9.1 requires.
