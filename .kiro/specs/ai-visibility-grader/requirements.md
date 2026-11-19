# Requirements Document

## Introduction

The AI Visibility Grader adds a free, public check to First Answer Pages. A local business owner types their business name, city, state and service, plus their website if they have one. In about two minutes the Grader tells them, in plain words:

1. whether an AI assistant names their business when asked "best <service> in <city>", and which competitors it names instead;
2. whether AI assistants are allowed to read their website, and whether their details are labeled so AI can read them;
3. whether their home page covers the search and customer basics (city and service in the title, a phone people can tap, hours, a call or book button).

The moment the scan ends, the report shows the fix next to the problem: a free First Answer Pages listing already filled in from what the scan found, with blanks for anything it could not find, and one button to claim it. The claim uses the existing draft review flow, so nothing goes live without the owner checking it and an admin approving it.

The Grader is modeled on what works in Owner.com's restaurant grader (one-field start, a scan that shows its work, one headline score, named competitors, the full report behind a short form) and adds what that grader does not show: the AI-answers check and the AI-readability check. It deliberately leaves out any made-up "lost sales" dollar figure: every number the Grader shows is something it measured.

This spec is version one. Version two (out of scope here) adds a text-message code, a GoHighLevel hand-off, Google business data, and a neighborhood-by-neighborhood search check.

### Fit with the existing spec

The Grader reuses, and does not change the behavior of: the Assistant_Provider and its web search (Requirement 12 of `super-pages`), the Seance name normalization, the AI_Budget daily cap, the Rate_Limiter, the Draft_Store and the `/rise/drafts/:id` review and confirmation flow, the admin login, the Notifier, the `layout()` page shell, and the `SITE_NAME` swap. It adds two storage collections, `grades` and `leads`, under the same storage rules as `drafts`, `quotes` and `seance`.

### Trademark and wording rules

The words "Yellow Pages" and "YP", and any walking-fingers logo, are never used. Visible text uses plain words and American spelling. The Grader never says or implies that claiming a listing will make an AI assistant name the business; it says AI assistants pick up changes over days to weeks.

### Tech Constraints

Node.js 22, plain Express, plain JavaScript ES modules, JSON files under `DATA_DIR`, `node:test` plus `fast-check`. No new dependencies: HTML reading, robots.txt reading and safe fetching are written with Node built-ins (`node:http`, `node:https`, `node:dns`, `node:net`, `node:zlib`, `node:crypto`). Every page works with JavaScript turned off; a small optional script only improves the scan screen and the copy buttons.

## Glossary

- **Server**: The Express application.
- **Grader**: The component that runs a Grade from start to finish.
- **Grade**: One run of the Grader for one business, stored in the `grades` collection.
- **Grade_Id**: The Grade's public identifier: 22 characters of URL-safe base64 from 16 random bytes.
- **Grade_Input**: The business name, city, state, service and optional website the visitor typed.
- **Website_Checker**: The component that fetches the business's home page, `/robots.txt` and `/llms.txt` through the Safe_Fetcher and turns them into Page_Facts.
- **Safe_Fetcher**: The component that fetches a public web address under the limits in Requirement 3.
- **Page_Facts**: The facts read from one home page: title, meta description, Open Graph title and image, main headlines, image alt text counts, tap-to-call links, JSON-LD blocks, viewport tag, visible text, and call-to-action labels.
- **Robots_Reader**: The function that reads a robots.txt file into user-agent groups and answers whether an agent may fetch `/`.
- **AI_Agents**: The crawler names checked in robots.txt: `GPTBot`, `OAI-SearchBot`, `ChatGPT-User`, `ClaudeBot`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Google-Extended`.
- **Check**: One scored test with a fixed id, group, points, plain label, and fix sentence.
- **Check_Result**: The outcome of one Check: `pass`, `fail`, or `not_checked`, plus a short plain detail.
- **Group**: One of `ai_answers` (30 points), `ai_readable` (20), `search_basics` (20), `customer_basics` (15), `google_profile` (15).
- **Score**: `round(100 × earned ÷ available)`, where `available` is the sum of points of Checks whose result is `pass` or `fail`, and `earned` is the sum of points of Checks whose result is `pass`.
- **AI_Question**: A prompt sent to the Assistant_Provider about a Grade's service and city.
- **AI_Result**: The outcome of one AI_Question: the provider label, the answer text, whether the business was named, its place in the answer's list (or none), the competitor names found, and the time taken.
- **Name_Matcher**: The function that decides whether an answer names the business.
- **Competitor_Extractor**: The function that pulls business names out of an answer's list lines.
- **Free_Part**: The part of a report shown to anyone with the Grade link.
- **Full_Report**: The part of a report shown after the Lead_Form is sent, or always when the Lead_Gate is off.
- **Lead_Form**: The short form (name, email, phone, optional contact permission) that unlocks the Full_Report.
- **Lead_Gate**: The setting `GRADER_LEAD_GATE`: `on` (default) or `off`. `off` is for contest judges and demos.
- **Lead**: One sent Lead_Form, stored in the `leads` collection.
- **Free_Page_Preview**: The listing card shown in the Free_Part, filled from the Grade's facts, with blanks for missing fields.
- **Fix_Kit**: The copy-and-paste fixes in the Full_Report: a suggested page title, a suggested Google summary, a JSON-LD block, an llms.txt draft, and robots.txt lines.
- **Recheck**: A re-run of the website Checks only, with no AI_Question.
- **AI_Budget**: The existing daily cap on paid AI calls, extended with a `grade` share.
- **Scan_Step**: One of the named steps shown while a Grade runs.
- **No_Storefront**: The optional Grade_Input setting `noStorefront`, ticked by a business that goes to its customers and shows no street address. Stored on the Grade only when ticked.
- **Service_Area_Text**: Words on the home page that name the area a business serves, such as "Serving Tallahassee and nearby areas", "Service area:", "Areas we serve" or "We serve Tallahassee and nearby areas" (after "serving" or "we serve", the city name or an area word must follow close by), or an `areaServed` value in the page's business label.
- **Review_Signal**: Something on the home page that shows customer reviews in a way AI can read: a review or testimonial heading, a written-out rating, a quoted customer comment with a name, a link to the business's reviews on a Review_Site, or review data in the page's business label. A bare "Reviews" menu link or footer social link is not a Review_Signal.
- **Review_Site**: Google, Yelp, Facebook or Nextdoor. The exact addresses that count are in Requirements 19.1 (on a home page) and 20.2 (typed by an owner).
- **Reviews_Link**: An optional listing field: an https link to the business's reviews on a Review_Site.
- **Website_Link**: An optional listing field: a public `https` link to the business's own website, kept without its query string or `#` part.

