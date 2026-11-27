# Design: fix pack

## What exists today (read before building)
- `server/lib/fix-kit.js`: `clean(found)`, `suggestedTitle`, `suggestedSummary`, `jsonLdBlock(found, { placeholders })`, `llmsDraft`, `robotsLines`, `cutAtWord`, `serviceInSentence`, `place`. The kit's `found` object is built in `fixKit()` in `server/lib/grade-html.js` (name, service, city, state, phone, website, address, hours, plus `noStorefront` and `sameAs` for the label).
- `foundOf(grade)` in `server/lib/grader.js` gives the phone, hours, address and reviews link the site really showed. `profileLinks(grade)` in `grade-html.js` gives the owner's own profile links.
- `grade.input.about` (owner-describes-business spec) is the owner's own words. It is already stored and escaped on pages.
- The Copy button is wired in `public/js/grade.js` for any `.copy-btn[data-copy]` whose target id exists. Read only; do not edit.
- `server/routes/grade.js`: `fullAccess(req, grade)` and the `data.csv` route are the pattern for the download.

## Files that change
| File | Change |
|---|---|
| `server/lib/fix-kit.js` | Add exports `gbpDescription(found)`, `faqPairs(found)`, `faqText(pairs)`, `faqJsonLd(pairs)`, `fixPackText(found)`. New code only; no existing function is edited. `clean()` is reused and gains no new field except it must pass `about` through: add a small local `cleanAbout` instead of changing `clean()`. |
| `server/lib/grade-html.js` | New `fixPack(grade, contactEmail)` next to `fixKit`, called in `reportPage` right after `fixKit(...)` inside `fullPart`. Reuses the kit's box markup (`kit-item`, `<pre id>`, `copy-btn`). New ids: `pack-gbp`, `pack-faq`, `pack-faq-json`, `pack-all`. |
| `server/routes/grade.js` | New `GET /grade/:id/fix-pack.txt`, a copy of the `data.csv` route with `fixPackText`. Add the line to the route list in the file header. |
| `public/css/style.css` | Only if a rule is missing; the boxes reuse `.kit-item`. |
| `README.md` | One row in the routes table; one sentence in the Grade section. |

## How it fits the grade flow
Nothing runs during a check. The pack is built when the report page is rendered, from the stored Grade, like the kit. No new data is stored. The scan, the score, the answers and the second opinions are not read or changed.

## The facts object
```
pack = { name, service, city, state, about, phone, website, address, hours (readableHours), noStorefront, sameAs }
```
`phone`, `address`, `hours` come from `foundOf(grade)` and are empty when the site showed none. Hours use `readableHours(found.hours)` (text for people), not `schemaHours`.

## Builders (all pure, all in code points)
- `gbpDescription`: sentence 1 is `about` when it has no web address, email or 7+ digits in a row (trimmed, one terminal `.` added only if it ends in a letter or digit), else `{Name} offers {service in sentence}.` using `serviceInSentence`. Sentence 2 is the place sentence. `cutAtWord(text, 750)`. A final check removes nothing silently: if the text would contain `http`, `www.` or 7 or more digits in a row, those facts were never put in, so the check is a test, not a filter.
- `faqPairs`: the five fixed questions from requirement 5, in order, each only when its fact is present. Question text is a constant table in the code. An answer is `{fact sentence}` built with a template; `about` is quoted as typed.
- `faqJsonLd`: `{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}}]}`; `JSON.stringify(..., null, 2).replace(/</g, '\\u003c')` inside a `<script type="application/ld+json">` wrapper, as `jsonLdBlock` does.
- `fixPackText`: three headed parts separated by blank lines; the JSON-LD part is included only when `faqPairs` has 2 or more pairs.

## Test plan
- `test/grade-fix-pack.test.js` (node:test, fast-check, same `found` generators as `test/grade-fix-kit.test.js`):
  - GBP description at most 750 code points; never ends mid-word; no `http`, `www`, `@`; no 7 or more digits in a row; with `about`, the first sentence equals the typed words.
  - Property: every word with a digit or capital in an output comes from the input facts or the fixed templates (no invented fact). A banned-words test: none of "licensed", "insured", "free estimate", "24/7", "emergency", "award", "guarantee", "best", "#1" appear unless the owner typed it in `about`.
  - Missing facts: no phone means no contact pair; no hours means no hours pair; fewer than 2 pairs gives the "add this first" sentence and no markup.
  - JSON-LD parses with `JSON.parse` after the wrapper is removed; contains no `<` characters; its questions and answers equal the FAQ text pairs one for one.
  - No-storefront Grade: no street address anywhere in the pack.
  - Page: `reportPage` full access has the four box ids and Copy buttons; locked report has none; text with `<script>` in the name or `about` is escaped.
  - Route: `/fix-pack.txt` 303s without access, returns `text/plain` with `Content-Disposition` with access, and has no HTML tags.
  - Existing exports: `suggestedTitle`, `suggestedSummary`, `jsonLdBlock`, `llmsDraft`, `robotsLines` return what they returned before for the same input (snapshot a few cases in the test).
- Wording test: no promise words (see `wording.md`), no dollar signs, American spelling in the fixed text.

## Existing tests that may need changes
- `test/grade-flow.test.js`, `test/grade-lead.test.js`, `test/grade-reuse-property.test.js`, `test/grade-load.test.js`, `test/agency-report.test.js`: any assertion that counts `kit-item` boxes, counts Copy buttons, or checks what comes right after the fix kit.
- `test/grade-fix-kit.test.js`: should not change (new functions only).
- `test/step1-public-unchanged.test.js` and `test/nav-and-notes.test.js` only if they hash or snapshot the report's full text.
Name every changed older test line in the review notes.

## Risks
- Google's own rules for a Business Profile description (no links, no phone numbers, no promotional wording, 750 character limit) can change; the first task checks them again and the spec's limits follow the current page. Do not state them to the owner as Google's rules beyond the plain "no web address or phone number" tip.
- The FAQ markup is only honest when the same Q&A is visible on the page; the line above the box says so. It is not offered when the owner has no website.
- `about` is the owner's text: it is quoted as typed, so a typo is copied. The box says "Read it once before you paste it."
