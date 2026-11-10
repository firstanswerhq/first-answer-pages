# Requirements Document

## Introduction

Super Pages extends First Answer Pages, the finished spec `listings-and-ai-readable-pages`, into the first local directory built for AI agents. Old businesses rise from the grave into the AI age. Four features ship in this build order:

1. **Rise from the Grave**: an owner uploads a photo of an old phone-book ad, business card, or truck door. A vision model extracts the business details into a DRAFT listing. The owner reviews and confirms the draft before it is published.
2. **Agent-ready**: an MCP server at `/mcp` (Streamable HTTP) exposes `search_listings`, `get_listing`, and `request_quote`. Listing pages register matching WebMCP tools in the browser. An A2A agent card is published only when a real agent endpoint backs it.
3. **Owner-confirmed stamp**: a SHA-256 hash of a canonical JSON form of each listing plus its confirmation date is shown on the page as "Owner-confirmed <date>", included in the JSON-LD, and checkable at `GET /api/verify/:id`. The hash is a tamper check: it shows the listing is unchanged since the owner confirmed it.
4. **The Seance**: the system runs AI-assistant prompts such as "best plumbers in Nashville" and reports whether a business was named, with before/after history.

The classic phone-book look is kept. A Halloween skin is a separate later layer and is out of scope for this spec. The words "Yellow Pages" and "YP", and any walking-fingers logo, are not used anywhere in this feature.

### Stamp Does Not Prove Ownership

The Owner-confirmed stamp does not prove that the person who confirmed a Draft owns the business, and it is not identity verification. Nothing in this spec checks who the confirming person is. The Verification_Hash only shows that the Listing is unchanged since the owner confirmed it. Real ownership checks, such as a phone or email code sent to the listed number, are future work and out of scope for this spec. The identifiers `verifiedDate`, `Verified_Date`, `Verification_Hash`, `Verifier`, `verified.json`, and `/api/verify/:id` are kept for stability; they are internal names, and the visible wording is "Owner-confirmed".

### Storage Rule Relaxation

The existing rule "no write-back from the web layer in v1" is deliberately relaxed by this spec, for three collections only: drafts, quote requests, and seance history. These writes are confined to dedicated JSON files under `data/`, separate from `data/listings.json`. The Server never writes to `data/listings.json` from a web request while a draft is unconfirmed. Listing publication from a confirmed draft is the only path that adds to the published listing set (see Requirement 4).

### Tech Constraints

Node.js 22, plain Express, plain JavaScript ES modules, JSON files in `data/`, built-in `fetch` for all provider calls, `node:test` plus `fast-check` for tests. No dependencies are added beyond `express` (production) and `fast-check` (dev). Because no multipart parsing library is approved, uploads are accepted as raw image bodies or base64 JSON parsed with Express built-ins and Node built-ins.

## Glossary

