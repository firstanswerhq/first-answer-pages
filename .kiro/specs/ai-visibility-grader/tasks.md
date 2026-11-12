# Implementation Plan: AI Visibility Grader

## Overview

Plain JavaScript ES modules on Node 22 and plain Express, on top of the finished `super-pages` build. The plan builds the pure pieces first (address guard, safe fetcher, page reading, robots reading, checks, score, name matching, fix kit), then the grader flow and storage, then the pages and routes, then the lead gate, claim, recheck and admin, and ends with fixtures, the README and a full-suite checkpoint.

Property tests for the address guard, the score, name matching and the fix kit are required; the other property tests are optional sub-tasks marked `*`.

Contest cut, in build order: (A) tasks 0 to 8 plus 9.2 and 10.1 give the full demo path; (B) 9.1 with one AI question, 9.3, 9.4, 10.2 and 10.3; (C) leave for last: the two extra AI questions, reuse of earlier AI results, the llms.txt draft and robots lines in the fix kit, and brotli. Every test uses `node:test` and `fast-check`, lives in `test/`, uses a temporary `DATA_DIR`, injects fakes for the network, DNS, clock, AI provider and notifier, and makes no network calls. Checkpoints run `node --test`.

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
  - [x]* 1.4 Write property and example tests for the safe fetcher
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
    - Add `grade` (5 per hour), `grade-day` (20 per day), `grade-unlock` (5 per hour) and `grade-recheck` (10 per hour) to the rate limiter's `RULES`
    - _Requirements: 12.4, 13.3, 14.1, 14.2_

  - [x] 5.6 Add `roofers` ("Roofers") and `hvac` ("Heating and Air") to `data/categories.json`, with Seance phrases, and teach `mapCategory` common service words (roofing, roofer, hvac, heating, air conditioning) so a graded roofer's draft is not filed under Other
    - _Requirements: 10.3_

- [ ] 6. The grader flow
  - [ ] 6.1 Create `server/lib/grader.js`
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

- [ ] 7. Pages and public routes
  - [ ] 7.1 Create `server/lib/grade-html.js`
    - `gradeFormPage({ values, errors, stamp, categories })`: headline asking whether AI can find the business, five fields, category suggestions through a `datalist`, honeypot and stamp, no email or phone field
    - `scanPage(grade)`: Scan_Steps with done, running and waiting marks; refresh meta tag
    - `reportPage(grade, { unlocked, leadGate, contactEmail, demo })`: Free_Part (score or "Not enough to score yet", "<failed> of <counted> checks failed", the AI sentence and escaped answer, Free_Page_Preview with "Add your <field>" blanks and the claim button, Google before-and-after preview, group lines, "Automated check" date in Central time, the "days to weeks" line, the removal line); Lead_Form or Full_Report (every Check with detail, points and fix; Fix_Kit in `<pre>` blocks; "Check again"; the First Answer offer line)
    - `failedPage(grade)` with a start-again button; `aboutPage()`
    - Use `layout()`, `escapeHtml` on every value, plain words, American spelling, no dollar figures
    - _Requirements: 1.1, 1.3, 1.4, 2.3, 7.5, 7.6, 7.9, 9.1, 9.2, 9.3, 9.4, 9.8, 10.1, 10.6, 11.6, 11.7, 16.1, 16.2_
  - [ ] 7.2 Create `server/routes/grade.js` and mount it in `createApp`
    - `GET /grade`, `POST /grade` (validation, website normalization to `https://<host>/`, honeypot, stamp, rate limits, 303), `GET /grade/about`, `GET /grade/:id`, `GET /grade/:id/status.json`
    - Reject malformed ids with 404 before reading the store
    - Send `X-Robots-Tag: noindex, nofollow` and `Referrer-Policy: no-referrer` on every `/grade` response
    - Return 404 for every `/grade` path when `GRADER_ENABLED` is `off`
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 2.1, 2.3, 9.5, 9.7, 14.2_
  - [ ] 7.3 Create `public/js/grade.js`
    - Poll `status.json` at most once a second while running and swap in the report; copy buttons using `navigator.clipboard` with a select-text fallback; the page works fully without it
    - _Requirements: 2.4, 11.6_
  - [ ] 7.4 Keep `/grade` out of `sitemap.xml`, `llms.txt`, the MCP tools and IndexNow, and add a plain link to `/grade` on the home page
    - _Requirements: 9.6_
  - [ ]* 7.5 Write example tests for the pages and routes
    - Form 422s for each bad field, honeypot and too-fast stamp; 303 and Grade stored; refresh tag while running; report sections; noindex headers; 404 for unknown and malformed ids; sitemap and llms.txt free of `/grade`; no "Yellow Pages" or "YP" in any Grader page
    - **Validates: Requirements 1.1 to 1.7, 2.3, 9.1 to 9.8, 16.2**

