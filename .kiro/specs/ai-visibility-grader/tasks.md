# Implementation Plan: AI Visibility Grader

## Overview

Plain JavaScript ES modules on Node 22 and plain Express, on top of the finished `super-pages` build. The plan builds the pure pieces first (address guard, safe fetcher, page reading, robots reading, checks, score, name matching, fix kit), then the grader flow and storage, then the pages and routes, then the lead gate, claim, recheck and admin, and ends with fixtures, the README and a full-suite checkpoint.

Property tests for the address guard, the score, name matching and the fix kit are required; the other property tests are optional sub-tasks marked `*`.

Contest cut, in build order: (A) tasks 0 to 8 plus 9.2 and 10.1 give the full demo path; (B) 9.1 with one AI question, 9.3, 9.4, 10.2 and 10.3; (C) leave for last: the two extra AI questions, reuse of earlier AI results, the llms.txt draft and robots lines in the fix kit, and brotli. Every test uses `node:test` and `fast-check`, lives in `test/`, uses a temporary `DATA_DIR`, injects fakes for the network, DNS, clock, AI provider and notifier, and makes no network calls. Checkpoints run `node --test`.


## Rebuild in Kiro (Nov 18, 2026)

This feature was first built outside Kiro. It is being rebuilt here, task by task, from this spec. The grader's source files were removed on branch `kiro-rebuild-grader`, and the existing tests in `test/grade-*.test.js`, `test/providers.test.js` and the rest of the suite are the acceptance bar: every one must pass again. Requirements added after this plan was written (11c, 11d and any others without a task) get new tasks at the end before the rebuild is called done.

## Tasks

- [x] 0. Before starting
  - [x] 0.1 Confirm every task in `.kiro/specs/super-pages/tasks.md` is done or deliberately skipped, and `node --test` passes
  - [x] 0.2 Update steering: bring `structure.md` and `tech.md` in line with the code as built (the `server/lib` folder, MCP built, web writes allowed for the listed collections); add `steering/wording.md` (always on: American spelling, plain words, no "Yellow Pages" or "YP", no dollar figures, never promise AI will name a business, say "days to weeks") and `steering/grader-safety.md` (for the fetch and grader files: never loosen the address guard, never log typed input, AI answers or lead details, always escape AI text)
  - [x] 0.3 Add two hooks in `.kiro/hooks/`: on save of a grade file, run `node --test test/grade-*.test.js`; on save of `grade-html.js` or `fix-kit.js`, check for British spellings, "YP" as a word, a dollar sign followed by digits, and the word "guarantee"

Every task also follows the design's "Implementation notes from the code review" section.

- [x] 1. Safe fetching
  - [x] 1.1 Create `server/lib/ip-guard.js`
    - Export `isPublicAddress(ip)` using `net.isIP`, a 32-bit IPv4 parser and an eight-group IPv6 expander that handles `::` and a dotted IPv4 tail
    - Follow the design's IPv6 rule (public only inside `2000::/3` minus the listed blocks) and refuse every IPv4 range listed in the design, judging IPv4-mapped, IPv4-compatible and NAT64 IPv6 forms by their embedded IPv4
    - Return false for anything `net.isIP` rejects
    - _Requirements: 3.2_
  - [x] 1.2 Write property tests for the address guard
    - **Property 1: Public-address test matches the range table**
    - Build an independent bit-mask oracle in the test from the same range table
    - **Validates: Requirements 3.2, 3.10**
  - [x] 1.3 Create `server/lib/safe-fetch.js`
    - Export `createSafeFetcher({ request, lookup, timeoutMs, maxBytes, maxRedirects, userAgent })` and `SafeFetchError` with codes `bad_url`, `blocked_address`, `timeout`, `too_large`, `too_many_redirects`, `connect_failed`
    - URL checks: `http`/`https` only, ports 80 and 443 only, no user name or password; IP literal hosts must pass `isPublicAddress`
    - Strip brackets from `url.hostname` before the IP check; resolve and check in `fetchText`, then call `node:http`/`node:https` `request()` with `agent: false` and a `pinnedLookup` that answers with the checked list when `opts.all` is set and a single address otherwise
    - Example tests for `http://[::1]/`, `http://[::ffff:7f00:1]/`, `http://2130706433/` and `http://0x7f.1/`
    - Send only `User-Agent`, `Accept` and `Accept-Encoding`; never forward visitor headers or cookies
    - Follow up to 5 redirects by hand, checking each target from the top
    - Decompress gzip, deflate and br with `node:zlib`; stop past 2 MiB decompressed; one 10-second timer per fetch
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [ ]* 1.4 Write property and example tests for the safe fetcher
    - **Property 2: Redirects never reach a refused address**
    - **Property 3: Size limit holds after decompression**
    - Examples: refused ports, credentials in URL, DNS answer mixing public and private addresses, timeout, a guard that fails the test if the real `http.request` is called
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.6, 3.8**

- [x] 2. Reading pages and robots.txt
  - [x] 2.1 Create `server/lib/page-facts.js`
    - Export `readPageFacts(html)` following the design's ten steps: comments out, JSON-LD collected first, script/style/noscript/template/svg removed, title, meta tags, h1s, images and alt counts, tel links, call-to-action labels, visible text with entities decoded
    - Parse each JSON-LD block in a try; collect `@type` from the top, arrays and `@graph`; read name, telephone, address, hours and url from the first business-typed node (type list in the design); mark failed blocks `unreadable`
    - Set `scriptBuilt` when visible text is under 200 characters and the page has a script tag
    - Remove elements and comments by `indexOf` scanning, never lazy regular expressions; never run page scripts
    - Export the hours, street-address and call-to-action patterns for the checks
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 2.2 Write property tests for page reading
    - **Property 4: Page reading never throws and stays fast** (random inputs up to 64 KiB, plus fixed 2 MiB worst cases: unclosed `<script`, `<!--` and `<a`)
    - **Validates: Requirements 4.1, 4.6**
  - [x] 2.3 Create `server/lib/robots.js`
    - Export `parseRobots(text)` and `mayFetchRoot(groups, agent)` as designed: grouped user agents, comments and unknown fields ignored, specific group before `*`, longest rule wins, `Allow` wins a tie, empty `Disallow` allows
    - Export `AI_AGENTS` with the eight crawler names from the glossary
    - _Requirements: 5.1, 5.2_
  - [ ]* 2.4 Write property tests for robots reading
    - **Property 5: Robots answers are stable under formatting**
    - **Validates: Requirements 5.1, 5.2, 5.5**

- [x] 3. Checks, score, names and fix kit
  - [x] 3.1 Create `server/lib/grade-checks.js`
    - Export `CHECKS` (ids, groups, points, label, pass and fail details, fix sentences of at most 160 characters) exactly as the design's table
    - Export `runWebsiteChecks({ facts, robots, llms, input })` returning one Check_Result per website Check; `not_checked` with a plain reason when the site was unreachable, refused, too large or script-built (title check excepted for script-built), and "No website given" when there is no website
    - robots.txt: 404 or 410 means all allowed; other failures mean `not_checked`; llms.txt present only for status 200, non-HTML, at least 20 characters
    - Always add `google-profile` as `not_checked` with "Google check coming soon"
    - _Requirements: 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - [x] 3.2 Create `server/lib/grade-score.js`
    - Export `scoreGrade(results)` returning `{ score, earned, available, failed, counted, byGroup }`; `ai-named` uses its `earned` value; `score` is null under 40 available points
    - _Requirements: 6.5, 8.1, 8.2_
  - [x] 3.3 Write property tests for the score
    - **Property 6: Score bounds and invariance**
    - **Validates: Requirements 6.5, 6.6, 8.2**
  - [x] 3.4 Create `server/lib/name-match.js`
    - Export `shortName`, `registeredDomain`, `isNamed(answer, { name, website })` and `extractCompetitors(answer, business)` as designed, reusing `normalizeForMatch` from `seance.js`
    - _Requirements: 7.3, 7.4_
  - [x] 3.5 Write property tests for name matching and competitor extraction
    - **Property 7: Name matching ignores case, punctuation and spacing**
    - **Property 8: Competitors exclude the business and repeat no one**
    - Examples: "Acme Roofing Company" matches an answer saying "Acme Roofing"; a numbered list of five roofers yields five names
    - **Validates: Requirements 7.3, 7.4, 7.10**
  - [x] 3.6 Create `server/lib/fix-kit.js`
    - Export `suggestedTitle`, `suggestedSummary`, `jsonLdBlock`, `llmsDraft` and `robotsLines` as designed
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [x] 3.7 Write property tests for the fix kit
    - **Property 9: Fix kit stays within its limits**
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.8**

- [x] 4. Checkpoint: pure pieces
  - Run `node --test`; every earlier test and every new test passes. Ask the user if questions arise.
  - Rebuild note: after task 3 the cloud ran the grade unit tests and all 66 passed; the full suite waits on the files still being rebuilt.

- [x] 5. Storage, budget and configuration
  - [x] 5.1 Add `grades` and `leads` to the data store's `COLLECTIONS` allow-list, and add `grades.json` and `leads.json` to `ALLOWED_FILES` in `test/data-dir.test.js`
    - _Requirements: 14.5_
  - [x] 5.2 Extend `pruneExpired` with `grades` and `leads` options that drop records older than 90 days and keep records with a missing or invalid `createdAt`; run it at startup with the existing retention call
    - _Requirements: 14.5_
  - [x] 5.3 Extend `server/lib/ai-budget.js` with the `grade` kind
    - Daily `grade` count persisted beside `photo`; files without it load as 0
    - Blocked when the total cap is reached, when `grade >= gradeCap`, or when `photo + grade >= cap - ceil(cap / 4)`
    - Existing photo and Seance behavior unchanged
    - _Requirements: 14.1_
  - [ ]* 5.4 Write example tests for the budget change
    - The Seance quarter stays available after photo and grade calls use their share; old budget files load
    - **Validates: Requirement 14.1**
  - [x] 5.5 Extend `server/lib/config.js` with `graderEnabled`, `graderLeadGate`, `gradeAiCallsPerDay` and `graderSecret`, with the defaults in the design; warn once when `GRADER_SECRET` is missing in production and use a random per-process key
    - Add `GRADER_SECRET` (`generateValue: true`), `GRADER_LEAD_GATE` and `GRADE_AI_CALLS_PER_DAY` to `render.yaml`
    - Add README rows for the four new settings in this task, so the existing test that checks every setting is documented keeps passing
    - Add `grade` (5 per hour), `grade-day` (6 per day; each check can use 3 AI calls and the whole site shares 60 a day, so review lowered it from 20), `grade-unlock` (5 per hour) and `grade-recheck` (10 per hour) to the rate limiter's `RULES`
    - _Requirements: 12.4, 13.3, 14.1, 14.2_

  - [x] 5.6 Add `roofers` ("Roofers") and `hvac` ("Heating and Air") to `data/categories.json`, with Seance phrases, and teach `mapCategory` common service words (roofing, roofer, hvac, heating, air conditioning) so a graded roofer's draft is not filed under Other
    - _Requirements: 10.3_

## Rebuild extras

The rebuild also removed `server/lib/assistant.js`, `server/lib/name-check.js` and `server/lib/grade-stamp.js`. No task above covers them, but `server/app.js`, the grader and the existing tests import them. Build them before task 6 so the grader, routes and tests have what they import. Read every test named in a task before writing the file, so exports, names and messages match exactly. Do not write this code until the task is started.

