# Review notes: human-style read of the pages (Nov 23, 2026)

Written by Claude (reviewer, reading as a business owner and as a judge), not by Kiro. Kiro makes the changes.
Pages rendered from branch at 3c1ff6e with a test business. All 16 fit a 390px phone; no dollar figures, no British spelling, no guarantees. What would cost trust is the wording when things go wrong. Do V203-V214 and V216-V220 as one task after the cleanup task. Follow wording.md and grader-safety.md. Update tests that quote these sentences; record each changed older line in the design's table.

## V203 (high) Two "check again" instructions that do opposite things
Daily-limit and Claude-failed reports say "Run a new check tomorrow" / "You can run the check again tomorrow/later", while the bottom button is "Check again" (re-reads the website, never asks AI). On those two reports:
- top line: "Come back tomorrow and press Run a new check to get your full score." (failed: "Come back later and press Run a new check to get your full score.")
- in the AI row: "Come back tomorrow and press Run a new check at the top of this page." (failed: "later")
- the bottom button reads "Recheck my website only".

## V204 (high) "AI didn't answer" under an AI answer
Claude failed, ChatGPT on: the AI row says "AI didn't answer this time" just below ChatGPT's answer. Say "Claude didn't answer this time, so this part has no score. Come back later and press Run a new check."

## V205 (high) The fix must not read as a promise
Not named, AI row: replace "Fix: Claim your free listing and work through the fixes below. That gives AI more to read. It can take days to weeks, and we can't promise AI will name you." with the label "What you can do:" and "Claim your free listing and work through the fixes below, so AI has more about you to read. AI assistants pick up changes over days to weeks. No one can make an AI assistant name a business."

## V206 (high) A 1-in-3 result must not look like first place
Partly report: before the list, say "Claude named you in 1 of 3 answers. In that answer you were 1st of 3. In the other 2 answers, Claude did not name you." Then the list. Same in the locked view. Generalize the numbers.

## V207 (medium) Counts that read like a computer
- "3 of its 3 answers" -> "all 3 answers"
- "in none of its 3 answers" / "none of 3 answers" -> "did not name your business in any of its 3 answers"
- "On the 2 other questions, Claude named your business in none of 2." -> "On the 2 other questions, Claude did not name you."; "2 of 2" -> "named you both times"; "1 of 2" stays.

## V208 (medium) Tie the two numbers together
Score by area: "You earned 18 of the 85 points we checked. That is 21 out of 100." Partial: "...of the 55 points we could check today."

## V209 (medium) Unlocked report sentence
Replace "Your score counts only Claude's answers to the first question, so it does not change when you open this report." with "Only Claude's answers to the first question count toward your score. The other answers are here to compare." (one-question and gate-off forms to match).

## V210 (medium) Who must act on the listing
Under "Claim my free listing": "Next, check the details and send it to us. Nothing goes live until you send it and we approve it."

## V211 (medium) Daily-limit AI row
Keep the "Not checked" label; detail: "We hit today's limit for AI questions, so this part has no score yet." Drop the extra "Not counted" next to it in this case.

## V212 (medium) About page
- "We ask Claude up to 3 questions. We ask the first question up to 3 times, because AI answers change."
- "We use Google's Gemini as a checker to see whether each answer names the business."
- "The person who ran the check can also see what Google's AI says right now. It is private to them, and we never save it, score it or share it." (only if that matches what the code does; otherwise say what it does.)

## V213 (low) Draft form help
- Short description placeholder: "One or two sentences about your business, like who you are and what you do."
- Services placeholder and hint agree: placeholder "List what you offer, like: repairs, new installs", hint stays "One per line, or separate with commas."
- When the category was guessed as Other: "We picked Other. Choose a better fit if there is one."
- Hours hint: "Type Closed for days you're closed. Leave a day blank only if your hours change."

## V214 (low) The prefilled form says so
On /grade?from=, one line above the form: "We filled this in from your last check. Change anything that's wrong, then press Check my business." (match the real button text).

## V216 (low) One form of "didn't"/"did not" per page; use "didn't" in plain sentences.

## V217 (low) Empty filtered home page
With no matches: "No plumbers in Nashville yet. Own one? List it free." (with the list link), using the category and city; keep the generic line when neither is set.

## V218 (low) Capitalize the service in "Your free listing in our directory" ("Plumbers in Nashville, TN"), as the fix kit does.

## V219 (low, check first) Hours on the home page
A test page with "Hours: Mon-Fri 07:00-18:00" got "We found no hours on your home page". Find out whether page-facts reads plain-text hours with 24-hour times; if it should and doesn't, fix and test; if it only reads JSON-LD hours by design, say so in the design.

## V220 (low, check first) Missing third question
On a Claude-failed report read soon after unlock, "Every answer" showed 2 of 3 questions with no note. If extras are still running, show the "still answering" note; test it.

## V215 (owner's wording, not changed) The home sentence is the owner's approved D3 text; the reader suggested "so AI has your details to read". Left as is unless the owner changes it.
