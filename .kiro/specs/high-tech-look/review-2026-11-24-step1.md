Verdict: NO-GO

Review of commit cf4145c (health-map Step 1). Tests pass. What is solid: keys stay out of logs and HTML (Places key goes in a header, config is redacted, errors are thrown away), there is one Places call and one Azure call per check, and a recheck reuses both. The score is unchanged (`google-profile` is still notChecked and the signals are not in `results`). Public SEO is unchanged. The fee waiver sits behind `requireAdmin` with the same-origin check and needs the phone and ID steps. The sitemap fetch goes through `safeFetcher` (same SSRF guard, 2 MB cap, timeout, shared deadline). All fix sentences are 160 characters or less. V252, V253, V255 and V256 are done as written. The items below block go-live, mostly because of false reds on real businesses.

## Must-fix

**S1. Business found under a different name is shown red "Not found" (Google and Bing).** `server/lib/health-compare.js:228-231` (`pickCandidate`).
Problem: Google can return results where none matches the typed name by `compareNames`. Examples: "Joe's Plumbing" typed, Google has "Joseph's Plumbing Co". Or a DBA or rebrand. The result is `not_found`, which shows red "Not found on Google" / "Not found on Bing". This is not a "clear no-match" (design.md sub-node 21) and breaks Req 8.2. `test/places-lookup.test.js:97` locks this in. The website domain is only used to break ties, so the strongest evidence is never used on its own.
Fix:
1. Before the name filter: `const domain = registeredDomain(wanted.website); if (domain) { const d = list.filter(c => registeredDomain(c.website) === domain); if (d.length === 1) return { status: 'found', place: d[0] }; }`
2. Change the last line to `return { status: 'unsure', reason: "We couldn't tell which result is your business, so we didn't pick one." };`
3. Keep `not_found` only for `list.length === 0`.
4. Update the test at line 97.

**S2. Red "Not found on Bing" and red "Don't match" from Azure Maps data.** `server/lib/health-signals.js:345-349, 365`.
Problem: Azure Maps POI data (TomTom-based) is not Bing Places. Small service businesses are often missing from it or out of date there even when their Bing Places listing is fine. A red that tells the owner to "Add your business to Bing Places" is often false.
Fix:
- In `bingSignals`, `not_found` becomes `partly('found', 'Not found in Bing map data', FIXES.bingFound)`, or `unknown(...)` if the owner prefers.
- `results.includes('differ')` becomes `partly('details', "Don't match", FIXES.bingDetails)`.
- Never red for Bing. Update the design rows 34 and 35.

**S3. Socials red "0 of 3 linked" (and every link "Not linked") on script-built pages.** `server/lib/health-signals.js:373-394`.
Problem: when `facts.scriptBuilt` is true, the links are usually added by scripts, so "none found" cannot be trusted. That is a false red.
Fix: at the top of `linkSignals`, `if (facts && facts.scriptBuilt && Object.values(detectProfileLinks(facts.links)).every(v => !v))`. In that case return `unknown` for every id and for `socials`, with `REASONS.script`.

**S4. Gzipped sitemap is shown red "Not found".** `server/lib/health-signals.js:137-140`, `server/lib/sitemap-read.js:194-200`.
Problem: a robots.txt `Sitemap: .../sitemap.xml.gz` is served as `application/x-gzip` with no Content-Encoding. The binary body fails the XML test, so the status is red although the sitemap exists.
Fix: in `sitemapSignal`, before parsing, check for gzip. Gzip means `/\.gz$/i.test(sitemap.url)`, or `/gzip/i.test(sitemap.contentType)`, or the text starting with `\x1f�`. If so, return `good('sitemap', 'Found', { url })`, since a .gz the site names in robots.txt and serves with 200 is a sitemap. Or return `unknown('sitemap', "We couldn't read your sitemap this time.")`. Do not return `missing`.

**S5. Raw Google Places data is saved forever and reused on every recheck.** `server/lib/grader.js:1611` and `1968`.
Problems:
- (a) Google Maps Platform terms do not allow storing Places content (name, phone, address, hours, rating) past a short cache window. Only place IDs may be kept.
- (b) A recheck months later reuses the old Google answer and shows it as current. For example, it can say "Phone matches Google" after the owner has changed the number.

Fix:
- Do not save `g.profiles`. Save only `g.signals` plus `g.profilesAt = nowIso()`.
- On recheck, rebuild the Google and Bing parts only when `now - profilesAt <= 30 days`. To do that, keep the reduced place in memory or in a TTL'd field that is purged after 30 days. Otherwise set those parts to `unknown(id, 'Run a new check to look on Google again.')`.
- At minimum, purge `g.profiles` after 30 days and stop reusing it after that.

