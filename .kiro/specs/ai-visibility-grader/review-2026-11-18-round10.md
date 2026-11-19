# Review round 10: what the owner saw on a real report (Nov 18, 2026)

Colby ran the live AI Visibility Check on a real Tallahassee business on his phone. Claude listed five businesses and named his 3rd, and the report said so: "It listed 5 businesses, and yours was 3rd." Two things on that report read wrong to a business owner. The rebuilt pages do the same thing, so fix both in the rebuild.

Add V38 and V39 to tasks.md under "Review fixes" and fix them in server/lib/grade-html.js (plus any small CSS needed in public/css/style.css). No shell commands. Add example tests for both to a new test file, test/grade-report-list.test.js (additions only).

V38. Show the whole list in the AI's order, with the business in its real place.
Today the numbered list under "What AI says" shows only the competitors, numbered 1, 2, 3, 4. So right under "yours was 3rd", the line "3." shows a different business ("3. College Cleaning Crew"), and it looks like the report contradicts itself. Instead:
- When the business has a position, show every name in the AI's order, numbered the way the AI ranked them, with the business itself in its place, marked and set apart (bold, with "(you)" after it), e.g.:
  1. Joe Pogo's Window Cleaning
  2. Cleanscapes Exterior Cleaning
  3. Capital City Window & Pressure Cleaning (you)
  4. College Cleaning Crew
  5. Premier Pressure Washing and Window Cleaning Services
- Use the business's name as the AI wrote it in the answer, if you have it; otherwise the name the owner typed.
- When the business was named but has no position, or was not named, show the competitors as a plain list without numbers, under a short heading such as "Other businesses it named", so no number implies a rank.
- Keep everything escaped.

V39. Show Claude's answer as clean reading text, not raw formatting.
Under "See Claude's answer", the text shows the AI's formatting symbols as they are: "1. **Joe Pogo's Window Cleaning**: Joe Pogorzelski has...". A business owner sees stray asterisks. The same happens for the second opinions (ChatGPT, Gemini, Grok, Perplexity).
- Before showing an answer, turn its simple formatting into plain readable text: remove `**` and `__` around words (and single `*`/`_` used for emphasis), turn `[name](link)` into just the name, drop heading marks (`#`, `##`, `###`) at the start of a line, turn `- ` and `* ` bullets into "• ", keep numbered lines and line breaks as they are, and drop leftover citation marks like `[1]`, `[web:3]` and `[[2]](link)`.
- Do this only for display. Never change the stored answer, and never change what the name matcher reads (it needs the original text).
- Still escape everything, and never turn the AI's text into HTML.
