# Implementation Plan: Super Pages

## Overview

Plain JavaScript ES modules on Node 22 and plain Express, as set by the design. The plan follows the design's build order: step 0 foundation (`createApp` factory, data store, safe JSON writer, rate limiter, config, canonical form and verifier), then Rise from the Grave, Agent-ready, the Owner-confirmed stamp, and the Seance. The stamp is a tamper check, not proof of ownership or identity; real ownership checks are future work. A README and full-suite checkpoint close the plan.

Each feature carries its own fast-check property tests as optional sub-tasks. Tests use `node:test` and `fast-check`, live in `test/`, use mocks and a temporary `DATA_DIR`, and make no network calls. Checkpoints between features run `node --test`.

## Tasks

- [x] 1. Step 0: Foundation (no UI, no new endpoints)
  - [x] 1.1 Create `server/lib/json-file.js`
    - Export `readJsonFile(path, fallback, { fs })` and `updateJsonFile(path, mutator, { fs })`
    - Module-level per-path promise queue; failed write must not block later writes
    - Read-modify-write inside the queue; bad JSON aborts the update and never overwrites the file
    - Atomic write: temp file in the same directory, fsync, rename; retry 3 times (10, 25, 50 ms) on `EPERM`, `EBUSY`, `EACCES`; remove temp file and throw on final failure
    - Optional injectable `fs` for tests
    - _Requirements: 4.10, 4.11, 14.4, 14.8_

  - [x] 1.2 Create `server/lib/rate-limiter.js`
    - Export `createRateLimiter({ clock })` with `consume(key, { limit, windowMs })` and a peek-then-record path for the two-key quote check
    - Sliding-window log; `retryAfterSeconds` is an integer clamped to 1 through `ceil(windowMs / 1000)`
    - Prune empty keys and cap total keys (about 10,000) with least-recently-used eviction
    - Export the `RULES` constant table (`rise`, `mcp`, `quote`, `quote-listing`, `seance`, `seance-listing`)
    - _Requirements: 1.6, 5.15, 6.9, 12.7, 14.6_

  - [x] 1.3 Create `server/lib/config.js`
    - Export `configFromEnv(env)` and `isTestRun(env)` (true when `NODE_TEST_CONTEXT` is set)
    - Resolve `dataDir` (`DATA_DIR` or repo `data/`), `adminToken`, `baseUrl`, `providerTimeoutMs` (30000), and `TRUST_PROXY`
    - Provider selection helpers return the mock unless the provider name is known, the key is set, and it is not a test run; a real vision provider without `VISION_MODEL` warns and falls back to the mock
    - Never log or return key values
    - _Requirements: 2.1, 2.3, 2.4, 2.7, 6.6, 12.1, 12.3, 12.4, 12.6, 14.3_

  - [x] 1.4 Create `server/lib/canonical.js` and `server/lib/verifier.js`
    - `canonicalize(value)`: sorted keys by code point (not UTF-16 unit), no whitespace, array order kept, `undefined` object values omitted, non-finite numbers and non-JSON types throw `TypeError`
    - `hashListing(listing, verifiedDate)`: strip `verifiedDate` and `verificationHash`, hash `canonicalize({ listing, verifiedDate })` with `node:crypto` SHA-256, lowercase hex
    - `verificationFor(store, listing)` returns `null` when no Verified_Date, else `{ verifiedDate, hash }`; `checkHash(current, supplied)` trims and compares case-insensitively, returns `null` when supplied is absent and `false` for non-strings
    - Hash computed on every call, no cache
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 10.9_

  - [x] 1.5 Refactor `server/data.js` into `createDataStore({ dataDir, fs })` with legacy exports
    - Synchronous construction loading `listings.json`, `categories.json`, `published.json`, `verified.json`; missing file gives `[]` or `{}`; corrupt file throws; `_comment` entries filtered; seed id wins on collision with a stderr warning
    - Methods: `getListings`, `getCategories`, `findById`, `searchListings({ category, city, query, limit })`, `getVerifiedDate`, `publishDraft`, `updatePublished`, `reload`, `withLock(name, fn)`, `collection(name)` with allow-list `drafts`, `quotes`, `seance` only
    - `publishDraft` runs the design's sequence inside `withLock('publish')`: validate (422 on failure, nothing written), reserve id and mark `publishing`, append to `published.json` unless present, write `verified.json[id]` using `clock` UTC date, mark draft `published`, then swap the in-memory snapshot; idempotent on a `published` draft, 409 for other statuses
    - Include `description`, `city`, and a two-letter uppercase `state` in publish validation (design gap 1); `makeSlug` and field validation come from `listing-fields.js`, so import them lazily or accept them as injected functions until task 3.1 exists
    - No method accepts a caller-chosen filename; `listings.json` and `categories.json` have no write path
    - Keep legacy exports `getListings`, `getCategories`, `findById`, `filterListings`, `groupByCategory` backed by a lazily created default store; keep `process.exit(1)` on default-store load failure
    - _Requirements: 4.3, 4.5, 4.9, 4.11, 5.4, 5.19, 9.4, 10.10, 14.1, 14.2, 14.3_

  - [x] 1.6 Convert `server/app.js` and routes to the `createApp(deps)` factory
    - `createApp({ dataDir, visionProvider, notifier, assistantProvider, clock, rateLimiter, config, newId, a2a })`; missing deps come from `configFromEnv`; keep `export default createApp()` so `import app from '../server/app.js'` still works; `server/index.js` unchanged
    - Resolve a `ctx` bag and pass it to route factories: `createHomeRouter`, `createListingsRouter`, `createApiRouter`, `createLlmsRouter`, `createSitemapRouter`; routes import no providers and read no `process.env`
    - Apply `TRUST_PROXY` through `app.set('trust proxy', ...)` when set
    - Additive-only changes: `layout()` gains optional `scripts`, `listingDetail()` gains optional `opts`, `buildSchema()` gains optional second argument, `generateLlmsTxt()` gains optional `categories`; read `test/html.test.js`, `test/schema.test.js`, `test/llms.test.js`, `test/listings.test.js` first so output they pin does not change
    - Add `clock` (`Date.now` wrapper) so nothing else in `server/` calls `Date.now()`
    - All existing tests must still pass
    - _Requirements: 14.3, 14.6, 14.7_

  - [x]* 1.7 Write property tests for canonical form
    - File `test/canonical.test.js`; include known-vector examples and astral-character key ordering
    - **Property 1: Canonical form is independent of key order**
    - **Property 2: Canonical form round trip**
    - **Validates: Requirements 9.1, 9.6, 9.9**

  - [x]* 1.8 Write property tests for the verifier
    - File `test/verifier.test.js`; compute the expected digest independently with `node:crypto`; mutation generators avoid `verifiedDate` and `verificationHash` and filter out equal-JSON mutations
    - **Property 3: Verification hash is deterministic and well formed**
    - **Property 4: Verification hash is sensitive to every change**
    - **Property 5: Derived fields do not enter the hash**
    - **Validates: Requirements 9.2, 9.3, 9.5, 9.7, 9.8**

  - [x]* 1.9 Write property test and failure-injection examples for the JSON writer
    - File `test/json-file.test.js`; injected `fs` with random delays between read and rename
    - Example tests: failed rename leaves previous content intact and removes the temp file; a corrupt file is not overwritten; missing file reads as fallback
    - **Property 25: Concurrent writes lose nothing**
    - **Validates: Requirements 4.10, 14.4, 14.8**

  - [x]* 1.10 Write property tests for the rate limiter
    - File `test/rate-limiter.test.js`; fake clock; include the two-key atomic quote check example
    - **Property 13: Rate limiter honours limit, window, and Retry-After**
    - **Validates: Requirements 1.6, 5.15, 6.9, 12.7**

- [x] 2. Checkpoint - Foundation
  - Run `node --test`; all existing tests and the new foundation tests must pass. Ask the user if questions arise.