- **Server**: The Express application running under Node.js 22.
- **Listing**: A published business record stored in `data/listings.json`, as defined in the prior spec.
- **Draft**: A candidate listing produced by extraction and stored in `data/drafts.json`. A Draft is not part of the published directory.
- **Draft_Store**: The module that reads and writes `data/drafts.json`.
- **Owner**: The person who uploads an image and confirms or discards a Draft.
- **Upload_Handler**: The Server component that receives and validates uploaded images.
- **Vision_Provider**: A pluggable module that takes an image and returns raw extracted fields.
- **Mock_Vision_Provider**: A deterministic Vision_Provider that needs no network access or API key.
- **Extractor**: The Server component that calls the Vision_Provider and normalizes its output into Draft fields.
- **Extraction_Validator**: The function that checks extracted fields against the Listing data model.
- **MCP_Endpoint**: The Streamable HTTP Model Context Protocol endpoint at `/mcp`.
- **MCP_Tool**: One of `search_listings`, `get_listing`, or `request_quote`.
- **Tool_Validator**: The function that checks MCP_Tool input against each tool's input schema.
- **Quote_Request**: A record created by `request_quote`, stored in `data/quotes.json`.
- **Quote_Store**: The module that reads and writes `data/quotes.json`.
- **Notifier**: A pluggable module that tells a business owner about a new Quote_Request.
- **Mock_Notifier**: A Notifier that records notifications in memory and sends nothing.
- **WebMCP_Script**: The optional browser script in `public/js/` that registers tools through `navigator.modelContext`.
- **Agent_Card**: The A2A agent card JSON document served at `/.well-known/agent-card.json`.
- **Canonical_Form**: The deterministic JSON serialization of a Listing used for hashing: object keys sorted recursively in code-point order, no insignificant whitespace, UTF-8 encoded, array order preserved.
- **Verified_Date**: The ISO 8601 calendar date (`YYYY-MM-DD`) on which an Owner last confirmed a Listing. It is shown to visitors as "Owner-confirmed <date>". It does not prove that the confirming person owns the business.
- **Verification_Hash**: The lowercase hexadecimal SHA-256 digest of the Canonical_Form of a Listing together with its Verified_Date. It is a tamper check showing the Listing is unchanged since the owner confirmed it, and it is not proof of ownership or identity.
- **Verifier**: The Server component that computes a Verification_Hash and handles `GET /api/verify/:id`. It checks for changes to a Listing and does not check who owns the business.
- **Seance**: The feature that runs AI-assistant prompts and records whether a business was named.
- **Seance_Prompt**: A prompt string built from the template `best <category> in <city>`.
- **Assistant_Provider**: A pluggable module that sends a Seance_Prompt to an AI assistant and returns its text answer.
- **Mock_Assistant_Provider**: A deterministic Assistant_Provider used in tests and when no API key is set.
- **Seance_Run**: One record of a Seance_Prompt result, stored in `data/seance.json`.
- **Seance_Store**: The module that reads and writes `data/seance.json`.
- **Rate_Limiter**: The in-memory component that caps request frequency per client key.

## Requirements

### Requirement 1: Image Upload Validation (Rise from the Grave)

**User Story:** As a business owner, I want to upload a photo of my old ad, card, or truck door, so that I can start a listing without typing everything by hand.

#### Acceptance Criteria

1. WHEN a client sends `POST /rise` with a raw request body and a `Content-Type` of `image/jpeg`, `image/png`, or `image/webp`, THE Upload_Handler SHALL accept the upload for extraction, provided the body is non-empty, is at most 5 MiB (5,242,880 bytes), and passes the signature check in criterion 5.
2. IF the body of an upload exceeds 5 MiB (5,242,880 bytes), THEN THE Upload_Handler SHALL reject the upload with HTTP status 413, SHALL stop reading the body, and SHALL retain no image bytes.
3. IF the `Content-Type` of an upload is not one of `image/jpeg`, `image/png`, `image/webp`, or `application/x-www-form-urlencoded`, THEN THE Upload_Handler SHALL respond with HTTP status 415 and a message naming the accepted image types.
4. IF the body of an upload is empty (0 bytes), or the form submission in criterion 9 has a missing or empty base64 field, THEN THE Upload_Handler SHALL respond with HTTP status 400 and a message indicating that no image was received.
5. IF the leading bytes of an upload do not match the signature of the declared image type (JPEG: `FF D8 FF`; PNG: `89 50 4E 47 0D 0A 1A 0A`; WebP: `RIFF` at bytes 0-3 and `WEBP` at bytes 8-11), THEN THE Upload_Handler SHALL respond with HTTP status 415 and a message indicating that the file content does not match the declared type.
6. WHEN a client has made 10 upload requests to `POST /rise` within the preceding 10 minutes and sends an 11th, THE Rate_Limiter SHALL respond with HTTP status 429 and a `Retry-After` header whose value is the number of whole seconds, between 1 and 600, until the client may upload again.
7. THE Upload_Handler SHALL hold each accepted image in memory only until its extraction completes or fails, and SHALL write no image bytes to `data/` or any other persistent location.
8. WHEN a client sends `GET /rise`, THE Server SHALL respond with HTTP status 200 and an HTML page containing a form that submits to `POST /rise` and works with JavaScript disabled.
9. WHEN a client submits the no-JavaScript form from criterion 8 with a `Content-Type` of `application/x-www-form-urlencoded` containing a base64 text field, THE Upload_Handler SHALL decode the field to bytes and SHALL apply the same checks as criteria 2, 4, and 5 to the decoded bytes, using the image type detected from the decoded signature as the declared type.
10. IF the base64 text field in criterion 9 is not valid base64, THEN THE Upload_Handler SHALL respond with HTTP status 400 and a message indicating that the image data could not be decoded.

