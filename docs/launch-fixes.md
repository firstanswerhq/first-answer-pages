# Launch fixes (from two independent reviews, Nov 10, 2026)

Add these to `.kiro/specs/super-pages/tasks.md` as tasks 13 to 18, with tests for each, then build them in order. Keep every existing test passing. Section 19 below goes in as task 20 (after the task 19 checkpoint).

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