- [x] 3. Feature 1: Rise from the Grave
  - [x] 3.1 Create `server/lib/listing-fields.js`
    - Export `DAYS`, `normalizePhone`, `mapCategory` (slug or label, any letter case), `normalizeFields(raw, categories)`, `validateFields(fields, categories)`, `makeSlug(name, city, takenIds)`
    - `normalizeFields` discards non-model keys (including `__proto__`), truncates strings to 500 characters and `services` to 20, treats non-objects as empty
    - `validateFields` requires non-empty `name`, `(NNN) NNN-NNNN` phone, known category slug, at least one service, non-empty `serviceArea`, non-empty `description`, non-empty `city`, two uppercase letter `state`, hours keys limited to lowercase day names; failing fields are emptied and listed in `missingFields`; `address` never listed
    - Reflect the design's resolved gap: description, city, and state validation
    - Wire this module into the `publishDraft` validation from task 1.5
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 4.3_

  - [x] 3.2 Create `server/lib/upload.js`
    - Export `detectImageType(bytes)` (JPEG, PNG, WebP signatures), `decodeBase64Image(text)` (strip whitespace and optional `data:...;base64,` prefix, strict alphabet regex, null when invalid), `MAX_IMAGE_BYTES` (5,242,880), `MAX_FORM_BYTES` (8 MiB)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.9, 1.10_

  - [x] 3.4 Create `server/lib/drafts.js` (Draft_Store)
    - Create, get, update fields, discard, and status transitions over `store.collection('drafts')`; ids from `newId` (UUID)
    - Discard deletes only drafts with status `draft`; `publishing` or `published` returns 409 (design gap 5)
    - Edits to a draft not in status `draft` return 409
    - _Requirements: 3.6, 4.2, 4.7, 4.8_

  - [x] 3.3 Create `server/lib/vision.js` and `server/lib/extractor.js`
    - `createMockVisionProvider()`: SHA-256 of image bytes indexes a fixture table of fictional businesses, some fixtures missing a field; pure function of input
    - Real adapters: `openai` (OpenAI-compatible chat completions with image data URL, `VISION_BASE_URL`) and `anthropic` (Messages API), built-in `fetch`, `AbortSignal.timeout(30000)`, key only in a header, model from `VISION_MODEL`, strict JSON reply parsed in try/catch
    - `createVisionProvider(env)` follows config rules (mock when no key, in test runs, or no model)
    - `extractDraft({ provider, bytes, mimeType, categories, timeoutMs })` normalizes and validates provider output; provider failure, timeout, or unparseable output throws a typed error for a 502
    - Logs carry provider name and status only, never keys, bodies, or image bytes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.7_

  - [x] 3.5 Create `server/lib/rise-html.js`, `server/routes/rise.js`, `public/js/rise.js`, and wire into `createApp`
    - `GET /rise`: no-JS form with a base64 textarea, noscript text with a `curl` example, and the 5 MiB note
    - `POST /rise` order: rate limit `rise:<ip>`; 415 for unsupported type before reading the body; `express.raw` with 5 MiB limit for image types; `express.urlencoded` with 8 MiB limit and `parameterLimit: 10` for the form; 413 on `entity.too.large`; 400 for empty body or field; 400 for bad base64; 415 for signature mismatch; extract; store draft; `303` to `/rise/drafts/:id`; 502 with no draft on extraction failure; hold bytes in request scope only, write nothing to disk
    - `GET /rise/drafts/:id`: editable form with every field and `missingFields` highlighted; headers `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`; 404 for unknown id
    - `POST /rise/drafts/:id` (urlencoded, 64 KiB): normalize, revalidate, save, redirect back; `POST /rise/drafts/:id/confirm`: calls `store.publishDraft`, `303` to `/listings/:id`, 422 re-rendering the form with failing fields; `POST /rise/drafts/:id/discard`: 409 unless status `draft`
    - Escape every draft value with `escapeHtml`
    - `public/js/rise.js`: optional file-picker enhancement (checks size and type, fills the textarea or posts raw bytes), form still works without it
    - Drafts never enter the store snapshot, so public routes exclude them by construction
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.12_

  - [x]* 3.6 Write property tests for listing fields
    - File `test/listing-fields.test.js`; vision-output generator includes non-objects, extra keys, wrong types, `__proto__`, long strings, oversized arrays
    - **Property 7: Phone normalization**
    - **Property 8: Category mapping yields a known slug or nothing**
    - **Property 9: Extraction output always satisfies the Listing model**
    - **Property 10: Extraction normalization is idempotent**
    - **Property 11: Listing slugs are URL-safe and unique**
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 4.3**

  - [x]* 3.7 Write property test and examples for upload handling
    - File `test/upload.test.js`; independent signature oracle; examples for size, type, signature, empty body, bad base64, data-URL prefix
    - **Property 12: Image signature detection and base64 decoding**
    - **Validates: Requirements 1.5, 1.9, 1.10**

  - [x]* 3.8 Write property test for the mock vision provider and vision config
    - File `test/providers.test.js`; `configFromEnv` selection (mock when no key, in test runs); stubbed `globalThis.fetch` checks request shape, timeout, zero calls without a key, key never in logs or responses
    - **Property 14: Mock providers are deterministic** (vision half)
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.7**

  - [x]* 3.9 Write integration tests for the Rise flow
    - File `test/rise.test.js`; temp `DATA_DIR`, injected mocks, `app.listen(0)` and built-in `fetch`
    - Cover upload to review to edit to confirm, then the listing appearing in `/`, `/listings/:id`, `/llms.txt`, `/sitemap.xml`; draft excluded from all public routes while unconfirmed; 413, 415, 400, 422, 409, 404, 429 with `Retry-After`; provider failure gives 502 and no draft; `listings.json` bytes unchanged; crash-resume of a `publishing` draft yields no duplicate; no image bytes written under the temp dir
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 2.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 15.8_

  - [x]* 3.10 Write property test for escaping in Rise pages
    - File `test/render.test.js`, covering the review page and result pages
    - **Property 26: Rendered values are escaped** (Rise pages)
    - **Validates: Requirements 4.12**

- [x] 4. Checkpoint - Rise from the Grave
  - Run `node --test`; existing tests and all new tests must pass. Ask the user if questions arise.

