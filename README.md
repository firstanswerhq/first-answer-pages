# first-answer-pages
The old phone book, resurrected for AI. Free local business listings that AI assistants can read and recommend. Built with Kiro for Kiroween 2026.

First Answer Pages is a free local business directory with a classic phone-book look. Every listing has a plain HTML page, a JSON API entry, and a line in a plain-text feed (`/llms.txt`) so people and AI assistants can read it. It is part of First Answer (firstanswerhq.com).

## Install

Requires Node.js 22.

```
npm install
```

## Run

```
npm start
```

Then open http://localhost:3000.

Routes:
- `GET /` directory home page (optional `?category=` and `?city=` filters)
- `GET /listings/:id` one listing page, with JSON-LD
- `GET /api/listings/:id` one listing as JSON
- `GET /llms.txt` plain-text feed of all listings
- `GET /sitemap.xml` XML sitemap

Super Pages routes are listed in the next section.

## Super Pages

Super Pages adds four features on top of the directory.

### Rise from the Grave (`/rise`)

Turn a photo of a business card, sign, or flyer into a listing. Upload the image, review the draft the app extracts, fix any field, and confirm. Nothing is public until the owner confirms.

- `GET /rise` upload page. It works without JavaScript: paste the image as base64 text, or use `curl`.
- `POST /rise` accepts a raw JPEG, PNG, or WebP body (up to 5 MiB) or a form post with a base64 field (up to 8 MiB). On success it redirects to the draft review page.
- `GET /rise/drafts/:id` edit page for one draft.
- `POST /rise/drafts/:id` saves edits. `POST /rise/drafts/:id/confirm` publishes. `POST /rise/drafts/:id/discard` throws the draft away.

```
curl --data-binary @ad.jpg -H "Content-Type: image/jpeg" -i http://localhost:3000/rise
```

Uploaded images are never saved to disk. The image bytes live in memory for the length of the request and are dropped.

### Agent-ready: MCP (`/mcp`)

`POST /mcp` is a Model Context Protocol endpoint over plain JSON-RPC 2.0. It takes one message per request (no batches). `GET` and `DELETE` return 405. It has three tools:

- `search_listings` finds listings by `category`, `city`, or `query` (up to 25 results).
- `get_listing` returns one listing by `id`, plus its Owner-confirmed date and hash if it has one.
- `request_quote` sends a quote request to a business. Arguments: `id`, `name`, `contact` (email or phone), and `details`.

List the tools:

```
curl -s http://localhost:3000/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Search:

```
curl -s http://localhost:3000/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_listings","arguments":{"category":"plumbers","city":"Nashville"}}}'
```

Get one listing:

```
curl -s http://localhost:3000/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_listing","arguments":{"id":"LISTING_ID"}}}'
```

Request a quote:

```
curl -s http://localhost:3000/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"request_quote","arguments":{"id":"LISTING_ID","name":"Pat Smith","contact":"(615) 555-0100","details":"Kitchen sink is leaking. Can someone come Tuesday?"}}}'
```

Replace `LISTING_ID` with a real listing id, and use a category slug from `data/categories.json`.

Quote requests are also available without MCP: `POST /api/quotes` (JSON) and a plain HTML form on every listing page (`POST /listings/:id/quote`).

### WebMCP on listing pages

Each listing page loads `/js/webmcp.js`. In a browser that supports WebMCP, it registers `get_listing` and `request_quote` for that page. `request_quote` always asks the visitor to confirm before anything is sent. In browsers without WebMCP the script does nothing, and the page and its quote form work the same.

### Owner-confirmed stamp (`/api/verify/:id`)

A listing confirmed through Rise from the Grave shows an "Owner-confirmed" stamp with a date and a SHA-256 hash of the listing. The JSON-LD on the page carries the same hash as `identifier` and the date as `dateModified`.

- `GET /api/verify/:id` returns `{ id, verified, verifiedDate, hash, match }`.
- `GET /api/verify/:id?hash=...` also compares your hash with the current one. `match` is `true` or `false`, or `null` when you send no hash. The comparison ignores letter case and surrounding spaces.
- If the listing changes after confirmation, the hash changes and an old hash no longer matches.

Important: the stamp is a tamper check. It means the listing is unchanged since the owner confirmed it. It does not prove ownership or identity. Nothing in this app checks who confirmed a draft. Real ownership checks, for example a code sent by phone or email to the listed number, are future work.

### The Seance (`/seance/:id`)

The Seance asks an AI assistant "best <category> in <city>" for a listing and records whether the answer names the business. Runs are kept as history so you can compare answers before and after the owner confirmed the listing.

- `GET /seance/:id` HTML report for one listing. Works without JavaScript.
- `GET /api/seance/:id` the same history as JSON.
- `POST /seance/run` starts a new run. Send JSON `{ "id": "LISTING_ID" }` with the header `Authorization: Bearer <SEANCE_ADMIN_TOKEN>`. It returns 403 if no admin token is configured and 401 if the token is wrong.

Without an AI key, runs use a built-in mock, and every mock answer is labeled "Demo answer (no AI connected)".

### A2A decision

No A2A (agent-to-agent) endpoint is built. The app has a small seam where one could be mounted later, but nothing is mounted now, so `GET /.well-known/agent-card.json` returns 404 on purpose.

## Environment variables

All are optional. With none set, the app runs on port 3000 with mock providers and the repo `data/` folder.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `BASE_URL` | `http://localhost:3000` | Public site address used in `/llms.txt` and `/sitemap.xml`. A trailing slash is removed. |
| `DATA_DIR` | repo `data/` folder | Folder the app reads data from and writes its files to. |
| `TRUST_PROXY` | unset | Passed to Express `trust proxy`: `true`, `false`, a hop count such as `1`, or a subnet list. Set this behind a reverse proxy. Without it every client shares one rate-limit bucket, because they all appear to come from the proxy address. |
| `VISION_PROVIDER` | unset | `openai` or `anthropic`. Reads text from uploaded images in Rise from the Grave. Any other value uses the mock. |
| `VISION_API_KEY` | unset | API key for the vision provider. Without it the mock is used. |
| `VISION_MODEL` | unset | Model name for the vision provider. Required for a real provider. If it is missing, the app logs a warning and uses the mock. |
| `VISION_BASE_URL` | `https://api.openai.com/v1` | Base URL for an OpenAI-compatible vision API. Only used when `VISION_PROVIDER=openai`. |
| `NOTIFIER` | unset | `console` writes one JSON line per quote request (quote id and listing id only) to the console. Unset or any other value uses the mock, which sends nothing. |
| `SEANCE_PROVIDER` | unset | `openai` or `anthropic`. The AI assistant the Seance asks. Any other value uses the mock. |
| `SEANCE_API_KEY` | unset | API key for the Seance provider. Without it the mock is used. |
| `SEANCE_MODEL` | unset | Model name for the Seance provider. |
| `SEANCE_BASE_URL` | `https://api.openai.com/v1` | Base URL for an OpenAI-compatible Seance API. Only used when `SEANCE_PROVIDER=openai`. |
| `SEANCE_ADMIN_TOKEN` | unset | Bearer token required by `POST /seance/run`. When unset, that endpoint returns 403. |

API keys and the admin token are never logged, returned, or stored in data files.

### Mock providers

The vision, Seance, and notifier each use a mock whenever no key is set (for `NOTIFIER`, whenever it is not `console`). They also always use the mock under the test runner, even if keys are set, so tests never make network calls. A mock makes no network call and gives the same output for the same input.

- The mock vision provider returns fictional businesses chosen from the image bytes.
- The mock Seance gives canned answers, labeled "Demo answer (no AI connected)".
- The mock notifier keeps quote requests in memory only.

Real provider calls time out after 30 seconds.

### Rate limits

Limits are per client address unless noted. A refused request gets a 429 and a `Retry-After` header.

| Where | Limit |
| --- | --- |
| `POST /rise` | 10 per 10 minutes |
| `POST /mcp` | 120 per minute |
| Quote requests (MCP, `/api/quotes`, listing form) | 5 per hour per client |
| Quote requests for one listing | 3 per hour per listing |
| `POST /seance/run` | 10 per hour per client |
| `POST /seance/run` for one listing | 1 per 10 minutes per listing |

Counts are kept in memory and reset when the server restarts.

## Test

```
node --test
```

Tests use a temporary data folder and mock providers. They make no network calls.

## Data

Listings live in `data/listings.json` and categories in `data/categories.json`. They are read at startup. Each listing has an id, name, category, phone, hours, services, service area, description, city, state, and an optional address.

The seed data is fictional. The businesses, names, and phone numbers are made up for development and demonstration only.

### Files the web layer writes

Super Pages is the one place the web layer writes files. It writes only these, inside `DATA_DIR`, using a safe write (temp file, then rename):

- `drafts.json` drafts from Rise from the Grave
- `published.json` listings confirmed through Rise from the Grave
- `verified.json` the Owner-confirmed date for each confirmed listing
- `quotes.json` quote requests
- `seance.json` Seance run history

`listings.json` and `categories.json` are never written by the app. Published listings from `published.json` appear alongside the seed listings. The `data/` folder is never served over HTTP, so a request such as `/data/listings.json` returns 404. Uploaded images are never written anywhere.

## License

MIT. See `LICENSE`.