**Note:** The `application/x-www-form-urlencoded` base64 form (criteria 9 and 10) is the no-JavaScript path. Raw image bodies (criterion 1) are the path for clients that can set a `Content-Type` header, such as scripts and JavaScript-enabled pages.

### Requirement 2: Pluggable Vision Provider

**User Story:** As a developer, I want the vision model to be swappable by configuration, so that the directory is not tied to one vendor and tests run offline.

#### Acceptance Criteria

1. THE Server SHALL select the Vision_Provider from the environment variable `VISION_PROVIDER`.
2. WHERE `VISION_PROVIDER` names a real provider and `VISION_API_KEY` is set, THE Extractor SHALL call that provider using built-in `fetch`, with the model taken from `VISION_MODEL` and the base URL taken from `VISION_BASE_URL` when set.
3. IF `VISION_API_KEY` is not set, THEN THE Server SHALL use the Mock_Vision_Provider regardless of the value of `VISION_PROVIDER`.
4. WHILE the Server runs under the test runner, THE Server SHALL use the Mock_Vision_Provider.
5. THE Mock_Vision_Provider SHALL return identical output for identical input bytes.
6. IF a real Vision_Provider call fails or exceeds 30 seconds, THEN THE Extractor SHALL respond with HTTP status 502 and a message that extraction failed, and THE Draft_Store SHALL store no Draft.
7. THE Server SHALL read the API key only from the environment and SHALL omit the key from logs, responses, and stored files.

### Requirement 3: Extraction into a Draft

**User Story:** As a business owner, I want the system to read my name, phone, category, services, hours, and service area from the photo, so that I only have to check the result.

#### Acceptance Criteria

1. WHEN the Upload_Handler accepts an image, THE Extractor SHALL request name, phone, category, services, hours, and service area from the Vision_Provider.
2. THE Extractor SHALL normalize an extracted phone number to the format `(NNN) NNN-NNNN` when the extracted value contains exactly 10 digits, or exactly 11 digits starting with `1`.
3. THE Extractor SHALL map an extracted category to a slug in `data/categories.json` and SHALL leave the category empty when no slug matches.
4. THE Extraction_Validator SHALL mark a Draft field as valid only when the field satisfies the Listing data model: non-empty `name`, phone in `(NNN) NNN-NNNN` format, `category` matching a slug in `data/categories.json`, at least one entry in `services`, non-empty `serviceArea`, and `hours` keys limited to the seven lowercase day names.
5. IF a field cannot be extracted or fails the Extraction_Validator, THEN THE Extractor SHALL leave that field empty in the Draft and SHALL list the field name in the Draft's `missingFields` array.
6. WHEN extraction completes, THE Draft_Store SHALL save a Draft with status `draft`, a generated unique `id`, the extracted fields, the `missingFields` array, and a creation timestamp, to `data/drafts.json`.
7. THE Extractor SHALL treat all text returned by the Vision_Provider as untrusted data and SHALL discard any field not in the Listing data model.
8. THE Extractor SHALL truncate each extracted string to 500 characters and each `services` array to 20 entries.
9. FOR ALL arbitrary Vision_Provider outputs, THE Extraction_Validator SHALL either produce a Draft that satisfies the field rules in criterion 4 for every field not listed in `missingFields`, or list the failing field in `missingFields` (invariant property).
10. THE Extractor SHALL produce the same Draft fields when applied twice to its own normalized output (idempotence property).

### Requirement 4: Draft Review, Confirmation, and Publication

**User Story:** As a business owner, I want to review and correct the draft before it goes live, so that nothing wrong is published under my business.

#### Acceptance Criteria