- [x] R1. Create `server/lib/assistant.js`
  - Tests that import it: `test/providers.test.js`, `test/seance.test.js`, `test/seance-sources.test.js`, `test/seance-production.test.js`, `test/polish.test.js`; `server/app.js` imports `createAssistantProvider`, `createExtraAssistants` and `createGeminiLive`
  - Exports: `AssistantError`, `createMockAssistantProvider`, `createAssistantProvider`, `createChatGptAssistantProvider`, `createGeminiAssistantProvider`, `createGrokAssistantProvider`, `createPerplexityAssistantProvider`, `createGeminiLiveSearch`, `createGeminiLive`, `createExtraAssistants`, `collectSources`
  - Providers expose `ask({ prompt, category, businessName })` and resolve to `{ answer, provider, model, webSearch }`
  - [x] R1.1 Mock and main provider
    - `createMockAssistantProvider()` is a pure function of its input: SHA-256 of the prompt picks a canned answer for the listing's category plus neutral fallbacks, about 1 in 3 answers name the business, model `'mock'`, `webSearch: false`; unknown categories and prototype keys fall back safely
    - `createAssistantProvider(config)`: mock in test runs or without a key; `openai` (no web search) and `anthropic` adapters with built-in `fetch`, key only in a header, `AbortSignal.timeout`, model from `SEANCE_MODEL`; the anthropic request carries the `web_search` tool with `max_uses: 3`, sets `max_tokens` to at least 1024, sends no beta header, joins all `text` blocks, resends once on `pause_turn`, and returns `collectSources` results where the tests expect them
    - A failed or refused call throws `AssistantError` and logs a safe error label only; never the message, the answer or the key
  - [x] R1.2 Second opinions (requirements 11 to 13, 11a and 11c)
    - ChatGPT (Responses API, web search capped at 3, `store: false`), Gemini (generateContent without Google Search grounding; a `finishReason` other than `STOP` is a failure), Grok (xAI Responses API with web search; status other than `completed` is a failure; `[[n]](url)` markers removed) and Perplexity (Agent API with fast web search; `[web:n]` markers removed)
    - Keys only in headers; a status other than the success status never becomes an answer; `createExtraAssistants(config)` returns only the ones with keys, and none in test runs
    - _Requirements: 11, 11a, 11c, 12_
  - [x] R1.3 Google's live answer (requirement 11b)
    - `createGeminiLiveSearch` asks Gemini with Google Search grounding and keeps the Search Suggestions unchanged; `createGeminiLive(config)` returns `null` when `GEMINI_API_KEY` is unset or `GEMINI_LIVE_SEARCH` is `off`
    - Nothing it returns is stored, logged, name-matched or scored
    - _Requirements: 11b_
  - [x] R1.4 Run `test/providers.test.js`, `test/seance*.test.js` and `test/polish.test.js` in the cloud and fix what they report
    - Cloud run: Kiro's `assistant.js` in the original code passed 207 of 207 in those files and the full suite 1014 of 1014.

- [x] R2. Create `server/lib/name-check.js`
  - Tests that import it: `test/providers.test.js` (describe "name check: Gemini Decisions request and reply"); `server/app.js` imports `createNameCheck`
  - Exports: `createNameChecker` and `createNameCheck(config)`; `createNameCheck` returns `null` unless `GEMINI_API_KEY` is set and `GEMINI_NAME_CHECK` is not `off`, and never runs in a test run or with the mock
  - Send each AI answer, the business name (at most 8 words, letters, numbers and simple punctuation only), city, state and up to 30 extracted names (leaving out names the Name_Matcher already matched) to Gemini Decisions (`GEMINI_DECISION_MODEL`), two yes/no questions per name (`n<i>` is a specific business, `s<i>` is the same business); key only in a header; read the probabilities
  - Drop a name only below 0.15 and never when the Name_Matcher matched it; count the business as named only at 0.95 or higher when the Name_Matcher missed it, with its position taken from that name; any failure, a reply over 8 seconds or an unreadable reply leaves the Name_Matcher's result unchanged
  - Never log the answer text or the key; these calls are not counted in `GRADE_AI_CALLS_PER_DAY`
  - Run `test/providers.test.js` in the cloud and fix what it reports
  - _Requirements: 11d_

- [x] R3. Create `server/lib/grade-stamp.js`
  - No test imports it directly; `server/routes/grade.js` (task 7.2) and the flow tests in `test/grade-flow.test.js`, `test/grade-lead.test.js` and `test/grade-review-fixes.test.js` depend on its behavior
  - Form stamp: hidden field `t = <ms>.<hex hmac(secret, 'form:' + ms)>`; accepted when the HMAC matches, the age is at least 3 seconds and at most 2 hours; a forged or malformed value is refused
  - Cookies, all signed with `GRADER_SECRET` and checked with `timingSafeEqual`: unlock `g_<id>` (value `hmac(secret, 'unlock:' + id)`), browser-that-ran-the-check `gr_<id>` (for the Google live answer) and claim `gc_<id>`; each `HttpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/grade/<id>`, `Max-Age` 90 days
  - Read the cookie and stamp expectations in the three flow test files before writing it, and take the clock from the injected `clock`
  - Never log a stamp, a cookie value or the secret
  - _Design: "Unlock cookie and form stamp"; Requirements 11b and 12_

- [x] R4. Share one 30-second budget across the website steps in `server/lib/grader.js`
  - Requirement 2.8 gives the website steps 30 seconds together. Today each fetch has its own 10-second limit and robots.txt and llms.txt are fetched at the same time, so the worst case is about 20 seconds and no shared timer exists
  - Add one deadline for `readWebsite` (an `AbortSignal.timeout(30000)` or a single timer cleared in `finally`); a step still running at the limit is ended and recorded as `failed`, its Checks `not_checked`, and the Grade still finishes `done`; never let a late fetch write a step after the deadline
  - Built after the full suite passed (1015 of 1015). `createGrader` takes an optional `websiteBudgetMs` (default 30000) so a test can use a short one; not yet run in the cloud
  - _Requirements: 2.8_

- [x] 6. The grader flow
  - [x] 6.1 Create `server/lib/grader.js`
    - `createGrader({ store, assistantProvider, aiBudget, safeFetcher, notifier, clock, newId, config })`
    - `start(input)`: normalize, build the reuse key, create the Grade as `running`, copy reusable AI results (only `ai`, labeled with their original time), schedule `run(id)` once
    - `run(id)`: the website steps and the AI step started together, the five Scan_Steps listed in order, each appending a short finding and `{ name, state, ms }`; website steps share a 30-second budget; the AI step uses `aiBudget.consume({ kind: 'grade' })` and a 120-second race; a failed step marks its Checks `not_checked` and the run continues; finish as `done` with results, AI results, score, facts and finish time
    - `askAi`: store prompt, provider, model, web search flag, answer cut to 4,000 code points, named flag, competitors, time taken
    - `isStale(grade, now)`: `running` and older than 4 minutes
    - Log only the Grade_Id, step names, counts and timings
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 7.1, 7.8, 8.1, 14.3, 14.4, 14.6_
  - [ ]* 6.2 Write property and example tests for the grader flow
    - **Property 10: Reuse never copies a visitor's state**
    - Examples with the fixtures and the mock provider: a full run finishes `done`; an unreachable site gives `not_checked` website Checks and still a `done` Grade; an AI timeout gives `ai-named` `not_checked`; a stale Grade reads as failed
    - **Validates: Requirements 2.5, 2.6, 2.7, 14.3, 14.4**

- [x] 7. Pages and public routes
  - [x] 7.1 Create `server/lib/grade-html.js`
    - `gradeFormPage({ values, errors, stamp, categories })`: headline asking whether AI can find the business, five fields, category suggestions through a `datalist`, honeypot and stamp, no email or phone field
    - `scanPage(grade)`: Scan_Steps with done, running and waiting marks; refresh meta tag
    - `reportPage(grade, { unlocked, leadGate, contactEmail, demo })`: Free_Part (score or "Not enough to score yet", "<failed> of <counted> checks failed", the AI sentence and escaped answer, Free_Page_Preview with "Add your <field>" blanks and the claim button, Google before-and-after preview, group lines, "Automated check" date in Central time, the "days to weeks" line, the removal line); Lead_Form or Full_Report (every Check with detail, points and fix; Fix_Kit in `<pre>` blocks; "Check again"; the First Answer offer line)
    - `failedPage(grade)` with a start-again button; `aboutPage()`
    - Use `layout()`, `escapeHtml` on every value, plain words, American spelling, no dollar figures
    - _Requirements: 1.1, 1.3, 1.4, 2.3, 7.5, 7.6, 7.9, 9.1, 9.2, 9.3, 9.4, 9.8, 10.1, 10.6, 11.6, 11.7, 16.1, 16.2_
  - [x] 7.2 Create `server/routes/grade.js` and mount it in `createApp`
    - `GET /grade`, `POST /grade` (validation, website normalization to `https://<host>/`, honeypot, stamp, rate limits, 303), `GET /grade/about`, `GET /grade/:id`, `GET /grade/:id/status.json`
    - Reject malformed ids with 404 before reading the store
    - Send `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` on every `/grade` response
    - Return 404 for every `/grade` path when `GRADER_ENABLED` is `off`
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 2.1, 2.3, 9.5, 9.7, 14.2_
  - [x] 7.3 Create `public/js/grade.js`
    - Poll `status.json` at most once a second while running and swap in the report; copy buttons using `navigator.clipboard` with a select-text fallback; the page works fully without it
    - _Requirements: 2.4, 11.6_
  - [x] 7.4 Keep `/grade` out of `sitemap.xml`, `llms.txt`, the MCP tools and IndexNow, and add a plain link to `/grade` on the home page
    - _Requirements: 9.6_
  - [ ]* 7.5 Write example tests for the pages and routes
    - Form 422s for each bad field, honeypot and too-fast stamp; 303 and Grade stored; refresh tag while running; report sections; noindex headers; 404 for unknown and malformed ids; sitemap and llms.txt free of `/grade`; no "Yellow Pages" or "YP" in any Grader page
    - **Validates: Requirements 1.1 to 1.7, 2.3, 9.1 to 9.8, 16.2**

- [x] 8. Checkpoint: grade a fixture end to end
  - Rebuild note: with every grader file rebuilt, the cloud ran the whole suite and it passed 1015 of 1015.
  - Run `node --test`, including flow tests that grade each fixture end to end through `createApp` with a fake transport serving the fixture pages and the mock AI provider. The safe fetcher's address rules are never loosened for tests or local runs. Ask the user if questions arise.

- [x] 9. Lead gate, claim, recheck and admin
  - [x] 9.1 Lead form and unlock
    - `POST /grade/:id/unlock`: validate name, email and phone (existing normalizers); store the Lead; set the signed `g_<id>` cookie; run the two extra AI_Questions in the background and recompute the Score; notify the site owner with business name, score and report link only; 303 to the report
    - `GRADER_LEAD_GATE=off`: show the Full_Report to all and run the extra questions on the first view, subject to the budget
    - Add `notifyLead({ business, score, reportUrl })` to the mock, console, none and Resend notifiers as designed (Resend sends to `ADMIN_EMAIL` only; never throws)
    - _Requirements: 7.2, 7.6, 8.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - [x] 9.2 Claim the free listing
    - `POST /grade/:id/claim`: reuse an existing Draft when `draftId` points to one; else build fields (JSON-LD first, then tel links and text; phone through `normalizePhone`; category through `mapCategory` with `other` as fallback; service as the first service; city and state from the input) and call `draftStore.create` with `missingFields`; store `draftId`; 303 to `/rise/drafts/:draftId`
    - _Requirements: 10.2, 10.3, 10.4, 10.5_
  - [x] 9.3 Check again
    - `POST /grade/:id/recheck`: website steps only, AI results kept, `previousScore` stored, one per Grade every 2 minutes and 10 per client per hour
    - _Requirements: 13.1, 13.2, 13.3_
  - [x] 9.4 Admin pages
    - `GET /admin/grades`, `GET /admin/leads` (newest 100), `POST /admin/grades/:id/delete` (Grade and its Leads), all behind `requireAdmin`
    - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - [ ]* 9.5 Write example tests for unlock, claim, recheck and admin
    - Gate on: Lead_Form shown, unlock stores one Lead, sets the cookie, shows the Full_Report only to that visitor; gate off: Full_Report for all
    - Claim twice creates one Draft and redirects to it; the Draft is not published
    - Recheck inside 2 minutes answers 429; recheck keeps AI results
    - Admin pages refuse without login; delete makes the report 404
    - **Validates: Requirements 10.3, 10.4, 10.5, 12.2, 12.6, 13.2, 13.3, 15.3, 15.4**