## Requirements

### Requirement 1: Grade Form

**User Story:** As a business owner, I want to start a grade by typing a few details I already know, so that I get an answer without creating an account.

#### Acceptance Criteria

1. WHEN a client sends `GET /grade`, THE Server SHALL respond with HTTP status 200 and an HTML page whose main headline asks whether AI can find the business, and a form with fields for business name, city, state, service, and website, that submits to `POST /grade` and works with JavaScript turned off.
2. THE grade form SHALL require business name (1 to 120 characters after trimming), city (1 to 80 characters), state (a two-letter US state code, or a full state name that the existing state normalizer accepts), and service (1 to 60 characters); website SHALL be optional.
3. THE grade form SHALL offer the category labels from `data/categories.json`, except "Other", as suggestions for the service field, and SHALL accept any other service text.
4. THE grade form SHALL NOT ask for an email address, a phone number, or a password.
5. IF a submitted field fails criterion 2, or the website is present but is not an `http` or `https` address with a host name, THEN THE Server SHALL respond with HTTP status 422 and the form again with each problem named next to its field and the visitor's other entries kept.
6. WHEN the website field holds a host name without a scheme, THE Server SHALL treat it as `https://<host>/`.
7. THE grade form SHALL include a hidden honeypot field and a signed form-start time; IF the honeypot is filled or the form was sent less than 3 seconds after the page was served, THEN THE Server SHALL respond with HTTP status 422 and start no Grade.
8. THE grade form SHALL also offer the optional "No_Storefront" checkbox described in Requirement 18.1; the criteria above are otherwise unchanged.

### Requirement 2: Starting and Running a Grade

**User Story:** As a business owner, I want to watch the scan work, so that I trust the result.

#### Acceptance Criteria

1. WHEN a valid grade form is sent, THE Grader SHALL create a Grade with a new Grade_Id, status `running`, the normalized Grade_Input, the creation time, and an empty list of finished Scan_Steps, and THE Server SHALL redirect with HTTP status 303 to `/grade/:id`.
2. THE Grader SHALL start the AI step and the website steps together after the redirect, and SHALL list the steps in this order: `Finding your website` (skipped when no website was given), `Reading your home page`, `Checking what AI is allowed to read`, `Asking AI to name the best <service> in <city>`, `Drafting your free directory listing`.
3. WHILE a Grade's status is `running`, `GET /grade/:id` SHALL show the Scan_Steps, marking each as done, running, or waiting, with one short finding per finished step such as "Found 12 main headlines", and SHALL include a `<meta http-equiv="refresh" content="3">` tag inside `<noscript>` so the page updates with JavaScript turned off.
4. WHERE JavaScript is available, THE scan page SHALL poll `GET /grade/:id/status.json` no more often than once a second and SHALL show the report without a full page reload when the status changes from `running`.
5. WHEN every step has finished, THE Grader SHALL set the Grade status to `done` and store the Check_Results, the AI_Results, the Score, and the finish time.
6. IF a step fails, THEN THE Grader SHALL record that step's Checks as `not_checked` with a plain reason, SHALL continue with the next step, and SHALL still finish the Grade as `done`.
7. IF a Grade has status `running` more than 4 minutes after it was created, including after a server restart, THEN THE Server SHALL treat it as `failed` and SHALL show a page saying the check did not finish, with a button that starts a new Grade with the same Grade_Input.
8. THE Grader SHALL finish each Grade within 150 seconds of its creation, counting at most 30 seconds for the website steps and at most 120 seconds for the AI step; a step still running at its limit SHALL be ended and recorded as `not_checked`.

### Requirement 3: Safe Website Fetching

**User Story:** As the site owner, I want the Grader to visit only public websites, so that nobody can use it to reach our own server or private networks.

#### Acceptance Criteria

1. THE Safe_Fetcher SHALL accept only `http` and `https` addresses on ports 80 and 443 with a host name or a public IP address, and SHALL refuse addresses that carry a user name or password.
2. THE Safe_Fetcher SHALL resolve each host name itself and SHALL refuse to connect when any resolved address is not public: loopback, private (RFC 1918), carrier-grade NAT (100.64.0.0/10), link-local (including 169.254.169.254), unspecified, multicast, broadcast, reserved, documentation ranges, IPv6 unique-local (fc00::/7), IPv6 site-local (fec0::/10), IPv6 link-local (fe80::/10), 6to4 (2002::/16), and IPv4-mapped or IPv4-compatible IPv6 forms of any of these.
3. THE Safe_Fetcher SHALL connect only to the address it checked, so that a second DNS answer cannot redirect the connection to a private address.
4. THE Safe_Fetcher SHALL follow at most 5 redirects and SHALL apply criteria 1 to 3 to every redirect target before following it.
5. THE Safe_Fetcher SHALL stop each fetch after 10 seconds and SHALL stop reading a response after 2 MiB (2,097,152 bytes) of decompressed body, recording the result as too large.
6. THE Safe_Fetcher SHALL decompress `gzip`, `deflate` and `br` responses with `node:zlib` and SHALL count decompressed bytes toward the limit in criterion 5.
7. THE Safe_Fetcher SHALL send a `User-Agent` header naming the site and linking to a page at `/grade/about` that says what the Grader reads and why.
8. THE Safe_Fetcher SHALL never send cookies, credentials, or any header taken from the visitor's request.
9. IF the Safe_Fetcher refuses an address or a fetch fails, THEN THE Website_Checker SHALL record the affected Checks as `not_checked` with a plain reason such as "couldn't reach your website", and SHALL NOT record them as `fail`.
10. FOR ALL IPv4 and IPv6 address strings, the public-address test SHALL agree with the range list in criterion 2, including dotted, compressed, and IPv4-mapped forms (property).