**S6. Silent all-gray risk: confirm both outside APIs with one real call before go-live.** `server/lib/places.js:18-22`, `server/lib/azure-maps.js:105,135-137`.
- Places: make sure the nested mask `places.reviews.publishTime` is accepted by `places:searchText`. If Google rejects the mask with 400, every check is "Not checked" and no test catches it. If it is rejected, use `places.reviews` (same SKU). Note that asking for reviews puts every call on the Enterprise + Atmosphere price.
- Azure: make sure `search/poi/json?api-version=1.0` still answers (Microsoft has been retiring Search v1). If it does not, move to the current API version or drop G2/A6.
- Add a one-line admin "lookup health" count (ok/error per day, no key, no body). An all-error day then shows up.

## Low

**S7. The 5-second limit is really up to 10 seconds.** `server/lib/places.js:74,81`, `server/lib/azure-maps.js:47,49`: `fetch` and `res.json()` each get their own 5 s timer. Fix: start one timer, `const deadline = Date.now() + timeoutMs`, and pass `deadline - Date.now()` to the second `withTimeout`.

**S8. Azure key in the query string.** `server/lib/azure-maps.js:136`: the key is not logged today, but any future error log or proxy log of the URL would leak it. Fix: send it as a `subscription-key` request header instead, and add `countrySet: 'US'` (the form is US-only).

**S9. "Answers common questions" is red when the FAQ is on its own page.** `server/lib/health-signals.js:477`: a home page that links to `/faq` gets "Not found". Fix: also return found when `facts.links.some(l => /\bfaqs?\b|questions/i.test(\`${l.href} ${l.text}\`))`.

**S10. New-style Facebook page links are not recognized.** `server/lib/profile-links.js:85-91`: `facebook.com/p/Business-Name-1000.../` fails the `{3,}` test and shows "Not linked". Fix: `if (first === 'p') return seg.length >= 2;` before the set check.

**S11. E3 misses names written with "and" or with legal words.** `server/lib/health-signals.js:151`: the typed name is stripped of "and", "the" and "LLC" but the page text is not. "Smith and Sons Plumbing" on the page then reads as "Not found in the page code" (amber). Fix: compare `nameTokens(input.name).join(' ')` against `nameTokens(text).join(' ')`.

**S12. Two address cases give a false red.** `server/lib/health-compare.js:103`: `addressParts` takes the first number, so "Suite 200, 123 Main St" reads 200 as the street number. "123 N Main St" against "123 Main St" is also red "Doesn't match". Fix:
- Skip a number right after `ste`, `suite`, `apt` or `#`.
- Treat a difference of only a direction word (n, s, e, w) as `close`.

**S13. Labels have the numbers written in.** `server/lib/health-signals.js:276-283`: '10 or more reviews', '4.3 or higher' and '3.8 to 4.2' do not follow `health-constants.js`. Fix: build the labels from `REVIEW_COUNT_GREEN`, `RATING_GREEN` and `RATING_AMBER`, as Req 3.4 asks.

**S14. Reason lines that are not true.**
- `server/lib/grader.js:1409` and `health-signals.js:222`: "Today's limit for AI questions was reached" is shown even when only the reserve of 12 calls is held back. Fix: "We kept today's last lookups for new checks, so we didn't look this up."
- `grader.js:1968`: a recheck of a Grade saved before this step says "Google lookups aren't turned on here." Fix: pass `REASONS.oldReport` when `g.profiles` is missing.

**S15. The owner's own verify page says "Fee paid" after a waiver.** `server/routes/verify.js:76`: a waived listing shows "Fee paid. One time, nothing more to pay." Fix: when `status.waived`, show "No fee for this listing." The same file at `:229` (`lockedByMode`) locks a waived listing in Stripe test mode. Fine for production; add a note in the design.

**S16. "One page only" can be wrong.** `server/lib/health-signals.js:203`: the label shows when 0 service pages were seen, and also when the sitemap is an index (its `locs` are child sitemaps, not pages). Fix:
- Use the label "No separate service pages found" when count is 0.
- When `sitemapInfo.isIndex` and no page links matched, return `unknown`.

**S17. V257 and V254 are close but not exact.** `server/lib/grade-html.js:966` copies the askAgain sentence instead of using one shared constant. Fix: move `askAgain` above the early return and use it in both places. The V254 regex at `test/grade-lead.test.js:597` allows four outcomes. Pin the one the stub gives, as line 540 does.