- [x] 10. Fixtures, README and final checkpoint
  - [x] 10.1 Add `test/fixtures/grade/` with three saved home pages (restaurant with slider headlines, roofer with JSON-LD that fails to parse, large company with several JSON-LD blocks), personal details replaced, plus expected Page_Facts and Check_Results; add example tests that read each fixture
    - _Requirements: 17.3_
  - [x] 10.2 Update the README: what the Grader does, the four settings, how the AI cap is shared, how to turn the lead gate off for judges, and where leads appear
  - [x] 10.3 Final checkpoint: run `node --test`; every test passes, including every test from earlier specs. Ask the user if questions arise.
    - Rebuild note: the cloud ran the whole suite with every grader file rebuilt in Kiro and it passed 1015 of 1015 (the original 1014 plus one new property test).
    - _Requirements: 17.1, 17.2, 17.4_

## Review fixes

From `review-2026-11-18.md` (two independent reviews of the rebuild; security clean, 1015 of 1015 passing). Each item is something the tests do not catch. Work in order; the cloud runs the tests.

### A. Behavior

- [x] V1. Old stored Grades keep working: fall back to `grade.facts` when `found` is missing (report and claim); never count second-opinion answers toward the score or the "named" sentence, for old and new Grades (an old entry is a second opinion when its provider is not the main assistant); accept the old `requester:` label for the `gr_` cookie; treat an old `draftId` as that browser's Draft when the cookie matches it
- [x] V2. `POST /grade` must not wait on the Gemini name check: store the Grade first, re-read carried answers in the background in parallel, and do not re-read on every reuse just because an earlier Gemini check failed
- [x] V3. The two extra questions run on unlock even when the free question failed or hit the daily limit (requirement 9.2); stop the extra questions once the main assistant fails, so a paid call is not wasted
- [x] V4. `recheckRunning` expires after 4 minutes, like `isStale`, so a restart cannot leave "Checking your website again" on the report forever
- [x] V5. A failed home page does not skip robots.txt and llms.txt: still read both, so the AI crawler check can still run
- [x] V6. Hours: parse each comma-separated part on its own ("Mo-Fr 08:00-17:00, Sa 09:00-12:00"); when unsure leave hours blank; in the fix kit's business label do not put free text in `openingHours`
- [x] V7. Page title check: match whole words and allow short service words ("Best Spa in Nashville" passes; "Proofers Club Nashville" does not pass for "roofers")
- [x] V8. Claim after the owner sent the Draft for review goes back to the same Draft (requirement 10.4), not a new one
- [x] V9. Non-UTF-8 pages: decode with the charset from the header or meta tag (at least latin1 and windows-1252); a lookup that throws synchronously rejects with a `SafeFetchError`
- [x] V10. Competitor names: nested detail lines such as "Free Estimates" and "Same-Day Service Available" are not competitors; a name containing "Pros" is not dropped ("Plumbing Pros of Nashville" stays; a business with "Pros" in its own name keeps its place)
- [x] V11. Count the unlock rate limit only for valid submissions; with the Grader switched off, `/grade` still sends the noindex header on its 404

### B. Page wording and layout

- [x] V12. Never sound like a promise AI will name the business: leave `ai-named` out of "Fix these first"; its fix keeps "It can take days to weeks, and we can't promise AI will name you."
- [x] V13. Lead form: say the report opens right away on this page; bring back the phone note ("Why the phone number? ...")
- [x] V14. About page: write for the person who clicked "What do we read, and why?" and say everything in the review's list (what is read, user agent, the AI questions, Gemini name check, second opinions, Google's live answer, 90 days and removal)
- [x] V15. Google's live answer: its section on the report (heading, question asked, the note) and "Google doesn't review or endorse this report." on the answer page
- [x] V16. Free listing box: heading "Your free listing in our directory", the full note, compact phone-book listing look
- [x] V17. After 10 minutes say "We asked <assistant> on <date>" instead of "We just asked"
- [x] V18. Form errors red and bold, top note "Please fix the problems below.", one State hint only
- [x] V19. Check titles are neutral names, not claims; plain words in details
- [x] V20. Help for owners who are not computer people ("Not a computer person? ..." and the fix-kit intro)
- [x] V21. Smaller layout points: "Score by area" heading with points; "Check again" after the fix kit under "Made some changes?"; hint lines in the small hint style; plain note (not error) with no website; 404 page keeps "Reports are deleted after 90 days."

### C. Round 2 (`review-2026-11-18-round2.md`)

- [x] V22. Re-reading a carried answer never takes away a mention: treat an answer of 4,000 or more characters as cut even when `answerCut` is missing (old Grades), and keep `named` true when the earlier read found it; a re-read may add a mention, never remove one
- [x] V23. Competitor names under headings: bullets that sit under a numbered business heading (`### 2. Joes Plumbing`) are details of that business, not new names; a line that is only an offer ("Free Estimates", "Same Day Service", "24/7 Emergency Service") is not a business name, at the top level too

### D. Round 3 (`review-2026-11-18-round3.md`)

- [x] V24. Google note mid-sentence reads "the demo assistant's answers", lowercase (also on the live answer page and the answers section)
- [x] V25. A business with no website gets its own fix-kit intro that does not assume a website
- [x] V26. Third AI question grammar: "...do people say are the most reliable?" (fix at the source, in grader.js and requirement 7.2)
- [x] V27. Hours on the listing card and in the info sheet draft read as "Monday to Friday, 7:00 am to 6:00 pm"
- [x] V28. "Want help?" says who First Answer is: "First Answer, the team behind First Answer Pages"
- [x] V29. Google's live answer page puts the answer back in the quoted-answer style
- [x] V30. About page opens in plain words ("This is our free AI Visibility Check.") with no web address path
- [x] V31. Free listing card rows are spaced tightly again, like one phone-book entry

### E. Round 4 (`review-2026-11-18-round4.md`)

- [x] V32. Rework V23 so it never loses real names: a numbered heading is a business heading (its bullets are details) only when it reads like ONE business (a trade word that names work, a legal word or a possessive); a group, category or place heading is not a name and its bullets are the businesses; never filter out an entry that matches the business itself; drop offer-only lines only when the whole line is one of a short list of phrases; example tests added to `test/grade-name-match.test.js`

### F. Round 5 (`review-2026-11-18-round5.md`)

