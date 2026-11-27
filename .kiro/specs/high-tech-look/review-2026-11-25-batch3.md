Verdict: NO-GO

Code review of commit d529ad4 (Kiro, WIP): the Step 2 J/W fixes, Requirement 2.10 (one-time scan), 11 (fair use) and 12 (website still alive). Diff: `git diff 6888ea1..d529ad4 -- server public test README.md`. I changed no code.

## What I ran
- `npm test`: 1829/1834. The 5 failures are the ones already sent back (README GRADE_AI_REPEAT_DAYS, grade-fair-use.test.js:110 Facebook pages, phone font 12.0 px, J6 SPEAKS_NOTE markup, MAP_INTRO sentence length). They are not repeated below.
- I re-rendered the Riverbend sample from d529ad4 and served it with the real `/css` and `/js`. Then I ran Playwright and Chromium at 1280x900, 1440x800, 390x844 and 360x740, with reduced motion on and off.
- I ran a Node probe of `sameBusinessInput` and `normalizeGradeInput` with 25 address pairs: trailing slash, http vs https, www, m., upper case, query string, trailing dot, IDN vs punycode, Facebook and Instagram pages, Wix, GitHub Pages, Netlify, franchise paths and subdomains.

## Why NO-GO
- The scan (2.10) never plays on a real report. I scrolled the sample top to bottom at all four sizes, and `health-scanning` was never set (X1). It also isn't loaded on the page most people see (X2).
- Fair use can be skipped by typing the name of any Verified listing (X3).
- It can block a business that got no AI answers (X4), a franchise location in another city (X5), a real owner after Colby tested their business (X6), and a same-name business in another state (X7).

## What passes
- **Scan logic.** I patched the observer to watch the map. Then the scan plays once: 7 nodes in a fixed order, the captions are the nodes' own words ("Website: Partly", "AI answers: 2 of 3"), and the count goes up to 68.
  - Afterward, the section's HTML is identical to the no-scan HTML.
  - With reduced motion there is no scan. With JS off, the map is static.
  - The caption is aria-hidden, inside the aria-hidden map.
- **Fair-use matching on addresses.** http vs https, www, m., upper case, a trailing slash, a query string, a trailing dot and IDN vs punycode all count as the same business. Different subdomains on GitHub Pages, Netlify, Wix, Weebly, business.site and myshopify count as different businesses.
  - With `GRADE_AI_REPEAT_DAYS=0` the rule is off. Day 8 runs.
- **Check again.** It is a separate route and is not limited.
- **Admin bypass.** It needs the bearer token or an HMAC cookie set only after `requireAdmin`. No request field can turn it on. A forged cookie, or one older than 12 hours, is refused.
- **The "checked recently" page.** Without the signed `gr_mine` cookie the page has no grade ID anywhere. It is noindex. The cookie holds report IDs only, and nothing new is stored on the server. The email path is recorded as a deviation (design.md:501), and I agree with the reason.
- **Website alive (12).**
  - A timeout, a self-signed certificate, a wrong host name on the certificate, an http-only site and a connection refused all show "Not checked", never red.
  - The certificate date comes from the same socket (`res.socket.getPeerCertificate`). There is no new request.
  - The DNS retry happens before the existing address checks, so SSRF protection is unchanged.
  - "May have closed" appears nowhere. It shows only in code comments.
  - "Website may be down" is rendered only in `/admin` (admin.js `websiteDownNotes`).
- **Score and SEO.** The score is unchanged (tests pass, and signals are not scored). No public route, robots.txt, sitemap, JSON-LD or noindex change.
- **Wording.** Every new sentence is 160 characters or less, in American spelling, and none promises that AI will name the business.
- **J1-J10 and W1-W10.** All are done, except the small leftovers in X13 and X14. W8 is in design.md.

## Items

