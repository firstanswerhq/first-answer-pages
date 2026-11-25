# Next batch for Kiro (Nov 25, 2026)

Step 2 fixes (d069a31) tested in the cloud: 1808/1808 twice. Code review pass 2 is GO (review-2026-11-25-step2-pass2.md, low items W1-W10). Judge reader pass 2 is NO-GO (review-2026-11-25-step2-reader2.md, J1-J10).

## Part A: finish Step 2 (do first)
1. J1, J2: the free-listing card on the report must not contradict the health section. Pre-fill the listing card with what the check found (phone, street address, hours, website), and only say "Add your ..." for what was really not found. Use the same found/not-found facts the health rows use. Note W6: in the reviewer's sample, the website facts were partly empty, so test both a full sample and a sparse one; the wording must be consistent in both.
2. J3: in "What AI says", show the question we asked, drop the "This list is from answer 1" line when no list is shown, and don't repeat the "named your business" line.
3. J4 + W4: move the two "Your First Answer Pages listing ..." rows into the Free listing group (neutral, no health color).
4. W5: no row may repeat its own label as its status ("Founding Member: Founding Member", "Open for business: Open"); fix every such row (J8).
5. W1: orbs swapped out while off screen must drop their listeners and references at once.
6. W2: on phones the particle canvas must stay centered on the orb.
7. W3: keep map words at 12 px or more from 360 px wide up; fix the size test to measure the real width.
8. The rest as written: J5 (hover titles on small dots and a desktop "click a circle" hint), J6, J7 (fix card title as a statement; explain "business label"), J9, J10 ("partway"; AI answers circle can say "2 of 3"), W7, W8 (bring design.md up to date), W9, W10 (same "not scored" words in center and top).

## Part B: then the next requirements
Requirement 2.10 (one-time scan), Requirement 11 (fair use, 7 days) and Requirement 12 (website still alive) in requirements.md. Follow every numbered line. Do not edit requirements.md.

## Rules
Score and public SEO unchanged; sentences 160 characters or less; American spelling; nothing promising AI will name a business; no report content added only by JavaScript; reduced motion means no animation. Add tests and record in the design table. Do not run any shell commands, including "exit". Stop after Part A and list the changed files, then do Part B and list them again.