1. THE Server SHALL serve the Draft for review at `GET /rise/drafts/:id` as an HTML form with every Listing field editable, and the form SHALL work without JavaScript.
2. WHEN an Owner submits edits to `POST /rise/drafts/:id`, THE Draft_Store SHALL save the edited fields to the Draft and SHALL keep status `draft`.
3. WHEN an Owner submits explicit confirmation to `POST /rise/drafts/:id/confirm` and the Draft has an empty `missingFields` array after validation, THE Server SHALL generate a URL-safe slug `id` from the business name and city, append a numeric suffix when the slug already exists, add the Listing to the published listing set, set the Verified_Date to the current date, and mark the Draft status `published`.
4. IF an Owner submits confirmation for a Draft whose validation reports any missing or invalid field, THEN THE Server SHALL respond with HTTP status 422, list the failing fields, and publish nothing.
5. THE Server SHALL publish a Draft only through an explicit confirmation request, and no timer, upload, or API call SHALL publish an unconfirmed Draft.
6. WHILE a Draft has status `draft`, THE Server SHALL exclude that Draft from `GET /`, `GET /listings/:id`, `/api/listings/:id`, `/llms.txt`, `/sitemap.xml`, and the MCP_Endpoint.
7. WHEN an Owner submits `POST /rise/drafts/:id/discard`, THE Draft_Store SHALL delete the Draft.
8. IF a request references a Draft `id` that does not exist, THEN THE Server SHALL respond with HTTP status 404.
9. THE Server SHALL persist published Listings in `data/published.json`, and THE Server SHALL load the union of `data/listings.json` and `data/published.json` as the published listing set, leaving `data/listings.json` unmodified by any web request.
10. THE Server SHALL write each JSON file under `data/` by writing a temporary file and renaming it over the target, so a failed write leaves the previous content intact.
11. IF a stored JSON file under `data/` is missing, THEN THE Server SHALL treat it as an empty array.
12. THE Server SHALL escape every Draft and Listing value when rendering HTML.

### Requirement 5: MCP Server

**User Story:** As an AI agent, I want to call the directory through MCP, so that I can search businesses and get details without scraping pages.

#### Acceptance Criteria

1. WHEN a client sends a JSON-RPC 2.0 message by HTTP `POST` to `/mcp`, THE MCP_Endpoint SHALL process it using the MCP Streamable HTTP transport and return a JSON-RPC 2.0 response.
2. WHEN a client sends `initialize`, THE MCP_Endpoint SHALL respond with the supported protocol version, server name `first-answer-pages`, and a `tools` capability.
3. WHEN a client sends `tools/list`, THE MCP_Endpoint SHALL return exactly the tools `search_listings`, `get_listing`, and `request_quote`, each with a non-empty name, a non-empty description, and a JSON Schema `inputSchema`.
4. WHEN a client sends `tools/call` for `search_listings` with optional string arguments `category`, `city`, and `query`, THE MCP_Endpoint SHALL return the published Listings matching all supplied arguments, where `category` matches a slug exactly, `city` matches case-insensitively, and `query` matches case-insensitively as a substring of name, description, or any service. Each of `category`, `city`, and `query` SHALL be at most 200 characters.
5. WHEN a client calls `search_listings`, THE MCP_Endpoint SHALL return at most 25 Listings.
6. WHEN a client calls `get_listing` with a string `id` that exists, THE MCP_Endpoint SHALL return the Listing together with its Verification_Hash and Verified_Date.
7. IF a client calls `get_listing` with a string `id` that does not exist, THEN THE MCP_Endpoint SHALL return a tool result with `isError` set to `true` and a message stating the listing was not found.
8. WHEN a client sends `tools/call`, THE Tool_Validator SHALL check the argument object against the tool's `inputSchema` before the tool logic runs.
9. IF `tools/call` arguments fail the Tool_Validator, THEN THE MCP_Endpoint SHALL return a JSON-RPC error with code `-32602` and a message naming the invalid argument, and SHALL run no tool logic.
10. IF a request body is not valid JSON, THEN THE MCP_Endpoint SHALL return a JSON-RPC error with code `-32700`.
11. IF a request names an unknown method, THEN THE MCP_Endpoint SHALL return a JSON-RPC error with code `-32601`.
12. IF a `tools/call` request names an unknown tool, THEN THE MCP_Endpoint SHALL return a JSON-RPC error with code `-32602` and a message naming the unknown tool.
13. IF a client sends `GET` or `DELETE` to `/mcp`, THEN THE MCP_Endpoint SHALL respond with HTTP status 405 and an `Allow: POST` header.
14. IF a request body exceeds 64 KiB (65,536 bytes), THEN THE MCP_Endpoint SHALL respond with HTTP status 413 and SHALL run no tool logic.
15. IF a client sends more than 120 MCP requests within a 60-second window, THEN THE Rate_Limiter SHALL respond to each further request in that window with HTTP status 429 and a `Retry-After` header giving the whole seconds remaining in the window.
16. FOR ALL arbitrary JSON values supplied as tool arguments, THE Tool_Validator SHALL either accept arguments that satisfy the `inputSchema` or reject them with `-32602`, and THE MCP_Endpoint SHALL never respond with HTTP status 500 (error-condition property).
17. FOR ALL Listing sets and filter arguments, every Listing returned by `search_listings` SHALL satisfy every supplied filter (invariant property).
18. WHEN a `search_listings` call matches no published Listings, THE MCP_Endpoint SHALL return a successful tool result with an empty list and `isError` not set to `true`.
19. THE MCP_Endpoint SHALL exclude unpublished Listings from the results of `search_listings` and `get_listing`.

