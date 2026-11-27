# Batch 5 fixes (Nov 25, 2026)

Two reviews:
- review-2026-11-25-batch4.md (code: NO-GO only for Z1; Z2-Z5 low). Requirement 9 receipts pass.
- review-2026-11-25-full-report-reader.md (judge / owner / agency reader: K1-K23). Some items come from the hand-made sample (marked there); fix the product so they can't happen with real data either.

Fix all Z1-Z5 and K1-K23, using the fixes in those files. Must-fix first:
1. Z1: on a shared host (facebook.com etc.), the business's own page gets its own row in "Sites AI used" (keyed by the page, own: true); every other page on that host stays in the plain row with no "(your website)". Test it.
2. K1: "Every answer" headings never show "undefined"; fall back to the question shown in "What AI says".
3. K2: one verdict per check. The health map row and the score card for the same check must agree (tap-to-call, street address): either both pass, or the map's amber has a clear reason and the card says the same.
4. K3: an answer shows cited sites only when it really used live web search, and its evidence line says so. Never "without a live web search" next to sources from that answer.
5. K4 (owner decision, Nov 25): when "Prepared by" is filled in, the printable report and the CSV carry no First Answer Pages sales lines (no Founding Member / Verified stamp pitch, no "claim it below", no "Want help? First Answer can apply the fixes"). Keep one small line at the bottom: "Powered by First Answer Pages". Without "Prepared by", the report keeps our offers as today. On screen, the "Want help?" box is hidden when "Prepared by" is set.
6. K5-K7: the printable report is a tight 6-8 pages: no near-empty cover page, no forced page break per score group, no "See the full answer" triangles or Copy-button words on paper, the center circle's name and score print as plain text once.
7. K17: CSV: no line above the header row (put Prepared by in its own column), and add business name, city, score, points, every business named with its count, and cited sites, so an agency can track clients.
Then the rest: K8-K16, K18-K23, Z2-Z5. K16: evidence shows the exact model name and time when stored. K22 sample-data items need no product change unless the product can produce them.

Same rules as always: score and public SEO unchanged, sentences 160 characters or less, American spelling, nothing promising AI will name a business, tests for each item, record changes in the design table. Do not edit requirements.md. No shell commands.
