# Design: monthly watch

## What exists today (read before building)
- `server/lib/grader.js`: `createGrader` has `askQuestion` (budget, retry, deadline, second opinions, `readAnswer`), `recheck(id)` (website only, no AI), `repeatCheck(rawInput)` (the `GRADE_AI_REPEAT_DAYS` rule), `listingInfoFor(input)` (claimed or Verified listing), `freeAnswersOf`, `aiNamedResult`. Grades are deleted after 90 days (`GRADE_RETENTION_DAYS`), so a watch cannot live inside a Grade.
- `server/lib/notifier.js`: Resend notifier sends to the admin only (`sendToAdmin`). There is no email to an owner except a quote's `ownerEmail`. There is no timer or scheduler anywhere in `server/`.
- `render.yaml`: one web service on a persistent disk, so an in-process timer is the only scheduler (a separate Render Cron Job could not share the disk).
- `server/data.js`: collections are an allow-list (`COLLECTIONS`). `server/lib/rate-limiter.js` holds `RULES`.
- `server/lib/agency-report.js`: `answersOf`, `shareOfVoice` (names and counts). Not changed.

## Files that change
| File | Change |
|---|---|
| `server/lib/config.js` | Parse `WATCH_ENABLED`, `WATCH_MAX_PER_DAY`, `WATCH_MAX_ACTIVE` the way `parseGradeAiRepeatDays` does (warn, fall back). Add to the config object. |
| `server/data.js` | Add `'watches'` to `COLLECTIONS`. Nothing else. |
| `server/lib/rate-limiter.js` | Add `watch-start` and `watch-manage` to `RULES`. |
| `server/lib/watch.js` (new) | Pure helpers: `newWatch`, `dueWatches`, `addReading`, `confirmedChange`, `maskEmail`, `cleanNames`. No I/O. |
| `server/lib/watch-service.js` (new) | `createWatchService({ store, grader, aiBudget, notifier, clock, newId, config, log })`: `start`, `confirm`, `stop`, `get`, `runDue`. Owns the timer logic, not the timer. |
| `server/lib/watch-html.js` (new) | The opt-in block for the report, the watch page, the confirm and stop pages, the email text builders. All text escaped with `escapeHtml`. |
| `server/routes/watch.js` (new) | `GET /watch/:id`, `POST /grade/:id/watch` (start), `GET /watch/:id/confirm` and `POST /watch/:id/confirm`, `GET /watch/:id/stop` and `POST /watch/:id/stop`. Mounted in `server/app.js` next to the grade router. |
| `server/lib/grader.js` | Additions only: a returned method `readFree(input)` (asks the free question once via the existing `askQuestion` and returns `{ named, position, total, competitors, state }`) and `watchEligible(id)`. Nothing inside `askQuestion`, `askWithRetry`, the second-opinion loop or `run` is edited. |
| `server/lib/notifier.js` | Add `sendToOwner({ to, subject, text, headers })` to the Resend notifier, and a matching no-op on the none, console and mock notifiers. Same time limit and "never throws" rule as `sendToAdmin`. |
| `server/lib/grade-html.js` | One call in `reportPage` after `recheckBlock`: `watchBlock(grade, opts)` imported from `watch-html.js`. No other edit. |
| `server/app.js` | Build `ctx.watch`, mount the router, start the hourly timer (`setInterval(..., 3600000).unref()`) only when `WATCH_ENABLED=on` and not a test run. Catch every tick with a `.catch` that logs the watch id only. |
| `README.md` | New settings table rows; one paragraph under "AI Visibility Grader". |
| `.kiro/steering/structure.md`, `tech.md` | Add `watches` to the allow-listed collections. |

## The second-opinion rule, kept
`readFree` must not turn off second opinions by editing `askQuestion`. Build it on a second grader instance made in `server/app.js`: `createGrader({ ...same deps, extraAssistants: [] })`, used only for `readFree`. With no extra assistants the second-opinion loop has nothing to do. The first instance, its second opinions and its progress code are untouched. (If the Kiro agent finds this does not work, stop and ask; do not edit the second-opinion code.)

## Data stored: `watches.json`, one record per watch
```
{ id (22 random chars), gradeId, input: { name, city, state, service, website, about? },
  email | null, status: 'pending' | 'active' | 'paused',
  confirmToken, stopToken (random, 24 bytes base64url each), createdAt, confirmedAt | null,
  nextDueAt, retries, lastCheckedAt, lastChangeAt | null, sendFailures,
  readings: [ { at, named, position | null, total, competitors: [<=5 names], source: 'report' | 'ask' | 'reused' | 'none' } ]  // newest last, kept to 12
}
```
Stopping deletes the record. A `pending` record that is not confirmed in 7 days is deleted by the hourly run. No answer text, no question text, no IP.