- [x] 5. Feature 2: Agent-ready
  - [x] 5.1 Create `server/lib/tool-validator.js`
    - `validateAgainstSchema(schema, value)` for the subset `type` (`object`, `string`), `properties`, `required`, `additionalProperties: false`, `minLength`, `maxLength`; total function that never throws; reads keys with `Object.hasOwn`; returns `{ ok, value }` or `{ ok: false, argument, message }`
    - `validateQuoteArgs(args, store)`: structural check, sanitize (strip control characters; `details` keeps `\n` and `\t`, normalizes `\r\n`; trim), then `id` must match a published listing, `name` 1 to 100, `contact` email (at most 254 characters) or phone with 10 digits or 11 starting with 1, `details` 1 to 2000
    - _Requirements: 5.8, 5.9, 5.16, 6.2, 6.3, 6.10_

  - [x] 5.2 Create `server/lib/notifier.js` and `server/lib/quotes.js`
    - `createMockNotifier()` with in-memory `sent` array and `failNext` flag; `console` notifier writes one JSON line with quote id and listing id only; `createNotifier(env)` per config rules (mock when `NOTIFIER` unset or in test runs)
    - `submitQuote(ctx, args, clientIp)`: validate (invalid consumes no rate budget), atomic two-key rate check, append `{ id, listingId, name, contact, details, createdAt, notified: false }` through the queue, call `notifier.notify` in try/catch with the provider timeout, set `notified: true` by queued update on success, keep `false` on failure and still return `{ status: 'ok', quoteId }`
    - Logs print error names only
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [x] 5.5 Create `public/js/webmcp.js`
    - ES module exporting `registerWebMcp({ navigator, document, window, fetch, console })`; auto-start guarded by `typeof document !== 'undefined' && typeof window !== 'undefined'` (Node 22 defines `navigator`)
    - Context from `navigator?.modelContext ?? document?.modelContext`; absent means return silently with no console output
    - Register `get_listing` (`readOnlyHint: true`, fetches `/api/listings/<id>`) and `request_quote` (`readOnlyHint: false`, `requiresConfirmation: true`, input schema matching the MCP tool) in separate try/catch blocks
    - `request_quote` calls `window.confirm` with business name and message; declined returns a declined result and calls `fetch` zero times; confirmed posts JSON to `/api/quotes` with `id` forced to the page's listing; response treated as data, never inserted into the DOM
    - Reads `data-listing-id` and `data-listing-name` from the quote form
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

  - [x] 5.6 Create the A2A seam `server/routes/a2a.js` and wire it into `createApp`
    - `mountA2A(app, a2a)` registers the card route and `a2a.path` together; `createApp` calls it only when `ctx.a2a` is supplied; this spec supplies none, so `GET /.well-known/agent-card.json` returns 404
    - No A2A endpoint is built in this spec (design decision)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 5.3 Create `server/lib/mcp.js` and `server/routes/mcp.js`, and wire into `createApp`
    - `POST /mcp` chain: rate limit `mcp:<ip>`, `express.raw({ type: () => true, limit: 65536 })`, handler; 413 over 64 KiB; `GET` and `DELETE` return 405 with `Allow: POST`
    - Bad JSON gives HTTP 400 with `-32700`; non-object, missing `jsonrpc: "2.0"`, missing method, or batch gives HTTP 400 with `-32600`; message without `id` is a notification and gets 202 empty
    - `initialize` (protocol version, `capabilities.tools`, `serverInfo.name` `first-answer-pages`), `ping`, `tools/list` (exactly `search_listings`, `get_listing`, `request_quote`, each with name, description, `inputSchema`), `tools/call`; unknown method `-32601`; unknown tool or invalid args `-32602` naming the tool or argument before any tool logic; thrown exceptions give `-32603` with HTTP 200, never 500
    - `search_listings` via `store.searchListings` with `limit: 25`; empty-string argument counts as not supplied; result is summary fields plus `url`; empty match is a successful empty list
    - `get_listing` returns the listing plus `verification: { verified, verifiedDate, hash }` using the real verifier; unknown id gives `isError: true`
    - `request_quote` uses `submitQuote`; invalid gives `-32602`; rate limited gives `isError: true` with wait time
    - Success shape `{ content: [{ type: 'text', text }], structuredContent }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.18, 5.19, 6.1, 6.3, 10.12_

  - [x] 5.4 Add quote surfaces and listing-page integration
    - `POST /api/quotes` in `routes/api.js` (JSON, 16 KiB limit): 201 `{ quoteId }`, 422 `{ error, argument }`, 429 with `Retry-After`; same validation, storage, notification, and limits as MCP
    - `POST /listings/:id/quote` in `routes/listings.js` (urlencoded): path `id` overrides body `id`; `303` to `/listings/:id?quote=sent`, or an HTML error page with 422 or 429; unknown listing 404
    - `quoteForm(listing)` in `html.js` renders a plain HTML form (works without JavaScript) carrying `data-listing-id` and `data-listing-name`; listing page passes `scripts: ['/js/webmcp.js']` to `layout()` which renders `<script type="module" src="/js/webmcp.js">`
    - Escape `name` and `details` wherever shown; add quote form CSS in the existing hand-made style
    - _Requirements: 6.9, 6.10, 7.1, 7.8, 7.9_

  - [x]* 5.7 Write property tests for the tool validator
    - File `test/tool-validator.test.js`; independent oracle for the schema subset
    - **Property 15: Tool validator accepts exactly what the schema allows**
    - **Validates: Requirements 5.8, 5.9, 5.16**

  - [x]* 5.8 Write property tests and flow tests for the MCP endpoint
    - File `test/mcp.test.js`; start the server once per file; body generators mix random bytes, random JSON, and JSON-RPC envelopes with weighted method names
    - Example flow: `initialize`, `tools/list`, `tools/call`; 405 with `Allow`; 413; 429 with `Retry-After`; unknown tool and method; unpublished drafts excluded
    - **Property 16: The MCP endpoint never answers 500**
    - **Property 17: Search returns exactly the matching listings, capped at 25**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17, 5.18, 5.19**

  - [x]* 5.9 Write property tests for quotes
    - File `test/quotes.test.js`; mock notifier, fake clock, large-limit rate limiter except where limits are under test
    - Examples: notifier success sets `notified: true`; notifier failure keeps the quote with `notified: false` and still returns success; 5 per hour and 3 per listing per hour limits; no-JS form post; `POST /api/quotes` parity with MCP
    - **Property 18: A quote is stored if and only if validation accepts**
    - **Property 19: Stored quote text is sanitized**
    - **Property 20: Quote round trip**
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 7.8**

  - [x]* 5.10 Write tests for the WebMCP script with stubbed globals
    - File `test/webmcp.test.js`; cases: `modelContext` absent (no throw, no `console.error` or `console.warn`, no `fetch`), `document.modelContext` fallback, present (both tools with annotations and confirmation marker), first registration throws (second still attempted), user declines (zero `fetch` calls), user confirms (one `POST` to `/api/quotes` with page listing id), server rejects with 422, import in Node has no side effects
    - Also assert the listing page HTML contains the module script tag and the plain quote form
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 15.9_

  - [x]* 5.11 Write tests for the A2A seam
    - File `test/app.test.js`; `GET /.well-known/agent-card.json` returns 404; no router layer matches the card path; with an injected stub `a2a` dependency both the card and endpoint routes appear together
    - _Requirements: 8.3, 8.4, 8.5_

- [x] 6. Checkpoint - Agent-ready
  - Run `node --test`; existing tests and all new tests must pass. Ask the user if questions arise.

- [x] 7. Feature 3: Owner-confirmed stamp
  - [x] 7.1 Add the stamp, JSON-LD fields, and stamp CSS
    - `listingDetail(listing, jsonLd, { verification })` renders an `<aside class="stamp">` with the text "Owner-confirmed <date>" (the Verified_Date) and the hash in `<code data-hash="...">`, labeled as unchanged since the owner confirmed it, with no identity or ownership claim; listings with no Verified_Date show "Not yet confirmed by the owner"
    - `buildSchema(listing, verification)` adds `identifier` (hash string) and `dateModified` (Verified_Date) only when `verification` is non-null; required-field checks unchanged
    - Add stamp styles to `public/css/style.css` in the existing hand-made style (bordered, slightly rotated rubber-stamp look in black and dark red on the paper-yellow page)
    - JSON-LD output must never contain a literal `</script`
    - _Requirements: 10.1, 10.2, 10.3, 4.12_

  - [x] 7.2 Add the verify endpoint and verification fields in the API and listing route
    - `GET /api/verify/:id?hash=` in `routes/api.js`: 200 `{ id, verified, verifiedDate, hash, match }`; `match` is `true`, `false`, or `null` when `hash` is absent; case-insensitive after trimming; repeated `hash` parameter counts as non-match; published but unverified listing gives `verified: false`, `verifiedDate: null`, `hash: null`; unknown id gives 404 `{ error: 'Listing not found' }`
    - `GET /api/listings/:id` adds `verifiedDate` and `verificationHash` only for verified listings so unverified seed listings still deep-equal in `test/api.test.js`
    - `routes/listings.js` passes `verificationFor(store, listing)` to `listingDetail` and `buildSchema`
    - Verified_Date is set only through confirmation in `publishDraft` (UTC date from `clock`)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.12_

  - [x]* 7.3 Write property test and examples for the verification flow
    - File `test/verify.test.js`; publish a generated valid listing into a temp store, read the stamp hash from the rendered page, then call the verify endpoint (exact, upper-cased, whitespace-padded), edit via `store.updatePublished` and expect `match: false` with a different `hash`
    - Examples: stamp text "Owner-confirmed <date>" and JSON-LD `identifier` and `dateModified` for listings with a Verified_Date; the text "Not yet confirmed by the owner" and absence of `identifier` and `dateModified` for listings without one; the stamp markup contains no "Verified" wording; 404; `match: null`; `/api/listings/:id` additions
    - **Property 6: Stamp hash verifies until the listing changes**
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.11, 10.12**

  - [x]* 7.4 Extend escaping property test to the Listing_Page and quote result page
    - Add to `test/render.test.js`; include `</script>` in values to confirm JSON-LD stays safe
    - **Property 26: Rendered values are escaped** (Listing_Page, quote result page)
    - **Validates: Requirements 4.12, 6.10**

- [x] 8. Checkpoint - Owner-confirmed stamp
  - Run `node --test`; existing tests and all new tests must pass. Ask the user if questions arise.

- [x] 9. Feature 4: The Seance
  - [x] 9.1 Create `server/lib/assistant.js`
    - `createMockAssistantProvider()`: SHA-256 of the prompt selects a canned answer that names a fixture business or not; pure function of input
    - Real adapters `openai` and `anthropic` with built-in `fetch`, `AbortSignal.timeout(30000)`, key only in a header, model from `SEANCE_MODEL`; `createAssistantProvider(env)` follows config rules (mock without `SEANCE_API_KEY` or in test runs, no network call)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [x] 9.2 Create `server/lib/seance.js`
    - `buildPrompt(listing, categories)` returns `best <category label> in <city>` with the label as stored
    - `normalizeForMatch(s)`: per-code-point lowercase, each `\p{P}` code point becomes a space, whitespace runs collapse to one space, trim; no Unicode normalization form
    - `detectNamed(name, answer)`: substring test on normalized forms; empty normalized name never matches
    - `createSeanceStore(store)`: append-only `append(run)` and `list(listingId)` over `store.collection('seance')`; no update or delete method
    - `runSeance(ctx, listingId)`: build prompt, call provider with 30 s abort, truncate answer to 4,000 code points, detect, append `{ id, listingId, prompt, provider, timestamp, answer, named }`; failure or timeout stores nothing and throws a typed error for a 502
    - Reflect the design's weakened 11.8 property: `named` can only change across an affix boundary for overlapping text; implementation must not try to prevent boundary matches
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 13.1_

  - [x] 9.3 Create `server/lib/seance-html.js` and `server/routes/seance.js`, and wire into `createApp`
    - `POST /seance/run` (JSON `{ id }`): 403 when no `SEANCE_ADMIN_TOKEN` configured; 401 for missing or wrong bearer token (SHA-256 both values then `crypto.timingSafeEqual`); 404 unknown listing; rate limits `seance:<ip>` (10 per hour) and `seance-listing:<id>` (1 per 10 minutes) consumed before the provider call, 429 with `Retry-After`; 502 `{ error: 'run failed' }` on provider failure
    - `GET /seance/:id` HTML report and `GET /api/seance/:id` JSON, both 404 for unknown listings; runs oldest to newest; group by `(provider, prompt)` with first labeled "before", last "after", and whether `named` changed; tag each run "before owner confirmation" or "after owner confirmation" by UTC date against the Verified_Date (same date counts as after); empty state says no runs recorded; works without JavaScript; escape answers with `escapeHtml`
    - _Requirements: 11.2, 11.6, 12.7, 12.8, 12.9, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_

  - [x]* 9.4 Write property tests for name detection
    - File `test/seance.test.js`; positive case uses letters and spaces with re-casing, punctuation changes, and longer whitespace; disjoint case uses a name alphabet `a-f` and affixes and answers from digits
    - **Property 21: A name contained in the answer is detected**
    - **Property 22: Name detection is stable under added context** (uses the weakened form from the design: `named: true` stays true after any prefix and suffix; unchanged when affixes use a disjoint alphabet)
    - **Validates: Requirements 11.3, 11.4, 11.7, 11.8**

  - [x]* 9.5 Write property tests and report tests for the Seance history
    - File `test/seance-history.test.js`
    - Property tests include concurrent appends and a 4,000-character truncation round trip
    - Examples: report ordering, before and after labels, before and after owner confirmation tags, empty state, 401, 403, 429 with `Retry-After`, 502 stores nothing, JSON matches HTML history, answer escaped
    - **Property 23: Seance history is append-only and ordered**
    - **Property 24: Seance round trip**
    - **Validates: Requirements 11.5, 12.7, 12.8, 12.9, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.9, 13.10**

  - [x]* 9.6 Extend provider tests for the assistant provider
    - Add to `test/providers.test.js`; stubbed `globalThis.fetch`; zero calls without a key; key never in logs, responses, or stored files
    - **Property 14: Mock providers are deterministic** (assistant half)
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**

  - [x]* 9.7 Extend escaping property test to the Seance report
    - Add to `test/render.test.js`
    - **Property 26: Rendered values are escaped** (Seance report)
    - **Validates: Requirements 13.8**

- [x] 10. Checkpoint - The Seance
  - Run `node --test`; existing tests and all new tests must pass. Ask the user if questions arise.

- [x] 11. Documentation and final checks
  - [x] 11.1 Update `README.md`
    - Document every environment variable: `VISION_PROVIDER`, `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL`, `NOTIFIER`, `SEANCE_PROVIDER`, `SEANCE_API_KEY`, `SEANCE_MODEL`, `SEANCE_ADMIN_TOKEN`, `DATA_DIR`, plus `PORT`, `BASE_URL`, and `TRUST_PROXY` (without it every client shares one rate-limit bucket behind a proxy)
    - Describe new routes (`/rise`, `/mcp`, `/api/verify/:id`, `/seance/:id`), the storage relaxation, and the `curl` upload example
    - Add a note that the "Owner-confirmed" stamp is a tamper check (the listing is unchanged since the owner confirmed it), not proof of ownership or identity, and that real ownership checks (a phone or email code sent to the listed number) are future work
    - Use "old printed phone book", "classic phone-book look", or "local business directory"; never the trademarked terms
    - _Requirements: 14.5, 14.7_

  - [ ]* 11.2 Write final cross-cutting tests
    - Extend `test/app.test.js`: `GET /data/listings.json` returns 404; README mentions every env var; only allow-listed files (`drafts.json`, `published.json`, `verified.json`, `quotes.json`, `seance.json`) appear in a temp `DATA_DIR` after exercising all features; no forbidden trademark terms or walking-fingers logo references in new files under `server/`, `public/`, `test/`, `README.md`, and `.kiro/specs/super-pages/`
    - _Requirements: 14.1, 14.2, 14.5, 14.7, 15.1, 15.6, 15.7_

- [x] 12. Final checkpoint - Full suite
  - Run `node --test`; the entire suite, including all pre-existing tests, must pass. Ask the user if questions arise.

- [ ] 13. Launch fixes: Nothing goes live unreviewed
  - [x] 13.1 Build the approval queue
    - Add `pending` to the `collection(name)` allow-list in `server/data.js`; confirming a draft at `/rise` now sets the draft status to `pending` and adds `{ id, draftId, submittedAt }` to `pending`; it no longer publishes
    - Keep `store.publishDraft` as the internal publish step; extend it to accept a draft in status `pending` (still 409 for other statuses, still idempotent on `published`); approve calls it, so the `verified.json` stamp is written at approval
    - Add `store.unpublish(id)`: removes a published (not seed) listing from `published.json` and the in-memory snapshot, marks its pending entry `unpublished`; seed listings from `listings.json` return 409
    - Create `server/lib/admin-auth.js`: `ADMIN_TOKEN` bearer check (SHA-256 both values, then `crypto.timingSafeEqual`), `SEANCE_ADMIN_TOKEN` accepted as a fallback name; 403 when neither is configured, 401 for a missing or wrong token; add `adminToken` handling to `server/lib/config.js`
    - Create `server/routes/admin.js` (wired in `server/app.js`): `GET /admin/pending` (HTML list, escaped values, `Cache-Control: no-store`, `X-Robots-Tag: noindex`), `POST /admin/pending/:id/approve`, `POST /admin/pending/:id/reject` (draft status `rejected`, nothing published), `POST /admin/listings/:id/unpublish`; unknown id 404
    - Switch `server/routes/seance.js` to the shared admin-auth helper
    - Update `server/routes/rise.js` confirm to redirect to the draft page with a pending message instead of `/listings/:id`
    - Only approved listings may appear on pages, in the sitemap, in llms.txt, in JSON-LD and in MCP; pending, rejected, and unpublished entries are excluded by construction
    - Files: `server/data.js`, `server/lib/admin-auth.js`, `server/lib/config.js`, `server/lib/drafts.js`, `server/routes/admin.js`, `server/routes/rise.js`, `server/routes/seance.js`, `server/app.js`
    - _Requirements: docs/launch-fixes.md section 13 (13.1)_

  - [x] 13.2 Collapse control characters in single-line fields
    - In `server/lib/listing-fields.js` `clean()`, turn every newline and control character into one space for single-line fields (name, phone, address, city, state, category, website, hours); only `description` may keep line breaks
    - `server/lib/llms.js` must print `description` on a single line (collapse its line breaks when writing llms.txt)
    - Files: `server/lib/listing-fields.js`, `server/lib/llms.js`
    - _Requirements: docs/launch-fixes.md section 13 (13.2)_

  - [x] 13.3 Rate limits behind Render
    - Set Express `trust proxy` in `server/app.js` from `TRUST_PROXY` as a hop count (integer); default `1` when `NODE_ENV=production`; never `true` (reject or ignore `true` and non-integer values)
    - Add an `admin-auth` rule to `RULES` in `server/lib/rate-limiter.js`: 10 wrong-token attempts per hour per IP, checked in `server/lib/admin-auth.js`, 429 with `Retry-After`; a correct token does not consume budget
    - Files: `server/app.js`, `server/lib/config.js`, `server/lib/rate-limiter.js`, `server/lib/admin-auth.js`
    - _Requirements: docs/launch-fixes.md section 13 (13.3)_

  - [x] 13.4 Update existing tests for the pending flow
    - `test/rise.test.js`, `test/verify.test.js`, `test/render.test.js`, `test/seance-history.test.js`, and `test/mcp.test.js` rely on direct publish through `store.publishDraft` or `/rise` confirm; change them so confirm lands in `pending`, then an admin approve (with `ADMIN_TOKEN` set in the test app) publishes
    - Where a test calls `store.publishDraft` directly as a fixture shortcut, keep it (it is still the internal publish step); where it goes through the confirm route, add the approve call before asserting on `/listings/:id`, `/`, `/llms.txt`, `/sitemap.xml`, JSON-LD, or MCP
    - All pre-existing tests stay green
    - Files: `test/rise.test.js`, `test/verify.test.js`, `test/render.test.js`, `test/seance-history.test.js`, `test/mcp.test.js`
    - _Requirements: docs/launch-fixes.md section 13 (13.1)_

  - [-] 13.5 Write tests for the approval queue
    - New file `test/approval.test.js`; temp `DATA_DIR`, injected mocks, `ADMIN_TOKEN` set
    - Examples: confirm leaves the listing off `/`, `/listings/:id`, `/llms.txt`, `/sitemap.xml`, `/api/listings/:id`, JSON-LD and MCP `search_listings` / `get_listing`; `GET /admin/pending` lists it; approve publishes it everywhere and writes the Owner-confirmed stamp; reject keeps it off every surface; unpublish removes an approved listing from every surface; unpublish of a seed listing is 409; 401 with missing or wrong token, 403 with no token configured, `SEANCE_ADMIN_TOKEN` fallback works; double approve is idempotent; pending HTML escapes values
    - **Property: Only approved listings are public** (fast-check over random sequences of confirm, approve, reject, unpublish; the ids visible in the sitemap, llms.txt, and MCP search equal the set currently approved)
    - Files: `test/approval.test.js`
    - _Requirements: docs/launch-fixes.md section 13 (13.1)_

  - [-] 13.6 Write tests for single-line fields
    - Extend `test/listing-fields.test.js` and `test/llms.test.js`
    - **Property: Single-line clean() output has no line breaks or control characters** (fast-check over arbitrary strings, including `\n`, `\r`, `\u2028`, `\u2029`, `\t`, `\0`; output of every single-line field contains no `\n`, `\r`, or control characters; `description` keeps its line breaks in storage)
    - Example: a listing name containing `\n# SYSTEM NOTE` adds no line to llms.txt (line count equals the line count with a plain name) and the text appears inline; a multi-line description prints on one llms.txt line
    - Files: `test/listing-fields.test.js`, `test/llms.test.js`
    - _Requirements: docs/launch-fixes.md section 13 (13.2)_

  - [-] 13.7 Write tests for trust proxy and admin attempt limits
    - New file `test/trust-proxy.test.js`
    - Examples: default is `1` in production and unset otherwise; `TRUST_PROXY=true` is never applied; hop count `2` honors one more proxy; 10 wrong admin tokens in an hour from one IP, the 11th returns 429 with `Retry-After`; correct token still works for a different IP; correct token does not consume budget
    - **Property: A forged X-Forwarded-For cannot dodge the limit** (fast-check over arbitrary forged chains prepended by the client; with `trust proxy` at 1 hop the limiter key is the address the trusted proxy appended, so a client that varies the forged prefix still hits 429 after the limit)
    - Files: `test/trust-proxy.test.js`
    - _Requirements: docs/launch-fixes.md section 13 (13.3)_