- [ ] 8. Checkpoint: grade a fixture end to end
  - Run `node --test`, including flow tests that grade each fixture end to end through `createApp` with a fake transport serving the fixture pages and the mock AI provider. The safe fetcher's address rules are never loosened for tests or local runs. Ask the user if questions arise.

- [ ] 9. Lead gate, claim, recheck and admin
  - [ ] 9.1 Lead form and unlock
    - `POST /grade/:id/unlock`: validate name, email and phone (existing normalizers); store the Lead; set the signed `g_<id>` cookie; run the two extra AI_Questions in the background and recompute the Score; notify the site owner with business name, score and report link only; 303 to the report
    - `GRADER_LEAD_GATE=off`: show the Full_Report to all and run the extra questions on the first view, subject to the budget
    - Add `notifyLead({ business, score, reportUrl })` to the mock, console, none and Resend notifiers as designed (Resend sends to `ADMIN_EMAIL` only; never throws)
    - _Requirements: 7.2, 7.6, 8.3, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - [ ] 9.2 Claim the free page
    - `POST /grade/:id/claim`: reuse an existing Draft when `draftId` points to one; else build fields (JSON-LD first, then tel links and text; phone through `normalizePhone`; category through `mapCategory` with `other` as fallback; service as the first service; city and state from the input) and call `draftStore.create` with `missingFields`; store `draftId`; 303 to `/rise/drafts/:draftId`
    - _Requirements: 10.2, 10.3, 10.4, 10.5_
  - [ ] 9.3 Check again
    - `POST /grade/:id/recheck`: website steps only, AI results kept, `previousScore` stored, one per Grade every 2 minutes and 10 per client per hour
    - _Requirements: 13.1, 13.2, 13.3_
  - [ ] 9.4 Admin pages
    - `GET /admin/grades`, `GET /admin/leads` (newest 100), `POST /admin/grades/:id/delete` (Grade and its Leads), all behind `requireAdmin`
    - _Requirements: 15.1, 15.2, 15.3, 15.4_
  - [ ]* 9.5 Write example tests for unlock, claim, recheck and admin
    - Gate on: Lead_Form shown, unlock stores one Lead, sets the cookie, shows the Full_Report only to that visitor; gate off: Full_Report for all
    - Claim twice creates one Draft and redirects to it; the Draft is not published
    - Recheck inside 2 minutes answers 429; recheck keeps AI results
    - Admin pages refuse without login; delete makes the report 404
    - **Validates: Requirements 10.3, 10.4, 10.5, 12.2, 12.6, 13.2, 13.3, 15.3, 15.4**

- [ ] 10. Fixtures, README and final checkpoint
  - [ ] 10.1 Add `test/fixtures/grade/` with three saved home pages (restaurant with slider headlines, roofer with JSON-LD that fails to parse, large company with several JSON-LD blocks), personal details replaced, plus expected Page_Facts and Check_Results; add example tests that read each fixture
    - _Requirements: 17.3_
  - [ ] 10.2 Update the README: what the Grader does, the four settings, how the AI cap is shared, how to turn the lead gate off for judges, and where leads appear
  - [ ] 10.3 Final checkpoint: run `node --test`; every test passes, including every test from earlier specs. Ask the user if questions arise.
    - _Requirements: 17.1, 17.2, 17.4_