## Flow
1. Report (full access, watch on, eligible): `watchBlock` shows the form. POST `/grade/:id/watch` checks the form stamp and rate limit like `unlock`, validates email with `normalizeEmail`, calls `service.start`. First reading is built from `freeAnswersOf(grade.ai)` (named if any main answer named it). Redirect to `/watch/<id>`. With an email, `status: 'pending'` and a confirm email goes out; without, `active`.
2. Hourly `runDue(now)`: stop if `aiBudget.peek({kind:'grade'}).remaining <= 25` or today's watch readings (counted in `aiBudget` notes, key `watchRuns`, day-scoped like the guard's counters) reached `WATCH_MAX_PER_DAY`. Take due `active` watches oldest first. For each: look for a reusable full-check answer from the last `gradeAiRepeatDays` days (same `sameBusinessInput`, same `about`); else `readFree`. Add the reading. If it differs from the one before, `readFree` once more; keep the change only if the two agree. Save, then send the alert if there is a change.
3. Email through `notifier.sendToOwner`, with `List-Unsubscribe: <https://…/watch/<id>/stop?t=<stopToken>>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. URLs come from `config.baseUrl` (never the request's Host; see `base-url.js`).

## Email text (plain text, no HTML)
Subject: `AI did not name {name} this month` or `AI named {name} this month`. Body in short lines: the change; "We asked: {question}"; "AI named instead: {up to 5 names}" (or "AI named: ..." for the start case); the snapshot line; the watch page link; the stop link; the contact address from `CONTACT_EMAIL` when set. Control characters and line breaks are stripped from every inserted value.

## Test plan (new files, node:test and fast-check, no network)
- `test/watch-config.test.js`: the three settings, defaults, bad values warn, test run default off.
- `test/watch-logic.test.js`: `dueWatches` (30 days, `GRADE_AI_REPEAT_DAYS` larger than 30), `confirmedChange` (two agreeing answers; disagreeing answers give no change), cap of 12 readings, `maskEmail`, `cleanNames` (property: no control characters, at most 80 code points, at most 5).
- `test/watch-service.test.js`: fake clock, fake `readFree`, real `createAiBudget`. Never runs at 25 or fewer calls left; stops at `WATCH_MAX_PER_DAY`; reuses a fresh full-check answer and asks nothing; retry for 3 days then "couldn't check"; start and stop deletes the email; pending watch deleted after 7 days; 3 failed sends pause it.
- `test/watch-routes.test.js` (through `createApp`): off means 404; not eligible means no form; eligible shows the form; GET confirm and GET stop change nothing; POST does; one-click POST stops; every page is noindex, no-store, no-referrer; an `about` or competitor name with `<script>` is escaped; page and email never contain a promise (search for "will name", "guarantee", "$").
- `test/watch-notifier.test.js`: `sendToOwner` on each notifier; Resend call has the unsubscribe headers; failure returns `sent: false` and never throws; key never in a result.
- Log test: capture stderr during a full run; assert no business name, email, question or answer appears.

## Existing tests that may need changes
- `test/data-dir.test.js`, `test/json-file.test.js` and any test that lists the data store's collections or files: a new `watches.json` name.
- `test/rate-limiter.test.js` if it checks the exact `RULES` keys.
- `test/ai-config.test.js` and `test/grade-main-asks-setting.test.js` only if they assert the whole config object.
- `test/notifier-resend.test.js` and `test/grade-alerts.test.js` if they assert the exact method list of a notifier (the none, console and mock notifiers gain `sendToOwner`).
- `test/grade-flow.test.js`, `test/grade-lead.test.js`: only if they assert the exact end of the full report (the watch block sits after the recheck block, and shows nothing when the setting is off, so they should not change).
Run the whole suite in the cloud and compare with the known older failures; list any test line changed.

## Risks
- Share of the daily allowance: 200 watches is about 7 reads a day plus confirms; `WATCH_MAX_PER_DAY` and the 25-call floor keep owners' new checks first.
- AI variance: the confirm ask removes most false alarms but not all. The wording says "this time" and "one snapshot".
- A single instance and a persistent disk are assumed (as in `render.yaml`). Two instances would double-run; the hourly run reads and writes through the store lock `watch-run`, and a record's `nextDueAt` moves before the ask starts, so a second run skips it.
- Email needs a verified Resend domain and `NOTIFY_FROM`; the sender name currently reads like "Quotes". See the open questions.
- Postal address in email footers (CAN-SPAM) is not in config today.