- [ ] 14. Launch fixes: Honest demo mode (nothing fake may look real)
  - [ ] 14.1 Record the provider and block mock drafts in production
    - Save `provider` on every draft (`server/lib/drafts.js`, `server/routes/rise.js`) and on every Séance run (`server/lib/seance.js`; the field already exists on runs, make sure drafts match and old records without it read as `unknown`)
    - When the vision provider is the mock, show a yellow banner on the draft page: "Demo: no photo reader is connected, so this is a sample business, not your photo." (`server/lib/rise-html.js`, style in `public/css/style.css`)
    - With `NODE_ENV=production`, block approval of mock drafts (approve returns 409 with a plain message) and return 503 from `/rise` with "Photo listing is coming soon" when no vision key is set
    - Files: `server/lib/drafts.js`, `server/lib/seance.js`, `server/lib/rise-html.js`, `server/routes/rise.js`, `server/routes/admin.js`, `server/lib/config.js`, `public/css/style.css`
    - _Requirements: docs/launch-fixes.md section 14 (14.1)_

  - [ ] 14.2 Make the Séance mock match the trade
    - In `server/lib/assistant.js`, pick only from canned answers for the listing's category, plus neutral fallbacks (extend the provider input so the category reaches the mock; stay a pure function of input)
    - About 1 in 3 demo answers names the business so before-and-after can show change; keep the "Demo answer (no AI connected)" label
    - Files: `server/lib/assistant.js`, `server/lib/seance.js`
    - _Requirements: docs/launch-fixes.md section 14 (14.2)_

  - [ ] 14.3 Add the sample-data banner and DEMO_MODE
    - Add `DEMO_MODE` to `server/lib/config.js` (default true unless `NODE_ENV=production`)
    - When on, add a site-wide footer line "Sample listings for demonstration" and `<meta name="robots" content="noindex">` in `layout()` in `server/lib/html.js`
    - In production, leave the sample (seed) listings out of the sitemap and llms.txt (`server/lib/sitemap.js`, `server/lib/llms.js`)
    - Files: `server/lib/config.js`, `server/lib/html.js`, `server/lib/sitemap.js`, `server/lib/llms.js`, `server/app.js`
    - _Requirements: docs/launch-fixes.md section 14 (14.3)_

  - [ ] 14.4 Write tests for the provider record and mock-draft blocking
    - Extend `test/rise.test.js` and `test/approval.test.js`
    - Examples: every draft and every Séance run carries `provider`; mock draft page shows the exact yellow banner text; real-provider draft shows no banner; in production a mock draft cannot be approved (409) and nothing is published; production with no vision key gives 503 "Photo listing is coming soon" from `/rise`; outside production mock approval still works
    - **Property: Every stored draft records a known provider name** (fast-check over uploads from generated image bytes)
    - Files: `test/rise.test.js`, `test/approval.test.js`
    - _Requirements: docs/launch-fixes.md section 14 (14.1)_

  - [ ] 14.5 Write tests for the trade-matched Séance mock
    - Extend `test/seance.test.js` and `test/providers.test.js`
    - **Property: Mock answers come only from the listing's category pool plus neutral fallbacks, and are deterministic** (fast-check over categories and prompts)
    - Example: across a fixed set of generated prompts, the share of answers naming the business is about one in three (within a stated tolerance); the "Demo answer (no AI connected)" label is still present
    - Files: `test/seance.test.js`, `test/providers.test.js`
    - _Requirements: docs/launch-fixes.md section 14 (14.2)_

  - [ ] 14.6 Write tests for DEMO_MODE
    - New file `test/demo-mode.test.js`
    - Examples: default true outside production and false in production; footer line "Sample listings for demonstration" and `noindex` meta present when on, absent when off; in production seed listings are absent from `/sitemap.xml` and `/llms.txt`; approved owner listings still appear in production
    - **Property: With DEMO_MODE on, every HTML page contains the footer line and the noindex meta** (fast-check over the set of public routes and listing ids)
    - Files: `test/demo-mode.test.js`
    - _Requirements: docs/launch-fixes.md section 14 (14.3)_

  - [ ] 14.7 Checkpoint - Safety and honest demo mode
    - Run `node --test`; all tests for tasks 13 and 14 and all pre-existing tests must pass. Ask the user if questions arise.

