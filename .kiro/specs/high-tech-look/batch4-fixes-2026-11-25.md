# Batch 4 fixes (Nov 25, 2026)

Review: review-2026-11-25-batch3-pass2.md (NO-GO only for Y1, Y2). Fix as written there:
- Y1 (must): on shared hosts, "(your website)" only for the business's own page (use sameSite or compare the page path), never for every facebook.com source.
- Y2 (must): the print page never loads or plays the scan; add a guard so the scan can't run on the print page.
- Y3: the "doesn't link to your Google profile" line only for a Google Business Profile or Maps page, not any google.com page.
- Y4: the CSV skips answers with no text, so its count matches "across N answers".
- Y6: after "Check again" swaps the report, the scan watches the new map (or doesn't run if it already played).
Owner decisions: Y5 stays as written (a background tab skips the scan). Y7 is approved (the exact question shows in the heading above the evidence lines); add it to the deviations table.
Same rules as always. Tests for each. Do not edit requirements.md. No shell commands.
