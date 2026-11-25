Verdict: NO-GO

Second-pass review of 7e0ec0c and 12b0c9f (diff vs 6bdae28), checked against the code itself, not only the tests. The S1 to S17 fixes are done as asked. What still holds from pass 1: keys stay out of logs, HTML, errors and URLs; one Places call and one Azure call per check, and none on a recheck; a 5 s limit on each lookup; the score is unchanged (the signals are not in `results`, and `grade-checks.js` is untouched); public SEO is unchanged (no public route, JSON-LD, sitemap.xml, robots.txt or noindex code is in the diff); the fee waiver is admin-only, with the phone and ID steps still required. Four new items block go-live: T1 to T4.

## S1 to S17

| Item | State | Where | Note |
|---|---|---|---|
| S1 | Fixed | `health-compare.js:243-252, 267-268` | Domain tried first; `not_found` only for an empty list. But the fix brings in T1 and T5. |
| S2 | Fixed | `health-signals.js:391-396, 411` | Bing is never red. |
| S3 | Fixed | `health-signals.js:431-435` | As asked. The leftover case is in T7. |
| S4 | Fixed | `sitemap-read.js:40-44`, `health-signals.js:161, 247, 521` | |
| S5 | Fixed as asked | `grader.js:1680-1683, 2040-2041, 1455-1486` | `profiles` is no longer saved; memory keeps it 30 days at most and 2,000 entries; old Grades are purged. The saved `signals` still carry raw Google values (T3). |
| S6 | Partly | `places.js:18-24`, `grader.js:1434-1440`, `grade-guard.js:151-153`, `grade-admin.js:68-73` | Mask and daily count are done. The real-call check is still a go-live step. The docs check below raises T4. |
| S7 | Fixed | `places.js:77-87`, `azure-maps.js:148-153` | One timer covers the request and the body. `Promise.race` handles a late rejection. |
| S8 | Fixed as asked, see T4 | `azure-maps.js:144-149` | The key moved to a header and `countrySet=US` was added. The v1.0 docs list the key as a query parameter only. |
| S9 | Fixed | `health-signals.js:188-191, 532` | The test is a bit loose (T8). |
| S10 | Fixed | `profile-links.js:57` | |
| S11 | Fixed | `health-signals.js:175-177` | |
| S12 | Fixed | `health-compare.js:96-160` | Tried by hand: "Suite 200, 123 Main St" and "123 N Main St" against "123 Main St" now work. |
| S13 | Fixed | `health-signals.js:54-62, 317-330` | |
| S14 | Fixed | `grader.js:1414-1415, 1460-1463`, `health-signals.js:42-43, 260-266` | Small leftover wording problem in T6. |
| S15 | Fixed | `verify.js:73-75`; the design notes `lockedByMode` | |
| S16 | Fixed | `health-signals.js:219, 228-242` | |
| S17 | Fixed | `grade-html.js:965, 967, 982, 984`; V254 test pinned | |

## New items

**T1. Must-fix. A shared platform domain picks the wrong business, which gives false reds.** `health-compare.js:244-251` (the domain-first step, S1) and `:257-259`.
Problem: `registeredDomain` turns `facebook.com/joesplumbing`, `joes.wixsite.com`, `square.site` and the like into `facebook.com` or `wixsite.com`. Many small businesses give their Facebook page as their website, and many Google profiles do too. Tried by hand: typed "Joe Plumbing", website `facebook.com/joeplumbing`, Nashville. Google returns "Bob Smith Roofing" (website `facebook.com/bobsmithroofing`, Nashville). The result is `found` Bob Smith Roofing, so Phone, Address and Name show red "Doesn't match", and Category and Reviews describe another business.
Fix: export `SKIP_DOMAINS` from `name-match.js` (add `business.site`, `square.site`, `linktr.ee`, `carrd.co`, `my.canva.site`, `sites.google.com`). Add a helper `sameSite(a, b)`: false when `registeredDomain(a)` is in `SKIP_DOMAINS`, otherwise compare the registered domains. Use it at `:246` and `:258`, and at the same check in `grader.js` `listingInfoFor`. For the domain-first step, a shared domain is never evidence. Add tests for a Facebook website and a wixsite website.

**T2. Must-fix. A typed name that Google spells differently is red "Doesn't match", even when the website was never read.** `health-signals.js:353-359`.
Problem: `siteName = facts?.jsonLd?.business?.name || input.name`. Without a schema name, the form's typed name is compared and shown as `website:`. With S1, Google results are now picked by domain whatever their name, so this happens more often. Tried by hand: typed "Joes Plumbing", Google "Josephs Plumbing Co", page text without either name. The result is red, and a judge's nickname or typo (Req 8.1) is reported as the website's name.
Fix:
1. Check the page text by tokens, as S11 does: `nm = 'match'` when `` ` ${nameTokens(facts.text).join(' ')} `.includes(` ${nameTokens(p.name).join(' ')} `) ``.
2. When there is no `jsonLd` name and `nm === 'differ'`, return `unknown('nameMatch', "We couldn't find your business name written on your website.")`.
3. Keep red only when the website's own label (`jsonLd` name) differs from Google's.

