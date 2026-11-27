# Tasks: fix pack

Read `.kiro/steering/rebuild.md` first: the terminal on this laptop returns no output. Do not run shell commands. Write the code and the tests for one task, then stop and say which task is done. Tests are run in the cloud and the result comes back in chat. Do one task at a time. Do not touch the second opinions, the progress bar, `public/js/grade.js`, or `public/js/health-interact.js`. Read `.kiro/steering/grader-safety.md` before editing `server/lib/fix-kit.js`.

- [ ] 1. Check the current Google Business Profile description limits on Google's help page and write the numbers (750 characters, no links, no phone numbers) as constants with a one-line comment. Tests: a constant test only.
- [ ] 2. `gbpDescription(found)` in `server/lib/fix-kit.js`, with a local `cleanAbout`. Tests in `test/grade-fix-pack.test.js`: length, word boundary, no web address or phone, `about` first sentence, place sentence for storefront and no-storefront.
- [ ] 3. `faqPairs(found)` and `faqText(pairs)`. Tests: each pair appears only with its fact; fewer than 2 pairs; banned-words test; no-invented-fact property.
- [ ] 4. `faqJsonLd(pairs)` and `fixPackText(found)`. Tests: parses as JSON, no `<`, equals the FAQ text one for one, the "add this first" sentence when fewer than 2 pairs.
- [ ] 5. Existing-output guard: add snapshot-style tests that `suggestedTitle`, `suggestedSummary`, `jsonLdBlock`, `llmsDraft`, `robotsLines` are unchanged for a few inputs.
- [ ] 6. `fixPack(grade, contactEmail)` in `server/lib/grade-html.js`, called after `fixKit(...)` in `fullPart`. Boxes `pack-gbp`, `pack-faq`, `pack-faq-json`, `pack-all` with the kit's markup and Copy buttons. Tests: present with full access, absent when locked, escaping, works with no JavaScript (the Copy buttons stay `hidden` as the kit's are).
- [ ] 7. `GET /grade/:id/fix-pack.txt` in `server/routes/grade.js`, modeled on `data.csv`; add it to the route list in the file header. Tests: 303 without access, `text/plain` with `Content-Disposition` with access, no HTML tags in the body, 404 for a bad id.
- [ ] 8. README: one routes-table row and one sentence. Final step: run the full suite in the cloud, compare with the known older failures, and list in chat every older test line you changed.
