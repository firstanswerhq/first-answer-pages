# Tasks
- [x] 1. Add `about` to `normalizeGradeInput` (trim, 200 code points, control chars removed, kept only when not empty).
- [x] 2. `freeQuestion`, `extraQuestions`, `stepNames`: use `about` when present; unchanged when absent.
- [x] 3. Check form: new optional field `g-about` in `server/lib/grade-html.js`; keep the form working with JavaScript off.
- [x] 4. Cache key includes `about`.
- [x] 5. Tests in `test/grade-about-field.test.js`; README line.
- [x] 6. Run the full suite; compare with the 10 known older failures.
