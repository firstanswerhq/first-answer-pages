# Implementation Plan: Listings and AI-Readable Pages

## Overview

Build First Answer Pages from scratch: a server-rendered local business directory on Node.js 22 + Express that serves HTML listing pages, a JSON API, a plain-text `/llms.txt` AI feed, and an XML sitemap. All data is read from JSON files on disk. The implementation follows the file layout in `structure.md` and the tech constraints in `tech.md`.

## Tasks

- [x] 1. Project scaffolding
  - [x] 1.1 Create `package.json` with `"type": "module"`, `"main": "server/index.js"`, a `"start"` script (`node server/index.js`), a `"test"` script (`node --test`), and pinned dependencies: `express` (production) and `fast-check` (dev)
    - Include `"name"`, `"version"`, `"description"`, `"license"` fields
    - _Requirements: none — project infrastructure_
  - [x] 1.2 Create the directory skeleton: `server/`, `server/routes/`, `server/lib/`, `public/css/`, `public/js/`, `public/images/`, `data/`, `test/`, `mcp/`
    - Place a `.gitkeep` file in `public/js/` and `public/images/` so Git tracks the empty dirs
    - _Requirements: none — project infrastructure_
  - [x] 1.3 Create `.gitignore` ignoring `node_modules/`, `.env`, and `*.log`
    - _Requirements: none — project infrastructure_

- [x] 2. Seed data
  - [x] 2.1 Create `data/categories.json` — a JSON array of 6 category objects `{ "slug": "...", "label": "..." }` covering Plumbers, Electricians, Restaurants, Auto Repair, Hair Salons, Lawyers
    - _Requirements: 7.2_
  - [x] 2.2 Create `data/listings.json` — a JSON array containing 18 fictional Nashville listings (3 per category), all with `city: "Nashville"`, `state: "TN"`, `(555) 555-XXXX` phone numbers with unique 4-digit suffixes, all required fields populated, and a leading `_comment` field marking the data as sample-only
    - Include fields: `id`, `name`, `category`, `phone`, `hours` (all 7 days), `services` (≥1), `serviceArea`, `description`, `city`, `state`; add `address` for at least half the listings
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 3. Data layer
  - [x] 3.1 Create `server/data.js` — loads `data/listings.json` and `data/categories.json` synchronously using `fs.readFileSync` + `JSON.parse` at module import time; exits the process with a descriptive error if either file is malformed
    - Export `getListings()` and `getCategories()` returning the cached arrays
    - _Requirements: (startup behavior defined in design)_
  - [x] 3.2 Add `findById(id)` to `server/data.js` — returns the listing whose `id` matches, or `undefined` if not found; uses `Array.prototype.find`
    - _Requirements: 2.5, 4.3_
  - [x] 3.3 Add `filterListings({ category, city })` to `server/data.js` — filters the in-memory listings array; city comparison is case-insensitive; omitted filter keys do not restrict results
    - _Requirements: 1.4, 1.5, 1.6_
  - [x] 3.4 Add `groupByCategory(listings)` to `server/data.js` — returns a `Map<slug, Listing[]>` with keys ordered by the sequence in `categories.json`; categories with zero listings still appear if they exist in the map iteration (or can be omitted — caller decides)
    - _Requirements: 1.1, 1.2_

