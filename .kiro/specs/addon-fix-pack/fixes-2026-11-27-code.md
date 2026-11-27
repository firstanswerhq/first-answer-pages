# Fix pack: code review findings (2026-11-27)

Apply to server/lib/fix-kit.js (and grade-html.js where noted). Add a test for each item. Existing report outputs must not change.

1. Web address or phone number must never reach the Google description.
   - Widen the unsafe-words check (`ABOUT_UNSAFE`): catch bare domains (`acmeplumbing.com`, any word.tld), phone numbers with en dash, em dash, slash or dots between digit groups, and fullwidth digits (normalize with NFKC before checking).
   - Run the same check on `name` and `service` too. If either holds a phone number, web address or email, leave that piece out of the sentence (do not print it).
   - After the text is assembled, run one final check on the whole result. If it still holds a phone number, web address or email, drop the owner's words and use the plain "what you do" sentence.
2. Owner-typed promise or sales words (guarantee, best price, #1, 24/7) and ALL-CAPS: keep the owner's words as typed (spec req 4), but show one plain line above that box: "Read this once before you paste it. It uses your own words, and Google may not accept words like guarantee or best." Test with `about = "We guarantee the best price"`.
3. The FAQ, the hidden FAQ code and the text file must follow the same leave-out rule as the Google box: if `about` holds a web address, email or phone number, none of the three outputs may print it. Put the decision in one helper used by all four outputs.
4. `\p{Extended_Pictographic}` matches the trademark, copyright and registered signs. Exclude those three characters so "Smith & Sons™ plumbing" keeps its words, and make the left-out note say what was actually found.
5. Very long `about`: cut at a word boundary but keep the "Serving {city}, {state}." sentence and end the text with a period. Cap `about` before assembling.
6. Hidden FAQ code with no website: the design says it is not offered. Update requirements.md items 6 and 7 to say so (offered only with 2 or more pairs AND a website), and make fixPack and fixPackText agree. When it is withheld in the text download, say so in one plain line.
7. Add a test with garbage hours (empty, "???", very long) proving hours are left out.
8. FAQ website answer: "Visit {website}." with the https:// address and a period (already in the wording list item 11).
