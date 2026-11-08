# Requirements Document

## Introduction

First Answer Pages is a free local business directory with a classic phone-book aesthetic, rebuilt for the AI era. Every business gets a listing page that humans can browse and AI assistants can read. The initial feature set covers the home page directory, individual business listing pages, AI-readability endpoints (JSON-LD, JSON API, `/llms.txt`, `sitemap.xml`), and a seeded set of sample Nashville businesses across six categories.

## Glossary

- **Listing**: A single business record stored in `data/listings.json`, containing all fields defined in the Listing Data Model.
- **Category**: A classic phone-book-style grouping of businesses (e.g., Plumbers, Electricians). Defined in `data/categories.json`.
- **Directory**: The home page view showing all businesses organized by category.
- **Listing_Page**: The individual HTML page at `/listings/:id` for a single business.
- **JSON_API**: The JSON endpoint at `/api/listings/:id` that returns a single listing as structured JSON.
- **LLMS_File**: The plain-text file served at `/llms.txt` listing all businesses with key fields for AI assistant consumption.
- **Sitemap**: The XML file served at `/sitemap.xml` enumerating all listing page URLs.
- **JSON_LD**: A `<script type="application/ld+json">` block embedded in a Listing_Page containing schema.org LocalBusiness structured data.
- **Schema_Builder**: The server-side function that converts a Listing object into a valid schema.org LocalBusiness JSON-LD object.
- **Seed_Data**: A set of clearly marked sample businesses with fake names and 555-xxxx phone numbers, used to populate the directory at launch.
- **Server**: The Express application running under Node.js 22.

---

## Listing Data Model

Every Listing object contains the following fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | URL-safe slug, e.g. `nashville-plumbing-co` |
| `name` | string | yes | Business display name |
| `category` | string | yes | Must match a slug in `categories.json` |
| `phone` | string | yes | Formatted as `(555) 555-0100` |
| `hours` | object | yes | Keys are day names; values are time ranges or `"Closed"` |
| `services` | array of strings | yes | At least one service |
| `serviceArea` | string | yes | City, region, or county served |
| `description` | string | yes | One to three plain sentences, no marketing language |
| `city` | string | yes | City of business location |
| `state` | string | yes | Two-letter state abbreviation |
| `address` | string | no | Street address |

---

## Requirements

### Requirement 1: Home Page Directory

**User Story:** As a person looking for a local service provider, I want to browse businesses organized by category on the home page, so that I can find the right type of business without knowing a specific name.

#### Acceptance Criteria

1. THE Server SHALL serve an HTML page at `GET /` that displays all Listings grouped by Category.
2. WHEN the home page is rendered, THE Server SHALL display each Category as a section heading with its associated Listings listed beneath it.
3. WHEN the home page is rendered, THE Server SHALL display for each Listing at minimum: business name, phone number, city, and a link to the Listing_Page.
4. WHEN a user submits a category filter on the home page, THE Server SHALL return a filtered view showing only Listings that belong to the selected Category.
5. WHEN a user submits a city filter on the home page, THE Server SHALL return a filtered view showing only Listings whose `city` field matches the submitted value (case-insensitive).
6. WHEN both a category filter and a city filter are submitted, THE Server SHALL return only Listings matching both conditions.
7. IF no Listings match the applied filters, THEN THE Server SHALL display a message stating no results were found rather than an empty page.
8. THE Server SHALL render the home page without requiring JavaScript to be enabled in the browser.

---

### Requirement 2: Individual Business Listing Page

**User Story:** As a person who found a business in the directory, I want to see the full details of that business on its own page, so that I have everything I need to contact them or decide to hire them.

#### Acceptance Criteria