**T3. Must-fix. Raw Google values are still saved with every Grade, with no time limit.** `health-signals.js:317-324, 328-331, 342, 350-351, 358-359`, saved at `grader.js:1683` and `:2040`.
Problem: the saved signals hold `google:` phone, address and name on a mismatch, `rating`, `count` and `newest`. These are Places content and are kept forever. The design's "Open point" admits this. The owner's rule and Google's terms do not allow keeping them past 30 days.
Fix: before saving, run `g.signals = withoutGoogleValues(signals)`. It deletes `google`, `rating`, `count` and `newest` from every `signals.google.*` and `signals.bing.*` entry, and keeps `website`, the labels and the statuses. Step 2 then reads the Google side only from the in-memory copy kept for 30 days (`recentLookups`), or shows nothing. Add a test that no Google value appears in `grades.json`, for the mismatch fixtures too.

**T4. Must-fix before go-live. The Azure key header is not documented for Search v1.0.** `azure-maps.js:149`.
Problem: Microsoft's Get Search POI (api-version 1.0) reference and its Shared Key section list `subscription-key` only as a **query** parameter ("add the subscription key as a parameter to the URL"). If the gateway refuses the header, every Bing lookup is a 401, so every Bing row is gray. That is not a false red, and the admin line will show it, but G2 and A6 would never work.
Fix: make the one real call (design "Before go-live") with the header. If it returns 401, put `subscription-key` back in the query string, and make sure the URL is never logged: the `catch` already drops the error, so keep it that way. Also record that Search v1 is "superseded by 2026-01-01" with no retirement date yet, and that the 2026-01-01 API has no POI search.

**T5. Low. The domain-first "unsure" skips a clear name and city match.** `health-compare.js:247-251`.
Problem: if the one result with the website's domain is in another city, the function returns `unsure` at once. It does not fall through to the name rule. Tried by hand: typed Franklin, the Franklin result "Joes Plumbing" has no website, and the Nashville result has joes.com. Before the fix this was found; now it is gray.
Fix: in another city, fall through to the name rule; only return that reason when the name rule also finds nothing in the typed city.

**T6. Low. A wrong reason after a restart when a lookup is off.** `grader.js:1455-1465`.
Problem: after a restart, a recheck says "Run a new check to look on Google again." even when `placesLookup` or `bingLookup` is null (no key). A new check would not look either.
Fix: `places: placesLookup ? { status: 'off', reason: STALE_GOOGLE_REASON } : { status: 'off' }`, and the same for Bing.

**T7. Low. A page built by scripts with only a Google or Yelp link shows Socials red "0 of 3 linked".** `health-signals.js:431`.
Fix: test only the three social ids: `facts.scriptBuilt && ['facebook','instagram','tiktok'].every(id => !links[id])` makes those three and `socials` gray. Google and Yelp are read as usual.

**T8. Low. "Answers common questions" can be a false green.** `health-signals.js:190`: link text such as "Questions? Call us" pointing to `/contact` counts.
Fix: `/\bfaqs?\b|(?:common|frequently asked)\s+questions|\/questions\b/i`.

**T9. Low. A `.xml.gz` address that the safe fetcher already unpacked is not read.** `sitemap-read.js:41`: the URL test wins even when `text` is already XML (sent with `Content-Encoding: gzip`), so "Recently updated" is gray for no reason.
Fix: in `sitemapSignal` and `buildSignals`, run `parseSitemap` first, and use `isGzipSitemap` only when the reply is not XML.

## Outside APIs (item 3)

- **Places API (New):** confirmed from Google's Place Data Fields (New) page. All ten names exist (`displayName`, `formattedAddress`, `nationalPhoneNumber`, `websiteUri`, `regularOpeningHours`, `businessStatus`, `primaryType`, `rating`, `userRatingCount`, `reviews`). `reviews` is on the Text Search Enterprise + Atmosphere SKU. Google's "Choose fields" page shows nested paths such as `places.displayName.text` are allowed, so the old nested mask was probably fine too. `places.reviews` is valid. Not confirmed: a live 200, since I made no real call.
- **Azure Maps:** confirmed that `GET /search/poi/json?api-version=1.0` with `query`, `limit` (1-100) and `countrySet` is documented, with no deprecation notice on the operation. The migration page says Search v1 is superseded by 2026-01-01 and still works, with no date given. A header `subscription-key` is **not** documented for v1.0 (T4). Not confirmed: that the header works in practice.

## Wording (item 4)

The new sentences are each 160 characters or less, in American spelling and plain words, and make no promise that AI will name a business. They are: the S1 reasons, "Not found in Bing map data", the new `bingFound` fix, the sitemap index and compressed reasons, "No separate service pages found", the reserve and stale reasons, "No fee for this listing.", and the admin "Lookups today" line.
