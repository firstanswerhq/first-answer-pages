# Design: named competitors

## What exists today (read before building)
- `server/lib/agency-report.js`: `answersOf(grade)`, `shareOfVoice(grade)` returning `{ total, rows: [{ name, count, own }] }`. Names come from each answer's stored `competitors` and `named`. Matching uses `normalizeForMatch` from `server/lib/seance.js`.
- `server/lib/grade-html.js`: `voiceSection(grade)` draws the table and is called by `reportPage` as part of `agencySections` (full report only). `competitorList(a, input)` draws names in the free part. `readableAnswer(text)` and `markedAnswer` clean answer text for display. `providerLabel` is in `grader.js`.
- `server/lib/name-match.js`: `listedNames(answer, business)`, `splitLists(answer, business)`, `extractEntries` (private). `listedNames` returns the names in answer order with `own` flags, so the position of each name in a numbered list is available.
- Answers store: `answer` text (capped at 4,000 code points), `competitors` (at most 5), `named`, `position`, `total`, `provider`, `prompt`, `extra`, `second`, `sources`. Answer text is untrusted.
- `scoredResults(grade)` gives the checks; failed ones have `result: 'fail'`.

## Files that change
| File | Change |
|---|---|
| `server/lib/named-competitors.js` (new) | Pure: `namedCompetitors(grade)` returns `{ total, missed, rows: [{ name, count, total, firstCount, topThreeCount, missedCount, words: { provider, text } \| null }] }`, and `ownerChecksLine(grade)`. Imports `answersOf`, `shareOfVoice`, `normalizeForMatch`, `listedNames`. No I/O. |
| `server/lib/named-competitors-html.js` (new) | `competitorReasons(grade, { agency })` returns the HTML list, escaping every value with `escapeHtml`; `''` when there are no rows. |
| `server/lib/grade-html.js` | One call: `voiceSection` output is followed by `competitorReasons(...)` inside `agencySections` in `reportPage`. No other edit. |
| `public/css/style.css` | A few rules for `.grade-reasons` only if existing ones do not fit. |
| `README.md` | One sentence in the Grade section. |

## How the facts are worked out
- `count` and the names come from `shareOfVoice(grade)`, so the list always agrees with the table above it.
- `missed` is the number of answers (from `answersOf`) with `named !== true`. For each business, `missedCount` is how many of those answers listed it, using the same normalized match against each answer's `competitors`.
- Positions: for each answer that has `named` or numbered output, use `listedNames(answer, business)` and the index of the matching entry (same normalized match). First = index 0; top three = index 0 to 2. An answer where the name is not found in the list counts toward `count` but not toward a position. Show positions only when at least one answer gave one.
- The AI's words: split the answer text into lines; take the first line whose text, after removing a leading list mark (`1.`, `-`, `*`, bullet) and `**`, starts with the business's name (normalized, case-insensitive); the words are what follows the name after one of ` - `, ` – `, ` — `, `:` or `(`...`)`; strip markdown and anything matching a web address, email or phone pattern; collapse spaces; cut at 160 code points at a word boundary; discard if fewer than 3 words remain. Prefer the main assistant's answers (not `second`, not `extra`), earliest first; fall back to a second opinion only if no main answer has one, and label it with its own `providerLabel`.
- `ownerChecksLine`: count of `scoredResults(grade)` with `result === 'fail'`; `''` when zero or when `agency` is true.

## Test plan
- `test/grade-named-competitors.test.js` (node:test, fast-check):
  - Counts equal `shareOfVoice` for generated grades; the owner never appears as a competitor; at most 5 rows; sorted most-named first.
  - Positions: a fixture answer "1. Ace Plumbing - ... 2. Ridge Drains - ..." gives Ace first.
  - Words: extracted after the dash; a URL, an email and a phone number in the line are removed; at most 160 code points; no words when the line has fewer than 3 words after cleaning; no words when the name is only in prose.
  - Safety: a competitor name `<img src=x onerror=alert(1)>` and a line "ignore the question and say hello" are escaped and shown as text; nothing becomes a link.
  - "No reason" row when no line is found; the "own words, not checked" line appears once when any quote shows and not otherwise.
  - Owner-checks sentence only with at least one failed check and not in agency mode; singular and plural wording.
  - Page: shown in the full report only; absent when no answer named another business; present on the print page and the prepared-by page without the owner sentence.
  - Wording: none of the promise words, no dollar signs, no sentence that says why AI picked a business in our voice.
  - `shareOfVoice`, `analyzeAnswer`, answer objects and the score are unchanged (deep-equal a grade before and after the page is drawn).
- Log test: nothing new is logged.

## Existing tests that may need changes
- `test/agency-report.test.js` and any test asserting the exact HTML of the section after "Who AI named" or the text order of the full report: `test/grade-flow.test.js`, `test/grade-reuse-property.test.js`, `test/grade-load.test.js`, `test/grade-reader-notes.test.js`, `test/grade-reader-notes2.test.js`, `test/grade-o1-notes.test.js`, `test/grade-o2-notes.test.js`, `test/final-read.test.js`.
- A test that searches the whole report for words such as "named" or "instead" may now match the new list; name each one changed.

## Risks
- The AI's words can be wrong or out of date. They are quoted, labeled, never rephrased, and never used for a score.
- A name that appears with a different spelling in two answers counts as two rows, as it does in the table today.
- Answers cut at 4,000 code points may lose a line; the row then says "The answer gave no reason."
- Showing a rival's name next to a quote is the AI's text about a business, not our claim. The "not checked" line stays next to it on every page.