- [ ] 15. Launch fixes: Quotes say only what's true
  - [ ] 15.1 Correct the quote confirmation wording
    - Replace "The business will contact you" (`server/routes/listings.js` around line 86 and `server/lib/mcp.js` around line 141) with: "Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at {phone}."
    - Use the listing's phone; escape it in HTML
    - Files: `server/routes/listings.js`, `server/lib/mcp.js`
    - _Requirements: docs/launch-fixes.md section 15 (wording fix)_

  - [ ] 15.2 Add `ownerEmail` and `GET /admin/quotes`
    - Add optional `ownerEmail` to the listing fields in `server/lib/listing-fields.js` (single-line clean, simple email check, may be empty); never rendered on pages, never in JSON-LD, `/api/listings/:id`, llms.txt, sitemap, or MCP output, and not part of the public listing JSON
    - Hash rule: `ownerEmail` is stripped before hashing in `server/lib/canonical.js` / `verifier.js` so the stamp does not depend on a private field
    - Add `GET /admin/quotes` in `server/routes/admin.js` (admin token, same helper and rate limit as 13.1 and 13.3): saved quotes, newest first, escaped, `no-store`, `noindex`
    - Files: `server/lib/listing-fields.js`, `server/lib/verifier.js`, `server/lib/html.js`, `server/lib/schema.js`, `server/lib/mcp.js`, `server/routes/api.js`, `server/routes/admin.js`
    - _Requirements: docs/launch-fixes.md section 15 (ownerEmail and admin quotes)_

  - [ ] 15.3 Fix notifier memory and set retention
    - In `server/lib/notifier.js`, cap or drop the in-memory `sent` list outside tests so quotes are not kept forever (the mock keeps its array; real notifiers keep none)
    - Keep quotes 180 days and expire drafts after 30 days: prune on startup and on write, through the queued `updateJsonFile` path; a draft in `pending` or `published` is not expired by the 30-day rule
    - Files: `server/lib/notifier.js`, `server/lib/quotes.js`, `server/lib/drafts.js`, `server/data.js`
    - _Requirements: docs/launch-fixes.md section 15 (retention)_

  - [ ] 15.4 Correct the README quote limit
    - State that the per-listing quote limit is per client per listing (3 per hour per client per listing), not per listing overall
    - Files: `README.md`
    - _Requirements: docs/launch-fixes.md section 15 (README fix)_

  - [ ] 15.5 Write tests for the quote wording
    - Extend `test/quotes.test.js` and `test/mcp.test.js`
    - Examples: the HTML confirmation and the MCP result contain the new sentence with the listing phone; the old phrase "The business will contact you" appears nowhere under `server/`
    - **Property: The confirmation always names the listing phone and escapes it** (fast-check over generated phones and names)
    - Files: `test/quotes.test.js`, `test/mcp.test.js`
    - _Requirements: docs/launch-fixes.md section 15 (wording fix)_

  - [ ] 15.6 Write tests for `ownerEmail` and `/admin/quotes`
    - New file `test/admin-quotes.test.js`
    - Examples: `GET /admin/quotes` returns 401/403 without a token, saved quotes newest first with a valid token, escaped output
    - **Property: ownerEmail never appears in any public output** (fast-check over generated emails; check listing page, JSON-LD, `/api/listings/:id`, llms.txt, sitemap, MCP `get_listing`)
    - Example: changing `ownerEmail` does not change the stamp hash
    - Files: `test/admin-quotes.test.js`
    - _Requirements: docs/launch-fixes.md section 15 (ownerEmail and admin quotes)_

  - [ ] 15.7 Write tests for retention and notifier memory
    - New file `test/retention.test.js`; fake clock
    - **Property: Pruning keeps exactly the quotes younger than 180 days and exactly the unpublished drafts younger than 30 days** (fast-check over generated timestamps)
    - Examples: pending and published drafts survive the 30-day rule; the production notifier does not accumulate a `sent` list across many quotes
    - Files: `test/retention.test.js`
    - _Requirements: docs/launch-fixes.md section 15 (retention)_

  - [ ] 15.8 Write a test for the README quote limit
    - Extend `test/app.test.js`: README text says the quote limit is per client per listing
    - Files: `test/app.test.js`
    - _Requirements: docs/launch-fixes.md section 15 (README fix)_

