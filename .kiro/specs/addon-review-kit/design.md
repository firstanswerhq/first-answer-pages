# Design: review kit

## What exists today (read before building)
- `server/lib/listing-fields.js`: `reviewsLinkHost(value)` ('google', 'yelp', 'facebook', 'nextdoor' or ''), `reviewsLinkOnPage(value)`. Both are pure and fetch nothing.
- `server/lib/grader.js`: `foundOf(grade).reviewsLink` (best link found on the owner's own website), `bestReviewsLink`. A claim already copies `reviewsLink` to the Draft.
- `server/lib/places.js`: the one Google Places lookup. Its field mask has no place ID (`FIELDS`), `reducePlace` keeps no ID, and nothing read from Google is saved on a Grade (health-signals review T3). So "a Google place is known" today means a Google review link, not a Place ID.
- `server/lib/grade-html.js`: `fixKit()` and the kit box markup (`kit-item`, `<pre id>`, `.copy-btn[data-copy]`, `REPLACE_CAPITALS`). `reportPage` builds `fullPart`.
- `server/routes/grade.js`: `fullAccess`, `reportOptions`, the `print` and `data.csv` routes, `RULES['grade-unlock']`, the form parser and the 8 KB body limit.
- Tech limits: no QR library may be added. A small encoder is written here and tested.

## Files that change
| File | Change |
|---|---|
| `server/lib/qr.js` (new) | `qrSvg(text, { label })`, plus internal `encode(text)` returning the module matrix. Byte mode, ECC level M, versions 1 to 10, Reed-Solomon over GF(256), all 8 masks scored with the standard four penalty rules, format and version information. Pure, no I/O. |
| `server/lib/review-kit.js` (new) | Pure: `reviewLinkFor(grade)`, `reviewTemplates({ name, link })` returning the four texts, `smsLength`. Placeholder constant `REVIEW_LINK_PLACEHOLDER = 'ADD YOUR REVIEW LINK'`, `CUSTOMER_PLACEHOLDER = '[CUSTOMER NAME]'`. |
| `server/lib/grade-html.js` | New `reviewKit(grade)` called in `reportPage` after the fix kit (and fix pack) inside `fullPart`; new `reviewCardPage(grade)`. Reuses the kit's box markup. |
| `server/lib/grader.js` | One returned method `setReviewLink(id, link)` that stores `grade.reviewLink` (validated again with `reviewsLinkHost`; an empty value deletes it), through `grades().update`. Nothing else in the file changes. |
| `server/routes/grade.js` | `POST /grade/:id/review-link` and `GET /grade/:id/review-card`; add both to the file header list. Reuse `fullAccess` and `RULES['grade-unlock']`. |
| `public/css/style.css` | Print rules for the card and a few lines for the section. |
| `README.md` | Two rows in the routes table, one sentence in the Grade section. |

## Data stored
One new optional string on the Grade: `reviewLink` (an `https` review link that passed `reviewsLinkHost`). It is removed with the Grade (90 days) and with the admin's Delete. Nothing else is stored. Never logged.

## The QR encoder (the part to build carefully)
Build it in small steps, each tested: (1) capacity table and version choice for byte mode at level M (v1 14, v2 26, v3 42, v4 62, v5 84, v6 106, v7 122, v8 152, v9 180, v10 213 bytes); (2) bit stream: mode `0100`, character count (8 bits for v1 to v9, 16 for v10), data, terminator, pad bytes `0xEC 0x11`; (3) Reed-Solomon generator polynomials and block splitting with interleaving per the level-M block table for each version; (4) matrix: finder, separator, alignment, timing, dark module, reserved areas, zigzag data placement; (5) masks 0 to 7 and the four penalty rules, pick the lowest; (6) format information (BCH with mask `101010000010010` for level M mask 0, as an external check value) and version information for v7 and up; (7) `qrSvg`.
Do not guess table values from memory. Take every table (block structure, alignment positions, format-string list) from the ISO/IEC 18004 text or a published open reference and cite the source in a comment at the top of `qr.js`. If this cannot be done in one session, stop after step 4 and tell the owner; the review kit still ships without the card (requirement 6 falls back to the line "Paste your Google review link above to get a printable card." replaced by showing the link only).

## Test plan
- `test/qr.test.js` (node:test; a test-only decoder in the test file):
  - Matrix size is `17 + 4 * version`; finder, timing and dark-module cells are in place; the format-information word for every mask equals the published 32-entry list for level M; the format word has the right BCH checksum (property over all 8 masks).
  - Round trip: a test decoder reads the matrix (read format info, undo the mask, walk the zigzag, deinterleave, check every Reed-Solomon block has zero syndromes, read the bit stream) and returns the original string, for fixed links of 20, 60, 120 and 200 bytes and a fast-check property over random printable ASCII up to 213 bytes.
  - 214 bytes throws; the empty string throws; non-ASCII text round-trips as UTF-8 bytes.
  - The SVG is well formed, holds only `<svg>`, `<rect>` or `<path>` elements and the text alternative, and contains no script or link.
  - Human check, listed in the review notes (not automated): print the card and scan it with two phones.
- `test/review-kit.test.js`: `reviewLinkFor` order (owner link, Google link from the site, other site for messages only, none); the four templates contain the name and link, the length of the short text, `[CUSTOMER NAME]` only where expected, no "5-star", "stars", "free", "discount", "gift", "if you were happy"; placeholder when no link; escaping of a hostile name and a hostile link; the policy line is present once.
- `test/review-kit-routes.test.js` (through `createApp`): section absent when locked; present when unlocked; POST with a Google link stores it and shows the card link; POST with a non-review link or a `javascript:` link shows the plain error and stores nothing; an empty POST removes it; rate limit; `GET review-card` 303s without access, shows the card with a Google link, and shows the "Paste your Google review link" line otherwise; noindex, no-store and no-referrer on both routes; the card contains no script.
- Unchanged: reviews check results and the score are the same before and after storing a link.

## Existing tests that may need changes
- `test/grade-flow.test.js`, `test/grade-lead.test.js`, `test/grade-reuse-property.test.js`, `test/grade-load.test.js`, `test/agency-report.test.js`: any assertion that checks what comes after the fix kit, counts Copy buttons or `kit-item` boxes.
- `test/grade-reviews-link.test.js`, `test/grade-reviews-link-redirects.test.js`, `test/grade-reviews-check.test.js`: should not change (no edit to review-link reading); run them first.
- `test/grade-old-grades.test.js`: a stored Grade with no `reviewLink` must still render; add a case, do not change the old ones.
- `test/grade-admin-counts.test.js` if it lists the fields of a stored Grade.
Name every changed older test line in the review notes.

## Risks
- QR correctness: a wrong table gives a code that looks right and does not scan. The round-trip decoder in the test catches most errors; the two-phone scan is the acceptance step.
- Google's review rules and the place in Business Profile where the link is found can change; the owner-facing sentences are checked in task 1 and kept short.
- A pasted link is the owner's own input; it is validated by host and shape only, never fetched. A link that is a valid Google host but not their business is their mistake to catch; the card shows the link in text so they can see it.
- The card is one sheet; very long links reach version 10 and print denser. The page warns nothing; the test covers up to 213 bytes.
- Open question: building the link from a Google Place ID (adding `places.id` to the Places field mask, storing `placeId` on the Grade, link `https://search.google.com/local/writereview?placeid=<id>`) would help owners with no link on their website. It changes what we keep from Google, so it needs the owner's yes and a check of that field's price tier first. It is a separate spec.
