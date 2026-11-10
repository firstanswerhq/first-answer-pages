# Launch fixes (from two independent reviews, Nov 10, 2026)

Add these to `.kiro/specs/super-pages/tasks.md` as tasks 13 to 18, with tests for each, then build them in order. Keep every existing test passing. Section 19 below goes in as task 20 (after the task 19 checkpoint), and section 20 as task 21.

## 13. Safety: nothing goes live unreviewed

- **13.1 Approval queue.** When an owner confirms a draft at /rise, save it to a pending list instead of publishing it. Add `GET /admin/pending` (an HTML list) and `POST /admin/pending/:id/approve` and `/reject`. All three need the `ADMIN_TOKEN` bearer token, with the same timing-safe check Séance uses (`SEANCE_ADMIN_TOKEN` can stay as a fallback name). Add `POST /admin/listings/:id/unpublish`. Only approved listings appear on pages, in the sitemap, in llms.txt, in JSON-LD and in MCP.
- **13.2 Single-line fields.** In `server/lib/listing-fields.js` `clean()`, turn every newline and control character into one space for single-line fields (name, phone, address, city, state, category, website, hours). Only `description` may keep line breaks, and llms.txt must print it on a single line. Add a test: a name containing `\n# SYSTEM NOTE` must not add a line to llms.txt.
- **13.3 Rate limits behind Render.** Set Express `trust proxy` from `TRUST_PROXY` as a hop count (default `1` in production), never `true`. Add a test that a faked `X-Forwarded-For` chain can't dodge the limit. Put a rate limit on wrong admin-token attempts (10 per hour per IP).

## 14. Honest demo mode (nothing fake may look real)

- **14.1 Record the provider.** Save `provider` on every draft and every Séance run. When the vision provider is the mock, show a yellow banner on the draft page: "Demo: no photo reader is connected, so this is a sample business, not your photo." Block approval of mock drafts in production (`NODE_ENV=production`), or return 503 from /rise with "Photo listing is coming soon" when no vision key is set in production.
- **14.2 Séance mock matches the trade.** In `server/lib/assistant.js`, pick only from canned answers for that listing's category, plus neutral fallbacks. About 1 in 3 demo answers should name the business, so the before-and-after can show change. Keep the "Demo answer (no AI connected)" label.
- **14.3 Sample-data banner.** Add `DEMO_MODE` (default true unless `NODE_ENV=production`). When it's on, add a site-wide footer line, "Sample listings for demonstration," plus `<meta name="robots" content="noindex">`, and leave the sample listings out of the sitemap and llms.txt in production.

## 15. Quotes say only what's true

- Change "The business will contact you" (listings.js:86 and mcp.js:141) to: "Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at {phone}."
- Add an `ownerEmail` field to listings (optional, never shown publicly). Add `GET /admin/quotes` (admin token) listing saved quotes, newest first.
- Fix the notifier so it doesn't keep every quote in memory forever. Keep quotes 180 days; drafts expire after 30 days.
- Correct the README: the per-listing quote limit is per client per listing.

## 16. Deploy-ready on Render

- Read `listings.json` and `categories.json` from the repo's `data/` folder, and write only the changing files (drafts, pending, published, quotes, seance, verified) to `DATA_DIR`. Refuse to start if there are 0 categories. In production, refuse to start if `DATA_DIR` or `BASE_URL` is missing.
- Add a `GET /healthz` route that returns `{ok:true}`.
- Add `"engines": {"node": "22.x"}` to package.json, and make sure `npm start` runs `node server/index.js`.
- Return 400, not 500, for a malformed URL id (the error handler should respect `err.status`), and never send a stack trace.
- Turn off `x-powered-by`. Add basic security headers (nosniff, a referrer policy, frame-ancestors none).
- Make `OPTIONS /mcp` return 204 with `Access-Control-Allow-Origin: *` and allow `content-type`, `accept` and `mcp-session-id`.
- Remove the hard-coded `localhost` in the rise-html.js curl example; use `BASE_URL`.
- Add a `SITE_NAME` env var (default "First Answer Pages") used everywhere the site name shows, so we can rename the brand in one place.

## 17. Owner-friendly wording and flow