- [ ] 16. Launch fixes: Deploy-ready on Render
  - [ ] 16.1 Split read-only seed data from writable data
    - Read `listings.json` and `categories.json` from the repo `data/` folder; write only `drafts`, `pending`, `published`, `quotes`, `seance`, and `verified` files to `DATA_DIR` (update `createDataStore` and `configFromEnv`)
    - Refuse to start when there are 0 categories; in production, refuse to start when `DATA_DIR` or `BASE_URL` is missing (clear one-line error, exit code 1 from `server/index.js`)
    - Files: `server/data.js`, `server/lib/config.js`, `server/index.js`, `render.yaml`
    - _Requirements: docs/launch-fixes.md section 16 (data folders and startup checks)_

  - [ ] 16.2 Add `GET /healthz`
    - Return `{ ok: true }` with 200, no data access, no rate limit
    - Files: `server/app.js`
    - _Requirements: docs/launch-fixes.md section 16 (healthz)_

  - [ ] 16.3 Set engines and start script
    - Add `"engines": { "node": "22.x" }` to `package.json`; make sure `npm start` runs `node server/index.js`
    - Files: `package.json`
    - _Requirements: docs/launch-fixes.md section 16 (engines and start)_

  - [ ] 16.4 Fix the error handler
    - Respect `err.status` (for example 400 for a malformed URL id from `decodeURIComponent` failures); unknown errors give 500 with a plain message; never send a stack trace and never include `err.message` for 5xx
    - Files: `server/app.js`
    - _Requirements: docs/launch-fixes.md section 16 (error handler)_

  - [ ] 16.5 Turn off `x-powered-by` and add security headers
    - `app.disable('x-powered-by')`; middleware sets `X-Content-Type-Options: nosniff`, `Referrer-Policy` (for example `strict-origin-when-cross-origin`), and `Content-Security-Policy: frame-ancestors 'none'`; keep the stricter `no-referrer` on draft pages
    - Files: `server/app.js`
    - _Requirements: docs/launch-fixes.md section 16 (headers)_

  - [ ] 16.6 Answer `OPTIONS /mcp`
    - Return 204 with `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Headers` allowing `content-type`, `accept`, and `mcp-session-id`; also allow `POST, OPTIONS`; add `Access-Control-Allow-Origin: *` to POST /mcp replies
    - Files: `server/routes/mcp.js`
    - _Requirements: docs/launch-fixes.md section 16 (CORS preflight)_

  - [ ] 16.7 Remove hard-coded `localhost` from the Rise curl example
    - In `server/lib/rise-html.js`, build the curl example from `BASE_URL` (passed through `ctx.config`), escaped
    - Files: `server/lib/rise-html.js`, `server/routes/rise.js`
    - _Requirements: docs/launch-fixes.md section 16 (curl example)_

  - [ ] 16.8 Add `SITE_NAME`
    - Add `siteName` to `server/lib/config.js` (default "First Answer Pages") and use it everywhere the site name shows: `layout()` header and title, footer, llms.txt header, sitemap-adjacent text, Rise and Séance pages, JSON-LD publisher fields if any, MCP `serverInfo` title (keep `serverInfo.name` `first-answer-pages`)
    - Files: `server/lib/config.js`, `server/lib/html.js`, `server/lib/llms.js`, `server/lib/rise-html.js`, `server/lib/seance-html.js`, `server/lib/mcp.js`, `server/lib/schema.js`, `server/app.js`
    - _Requirements: docs/launch-fixes.md section 16 (SITE_NAME)_

  - [ ] 16.9 Write tests for data folders and startup checks
    - New file `test/data-dir.test.js`
    - Examples: seed files are read from repo `data/` even when `DATA_DIR` points elsewhere; writable files appear only in `DATA_DIR`; `listings.json` and `categories.json` are never written; 0 categories refuses to start; production without `DATA_DIR` or without `BASE_URL` refuses to start; non-production starts without them
    - **Property: After any sequence of app actions, the only files in DATA_DIR are the allow-listed writable files** (fast-check over action sequences)
    - Files: `test/data-dir.test.js`
    - _Requirements: docs/launch-fixes.md section 16 (data folders and startup checks)_

  - [ ] 16.10 Write tests for healthz, engines, and start script
    - New file `test/healthz.test.js`
    - Examples: `GET /healthz` returns 200 `{ ok: true }`; `package.json` has `engines.node` `22.x` and `scripts.start` `node server/index.js`
    - Files: `test/healthz.test.js`
    - _Requirements: docs/launch-fixes.md section 16 (healthz, engines and start)_

  - [ ] 16.11 Write tests for errors and headers
    - New file `test/errors-headers.test.js`
    - **Property: Malformed ids never produce a 500 or a stack trace** (fast-check over arbitrary strings, including invalid percent-encoding such as `%E0%A4%A`; status is below 500 or a plain 500 body with no `at ` stack lines)
    - Examples: malformed id returns 400; thrown errors with `err.status` keep it; 5xx bodies contain no stack or file paths; no `X-Powered-By`; `nosniff`, referrer policy, and `frame-ancestors 'none'` present on HTML, JSON, and error responses
    - Files: `test/errors-headers.test.js`
    - _Requirements: docs/launch-fixes.md section 16 (error handler, headers)_

  - [ ] 16.12 Write tests for the MCP preflight and curl example
    - Extend `test/mcp.test.js` and `test/rise.test.js`
    - Examples: `OPTIONS /mcp` returns 204 with `Access-Control-Allow-Origin: *` and allowed headers containing `content-type`, `accept`, `mcp-session-id`; `/rise` HTML shows `BASE_URL` in the curl example and the string `localhost` appears nowhere in `server/lib/rise-html.js`
    - Files: `test/mcp.test.js`, `test/rise.test.js`
    - _Requirements: docs/launch-fixes.md section 16 (CORS preflight, curl example)_

  - [ ] 16.13 Write tests for `SITE_NAME`
    - New file `test/site-name.test.js`
    - **Property: A custom SITE_NAME appears in the header, title, and llms.txt and the default name appears nowhere** (fast-check over safe generated names, escaped in HTML)
    - Example: default is "First Answer Pages"
    - Files: `test/site-name.test.js`
    - _Requirements: docs/launch-fixes.md section 16 (SITE_NAME)_

  - [ ] 16.14 Checkpoint - Deploy-ready
    - Run `node --test`; all tests for tasks 13 to 16 and all pre-existing tests must pass. Ask the user if questions arise.

