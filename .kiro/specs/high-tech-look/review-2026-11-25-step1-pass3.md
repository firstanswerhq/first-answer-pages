Verdict: GO

Third-pass review of 28a0ab7 (diff vs 8c78514), checked in the code and with small node scripts, not only the tests. Tests: 1773/1773. No must-fix item is left. The two go-live steps (one real Places call, one real Azure call) are still open, as the design says. The score is unchanged (`grade-checks.js` and `grade-score.js` are not in the diff, and `SKIP_DOMAINS` is unchanged, only exported). Public SEO is unchanged: no route, public page, sitemap, robots or JSON-LD code is in the diff. No S1-S17 fix is undone.

## T1 to T9

| Item | State | Where | Checked how |
|---|---|---|---|
| T1 | Fixed | `name-match.js:366-380`, `health-compare.js:245, 260`, `grader.js:1510` | Script: typed "Joe Plumbing", website `facebook.com/joeplumbing`, Nashville; the only result is "Bob Smith Roofing" with `facebook.com/bobsmithroofing`. The result is `unsure`, so nothing is picked. With the right business added, the name rule finds it. wixsite, business.site, square.site, linktr.ee, canva.site, sites.google.com, carrd.co, webflow.io and m.facebook.com are never proof. Some hosts are not on the list (U1). |
| T2 | Fixed | `health-signals.js:291-318` | Script: typed "Joes Plumbing", Google "Josephs Plumbing Co", the page shows neither name. The result is gray. Red only when the schema label differs. One reason sentence is wrong (U2). |
| T3 | Fixed | `health-signals.js:589-601`, `grader.js:1540, 1479-1490, 2053` | Ran a full check with the real `createPlacesLookup` and `createBingLookup` on a fake `fetch`. The data had a mismatched phone, address and name, rating 3.7, 41 reviews, a review date and review text, plus a mismatched Bing phone and address. None of these values is in any file in the data folder. Saved signals keep only the status, label, fix, reason and the website's side. Recheck and purge are covered by tests. Expired entries can stay in memory (U4). |
| T4 | Fixed in code; go-live call still open | `azure-maps.js:50-53, 65-67` | Script: the key is the `subscription-key` query parameter, with no header. The fake `fetch` threw an error holding the full URL, then gave a 401 whose body holds the URL. Both give "We couldn't reach Bing this time." The key is not in the console, stdout, stderr, `grades.json` or other data files, or the saved signals. Nothing in `server/` replaces the global fetch or logs URLs. |
| T5 | Fixed | `health-compare.js:246-258` | Script: Franklin typed, a Franklin "Joes Plumbing" with no website, and a Nashville result with joes.com. The Franklin result is found. With no name match in Franklin, the "another place" reason is given. |
| T6 | Fixed | `grader.js:1461-1467` | Code and test: with no key, the lookup is `{ status: 'off' }`, so the reason is "... lookups aren't turned on here." |
| T7 | Fixed | `health-signals.js:456-466` | Code: only the three socials and Socials are gray. Google and Yelp are read as usual. |
| T8 | Fixed as asked, but it brings a new false red | `health-signals.js:189-193` | "Questions? Call us" on `/contact` no longer counts. See U3. |
| T9 | Fixed | `health-signals.js:160-164, 551-556` | Script: a `.xml.gz` address whose text is XML gives "Found", and "Updated in the last 12 months" comes from its lastmod. Binary text still gives "Found" (gzip). |

## New items

**U1. Low. Some shared hosts are not in `SHARED_DOMAINS`.** `name-match.js:366-370`.
Problem: `myshopify.com`, `blogspot.com`, `netlify.app`, `github.io`, `mystrikingly.com`, `wixstudio.io` and `g.page` still count as proof (`sameSite` gave true in the script). The name rule no longer guards these cases. A wrong pick is less likely than with Facebook pages, but it can still happen.
Fix: add `'myshopify.com', 'blogspot.com', 'netlify.app', 'vercel.app', 'github.io', 'mystrikingly.com', 'wixstudio.io', 'g.page', 'jimdosite.com', 'yolasite.com', 'webnode.com'` to `SHARED_DOMAINS`. Add one test row each. The entries `my.canva.site` and `sites.google.com` can never match, because `registeredDomain` shortens them. They do no harm.

**U2. Low. The gray name reason is wrong when the page does show the typed name.** `health-signals.js:316`.
Problem: there is no schema label, the page shows "Joes Plumbing", and Google says "Josephs Plumbing Co" (`differ`). The row says "We couldn't find your business name written on your website.", but the name is on the page.
Fix: `if (!label) return unknown('nameMatch', "The name on your website and the name on Google look different, so we didn't mark it.");` That sentence is 87 characters. Keep `notFound` for line 309 only.

**U3. Low. T8 makes some real FAQ links red "Not found".** `health-signals.js:192`.
Problem: before T8 these were green. Now these are `missing` (red): `href="/frequently-asked-questions"` (hyphens, not whitespace), `/common-questions`, the text "Questions & Answers", and "Q&A". This happens only when `facts.faq` is not set from headings.
Fix: `/\bfaqs?\b|(?:common|frequently[\s-]+asked)[\s-]+questions|\/questions\b|questions\s*(?:&|and)\s*answers|\bq\s*&\s*a\b/i`. Add the four cases above as tests, and keep the "Questions? Call us" test.

**U4. Low. Expired lookups can stay in memory longer than 30 days.** `grader.js:1446-1460`.
Problem: an entry older than `LOOKUP_KEEP_MS` is removed only when that Grade is rechecked, or when the map grows past 2,000 entries. On a quiet server, raw Google values can sit in memory past 30 days.
Fix: in `keepLookups`, before the size loop, add `for (const [id, v] of recentLookups) { if (clock.now() - v.at > LOOKUP_KEEP_MS) recentLookups.delete(id); else break; }`. The map is in time order, because each entry is deleted and set again.

**U5. Low. "Links to your website" can be a false green on a shared host.** `health-signals.js:401`.
Problem: the comparison is by registered domain only. Website `facebook.com/joeplumbing` and a Google profile linking `facebook.com/someoneelse` show green.
Fix: when `SHARED_DOMAINS.has(registeredDomain(input.website))`, compare host plus the first path segment, lowercased and without `www.` and `m.`. Otherwise keep the domain test.

## Wording

The new sentences are each 160 characters or less, in American spelling and plain words, and none promises that AI will name a business. They are: "We couldn't find your business name written on your website.", "A business with your website showed up in another place, so we didn't count it.", "Google lookups aren't turned on here." and "Bing lookups aren't turned on here." (on a recheck), and the U2 replacement. U2 is a problem of accuracy, not of length or spelling.