- Add a header link, "List your business free," pointing to /rise. On every unconfirmed listing, replace the big "NOT YET CONFIRMED BY THE OWNER" box with a smaller note plus a button: "Is this your business? Confirm it free →". Link "See what AI says about this business" to its Séance report.
- /rise page: one big "Take or choose a photo" button. Hide the base64 text box under "Advanced". Say "5 MB", not "5 MiB". Say "a business card, flyer, sign or storefront".
- Draft page: Confirm saves, then sends for approval, so edits can't be lost. Add categories for cleaners, landscapers, pressure washing, pools and concrete, shops and restaurants, plus "Other". After confirming, show: "Thanks! We'll review your listing and it will be live soon."
- Owner-confirmed stamp: show "Owner-confirmed Nov 9, 2026" in America/Chicago time. Move the hash and the verify link under a small "Details for AI tools" toggle.
- Séance report: make the result the headline ("AI named this business" in green, or "AI didn't name this business yet" in amber). Hide the word "mock". Use the Séance name with its accent in headings. Show local time.
- Quote form errors: re-show the form with the visitor's entries kept, and say "Please enter a phone number or email." Show the success message at the top, in a neutral or green box.
- Make phone numbers tappable (`tel:` links).
- Category page: a heading like "Plumbers in Nashville", with the listing grid under one heading.

## 18. AI basics in llms.txt and the README

- llms.txt: say how to request a quote (the MCP tool `request_quote` at /mcp, and `POST /api/quotes`). Mark owner-confirmed listings. Don't claim one city in the header when listings span several.
- README: don't use "Super Pages" (Thryv owns the SUPERPAGES trademark). Call the features "Owner tools" or name each one. Use "Séance" with the accent in prose. List every env var: `PORT`, `BASE_URL`, `DATA_DIR`, `ADMIN_TOKEN`, `TRUST_PROXY`, `DEMO_MODE`, `SITE_NAME`, `NODE_ENV` and the provider keys.

## 19 (task 20 in tasks.md). Connect a real AI (Claude, through the Anthropic API)

Colby is connecting Claude as the real provider for both features. He pastes the key into Render himself; it never goes in the repo or in chat.

- Env for production: `VISION_PROVIDER=anthropic`, `VISION_MODEL=claude-haiku-5-5`, `VISION_API_KEY=<key>`, `SEANCE_PROVIDER=anthropic`, `SEANCE_MODEL=claude-sonnet-5-5`, `SEANCE_API_KEY=<same key>`. Check that config.js reads a `SEANCE_MODEL` (add it if missing) and that both model names can be changed by env alone.
- **Séance must search the web**, the way consumer assistants do, so the answer reflects what AI finds today and not just old training data. In `server/lib/assistant.js` for the anthropic provider, add Anthropic's server-side web search tool to the Messages request: `tools: [{ "type": "web_search_20250305", "name": "web_search", "max_uses": 3 }]` (checked in Anthropic's docs on Nov 10, 2026; no beta header needed). Raise `max_tokens` to at least 1024. The reply's `content` mixes `text`, `server_tool_use` and `web_search_tool_result` blocks: the answer is all `text` blocks joined in order. If `stop_reason` is `pause_turn`, send the request again once with the assistant content appended as the last message, then use what comes back. Use the model's final text as the answer. Keep the named-or-not check. Save which provider and model answered on each run, and show it on the report as "Asked Claude (with web search) on Nov 10, 2026."
- Cost guard: a daily cap on real provider calls (`MAX_AI_CALLS_PER_DAY`, default 200 across /rise and Séance). Over the cap, return a friendly "Try again tomorrow" message. Never fall back to the mock silently in production.
- Tests: use stubbed fetch only (no real network in tests). Check the web search tool is in the request body, the key never shows up in logs or errors, and the cap works.

## 20 (task 21 in tasks.md). Second review round: launch blockers (Nov 10, 2026)

Two more independent reviews (one of the code, one walking the site as a visitor, a plumber and an AI). Build in this order, with tests for each. Keep every existing test passing.

### 21.1 Blockers (must be done before the first deploy)

