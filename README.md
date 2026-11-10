# first-answer-pages
The old phone book, resurrected for AI. Free local business listings that AI assistants can read and recommend. Built with Kiro for Kiroween 2026.

First Answer Pages is a free local business directory with a classic phone-book look. Every listing has a plain HTML page, a JSON API entry, and a line in a plain-text feed (`/llms.txt`) so people and AI assistants can read it. It is part of First Answer (firstanswerhq.com).

## Go live on Render, step by step

The site runs on Render from the `render.yaml` Blueprint in this repository. Render deploys the `main` branch, so make sure the latest work is merged into `main` first.

The Starter plan and the 1 GB disk are both paid monthly. See [Render's pricing page](https://render.com/pricing) for the current prices.

### 1. Get an Anthropic API key

1. Go to the Claude Console (console.anthropic.com) and sign in.
2. Open API keys and create a key. Copy it somewhere safe; it is shown once.
3. The same key goes in two places below (`VISION_API_KEY` for reading photos and `SEANCE_API_KEY` for the Séance). Both are required: the Blueprint turns on the Anthropic provider for both, and the server will not start without the keys.

### 2. Create the service

1. In the Render dashboard choose **New**, then **Blueprint**, and pick this repository (branch `main`).
2. Render asks for the values that are not committed. Type in:
   - `BASE_URL`: the site's public address with no trailing slash. Use the Render address for now, for example `https://first-answer-pages.onrender.com`. If Render gives the service a different address, fix this value in step 3.
   - `SITE_NAME`: the name shown on every page.
   - `VISION_API_KEY` and `SEANCE_API_KEY`: your Anthropic key from step 1 (the same key in both).
3. Press **Apply**. Render builds and starts the service. It is ready when `https://<your address>/healthz` shows `{"ok":true}`.

### 3. Check the address

Open the service in Render. Its address is at the top of the page. If it is not what you typed for `BASE_URL`, go to **Environment**, fix `BASE_URL`, save, and press **Manual Deploy**.

`autoDeploy` is `false`, so pushing to the repository does not deploy. After each change, open the service and press **Manual Deploy**. A service with a disk restarts in place, so the site is down for a few seconds during each deploy.

### 4. Log in as admin

Render generates `ADMIN_TOKEN` for you. To read it, open the service, then **Environment**. Then open `/admin/login` on your site, paste the token, and press **Log in**. The login lasts 12 hours. Approve listings at `/admin/pending` and read quote requests at `/admin/quotes`.

### 5. Check TRUST_PROXY

`TRUST_PROXY` is the number of proxies in front of the app (`1` on Render). If it is wrong, every visitor looks like the same address and shares one rate limit. At startup in production the server logs one line, `trust proxy = N`.

To check it, open `/admin/whoami` from your phone while logged in (it is also in the admin menu as "My IP"). It shows `req.ip`, `req.ips`, and the current setting. Set `TRUST_PROXY` to the smallest number that shows your real IP address, then Manual Deploy. Send `Accept: application/json` to get the same answer as JSON.

### 6. Turn on quote emails (recommended before you promote the site)

Until this is on, quote requests are saved but nobody is emailed. Check `/admin/quotes` yourself.

1. Create a free Resend account (resend.com) with the project's email address.
2. In Resend, add and verify your domain (Resend shows the DNS records to add at your domain registrar). Emails can only be sent from a verified domain.
3. Create a Resend API key.
4. In Render, open **Environment** and add: `NOTIFIER` = `resend`, `RESEND_API_KEY` = the key, `NOTIFY_FROM` = for example `Quotes <quotes@your-domain.example>`, `ADMIN_EMAIL` = where you want a copy of every quote, and optionally `CONTACT_EMAIL` (shown on the About and Privacy pages). Save and press **Manual Deploy**.

### 7. Use your own domain

1. In Render, open the service, then **Settings**, then **Custom Domains**, and add your domain. Render shows the DNS records to add.
2. Add those records at your registrar (for example GoDaddy). It can take up to a day to start working.
3. Change `BASE_URL` to `https://your-domain` and press **Manual Deploy**.

### 8. Tell the search engines

1. Add the site to Google Search Console and submit `https://your-domain/sitemap.xml`.
2. Add it to Bing Webmaster Tools and submit the same sitemap. After that, every listing you approve is sent to Bing automatically (see "Tell Bing about new listings").

### Backups

Every listing, quote and draft lives on the 1 GB disk at `/var/data`. Render takes a snapshot of the disk every 24 hours and keeps each one for seven days. To restore, open the service's **Disk** page. A restore replaces the whole disk, and anything saved after that snapshot is lost.

### Tell Bing about new listings

When you approve a listing, the site tells Bing about it right away using IndexNow, a free, open standard. It sends the listing page, its category page, `/llms.txt` and `/sitemap.xml`, so Bing reads them in days instead of weeks. Bing shares these pings with the other IndexNow search engines. Unpublishing a listing sends its address too, so the removed page drops out sooner. Google doesn't take part in IndexNow, so add the site to Google Search Console once by hand.

It needs no account. On first start the site makes a key, saves it in `DATA_DIR/indexnow-key.txt`, and serves it at `/<key>.txt` so Bing can check the pings are really from this site. The ping never slows down or blocks an approval. The admin queue shows "Bing notified" (or why not) after each approval, and `/admin/indexnow` lists the last 20 pings. Set `INDEXNOW=off` to turn it off.

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
- `GET /llms.txt` plain-text feed of all listings. It explains how to request a quote (MCP tool or `POST /api/quotes`) and marks owner-confirmed listings with the confirmed date.
- `GET /sitemap.xml` XML sitemap
- `GET /healthz` liveness check. Returns `{ "ok": true }`.

The owner tools routes are listed in the next section.

## Owner tools

Four features help a business owner get listed and help AI assistants use the listing: List your business (`/rise`), Agent-ready (MCP and WebMCP), the Owner-confirmed stamp, and the Séance.

### List your business (`/rise`)

Turn a photo of a business card, sign, or flyer into a listing. Upload the image, review the draft the app extracts, fix any field, and confirm. A confirmed listing is public after review (see "Review before anything goes live" below). Nothing is public until the owner confirms and an admin approves.

- `GET /rise` the owner page: take or choose a photo, or press "No photo? Type it in" for an empty draft. With no photo reader connected in production, only the type-it-in option is shown.
- `POST /rise` accepts a raw JPEG, PNG, or WebP body (up to 5 MB) or a form post with a base64 field (up to 8 MB). On success it redirects to the draft review page.
- `GET /rise/drafts/:id` edit page for one draft.
- `POST /rise/drafts/:id` saves edits. `POST /rise/drafts/:id/confirm` sends the listing to the pending queue for review. `POST /rise/drafts/:id/discard` throws the draft away.

```
curl --data-binary @ad.jpg -H "Content-Type: image/jpeg" -i http://localhost:3000/rise
```

Uploaded images are never saved to disk. The image bytes live in memory for the length of the request and are dropped.

### Review before anything goes live

Owner confirmation sends a listing to a pending queue. It is public only after an admin approves it. In a browser, log in at `/admin/login` with `ADMIN_TOKEN` (the login lasts 12 hours). Scripts can send the header `Authorization: Bearer ADMIN_TOKEN` instead.

- `GET /admin/pending` lists listings waiting for review.
- `POST /admin/pending/:id/approve` makes a pending listing public.
- `POST /admin/pending/:id/reject` rejects a pending listing.
- `POST /admin/listings/:id/unpublish` takes a public listing down.
- `GET /admin/indexnow` shows the last 20 Bing pings (see "Tell Bing about new listings" above).
- `GET /admin/whoami` shows the client address the server sees (`req.ip`, `req.ips`) and the current `TRUST_PROXY` setting. See "Check TRUST_PROXY" above.

### Agent-ready: MCP (`/mcp`) and WebMCP

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

### The Owner-confirmed stamp (`/api/verify/:id`)

A listing confirmed by its owner (through `/rise`) shows an "Owner-confirmed" stamp with a date and a SHA-256 hash of the listing. The JSON-LD on the page carries the same hash as `identifier` and the date as `dateModified`.

- `GET /api/verify/:id` returns `{ id, verified, verifiedDate, hash, match }`.
- `GET /api/verify/:id?hash=...` also compares your hash with the current one. `match` is `true` or `false`, or `null` when you send no hash. The comparison ignores letter case and surrounding spaces.
- If the listing changes after confirmation, the hash changes and an old hash no longer matches.

Important: the stamp is a tamper check. It means the listing is unchanged since the owner confirmed it. It does not prove ownership or identity. Nothing in this app checks who confirmed a draft. Real ownership checks, for example a code sent by phone or email to the listed number, are future work.

### The Séance (`/seance/:id`)

The Séance asks an AI assistant "best <category> in <city>" for a listing and records whether the answer names the business. Runs are kept as history so you can compare answers before and after the listing went public (after owner confirmation and review).

- `GET /seance/:id` HTML report for one listing. Works without JavaScript.
- `GET /api/seance/:id` the same history as JSON.
- `POST /seance/run` starts a new run. Send JSON `{ "id": "LISTING_ID" }` with the header `Authorization: Bearer <ADMIN_TOKEN>`. It returns 403 if no admin token is configured and 401 if the token is wrong.

Without an AI key, runs use a built-in mock, and every mock answer is labeled "Demo answer (no AI connected)".

### A2A decision

No A2A (agent-to-agent) endpoint is built. The app has a small seam where one could be mounted later, but nothing is mounted now, so `GET /.well-known/agent-card.json` returns 404 on purpose.

## Environment variables

All are optional except in production, where `DATA_DIR` and `BASE_URL` are required (the server will not start without them). With none set, the app runs on port 3000 with mock providers and the repo `data/` folder.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. |
| `BASE_URL` | `http://localhost:3000` | Public site address used in `/llms.txt`, `/sitemap.xml` and listing page links. A trailing slash is removed. When it is not set (local use only), those use the host and port of the request instead. In production the set value is always used. |
| `DATA_DIR` | repo `data/` folder | Folder the app writes its files to (drafts, pending, published, verified, quotes, Séance history). Required when `NODE_ENV=production`. The seed files `listings.json` and `categories.json` are always read from the repo `data/` folder when `DATA_DIR` is set. |
| `NODE_ENV` | unset | `production` changes defaults: trust proxy is `1`, `DEMO_MODE` is off, seed sample listings are left out of `/sitemap.xml` and `/llms.txt`, and photo listing returns 503 "coming soon" when no vision key is set. On Render the Blueprint turns on the Anthropic provider for both the photo reader and the Séance, so the server will not start until `VISION_API_KEY` and `SEANCE_API_KEY` are set. |
| `SITE_NAME` | `First Answer Pages` | The name shown in page headers, page titles, the footer, `/llms.txt`, and the MCP server title. One line, up to 80 characters. |
| `DEMO_MODE` | `true` unless `NODE_ENV=production` | When on, every page has the `noindex` meta tag and a "Sample listings for demonstration" footer line. |
| `TRUST_PROXY` | `1` when `NODE_ENV=production`, otherwise unset | Only a whole-number proxy hop count is accepted, for example `1` for Render. `true`, `false`, and subnet lists are ignored with a warning. Set this behind a reverse proxy. Without it every client shares one rate-limit bucket, because they all appear to come from the proxy address. |
| `ADMIN_TOKEN` | unset | Bearer token for `/admin/*` and `POST /seance/run`. `SEANCE_ADMIN_TOKEN` still works as a fallback name. The admin routes return 403 when no token is set. 10 wrong attempts per hour per client are allowed. |
| `VISION_PROVIDER` | unset | `openai` or `anthropic`. Reads text from uploaded photos on the owner listing page (`/rise`). Any other value uses the mock. |
| `VISION_API_KEY` | unset | API key for the vision provider. Without it the mock is used. |
| `VISION_MODEL` | unset | Model name for the vision provider. Required for a real provider. If it is missing, the app logs a warning and uses the mock. |
| `VISION_BASE_URL` | `https://api.openai.com/v1` | Base URL for an OpenAI-compatible vision API. Only used when `VISION_PROVIDER=openai`. |
| `NOTIFIER` | `none` | `none` saves quotes and sends no email; `/admin/quotes` shows "Emailed: no (email not set up)". `resend` emails each quote through Resend. `console` writes one JSON line per quote request (quote id and listing id only) to the console. Any other value logs a warning and uses `none`. In production, `resend` without the three settings below refuses to start; elsewhere it falls back to `none` with a warning. |
| `RESEND_API_KEY` | unset | Resend API key. Needed when `NOTIFIER=resend`. Never logged. |
| `NOTIFY_FROM` | unset | Sender address for quote emails, for example `Quotes <quotes@your-domain.example>`. Needed when `NOTIFIER=resend`. |
| `ADMIN_EMAIL` | unset | Every quote email also goes to this address. Needed when `NOTIFIER=resend`. The listing's private owner email, if set, gets it too. |
| `SEANCE_PROVIDER` | unset | `openai` or `anthropic`. The AI assistant the Séance asks. Any other value uses the mock. |
| `SEANCE_API_KEY` | unset | API key for the Séance provider. Without it the mock is used. |
| `SEANCE_MODEL` | unset | Model name for the Séance provider. |
| `SEANCE_BASE_URL` | `https://api.openai.com/v1` | Base URL for an OpenAI-compatible Séance API. Only used when `SEANCE_PROVIDER=openai`. |
| `SEANCE_TIMEOUT_MS` | `120000` | How long one Séance question may take, in milliseconds. One deadline covers the first call and any resend. The photo reader keeps 30 seconds. Must be a positive whole number; anything else logs a warning and uses 120000. |
| `MAX_AI_CALLS_PER_DAY` | `200` | Daily cap on paid AI provider calls, shared by photo listing and the Séance. Every paid call counts, including the second call when a Séance answer needs a continuation. Photo uploads may use at most 150 of the total (or the whole cap if it is lower), so uploads never block Séance runs. The day runs midnight to midnight Central time (America/Chicago). The count is saved in `DATA_DIR/ai-budget.json`, so a restart does not reset it. Over the cap, people see "Try again tomorrow". Must be a positive whole number; anything else logs a warning and uses 200. |
| `INDEXNOW` | `on` | Set to `off` to stop telling Bing about new and removed listings (see "Tell Bing about new listings" above). It only ever runs on the live site: `NODE_ENV=production`, `DEMO_MODE` off, and an `https` `BASE_URL` that is not a local address. |
| `CONTACT_EMAIL` | (none) | An email address shown as plain text on `/about`, `/privacy` and in every page footer, so people can ask questions or ask for removal. Leave it unset to show no contact line. |
| `SEANCE_ADMIN_TOKEN` | unset | Older name for `ADMIN_TOKEN`. Used only when `ADMIN_TOKEN` is not set. |
| `NODE_TEST_CONTEXT` | unset | Set by Node's test runner, not by you. When present, all providers use the mock. Do not set it in production. |

API keys and the admin token are never logged, returned, or stored in data files.

### Mock providers

The vision provider, Séance, and notifier each use a mock whenever no key is set (for `NOTIFIER`, `none` sends nothing and says so). They also always use the mock under the test runner, even if keys are set, so tests never make network calls. A mock makes no network call and gives the same output for the same input.

- The mock vision provider returns fictional businesses chosen from the image bytes.
- The mock Séance gives canned answers, labeled "Demo answer (no AI connected)".
- The mock notifier keeps quote requests in memory only.

Photo reader calls time out after 30 seconds. Séance questions get 120 seconds (`SEANCE_TIMEOUT_MS`).

In production the Séance never runs on the mock: `POST /seance/run` answers 503 "Séance is not connected" until a real provider is set. Séance answers that used web search list their sources under the answer.

### Rate limits

Limits are per client address unless noted. A refused request gets a 429 and a `Retry-After` header.

| Where | Limit |
| --- | --- |
| `POST /rise` | 10 per 10 minutes |
| `POST /mcp` | 120 per minute |
| Quote requests (MCP, `/api/quotes`, listing form) | 5 per hour per client |
| Quote requests for one listing | 3 per hour per client per listing |
| `POST /seance/run` | 10 per hour per client |
| `POST /seance/run` for one listing | 1 per 10 minutes per listing |

The per-listing quote limit is counted for each client and each listing together, so one client sending 3 requests to a listing does not block other clients from quoting that listing.

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

The owner tools are the one place the web layer writes files. It writes only these, inside `DATA_DIR`, using a safe write (temp file, then rename):

- `drafts.json` owner drafts from `/rise`
- `pending.json` drafts waiting for review
- `published.json` owner listings an admin approved
- `verified.json` the Owner-confirmed date for each confirmed listing
- `quotes.json` quote requests
- `seance.json` Séance run history
- `ai-budget.json` the day's count of paid AI calls (written only when a real provider call is counted)
- `indexnow-key.txt` the site's IndexNow key (written once, on the live site only)

`listings.json` and `categories.json` are never written by the app. Published listings from `published.json` appear alongside the seed listings. The `data/` folder is never served over HTTP, so a request such as `/data/listings.json` returns 404. Uploaded images are never written anywhere.

## License

MIT. See `LICENSE`.