### Requirement 4: Reading the Home Page

**User Story:** As a developer, I want page reading written with built-ins, so that the Grader adds no dependencies and handles messy real pages.

#### Acceptance Criteria

1. WHEN the home page response is HTML, THE Website_Checker SHALL produce Page_Facts: the `<title>` text, the meta description, the `og:title` and `og:image` values, the text of every `<h1>`, the count of `<img>` tags and of those with an empty or missing `alt`, the count of `tel:` links, every `<script type="application/ld+json">` block, whether a viewport meta tag exists, the visible text (with `script`, `style`, `noscript`, `template` and comments removed and HTML entities decoded), and the labels of links and buttons.
2. THE Website_Checker SHALL parse each JSON-LD block with `JSON.parse`, SHALL record a block that fails to parse as `unreadable`, and SHALL collect the `@type` values from the top level and from `@graph`.
3. THE Website_Checker SHALL treat a JSON-LD block as describing the business WHEN one of its types is `LocalBusiness` or a schema.org subtype from a fixed list in the design (for example `Restaurant`, `RoofingContractor`, `HVACBusiness`, `HomeAndConstructionBusiness`, `Plumber`, `Electrician`, `AutoRepair`, `HairSalon`, `LegalService`, `ProfessionalService`, `Store`).
4. THE Website_Checker SHALL record the page as script-built WHEN the visible text is under 200 characters and the page has at least one `<script>` tag, and SHALL then record text-based Checks as `not_checked` with the reason "your page loads its words in a way this check can't read yet".
5. THE Website_Checker SHALL never run scripts from the fetched page.
6. FOR ALL strings given as HTML, reading Page_Facts SHALL finish without throwing and within 200 milliseconds for inputs up to 2 MiB (property).

### Requirement 5: Reading robots.txt and llms.txt

**User Story:** As a business owner, I want to know whether my site turns AI away, so that I can fix it.

#### Acceptance Criteria

1. THE Robots_Reader SHALL group `User-agent` lines with the `Allow` and `Disallow` lines that follow them, and SHALL ignore comments, blank lines and unknown fields.
2. THE Robots_Reader SHALL answer whether an agent may fetch `/` by using the group whose user-agent matches the agent name case-insensitively, else the `*` group, else allow; within a group, the longest matching rule wins and `Allow` wins a tie.
3. IF `/robots.txt` returns status 404 or 410, THEN THE Website_Checker SHALL treat every AI_Agent as allowed; IF it fails to load for another reason, THEN the robots Check SHALL be `not_checked`.
4. THE Website_Checker SHALL record `/llms.txt` as present only WHEN it returns status 200 with a body that is not HTML and is at least 20 characters long.
5. FOR ALL robots.txt texts, the Robots_Reader SHALL return the same answer when lines are separated by `\n` or `\r\n` and when field names change case (property).

### Requirement 6: Website Checks and Points

**User Story:** As a business owner, I want each problem named in plain words with a fix, so that I know what to do.

#### Acceptance Criteria

1. THE Grader SHALL run these Checks, each with the stated group and points: `ai-bots-allowed` (ai_readable, 8: no AI_Agent is blocked from `/`), `business-labeled` (ai_readable, 8: a readable JSON-LD block describes the business and includes its name and telephone), `info-sheet` (ai_readable, 4: llms.txt present), `title-city-service` (search_basics, 7: the title includes the city and a word from the service), `one-headline` (search_basics, 4: exactly one `<h1>`, and it is not empty), `summary` (search_basics, 4: meta description of 50 to 170 characters), `image-descriptions` (search_basics, 3: at least 80% of images have alt text, or the page has no images), `share-picture` (search_basics, 2: `og:image` present), `tap-to-call` (customer_basics, 5: at least one `tel:` link), `hours-shown` (customer_basics, 4: the visible text matches the hours pattern in the design), `address-shown` (customer_basics, 3: the visible text matches the street address pattern in the design), `call-button` (customer_basics, 3: a link or button label matches the call-to-action word list in the design as whole words).
2. WHEN no website was given, THE Grader SHALL record every Check in criterion 1 as `not_checked` with the detail "No website given", and the Free_Part SHALL say that a free listing gives AI something to read about the business.
3. THE Grader SHALL record the `google_profile` Group as `not_checked` with the detail "Google check coming soon" in version one, and the report SHALL NOT show this Group in version one.
4. EACH Check SHALL have a fix sentence of at most 160 characters in plain words, shown with every `fail`.
5. THE Score SHALL count only Checks with result `pass` or `fail`; IF fewer than 40 points are available, THEN THE report SHALL show "Not enough to score yet" instead of a number, and SHALL still show every Check_Result.
6. FOR ALL lists of Check_Results, the Score SHALL be an integer from 0 to 100, SHALL equal 100 when every counted Check passes with full points, and SHALL not change when `not_checked` results are added or removed (property).
7. THE list in criterion 1 is extended and re-pointed by two later requirements: Requirement 19 adds the `reviews-visible` Check and sets the points of the five `customer_basics` Checks (the group still totals 15 and all Checks still total 100), and Requirement 18 changes how `address-shown` is worded and judged when No_Storefront is ticked.

### Requirement 7: AI Answers Check

**User Story:** As a business owner, I want to see what an AI assistant says when someone asks for my kind of business, so that I know whether I'm being recommended.

#### Acceptance Criteria

