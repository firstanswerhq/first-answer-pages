# first-answer-pages
The old phone book, resurrected for AI. Free local business listings that AI assistants can read and recommend. Built with Kiro for Kiroween 2026.

First Answer Pages is a free local business directory with a classic phone-book look. Every listing has a plain HTML page, a JSON API entry, and a line in a plain-text feed (`/llms.txt`) so people and AI assistants can read it. It is part of First Answer (firstanswerhq.com).

## Go live on Render, step by step

The site runs on Render from the `render.yaml` Blueprint in this repository. Render deploys the `main` branch of the GitHub repository, which always holds the finished, reviewed version.

The Starter plan and the 1 GB disk are both paid monthly. See [Render's pricing page](https://render.com/pricing) for the current prices.

### 0. Accounts you need

- **GitHub**: the account that owns this repository.
- **Render**: sign up at render.com with **Sign up with GitHub**, so Render can see the repository.
- **Anthropic** (step 1) for the photo reader and the Séance.

### 1. Get an Anthropic API key

1. Go to the Claude Console (console.anthropic.com) and sign in.
2. Under **Billing**, add a payment method and buy some credits. The key does not work until the account has credits.
3. Under **Limits**, set a monthly spend limit you are comfortable with. The site also stops itself after 200 AI calls a day (`MAX_AI_CALLS_PER_DAY`), and each Séance web search costs $10 per 1,000 searches plus normal usage.
4. Open **API keys** and create a key. Copy it somewhere safe; it is shown once.
5. The same key goes in two places below (`VISION_API_KEY` for reading photos and `SEANCE_API_KEY` for the Séance). Both are required: the Blueprint turns on the Anthropic provider for both, and the server will not start without the keys.

### 2. Create the service

1. In the Render dashboard choose **New**, then **Blueprint**, and pick this repository (branch `main`).
2. Render asks for the values that are not committed. Type in:
   - `BASE_URL`: the site's public address with no trailing slash. Use the Render address for now, for example `https://first-answer-pages.onrender.com`. If Render gives the service a different address, fix this value in step 3.
   - `SITE_NAME`: the name shown on every page.
   - `VISION_API_KEY` and `SEANCE_API_KEY`: your Anthropic key from step 1 (the same key in both).
   - `CONTACT_EMAIL`: the email address people can write to. It appears on the About and Privacy pages and in the footer.
   - Leave `RESEND_API_KEY`, `NOTIFY_FROM` and `ADMIN_EMAIL` blank for now. They are for quote emails (step 6).
3. Press **Apply**. Render builds and starts the service. It is ready when `https://<your address>/healthz` shows `{"ok":true}`.

### 3. Check the address

Open the service in Render. Its address is at the top of the page. If it is not what you typed for `BASE_URL`, go to **Environment**, fix `BASE_URL`, save, and press **Manual Deploy**.

`autoDeploy` is `false`, so pushing to the repository does not deploy. After each change, open the service and press **Manual Deploy**. A service with a disk restarts in place, so the site is down for a few seconds during each deploy.

### 4. Log in as admin

Render generates `ADMIN_TOKEN` for you. To read it, open the service, then **Environment**. Then open `/admin/login` on your site, paste the token, and press **Log in**. The login lasts 12 hours. Approve listings at `/admin/pending` and read quote requests at `/admin/quotes`.

### 5. Check TRUST_PROXY

Render already sets `TRUST_PROXY` to `1`, which should be right. To check it:

1. On your phone, turn off Wi-Fi, log in as admin, and open `/admin/whoami` (it is also in the admin menu as "My IP").
2. In another tab, open whatismyipaddress.com.
3. If the address on `/admin/whoami` matches, you're done.

If it doesn't match, ask for help before changing it. (For developers: the page shows `req.ip` and `req.ips`. Set `TRUST_PROXY` to the smallest hop count that shows the real client IP, then Manual Deploy. At startup in production the server logs `trust proxy = N`, and `Accept: application/json` returns the same answer as JSON.)

### 6. Turn on quote emails (recommended before you promote the site)

Until this is on, quote requests are saved but nobody is emailed. Open `/admin/quotes` every day and use **Forward this quote to the business** to send each new quote on yourself, or call the business if it gave no email.

1. Create a free Resend account (resend.com). Use the email address you use for this business.
2. Do this after step 7, once your own domain works. In Resend, add and verify your domain. Resend shows the DNS records to add at your domain registrar. Emails can only be sent from a verified domain.
3. Create a Resend API key.
4. In Render, open **Environment** and add `NOTIFIER` = `resend` (when it isn't set, no email is sent). Fill in `RESEND_API_KEY` (the key), `NOTIFY_FROM` (for example `Quotes <quotes@your-domain.example>`) and `ADMIN_EMAIL` (where you want a copy of every quote). Save and press **Manual Deploy**.

The same setting turns on short heads-up emails to `ADMIN_EMAIL` about the AI Visibility Check: one when half of the day's Grader AI calls are used, one at 90%, and one "the human check may be set up wrong" email on a day when the human check has turned away 10 or more checks and passed none. Each is sent at most once a day and holds counts only, never a business name or anyone's details. With `NOTIFIER` unset, none of these are sent.

### 7. Use your own domain

1. In Render, open the service, then **Settings**, then **Custom Domains**, and add your domain. Render shows the DNS records to add.
2. Add those records at your registrar (for example GoDaddy). It can take up to a day to start working.
3. Change `BASE_URL` to `https://your-domain` and press **Manual Deploy**.

### 8. Tell the search engines

Do this after step 7, once your own domain works.

1. In Google Search Console, add a **Domain** property for your domain. Google asks you to prove you own it by adding a TXT record at your registrar, and shows the exact record to copy. Then open **Sitemaps** and submit `https://your-domain/sitemap.xml`.
2. In Bing Webmaster Tools, choose **Import from Google Search Console**, so you don't have to verify again. After that, every listing you approve is sent to Bing automatically (see "Tell Bing about new listings").

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
- `GET /llms.txt` plain-text feed of all listings. It explains how to request a quote (MCP tool or `POST /api/quotes`) and marks listings whose details were confirmed by the business with the confirmed date.
- `GET /sitemap.xml` XML sitemap
- `GET /healthz` liveness check. Returns `{ "ok": true }`.

The owner tools routes are listed in the next section.

## Owner tools

Four features help a business owner get listed and help AI assistants use the listing: List your business (`/rise`), Agent-ready (MCP and WebMCP), the "Details confirmed by the business" stamp, and the Séance.

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
- `get_listing` returns one listing by `id`, plus its details-confirmed date and hash if it has one.
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

### The "Details confirmed by the business" stamp (`/api/verify/:id`)

A listing confirmed by its owner (through `/rise`) shows a "Details confirmed by the business" stamp with a date and a SHA-256 hash of the listing. The JSON-LD on the page carries the same hash as `identifier` and the date as `dateModified`.

- `GET /api/verify/:id` returns `{ id, verified, verifiedDate, hash, match }`.
- `GET /api/verify/:id?hash=...` also compares your hash with the current one. `match` is `true` or `false`, or `null` when you send no hash. The comparison ignores letter case and surrounding spaces.
- If the listing changes after confirmation, the hash changes and an old hash no longer matches.

Important: the stamp is a tamper check. It means the listing is unchanged since the owner confirmed it. It does not prove ownership or identity. Nothing in this app checks who confirmed a draft. The separate paid "Verified" stamp is the identity check: a code sent to the listed phone plus a photo ID check.

### The Séance (`/seance/:id`)

The Séance asks an AI assistant "best <category> in <city>" for a listing and records whether the answer names the business. Runs are kept as history so you can compare answers before and after the listing went public (after owner confirmation and review).

- `GET /seance/:id` HTML report for one listing. Works without JavaScript.
- `GET /api/seance/:id` the same history as JSON.
- `POST /seance/run` starts a new run. Send JSON `{ "id": "LISTING_ID" }` with the header `Authorization: Bearer <ADMIN_TOKEN>`. It returns 403 if no admin token is configured and 401 if the token is wrong.

Without an AI key, runs use a built-in mock, and every mock answer is labeled "Demo answer (no AI connected)".

### The AI Visibility Grader (`/grade`)

A free check for one local business. The owner types the business name, city, state, what they do, and a website if they have one. In about two minutes the Grader shows:

- whether an AI assistant names the business when asked for the best business like it in that city, and who it names instead;
- whether the business's website lets AI assistants in (`robots.txt`), labels its name and phone in a way AI can read, and has an `llms.txt` info sheet;
- whether the home page has the search and customer basics (city and service in the title, a tap-to-call phone number, hours, address, a call or book button, and customer reviews AI can read). A business that goes to its customers can check "We go to our customers (no storefront)", and the check then looks for the area it serves instead of a street address.

Every number on the report is something the Grader measured. It shows no dollar figures. The report ends with the fix: a free listing already filled in from what the scan found, with one button to claim it. The claim uses the same draft review as `/rise`, so nothing goes live until the owner confirms it and an admin approves it. The report never promises that AI will name the business. It says AI assistants pick up changes over days to weeks.

**How a website is read.** The server fetches the home page, `/robots.txt` and `/llms.txt` through a safe fetcher. It visits only public websites on ports 80 and 443, checks every address (including each redirect) before connecting, connects only to the address it checked, stops after 10 seconds or 2 MiB, and sends no cookies. It never runs the page's scripts. `/grade/about` tells website owners what is read and why.

**The AI check.** The Grader uses the same assistant provider as the Séance (`SEANCE_PROVIDER`). With the mock provider, every answer is labeled "Demo answer (no AI connected)". In production the mock never answers: the AI part says it isn't connected.

**Lead gate.** With `GRADER_LEAD_GATE=on` (the default) the free part of a report is open to anyone with the link. The full report (every check, the fix for each, and the copy-and-paste fix kit) opens after the visitor sends their name, email and phone. Opening it also asks Claude two more questions, once each. With `GRADE_MAIN_ASKS=3` (the default) the free question is asked up to 3 times, but the score counts only Claude's answers to the free question (up to 3 with the default, 1 with `GRADE_MAIN_ASKS=1`), so it does not change when the report opens. The answers to the two extra questions are shown and not counted. Set `GRADER_LEAD_GATE=off` to show the full report to everyone, for demos and contest judges. The cookie that opens a report is signed with `GRADER_SECRET`.

**Where leads appear.** Log in as admin, then open `/admin/leads` for the newest 100 leads and `/admin/grades` for the newest 100 grades (with a Delete button for removal requests). Above the list, `/admin/grades` also shows how the protection is set up (the human check and the heads-up emails, on or off) and today's counts: AI calls used and left, checks run, human-check passes and refusals, and refusals by the per-address and per-network limits. With `NOTIFIER=resend`, each new lead is also emailed to `ADMIN_EMAIL` only, never to a business owner.

**How the AI cap is shared.** Grader AI calls count against `MAX_AI_CALLS_PER_DAY`. They have their own daily share, `GRADE_AI_CALLS_PER_DAY` (default 60). Grader and photo calls together never use the quarter of the day kept for Séance runs. If the Grader's share is used up, the report says the AI check can be run again later. A second grade with the same details within 7 days reuses the earlier AI answer.

**Privacy.** Every `/grade` page is not listed in search engines (`X-Robots-Tag: noindex, nofollow`) and is left out of `sitemap.xml`, `llms.txt` and the MCP tools. Grades and leads are deleted after 90 days. To remove a report sooner, use the Delete button at `/admin/grades`. Set `GRADER_ENABLED=off` to turn the Grader off (every `/grade` address returns 404).

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
| `NOTIFIER` | `none` | `none` saves quotes and sends no email; `/admin/quotes` shows "Emailed: no (email not set up)". `resend` emails each quote through Resend. `console` writes one JSON line per quote request (quote id and listing id only) to the console. Any other value logs a warning and uses `none`. In production, `resend` without the three settings below refuses to start; elsewhere it falls back to `none` with a warning. With `resend`, `ADMIN_EMAIL` also gets the AI Visibility Check heads-up emails (50% and 90% of the day's Grader AI calls, and "the human check may be set up wrong" on a day with 10 or more human-check refusals and no pass), counts only. When `NOTIFIER` is unset, nothing is sent. |
| `RESEND_API_KEY` | unset | Resend API key. Needed when `NOTIFIER=resend`. Never logged. |
| `NOTIFY_FROM` | unset | Sender address for quote emails, for example `Quotes <quotes@your-domain.example>`. Needed when `NOTIFIER=resend`. |
| `ADMIN_EMAIL` | unset | Every quote email also goes to this address. Needed when `NOTIFIER=resend`. The listing's private owner email, if set, gets it too. With `NOTIFIER=resend` this address also gets the AI Visibility Check heads-up emails: one at 50% and one at 90% of the day's Grader AI calls, and one "the human check may be set up wrong" email on a day with 10 or more human-check refusals and no pass. Each is sent at most once a day, with counts only. |
| `SEANCE_PROVIDER` | unset | `openai` or `anthropic`. The AI assistant the Séance asks. Any other value uses the mock. |
| `SEANCE_API_KEY` | unset | API key for the Séance provider. Without it the mock is used. |
| `SEANCE_MODEL` | unset | Model name for the Séance provider. |
| `SEANCE_BASE_URL` | `https://api.openai.com/v1` | Base URL for an OpenAI-compatible Séance API. Only used when `SEANCE_PROVIDER=openai`. |
| `SEANCE_TIMEOUT_MS` | `120000` | How long one Séance question may take, in milliseconds. One deadline covers the first call and any resend. The photo reader keeps 30 seconds. Must be a positive whole number; anything else logs a warning and uses 120000. |
| `MAX_AI_CALLS_PER_DAY` | `200` | Daily cap on paid AI provider calls, shared by photo listing and the Séance. Every paid call counts, including the second call when a Séance answer needs a continuation. Photo uploads may use at most 150 of the total, and never more than three quarters of it, so uploads never block Séance runs. The day runs midnight to midnight Central time (America/Chicago). The count is saved in `DATA_DIR/ai-budget.json`, so a restart does not reset it. Over the cap, people see "Try again tomorrow". Must be a positive whole number; anything else logs a warning and uses 200. |
| `FOUNDERS_CAP` | `500` | How many Founding Member spots there are. A listing sent in before `FOUNDERS_DEADLINE` gets the next number when it is approved, until the spots run out. This number is printed on every badge ("No. 12 of 500"), so do not change it once badges are showing. Set to `0` to turn the program off. |
| `FOUNDERS_DEADLINE` | `2027-01-31` | The last day to sign up for a Founding Member spot, written as `YYYY-MM-DD`. Sign-ups close at midnight at the end of that day, Nashville time. A listing sent in on time can still get a number even if it is approved later. |
| `STRIPE_SECRET_KEY` | none | Stripe key for the paid Verified stamp (takes the fee and runs the photo ID check). A key that starts with `sk_test_` runs in test mode: no real money, no real IDs, and no stamp is shown to the public. Verification stays off until this and the three Twilio values are all set. |
| `STRIPE_WEBHOOK_SECRET` | none | Optional. Lets Stripe tell the site about a payment or ID result even if the owner closes the page early. Strongly recommended on the live site: it is also how a refund or a card dispute takes the stamp off. Point a Stripe webhook at `/webhooks/stripe`, choose the Snapshot payload style, and send these events: `checkout.session.completed`, `identity.verification_session.verified`, `identity.verification_session.requires_input`, `charge.refunded`, `charge.dispute.created`. |
| `TWILIO_ACCOUNT_SID` | none | Twilio account id, for texting or calling the listing's phone with a code. |
| `TWILIO_AUTH_TOKEN` | none | Twilio secret that goes with the account id. |
| `TWILIO_VERIFY_SERVICE_SID` | none | The id of the Twilio Verify service that sends the codes (starts with `VA`). |
| `VERIFY_FOUNDER_FEE_CENTS` | `1900` | What a Founding Member pays, once, to be verified for life. In cents: `1900` is $19. |
| `VERIFY_YEARLY_FEE_CENTS` | `4900` | What everyone else pays per year to be verified. In cents: `4900` is $49. |
| `CHATGPT_API_KEY` | none | Optional. An OpenAI API key. When set, the AI Visibility Check asks ChatGPT (with live web search) the same questions it asks the main assistant, and the report shows both. Each second opinion is one more AI call per question: with all four second-opinion keys set (ChatGPT, Gemini, Grok, Perplexity) a check uses up to 5 calls per question instead of 1, from the same `GRADE_AI_CALLS_PER_DAY` allowance, so raise that allowance (for example to 150) when you add keys. |
| `CHATGPT_MODEL` | `gpt-6.1-terra` | Which OpenAI model answers as ChatGPT. |
| `GEMINI_API_KEY` | none | Optional. A Google AI Studio API key. When set, the AI Visibility Check also asks Gemini the same questions (without live web search: Google's grounding terms forbid analyzing, storing or sharing searched answers the way the report does), and the report shows its answers for comparison. They are not scored. Second opinions are skipped once 12 or fewer of the day's Grader AI calls are left. |
| `GEMINI_MODEL` | `gemini-3.1-flash-lite` | Which Google model answers as Gemini. |
| `GEMINI_NAME_CHECK` | `on` | With a `GEMINI_API_KEY`, every AI answer (Claude's and the second opinions') is also read by Google's Gemini Decisions API as a second check. Names it is very sure are not businesses (headings, tips, review sites) are dropped from the competitor list, and the checked business counts as named when Gemini is very sure a listed name is the same business in a slightly different form (a typo, a shortened name, or a missing "The" or "LLC"). This can raise the AI score. Each stored AI answer makes one extra Gemini call, and that call is not counted in `MAX_AI_CALLS_PER_DAY` or `GRADE_AI_CALLS_PER_DAY`. Any failure keeps our own reading. Set to `off` to turn it off. |
| `GEMINI_DECISION_MODEL` | `gemini-decision-1` | Which Gemini Decisions model does that check. |
| `XAI_API_KEY` | none | Optional. An xAI API key. When set, the AI Visibility Check also asks Grok (with live web search) the same questions; its answers are shown for comparison and not scored. |
| `XAI_MODEL` | `grok-4.7` | Which xAI model answers as Grok. |
| `PERPLEXITY_API_KEY` | none | Optional. A Perplexity API key. When set, the AI Visibility Check also asks Perplexity (with live web search) the same questions; its answers are shown for comparison and not scored. |
| `PERPLEXITY_MODEL` | `perplexity/sonar` | Which Perplexity model answers. |
| `GEMINI_LIVE_SEARCH` | `on` | With a `GEMINI_API_KEY`, the report offers "Show Google's live answer": Gemini with live Google Search, shown only to the browser that ran the check (Google's grounding terms), never saved, scored or logged. Each click is one paid call against the day's Grader AI calls. Each report allows at most 3 live answers in total, on top of the hourly limits; after that the button is hidden. Set to `off` to hide it. |
| `GRADER_ENABLED` | `on` | Set to `off` to hide the AI Visibility Grader at `/grade` (every `/grade` address returns 404) and its link on the home page. |
| `GRADER_LEAD_GATE` | `on` | With `on`, the full Grader report opens after the visitor sends a short form (name, email, phone). Set to `off` to show the full report to everyone, for demos and contest judges. |
| `GRADE_AI_CALLS_PER_DAY` | `60` | The Grader's share of the daily AI cap (`MAX_AI_CALLS_PER_DAY`). Grader and photo calls together never use the quarter of the day kept for Séance runs. Must be a whole number, 0 or more; anything else logs a warning and uses 60. |
| `GRADE_NETWORK_PER_DAY` | `20` | How many new AI Visibility Checks one network may start in a day. A network is the first three parts of an IPv4 address or the first four groups of an IPv6 address, so people on the same mobile network share it. This is on top of the per-address limits (5 an hour, 6 a day). Must be a positive whole number; anything else logs a warning and uses 20. If the site is ever put behind Cloudflare's proxy, `TRUST_PROXY` must be `2`, or every visitor appears to share a few Cloudflare addresses. |
| `GRADE_MAIN_ASKS` | `3` | How many times the AI Visibility Check asks Claude its free question. AI answers change from one time to the next, so asking more than once gives a steadier score; each ask is one more AI call from `GRADE_AI_CALLS_PER_DAY`. Must be 1, 2 or 3; anything else logs a warning and uses 3. |
| `GRADE_MAX_RUNNING` | `20` | How many AI Visibility Checks may run at the same time. The rest wait in line and see "You're in line. Your check starts in a moment." Must be a positive whole number; anything else logs a warning and uses 20. |
| `TURNSTILE_SITE_KEY` | unset | The public key of a free Cloudflare Turnstile widget. The human check on the AI Visibility Check form is on only when this and `TURNSTILE_SECRET_KEY` are both set. Add this site's address to the widget's hostname list in Cloudflare. If a real check fails after you paste the keys, delete either key and the site works as before. |
| `TURNSTILE_SECRET_KEY` | unset | The secret key of the same widget. Never logged, stored or shown. If Cloudflare says the secret is wrong or has an error of its own, the check is let through and `turnstile=misconfigured` is logged (no key). If Cloudflare cannot be reached, the check is let through too and the limits still apply. |
| `GRADER_SECRET` | unset | Secret that signs the Grader's form timer and the cookie that opens a full report. Render generates one. Without it the server makes a random one at startup and logs a warning, and opened reports lock again after a restart. Never logged. |
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
| `POST /grade` (new grades) | 5 per hour and 6 per day per client (with the default `GRADE_MAIN_ASKS=3`, each check can use up to 5 Claude calls, plus 1 per second-opinion key for each of its 3 questions, so up to 17 with all four keys set; a reply that needs a resend costs 1 more. The Grader's calls come from `GRADE_AI_CALLS_PER_DAY`, 60 a day by default) |
| `POST /grade/:id/unlock` | 5 per hour per client |
| `POST /grade/:id/recheck` | 10 per hour per client, and 1 per 2 minutes per grade |
| `POST /grade/:id/claim` | the same limit as `POST /rise` (10 per 10 minutes) |

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
- `verified.json` the details-confirmed date for each confirmed listing
- `quotes.json` quote requests
- `seance.json` Séance run history
- `grades.json` Grader reports (deleted after 90 days)
- `leads.json` contact details people gave to open a full Grader report (deleted after 90 days)
- `ai-budget.json` the day's count of paid AI calls (written only when a real provider call is counted)
- `indexnow-key.txt` the site's IndexNow key (written once, on the live site only)

`listings.json` and `categories.json` are never written by the app. Published listings from `published.json` appear alongside the seed listings. The `data/` folder is never served over HTTP, so a request such as `/data/listings.json` returns 404. Uploaded images are never written anywhere.

## License

MIT. See `LICENSE`.