- **No sample businesses in production.** Today, with `NODE_ENV=production` and `DEMO_MODE=false` (the render.yaml values), the 18 fictional listings from `data/listings.json` show on the home page, listing pages (with JSON-LD), category pages, MCP `search_listings` and `get_listing`, and `POST /api/quotes` / `request_quote` accept quotes for them. Fix it at the store: in `createDataStore` (server/data.js) load the sample listings only when demo mode is on (pass `includeSamples` from config). Then every route, MCP tool and the quote API sees only approved owner listings. Test: production config gives 0 listings everywhere and 404 for a sample id, on pages, MCP and the quote API.
- **Empty states in production.** Home page and every category page with no listings: "No {trade} listed yet. Are you one? List your business free →" (link to /rise). llms.txt with 0 listings still reads cleanly.
- **Admin works from a browser.** Add `GET /admin/login` (a form with one password box for the admin token) and `POST /admin/login` that, on the right token, sets an `HttpOnly; Secure; SameSite=Strict; Path=/admin` cookie (store a SHA-256 of the token, never the token) for 12 hours, and `POST /admin/logout`. All `/admin/*` pages accept either the cookie or the bearer header. Approve, Reject and Unpublish become normal HTML form posts that redirect back to /admin/pending with a green note ("Approved. View listing →"); keep JSON responses for requests that send `Accept: application/json` or the bearer header. For every cookie-authenticated POST, reject it unless the `Origin` (or `Referer`) host matches `BASE_URL`. Show dates in America/Chicago time ("Nov 10, 2026, 2:15 PM"), bigger buttons, and no word "mock" (say "Demo photo reader" instead). Remove the curl text from the admin pages.
- **A correct admin token is never locked out.** In server/lib/admin-auth.js check the token first; only count and throttle wrong attempts. A correct token works even when that IP is throttled.
- **Quotes are honest about who is told.** Add a `NOTIFIER` setting: `none` (default) or `resend` (needs `RESEND_API_KEY`, `NOTIFY_FROM`, `ADMIN_EMAIL`; send with built-in fetch to Resend's email API: to the owner's `ownerEmail` if set, always to `ADMIN_EMAIL`; stubbed fetch in tests; key never logged). Save on each quote which notifier ran and whether it succeeded. `/admin/quotes` shows "Emailed: yes / no (email not set up)", the business name, phone and owner email next to each quote, newest first. Link /admin/quotes from /admin/pending. Keep the visitor message as it is (Colby forwards quotes himself until email is set up). Add a test that `none` never claims it sent anything.
- **The quote page survives a refresh.** `GET /listings/:id/quote` redirects to `/listings/:id`. On a 422 the re-rendered page jumps to the form: give the error box `id="quote-error"`, `role="alert"`, `tabindex="-1"`, and render the page with the form section first visible on a phone (or add `#quote-form` to a redirect). The API error for an empty contact reads "Please enter a phone number or email." (not "at least 1 characters").

### 21.2 Should-fix before launch