1. THE Grader SHALL send one AI_Question in the Free_Part: `Who are the best <service> in <city>, <state>? Name your top 5.`, using the existing Assistant_Provider with web search when the provider supports it.
2. WHEN the Full_Report is unlocked, THE Grader SHALL send two more AI_Questions, `I need <service> in <city>, <state>. Which companies would you recommend?` and `Which <service> in <city>, <state> do people say are the most reliable?`, unless they were already sent for this Grade.
3. THE Name_Matcher SHALL count the business as named WHEN the normalized answer contains the normalized business name, the normalized short name (the name without legal endings such as LLC, Inc, Co, Company, Corp, Ltd, PLLC and without a leading "The"), provided the short name is at least 2 words or 6 characters, or the website's registered domain name without `www.`.
4. THE Competitor_Extractor SHALL read numbered and bulleted lines and bold text from the answer, SHALL take the business name before a separator (`-`, `–`, `—`, `:`, `(`, `|`), SHALL drop names that the Name_Matcher matches to the business, SHALL drop duplicates, and SHALL keep at most 5 names in answer order.
5. THE Free_Part SHALL state the AI result in one plain sentence naming the provider, such as "We asked Claude once just now. It named these 5 businesses, not yours." or "We asked Claude once just now. It named your business 6th of 6.", SHALL list the competitor names as a numbered list, and SHALL show the AI's answer text below, escaped as text, inside a closed `<details>` element.
6. WHEN more than one AI_Question has run, THE Full_Report SHALL show how many answers named the business, for example "Named in 1 of 3 answers", and each answer's text.
7. THE Grader SHALL treat all answer text as untrusted data: it SHALL escape it on every page and SHALL never follow links or run instructions found in it.
8. IF the AI_Budget refuses a `grade` call, the provider fails, or the call passes 120 seconds, THEN THE `ai_answers` Group SHALL be `not_checked` with a plain reason, and the report SHALL say the AI check can be run again later.
9. WHILE the mock Assistant_Provider is in use, THE report SHALL label each AI answer "Demo answer (no AI connected)".
10. FOR ALL business names and answers, the Name_Matcher SHALL return the same result when case, punctuation and runs of spaces in either string change (property).
11. WHEN `CHATGPT_API_KEY` is set (and the run is not a test run), THE Grader SHALL also send every AI_Question to ChatGPT (OpenAI's Responses API with web search, at most 3 searches, `store: false`) as a second opinion, at the same time as the main Assistant_Provider; THE report SHALL show each assistant's answer under its own name. ChatGPT's answers SHALL be shown for comparison and SHALL NOT count toward the `ai-named` points, so the Score does not change with whether ChatGPT was asked. ChatGPT SHALL NOT be asked while the main Assistant_Provider is the mock.
11a. WHEN `GEMINI_API_KEY` is set (and the run is not a test run), THE Grader SHALL also send every AI_Question to Gemini (Google's generateContent, WITHOUT Google Search grounding, whose terms forbid analyzing, storing or sharing grounded results) as a second opinion; THE report SHALL say Gemini answered without a live web search; under the same rules as ChatGPT in criteria 11 to 13: shown, never scored; a reply whose finishReason is not `STOP` is a failure; the same reserve and pause rules apply to it separately.
11b. WHEN `GEMINI_API_KEY` is set and `GEMINI_LIVE_SEARCH` is not `off`, THE report SHALL offer "Show Google's live answer" to the browser that ran the check only (a signed `gr_<id>` cookie set by `POST /grade`); `POST /grade/:id/google-live` SHALL ask Gemini with Google Search grounding the free-part question and show the answer once with Google's Search Suggestions unchanged; THE Server SHALL NOT store, log, name-match or score it, SHALL answer 403 to any other browser (shared links, admins), and SHALL count each call against the `grade` AI budget with per-visitor and per-report limits.
11c. WHEN `XAI_API_KEY` or `PERPLEXITY_API_KEY` is set (and the run is not a test run), THE Grader SHALL also send every AI_Question to Grok (xAI's Responses API with web search, `store: false`) and to Perplexity (its Agent API with fast web search) as second opinions, under the same rules as ChatGPT in criteria 11 to 13: shown, never scored; a reply with a status other than `completed` is a failure; inline source markers (Grok's `[[n]](url)` links, Perplexity's `[web:n]` markers) are removed from the answer text; the same reserve and pause rules apply to each separately.
11d. WHEN `GEMINI_API_KEY` is set, `GEMINI_NAME_CHECK` is not `off`, and the run is neither a test run nor the mock, THE Grader SHALL send each AI answer (main and second opinions), the business name (at most 8 words, letters, numbers and simple punctuation only), city and state, and the names the Competitor_Extractor pulled out (leaving out names the Name_Matcher already matched to the business, at most 30), to Google's Gemini Decisions API (`GEMINI_DECISION_MODEL`), asking for each name whether it is a specific business and whether it is the same business as the one checked. A name SHALL be dropped only when Gemini's probability that it is a business is below 0.15, and never when the Name_Matcher matched it. WHEN the Name_Matcher did not find the business, THE Grader SHALL count it as named only when Gemini's same-business probability for a listed name is 0.95 or higher, take its position from that name, and remove it from the competitors; THE report SHALL then say the business was named under a slightly different spelling. A reply that fails, takes over 8 seconds, or cannot be read SHALL leave the Name_Matcher's result unchanged. THE Grader SHALL store the outcome on the answer as `nameCheck` (`dropped`, `addedNamed`) and SHALL never log the answer text or the key. These calls are not counted in `GRADE_AI_CALLS_PER_DAY`.
12. A ChatGPT reply whose status is not `completed` SHALL count as a failure, never as an answer; a ChatGPT failure SHALL never change the main assistant's result.
13. THE Grader SHALL NOT send a ChatGPT question when 12 or fewer `grade` calls remain for the day, so second opinions never use the main assistant's last calls; after 3 ChatGPT failures in a row it SHALL skip ChatGPT for 15 minutes.
14. THE Full_Report SHALL say how many questions each assistant answered and which answers the Score counts, for example "Claude answered 3 questions and ChatGPT answered 3 questions. Your score counts Claude's 3 answers; ChatGPT's are shown so you can compare."

### Requirement 8: AI Answer Points

**User Story:** As a business owner, I want the AI part of my score to reflect how often I'm named, so that one lucky answer doesn't mislead me.

#### Acceptance Criteria

1. THE `ai_answers` Group SHALL hold one Check, `ai-named`, worth 30 points, scored as `round(30 × named answers ÷ answers that ran)`, with `pass` when at least one answer named the business and `fail` otherwise.
2. THE Score SHALL use the partial points from criterion 1 in place of all-or-nothing points for `ai-named`.
3. WHEN the two extra AI_Questions run after unlocking, THE Grader SHALL recompute and store the Score, and the Full_Report SHALL say how many AI answers the score now uses.

### Requirement 9: Report Page

**User Story:** As a business owner, I want one clear page that shows my score, what's wrong, and the fix, so that I can act on it right away.

#### Acceptance Criteria

1. WHEN a Grade's status is `done`, `GET /grade/:id` SHALL show the Free_Part: the business name and city, the Score (or "Not enough to score yet"), the line "<failed> of <counted> checks failed", the AI result sentence, the Free_Page_Preview with a "Claim my free listing" button, the Google before-and-after preview, a one-line summary per Group, the date and time of the check in Central time labeled "Automated check", and a line saying AI assistants pick up changes over days to weeks.
2. THE Free_Part SHALL NOT show any dollar figure or estimate of lost sales.
3. WHILE the Lead_Gate is `on` and the visitor has not unlocked this Grade, THE report SHALL show the Lead_Form in place of the Full_Report.
4. WHEN the Full_Report is shown, THE report SHALL list every Check with its result, detail, points and fix sentence, grouped by Group, and SHALL show the Fix_Kit.
5. THE report page SHALL send `X-Robots-Tag: noindex, nofollow` and a matching robots meta tag, and SHALL send `Referrer-Policy: no-referrer`.
6. THE Server SHALL leave every `/grade` page out of `sitemap.xml`, `llms.txt`, the MCP tools, and IndexNow submissions, with one change made by Requirement 22 (not built until the owner confirms): the start form at `GET /grade` and `GET /grade/about`, with no query string, are open to search engines and listed in `sitemap.xml`. Criterion 5 and the rest of this criterion are unchanged for every other `/grade` page.
7. IF the Grade_Id does not match a stored Grade, THEN THE Server SHALL respond with HTTP status 404.
8. THE report SHALL include an "Ask us to remove this report" line with the site's contact email when `CONTACT_EMAIL` is set, and the contact page otherwise.

9. WHEN a report first shows, THE Score with "<failed> of <counted> checks need work" and the start of the AI result sentence SHALL be visible without scrolling at 1280 by 720; the Free_Page_Preview with the "Claim my free listing" button and the line "Nothing goes live until you do." SHALL follow next, in that order. At 900 pixels and wider, the Free_Page_Preview SHALL sit beside the top three failed Checks.

### Requirement 10: The Instant Free Page

**User Story:** As a business owner, I want to see my free listing already built from what the scan found, so that I can fix the problem in one tap.

#### Acceptance Criteria

1. THE Free_Page_Preview SHALL show the business name, the service, the city and state, and every one of phone, hours, address and website that the scan found, and SHALL show each field it did not find as a blank labeled "Add your <field>" (phone number, hours, address, website).
2. THE Grader SHALL take found fields from a business JSON-LD block first, then from `tel:` links and the visible text, and SHALL normalize phone numbers with the existing phone normalizer.
3. WHEN a visitor sends `POST /grade/:id/claim`, THE Server SHALL create one Draft through the existing Draft_Store with the found fields, the category from the existing category mapper (falling back to `other`), the service as the first entry in `services`, and every missing required field listed in `missingFields`, SHALL store the Draft id on the Grade, and SHALL redirect with HTTP status 303 to `/rise/drafts/:draftId`.
4. IF the Grade already has a Draft and the same browser claimed it (shown by a signed cookie), THEN `POST /grade/:id/claim` SHALL redirect to that Draft and SHALL NOT create a second one; any other visitor SHALL get a new Draft, so one visitor never sees another's draft.
5. THE claim SHALL publish nothing by itself: the existing confirmation and admin approval steps SHALL apply unchanged.
6. THE claim button SHALL work with JavaScript turned off.
7. Requirement 18.4 and 18.6 change the address line of the Free_Page_Preview and the claimed Draft when No_Storefront is ticked, and Requirement 20.4 adds the Reviews_Link to the claimed Draft; with neither in play, criteria 1 to 6 are unchanged.

### Requirement 11: Fix Kit

**User Story:** As a business owner, I want ready-to-paste fixes with my details filled in, so that my web person or First Answer can apply them in minutes.

#### Acceptance Criteria

1. THE Fix_Kit SHALL include a suggested page title `<name> | <service> in <city>, <ST>` shortened to at most 60 characters by dropping `, <ST>` first and then trimming the service, never cutting a word in half.
2. THE Fix_Kit SHALL include a suggested Google summary of at most 160 characters, using only typed or found facts, built from the name, service, city, and the phone when found.
3. THE Fix_Kit SHALL include a JSON-LD `<script>` block of type `LocalBusiness` with every found field, which SHALL parse with `JSON.parse` after the script tags are removed and SHALL escape `<` as `\u003c` inside the JSON.
4. THE Fix_Kit SHALL include an llms.txt draft with the name, service, city and state, phone, website, and found hours.
5. WHEN the `ai-bots-allowed` Check fails, THE Fix_Kit SHALL include robots.txt lines that allow each blocked AI_Agent.
6. THE Fix_Kit SHALL show each item in a `<pre>` block with a copy button that works when JavaScript is available.
7. THE Fix_Kit SHALL end with one plain line offering to have First Answer apply the fixes, linking to the site's contact details.
8. FOR ALL Grade_Inputs and found fields, the suggested title SHALL be at most 60 characters, and the JSON-LD block SHALL parse and contain no unescaped `<` (property).
9. Requirement 18.5 changes the business label for a No_Storefront Grade, and Requirement 19.6 says the Fix_Kit never adds review data to it; with No_Storefront not ticked, criteria 1 to 8 are unchanged.

### Requirement 12: Lead Form and Lead Gate

**User Story:** As the site owner, I want each full report to bring in a lead, so that the Grader grows the business; and as a contest judge, I want to see everything without a form.

#### Acceptance Criteria

1. THE Lead_Form SHALL ask for name, email and phone, and SHALL include a separate, unchecked checkbox reading "OK for <SITE_NAME> to call, text or email me about my report", which is not required to unlock.
2. WHEN a valid Lead_Form is sent to `POST /grade/:id/unlock`, THE Server SHALL store a Lead with the Grade_Id, the business name, the visitor's name, email, phone, the checkbox value and the time, SHALL mark this Grade unlocked for this visitor with a signed, HTTP-only cookie scoped to `/grade/:id`, SHALL start the two extra AI_Questions, and SHALL redirect with HTTP status 303 to the report.
3. WHEN a Lead is stored, THE Server SHALL tell the site owner through a new Notifier method, `notifyLead`, sent to the admin email only, with the business name, the Score, the report link, and the visitor's name, phone and email, and SHALL never include the email or phone in logs.
4. WHILE `GRADER_LEAD_GATE` is `off`, THE report SHALL show the Full_Report to every visitor and SHALL start the extra AI_Questions on the first report view, subject to the AI_Budget.
5. IF the Lead_Form fails validation, THEN THE Server SHALL respond with HTTP status 422 and the form again with the problems named.
6. THE Server SHALL show the Full_Report of a Grade only to a visitor who unlocked that Grade, or to anyone while the Lead_Gate is `off`.

### Requirement 13: Check Again

**User Story:** As a business owner, I want to re-run the website checks after I fix things, so that I can watch the score go up.

#### Acceptance Criteria

1. THE Full_Report SHALL offer a "Check again" button that sends `POST /grade/:id/recheck`.
2. WHEN a Recheck runs, THE Grader SHALL re-run the website Checks only, SHALL keep the stored AI_Results, SHALL recompute the Score, and SHALL show the previous and new Score side by side.
3. THE Server SHALL allow at most one Recheck per Grade every 2 minutes and at most 10 Rechecks per client per hour, and SHALL answer more with HTTP status 429 and a `Retry-After` header.

### Requirement 14: Limits, Cost, and Reuse

**User Story:** As the site owner, I want the Grader's AI spending capped and repeated grades reused, so that a bot or a busy day can't run up the bill.

#### Acceptance Criteria

1. THE AI_Budget SHALL count Grader calls under a new kind, `grade`, limited by `GRADE_AI_CALLS_PER_DAY` (default 60), and SHALL keep photo and grade calls together at or below the total minus a quarter, so the Seance's reserved quarter is unchanged.
2. THE Rate_Limiter SHALL allow at most 5 new Grades per client per hour and 20 per client per day, and SHALL answer more with HTTP status 429 and a `Retry-After` header.
3. WHEN a new Grade has the same normalized name, city, state, service and website as a `done` Grade created in the last 7 days whose AI_Results exist, THE Grader SHALL copy those AI_Results into the new Grade, label them with their original time, and send no new AI_Question to an assistant that already has a copied answer to that question; an assistant switched on since (such as ChatGPT) SHALL still be asked.
4. THE copy in criterion 3 SHALL NOT copy the earlier Grade's unlock state, Lead, or Draft.
5. THE Server SHALL delete Grades and their Leads 90 days after creation, pruning at startup and whenever a new Grade starts.
6. THE Grader SHALL never log Grade_Input values, answer text, or Lead fields; logs SHALL hold only the Grade_Id, the step names, the result counts and the timings.

### Requirement 15: Admin

**User Story:** As the site owner, I want to see grades and leads and remove a report when a business asks, so that I can follow up and honor removal requests.

#### Acceptance Criteria

1. WHEN a logged-in admin sends `GET /admin/grades`, THE Server SHALL list the newest 100 Grades with business name, city, Score, status, whether a Lead exists, whether a Draft was claimed, and the time.
2. WHEN a logged-in admin sends `GET /admin/leads`, THE Server SHALL list the newest 100 Leads with the business name, the visitor's name, email, phone, the contact checkbox, the Score and a link to the report.
3. WHEN a logged-in admin removes a Grade, THE Server SHALL delete the Grade and its Leads, and later requests for that Grade_Id SHALL get HTTP status 404.
4. THE admin pages SHALL use the existing admin login and SHALL be refused with the existing response when the visitor is not logged in.

### Requirement 16: About Page and Plain Wording

**User Story:** As a business whose website was checked, I want to know who checked it and why, so that the visit isn't a mystery.

#### Acceptance Criteria

1. WHEN a client sends `GET /grade/about`, THE Server SHALL respond with a plain page saying what the Grader reads (the home page, robots.txt and llms.txt), that it reads each page at most once per check, that it does not run scripts or log in, and how to ask for a report's removal.
2. EVERY Grader page SHALL use the site layout, plain words and American spelling, SHALL NOT contain the words "Yellow Pages" or "YP", and SHALL NOT show any dollar figure.

### Requirement 17: Test Coverage

**User Story:** As a developer, I want the Grader tested without the network, so that the suite stays fast and reliable.

#### Acceptance Criteria

1. THE tests SHALL inject the fetch transport, the DNS lookup, the clock, the Assistant_Provider and the Notifier, and SHALL make no network calls.
2. THE tests SHALL include fast-check properties for the public-address test (Requirement 3.10), Page_Facts reading (Requirement 4.6), the Robots_Reader (Requirement 5.5), the Score (Requirement 6.6), the Name_Matcher (Requirement 7.10), and the Fix_Kit (Requirement 11.8).
3. THE tests SHALL include example tests built from saved copies of three real home pages of different shapes (a restaurant with a slider of headlines, a roofer with broken JSON-LD, a large company with several JSON-LD blocks), stored as fixtures with personal details replaced.
4. THE full suite SHALL pass with `node --test`, including every test that existed before this spec.

### Requirement 18: Businesses With No Storefront

**User Story:** As the owner of a business that goes to its customers (a cleaner, a roofer, a mobile service), I want the check to look for my service area instead of a street address, so that I am not told to publish an address I don't show.

#### Acceptance Criteria

1. THE grade form SHALL offer one more optional checkbox, unchecked by default, labeled "We go to our customers (no storefront)", that works with JavaScript turned off. WHEN it is ticked, THE Grader SHALL store `noStorefront: true` on the Grade_Input; WHEN it is not ticked, THE Grader SHALL store nothing for it, so Grades made without it look exactly as they do today. Any other value sent for the field SHALL count as not ticked.
2. WHILE No_Storefront is ticked, THE `address-shown` Check SHALL be shown as "Service area on your home page" and SHALL pass WHEN the home page has Service_Area_Text. It keeps the same id, group (`customer_basics`) and points as the address Check. Plain sentences that only mention serving something ("We serve breakfast all day") SHALL NOT pass: after "serving" or "we serve" the city name or an area word (area, areas, county, counties, surrounding, nearby, communities) must appear within 80 characters.
3. WHILE No_Storefront is ticked, THE Check's pass text, fail text and fix SHALL talk only about the service area ("We found no service area on your home page." and a fix that tells the owner to add a line such as "Serving Nashville and nearby areas", using the Grade's own city, escaped, or "your city" when the city is empty), SHALL NEVER say an address is missing, and SHALL keep the fix at 160 characters or fewer; WHEN the example would make it longer, THE fix SHALL drop the example rather than cut words. A street address on the page SHALL NOT make the Check fail or pass.
4. WHILE No_Storefront is ticked, THE Free_Page_Preview SHALL show the line "Serves the <city> area" in place of the address line (and SHALL NOT show "Add your address", even when the scan found a street address on the page).
5. WHILE No_Storefront is ticked, THE Fix_Kit's business label (JSON-LD) SHALL set `areaServed` to the city and state (for example "Tallahassee, FL") and SHALL leave out `address` and `streetAddress`.
6. WHEN a visitor claims a Grade with No_Storefront ticked, THE Draft SHALL have an empty `address` and a `serviceArea` of "<city> and nearby areas" (for example "Tallahassee and nearby areas"), and THE Draft SHALL NOT list `address` or `serviceArea` in `missingFields`. THE existing listing page, listing page business label and Draft review page SHALL read well with no address: they already treat the address as optional and show the city and the service area.
7. THE Check, the preview and the claim SHALL read `noStorefront` from the stored Grade, so a Recheck, a reused answer, a Grade opened later and a "Start again" all keep the same mode.
8. WHILE No_Storefront is not ticked, THE Check results, texts, points, preview, Fix_Kit and claimed Draft SHALL be exactly what Requirements 6, 10 and 11 describe.
9. THE wording of every changed line SHALL follow the plain-wording rules of Requirement 16.2, including the checkbox hint: "Check this box if you go to your customers and don't show a street address."
10. THE service-area test SHALL be built from the Grade's city with every special character escaped and SHALL be matched against the page text and the city normalized the same way (so "St. Louis" matches). IT SHALL never throw and SHALL never pass a page without service-area words, for any city, including "A++", "Nash|ville", "St. Louis" and an empty city.

### Requirement 19: Reviews AI Can See

**User Story:** As a business owner whose good reviews live only inside Google, I want to know whether AI assistants can see reviews on my website, and how to fix it, so that I can show them what customers say.

#### Acceptance Criteria

1. THE Grader SHALL run one more website Check, `reviews-visible`, in the `customer_basics` Group, labeled "Reviews AI can see". It SHALL pass WHEN the home page has at least one Review_Signal:
   - review or testimonial text: the whole word "reviews" or "testimonials" inside a heading (h1 to h3) or a section title, or a heading such as "What our customers say"; the same words inside a link or a menu SHALL NOT count; or a quoted customer comment followed by a customer's name;
   - a rating written out: "5.0 stars", "4.9 out of 5", a rating with a decimal before "/5" ("4.8/5", "5.0/5"), or three or more star symbols in a row ("Closed 1/5" and "Open 9/5" do not count);
   - a link on the page to the business's reviews on a Review_Site: Google at google.com/maps, maps.google.com, g.page, maps.app.goo.gl, g.co/kgs, search.google.com/local (but never `search.google.com/local/writereview`, which opens a form) or a google.com/search address whose `#` part holds `lrd=` or whose query holds `ludocid=`; Yelp at yelp.com/biz; Facebook only when the link's path contains `/reviews`; Nextdoor only when the link's path starts with `/pages/`. A footer link to a business's Facebook or Nextdoor page SHALL NOT count;
   - review data in the page's business label: an `aggregateRating` or a `review` value.
2. WHEN the page has no Review_Signal, THE Check SHALL fail with the detail "We found no customer reviews on your home page. AI assistants often can't see reviews that are only inside Google." THE pass detail SHALL be "Your home page shows customer reviews that AI can read."
3. THE five `customer_basics` Checks SHALL have these points: `tap-to-call` 4, `hours-shown` 3, `address-shown` 3, `call-button` 2, `reviews-visible` 3. THE group SHALL still total 15, the Checks SHALL still total 100 points, and the points available for a Grade with a readable website SHALL be unchanged.
4. THE `reviews-visible` fix SHALL read: "Put 3 or more of your real customer reviews on your home page, with each customer's first name and the date, and add a link to your Google reviews." THE fix SHALL NOT suggest writing a review, editing a review, or copying a review from anywhere without its source.
5. WHEN no website was given, THE Check SHALL be `not_checked` with the detail "No website given"; WHEN the home page could not be read, or is script-built (Requirement 4.4), THE Check SHALL be `not_checked` with the same plain reasons as the other text-based Checks. A Grade stored before this Check existed SHALL still open and SHALL simply not count the Check; it gains the result on its next Recheck. Requirement 19.8 says how its Score is shown.
6. THE Grader SHALL never invent, copy or edit a review: THE Fix_Kit SHALL NOT add `aggregateRating` or `review` to its business label, and no page SHALL show a made-up rating or review count.
7. THE wording SHALL NOT say or imply that showing reviews will make an AI assistant name the business; the report keeps its line that AI assistants pick up changes over days to weeks.
8. THE report's Score, its "Score by area" lines and its Check rows SHALL always be worked out from the Grade's stored results with the current points, so one Grade never shows two different scores. A Grade stored without a `reviews-visible` result counts only the Checks it has (so an old restaurant Grade shows 40 in the headline, the area lines and the rows alike). This holds before and after the extra AI questions run.
9. THE line "Your score was <before> before. It is <now> now." SHALL be shown only when both the earlier and the new results include `reviews-visible`, so the report never compares scores across the change in points. A Recheck of an older Grade SHALL show no "before" line.
10. THE patterns that read the page for criterion 1 SHALL use bounded windows (for example up to 80 characters) rather than open-ended matching, and SHALL read a 1 MB page within 200 milliseconds.

### Requirement 20: Reviews Link on the Free Listing

**User Story:** As a business owner, I want a link to my reviews on my free listing, so that a person or an AI assistant reading the listing can follow it to the reviews.

#### Acceptance Criteria

1. THE listing model SHALL gain one optional field, `reviewsLink`. A listing, Draft or form without it SHALL behave exactly as today, and the field SHALL appear in validated fields only when it holds a valid link.
2. THE field SHALL be valid only WHEN it is an `https` address of at most 300 characters, with no user name or password and no port, whose host is on this list (a leading `www.` or `m.` is ignored): `google.com` with a path starting `/maps`, or with the path `/search` when the `#` part contains `lrd=` or the query contains `ludocid=`; `maps.google.com` (any path); `g.co` with a path starting `/kgs/`; `g.page`; `maps.app.goo.gl`; `search.google.com` with a path starting `/local`; `yelp.com` with a path starting `/biz`; `facebook.com` (any page, since the owner chooses it); and `nextdoor.com` (any page). THE validator SHALL keep the query string and the `#` part of a reviews link (Google needs them), SHALL leave out any other value (an `http` link, another site, a bare word, a script address, `https://www.google.com/search?q=plumbers`), and the review form SHALL tell the owner that the link was left out.
3. THE listing page SHALL show a "Reviews" row with a link reading "See our reviews on Google" (or "on Yelp", "on Facebook", "on Nextdoor", from the host), escaped, with `rel="noopener noreferrer"`. THE listing page SHALL show only the link: no star rating, no review count, and no review text. WHEN the field is empty, THE row SHALL not appear.
4. WHEN a visitor claims a Grade, THE Draft SHALL fill `reviewsLink` from the home page links that count under Requirement 19.1 and also pass criterion 2, preferring a Google link, then Yelp, then Facebook or Nextdoor, and SHALL leave it empty WHEN there is none. A Google "write a review" form (`search.google.com/local/writereview`) and a plain Facebook or Nextdoor business page link SHALL never be filled in. THE Draft SHALL NEVER take a link from an AI answer.
5. THE Draft review page and the admin Draft page SHALL show the field, and the owner SHALL be able to change or clear it before sending the Draft for approval; nothing changes about the confirmation and admin approval steps.
6. WHEN a listing has a Reviews_Link, `llms.txt` and the MCP listing summary SHALL include it as a link labeled "Reviews", and the listing's business label (JSON-LD) SHALL add it under `sameAs` (next to the Website_Link of Requirement 21, when there is one). THE JSON API and the MCP `get_listing` tool already return every public listing field, so they show it without a change. A line SHALL be added only when the field has a value, so listings without it produce exactly the output they produce today. No page, file or tool SHALL ever show a star rating, a review count or review text for a listing.
7. WHEN a Draft is approved and published, THE published listing SHALL keep `reviewsLink` (and `website`, Requirement 21) when it has a value, and SHALL gain no key when it does not.

### Requirement 21: The Business's Own Website on the Free Listing

**User Story:** As a business owner, I want my free listing to link to my own website, so that search engines and AI assistants that read the listing can connect it to my real site.

#### Acceptance Criteria

1. THE listing model SHALL gain one more optional field, `website`. A listing, Draft or form without it SHALL behave exactly as today, and the field SHALL appear in validated fields only when it holds a valid link. It SHALL never be in `missingFields`.
2. THE field SHALL be valid only WHEN it is a public `https` address: it SHALL be refused when the host is an IP address (IPv4 or IPv6), `localhost` or a name ending in `.localhost`, or has no dot; when it carries a user name or password; or when it names a port. A valid value SHALL be kept as scheme, host and path only: THE query string and the `#` part SHALL be dropped, so no login or tracking parameters are kept. It SHALL be at most 300 characters after that, and any other value SHALL be left out (the review form tells the owner the link was left out). THE check SHALL not look anything up on the network.
3. THE listing page SHALL show a plain "Website" row with a link to the site (its host as the link text), escaped, with `rel="noopener noreferrer"`. WHEN the field is empty, THE row SHALL not appear.
4. THE listing's business label (JSON-LD) SHALL add the website under `sameAs`; the label's `url` SHALL stay the listing page's own address.
5. THE owner's draft form (`/rise`), the Draft review page and the admin Draft page SHALL show and edit the field like the other optional fields.
6. WHEN a visitor claims a Grade, THE Draft SHALL fill `website` from the website the owner typed on the check (`grade.input.website`), run through the same validation, and SHALL leave it empty when that value is not valid or was not given.
7. `llms.txt` and the MCP listing summary SHALL include the website, as a link labeled "Website", for listings that have one. THE JSON API and the MCP `get_listing` tool already return every public listing field, so they show it without a change. A line SHALL be added only when the field has a value, so listings without it produce exactly the output they produce today.
8. WHEN a Draft is approved and published, THE published listing SHALL keep `website` when it has a value (see Requirement 20.7).

### Requirement 22: Let Google and Bing Find the Main Pages

**Status: specified, not to be built until the owner confirms.**

**User Story:** As the site owner, I want Google and Bing to find our main public pages and the check's start page, so that more people can reach the site.

#### Acceptance Criteria

1. THE `sitemap.xml` SHALL also list `/about`, `/verified`, `/privacy` and `/rise`, each only WHEN it returns HTTP status 200 and is not marked noindex (a page is skipped when `DEMO_MODE` marks every page noindex). Listings, category pages and the home page SHALL be listed exactly as today.
2. THE start form at `GET /grade` and `GET /grade/about`, each requested without a query string, SHALL be open to search engines: they SHALL send no `X-Robots-Tag: noindex` header and carry no robots meta tag, SHALL have a plain title and a short summary (meta description) for search results and a canonical address, and SHALL be listed in `sitemap.xml`. They keep `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
3. EVERY other `/grade` response SHALL stay exactly as it is today, with `X-Robots-Tag: noindex, nofollow` (and the matching meta tag on pages), `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and SHALL stay out of `sitemap.xml`, `llms.txt`, the MCP tools and IndexNow: every report (`/grade/:id`), the status JSON, the claim flow, every error page, the form when it is shown again with errors (status 422), a `/grade` request with a query string, and every `/grade` path when `GRADER_ENABLED` is `off`.
4. NO rate limit and NO AI budget SHALL change.
5. THE about page SHALL still say what the Grader reads and why (Requirement 16.1) and SHALL still contain no dollar figure and no banned word.