### Requirement 6: Quote Requests

**User Story:** As an AI agent acting for a customer, I want to request a quote from a business, so that the owner hears about the job even without a website.

#### Acceptance Criteria

1. WHEN a client calls `request_quote` with `id`, `name`, `contact`, and `details`, THE MCP_Endpoint SHALL validate the arguments, store a Quote_Request in `data/quotes.json`, and return the Quote_Request identifier.
2. THE Tool_Validator SHALL require `id` to match an existing published Listing, `name` to be 1 to 100 characters after trimming, `contact` to be a valid email address or a phone number with 10 or 11 digits, and `details` to be 1 to 2000 characters after trimming.
3. IF `request_quote` arguments fail validation, THEN THE MCP_Endpoint SHALL store no Quote_Request and SHALL return a JSON-RPC error with code `-32602` naming the invalid argument.
4. THE Quote_Store SHALL record for each Quote_Request a unique `id`, the Listing `id`, `name`, `contact`, `details`, a creation timestamp, and a `notified` flag.
5. WHEN a Quote_Request is stored, THE Server SHALL call the Notifier with the Quote_Request and the Listing.
6. THE Server SHALL select the Notifier from the environment variable `NOTIFIER`, and WHILE the Server runs under the test runner or `NOTIFIER` is unset, THE Server SHALL use the Mock_Notifier.
7. IF the Notifier call fails, THEN THE Quote_Store SHALL keep the Quote_Request with `notified` set to `false` and THE MCP_Endpoint SHALL still return success to the client.
8. WHEN the Notifier call succeeds, THE Quote_Store SHALL set `notified` to `true`.
9. THE Rate_Limiter SHALL allow at most 5 Quote_Requests per client per hour and at most 3 per client per Listing per hour.
10. THE Server SHALL strip control characters from `name` and `details` before storage and SHALL escape these values when rendering HTML or notification text.
11. FOR ALL arbitrary argument objects, a Quote_Request SHALL be stored if and only if the Tool_Validator accepts the arguments (property).
12. FOR ALL stored Quote_Requests, reading `data/quotes.json` after writing SHALL return an equivalent Quote_Request (round-trip property).

### Requirement 7: WebMCP Tools on Listing Pages

**User Story:** As an AI agent browsing a listing page, I want the page to offer tools directly in the browser, so that I can act on the page without leaving it.

#### Acceptance Criteria

1. THE Server SHALL include the WebMCP_Script on each Listing_Page as a static script served from `public/js/`.
2. WHEN the WebMCP_Script runs and `navigator.modelContext` is defined, THE WebMCP_Script SHALL register the tools `get_listing` and `request_quote` for the current Listing.
3. IF `navigator.modelContext` is not defined, THEN THE WebMCP_Script SHALL exit silently and SHALL throw no error and write no console error.
4. IF a tool registration call throws, THEN THE WebMCP_Script SHALL catch the error and leave the page working.
5. THE WebMCP_Script SHALL mark the `request_quote` tool as requiring user confirmation before it sends anything.
6. WHEN the `request_quote` WebMCP tool is invoked, THE WebMCP_Script SHALL ask the user to confirm through the browser's confirmation mechanism, and SHALL submit to the Server only after the user confirms.
7. IF the user declines the confirmation, THEN THE WebMCP_Script SHALL send no request and SHALL return a result stating the user declined.
8. THE WebMCP_Script SHALL submit quote data to a Server endpoint that applies the same validation, storage, notification, and rate limiting as Requirement 6.
9. THE Server SHALL render each Listing_Page, including a plain HTML quote form, so that a visitor can request a quote with JavaScript disabled.