- [ ] 17. Launch fixes: Owner-friendly wording and flow
  - [ ] 17.1 Header link, unconfirmed note, and Séance link
    - Add a header link "List your business free" pointing to `/rise` in `layout()`
    - On every unconfirmed listing, replace the large "NOT YET CONFIRMED BY THE OWNER" box with a smaller note plus a button "Is this your business? Confirm it free →" linking to `/rise`
    - Add a link "See what AI says about this business" to the listing's Séance report (`/seance/:id`)
    - Files: `server/lib/html.js`, `public/css/style.css`
    - _Requirements: docs/launch-fixes.md section 17 (header, unconfirmed note, Séance link)_

  - [ ] 17.2 Simplify the `/rise` page
    - One big "Take or choose a photo" button; hide the base64 text box under an "Advanced" disclosure (`<details>`); say "5 MB", not "5 MiB"; say "a business card, flyer, sign or storefront"
    - Page still works without JavaScript
    - Files: `server/lib/rise-html.js`, `public/js/rise.js`, `public/css/style.css`
    - _Requirements: docs/launch-fixes.md section 17 (/rise page)_

  - [ ] 17.3 Draft page confirm flow and categories
    - Confirm saves the edited fields first, then sends the draft for approval, so edits cannot be lost
    - Add categories for cleaners, landscapers, pressure washing, pools and concrete, shops and restaurants, plus "Other" to `data/categories.json` (JSON only, unique slugs, existing slugs untouched)
    - After confirming, show: "Thanks! We'll review your listing and it will be live soon."
    - Files: `server/routes/rise.js`, `server/lib/rise-html.js`, `data/categories.json`
    - _Requirements: docs/launch-fixes.md section 17 (draft page)_

  - [ ] 17.4 Owner-confirmed stamp date and details toggle
    - Keep the visible wording "Owner-confirmed <date>"; show the date as "Nov 9, 2026" in America/Chicago time (store the confirmation timestamp, for example `verifiedAt`, in `verified.json` alongside the existing UTC `verifiedDate`; the hash input is unchanged)
    - Move the hash and the verify link under a small "Details for AI tools" toggle (`<details>`)
    - Update stamp assertions in `test/verify.test.js` and `test/render.test.js` to the new date format
    - Files: `server/lib/html.js`, `server/data.js`, `server/lib/verifier.js`, `test/verify.test.js`, `test/render.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (Owner-confirmed stamp)_

  - [ ] 17.5 Séance report wording
    - Make the result the headline: "AI named this business" in green, or "AI didn't name this business yet" in amber
    - Hide the word "mock" (the "Demo answer (no AI connected)" label stays)
    - Use the name Séance with its accent in headings; show times in local time (America/Chicago)
    - Files: `server/lib/seance-html.js`, `public/css/style.css`
    - _Requirements: docs/launch-fixes.md section 17 (Séance report)_

  - [ ] 17.6 Quote form errors and success box
    - On error, re-render the form with the visitor's entries kept (escaped) and the message "Please enter a phone number or email."
    - Show the success message at the top of the page in a neutral or green box
    - Files: `server/routes/listings.js`, `server/lib/html.js`, `public/css/style.css`
    - _Requirements: docs/launch-fixes.md section 17 (quote form)_

  - [ ] 17.7 Tappable phone numbers
    - Render phone numbers as `tel:` links (digits only in the `href`) on listing pages, home, and category pages
    - Files: `server/lib/html.js`
    - _Requirements: docs/launch-fixes.md section 17 (tel links)_

  - [ ] 17.8 Category page heading
    - Heading like "Plumbers in Nashville" with the listing grid under one heading
    - Files: `server/routes/home.js`, `server/lib/html.js`, `public/css/style.css`
    - _Requirements: docs/launch-fixes.md section 17 (category page)_

  - [ ] 17.9 Write tests for the header link, unconfirmed note, and Séance link
    - New file `test/nav-and-notes.test.js`
    - Examples: "List your business free" links to `/rise` on every page; unconfirmed listing shows the small note and the "Is this your business? Confirm it free →" button and not the old large box text; confirmed listing shows neither; "See what AI says about this business" links to `/seance/:id`
    - **Property: Every public listing page has the Séance link for its own id** (fast-check over listing ids)
    - Files: `test/nav-and-notes.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (header, unconfirmed note, Séance link)_

  - [ ] 17.10 Write tests for the `/rise` page
    - Extend `test/rise.test.js`
    - Examples: "Take or choose a photo" present; base64 textarea sits inside a `<details>` titled "Advanced"; "5 MB" present and "5 MiB" absent; "a business card, flyer, sign or storefront" present
    - Files: `test/rise.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (/rise page)_

  - [ ] 17.11 Write tests for the draft page flow and categories
    - Extend `test/rise.test.js` and `test/listing-fields.test.js`
    - Examples: confirm with edited fields saves the edits and the pending entry carries them; the thank-you text is shown; the new categories (cleaners, landscapers, pressure washing, pools and concrete, shops and restaurants, other) exist with unique slugs and `mapCategory` resolves them
    - **Property: Confirm never loses edits** (fast-check over edited field values; the draft fields after confirm equal the submitted normalized fields)
    - Files: `test/rise.test.js`, `test/listing-fields.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (draft page)_

  - [ ] 17.12 Write tests for the stamp date and details toggle
    - New file `test/stamp-display.test.js`
    - **Property: The stamp date is formatted in America/Chicago and matches an independent oracle** (fast-check over timestamps, including daylight saving boundaries and 00:00 to 06:00 UTC where the Chicago date is the day before)
    - Examples: wording "Owner-confirmed Nov 9, 2026"; hash and verify link are inside `<details>` "Details for AI tools"; hash value unchanged by the display change
    - Files: `test/stamp-display.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (Owner-confirmed stamp)_

  - [ ] 17.13 Write tests for the Séance report wording
    - Extend `test/seance-history.test.js`
    - Examples: named result shows "AI named this business" with the green class; not named shows "AI didn't name this business yet" with the amber class; the word "mock" is absent from the HTML; times shown in America/Chicago; "Séance" with the accent in headings
    - **Property: The headline matches the latest run's `named` value** (fast-check over run histories)
    - Files: `test/seance-history.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (Séance report)_

  - [ ] 17.14 Write tests for quote form errors and success box
    - Extend `test/quotes.test.js`
    - Examples: invalid contact re-renders the form with name and details kept and "Please enter a phone number or email."; success message appears at the top in a neutral or green box
    - **Property: Re-shown entries are escaped and equal the submitted values** (fast-check over arbitrary strings including `<script>` and quotes)
    - Files: `test/quotes.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (quote form)_

  - [ ] 17.15 Write tests for tappable phone numbers
    - New file `test/tel-links.test.js`
    - **Property: Every rendered phone is a tel: link whose href holds only digits and an optional leading plus** (fast-check over valid phones; link text is the display form)
    - Examples: link present on listing, home, and category pages
    - Files: `test/tel-links.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (tel links)_

  - [ ] 17.16 Write tests for the category page heading
    - New file `test/category-page.test.js`
    - Examples: heading "Plumbers in Nashville" for the matching category and city; one heading above the grid; escaped output
    - **Property: The category heading names the category label and the city, escaped** (fast-check over categories and cities)
    - Files: `test/category-page.test.js`
    - _Requirements: docs/launch-fixes.md section 17 (category page)_

