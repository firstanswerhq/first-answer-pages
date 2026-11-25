Verdict: NO-GO

Full report reader review, 2026-11-25. Sample report `report.html`, printable `print.html` and `print.pdf` (16 pages), read at 1280 and 390 wide with Playwright (all `<details>` opened, orb circles tapped, print PDF rendered page by page). The CSV was read from the `reportCsvFor` / `reportCsv` code and an older sample `data.csv`, because the demo link `/grade/demo123/data.csv` is not served by the static server.

Read three times: (1) a contest judge with 2 minutes, (2) a non-technical plumber, (3) an agency owner deciding whether to give this to clients.

Why NO-GO: K1 shows the word "undefined" as a heading on screen and in the PDF. K2 and K3 are contradictions an agency owner would spot in under a minute: a check shows yellow in one place and PASS in another, and every answer says "without a live web search" right under a "Sites AI used to answer" list. K4 is the deal-breaker for agencies: the report they print for a client still advertises another fix-it team and an upsell. Everything else is polish.

No British spelling found. Nothing says or implies that AI will name the business.

## Items

K1. Where: "Every answer" section, screen and PDF (page 13). Problem: the bold heading over the answers reads "1. undefined". A judge sees a broken page. Likely sample data (the sample answers have no `prompt` field), but the page should never print "undefined". Plain fix: when an answer has no question, fall back to the question shown in "What AI says" ("Who are the best plumbers in Nashville, TN? Name your top 5."). If there is still nothing, leave the heading out.

K2. Where: the health map compared with "Customer basics" score cards. Problem: "Tap-to-call phone number: Found a link, but not the number" is yellow in the health map but "PASS 4 of 4 points" on its card. "Street address on the home page: Found, but not on one line" is yellow in the health map but "PASS 3 of 3 points" on its card. The same check gets two verdicts. Plain fix: use one status for both. Either show "Partly" on the card, with the same fix line, or show green in the health map with the advice as a tip.

K3. Where: "Sites AI used to answer" compared with every evidence line. Problem: all 5 evidence lines say "without a live web search", yet the list just above says AI cited riverbend.example, yelp.com, angi.com and bbb.org, and "AI read Yelp for 2 answers". An agency owner will ask which one is true. Possibly sample data, but the product needs a rule for this. Plain fix: show "Sites AI used" only for answers that ran with web search, and say which answers those were ("ChatGPT, with web search: cited yelp.com"). If no answer used search, hide the section, or say "AI answered from memory; these sites were mentioned, not visited."

K4. Where: the printable report and PDF (agency use). Problem: the client-facing PDF still contains First Answer Pages sales copy: "When we ran this check, Founding Member spots were still open... Founding Members pay once for the optional Verified stamp", "Listed on First Answer Pages: Not yet. It's free, claim it below" (with no claim button in print), and the free-listing block. The screen page also has "WANT HELP? First Answer... can apply the fixes for you". An agency cannot hand a client a report that sells someone else's service. Plain fix: when "Prepared by" is set, drop the Founding Member line, the "claim it below" wording and the Want help block from print, or move the free listing to one neutral line ("Free directory listing available at firstanswerpages.com"). Also check what is shown on the screen report when "Prepared by" is set.

K5. Where: PDF layout. Problem: the PDF is 16 Letter pages and is mostly white space. Page 1 is a cover box with nothing under it. "Score by area" takes half a page. Each score group ("AI answers", one card; "Can AI read your website", 3 cards; and so on) starts its own page, so pages 9 to 12 are three-quarters empty. It looks unfinished. Plain fix: stop forcing a page break before every section. Allow breaks only between cards (`break-inside: avoid` on cards, not `break-before` on sections). Put the health summary and "Fix these first" on page 1 under the score. The target is 6 to 8 pages.

