Verdict: NO-GO

Second reader review of Step 2, the "Health of your setup" section, on the Riverbend Plumbing Co. sample (http://localhost:8765/report.html). This sample has Claude naming the business in 2 of 3 answers and a score of 68/100. I used the four screenshots and read the whole page text with Playwright at 1280 and 390 wide. On the phone I tapped Website, AI answers, Details match and Free listing, and on desktop I scrolled the list to see the sticky map. I read the page twice, once as a contest judge with 2 minutes and once as a non-technical owner. I changed no code.

The section itself is now in good shape. Most of H1 to H14 are fixed. The NO-GO comes from J1 and J2. In both, the page tells the owner to add a detail that the same page says it already found, and Claude's own answer quotes one of them. A judge who reads the free-listing card next to the health list will take that as a bug. J3 is close behind: the "What AI says" text refers to a list that isn't there. Everything from J4 on is polish.

## H1 to H14: do they read right now?

| Item | Now | Notes |
|---|---|---|
| H1 "Health 69" vs score | Fixed | The center says "Score 68/100", the same as the "68 / 100" at the top. The intro now says what the lights are. |
| H2 Address Good vs missing | Partly | Better wording, but it still says "Good" and "couldn't read" about one address, and the listing card still says "Add your street address". See J2. |
| H3 "Not linked" shown as "Partly" | Fixed | The rows show "Not linked" or "Not on Bing Maps yet" in amber. The main circles say "Partly", which is right for a group. |
| H4 Map words unreadable | Fixed for the main circles | The main-circle labels are about 12 to 15 px and readable. The rotated words on the outer dots are gone, but the dots still don't say which check they are (J5). |
| H5 Empty AI answer | Fixed | The sample has real answers: Named you, Didn't name you, Named you. |
| H6 Jargon | Fixed in the list | The plain words come first and the technical name is in brackets. "Fix kit" and "block" are still in the fix card (J7). |
| H7 Rows that repeat themselves | Mostly | "Recently updated: Updated in the last 12 months" and "Open for business: Open" still echo (J8). |
| H8 Free listing as a health problem | Mostly | The main circle is neutral "i, Not started". Two "First Answer Pages listing" rows are still gray "?" rows inside Details match and Links (J4). |
| H9 One idea, several words | Mostly | Listing, hours and calling are fixed. The fix card is still a question, and "Speaks AI's language" has no score line (J6, J7). |
| H10 "4 of 12" count | Fixed | It now says "4 of 13 checks need work" with an explaining line. That line talks about us (J9). |
| H11 Tone about us | Mostly | See J9. |
| H12 Phone tap | Fixed | "Tap a circle to see its checks." is under the map, each group ends with "Back to the map", and the circles fill the box. Desktop has no hint (J5). |
| H13 British spelling | Fixed | None found. "Business hours" is used. "part way" should be "partway" (J10). |
| H14 Implying AI will name you | OK | Nothing found. |

## Items

### J1. The listing card asks for a phone number the page already found (must fix; looks like a bug)
- **Where:** "Your free listing in our directory" card: "Riverbend Plumbing Co. · Add your phone number". The same page says "Tap-to-call phone number: Good" and "Phone matches Google: Matches", and Claude's answers 1 and 3 quote "(615) 555-0142".
- **Problem:** The card asks the owner for something we found three times. Claude, the AI we're showcasing, knows the phone number and our own directory card doesn't. A judge will see the contradiction.
- **Plain rewrite:** Pre-fill the card with the phone number found on the website: "Riverbend Plumbing Co. · (615) 555-0142". Only show "Add your phone number" when no phone was found anywhere.

### J2. The address is "Good", "couldn't read" and "Add your street address" all at once (must fix)
- **Where:** In the Website list, "Street address on the home page: Good". In Details match, "Address matches Google: Not checked. We couldn't read a full street address on your website to compare..." In the listing card, "Address: Add your street address". The card also says "Hours: Add your hours" while Google shows "Hours on Google: Listed".
- **Problem:** Three places give three answers about one address, which is the same problem as H2. A judge reads "Good" and then "we couldn't read it".
- **Plain rewrite:**
  - Website row: "Street address on the home page: Found, but not on one line" (amber). Use "Good" only when the compare step can read it.
  - Details row: keep "Write it on one line, like '123 Main St, Nashville, TN 37201', so we can compare it with Google."
  - Listing card: pre-fill whatever was found: the address from the page or from Google, and the hours from Google. If nothing was found, use "Add your street address".

### J3. "What AI says" refers to a list that isn't there and never shows the question (confusing)
- **Where:** "We just asked Claude 3 times. Claude named your business in 2 of 3 answers. / AI answers change from one time to the next, so we ask the same question 3 times. This list is from answer 1, the first one that named you. / It named your business in its answer. In 1 answer, Claude didn't name you. / See Claude's answers".
- **Problem:** No list appears ("This list is from answer 1"). "It named your business in its answer" repeats the line above. The owner and the judge never see what we asked Claude. This is the product's headline moment and it reads like leftover template text.
- **Plain rewrite:** "We asked Claude: 'Who are good plumbers in Nashville, TN?' We asked 3 times, because AI answers change each time. Claude named Riverbend Plumbing Co. in 2 of 3 answers." Then "See Claude's 3 answers". Remove the "This list..." and "It named your business..." lines. In each answer, highlight the business name.

### J4. Our own listing still shows up as gray "couldn't check" rows inside health groups
- **Where:** In Details match, "? Your First Answer Pages listing matches your website: Not checked. No listing yet." In Links, "? Your First Answer Pages listing links to your website: Not checked. No listing yet." These rows also appear as gray "?" dots on the map.
- **Problem:** The legend says gray means "we couldn't check it". That isn't true here: there's nothing to check yet. This is the leftover from H8.
- **Plain rewrite:** Move both rows into the Free listing group with the "i" mark: "Listing matches your website: After you claim your listing." and "Listing links to your website: After you claim your listing." Also add the "i" to the legend: "...gray means we couldn't check it, and i is for your free listing."

### J5. The outer dots don't say which check they are, and desktop has no hint
- **Where:** The small check dots around each circle. On desktop, the map has no "Click a circle" caption.
- **Problem:** There's no hover text or caption, so a judge who points at a red ✕ near Website can't find out what it is without reading the list. On desktop nothing says the circles can be clicked.
- **Plain rewrite:** Give each dot the check name on hover or focus, either as an SVG `<title>` or as one caption line under the map: "Picture shown when someone shares your link: Needs work". Show "Click a circle to see its checks." on desktop too.

### J6. "Speaks AI's language" has no line in Score by area
- **Where:** The list groups are "Can AI read your website", "Speaks AI's language", "Search basics" and "Customer basics". Score by area lists AI answers, Can AI read your website, Search basics and Customer basics.
- **Problem:** The owner can't tell where "Speaks AI's language" counts.
- **Plain rewrite:** Either fold it into the group name ("Can AI read and understand your website") or add a note in Score by area: "Can AI read your website (includes 'Speaks AI's language'): 12 of 20 points".

### J7. The fix cards still mix questions with labels and use unexplained words
- **Where:** In Fix these first: "Can AI see your reviews?" and "Add the business label block from your fix kit to your home page so AI can read your name and phone."
- **Problem:** One title is a question and the other two are labels. "Block" and "fix kit" are never explained, and the fix kit is behind the form. The list check covers name, phone *and address*.
- **Plain rewrite:** Title it "Reviews on your website". For the business label: "Add the business label (a few lines of code in your full report) to your home page, so AI can read your name, phone and address."

### J8. A few rows still repeat themselves
- **Where:** "Recently updated: Updated in the last 12 months", "Open for business: Open", "Facebook: Linked from your website".
- **Plain rewrite:** "Updated in the last 12 months: Yes", "Open for business: Yes", "Facebook: Linked".

### J9. A few sentences are about us, not the owner
- **Where:** Under the score: "That counts the scored checks. The lights below show every check, including ones that don't count toward the score." In Details match: "We couldn't read a full street address on your website to compare."
- **Plain rewrite:** "13 checks make up your score. The lights below also show extra checks that don't count toward it." For the address: "Write your full street address on one line, like '123 Main St, Nashville, TN 37201', so we can compare it with Google."

### J10. Small wording
- In the intro, "amber is part way there" should be "amber is partway there". American readers also say "yellow" more often than "amber", so consider "yellow means partway there".
- In the map, the AI answers circle could say "2 of 3" instead of "Partly". That matches "Socials: 1 of 3 linked" and puts the headline number on the map, which helps the video.

## Does it look high tech and impressive for the video?

Yes, more than before. The dark console panel, the glowing core with "Score 68/100", the colored rings and the flowing connectors look like a modern status board. The main labels are now readable. On desktop the map stays in view while the list scrolls, which looks polished. On the phone the circles fill the box. The fanned ring of dots around Website is crowded but reads as "lots of checks".

It's still a static picture. The best addition for the video hasn't been built yet: the one-time "scan" from the center outward, where each circle lights up, its dots pop in green, amber or red, the check name shows in the caption, and the center counts up to 68. With J5's caption line, that scan would also explain the map. It's a nice-to-have, not a blocker.
