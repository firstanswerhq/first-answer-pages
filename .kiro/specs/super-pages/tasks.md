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

- [ ] 10. Checkpoint - The Seance
  - Run `node --test`; existing tests and all new tests must pass. Ask the user if questions arise.

- [ ] 11. Documentation and final checks
  - [ ] 11.1 Update `README.md`
    - Document every environment variable: `VISION_PROVIDER`, `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL`, `NOTIFIER`, `SEANCE_PROVIDER`, `SEANCE_API_KEY`, `SEANCE_MODEL`, `SEANCE_ADMIN_TOKEN`, `DATA_DIR`, plus `PORT`, `BASE_URL`, and `TRUST_PROXY` (without it every client shares one rate-limit bucket behind a proxy)
    - Describe new routes (`/rise`, `/mcp`, `/api/verify/:id`, `/seance/:id`), the storage relaxation, and the `curl` upload example
    - Add a note that the "Owner-confirmed" stamp is a tamper check (the listing is unchanged since the owner confirmed it), not proof of ownership or identity, and that real ownership checks (a phone or email code sent to the listed number) are future work
    - Use "old printed phone book", "classic phone-book look", or "local business directory"; never the trademarked terms
    - _Requirements: 14.5, 14.7_

  - [ ]* 11.2 Write final cross-cutting tests
    - Extend `test/app.test.js`: `GET /data/listings.json` returns 404; README mentions every env var; only allow-listed files (`drafts.json`, `published.json`, `verified.json`, `quotes.json`, `seance.json`) appear in a temp `DATA_DIR` after exercising all features; no forbidden trademark terms or walking-fingers logo references in new files under `server/`, `public/`, `test/`, `README.md`, and `.kiro/specs/super-pages/`
    - _Requirements: 14.1, 14.2, 14.5, 14.7, 15.1, 15.6, 15.7_

- [ ] 12. Final checkpoint - Full suite
  - Run `node --test`; the entire suite, including all pre-existing tests, must pass. Ask the user if questions arise.

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
    { "id": 17, "tasks": ["11.2"] }
  ]
}
```
