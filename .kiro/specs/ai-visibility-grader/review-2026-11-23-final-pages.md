# Review notes: final page read of the whole branch (Nov 23, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
A fresh reader walked every page and flow at commit ddba419 (390px and 1280px, 76 page states). Verdict: NOT READY, close. No rule broken anywhere (no promise that AI will name a business, American spelling, no dollar figures, nothing scrolls sideways).
Items the owner must decide are NOT here (the score changing when the full report opens, "PASS" on a weak AI result, the home page headline, what a claimed listing pre-fills as Services and hours). Do not change scoring, points or what is counted.

Page text and small display fixes only. Update the requirement and design lines that quote changed sentences. Change an older test only on a line that quotes a changed sentence, and list each such line. Some of this text is older than the features built this month; fix it anyway and say so.

## V134 (Blocker) A site we could not read gets a score with no reason
Locked report: "43 / 100" and "1 of 3 checks need work"; the words "We couldn't read your home page" appear only inside the unlocked report. An owner whose site blocks our reader takes this as a bad grade.
Under the score, on the locked AND the unlocked report, show a notice in the same style used when Claude does not answer:
"Partial score: we couldn't read your home page, so most website checks aren't counted. Your website may be blocking automated visitors."
When the website address could not be reached at all (today: "Not enough to score yet" with no reason), add under it: "We couldn't reach <host>. Check the spelling and run the check again." (the host escaped; never the full typed address with a query).

## V135 Say how the score relates to the area points
"86 / 100" sits above areas that add to 73 of 85. Add one hint line under "Score by area": "Your score is the share of the points we could check: 73 of 85." (the two numbers are the sums already shown). No change to the score.

## V136 Failing checks must not be named as if they passed
A red "!" sits beside "AI assistants are allowed in", then "Blocked: ChatGPT (GPTBot), Claude (ClaudeBot)". Give these checks neutral names that read right for pass and fail:
- "AI assistants are allowed in" becomes "Can AI assistants get in?"
- "Business name and phone labeled for AI" becomes "Business label for AI"
- "Page title names your city and service" becomes "Page title"
Go through every Check label once and fix any other that states a pass as a fact. List each rename. Stored Grades keep working (labels are not stored keys; if any is, say so and stop).

## V137 The fix kit label block when we found no phone
The box says "Paste this into your home page so AI can read your name and phone", but the block has no phone line, so the fix cannot pass. When no phone was found, add `"telephone": "ADD YOUR PHONE NUMBER"` to the block and a line above it: "Put your phone number in before you paste." Never invent a number.

## V138 "Check again" pressed twice
Second press within two minutes shows "Please slow down. We have had a lot of checks from your internet connection." with "Back to the check" (the empty form).
For this case show: "You just checked again. Please wait two minutes." with a link "Back to the report" to that report. The limit itself does not change.

## V139 Daily limit with no website
Shown together: "We could only run the AI check. Add a website to get a score." and "We couldn't ask AI this time. The daily limit for AI checks was reached."
When there is no website and the AI part did not run because of the daily limit, the first line becomes: "We couldn't run any checks this time. Please try again tomorrow."
When the daily limit is the reason, "You can run the check again later" and "Check again later for your full score" say "tomorrow" in place of "later".

## V140 Repeated words when Claude does not answer
"We couldn't ask AI this time. AI didn't answer this time. You can run the check again later." becomes "Claude didn't answer this time. Please run the check again later."

## V141 "Free, no sign-up" against the contact form
The /grade description says "Free, no sign-up." and the full report asks for name, email and phone when the lead gate is on. Change to "Free. No account needed." (everywhere that phrase appears, including the title or description of /grade).

## V142 Small wording
- "1 of 1 pictures have no description." reads "Your 1 picture has no description." (and "2 of 5 pictures have no description." stays).
- "none of 3 answers", "0 of its 5 answers" and "any of 5 answers" say the same thing three ways: use "none of" with the count everywhere ("none of its 5 answers").
- The page title "Not today" becomes "That is all for today".
- Form error text is shown in sentence case, not all capitals ("Type your business name (up to 120 characters).").
- The privacy page writes "AI Visibility Check" with capitals, as everywhere else.
- "Every answer": Claude's answers come first under every question.
- robots.txt kit: "Add these lines" becomes "Replace the lines that block these assistants with these lines."
- /grade/about: "Each is read at most once" becomes "Each is read at most once per check."
- The form intro "We ask an AI assistant who it would name" becomes "We ask AI assistants to name the best businesses like yours in your city, and see if they name you."

## V143 Tab titles in one style
Three styles are in use ("First Answer Pages: Local Business Directory", "Plumbers in Nashville | First Answer Pages", "List your business free: First Answer Pages"), and "About the AI Visibility Check" and "Thanks!" have no site name. Use "<page> | First Answer Pages" on every page; the home page stays "First Answer Pages: Local Business Directory".

## V144 US address style
"410 Woodland St, Nashville, TN, 37206" has a comma before the ZIP. Write "410 Woodland St, Nashville, TN 37206" wherever an address is shown as one line. In the fix kit label, put only the street in `streetAddress`, with city, state and ZIP in their own fields.

## V145 To check and report, no change yet
- The email given to open the full report is not carried into the draft's "Your email" box, though the thank-you page says "If you gave us your email, we'll let you know when it's live." Is that by design (privacy)? Say what the design says.
- A category page for one city ("Plumbers in Nashville") has a canonical link to `/?category=plumbers`, without the city. Is that intended?