- **Séance gets its own timeout** of 120 seconds (`SEANCE_TIMEOUT_MS`, default 120000), covering the first call and the pause_turn resend. The photo reader keeps 30 seconds.
- **Séance shows its sources.** Anthropic requires showing citations when web-search answers are displayed. Collect `citations[].url` and `title` from the text blocks (dedupe by URL, at most 8), save them on the run as `sources`, and show them under the answer as escaped links, "Sources: …". Only http(s) URLs; anything else is dropped.
- **The cap counts every paid call.** Consume a second unit before a pause_turn resend (if none is left, use the first reply). Split the cap: `MAX_AI_CALLS_PER_DAY` stays the total, and photo uploads may use at most 150 of it, so uploads can never block Séance runs. The day resets at midnight America/Chicago, not UTC. Persist the day's count in `DATA_DIR/ai-budget.json` so a restart doesn't reset it.
- **No mock Séance in production.** If the assistant provider is the mock and `NODE_ENV=production`, `/seance/run` returns 503 "Séance is not connected", like /rise does.
- **The photo button shows the server's own message.** In public/js/rise.js, on a non-ok response, show the text of the response page's main message (for example "Try again tomorrow"), not "The upload was refused (status 429)". Disable the button and show a clear "Reading your photo… this takes about 10 seconds" while uploading.
- **Type it in instead.** /rise gets a second button, "No photo? Type it in", that opens an empty draft with the same edit fields, so owners without a card can still list. In production with no vision key, /rise shows only the type-it-in option (instead of "Photo listing is coming soon" twice).
- **Search is forgiving, for people and AIs.** MCP `search_listings` lists the valid category slugs as an enum in its input schema. Category matching ignores case and accepts the slug, the display name, and singular or plural ("plumber", "Plumbers", "plumbing" → plumbers). City matching ignores case and a trailing state ("Nashville, TN" → Nashville). Same on the site's search.
- **Séance link only when there is something to see.** Show "See what AI says about this business" on a listing only when that listing has at least one Séance run. On a demo run the headline says "Demo answer: AI named this business" (or "didn't name"), in gray, not green or amber. The details line never shows the word "mock".
- **Richer JSON-LD for AIs.** On each listing add `url` (the listing's full URL), `telephone` in +1 format (`+16155550177`), `areaServed` from the service area, `openingHoursSpecification` from the hours, `streetAddress` without the city/state/ZIP repeated, and a specific `@type` by category where schema.org has one (plumbers → Plumber, electricians → Electrician, hvac → HVACBusiness, roofers → RoofingContractor, landscapers → LandscapingBusiness is not a schema type so use HomeAndConstructionBusiness, cleaners → HouseCleaning is not a type either so HomeAndConstructionBusiness, restaurants → Restaurant, shops → Store, otherwise LocalBusiness). Keep `LocalBusiness` valid for anything unknown.

### 21.3 Owner wording and polish

- /rise heading: "List your business free" (no "Rise from the Grave" anywhere an owner sees it). Remove the "Advanced / Image as text (base64)" box from the page entirely (the API keeps accepting it).
- Draft page: phone input `type="tel"`, email input `type="email"` styled like the other fields, full width. "Save changes" shows "Saved." next to the button. The confirm error says "Please fix the highlighted fields, then press Confirm again." Remove "This is not an ownership check. We do not verify who you are…" and say instead: "We review every listing before it goes live." Discard asks "Discard this draft?" on the page itself (no browser dialog) and then shows "Draft discarded."
- Thank-you page: one "Thanks!" only, then "We'll review your listing, usually within one business day. We'll email you when it's live." (only say the email part when an owner email was given).
- Categories: merge "Restaurants" into "Shops and Restaurants" (or the other way) so there is one; category pages get a real `<title>` like "Plumbers in Nashville | {SITE_NAME}". Séance questions use a natural phrase per category ("pool and concrete companies", "businesses" for Other).
- Stamp: keep "Owner-confirmed Nov 10, 2026" on one line (`white-space: nowrap` on the date).
- Hours: a day with no hours shows "Closed".
- Listing ids: a new listing's id is the name only when the city is already in the name (no `bellevue-plumbing-co-bellevue`).
- llms.txt and the sitemap use `BASE_URL`; when it isn't set (local only), fall back to the actual host and port the request came in on.
- The specs: change the titles inside `.kiro/specs/super-pages/*.md` from "Super Pages" to "Owner tools" (don't rename the folder). Change "honours" to "honors" in server/app.js.
- README, a "Deploy on Render" section: the Starter plan and the 1 GB disk are paid monthly (link to Render's pricing page instead of quoting a price), New → Blueprint → pick the repo, which env vars to type in (`BASE_URL`, `SITE_NAME`, the two Anthropic keys, optional `RESEND_API_KEY`/`NOTIFY_FROM`/`ADMIN_EMAIL`), where to find the generated `ADMIN_TOKEN` (the service's Environment tab), that `autoDeploy: false` means you press "Manual Deploy" after each change, how to log in at `/admin/login`, and the TRUST_PROXY check below.
- TRUST_PROXY check (README and a log line): at startup in production log `trust proxy = N`. Add `GET /admin/whoami` (admin only) that shows `req.ip` and `req.ips`, so after the first deploy Colby can open it from his phone and we set TRUST_PROXY to the smallest number that shows his real IP.

## 21 (task 22 in tasks.md). Tell Bing about new listings (IndexNow)

Colby approved this on Nov 10, 2026. IndexNow is a free, open protocol: the site tells participating search engines (Bing and others, which share submissions) "this page is new or changed", so they read it in days instead of weeks. Google doesn't take part; Colby adds the site to Google Search Console by hand.

- New module `server/lib/indexnow.js`: `createIndexNow({ baseUrl, dataDir, enabled, fetch, clock })` with `submit(urls)`.
- **Key:** on first use, make a random 32-character key from `[a-z0-9]` (crypto) and save it to `DATA_DIR/indexnow-key.txt`; reuse it after that. (Rules: 8 to 128 characters, letters, digits and dashes only.)
- **Key file:** serve `GET /{key}.txt` at the site root, `text/plain; charset=utf-8`, body exactly the key. Any other `/*.txt` still 404s (except `/llms.txt`).
- **Submit:** `POST https://api.indexnow.org/indexnow` with header `Content-Type: application/json; charset=utf-8` and body `{ "host": <BASE_URL hostname>, "key": <key>, "keyLocation": <BASE_URL>/<key>.txt, "urlList": [...] }`. 200 and 202 are success; 400/403/422/429 are logged as `[indexnow] status=<code>` only (never the key). 10-second timeout. Fire and forget: the admin's approve/unpublish never waits for it and never fails because of it.
- **When:** after an admin approves a listing (the listing URL, its category page, `/llms.txt` and `/sitemap.xml`), and after unpublish (the removed listing URL, so engines see the 404). Batch in one request.
- **Only for real sites:** enabled when `NODE_ENV=production`, `DEMO_MODE` is off, and `BASE_URL` is https and not localhost/127.0.0.1/*.test. `INDEXNOW=off` turns it off. Never runs in tests unless a test passes a stub fetch.
- **Admin:** `/admin/pending` shows one line under each approval note: "Bing notified" or "Bing not notified (reason)". `GET /admin/indexnow` (admin only) shows the last 20 submissions: time (America/Chicago), URLs, status.
- Tests with a stubbed fetch: the request body and headers are exactly as above, the key file route returns the key, the key is stable across restarts (same DATA_DIR), nothing is sent in demo mode or for a localhost BASE_URL, a failing or hanging endpoint doesn't slow or break approve, and the key never appears in logs.
- README: one short paragraph explaining what IndexNow does and how to turn it off.