- [x] V33. One name for the product everywhere: "AI Visibility Check" (About page heading and title; the report's main heading is "AI Visibility Check" with "Report · First Answer Pages" under it; admin pages and the draft source label use it too; code names, routes and file names stay)

### G. Round 6 (`review-2026-11-18-round6.md`)

- [x] V34. A business heading with Title Case detail bullets stays a business: a heading that matches the business itself is never a group; "Label: value" bullets ("Known For:", "Best For:", "Price Range:") are not names; a numbered heading is a group only when it does not read like one business and real business-name bullets follow it; otherwise it is one business and its bullets are details; example tests added to `test/grade-name-match.test.js`

### H. Round 7 (`review-2026-11-18-round7.md`)

- [x] V35. `name-match.js` passes a fixed table of 23 realistic AI answers (P1 to P6, R1 to R3, S1 to S7, F1 to F5, H1, H2): new test file `test/grade-name-match-cases.test.js` holds the table; headings are decided once per answer (if the business is a numbered heading, headings are businesses and bullets are details; if it is a bullet under headings, headings are groups); "Name: description" bullets give the name before the separator unless it is a label from a fixed list; indented bullets under a numbered name are details; plain-sentence bullets give their leading name; the business's own name is never filtered out

### I. Round 8 (`review-2026-11-18-round8.md`)

- [x] V36. "**Name:** description" lines give the bold name (dropped only when the bold text is a detail label); also one-word names in `**Name:**` prose lines and in a table's name column; section headings such as "Things To Consider" and "Bottom Line" are never names; bullets under a tips or advice heading are advice, not names; sentences that start with an advice verb give no name; the 11 new cases (Y1 to Y3, X1 to X7, Z1) added to `test/grade-name-match-cases.test.js` beside the 23 existing ones

### J. Round 9 (`review-2026-11-18-round9.md`)

- [x] V37. One-word names (Husk, Bastion) are kept as competitors in numbered headings, numbered list items, bold numbered lines, a table's name column and `**Name:**` lines; section words (Overview, Important, Recap) are never names; "**Top pick:** Name" style labels give the name after the colon; "Note:", "Important:", "Heads Up:", "Pro Tip:" lines give none; lines that start with an advice verb ("Ask For Quotes") are not names unless they are the business; an acronym-first name with lowercase words ("ABC plumbing") is kept in list items; 8 new cases (W1 to W4, T3, T4, A1, A2) added to `MORE_CASES` in `test/grade-name-match-cases.test.js`, the 34 existing cases unchanged

### K. Round 10 (`review-2026-11-18-round10.md`)

- [x] V38. Show the whole list in the AI's order, with the business in its real place: when the business has a position, the numbered list under "What AI says" has every name as the AI ranked them, the business in its place in bold with "(you)" after it (its name as the AI wrote it, else as typed); with no position, or not named, the competitors are a plain list without numbers under "Other businesses it named:"; all escaped; example tests in `test/grade-report-list.test.js`
- [x] V39. Show answers as clean reading text, for display only: `readableAnswer` in `grade-html.js` removes `**`, `__`, and single `*` or `_` emphasis, turns `[name](link)` into the name, drops heading marks, turns `-` and `*` bullets into "• ", keeps numbered lines and line breaks, and drops citation marks (`[1]`, `[web:3]`, `[[2]](link)`); used for the main answer, second opinions and Google's live answer; the stored answer and the name matcher are untouched; still escaped; example tests in `test/grade-report-list.test.js`

### L. Round 11 (`review-2026-11-18-round11.md`)

- [x] V40. Two narrow gaps in competitor names: a line that starts with an advice verb is still a name when it ends in a trade or legal word ("Check Mate Plumbing", "Call Today Roofing", "Look Salon", "Get Fit Plumbing"), while "Ask For Quotes" and "Book early" stay advice; a bare one-word bullet ("- Husk") is a name when the other bullets in its list give names, and "Free", "Estimates" and similar offer words are never names; items under a "Tips:" line or heading, numbered or bulleted, are advice; 7 new cases (V1, V2, V4, V5, V7, B1, B2) added to `MORE_CASES` in `test/grade-name-match-cases.test.js`, the 42 existing cases unchanged

### M. Round 12 (`review-2026-11-18-round12.md`)

- [x] V41. Advice-verb names with other business endings stay names: a line that starts with an advice verb is a name when its last word is a trade or legal word, or one of services, service, solutions, group, spa, garage, auto, movers, moving, builders, pest, control, locksmith, pros, studio, with at least one word between the verb and the ending and none of for, about, from, on, with, to, the, a, an, in, at; "Compare Services", "Ask About Warranty Services", "Book Early For Spring Services" and "Book Your Consultation" stay advice; cases E1 to E5 and G1 to G3 added to `MORE_CASES`
- [x] V42. Cap every pattern in `readableAnswer` (link text 200 characters, link address 2,000, emphasis 300, small caps on spaces and citation numbers) so a long line of broken marks is read quickly; one test added to `test/grade-report-list.test.js` (120,000 characters of "[a" in under 1 second, and "[Parlour](https://parlournashville.com)" still becomes "Parlour")
- [x] V43. "and" and "&" are the same word when matching the business: the name normalizer in `name-match.js` reads "&" as "and" on both sides; in a bullet that is a sentence, the name is the Title Case words before the first lowercase verb, and the advice-verb rule applies to that name part only ("Get It Done Window Washing has a 5.0 rating" is a name; "Get a written estimate before work starts." stays advice); cases C1 to C4 and G4 added to `MORE_CASES`; the 49 existing cases unchanged (62 in all)

### N. Round 13 (`review-2026-11-18-round13.md`)

- [x] V44. Numbered lines written as sentences keep their names: the V43 sentence-name rule (the Title Case words before the first lowercase verb, or before ", which" or ", a") now also reads numbered lines, never the whole sentence ("Husk serves Southern food in a historic house." gives "Husk"); a one-word name before a verb counts in numbered lines and bullets ("Bastion has big bar nachos.") unless it is a section, detail or filler word; the small-word check (for, about, from, on, with, to, the, a, an, in, at) now runs before the trade-word check, so "Get Quotes From Three Plumbers is a good idea." is advice; a line that starts with a pronoun ("It is also worth calling two shops…") is never a name; items under "Before you hire:" stay advice; 8 new cases (N1 to N6, G5, G6) added to `MORE_CASES`, the 62 existing cases unchanged (70 in all)

### O. Round 14 (`review-2026-11-18-round14.md`)

From a cloud load test of 20 and 50 checks at once (fake AI answers and fake websites, nothing live): no errors, but five launch-day gaps. Tests are in `test/grade-load.test.js` (additions only): fake providers, a fake clock and a fake pause, so there is no real AI, no real network and no real waiting.

- [x] V45. Retry once on 429 or 529 and do not charge those calls: `postJson` in `assistant.js` puts the HTTP status and the `retry-after` value (seconds or a date) on the `AssistantError`; the grader waits what the provider asks (at most 20 seconds, 5 when none is given) and asks once more inside the same deadline; the retry is not charged again; a call that still ends in 429 or 529 is given back to the daily allowance (`aiBudget.refund`); any other failure, such as a 500, is charged as before and not retried; nothing about the answer or the typed input is logged
- [x] V46. Second opinions never hold up the report: the scan finishes when the website step and Claude's answer are done; each second opinion has 45 seconds (`secondOpinionTimeoutMs`) and is saved to the Grade when it arrives, or noted as `secondMissed` and shown as "<Assistant> didn't answer in time."; a second opinion that ends before the report is written goes in with it; Claude keeps its 120 seconds
- [x] V47. A check without Claude's answer is marked partial: when `ai-named` is not checked but there is a number, the report says "Partial score: Claude didn't answer this time, so the AI part isn't counted. Check again later for your full score." under the number (with its own wording when the daily limit was reached or the AI check is not connected); the number is kept; the admin list shows "(partial)"; a Recheck stores no "before" score for a partial Grade and the report shows no "before" line when the score is partial
- [x] V48. At most `GRADE_MAX_RUNNING` (default 20, a positive whole number read like the other settings in `config.js`, and listed in the README) checks run at once; the rest wait in a first-in, first-out line and show the normal scan page with the step "You're in line. Your check starts in a moment." (works without JavaScript; `status.json` adds `queued: true`); the line lives in memory like a running check, so a restart clears it the same way; waiting checks count toward the per-address limits as before
- [x] V48a. A check waiting in line is not failed for the time it waited: the stale clock counts from `startedAt`, written when the check starts running (falling back to `createdAt` for older Grades); a check still in this process's line is never stale; one left over from before a restart has no place in the line and goes stale after 4 minutes as before
- [x] V46a. A report opened while a second opinion is still answering says "<Assistant> is still answering. This page updates by itself." and reloads (the script, and a no-script refresh) until it arrives or runs out of its 45 seconds (`secondPending` on the grader, kept in memory)
- [x] V45a. A second opinion never pauses more than 5 seconds before its one retry; Claude may still wait up to 20
- [x] V47a. The two new V47 recheck tests open the full report first (the lead gate is off in those tests), since "Check again" needs the full report
- [x] V49. The lead email goes out in the background: the lead form answers at once and the email is sent inside try/catch under the existing 5-second limit, once; nothing about the lead is logged
- [x] V53. The "still answering" note counts pending second opinions per answer, not per provider name: `trackSecond` keeps a count for each provider, so ChatGPT stays listed (and the report keeps refreshing) until every one of its pending answers has arrived or run out of time; the note still names assistants, not calls; test in `test/grade-load.test.js` with a fake ChatGPT that takes 600 ms on one extra question and 1,200 ms on the other
- Not in this round, for the owner to decide: the daily AI allowance (`GRADE_AI_CALLS_PER_DAY`, `MAX_AI_CALLS_PER_DAY` are Render settings and a spending decision), and the storage change (one file per report, or SQLite) that thousands of stored reports will need before real traffic

### P. Round 15 (`review-2026-11-18-round15.md`)

- [x] V50. A bold name is the whole name: text between `**` and `**` (or `__` and `__`) at the start of a list item is kept as written, even with a lowercase word inside it ("**Mike's mobile Plumbing**", "**Sparkle drain Pros**"), when it starts and ends with a capital, is 2 to 6 words and is not a heading, a detail label or advice ("Water heater specialists" and "If you need it done today" stay group labels); the sentence-name rule (V43, V44) never applies to text that starts with bold, so a bold name is never cut at its first lowercase word (the Property 8 counterexample "Aa Ab aAA Aa" no longer comes back as "Aa Ab"); 5 new cases (K1 to K5) added to `MORE_CASES`, the 70 existing cases unchanged (75 in all)

### Q. Round 16 (`review-2026-11-18-round16.md`)

- [x] V51. Bold names with a lowercase word at the start or end, and standalone bold names, are kept: a bold list item or bullet is the whole name when it starts and ends with a capital, or has a cue (brand styling such as "iFix", a legal word, or a trade or business word with a possessive or two capitalized words: "**Mike's plumbing**", "**iFix Hair**", "**the Hair Bar**", "**Fox and Jane salon**"); a standalone bold line (no number or bullet) is a name when it reads like one or has such a cue (the capital-at-both-ends arm is not used there, so "**Residential plumbing**" stays a label); bold text that starts like a sentence (a, an, our, your, we, you, it, this…), or is a heading, section, group, detail-label or advice text ("**Before you hire a plumber**", "**Our top picks for you**", "**a quick note on prices**") is never a name; 6 new cases (L1 to L4, G7, G8) added to `MORE_CASES`, the 75 existing cases unchanged (81 in all)

### R. Round 17 (`review-2026-11-18-round17.md`)

- [x] V52. "It listed N businesses" and the numbered rows come from one list: the main ranked list that holds the business (or, when it is not named, the first list); names after a lead-in line such as "Other names to check:", "Also worth a call:" or "Honorable mentions:" belong to a separate later list, are not numbered or counted, and show under the rows as a plain "Also mentioned:" list (answer order, escaped, at most 5); `splitLists` in `name-match.js` reads the lists for display, the stored `competitors`, `position` and `total` are unchanged, and `analyzeAnswer` is unchanged; when the second look dropped names only the names it kept are shown, and when the business is not found in the answer text the stored numbers are used as before; Colby's Capital City answer reads "It listed 5 businesses, and yours was 3rd" with exactly 5 rows; example tests added to `test/grade-report-list.test.js`; the 81 name-match cases are unchanged

### S. Round 18 (`review-2026-11-19-round18.md`)

- [x] V54. Restaurant words, and names that start with This, Here or We: `BOLD_BUSINESS_WORDS` gains kitchen, grill, pizza, cafe, café, diner, bbq, bistro, tacos, bakery, deli, eatery and tavern ("**Mama's kitchen**", "**Your Pie pizza**" are kept, with the existing possessive-or-two-capitals rule); `PRONOUN_STARTS` (sentence lines) and `BOLD_NOT_FIRST` (bold text) apply only when the second word is lowercase or missing, so "This Is It BBQ", "Here Kitchen" and "We Taco Bout It" are names while "This is a great pick", "We recommend calling ahead", "Here is a tip: go early", "Our top picks for you" and "a quick note on prices" stay advice; bold advice items ("**Book a table**", "**Try the pizza**") stay advice; 6 new cases (P1 to P4, G9, G10) added to `MORE_CASES`, the 81 existing cases unchanged (87 in all)

### T. G1 review (`review-2026-11-19-g1.md`)

- [x] V55. The network message shows whenever the network is full, even when the address is also full (`networkFull ? tooManyNetwork : tooMany` in `POST /grade`; the address peek is gone); test with one address at its hourly limit and its /24 full
- [x] V56. The three new-check rules (`grade`, `grade-day`, `grade-network`) use their own limiter, `ctx.gradeLimiter` (injectable as `deps.gradeLimiter`; falls back to `deps.rateLimiter` when only that is given, so existing tests are unchanged), so 10,000 other keys (such as `/mcp` per-address keys) cannot evict the network count; test sends 10,050 `/mcp` requests from one /64 and the next check is still refused
- [x] V57. G1 tests prove a refused check counts nothing (peek with `grade` and `grade-day` at limit 1 and the network rule at limit 2, all still allowed, read from `ctx.gradeLimiter`) and that Retry-After came from the daily rule (above 3600)
- [x] V58. The `network-key.js` header comment now says that different unknown strings stay apart and that an empty or missing value gives `''`, which is shared

### U. G2 review (`review-2026-11-20-g2.md`)

- [x] V59. `verify` reads Cloudflare's JSON whatever the status below 500, so a 4xx with `success: false` and `invalid-input-response` gives `failed` (and `invalid-input-secret` gives `misconfigured`); `unreachable` only for a status of 500 or more, a body that can't be read, or a reply without a true/false `success`; the design line is updated; tests: 400 with `invalid-input-response` is `failed`, 400 with `invalid-input-secret` is `misconfigured`, 503 with an HTML body is `unreachable`
- [x] V60. With exactly one Turnstile key set, one startup warning names the missing key and no value ("The human check is off: TURNSTILE_SECRET_KEY is not set."); test covers both missing keys and that no value appears
- [x] V61. The "couldn't confirm" message shows right above the widget (`errors.humanCheck`), not at the top of the form; other form errors stay where they are; test
- [x] V62. `remoteip` is sent as a plain IPv4 address when the address arrives as `::ffff:a.b.c.d` (or its hex form); test

### V. G3 review (`review-2026-11-22-g3.md`)

- [x] V63. The budget file's writes are coalesced: at most one running and one waiting, the waiting one writing the state as it is when it starts (`createAiBudget` takes an optional `save` so tests can count writes; `flush()` waits for both); tests: 1,000 `note()` calls make only a few writes, the file ends with the right numbers, and a `consume` made after them is on disk too
- [x] V64. `watch()` catches everything, starts any email without waiting, attaches a `.catch`, and always returns `undefined`, so `started()` and the live-answer route need no try/catch; tests: with a notifier that throws and one that rejects the check still starts (303), the live answer still shows, and nothing is logged beyond one plain line
- [x] V65. The design says `once()` is true before the flag is on disk and before the send finishes (a crash in between can send a second email, a failed email is not retried that day) and that `once` is called only at the moment of sending
- [x] V66. The comment in `app.js` about `ai-budget.json` now says it is also written when a Grade starts and when a check is turned away, in demo mode too

### W. G5 review

- [x] V67. `protectionBlock` wraps the `summary()` call in a try/catch that falls back to an empty object, so the admin Grades page is never a 500 because of the counts (a non-object result counts as empty too); test
- [x] V68. The checks line says "1 check run" when the count is 1 and "<n> checks run" otherwise; test
- [x] V69. The two count lines start "Human check today:" and "Limits today:", so they do not read like the setup line "Human check: on"; the design wording and the G5 tests are updated to match
- [x] V70. README gap from the Feature G checkpoint: the `NOTIFIER` and `ADMIN_EMAIL` rows and step 6 say that with `NOTIFIER=resend`, `ADMIN_EMAIL` also gets the heads-up emails at 50% and 90% of the day's Grader AI calls and one "the human check may be set up wrong" email on a day with 10 or more refusals and no pass, counts only, and that nothing is sent when `NOTIFIER` is unset; the `GEMINI_LIVE_SEARCH` row says at most 3 live answers per report in total, on top of the hourly limits; "Where leads appear" says `/admin/grades` also shows how the protection is set up and today's counts

### X. F1 review (`review-2026-11-22-f1.md`)

- [x] V71. Redirect-style addresses are refused in `reviewsLinkHost`: Yelp only under `/biz/`; `/url` refused on `google.com` and `maps.google.com`; `google.com` `/maps` only as exactly `/maps` or starting `/maps/`; Facebook `/l.php` and paths starting `/flx/` refused; the design's host list is updated; each is a refused case in the tests
- [x] V72. The trimmed link must start with `https://` (any letter case), so `https:google.com/maps` and `https:\\google.com\maps` are refused; tested
- [x] V73. `reviewsLinkOnPage` accepts a Facebook link only when its path ends with `/reviews` or contains `/reviews/` (`/reviewsfake` is refused); tested

### Y. F2 review (`review-2026-11-22-f2.md`)

- [x] V74. In the `<a>` scan an href reaches `reviewsLinkOnPage` only when it starts with `https://` (any letter case), and review links are looked for only among the first 2,000 links; the timing test gains a 1 MB `<a href=x>` page and a 1 MB `<a href="/x">y</a>` page (each under 200 ms)
- [x] V75. The service-area, rating and quoted-comment tests read only the first 200,000 characters of the text (`textForPatterns`, `serviceAreaText` and `MAX_PATTERN_TEXT` in `page-facts.js`); a timing test normalizes and tests 1 MB of text in under 200 ms
- [x] V76. The window after "serving", "we serve" and "proudly serve" is 40 characters, not 80; "We serve breakfast all day. Visit us at 12 Main St, Nashville, TN" fails for Nashville, while "We proudly serve the greater Nashville area" and "Serving Nashville and surrounding areas" still pass; every example the design lists still fits in 40 characters

### Z. F3 review (`review-2026-11-22-f3.md`)

- [x] V77. A lead stores the score the report shows: `shownScore(grade)` in `grader.js` works it out with `scoreGrade(grade.results)` when the Grade has results, and keeps the stored number when it has none (the report's fallback); tested with an old stored Grade (the lead and the lead email say 40, not 42)
- [x] V78. `resultsOf` in `grade-html.js` drops entries that are not objects with a string `id`, so junk in `results` never makes the report a 500; tested

### AA. F4 review (`review-2026-11-22-f4.md`)

- [x] V79. The service-area test reads the page text before punctuation is taken out (`serviceAreaSource(facts)`, still the first 200,000 characters; the city's words are escaped and may be joined by spaces or punctuation); after "serving", "we serve" or "proudly serve" the city or an area word must come before the end of the sentence (a period, "!", "?" or a line break), at most 120 characters, checked backward from the city or area word with a bounded lookbehind; the three town-list lines pass for Nashville, the breakfast line still fails, the designed examples still pass, and a 1 MB page of "serving " stays under 200 ms; the two V76 tests that pinned 40 characters on normalized text now read the page text and pin 120

### AB. F5 review (`review-2026-11-22-f5.md`)

- [x] V80. `readPageFacts` adds `areaText`: the page text with a line break wherever a block ends (`</p>`, `</div>`, `</li>`, `</h1>` to `</h6>`, `</td>`, `<br>`; one bounded pattern over at most the first 1,000,000 characters of HTML, then the 200,000-character cut), and `serviceAreaSource` reads it (hand-built facts with only `text` are read as before; `facts.text` is unchanged); the three split-block pages fail for Nashville, the one-block lines pass, and a 1 MB page of `<p>serving</p>` stays under 200 ms

### AC. F6 review (`review-2026-11-22-f6.md`)

- [x] V81. `publicListing` leaves `reviewsLink` out unless `reviewsLinkHost` accepts it, so a hand-edited bad link never comes out of the JSON API, MCP `get_listing` or MCP `search_listings`; tested for the API and for MCP get and search

### AD. F12 code review and page read, round 2 (`review-2026-11-22-f12-pages.md`)

- [x] V90. The owner form accepts a website typed the short way: `ownerWebsite` in `routes/rise.js` puts `https://` in front of text with no scheme and rewrites `http://` the way the claim does (`claimWebsite`), then `normalizeWebsite` (unchanged) decides; the hint reads "The address of your own website, like example.com"
- [x] V91. When anything was left out, the "Saved, but we left out…" top line uses the plain notice style, not the green "Saved." style
- [x] V92. The `/grade` title reads "Can AI find your local business? Free AI Visibility Check | First Answer Pages"
- [x] V93. The `/grade` description reads "See whether AI assistants name your local business when someone asks for one like it, and get a score with plain fixes. Free, no sign-up."
- [x] V94. `GET /rise` has the description "List your local business free on First Answer Pages. Send a photo of your card or sign, or type it in. We review every listing." (without the photo sentence while the photo reader is closed) and a canonical link from the configured base address only; draft pages get neither
- [x] V95. `/about` links to the check, only while the grader is on: "Want to know if AI can find your business? Run the free AI Visibility Check."
- [x] V96. `/grade/about` reads "Our visits identify themselves as:" instead of "Its user-agent string is:"
- [x] V97. When rendering `GET /grade` or `GET /grade/about` throws, the error reply carries `X-Robots-Tag: noindex, nofollow`

### AE. Code review of V90 to V97 (`review-2026-11-22-v90.md`)

- [x] V98. `normalizeWebsite` refuses a host that does not match `^[a-z0-9.-]+$` after the trailing dot is removed (punctuation such as `"`, `'`, `` ` ``, `{`, `&`, `;` is left out; `xn--` names still pass); `reviewsLinkHost` needs no change, since it accepts only exact hosts from a fixed list
- [x] V99. One helper, `canonicalUrl(config, path)` in `server/lib/base-url.js`, builds a canonical link only from a plain base address (http or https, a host of letters, digits, dots and hyphens, an optional port, at most one trailing `/`); `/rise`, `/grade` and `/grade/about` use it

### AF. E3 code review and page read (`review-2026-11-23-e3.md`)

Wording and labels only; scoring and which answers are counted do not change.

- [x] V100. Fewer answers than asks: "We just asked Claude 3 times and got 2 answers. Claude named your business in 1 of the 2." ("in none of the 2", "in 2 of the 2"; a carried group "We asked Claude 3 times on Nov 19 and got 2 answers."); every ask answered keeps "…in 2 of 3 answers."; "Every answer" says "Claude was asked it 3 times" with the same count
- [x] V101. One hint line under the lead line when more than one answer is shown: "AI answers change from one time to the next, so we ask the same question 3 times." (the times asked; the Grade does not store the number planned)
- [x] V102. "This list is from answer 1, the first one that named you." or, when none named it, "This list is from answer 1."
- [x] V103. Scan step: "Asked Claude 3 times and got 2 answers." / "…and got 3 answers." / "Asked Claude 2 times, not 3, because we reached today's limit. Got 2 answers."; more than one carried answer: "Used Claude's answers from earlier this week." (one keeps today's sentence)
- [x] V104. "Every answer" says the count once: with second opinions only "Claude named your business in 2 of its 5 answers."; without them only "Named in 2 of 5 answers."
- [x] V105. `/grade/about`: "We ask Claude up to 3 questions …, and the first one up to 3 times, …"
- [x] V106. `timesAsked` ignores ask numbers that are not whole numbers from 1 to 3 (tested with 99, 0, -1, 2.5 and "3")
- Tests: new V100 to V106 tests in `test/grade-report-asks.test.js` and `test/grade-main-asks.test.js`; the E2 and E3 test lines that pinned the old sentences are updated; no older test changes

### AG. Reviews of V100 to V106 (`review-2026-11-23-v100.md`)

Wording only; no scoring change.

- [x] V107. When today's limit cut the asks short, the grader stores `aiMain.asks = { planned, asked }` (only then) and the hint reads "AI answers change from one time to the next, so we ask the same question 3 times. Today we could ask only 2 times because we reached today's limit."; otherwise the sentence is as before
- [x] V108. "Every answer" uses the full sentence "Claude named your business in 1 of its 4 answers." with or without second opinions; `test/grade-lead.test.js` line 277 changes to match (listed in the design's table)
- [x] V109. The two hint lines under the lead line are one paragraph: "AI answers change from one time to the next, so we ask the same question 3 times. This list is from answer 1, the first one that named you."
- [x] V110. Requirement 23.6 and the design name the "Every answer" count line as the one accepted exception for Grades with one answer per question
- Tests: `test/grade-report-asks.test.js` (the hint paragraph, V107 with odd stored numbers, the count sentence) and `test/grade-main-asks.test.js` (what a cut-short, a full and a one-ask Grade store)

### AH. W1 code review and page read (`review-2026-11-23-w1.md`)

- [x] V111. All three questions use the named phrase: "I'm looking for … Which ones would you recommend?" and "Which … do people recommend most?"; `plain` removed with its tests
- [x] V112. No "-ian" plural rule: nationality and cuisine words are never made plural; only "-ician" and five fixed words take "s"
- [x] V113. A fixed list of last words that end in "s" but are not plurals (arts, gas, bus, lens, …) gets " businesses"
- [x] V114. The bigger fixed lists for "s", "es" and "ies"; capitals follow the word (CPAs, DJs)
- [x] V115. Capitals: long all-capitals words lowered, short ones kept; Title Case lowered word by word; a fixed list of abbreviations raised
- [x] V116. Trailing punctuation removed before the rules run
- [x] V117. The N2 tests pin "PLUMBERS" equal to "plumbers", and the capitals that are kept or lowered
- [x] V118. The fix kit title never cuts the service mid-phrase and keeps the state when the service is shown (older than Feature F)

### AI. Reviews of V107 to V118 (`review-2026-11-23-v111.md`)

- [x] V119. Abbreviations are looked up by their lower-case form, with and without a final "s", whatever was typed: "CPAs", "cpas", "Cpas" give "CPAs"; DJs, RVs and B&Bs the same
- [x] V120. Joining words (and, or, of, the, for, in, on, at, by, to, with, a, an) are always lower case
- [x] V121. A phrase of two or more words typed all in capitals is lowered, then the raise and keep-capital lists apply; a single all-capitals word keeps the 4-letters-or-fewer rule
- [x] V122. Keep-capital words get their capital whatever was typed; Asian, Hawaiian, Brazilian, Ethiopian, Lebanese, Turkish, Peruvian and Tex-Mex added
- [x] V123. Fixed food rules: a cuisine word last adds " restaurants", "<cuisine> food" becomes "<cuisine> restaurants", the food list adds " restaurants", "pizza places", "bar and grill restaurants"
- [x] V124. "grocery" is off the "ies" list
- [x] V125. Food words typed as plurals lose their final "s" before " restaurants": "tacos", "burgers", "wings" (and the singulars) give "taco restaurants", "burger restaurants", "wing restaurants"
- [x] V126. In a phrase typed all in capitals, a word that holds a digit keeps its capitals: "A1 TOWING" gives "A1 towing businesses"
- [x] V127. Any phrase ending in "food" whose previous word is not a cuisine word adds " restaurants" after "food" ("fast food restaurants", "soul food restaurants", "health food restaurants")
- Tests: a new V119 to V124 table test, every keep-capital word typed four ways, and the three questions for four new cases; the older lines in `test/grade-question.test.js` that pinned results these rules change are listed in the design's table

## Owner-approved features (Nov 18)

From `feature-request-2026-11-18.md` and `spec-review-2026-11-18.md`: Feature A, a no-storefront mode for the address check (Requirement 18); Feature B, a "Reviews AI can see" check and a reviews link on the free listing (Requirements 19 and 20); Feature C, the business's own website on the listing (Requirement 21, tasks F8 to F10); and Feature D, letting Google and Bing find the main pages (Requirement 22, tasks F11 to F13). Feature D is approved too (F11 to F13). Three more features were approved on Nov 19 (`feature-request-2026-11-19.md`): bot protection (Feature G, Requirement 25, tasks G1 to G7), asking Claude three times (Feature E, Requirement 23, tasks E1 to E4) and a question that reads naturally (Feature F, Requirement 24, tasks W1 and W2; "W" for wording, so the names stay apart from F1 to F13). **Build order: the G tasks first, then F1 to F13, then E1 to E4, then W1 and W2.** Build one task at a time, in order, after the spec has been checked again. No shell commands: the cloud runs the tests and sends back failures. Add tests only. Never change or loosen an existing test, except the exact lines listed in "Numbers that change in existing tests (and why)" in the design, each with its reason. Follow `wording.md` and `grader-safety.md`: plain words, American spelling, never promise AI will name a business, never invent, copy or edit a review, escape everything, never log typed input.

- [x] F1. The review-link validator and the `reviewsLink` listing field
  - In `server/lib/listing-fields.js`, export `reviewsLinkHost(url)` for owner-typed links as the design describes (`https` only, no credentials or port, 1,000 characters at most, the listed hosts and path starts, including `maps.google.com`, a `google.com/search` address only with `lrd=` in the `#` part or `ludocid=` in the query, and `g.co/kgs/`); it keeps the query string and `#` part and returns `'google'`, `'yelp'`, `'facebook'`, `'nextdoor'` or `''`
  - Also export `reviewsLinkOnPage(url)` for links read from a home page: it calls `reviewsLinkHost`, then accepts a Facebook link only when its path contains `/reviews`, a Nextdoor link only when its path starts with `/pages/`, and never `search.google.com/local/writereview`
  - `normalizeFields` keeps `reviewsLink` only when `reviewsLinkHost` accepts it, and adds the key only when it has a value; `reviewsLink` is never in `missingFields`; read `test/listing-fields.test.js` first so its model-keys, size-limit and idempotence checks still hold
  - New test file `test/grade-reviews-link.test.js` (additions only): valid links for each site and each Google form (`maps.google.com/?cid=…`, `google.com/search?…#lrd=…`, a query with `ludocid=`, `g.co/kgs/…`); invalid ones (`http`, another site, `javascript:`, credentials, a port, a Google link outside `/maps`, `https://www.google.com/search?q=plumbers`, a Yelp link outside `/biz`, over 1,000 characters, a bare word); `validateFields` leaves an invalid value out and keeps a valid one; the result has no `reviewsLink` key when the input has none or an invalid one (`normalizeFields({})` returns all its usual keys, so do not expect `{}`); a real-length Google search link of about 600 characters with `#lrd=` passes; a review link over 1,000 characters fails; `reviewsLinkOnPage` refuses `https://www.facebook.com/CapitalCityWindow`, accepts `https://www.facebook.com/CapitalCityWindow/reviews`, refuses a Nextdoor link outside `/pages/`, and refuses a `writereview` link
  - _Requirements: 19.1, 20.1, 20.2_
- [x] F2. Page reading for service areas, reviews and review links
  - In `server/lib/page-facts.js` add `headings` (text of every `<h1>` to `<h3>`, leaving out heading text inside an `<a>` or a `<nav>`), `reviewLinks` (at most 5, page order, each passing `reviewsLinkOnPage`), `jsonLd.business.areaServed` (text from a string, an object with `name`, or an array) and `jsonLd.business.hasReviewData` (`aggregateRating` or `review` present), and export `serviceAreaPattern(city)` and the review patterns as the design describes
  - `serviceAreaPattern(city)` normalizes the city with `normalizeForMatch`, escapes every special character, builds no empty alternative for an empty city, never throws, and is matched against `normalizeForMatch(facts.text)`; after "serving", "we serve" and "we proudly serve" it needs the city or an area word within 80 characters
  - Rating: "stars" and "out of 5" forms plus a slash form only with a decimal ("4.8/5"); "reviews" and "testimonials" count only in `headings` (and "What our customers say"), never in links or menus
  - Use bounded windows (`[^\n]{0,80}`) where a window is needed; do not add open-ended or lazy regular expressions; existing assertions on `name`, `telephone` and `address` and the property that reading never throws within 200 ms must still hold
  - Example tests in a new file `test/grade-page-facts-reviews.test.js`: each service-area phrase from Requirement 18.2 matches; "serving biscuits", "We serve breakfast all day" and a page with only a street address do not; the city "A++", "Nash|ville", "St. Louis" and an empty city never throw and never pass a page with no service-area words, and "St. Louis" matches "Serving St. Louis and nearby areas"; each review signal type ("Customer reviews" in an h2, "What our customers say", "5.0 stars", "4.9 out of 5", "4.8/5", three or more star symbols, a quoted comment with a name, a link to each Review_Site, `aggregateRating`, `review`); a page with none; a page whose only signal is a "Reviews" menu link fails; "Closed 1/5" and "Open 9/5" fail; links to other sites and non-`https` links are ignored; a footer Facebook link fails and its `/reviews` form passes; a `writereview` link alone fails; `areaServed` read from a string, an object and an array; every new pattern reads a 1 MB adversarial page in under 200 ms
  - _Requirements: 18.2, 18.10, 19.1, 19.10_
- [x] F3. The `reviews-visible` Check and the new Customer basics points
  - In `server/lib/grade-checks.js` set `tap-to-call` 4, `hours-shown` 3, `address-shown` 3, `call-button` 2 and add `reviews-visible` (3 points, `customer_basics`, label "Reviews AI can see") with the pass text, fail text and fix from Requirement 19 (fix at most 160 characters); add it to the text-based Checks; judge it as the design says (`not_checked` for no website, an unreadable page and a script-built page, like the others)
  - Old Grades, one rule (Requirement 19.8 and 19.9): `reportPage` works out `scoreGrade(grade.results)` once per render and uses it for the headline, the "checks need work" line, "Score by area" and every Check row, so the report never mixes the stored and current points; a Grade stored without `reviews-visible` simply does not count it (an old restaurant Grade shows 40 everywhere); code that looks up a Check result by id tolerates a missing result; the stored `grade.score` is still written and is what the lead notice reads (it is sent only for new Grades, so it does not change); the admin Grades list (`grade-admin.js`) works out its score with `scoreGrade(grade.results)` like the report; `recheck` stores `previousScore` only when the earlier results had `reviews-visible` (else `null`), and the "Your score was X before" line shows only when `previousScore` is a number and the results include `reviews-visible`; a Recheck adds the result
  - Add tests (new file `test/grade-old-grades.test.js`): a stored Grade with no `reviews-visible` result shows the same score in the headline, the area lines and the Check rows, before and after the extra questions run; the admin Grades list shows that same score (40 for an old restaurant Grade whose stored score is 42); a Recheck of such a Grade shows no "before" line; a Grade that already had the Check still shows its "before" line
  - Update only the lines listed in the design's "Numbers that change" table: `test/grade-checks.test.js` (`CHECKS.length` 14 to 15, the id-set size 14 to 15, `Object.keys(r).length` 13 to 14, and `goodHtml` gains one quoted comment with a name and a Google reviews link); `test/fixtures/grade/expected.json` (`reviews-visible` for each fixture; `restaurant` 42/5/13 becomes 39/6/14; `roofer` 21/8/13 becomes 19/9/14; `largeCompany` 65/1/13 becomes 65/1/14); `test/fixtures/grade/large-company.html` gains a short review block (three quoted customer comments with first names and dates, and a link to a Google reviews page) that adds no `<h1>`, `<img>`, `tel:` link, JSON-LD block, day-and-time wording or street-address wording
  - Add example tests in `test/grade-checks.test.js` (or a new `test/grade-reviews-check.test.js`): `reviews-visible` passes and fails for each signal type, the fail detail and the fix text read as in Requirement 19, no review wording suggests writing, editing or copying reviews, and the five Customer basics Checks total 15
  - Confirm by hand that `test/grade-score.test.js`, the "stub AI names the business" test in `test/grade-flow.test.js` and `test/design.test.js` need no change
  - _Requirements: 6.7, 19.1, 19.2, 19.3, 19.4, 19.5, 19.7, 19.8, 19.9_
- [x] F4. The no-storefront box, the service-area Check and the preview line
  - `gradeFormPage`: add the checkbox "We go to our customers (no storefront)" with the hint "Check this box if you go to your customers and don't show a street address."; keep it ticked when the form is shown again after a 422; `routes/grade.js`: store `noStorefront: true` only when ticked and nothing otherwise; leave the reuse `key` as it is; the failed page's "Start again" form carries the value
  - `CHECKS` entries may carry a `serviceArea` variant; `checkById(id, input)` merges it when `input.noStorefront` is true; give `address-shown` the variant text from the design, with the fix built from the Grade's own city ("Serving Nashville and nearby areas", "your city" when empty, the example dropped when the sentence would pass 160 characters); `runWebsiteChecks` judges `address-shown` with `serviceAreaPattern(input.city)` or `jsonLd.business.areaServed` in that mode, and as today otherwise; pass the Grade's input wherever a Check label, detail or fix is shown (report rows, "Fix these first", the full report)
  - `previewCard`: with `noStorefront` show "Serves the <city> area" and never "Add your address"
  - Example tests in new `test/grade-no-storefront.test.js`: the form box (present, unticked by default, kept after a 422), the Grade input stores the value only when ticked, the Check passes and fails in both modes (a street address alone fails the service-area mode; a service-area line alone fails the address mode), the service-area fail text and fix never mention a missing address, "We serve breakfast all day" fails the service-area mode, the fix uses the Grade's own city and "your city" for an empty one, a Grade with an 80-character city keeps the variant `fix` at 160 characters or fewer (a new test beside the existing 160-character test in `test/grade-checks.test.js`, which checks only the main fixes today), the preview line, and an unticked Grade giving the same results as before
  - _Requirements: 1.8, 18.1, 18.2, 18.3, 18.4, 18.7, 18.8, 18.9, 18.10_
- [x] F5. Fix kit label and claim for both features
  - `jsonLdBlock(found)` takes `noStorefront`: `areaServed` becomes "<City>, <ST>" and `address` is left out; otherwise unchanged; `grade-html.js` passes the flag from the Grade; the kit never adds `aggregateRating` or `review`
  - The scan stores `found.reviewsLink`: the best of the page's `reviewLinks` (a Google link first, then Yelp, then Facebook or Nextdoor, in page order within each kind), else an empty string; `foundOf` returns an empty string for old Grades
  - `grader.claim`: with `noStorefront`, `address` is empty and `serviceArea` is "<city> and nearby areas" and neither is in `missingFields`; in every case `reviewsLink` is filled from `found.reviewsLink` when it is not empty
  - Example tests: the fix kit label with and without the flag (parses with `JSON.parse`, no raw `<`, no `address` key in the no-storefront label, no review keys ever); the claimed Draft in both modes; the claim fill and the empty case for `reviewsLink`; with a Facebook reviews link and a Google maps link on the same page the claim fills the Google one, and a page with only a footer Facebook link or a `writereview` link fills nothing; a claimed no-storefront Draft rendered as a listing shows the city row, the service area and a business label without `streetAddress` (using the existing listing and schema code, which are not changed)
  - _Requirements: 18.5, 18.6, 19.6, 20.4_
- [x] F6. Show and edit the reviews link
  - `listingDetail` in `server/lib/html.js`: a "Reviews" row with "See our reviews on Google" (or Yelp, Facebook, Nextdoor), only when the stored link passes `reviewsLinkHost` again; no rating, count or review text; listings without the field render exactly as before
  - `routes/rise.js` `fieldsFromForm`, `rise-html.js` and the admin Draft page: the optional "Reviews link" input and row, and the note "We left that link out. It must be an https link to your reviews on Google, Yelp, Facebook or Nextdoor." when a submitted value was left out
  - `server/data.js` `buildListing`: add `reviewsLink` to its own `MODEL_KEYS` list, copied only when it is a non-empty string, so an approved Draft keeps it and other listings gain no key
  - Machine-readable output, each line added only when the field has a value: `llms.js` (a `Reviews: <url>` line), the MCP `summarize` text in `mcp.js` (a link labeled "Reviews"), and `schema.js` (`sameAs` array; the label's `url` stays the listing page); the JSON API and the MCP `get_listing` already return every public key (`publicListing` strips only `ownerEmail`), so they need no code
  - Example tests: the row for each host, escaped output, no row when empty or invalid, no star rating, count or review text anywhere (page, llms.txt, MCP, JSON-LD), the form input and the left-out note, the admin row; an approved Draft with a reviews link publishes it, and one without gains no key; the llms.txt, MCP and JSON-LD output with the field, and exactly the old output without it; confirm that the line-count properties in `test/llms.test.js`, `MODEL_KEYS` in `test/listing-fields.test.js`, and the existing schema, MCP and API tests still pass
  - _Requirements: 20.3, 20.5, 20.6, 20.7_
- [x] F7. Wording pass and full-suite checkpoint
  - Read every new page line and fix text against `wording.md`: American spelling (including "tick", "ticked" and other British wording in page text; words like "ticked" inside the spec are fine), no "YP", no dollar figures, no word "guarantee", nothing that says reviews, a service area or a fix will make an AI assistant name a business; keep "days to weeks" where timing is mentioned
  - Run the banned-word grep (British spellings, "YP", a dollar sign followed by digits, "guarantee") on `grade-html.js`, `fix-kit.js`, `grade-checks.js` and the About page text; add a line to the About page only if the new checks read something new (they read the same home page)
  - Update `README.md` and the About page if they list the checks or the point split
  - Cloud run: the full suite passes, including every test that existed before this section
  - _Requirements: 16.2, 17.4, 18.9, 19.7_

### Feature C: the business's own website (Requirement 21)

- [x] F8. The website validator and the `website` listing field
  - In `server/lib/listing-fields.js`, export `normalizeWebsite(url)` as the design describes: public `https` only; remove one trailing dot from the host first; refuse every IP address (IPv4 and IPv6), `localhost` and `.localhost` names, names with no dot, user names, passwords and ports; keep scheme, host and path only (query string and `#` part dropped); 300 characters at most after that; never throws and never looks anything up on the network
  - `normalizeFields` adds `website` only when the validator returns a value, so the model-key, size-limit and idempotence checks in `test/listing-fields.test.js` hold and the result has no `website` key when the input has none or an invalid one (tests do not expect `{}`); it is never in `missingFields`
  - `server/data.js` `buildListing`: add `website` to its `MODEL_KEYS` list, copied only when it is a non-empty string, so an approved Draft keeps it
  - New test file `test/grade-website-field.test.js` (additions only): valid links; refused `http`, an IPv4 address, an IPv6 address, `localhost`, `https://user:pass@example.com/`, `https://example.com:8443/`, a name with no dot, and a value over 300 characters; a link with a query string and `#` part comes back without them; `https://example.com:443/` comes back as `https://example.com/`; `https://example.com./` comes back as `https://example.com/`; `https://localhost./` and `https://127.0.0.1./` are refused; `validateFields` leaves an invalid value out and keeps a valid one; an approved Draft publishes it
  - _Requirements: 21.1, 21.2, 21.8_
- [x] F9. Show, edit and publish the website
  - `listingDetail` in `server/lib/html.js`: a plain "Website" row linking to the site (host as the text, escaped, `rel="noopener noreferrer"`); nothing when the field is empty
  - `schema.js`: add `sameAs` (the website, then the reviews link, each only when present; the array only when not empty); the label's `url` stays the listing page; `llms.js` and the MCP `summarize` text: a `Website` line or link, only when present; the JSON API and the MCP `get_listing` need no code
  - `routes/rise.js` `fieldsFromForm`, the draft form and review page in `rise-html.js`, and the admin Draft page: the optional "Website" input and row, with the note "We left that website out. It must be the address of your own website, like example.com." when a submitted value was left out
  - Example tests: the listing page row and its escaping; the `sameAs` entry with the website alone, the reviews link alone, both and neither (no `sameAs` key), and `url` unchanged; llms.txt and MCP output with and without the field (the line-count properties in `test/llms.test.js` hold); the form input, the left-out note and the admin row
  - _Requirements: 21.3, 21.4, 21.5, 21.7_
- [x] F10. Claim fills the website; checkpoint for A, B and C
  - `grader.claim`: set `website` to `normalizeWebsite(claimWebsite(grade.input.website))`, where `claimWebsite` rewrites an `http://` address to `https://` with the same host and path and no port, without fetching anything; leave it empty when none was given or it is not valid; no other claim field changes; the owner sees the value on the Draft review page and can change or clear it
  - Example tests: the claim fill from a typed site (a typed address with a query string comes back without it), a typed `http://example.com:8080/menu?x=1` fills `https://example.com/menu`, an empty value, and a value that is not valid
  - Cloud run: the full suite passes, including every test that existed before this section (with only the lines listed in the design's "Numbers that change" table changed)
  - _Requirements: 21.6, 17.4_

### Feature D: let Google and Bing find the main pages (Requirement 22) — approved by the owner on Nov 19, 2026

Approved to build (after F10, and after the Feature G tasks, see the build order below). Read `feature-request-2026-11-18.md`, Feature D, and the design section "Feature D" first.

- [x] F11. Add the main pages to the sitemap
  - Built (Nov 22): the four main pages are listed. `/grade` and `/grade/about` are wired in `routes/sitemap.js` behind `GRADE_PAGES_OPEN = false`, because they still send `noindex, nofollow` and the existing "/grade stays out of sitemap.xml" test in `test/grade-flow.test.js` may change only in F12; F12 turns `GRADE_PAGES_OPEN` on together with the header change and the two test lines the design names
  - `server/lib/sitemap.js`: `generateSitemap(listings, baseUrl, categories, extraPages = [])`; the default keeps every existing output; `server/routes/sitemap.js` passes `/about`, `/privacy` and `/rise`, plus `/verified` only when verification is on (`ctx.trust` is present, the verify router's own condition; V89), plus `/grade` and `/grade/about` when the grader is on, and passes none in demo mode
  - Example tests: the sitemap lists the four pages and the two `/grade` pages and still lists no report, draft or admin address; each listed path returns 200 and no noindex header when requested; with the grader off the two `/grade` pages are not listed; in demo mode no extra pages are listed; `test/sitemap.test.js`, `test/production-samples.test.js`, `test/polish.test.js` and `test/approval.test.js` pass unchanged
  - _Requirements: 22.1, 22.4_
- [x] F12. Open the plain `/grade` form and `/grade/about` to search engines
  - `server/routes/sitemap.js`: set `GRADE_PAGES_OPEN` to `true`, so the sitemap lists `/grade` and `/grade/about` when the grader is on (left off in F11 until these pages are open)
  - `server/routes/grade.js`: the header middleware leaves out `X-Robots-Tag` only for a GET of `/grade` or `/grade/about` with no query string (keeping `Referrer-Policy: no-referrer` and `Cache-Control: no-store`); every other `/grade` response keeps `noindex, nofollow`, including the 422 form, a request with a query string, reports, status JSON, the claim flow, error pages and the grader-off 404
  - `grade-html.js` and the page shell: an `indexable` option used only for those two first renders: no robots meta tag, a canonical link, a plain title and a description (wording rules apply); the 422 re-render never sets it
  - Update only the two existing tests named in the design's Feature D table in `test/grade-flow.test.js`, each with its stated reason; add new tests: `GET /grade` and `GET /grade/about` send no noindex header or meta and have a canonical link and a description; `GET /grade?x=1`, a report, the status JSON, the claim pages, a form shown again with errors and the grader-off 404 still send `noindex, nofollow`, `no-referrer` and `no-store`; no report address, draft or admin address is in the sitemap; llms.txt, MCP and IndexNow still never see `/grade`
  - _Requirements: 9.6, 22.2, 22.3, 22.5_
- [x] F13. Checkpoint for Feature D
  - Banned-word check on the new titles and descriptions; no rate limit or AI budget changed; the full suite passes
  - Done (Nov 22), by reading: the four new texts (the first two since replaced by V92 and V93 with "Can AI find your local business? Free AI Visibility Check | First Answer Pages" and "See whether AI assistants name your local business when someone asks for one like it, and get a score with plain fixes. Free, no sign-up."), "About the AI Visibility Check" and "What the free AI Visibility Check reads on a business's website and asks AI assistants, and why.", have no British spelling, no "YP", no dollar figure, no "guarantee", and no promise that AI will name a business. Feature D changed only `server/lib/sitemap.js`, `server/routes/sitemap.js`, the header middleware and the open-page rendering in `server/routes/grade.js`, and the page shell in `server/lib/grade-html.js`; `server/lib/rate-limiter.js`, `server/lib/ai-budget.js`, every `RULES` entry and every limit or budget call are unchanged. Full suite: 1396 of 1396 in the cloud, twice, after F12 with its test fix and M1
  - _Requirements: 16.2, 17.4, 22.4_

## Owner decisions of Nov 19 (`feature-request-2026-11-19.md`)

Approved by the owner on Nov 19, 2026. Task names: **G1 to G7** for Feature G (bot protection, Requirement 25), **E1 to E4** for Feature E (ask Claude three times, Requirement 23), **W1 and W2** for Feature F (the question's wording, Requirement 24), so none collides with F1 to F13. **Build order: G1 to G7 first, then F1 to F13 (Feature D is approved), then E1 to E4, then W1 and W2.** The same rules apply as above: no shell commands, tests are run in the cloud, add tests only, follow `wording.md` and `grader-safety.md` (plain words, American spelling, never promise AI will name a business, never log a token, a secret, typed input or an owner's details). New tests use fake verifiers, fake notifiers, fake assistants and a fake clock; no real AI, no real network.

### Feature G: stop bots from running checks over and over (Requirement 25)

- [x] G1. The per-network limit
  - `server/lib/network-key.js`: `networkKey(ip)` (IPv4 first three parts; IPv6 first four groups, expanded, lower case, no leading zeros; an IPv4 address inside an IPv6 one gives the IPv4 network; a non-address gives the string itself)
  - `rate-limiter.js`: `RULES['grade-network']` (20 a day); `config.js`: `gradeNetworkPerDay` from `GRADE_NETWORK_PER_DAY` (positive whole number, default 20, warns without echoing); `POST /grade` adds the network rule to the existing `consumeAll([...])` (peeking the network rule first to know which rule refused); a network refusal is 429 with `Retry-After` and its own message ("A lot of checks have come from your network today. Please try again tomorrow, or from another connection."), counted apart from an address refusal; README and `render.yaml` list the setting, and the README says that behind Cloudflare's proxy `TRUST_PROXY` must be 2
  - Tests (new `test/grade-guard.test.js`): `networkKey` examples (IPv4, IPv6, IPv4-mapped, junk); the 21st check in a day from one `/24` (and one IPv6 `/64`) is turned away with 429 and `Retry-After`, a different network is not, and the per-address limits still apply; `GRADE_NETWORK_PER_DAY` is read as described and a lower value is honored
  - _Requirements: 25.4, 25.10_
- [x] G2. The human check (Cloudflare Turnstile), off until the keys are set
  - `server/lib/turnstile.js` (`createTurnstile`, `verify` giving `ok`, `failed`, `unreachable` or `misconfigured`; fixed address, no redirects, 5-second limit; never logs the token or the secret); `config.js` keys `turnstileSiteKey` and `turnstileSecretKey`; `app.js` `ctx.turnstile` (injectable as `deps.turnstile`)
  - `gradeFormPage`: the widget, the script (through `head`) and the `<noscript>` line only when the site key is set; `POST /grade`: verify after the form checks and before the rate limits, any AI call and any website fetch; a failed or missing token gives status 422 and "Please try again: we couldn't confirm you're a person." with the entries kept; `unreachable` lets the check through
  - Privacy page sentence (shown only when the check is on); README and `render.yaml` (`sync: false`) list both keys; Content Security Policy unchanged now (the site sends only `frame-ancestors 'none'`)
  - Tests: with keys set, a missing or bad token blocks the check before any AI call or fetch (the fake assistant and fake fetcher are never called) and a good token runs it; without keys, the form has no widget and everything behaves as today (existing tests unchanged); an unreachable verifier lets the check through; each of the codes `invalid-input-secret`, `missing-input-secret` and `internal-error` lets the check through and logs `turnstile=misconfigured` without the secret (one test per code), while `invalid-input-response` and `timeout-or-duplicate` turn it away; the 422 text includes "If no box appears, turn off ad blockers or try another browser."; the "Start again" form on the failed page carries the widget, script and `<noscript>` line when the check is on and none when it is off; a failed human check uses none of the per-address counts; the form page's `Content-Security-Policy` header is still `frame-ancestors 'none'`; the privacy sentence shows only with the check on; nothing logs a token or a secret (capture `stderr`)
  - _Requirements: 1.9, 25.1, 25.2, 25.3, 25.8, 25.9_
- [x] G3. Day counters in the AI budget and the guard
  - `ai-budget.js`: `usage({ kind: 'grade' })`, `note(name)`, `notes()` and `once(name)`, kept with the day logic and written to `ai-budget.json` as a `notes` object only when not empty (existing files stay byte-identical); the counts are `checks`, `humanPass`, `human`, `limit` and `network`; `loadCounts` ignores a missing or malformed `notes` and keeps the day's spending counts; `server/lib/grade-guard.js` with `turnedAway(kind)`, `passed()`, `summary()` and `watch()` (wired after each counted AI call, including Google's live answer, and after each new Grade); every per-address refusal in `POST /grade` counts `limit`, every per-network refusal `network`, every failed human check `human`, every pass `humanPass`, every started Grade `checks`
  - Tests: the counters reset on a new Chicago day and survive a restart the same day; `once` is true once per day; an old budget file without `notes` loads; a budget file whose `notes` is a string (or an array) loads and keeps today's `total`, `photo` and `grade` counts; the honeypot and the form timer are not counted
  - _Requirements: 25.5_
- [x] G4. The 50% and 90% heads-up emails
  - `notifier.js`: `notifyAllowance({ percent, used, left, limit, checks })` on the mock, console, none and Resend notifiers (the Resend one emails `ADMIN_EMAIL` only, subject "AI Visibility Check: <percent>% of today's AI calls used", counts only; never throws); `watch()` works out the share as used ÷ (used + left) (nothing is sent when used + left is 0), sends each threshold once per day, reads the `checks` counter from the budget's notes (never `grades.json`), and sends one "The human check may be set up wrong" email a day when `human >= 10` and `humanPass === 0` (counts only; the check is never switched off by itself); that rule also runs from `turnedAway('human')`, because a lockout starts no AI call and no Grade, so `watch()` would never run; with `NOTIFIER` unset nothing is sent
  - Tests: the thresholds use used ÷ (used + left) (a case where the shared caps hold `left` down still sends the 90% email); a grades file with thousands of Grades is never read by `watch()`; the "set up wrong" email is sent once a day, and 10 refusals by the human check with no passes send it once with no AI call and no Grade started; the 50% and 90% emails are sent once each per day (a fake clock moves to the next day and they can send again); the email has counts only (no business name, owner's name, email, phone or answer); a notifier that throws or is slow does not stop a check; with the allowance at 0 nothing is sent
  - _Requirements: 25.6_
- [x] G5. The admin Grades page counts
  - `grade-admin.js` shows, above the list: "Human check: on", "off (no Turnstile keys)" or "on, but Cloudflare reported a problem (wrong secret key or an error on its side); checks are let through"; "Heads-up emails: on" or "off (no email service set)"; "Today: <used> AI calls used, <left> left. <n> checks run."; and on separate lines today's human-check passes and refusals, per-address refusals and per-network refusals; the existing admin tests keep passing
  - Tests: the block shows the setup lines (each state) and the counts after a few checks, a failed human check, a refused address and a refused network; it is behind the admin login like the rest
  - _Requirements: 25.7_
- [x] G6. Checkpoint for Feature G
  - Banned-word check on every new page line (wording rules); a test that captures `stderr` during a full check with a fake token and secret and asserts neither appears, and no owner's details; the full suite passes (existing tests unchanged)
  - Owner step (not code): right after Colby pastes the two keys into Render, Colby and Claude run one real check in a normal browser on the live site. If it fails, deleting either key in Render turns the check off and the site works as before. That same check shows whether `Referrer-Policy: no-referrer` matters to the widget
  - _Requirements: 16.2, 17.4, 25.2, 25.6, 25.11_
- [x] G7. Cap Google's live answer
  - `POST /grade/:id/google-live` allows at most 3 live answers per Grade in total, counted on the stored Grade (`liveAnswers`): the budget's `consume` is called first, and only when it succeeds is `liveAnswers` checked and raised inside one `grades().update` (a count already at 3 refunds the call and answers 429), so two requests at once cannot make 4, a refused budget call does not use one of the owner's 3, and a call that then fails at Google still counts; the 4th is refused with status 429 and "You've seen Google's live answer 3 times for this report. Run a new check to see it again."; the "Show Google's live answer" button is hidden once 3 are used; the hourly rules stay as they are; `watch()` is called after the live answer's `consume`
  - Tests: the 4th live answer on the same Grade is refused with that message, even hours later and after a new app on the same data directory; the 1st to 3rd are allowed; two requests at the same moment with the count at 2 give one 200 and one 429; a request the budget refuses does not use one of the 3; a call that fails at Google still counts; the button is hidden after 3; the live answer calls `watch()`; the existing live-answer tests pass unchanged
  - _Requirements: 25.10_

### Feature E: ask Claude three times (Requirement 23) — build after F1 to F13

- [x] E1. The setting and the tests' default
  - `config.js`: `gradeMainAsks` from `GRADE_MAIN_ASKS` (1 to 3, default 3, warns without echoing the value); README lists it; add `gradeMainAsks: 1` to the default config of `startEnv` in `test/grade-flow.test.js`, `test/grade-lead.test.js`, `test/grade-review-fixes.test.js` and `test/grade-load.test.js` (one property each, no assertion changes), and search `test/` for any other file that starts a Grade and do the same
  - Tests: the setting is read as described (unset, 1, 2, 3, 0, 4, "x")
  - _Requirements: 23.9_
- [x] E2. Ask three times, with the reserve rule
  - `askQuestion` gains `asks` (the free question passes `config.gradeMainAsks`; the extra questions pass 1); the first ask as today, asks 2 and up only while more than 12 of the Grader's calls remain (0 left: the check still runs and only the AI part is skipped, as today; 13 left makes 1 ask, 14 left 2, 15 or more 3; with 15 or fewer left the second opinions are skipped); a resend inside an ask (`consumeExtra`) is made for asks 2 and up only while more than 12 remain, and the `consumeExtra` wrapper for asks 2 and up sets a flag when it refuses so the grader drops that ask's result (it counts as not run, because its text is usually a preamble that would score "not named"); all asks start together; the demo assistant is asked once; entries carry `ask` when more than one was planned; returns `planned` and `asked`; the scan step finding says "Asked Claude 3 times and got 2 answers." (and "Asked Claude 2 times, not 3, because we reached today's limit. Got 2 answers." when the allowance cut it short; wording from V103); `reusableAnswers` copies only answers whose prompt is the new Grade's free question or one of its two extra questions
  - Tests (new `test/grade-main-asks.test.js`, `gradeMainAsks: 3`): "named, named, not named" gives 20 of 30 points and "named your business in 2 of 3 answers"; one ask that fails (with "named" and "not named" from the others) gives "1 of 2" and 15 of 30 with no penalty for the failure; all three failing gives `ai-named` not checked and a partial score; `GRADE_MAIN_ASKS=1` behaves exactly as today (one call, one entry, no `ask` field); the allowance is charged 3 times; each reserve number is pinned in its own test (0 left still runs the check with the AI part skipped and a partial score, 13 left makes 1 ask, 14 left 2, 15 or more 3, second opinions skipped at 15 or fewer) and the finding says how many were asked and answered; a fake Claude that needs a resend resends for ask 1 as today and for asks 2 and 3 only while more than 12 calls remain, and with 12 or fewer left a refused resend makes that ask count as not run (the score is not lowered); a fake 429 on one ask is retried once and refunded if it ends in 429; carried-over answers mean no new asks, and answers to a differently worded question ("…HVAC Repair…") are not carried over and not counted beside the new asks; the demo assistant is asked once; second opinions are still asked once
  - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.6, 23.7, 23.8_
- [x] E3. The report
  - `aiFree`: the free answers are the main answers whose prompt equals the first main answer's prompt (never a comparison with `freeQuestion(input)`); the lead line ("We just asked Claude 3 times. Claude named your business in 2 of 3 answers" or "in none of 3 answers"; with fewer answers than asks "…3 times and got 2 answers. Claude named your business in 1 of the 2.", V100), the ranked list and outcome from the first answer that named the business (else the first) with "This list is from answer 1, the first one that named you." (V102) numbered among the answers that came back, and one closed "See Claude's answers" block with each answer labeled; "Every answer" labels each main answer "answer 2 of 3"; one answer per question renders exactly as before
  - `answersSection` counts distinct questions, not answers ("We asked Claude, ChatGPT and Grok the same 3 questions. Claude was asked the first one 3 times."; with only the free question, "Claude was asked it 3 times."), and a carried group reads "We asked Claude 3 times on Nov 19."; the about page says the first question is asked up to 3 times (Requirement 16.3)
  - Tests: the report texts above, each answer opens, V38 and V52 rules apply to the shown answer, a Grade with one answer per question looks as before, an older Grade whose prompt differs from today's wording (and the data in `test/grade-report-list.test.js`) still shows its answers and not "We couldn't ask AI", the answers section says "the same 3 questions" after unlocking (not 5), "answer 1 of 2" and "answer 2 of 2" when ask 1 failed, the about page sentence is pinned, and everything is escaped
  - _Requirements: 23.5, 23.6, 23.10_
- [x] E4. Checkpoint for Feature E
  - Wording check (no promise that more answers will make an AI name the business); the full suite passes with only the one-line config additions of E1 in existing test files
  - _Requirements: 16.2, 17.4, 23.10_

### Feature F: the question reads naturally (Requirement 24) — build after Feature E

- [x] W1. The cleaned service phrase
  - `grader.js`: export `servicePhrase(service)` returning `{ named }` (as revised by V111 to V117: spaces trimmed and collapsed and trailing punctuation removed; all-capitals words of 5 or more letters lowered, shorter ones and ones with a slash, digit or "&" kept; a Title Case phrase lowered word by word, otherwise the first word, except words with a capital inside, nationality and cuisine words and "Dr."; a fixed list of abbreviations raised (A/C, HVAC, CPA, DJ, BBQ, RV, "IT support"); the last word follows the fixed lists in the design ("business", the not-a-plural "s" words, "s", "es", "ies", handymen, "ist", "ician" and five "-ian" words), anything else gets " businesses"; no general "-er", "-or" or "-ian" rule); all three questions and `stepNames` use `named`: "Who are the best … ? Name your top 5.", "I'm looking for … Which ones would you recommend?", "Which … do people recommend most?"; the stored input keeps the typed service
  - Tests (`test/grade-question.test.js`): every row of both design tables (the 15 and the 30 services, the 30 with their exact three questions), each rule and list entry, "water heater", "garage door" and "computer" get "businesses", no "-ian" plural for Italian and the other cuisine and people words, trailing punctuation, already clean services give exactly today's free question and scan step, the N2 tests ("PLUMBERS" equals "plumbers"; HVAC, A/C, CPA, DJ, IT support, BBQ keep their capitals), and the stored input and the report show the typed text; existing tests that pin an already clean service ("plumbers", "accountants") pass unchanged
  - V118: `suggestedTitle` in `fix-kit.js` never cuts the service mid-phrase: the whole service with the state, else the city and state without the service, else the city, else the name; one test in `test/grade-fix-kit.test.js`
  - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_
- [ ] W2. Checkpoint for Feature F
  - Search `test/` again for any test that pins a question or the scan step with a service that is not clean, and list it with its reason before changing anything (none expected); the full suite passes
  - _Requirements: 17.4, 24.5_