1. THE Server SHALL serve an HTML Listing_Page at `GET /listings/:id` for every Listing in `data/listings.json`.
2. WHEN a Listing_Page is rendered, THE Server SHALL display all of the following fields: name, category, phone, hours (full per-day schedule), services (full list), serviceArea, description, city, and state.
3. WHERE a Listing has an `address` field, THE Server SHALL display the address on the Listing_Page.
4. WHEN a Listing_Page is rendered, THE Server SHALL include a visible link back to the home page directory.
5. IF a request is made to `GET /listings/:id` for an `id` that does not exist in `data/listings.json`, THEN THE Server SHALL respond with HTTP status 404 and an HTML page stating the listing was not found.
6. THE Server SHALL render each Listing_Page without requiring JavaScript to be enabled in the browser.

---

### Requirement 3: JSON-LD Structured Data

**User Story:** As an AI assistant or search crawler, I want each listing page to contain schema.org LocalBusiness structured data, so that I can extract structured information about the business without parsing HTML.

#### Acceptance Criteria

1. WHEN a Listing_Page is rendered, THE Server SHALL embed a `<script type="application/ld+json">` block containing a schema.org LocalBusiness object built from the Listing's fields.
2. THE Schema_Builder SHALL map Listing fields to schema.org properties as follows: `name` → `name`, `phone` → `telephone`, `address` → `address`, `description` → `description`, `city` + `state` → `address.addressLocality` + `address.addressRegion`, `services` → `hasOfferCatalog`.
3. THE Schema_Builder SHALL set `"@context": "https://schema.org"` and `"@type": "LocalBusiness"` on every generated JSON-LD object.
4. WHEN the Schema_Builder receives a Listing with all required fields, THE Schema_Builder SHALL produce a JSON-LD object that is valid against the schema.org LocalBusiness type.
5. IF the Schema_Builder receives a Listing missing a required field, THEN THE Schema_Builder SHALL throw an error identifying the missing field rather than producing a malformed JSON-LD object.

---

### Requirement 4: JSON API Endpoint

**User Story:** As a developer or AI tool, I want to fetch a single business listing as JSON from a stable URL, so that I can programmatically read listing data without scraping HTML.

#### Acceptance Criteria

1. THE Server SHALL serve `GET /api/listings/:id` and return the full Listing object as JSON with `Content-Type: application/json`.
2. WHEN a valid `id` is requested, THE Server SHALL return HTTP status 200 and the complete Listing object with all stored fields.
3. IF a request is made to `GET /api/listings/:id` for an `id` that does not exist in `data/listings.json`, THEN THE Server SHALL respond with HTTP status 404 and a JSON body of `{ "error": "Listing not found" }`.
4. THE Server SHALL include a `Content-Type: application/json` header on all responses from `GET /api/listings/:id`.

---

### Requirement 5: /llms.txt AI Feed

**User Story:** As an AI assistant processing this site, I want a single plain-text file that lists every business with their key information, so that I can quickly understand what businesses are in this directory without fetching every individual page.

#### Acceptance Criteria

1. THE Server SHALL serve a plain-text file at `GET /llms.txt` with `Content-Type: text/plain`.
2. WHEN `/llms.txt` is rendered, THE Server SHALL include an entry for every Listing in `data/listings.json`.
3. WHEN `/llms.txt` is rendered, THE Server SHALL include the following fields for each Listing entry: name, category, phone, city, state, serviceArea, and the URL of the Listing_Page.
4. WHEN `/llms.txt` is rendered, THE Server SHALL begin the file with a plain-text header describing the site name, purpose, and total number of listings.
5. THE Server SHALL render `/llms.txt` entries in alphabetical order by business name within each category.

---

### Requirement 6: sitemap.xml

**User Story:** As a search crawler or AI assistant, I want a sitemap listing all business pages, so that I can discover and index every listing without following links through the directory.

#### Acceptance Criteria

