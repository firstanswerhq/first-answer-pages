# Review round 3 of the Kiro grader rebuild (Nov 18, 2026)

The page reviewer re-captured every Grader page at desktop and phone width after V12 to V21 (commit 65ea818) and compared them side by side with the original. Result: V12, V13, V14, V16, V17, V18, V19 and V21 are fixed; V15 and V20 are partly fixed. Nothing overflows at phone width and the wording rules are clean (no "Yellow Pages"/"YP", no dollar figures, no "guarantee", no British spellings).

Add these to tasks.md under "Review fixes" as V24 to V31, then fix them. No shell commands.

V24 (V15 leftover). In demo mode the Google note reads "Your score comes from The demo assistant's answers only", with a capital T in the middle of a sentence. Use the lowercase form mid-sentence ("the demo assistant's answers"); with Claude connected it already reads correctly.

V25 (V20 leftover). A business that gave no website is told "Send this kit to whoever looks after your website." Give that case its own fix-kit intro that doesn't assume a website (for example, that the kit is ready for when they set one up, or to hand to whoever builds it).

V26. The third AI question has a grammar error: "Which roofers in Nashville, TN do people say is the most reliable?" It must be "...do people say are the most reliable?" This is the real question sent to the AI and shown on the report, so fix it at the source.

V27. Hours read from the site's code look robotic on the listing card: "Monday, Tuesday, Wednesday, Thursday, Friday 07:00-18:00". Show day ranges and plain times, e.g. "Monday to Friday, 7:00 am to 6:00 pm".

V28. "Want help? ... First Answer can apply the fixes for you." The name "First Answer" is never explained on a site branded First Answer Pages. Say who that is, e.g. "First Answer, the team behind First Answer Pages, can apply the fixes for you."

V29. On Google's live-answer page the answer lost its quote bar, so it reads as loose lines. Put the answer back in the quoted-answer style used for the other AI answers.

V30. The About page starts "This is the free check at /grade", which shows a web address path to the reader. Start with plain words, e.g. "This is our free AI Visibility Check."

V31. The free listing card's rows are spaced about twice as far apart as the original compact card. Tighten them so the card reads like a single phone-book entry again.
