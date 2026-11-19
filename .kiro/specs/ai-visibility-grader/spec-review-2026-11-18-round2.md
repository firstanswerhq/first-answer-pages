# Spec review, round 2: owner-approved features (Nov 18, 2026)

Written by Claude (review notes only; Kiro writes the spec and the code).

Two reviewers checked the revised spec (Requirements 18 to 22, F1 to F13). Every item S1 to S13 is covered, and the design's facts match the code: `buildListing`/`MODEL_KEYS` in data.js need both new keys, `publicListing` strips only `ownerEmail`, `summarize` in mcp.js and `fieldsFromForm` in rise.js are fixed lists, schema.js has no `sameAs` today, and `previousScore` is written in grader.js and shown in grade-html.js. The "Numbers that change" table is complete: no other existing test needs a change. A separate `normalizeWebsite` (not shared with the check's own website rules, which accept http and ports) is right.

Four small fixes, spec only. Then building can start with F1.

## S14. "`{}` stays `{}`" is not true today

design.md (around lines 357 and 378) and tasks.md (F1 and F8) say `{}` drafts stay `{}`. In fact `normalizeFields({})` returns all 11 keys with empty values (listing-fields.js, around lines 198 to 212), so a test written that way fails. Say instead: "the result has no `reviewsLink` key" (and no `website` key) when the input has none or an invalid one.

## S15. Allow longer review links

Real Google review links with `#lrd=` usually run past 300 characters once the query is kept. Allow review links up to 1,000 characters (Requirement 20.2, the `reviewsLinkHost` design, F1). Keep 300 for the website field. Add a test with a real-length Google search link of about 600 characters that passes.

## S16. Two website-field details

- Strip one trailing dot from the host before the checks, so `https://localhost./` and `https://127.0.0.1./` are refused, and `https://example.com./` is kept as `https://example.com/`.
- The check accepts `http` sites and ports, so `grade.input.website` can be `http://example.com/`. When the claim fills `website` from an `http` address, rewrite it to `https://` with the same host and path, and drop the port, without fetching anything. The owner sees it on the Draft review page and can change or clear it. Say this in Requirement 21.6 and F10 and add a test: a typed `http://example.com:8080/menu?x=1` fills `https://example.com/menu`.

## S17. The admin list uses the same score as the report

For an old Grade the admin list (grade-admin.js, around line 53) shows the stored score (42) while the report shows the score worked out from the results (40). Make the admin list work out its score from the stored results the same way (Requirement 19.8, F3), and add that to the old-Grade test. The lead notice is sent only for new Grades, so it doesn't change.