1. THE Server SHALL serve an XML document at `GET /sitemap.xml` with `Content-Type: application/xml`.
2. WHEN `sitemap.xml` is rendered, THE Server SHALL include a `<url>` entry for every Listing in `data/listings.json`, using the full absolute URL of each Listing_Page.
3. WHEN `sitemap.xml` is rendered, THE Server SHALL include the home page URL as a `<url>` entry.
4. THE Server SHALL produce a `sitemap.xml` document that conforms to the Sitemap Protocol 0.9 schema (sitemaps.org).
5. THE Server SHALL derive the base URL for sitemap entries from an environment variable `BASE_URL`, defaulting to `http://localhost:3000` when the variable is not set.

---

### Requirement 7: Seed Data

**User Story:** As a developer setting up the project, I want a pre-populated set of sample Nashville businesses, so that the directory is immediately browsable and testable without manual data entry.

#### Acceptance Criteria

1. THE Seed_Data SHALL contain at least 18 Listing records (at least 3 per category) spread across exactly 6 categories.
2. THE Seed_Data SHALL use the following 6 categories: Plumbers, Electricians, Restaurants, Auto Repair, Hair Salons, Lawyers.
3. EVERY phone number in THE Seed_Data SHALL follow the format `(555) 555-XXXX` where XXXX is a four-digit number, indicating a clearly fictional number.
4. EVERY business name in THE Seed_Data SHALL be a clearly fictional name not matching any real business.
5. THE Seed_Data SHALL set `city` to `Nashville` and `state` to `TN` for every Listing.
6. EVERY Listing in THE Seed_Data SHALL include all required fields defined in the Listing Data Model.
7. THE Seed_Data file SHALL include a top-level comment or field indicating that the data is sample data for development and demonstration purposes only.

---

### Requirement 8: Property-Based Tests — JSON-LD Correctness

**User Story:** As a developer, I want property-based tests that verify the Schema_Builder produces valid JSON-LD for any well-formed listing, so that I have confidence the structured data is correct across the full space of possible listing inputs.

#### Acceptance Criteria

1. THE test suite SHALL include a property-based test using fast-check that generates arbitrary valid Listing objects and asserts that Schema_Builder produces a JSON-LD object with `"@context": "https://schema.org"`.
2. THE test suite SHALL include a property-based test that asserts Schema_Builder always sets `"@type": "LocalBusiness"` regardless of Listing field values.
3. THE test suite SHALL include a property-based test that asserts the `name` field of any Listing is preserved exactly in the `name` property of the generated JSON-LD object.
4. THE test suite SHALL include a property-based test that asserts the `telephone` property of the generated JSON-LD always equals the `phone` field of the input Listing.
5. WHEN fast-check generates a Listing with all required fields present, THE Schema_Builder SHALL not throw an error for any generated input.

---

### Requirement 9: Property-Based Tests — /llms.txt Completeness

**User Story:** As a developer, I want property-based tests that verify every listing in the data store appears in `/llms.txt`, so that no business is silently omitted from the AI feed.

#### Acceptance Criteria

1. THE test suite SHALL include a property-based test that generates an arbitrary non-empty array of valid Listing objects, passes it to the LLMS_File generator function, and asserts that the output string contains the `name` of every generated Listing.
2. THE test suite SHALL include a property-based test asserting that the LLMS_File output contains the Listing_Page URL for every generated Listing.
3. THE test suite SHALL include a property-based test asserting that the number of Listing entries in the LLMS_File output is always equal to the number of Listings passed in.

---

### Requirement 10: Property-Based Tests — sitemap.xml Completeness

**User Story:** As a developer, I want property-based tests that verify every listing in the data store appears in `sitemap.xml`, so that no business page is missing from the sitemap.

#### Acceptance Criteria

1. THE test suite SHALL include a property-based test that generates an arbitrary non-empty array of valid Listing objects, passes it to the Sitemap generator function, and asserts that the output XML string contains the Listing_Page URL for every generated Listing.
2. THE test suite SHALL include a property-based test asserting that the Sitemap output is a string containing the `<urlset` opening tag, confirming well-formed XML structure.
3. THE test suite SHALL include a property-based test asserting that the number of `<url>` elements in the Sitemap output is always equal to the number of Listings passed in plus one (for the home page URL).
