# Fix pack (add-on 2, from the Nov 26, 2026 competitor research, rank 2)

Owner: Colby. After a check, the owner should be able to act the same day. One copyable pack per report: a ready-to-paste Google Business Profile description, FAQ text, and JSON-LD markup for the FAQ, built from facts only.
Rules that still apply: `.kiro/steering/wording.md`, `grader-safety.md` (fix-kit.js is a grader-safety file), `rebuild.md`. Plain words. American spelling. No dollar figures. Never promise or imply that anything makes an AI assistant name a business. Say "days to weeks". Do not use the word "guarantee".
Do not touch the ChatGPT, Gemini, Grok and Perplexity second opinions. Do not touch the progress bar, polling or reload code, or `public/js/grade.js` (its generic Copy button already handles any `.copy-btn[data-copy]`). `public/js/health-interact.js` stays under 16,000 bytes.

## Why
The report already has a "Your fix kit" (title, summary, business label, llms.txt, robots lines in `server/lib/fix-kit.js`). It has nothing for the Google Business Profile and nothing that answers customer questions. Competitors sell content tools; a small owner needs text to paste, not a dashboard.

## Requirements
1. The full report gets one new section, "Your fix pack", right after "Your fix kit", under the same access rule and shown wherever the fix kit is shown. A button-free page works without JavaScript; the existing Copy buttons work as they do for the kit.
2. The pack has three boxes and one combined box: (a) Google Business Profile description, (b) FAQ text, (c) FAQ markup (JSON-LD, schema.org `FAQPage`), (d) "Everything in one box" holding a, b and c with a plain label above each. Each box says where it goes in one sentence.
3. Facts allowed: the name, service, city, state and `about` the owner typed; the phone, address, hours, website and profile links the check found on the owner's own website; and whether the business has no storefront. Nothing else. Never invent: no prices, no years in business, no "licensed", "insured", "family owned", "free estimates", "24/7", "emergency", awards, reviews, ratings or service lists the owner did not type.
4. Google Business Profile description: at most 750 code points, plain sentences, no web address, no phone number, no emoji, no capital-letter shouting, no sales words. When `about` is set, its words are the first sentence exactly as typed (end punctuation added if missing, never recased or rewritten), unless it holds a web address, an email or 7 or more digits in a row; then the typed service sentence is used instead and a line under the box says why. Then one sentence with the place ("Serving {city}, {state}." or, with no storefront, "Serving {city}, {state} and nearby areas." only when that matches the facts as `llmsDraft` and `jsonLdBlock` already phrase them). It is cut at a word boundary, never mid-word.
5. FAQ text: up to 5 question-and-answer pairs. Each answer is a short sentence built from one fact. A pair is left out when its fact is missing; a placeholder is never used. The pairs are: what the business does (`about` or the typed service); where it works (city, state; the address only when found and not no-storefront); how to reach it (the phone, only when found); when it is open (hours, only when found and readable); what its website is (only when given). The question text is fixed in the code and the answer is the only part that holds facts.
6. FAQ markup: schema.org `FAQPage` JSON-LD whose questions and answers are exactly the FAQ text of box (b), built the way `jsonLdBlock` builds its block (`<` escaped as `<`). A line above it says: "Only paste this on a page that also shows these questions and answers to visitors." It never holds a rating, a review or a claim about search results.
7. When fewer than 2 FAQ pairs can be built, the FAQ and markup boxes are replaced by one sentence saying what to add to the check form or the website first ("Add what you do and your phone number to your website, then run a new check."). The Google description box still shows when the name and place are known.
8. The same pack is available as a plain-text download, `GET /grade/:id/fix-pack.txt` (same access rule as `data.csv`: otherwise 303 to the report), with the three parts under plain headings, `Content-Disposition: attachment`, `text/plain; charset=utf-8`.
9. A kit line that already passed its check keeps the existing "You already have one" note only on the kit; the pack has no such note, because it holds new text.
10. Every value is escaped on the page; the text file is plain text with control characters and line breaks stripped from inserted values; the markup stays valid JSON.
11. Tests as listed in design.md. The existing suite must still pass except the lines named there.

## Rules that still apply (checks, not new work)
No new fetch and no new AI call: the pack reads what the Grade already stored. `server/lib/fix-kit.js` keeps its existing exports and their output unchanged for the same input.

## Not in this change
No editing of facts inside the pack, no "ask AI to write it", no services list, no posts or photos, no Google Business Profile login or API, no FAQ page generator for the website, no change to the existing kit's boxes, the score, the second opinions, the progress bar or `public/js/grade.js`.