### X1. The scan never starts: 35% of the whole section can't be on screen at once (must-fix)
- **Where:** `public/js/health-scan.js:94-95` (`threshold: 0.35`, `observer.observe(section)`).
- **Problem:** `.health` includes the full list, so it is very tall: 2867 px at 1280 wide, and 3521 px at 390 wide. On a 900 px screen, at most 900 / 2867 = 31% of it can be visible. The observer never fires.
  - Measured: `health-scanning` was never set while scrolling through at 1280x900, 1440x800, 390x844 or 360x740.
  - The unit tests only cover `scanPlan` and `shouldScan`, so they pass anyway.
- **Fix:** watch the drawing, not the section.
  - `const target = section.querySelector('.health-map') ?? section; observer.observe(target);` with `threshold: 0.5`. The map is 564 px tall on desktop and 387 px on phones, so 50% is always reachable.
  - Add a browser-free test: read the file and assert that it observes `.health-map`. Also add a test that the threshold is at most viewport ÷ map height. Simplest is to assert `threshold <= 0.6` and that the target is `.health-map`.

### X2. Someone who runs a check never sees the scan (must-fix)
- **Where:** `server/lib/grade-html.js:238` (`scanPage` loads only `HEALTH_ORB_SCRIPT`) and `public/js/health-scan.js:80-98` (`watch()` runs once, at load).
- **Problem:** after a new check, the report is swapped into the "Checking..." page in place by `public/js/grade.js` `swapInPage`. That page never loaded health-scan.js. Even if it had, `watch()` runs at load time, before `.health` exists.
  - So the scan only plays when someone reopens a finished report. It never plays in the moment the owner wants for the video: run the check, then see the report appear.
- **Fix:**
  1. In `scanPage`, use `scripts: [HEALTH_ORB_SCRIPT, HEALTH_SCAN_SCRIPT]`.
  2. In health-scan.js, when `watch()` finds no `.health` and `played` is false, start a `MutationObserver` on `document.body` (`childList`, `subtree`). When a `.health` appears, disconnect it and call `watch()` again.
  3. Keep `played` so a later "Check again" swap doesn't replay the scan.
  4. Add a test that `scanPage` lists `HEALTH_SCAN_SCRIPT`.

### X3. Typing a Verified listing's name skips fair use for any website (must-fix)
- **Where:** `server/lib/grader.js:1856-1857` (`listingInfoFor(input)` and then `return null`), with `listingInfoFor` at `grader.js:1537-1555`.
- **Problem:** `listingInfoFor` picks a listing by name ("match" or "close"), city and state. It looks at the website only when two or more listings match.
  - So "Ridge Roofing, Nashville" plus any website at all, or a "close" name like "Ridge Roofing & Gutters", is treated as the Verified business. It gets unlimited new AI checks.
  - Verified names and cities are public in the directory. The test at grade-fair-use.test.js:149-165 even uses no website.
  - 11.4 says "for their own business".
- **Fix:** exempt only when the check really is that listing's business.
  - Require `compareNames(l.name, input.name) === 'match'`.
  - When the listing has a website, also require `sameSite(input.website, info.listing.website)`. Shared hosts never match, so a Facebook-only listing is not exempt by website.
  - When the listing has no website, require that the check has none either.
  - Add tests: a Verified name with another website is limited, and a "close" name is limited.

### X4. A check that died in a restart blocks the business for 7 days (must-fix)
- **Where:** `server/lib/grader.js:1862-1866` (`askedAi = g => g.status === 'running' || ...`).
- **Problem:** a check that was running during a restart or crash stays `status: 'running'` in storage. `isStale` (`grader.js:1028`) treats it as stopped after 4 minutes, but `repeatCheck` doesn't use `isStale`.
  - So the business is turned away for 7 days, and maybe no AI was ever asked. The runner's "Open that report" button leads to a stopped report.
- **Fix:** `const askedAi = g => (g.status === 'running' && !isStale(g, clock.now())) || freeAnswersOf(...).some(a => !a.reusedFrom);`. Add a test: a running grade older than 4 minutes with no answers doesn't limit.