- [ ] 18. Launch fixes: AI basics in llms.txt and the README
  - [ ] 18.1 Improve llms.txt
    - Say how to request a quote: the MCP tool `request_quote` at `/mcp`, and `POST /api/quotes`
    - Mark owner-confirmed listings
    - Do not claim one city in the header when listings span several (list cities, or say "local businesses" when more than one)
    - Keep single-line rules from task 13.2 and the demo exclusions from task 14.3
    - Files: `server/lib/llms.js`, `server/routes/llms.js`
    - _Requirements: docs/launch-fixes.md section 18 (llms.txt)_

  - [ ] 18.2 Rewrite the README
    - Do not use "Super Pages" in README or any user-facing text (Thryv owns the SUPERPAGES trademark); the spec folder name `super-pages` stays as an internal id only
    - Call the features "Owner tools" or name each one (Rise from the Grave, Agent-ready, Owner-confirmed stamp, Séance, with the accent in prose)
    - List every env var: `PORT`, `BASE_URL`, `DATA_DIR`, `ADMIN_TOKEN`, `TRUST_PROXY`, `DEMO_MODE`, `SITE_NAME`, `NODE_ENV`, and the provider keys (`VISION_PROVIDER`, `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL`, `NOTIFIER`, `SEANCE_PROVIDER`, `SEANCE_API_KEY`, `SEANCE_MODEL`, `SEANCE_ADMIN_TOKEN` as a fallback name)
    - Files: `README.md`
    - _Requirements: docs/launch-fixes.md section 18 (README)_

  - [ ] 18.3 Write tests for llms.txt
    - Extend `test/llms.test.js`
    - Examples: output mentions `request_quote`, `/mcp`, and `POST /api/quotes`; owner-confirmed listings are marked and unconfirmed are not; a multi-city data set does not claim one city in the header; a one-city set may name it
    - **Property: The header never names a single city unless every listing is in that city** (fast-check over generated listing sets)
    - Files: `test/llms.test.js`
    - _Requirements: docs/launch-fixes.md section 18 (llms.txt)_

  - [ ] 18.4 Write tests for the README
    - Extend `test/app.test.js`
    - Examples: README contains every env var listed in 18.2; README does not contain "Super Pages" or "SUPERPAGES" (case-insensitive); no "Yellow Pages", "YP", or walking-fingers references; user-facing strings under `server/` and `public/` do not contain "Super Pages"
    - **Property: Every env var read by server/lib/config.js appears in the README** (scan `process.env` / `env.NAME` names in `server/` and check each is documented)
    - Files: `test/app.test.js`
    - _Requirements: docs/launch-fixes.md section 18 (README)_

  - [ ] 18.5 Checkpoint - AI basics and README
    - Run `node --test`; all tests for tasks 13 to 18 and all pre-existing tests must pass. Ask the user if questions arise.

- [ ] 19. Final checkpoint - Full suite
  - Run `node --test`; the entire suite, including all pre-existing tests and the tests for tasks 13 to 18, must be green. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; each property test runs at least 100 iterations (200 for Properties 1 to 4 and 9) and carries the comment `// Feature: super-pages, Property N: <title>`.
- Requirements gaps resolved in the design must be reflected in the implementation, not the original requirement text:
  - Description, city, and state are validated (non-empty description and city, two uppercase letters for state) and block confirmation, because `buildSchema` throws without them (tasks 1.5, 3.1, 3.5).
  - Requirement 11.8 is weakened to the form in Property 22: `named: true` stays true after adding affixes, and `named` is unchanged only for disjoint-alphabet affixes (tasks 9.2, 9.4).
  - Discard returns 409 for drafts in `publishing` or `published` status, so a published listing never loses its audit link (tasks 3.4, 3.5, 3.9).
  - The only real Notifier is `console`; there is no owner email field (task 5.2).
  - The no-JS upload form carries a base64 textarea; `public/js/rise.js` adds a file picker as progressive enhancement (task 3.5).
  - WebMCP reads `navigator.modelContext` first and falls back to `document.modelContext` (task 5.5).
- Existing tests (`test/api.test.js`, `test/html.test.js`, `test/listings.test.js`, `test/llms.test.js`, `test/schema.test.js`, `test/sitemap.test.js`) must stay green throughout; all changes to existing modules are additive.
- Trademark rule applies to all code, docs, comments, and tests: never use the words "Yellow Pages" or "YP", or any walking-fingers logo. Use "old printed phone book" or "classic phone-book look".
- Tests never call the network and never touch the repo `data/` directory; they use mocks and a temporary `DATA_DIR`.
- No terminal-only or deployment tasks are included; checkpoints run the automated suite only.
- Tasks 13 to 18 come from `docs/launch-fixes.md` (sections 13 to 18) and are built in order; every sub-task has required (not optional) tests. Task 19 is the final checkpoint and is not a section of that file. Launch-fix tasks cite "docs/launch-fixes.md section N" instead of requirement numbers.
- The approval queue (13.1) changes Rise confirm: confirm goes to `pending`, then admin approve publishes. `store.publishDraft` stays as the internal publish step that approve calls. The visible wording "Owner-confirmed" stays.
- Trademark: never use "Super Pages" in the README or any user-facing text. The spec folder name `super-pages` is an internal id and stays.
- After completing this plan, begin executing tasks by opening this file and clicking "Start task" next to a task item.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5", "1.7", "1.8", "1.9", "1.10"] },
    { "id": 2, "tasks": ["1.6"] },
    { "id": 3, "tasks": ["3.1", "3.2", "3.4"] },
    { "id": 4, "tasks": ["3.3", "3.6", "3.7"] },
    { "id": 5, "tasks": ["3.5", "3.8"] },
    { "id": 6, "tasks": ["3.9", "3.10"] },
    { "id": 7, "tasks": ["5.1", "5.2", "5.5", "5.6"] },
    { "id": 8, "tasks": ["5.3", "5.4", "5.7"] },
    { "id": 9, "tasks": ["5.8", "5.9", "5.10", "5.11"] },
    { "id": 10, "tasks": ["7.1"] },
    { "id": 11, "tasks": ["7.2"] },
    { "id": 12, "tasks": ["7.3", "7.4"] },
    { "id": 13, "tasks": ["9.1", "9.2"] },
    { "id": 14, "tasks": ["9.3", "9.4", "9.6"] },
    { "id": 15, "tasks": ["9.5", "9.7"] },
    { "id": 16, "tasks": ["11.1"] },
    { "id": 17, "tasks": ["11.2"] },
    { "id": 18, "tasks": ["13.1", "13.2"] },
    { "id": 19, "tasks": ["13.3", "13.4"] },
    { "id": 20, "tasks": ["13.5", "13.6", "13.7"] },
    { "id": 21, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 22, "tasks": ["14.4", "14.5", "14.6"] },
    { "id": 23, "tasks": ["15.1", "15.2"] },
    { "id": 24, "tasks": ["15.3", "15.4"] },
    { "id": 25, "tasks": ["15.5", "15.6", "15.7", "15.8"] },
    { "id": 26, "tasks": ["16.1", "16.3"] },
    { "id": 27, "tasks": ["16.2", "16.6", "16.7"] },
    { "id": 28, "tasks": ["16.4"] },
    { "id": 29, "tasks": ["16.5"] },
    { "id": 30, "tasks": ["16.8"] },
    { "id": 31, "tasks": ["16.9", "16.10", "16.11", "16.12", "16.13"] },
    { "id": 32, "tasks": ["17.1", "17.2", "17.5"] },
    { "id": 33, "tasks": ["17.3", "17.4"] },
    { "id": 34, "tasks": ["17.6"] },
    { "id": 35, "tasks": ["17.7"] },
    { "id": 36, "tasks": ["17.8"] },
    { "id": 37, "tasks": ["17.9", "17.10", "17.11", "17.12", "17.13", "17.14", "17.15", "17.16"] },
    { "id": 38, "tasks": ["18.1", "18.2"] },
    { "id": 39, "tasks": ["18.3", "18.4"] }
  ]
}
```
