# Fix pack: wording fixes from the plain-English reader pass (2026-11-27)

Apply to server/lib/fix-kit.js and server/lib/grade-html.js. Update tests that assert the old words. American spelling. Never the word "tool". No promises.

1. Markup heading (PACK_HEADINGS.markup, the combined box, the .txt file): "Hidden FAQ code for your website (for your web person)". No "markup" or "JSON-LD" anywhere an owner reads.
2. FAQ_MARKUP_LINE: "This is a short block of code that visitors never see. It tells Google and AI assistants what the questions and answers on your page are. If you have a web person, send them this box. Otherwise paste it at the very bottom of the same page where you pasted the FAQ, in the page's HTML or custom code area. Only use it on a page that also shows these questions and answers to visitors."
3. FAQ_JSON_TEXT_NOTE: "This is code for your website. Give it to whoever looks after your website, to add to the same page as the questions and answers above. Visitors will not see it. Only use it on a page that also shows those questions and answers."
4. PACK_HELP.faq: "Put these questions and answers on your website, on your home page or a page called FAQ. Paste them as plain text, one question with its answer under it. If someone built your site for you, send them this box. Read it once before you paste it, because it uses your own words."
5. PACK_HELP.gbp: "Paste this into the Description box when you edit your Google Business Profile. Read it once first and fix any typo." (No menu names.)
6. PACK_HELP.all: "The same three pieces as above, in one box, with a label over each. Use this to send everything to your web person in one email. Do not paste this whole box into Google. Paste each part where its box says." Title: "All three pieces together (to send to your web person)".
7. Section intro: "Ready-made text to paste: a description for your Google Business Profile, and questions and answers for your website. We wrote it only from what you typed and what we found on your website. We did not add anything else. Read each piece before you paste it. Changes can take days to weeks to show up."
8. FAQ_ADD_FIRST: "We could not build your questions and answers yet, because we did not have enough facts. Add what you do and your phone number to your website, then run a new check."
9. GBP_ABOUT_LEFT_OUT: "We did not use your own description here, because it has a web address, email, phone number or emoji, which do not belong in this box. We used what you do instead." (No claim about Google's rules.)
10. Remove invented reach: never write "and nearby areas". Use "Serving {city}, {state}." and "{name} serves {where}." only from the owner's own words.
11. Question "What is your website?" becomes "Where can I find you online?" with answer "Visit {website}."
12. Download link: "Download the fix pack as a text file to email to your web person".

Add or update a test for each item. Run the existing guard tests: existing report outputs must not change.