- [x] 4. Generator modules
  - [x] 4.1 Create `server/lib/schema.js` — export `buildSchema(listing)` that maps Listing fields to a schema.org LocalBusiness JSON-LD object per the field-mapping table in the design; validate all required fields before building and throw `new Error('Schema_Builder: missing required field: <fieldName>')` on any missing field
    - Required constants: `"@context": "https://schema.org"`, `"@type": "LocalBusiness"`, `address["@type"]: "PostalAddress"`, `hasOfferCatalog["@type"]: "OfferCatalog"`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [x]* 4.2 Write property tests for Schema Builder in `test/schema.test.js`
    - Use the `arbListing` arbitrary defined in the design document
    - **Property 1: Schema Builder preserves required constants** — `@context` equals `"https://schema.org"`, `@type` equals `"LocalBusiness"` — **Validates: Requirements 3.3, 8.1, 8.2**
    - **Property 2: Schema Builder field mapping is correct** — `name`, `telephone`, `description` match listing fields — **Validates: Requirements 3.2, 8.3, 8.4**
    - **Property 3: Schema Builder never throws for valid input** — no error thrown for any valid Listing — **Validates: Requirements 3.4, 8.5**
    - **Property 4: Schema Builder throws for missing required fields** — removing any required field causes an Error to be thrown — **Validates: Requirements 3.5**
    - Each `fc.assert` call must include a comment: `// Feature: listings-and-ai-readable-pages, Property N: <title>`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 4.3 Create `server/lib/llms.js` — export `generateLlmsTxt(listings, baseUrl)` that produces a plain-text string; starts with a header block (site name, purpose, total listing count, base URL); then for each category, outputs a `## Category` heading followed by listing entries sorted alphabetically by name (case-insensitive) within the category; each entry includes name, phone, category label, city+state, serviceArea, and page URL
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x]* 4.4 Write property tests for the llms.txt generator in `test/llms.test.js`
    - Use `arbListing` and `fc.array(arbListing, { minLength: 1 })` as input
    - **Property 5: llms.txt contains every listing's name** — output string contains each listing's `name` — **Validates: Requirements 5.2, 9.1**
    - **Property 6: llms.txt contains every listing's page URL** — output contains `{baseUrl}/listings/{id}` for every listing — **Validates: Requirements 5.3, 9.2**
    - **Property 7: llms.txt entry count equals listing count** — number of listing entries equals `listings.length` — **Validates: Requirements 9.3**
    - **Property 8: llms.txt entries are alphabetically ordered within categories** — names within each category block appear in case-insensitive alphabetical order — **Validates: Requirements 5.5**
    - _Requirements: 9.1, 9.2, 9.3_
  - [x] 4.5 Create `server/lib/sitemap.js` — export `generateSitemap(listings, baseUrl)` that returns a Sitemap Protocol 0.9 XML string; the home page `<url>` entry appears first, followed by one `<url>` per listing in array order
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [x]* 4.6 Write property tests for the Sitemap generator in `test/sitemap.test.js`
    - **Property 9: Sitemap contains every listing's page URL** — XML contains `{baseUrl}/listings/{id}` for every listing — **Validates: Requirements 6.2, 10.1**
    - **Property 10: Sitemap has well-formed XML structure** — output contains `<urlset` and `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"` — **Validates: Requirements 6.4, 10.2**
    - **Property 11: Sitemap URL count equals listing count plus one** — count of `<url>` elements equals `listings.length + 1` — **Validates: Requirements 6.3, 10.3**
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 4.7 Create `server/lib/html.js` — export three functions:
    - `layout({ title, body })` — full HTML shell with `<head>` (charset, viewport, title, stylesheet link, optional ld+json slot), `<nav>` with home link, `<main>`, and `<footer>`
    - `listingCard(listing)` — compact card for the home page: name in bold, phone, city, category, "View details →" link to `/listings/:id`; uses `<article class="listing-card">`
    - `listingDetail(listing, jsonLd)` — full listing body with all fields in `<dl>` style, hours table, services list, back link; injects `jsonLd` into a `<script type="application/ld+json">` inside the head slot
    - _Requirements: 1.3, 2.2, 2.3, 2.4, 3.1_

- [x] 5. Checkpoint — verify generator modules
  - Ensure all tests written so far pass with `node --test`; ask the user if anything is unclear before continuing.

- [ ] 6. Express application
  - [~] 6.1 Create `server/app.js` — set up Express: register `express.static('public')`, import and mount all five route modules, register a generic 404 HTML handler, and register a 500 error-handler middleware that returns a generic "Something went wrong" HTML page without a stack trace
    - _Requirements: (error handling defined in design)_
  - [~] 6.2 Create `server/index.js` — import the Express app from `server/app.js`, bind to `process.env.PORT` (default `3000`), and start listening; log the port to stdout on startup
    - _Requirements: (startup behavior defined in design)_