### X5. Every location of a franchise counts as one business (must-fix)
- **Where:** `server/lib/grader.js:155-161` (`sameBusinessInput`: `registeredDomain(earlier.website) === domain`).
- **Problem:**
  - `nashville.mrrooter.com` and `memphis.mrrooter.com` both become `mrrooter.com`, so this returns true.
  - Path-based franchise pages (`mrrooter.com/nashville` and `/memphis`) also become one, because `normalizeGradeInput` drops the path (my probe: both are stored as `https://mrrooter.com/`).
  - So the Memphis owner is told "This business was checked on <date>" when nobody checked his business, and he gets no link. Franchises (plumbing, roofing, cleaning) are a big part of the target market.
  - The same path loss is the root cause of the known Facebook failure. It also merges every instagram.com, yelp.com, linktr.ee and sites.google.com business into one. The fix for that known item should cover them too.
- **Fix:** for a domain that is not shared, treat two checks as the same business when the registered domain matches and either:
  - the full host matches (`pageKey` host without www. and m.), or
  - the normalized city and state match.

  Add tests: two franchise subdomains in different cities are different, and the same domain in the same city is the same.
- **Owner call:** this adds a condition to 11.1's wording. Record it in the design table as a deviation for the owner to approve.

### X6. Colby's own test checks turn the real owner away for 7 days (must-fix)
- **Where:** `server/routes/grade.js:195-204` (the admin is let through, but his check is stored like anyone else's), and `grader.js:1862-1866`.
- **Problem:** the admin runs checks on prospects, for spec sites and demos. After that, when the prospect runs their own check from the link they were sent, they get "This business was checked on <date>" with no link and no AI. That is a dead end in the sales flow. 11.3 is about the admin not being limited, not about his checks limiting others.
- **Fix:**
  - In `POST /grade`, pass `{ byAdmin: isAdmin(req) }` to `ctx.grader.start` and store `byAdmin: true` on the grade.
  - In `repeatCheck`, skip grades with `byAdmin === true`.
  - Add a test: an admin check followed by a public check of the same site within 7 days returns 303.

### X7. With no website, the same name in a different state is blocked (must-fix)
- **Where:** `server/lib/grader.js:162-165`.
- **Problem:** the comparison uses name and city but not state. "Joe's Plumbing, Springfield, IL" is blocked by "Joe's Plumbing, Springfield, TN". The probe confirmed it.
- **Fix:** also require `String(earlier?.state ?? '').toUpperCase() === String(next?.state ?? '').toUpperCase()`. Add a test.

### X8. "Expired" has no date when the connection was refused (low)
- **Where:** `server/lib/health-signals.js:221`.
- **Problem:** 12.1a says red "Expired on <date>". With an expired certificate, Node rejects the handshake, so `certValidTo` is never read and the row says only "Expired".
- **Fix:** keep "Expired" and record it in the design table: "the date can't be read from a refused connection without loosening TLS". Do not turn on `rejectUnauthorized: false` to get it.

### X9. An expired certificate also makes "Website address works" gray (low)
- **Where:** `server/lib/health-signals.js:232-234`.
- **Problem:** with `certExpired`, the server did resolve and answer, since that is how the expired certificate was seen. But the row says "We couldn't reach your website this time". 12.1b says green when the address resolves and answers.
- **Fix:** `else if (a?.reached || a?.certExpired) addressWorks = good('addressWorks', 'Works');`.

### X10. "Doesn't load" can be wrong for a domain with no A record, and the two tries are back to back (low)
- **Where:** `server/lib/safe-fetch.js:102, 117-124`; `health-signals.js:108`.
- **Problem:**
  - Node returns `ENOTFOUND` for NXDOMAIN and also for "the name exists but has no address" (EAI_NODATA). That happens with a bare domain that only has `www` set up. Such an owner is told to check that the domain is "still paid for".
  - The second try comes right after the first, so the resolver's cached "not found" answer is just repeated. It doesn't help against a brief DNS glitch.
- **Fix:**
  - On the second "not found", try `www.<host>` once if the host has no `www.`. If that resolves, report `addressWorks` as Not checked, not red.
  - Wait about 1 second between the two tries. DNS lookups are free, and 12.4 only rules out WHOIS and RDAP.
  - Change the fix sentence to "Check that your website address is spelled right, works with and without www, and that your domain name is still paid for."

### X11. Certificates that renew themselves will soon be yellow all the time (low, owner call)
- **Where:** `server/lib/health-signals.js:207, 227` (`CERT_WARN_DAYS = 30`).
- **Problem:** Let's Encrypt's 6-day certificates are always 30 days or less. The 45-day certificates arriving in 2026-2028 will be under 30 days for about two thirds of their life. Each healthy, self-renewing site then gets yellow "Expires in N days" with "Renew your website's security certificate".
- **Fix:** also read `valid_from` from the same certificate. Show yellow only when the days left are 30 or fewer and also at most a quarter of the certificate's full life, or simply 14 days or fewer. Record it as a deviation from 12.1a's "30".

### X12. The scan leaves timers and a listener behind, and makes the page jump twice (low)
- **Where:** `public/js/health-scan.js:66-77`; `public/css/style.css:2557-2558`.
- **Problem:**
  - `finish()` doesn't clear the step timers. If reduced motion is turned on mid-scan, the later timers still change the score and caption after `finish`.
  - The `change` listener on the motion media query is never removed after a normal finish.
  - The caption line goes from 0 to about 22 px when the scan starts and back when it ends (`:empty`). On phones that moves the whole list down and up again.
- **Fix:**
  - Keep the timer IDs in an array. In `finish()`, clear them all and remove the motion listener.
  - Give `.health-caption` a fixed `min-height: 1.4em` without the `:empty` rule, or place it absolutely at the bottom of `.health-art`, so nothing below it moves.

### X13. Leftover J3 item, and one confusing listing-card line (low)
- **Where:** `server/lib/grade-html.js:609`, and `severalAnswers` in the same file.
- **Problem:**
  - J3 asked for the business name to be highlighted in each answer. That isn't done.
  - "Hours: Add your hours (Google shows hours for you)" makes the reader ask why they should add them.
- **Fix:**
  - Wrap the matched name in `<mark>` inside each `blockquote`. Escape first, then wrap the escaped name.
  - Change the hours line to "Add your hours (Google has them, but we only copy hours from your website)".

### X14. Two fair-use tests can pass without checking anything (low)
- **Where:** `test/grade-fair-use.test.js:141` (`if (!adminCookie.includes('fap_admin=')) return;`) and `:164` (`if (verified !== true) return;`).
- **Problem:** if the setup ever stops working, the 11.3 cookie test and the 11.4 test pass silently.
- **Fix:** replace each `return` with an `assert.ok(...)` on the setup, so a broken setup fails loudly.

### X15. Fair use runs before the rate limits and reads every stored check on every POST (low)
- **Where:** `server/routes/grade.js:195-204`; `server/lib/grader.js:1858`.
- **Problem:**
  - This turns POST /grade into an unlimited way to ask "was business X checked this week, and when?".
  - Only the form stamp and Turnstile stand in the way, and Turnstile is off unless keys are set.
  - Each POST also reads the whole grades collection.
- **Fix:**
  - Count the per-address rule (`grade:${req.ip}`) before calling `repeatCheck`, or give the repeat page its own small limit.
  - Read only grades newer than the cutoff if the store can do that.

### X16. Signing out doesn't end the /grade admin cookie (low)
- **Where:** `server/routes/admin.js:239` (`clearAdminCookie`).
- **Problem:** after the admin signs out, `fap_grade_admin` still works for up to 12 hours on that browser.
- **Fix:** in the logout handler, also send `fap_grade_admin=; Path=/grade; Max-Age=0; HttpOnly; SameSite=Lax` (plus `Secure` in production).