### Requirement 8: A2A Agent Card

**User Story:** As an agent developer, I want an A2A agent card only if there is a real agent behind it, so that the card never advertises something that does not work.

#### Acceptance Criteria

1. WHERE the Server implements a working A2A agent endpoint, THE Server SHALL serve the Agent_Card at `GET /.well-known/agent-card.json`, and the card's `url` SHALL point to that endpoint on the same origin.
2. WHERE the Server implements a working A2A agent endpoint, THE Agent_Card SHALL list only skills that the endpoint answers.
3. IF no working A2A agent endpoint is implemented, THEN THE Server SHALL respond to `GET /.well-known/agent-card.json` with HTTP status 404.
4. THE Server SHALL gate the Agent_Card route on the presence of the A2A endpoint route so that the card and the endpoint are enabled or disabled together.
5. THE design for this spec SHALL state explicitly whether an A2A endpoint is built in this spec, and if not, the Agent_Card SHALL remain unpublished.

### Requirement 9: Canonical Form and Verification Hash

**User Story:** As a person or AI agent reading a listing, I want a checkable stamp, so that I can tell the data is unchanged since the owner confirmed it.

#### Acceptance Criteria

1. THE Verifier SHALL compute the Canonical_Form of a Listing by recursively sorting object keys in code-point order, omitting insignificant whitespace, preserving array order, and UTF-8 encoding the result.
2. THE Verifier SHALL compute the Verification_Hash as the lowercase hexadecimal SHA-256 digest, using `node:crypto`, of the Canonical_Form of an object containing the Listing under key `listing` and the Verified_Date under key `verifiedDate`.
3. THE Verifier SHALL exclude `verifiedDate` and any stored hash field from the Listing before canonicalization, so the hash input contains each value once.
4. THE Server SHALL store the `verifiedDate` for each Listing in `data/verified.json` as a map from Listing `id` to Verified_Date, and the Server SHALL treat a Listing with no entry as unverified.
5. WHEN the Server computes a Verification_Hash, THE Server SHALL compute it from the current published Listing data on each call or from a cache keyed by that data.
6. FOR ALL Listings, the Canonical_Form SHALL be identical regardless of the key insertion order of the Listing object (stability property).
7. FOR ALL Listings and Verified_Dates, computing the Verification_Hash twice SHALL produce identical values (determinism property).
8. FOR ALL Listings, changing any single field value, adding a field, removing a field, or changing the Verified_Date SHALL change the Verification_Hash (sensitivity property).
9. FOR ALL Listings, parsing the Canonical_Form as JSON and canonicalizing the result again SHALL produce the identical string (round-trip property).

### Requirement 10: Owner-Confirmed Stamp Display and Verification Endpoint

**User Story:** As a visitor, I want to see the stamp and check it, so that I can tell the listing is unchanged since the owner confirmed it.

#### Acceptance Criteria

1. WHEN a Listing_Page is rendered for an owner-confirmed Listing, THE Server SHALL display the text "Owner-confirmed <date>", where <date> is the Verified_Date, and the Verification_Hash, labeled as unchanged since the owner confirmed it, in a stamp element styled to match the classic phone-book look, and the stamp SHALL contain no claim of identity or ownership verification.
2. WHEN a Listing_Page is rendered for an owner-confirmed Listing, THE Server SHALL include the Verification_Hash and Verified_Date in the JSON-LD as `identifier` and `dateModified` properties, with the existing required fields unchanged.
3. IF a Listing has no Verified_Date, THEN THE Server SHALL render the Listing_Page with the text "Not yet confirmed by the owner" in place of the stamp and SHALL omit `identifier` and `dateModified` from the JSON-LD.
4. WHEN a client requests `GET /api/verify/:id` with an optional `hash` query parameter, THE Verifier SHALL respond with HTTP status 200 and a JSON body containing `id`, `verified`, `verifiedDate`, `hash` (the current Verification_Hash), and `match`.
5. WHEN the `hash` query parameter equals the current Verification_Hash, THE Verifier SHALL set `match` to `true`.
6. WHEN the `hash` query parameter is supplied and differs from the current Verification_Hash, THE Verifier SHALL set `match` to `false`.
7. WHERE the `hash` query parameter is absent, THE Verifier SHALL set `match` to `null` and still return the current hash.
8. IF the `id` does not match a published Listing, THEN THE Verifier SHALL respond with HTTP status 404 and a JSON error body.
9. THE Verifier SHALL compare hash strings case-insensitively after trimming whitespace.
10. WHEN the Owner confirms or edits a Listing through the Server, THE Server SHALL set the Verified_Date to the current date only on confirmation by the Owner.
11. FOR ALL Listings, a stamp hash taken from a Listing_Page SHALL produce `match` equal to `true` at `GET /api/verify/:id` while the Listing data is unchanged, and `false` after any edit to the Listing (round-trip property).
12. THE Server SHALL include the Verification_Hash in the JSON returned by `/api/listings/:id` and in the `get_listing` MCP_Tool result.

