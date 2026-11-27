# Tasks
- [ ] 1. Add `about` to `normalizeGradeInput` (trim, 200 code points, control chars removed, kept only when not empty).
- [ ] 2. `freeQuestion`, `extraQuestions`, `stepNames`: use `about` when present; unchanged when absent.
- [ ] 3. Check form: new optional field `g-about` in `server/lib/grade-html.js`; keep the form working with JavaScript off.
- [ ] 4. Cache key includes `about`.
- [ ] 5. Tests in `test/grade-about-field.test.js`; README line.
- [ ] 6. Run the full suite; compare with the 10 known older failures.