- [ ] 7. Routes
  - [~] 7.1 Create `server/routes/home.js` — handle `GET /`; read `category` and `city` from `req.query`; call `filterListings` then `groupByCategory`; render category sections with `listingCard` per listing; show a "no results found" message when the filtered set is empty; return `text/html` 200
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [~] 7.2 Create `server/routes/listings.js` — handle `GET /listings/:id`; call `findById`; return 404 HTML if not found; otherwise call `buildSchema`, serialize with `JSON.stringify`, call `listingDetail` + `layout`, return `text/html` 200
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1_
  - [~] 7.3 Create `server/routes/api.js` — handle `GET /api/listings/:id`; call `findById`; return 404 JSON `{ "error": "Listing not found" }` if not found; return 200 JSON with full listing object if found; always set `Content-Type: application/json`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [~] 7.4 Create `server/routes/llms.js` — handle `GET /llms.txt`; derive `baseUrl` from `process.env.BASE_URL` (default `'http://localhost:3000'`); call `generateLlmsTxt`; return `text/plain` 200
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [~] 7.5 Create `server/routes/sitemap.js` — handle `GET /sitemap.xml`; derive `baseUrl` from `process.env.BASE_URL`; call `generateSitemap`; return `application/xml` 200
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 8. CSS styling
  - [~] 8.1 Create `public/css/style.css` — implement the old phone-book aesthetic using the CSS variables and rules defined in the design:
    - CSS custom properties: `--color-page-bg: #FDF3C0`, `--color-text: #1A1A1A`, `--color-divider: #333333`, `--color-link: #0000EE`
    - Body: `font-family: Georgia, serif; background: var(--color-page-bg)`
    - Two-column directory grid via CSS `columns: 2; column-gap: 2rem` with a `@media (max-width: 600px)` breakpoint falling back to single column
    - `.category-head`: bold section headings with thick bottom border
    - `.listing-card`: `break-inside: avoid; margin-bottom: 1rem`
    - Full listing page: single-column `<dl>` layout for fields, hours displayed as a small table
    - Nav and footer styling consistent with the phone-book look
    - _Requirements: 1.2, 1.3, 2.2 (aesthetic defined in design)_

- [ ] 9. Unit and integration tests
  - [ ]* 9.1 Write unit tests for the data layer in `test/listings.test.js` using `node:test` and `fast-check`:
    - `findById` with a known id → returns correct listing
    - `findById` with unknown id → returns `undefined`
    - `groupByCategory` with mixed listings → categories appear in the order defined by `categories.json`
    - `filterListings` with no filters → returns all listings (identity)
    - `filterListings` with a filter that matches nothing → returns empty array
    - **Property 12: Category filtering returns only matching listings** — `filterListings({ category })` returns only listings whose `category` equals the filter — **Validates: Requirements 1.4**
    - **Property 13: City filtering is case-insensitive** — `filterListings({ city })` returns all and only listings matching the city case-insensitively — **Validates: Requirements 1.5**
    - **Property 14: Combined filtering is a logical intersection** — `filterListings({ category, city })` returns exactly the intersection of both filters — **Validates: Requirements 1.6**
    - _Requirements: 1.4, 1.5, 1.6_
  - [ ]* 9.2 Write integration tests for the JSON API in `test/api.test.js` using `node:test`:
    - `GET /api/listings/nashville-pipe-pros` → 200, correct JSON body, `application/json` header
    - `GET /api/listings/does-not-exist` → 404, `{ "error": "Listing not found" }`, `application/json` header
    - Use Node.js built-in `fetch` to call the server started in a `before` hook; close the server in an `after` hook
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [~] 10. Checkpoint — full test suite
  - Run `node --test` and ensure all tests pass; ask the user if any failures need investigation before proceeding.

- [ ] 11. MCP placeholder and README
  - [~] 11.1 Create `mcp/index.js` — a placeholder ES module with a comment explaining this is the future MCP server entry point; export nothing; do not wire it into the main server
    - _Requirements: (structure.md MCP placeholder rule)_
  - [~] 11.2 Create `README.md` — document: project overview, how to install (`npm install`), how to run (`npm start`), how to run tests (`node --test`), environment variables (`PORT`, `BASE_URL`), data file location and format, and a note that seed data is fictional
    - _Requirements: none — developer documentation_

- [~] 12. Final checkpoint
  - Ensure all tests pass with `node --test`; verify the server starts without errors; ask the user if anything needs adjustment.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP pass
- All code is plain JavaScript (ES modules, `.js` files) — no TypeScript, no bundler
- Property tests use `fast-check` with the `arbListing` arbitrary defined in the design document's Testing Strategy section
- Each `fc.assert` call must include a comment referencing the feature name and property number
- The site must work with JavaScript disabled — no logic may depend on client-side JS
- `data/` is read-only from the web layer in v1 — no write-back routes

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["4.1", "4.3", "4.5", "4.7"] },
    { "id": 5, "tasks": ["4.2", "4.4", "4.6", "6.1", "6.2", "8.1"] },
    { "id": 6, "tasks": ["7.1", "7.2", "7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["9.1", "9.2"] },
    { "id": 8, "tasks": ["11.1", "11.2"] }
  ]
}
```