### Requirement 11: The Seance Prompts and Detection

**User Story:** As a business owner, I want to know whether AI assistants name my business, so that I can see whether being listed helped.

#### Acceptance Criteria

1. THE Seance SHALL build each Seance_Prompt from the template `best <category label> in <city>` using a Listing's category label from `data/categories.json` and its city.
2. WHEN a Seance run is requested for a Listing, THE Seance SHALL send the Seance_Prompt to the selected Assistant_Provider and record a Seance_Run containing the Listing `id`, the prompt, the provider name, a timestamp, the answer text, and `named` set to `true` or `false`.
3. THE Seance SHALL set `named` to `true` when the assistant answer contains the Listing name, compared case-insensitively after collapsing runs of whitespace and ignoring punctuation.
4. THE Seance SHALL set `named` to `false` when the assistant answer does not contain the Listing name under the comparison in criterion 3.
5. THE Seance SHALL truncate stored answer text to 4000 characters.
6. IF the Assistant_Provider call fails or exceeds 30 seconds, THEN THE Seance SHALL store no Seance_Run and SHALL report that the run failed.
7. FOR ALL Listing names and answer texts, WHEN the answer contains the normalized Listing name as a substring, THE Seance SHALL set `named` to `true` (metamorphic property).
8. FOR ALL Listing names and answers, WHEN a prefix and a suffix are added to an answer, THE Seance SHALL return the same `named` value (metamorphic property).

### Requirement 12: Pluggable Assistant Provider

**User Story:** As a developer, I want the assistant under test to be swappable and safe, so that tests never spend money and keys are never required.

#### Acceptance Criteria

1. THE Server SHALL select the Assistant_Provider from the environment variable `SEANCE_PROVIDER`.
2. WHERE `SEANCE_PROVIDER` names a real provider and `SEANCE_API_KEY` is set, THE Seance SHALL call that provider using built-in `fetch`, with the model taken from `SEANCE_MODEL` when set.
3. IF `SEANCE_API_KEY` is not set, THEN THE Seance SHALL use the Mock_Assistant_Provider and SHALL make no network call.
4. WHILE the Server runs under the test runner, THE Seance SHALL use the Mock_Assistant_Provider.
5. THE Mock_Assistant_Provider SHALL return identical output for identical prompts.
6. THE Server SHALL read the API key only from the environment and SHALL omit the key from logs, responses, and stored files.
7. THE Rate_Limiter SHALL allow at most 10 Seance runs per client per hour and at most 1 run per Listing per 10 minutes, and SHALL respond with HTTP status 429 and a `Retry-After` header to further runs in those windows.
8. THE Seance SHALL run only when requested by an authenticated trigger: a `POST /seance/run` request carrying the shared secret in `SEANCE_ADMIN_TOKEN` as a bearer token, and IF the token is missing or wrong, THEN THE Server SHALL respond with HTTP status 401.
9. IF `SEANCE_ADMIN_TOKEN` is not set, THEN THE Server SHALL respond to `POST /seance/run` with HTTP status 403.

### Requirement 13: Seance History and Reporting

**User Story:** As a business owner, I want a before/after history, so that I can see whether my visibility changed.

#### Acceptance Criteria