K6. Where: PDF, items that only work on screen. Problem: the paper copy shows "▼ See the full answer" six times, a "Run a new check" link, "Ask us to remove this report: contact page" (a link you can't click on paper), "Not a computer person? Send this page to whoever built your website" (the agency is the one who built it), and "The Copy button copies it" (no buttons in print). Plain fix: in print, hide the disclosure triangles and Copy wording, and print link targets as text only where they help. Change the "Send this page" line to "Your web team can use the Fix kit at the end."

K7. Where: PDF, center of the health orb. Problem: the business name and score in the middle circle print with a heavy dark outline, and the PDF text layer has them twice ("Riverbend Riverbend Plumbing Co. Plumbing Co.", "Score 68/100 Score 68/100"). It looks smudged, and a screen reader or a copy-paste gets doubled text. Plain fix: in print, drop the glow or stroke copy of the label and keep one plain dark label.

K8. Where: "Score by area". Problem: "You earned 55 of the 81 points we checked. That is 68 out of 100." The reader wonders where the other 19 points went. Nothing says they were not checked and don't count against you. Plain fix: add "19 points couldn't be checked this time (for example, your page summary), so they don't count for or against you." Even better, list which checks those were.

K9. Where: "Health of your setup", Website group. Problem: under "Website: Partly" the subheading says "Website is reachable", then the next line says "Website address works: Not checked. We couldn't reach your website this time". Below that, a dozen website checks passed. That is three statements that can't all be true. Partly sample data. Plain fix: rename the subheading to "Website basics". If the site was read for the other checks, don't say "We couldn't reach your website". Say which part failed, for example "We couldn't check whether http:// sends visitors to https://".

K10. Where: names of the same check across the health map, score cards, Fix these first and Fix kit. Problem: one check, two names, several times over:
- "A short info file for AI (llms.txt)" / "Info sheet for AI"
- "Search summary (the 2 lines under your link in Google)" / "Page summary"
- "Picture shown when someone shares your link" / "Picture for sharing your page"
- "One main headline on the page" / "Main headline on the home page"
- "Your website lets AI assistants read it (robots.txt)" / "Can AI assistants get in?"
- "Name, phone and address tagged for AI (business label)" / "Business label for AI", and the Kit says "so AI can read your name and phone" (address dropped)

Plain fix: pick one name per check and use it everywhere. Put the technical term in brackets the first time it appears.

K11. Where: "Fix these first", first item and the matching score card. Problem: "Add the business label (a few lines of code in your full report)". This IS the full report, so the owner goes looking for another one. Plain fix: "(the code is in Your fix kit, at the end of this report)", and make it a link to `#kit-label` on screen.

K12. Where: Fix kit compared with checks that already passed. Problem: the Kit offers a new page title and a new llms.txt even though "Page title: PASS" and "A short info file for AI (llms.txt): Found". A non-technical owner may overwrite a good file. Plain fix: for checks that passed, label the box "You already have one. Use this only if you want to replace it", or leave it out.

K13. Where: Fix kit, "Business label for AI" code. Problem: an agency owner will find it thin. It has no streetAddress, postalCode, opening hours or `sameAs` links (the Facebook page was found), and `"telephone": "ADD YOUR PHONE NUMBER"` is easy to paste live by mistake. Partly sample data, because the phone and address weren't read. Plain fix: add `sameAs` for links that were found (Facebook, Google profile URL). Add commented placeholders for street and ZIP, and a bold line "Replace the CAPITAL WORDS before pasting." Name the technical term once: "business label (schema.org LocalBusiness markup)".

K14. Where: "Made some changes?". Problem: "Check again" and "run a new check" are two different actions with nearly the same name. "Check again... doesn't ask AI again. To ask AI again after your changes, run a new check." That makes the owner stop and puzzle it out. Plain fix: name the buttons by what they do: "Re-check my website (fast)" and "Run a full new check (asks AI again)".

K15. Where: the "Who AI named, across 5 answers" heading. Problem: "What AI says" just said "We asked Claude 3 times", then the table counts 5 answers without saying the other 2 came from ChatGPT and Perplexity for comparison. Riverbend's "3 of 5" doesn't match the "2 of 3" above it, so it reads as an error. Plain fix: add a line under the heading: "3 Claude answers plus 1 from ChatGPT and 1 from Perplexity." Or show one column per assistant.

K16. Where: evidence lines. Problem: "Evidence: Claude (model claude), without a live web search." "model claude" is not evidence. An agency needs the exact model and version (the CSV has `claude-sonnet-4-5`), the date and time of each answer, and the exact question. Likely sample data for the model string. Plain fix: "Evidence: asked Claude Sonnet 4.5 on Nov 25, 2026 at 12:07 PM CST, from memory (no web search). Question: '...'"

K17. Where: Download data (CSV). Problem, checked in code (`reportCsv`): the file has a "Prepared by" line above the header row, which breaks Excel and Sheets imports. It has no business name, website, run date or score, no points per check, no score by area, and no competitor names, cited sites or answer text. The `group` column says "Website" for search-basics and customer-basics rows. An agency can't build a client tracker or a before/after comparison from it. Plain fix: one header row first. Add the columns business, website, check date, score, area, points earned, points possible and status. Add one row per answer with the answer text, the businesses named and the sites cited. Put "Prepared by" in a column, not in a line above the header.

K18. Where: "Share this report". Problem: the "Save" button next to "Prepared by" is the browser's default gray button, the only unstyled control on the page. "Download report" opens a print page rather than downloading anything. Plain fix: style Save like the other buttons, and rename "Download report" to "Print or save as PDF".

K19. Where: sentences about us rather than the reader. Problem: "Speaks AI's language. These checks don't count toward your score yet" (the word "yet" is about our roadmap). "Hours: Add your hours (Google has them, but we only copy hours from your website)". "The i marks your free listing: information, not health. Your score is at the top of the page." Plain fix: drop "yet". Change the hours line to "Add your hours on your website and we'll fill them in." Cut "Your score is at the top of the page" and say "i = about your free listing, not part of your health."

K20. Where: health orb on phone (390). Problem: the center counts up from a low number. A visitor who screenshots in the first second gets "Score 17/100" (seen in testing) or "Score 43/100" next to a big "68 / 100". The "Free listing" and "Links" circles also load dimmed at 390, so they look disabled. Plain fix: show the final score in the orb right away (count up only in the big number, or not at all), and don't dim circles on first load.

K21. Where: answer text compared with the phone checks (likely sample data). Problem: the AI answers quote "(615) 555-0142", while the report says it couldn't read the phone number, the listing says "Add your phone number", and the Kit has "ADD YOUR PHONE NUMBER". A reader asks: if AI knows my number, why don't you? Plain fix: none needed if this is only in the sample data. Otherwise, add an optional "Is this your number?" prompt that uses a number found in the answers.

K22. Where: competitor data (likely sample data). Problem: every answer names the same two competitors ("5 of 5"), and answers 1 and 3 are word-for-word identical. To an agency that looks fake or cached. Plain fix: use more varied sample answers for the demo report the judges see.

K23. Where: removal line at the bottom. Problem: "Ask us to remove this report: contact page" makes the owner wonder whether the report is public or indexed. Nothing says who can see it. Plain fix: add "Only people with this link can see this report" (if true), next to the remove line.

## Agency owner would want next

- Plain, co-branded PDF: their logo and contact on the cover, no First Answer Pages sales lines, and 6 to 8 pages.
- A CSV or JSON that includes the score, points per check, answer text, competitors named and cited sites, with one tidy header row.
- History: the same business checked over time, with a before/after view of score and AI mentions.
- More questions per business (for example "emergency plumber near me" or "water heater repair Nashville") and a choice of city or neighborhood, with mention rates for each question.
- Engines side by side, with web search on and off labeled per answer, and exact model and timestamp as the evidence.
- A competitor view: for the businesses AI named, which of the same checks they pass (for example schema, reviews, Yelp link).
- Bulk or multi-client runs, and a shareable private link with an expiry date.
- Fuller structured-data output (address, hours, `sameAs`, services) that's checked before handing over.