1. THE Seance_Store SHALL append each Seance_Run to `data/seance.json` and SHALL never modify or delete earlier Seance_Runs.
2. THE Server SHALL serve an HTML report at `GET /seance/:id` for a Listing showing each Seance_Run in order from oldest to newest, with the date, provider, prompt, and a named or not-named result, and the page SHALL work without JavaScript.
3. THE Server SHALL serve the same history as JSON at `GET /api/seance/:id`.
4. WHEN at least two Seance_Runs exist for the same Listing, provider, and prompt, THE report SHALL show the first run as "before" and the most recent run as "after", and SHALL state whether the result changed.
5. WHEN a Listing has a Verified_Date, THE report SHALL mark runs dated before the Verified_Date as "before owner confirmation" and runs on or after it as "after owner confirmation".
6. IF no Seance_Runs exist for a Listing, THEN THE report SHALL state that no runs have been recorded.
7. IF the `id` does not match a published Listing, THEN THE Server SHALL respond with HTTP status 404.
8. THE Server SHALL escape assistant answer text when rendering HTML.
9. FOR ALL sequences of appended Seance_Runs, the stored history length SHALL equal the number of appends and the order of the stored runs SHALL equal the order of appends (invariant property).
10. FOR ALL stored Seance_Runs, reading `data/seance.json` after writing SHALL return an equivalent Seance_Run (round-trip property).

### Requirement 14: Storage, Configuration, and Safety Across Features

**User Story:** As the maintainer, I want writes and secrets handled consistently, so that the source of truth stays safe.

#### Acceptance Criteria

1. THE Server SHALL confine web-layer writes to `data/drafts.json`, `data/published.json`, `data/verified.json`, `data/quotes.json`, and `data/seance.json`.
2. THE Server SHALL serve no file from `data/` over HTTP.
3. THE Server SHALL read the data directory path from the environment variable `DATA_DIR` when set and otherwise use `data/`, so that tests write to a temporary directory.
4. THE Server SHALL serialize writes to each JSON file so that two concurrent requests do not lose either write.
5. THE Server SHALL document every environment variable (`VISION_PROVIDER`, `VISION_API_KEY`, `VISION_MODEL`, `VISION_BASE_URL`, `NOTIFIER`, `SEANCE_PROVIDER`, `SEANCE_API_KEY`, `SEANCE_MODEL`, `SEANCE_ADMIN_TOKEN`, `DATA_DIR`) in `README.md`.
6. THE Server SHALL apply the Rate_Limiter by client IP address, using in-memory counters that reset on restart.
7. THE feature code SHALL place Server code under `server/`, tests under `test/`, and browser scripts under `public/js/`, and SHALL use no word or logo listed in the product trademark rule.
8. FOR ALL sequences of concurrent writes to one JSON file, the final file SHALL contain every written record exactly once (invariant property).

### Requirement 15: Property-Based Test Coverage

**User Story:** As the maintainer, I want property-based tests for each feature, so that edge cases are caught before release.

#### Acceptance Criteria

1. THE test suite SHALL use `node:test` and `fast-check`, with files in `test/` named `*.test.js`, runnable with `node --test`.
2. THE test suite SHALL include property tests for Rise from the Grave covering extraction validation (Requirement 3, criteria 9 and 10) and phone normalization.
3. THE test suite SHALL include property tests for Agent-ready covering MCP tool input validation (Requirement 5, criteria 16 and 17) and quote validation (Requirement 6, criteria 11 and 12).
4. THE test suite SHALL include property tests for the Owner-confirmed stamp covering canonical-hash stability, determinism, sensitivity, and round-trip (Requirement 9, criteria 6 to 9, and Requirement 10, criterion 11).
5. THE test suite SHALL include property tests for the Seance covering name detection and history append (Requirement 11, criteria 7 and 8, and Requirement 13, criteria 9 and 10).
6. THE test suite SHALL use the Mock_Vision_Provider, Mock_Notifier, and Mock_Assistant_Provider and make no network calls.
7. THE test suite SHALL use a temporary `DATA_DIR` so tests never modify files in `data/`.
8. THE test suite SHALL include example-based integration tests for the upload flow (upload, review, confirm, appears in directory), the MCP flow (`initialize`, `tools/list`, `tools/call`), and the verify endpoint.
9. THE test suite SHALL test the WebMCP_Script with a stubbed `navigator` object covering both the present and absent `navigator.modelContext` cases.
