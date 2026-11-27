Verdict: NO-GO

Reader review of Step 2, the "Health of your setup" section, on the Riverbend Plumbing Co. sample (http://localhost:8765/report.html). I read it twice, once as a contest judge with 2 minutes and once as a non-technical small-business owner. I used the six screenshots, a 2x zoom of the map, and Playwright on desktop (1280) and phone (390, tapping the Website node). I changed no code.

NO-GO comes from H1 to H5. A judge would read these as wrong, contradicting, or broken. Everything after H5 is polish.

## How the two readers experience it

**The judge (2 minutes).** The dark map with the glowing teal center looks good and clearly "high tech". Then they read "These lights don't change your score" and, in the middle of the map, "Health 69", which is the same number as the 69 / 100 just above. Are these two numbers or one? Next to the map, the list says "Address on the page: Good" and a few lines later "We need a street address on both your website and Google to compare." Then they see "AI answers: Not checked / Answer 1: Not checked / There was no answer to read" on an *AI* visibility checker, followed by "What AI says: The assistant didn't answer this time." So the headline feature looks empty.

**The owner.** The list is mostly plain, but many lines just repeat themselves ("Found on Google: Found on Google", "Category fits: Category fits", "Hours listed: Hours listed"). It also uses words they won't know: robots.txt, Sitemap, llms.txt, Summary, Share picture, Business label, Bing map data. They can't read the small words on the map. Also, the "Free listing: Partly" light makes it look like their setup is unhealthy because they haven't joined our directory.

## Items

### H1. "Health 69" in the center versus "These lights don't change your score" (must fix)
- **Where:** the center of the map ("Health 69"), the intro line under the heading, and the "69 / 100" at the top of the page.
- **Problem:** The intro says the lights don't change the score. The center then shows a number with a new name ("Health") that equals the score. A reader can take it three ways: a second metric that happens to match, the lights adding up to 69, or the score renamed. Two names for one number is the most confusing thing in the section.
- **Fix:** Use the score's own name and form in the center: "Score 69/100" or "69 / 100". In the intro, say what the lights *are* instead of what they don't do: "Every check we ran, at a glance. Green is good, amber is part way there, red needs work, gray means we couldn't check it. Your score is at the top of the page." If you keep a center number, label it the same way the top of the page does.

### H2. The address is "Good" and also "missing" (must fix; looks untrue)
- **Where:** In the Website list, "Address on the page: Good". In Details match, "Address matches Google: Not checked. We need a street address on both your website and Google to compare." In the free-listing preview, "Address: Add your address".
- **Problem:** Three places say three different things about the same address. A judge reads this as a bug.
- **Fix:** If the page has an address the compare step can't parse, say that: "Not checked. We found an address on your website but couldn't match it to Google. Check that it's written as one line, for example '123 Main St, Nashville, TN 37201'." If Google has no address, say "Google doesn't show a street address for you." The listing preview should pre-fill the address you found, or say "Add your street address".

### H3. "Not linked" and "Not found" are labeled "Partly" on the map (must fix; map and list contradict)
- **Where:** On the map, the Links sub-nodes for Instagram, TikTok, "Website links to Yelp" and "Website links to your Google profile" all read "Partly". In the list they read "Not linked". On the map, "Found on Bing" reads "Partly" while the list says "Not found in Bing map data".
- **Problem:** Something that is not linked at all is not "partly" anything. The same word "Not found" is also red ✕ for Business label but amber ! for Bing, so one word has two severities.
- **Fix:** On the map, show the row's own short status ("Not linked", "Not found") instead of the generic status word, or use one amber word that fits every case ("To do"). Make "Not found" the same color everywhere, or reword Bing as "Not on Bing Maps yet" so it doesn't share the word with a red row.

### H4. The map's words can't be read (must fix; looks broken)
- **Where:** The map on desktop and phone. Measured on screen: the words in the seven main circles (Website, Partly, and so on) are about 8 px tall on desktop and smaller on a 390 px phone. The words on the small outer circles ("Good", "Needs work", "Not checked") are about 6 px tall and rotated.
- **Problem:** At normal size, or in a 1080p contest video, the outer words are fuzz. The rows that can be read say only "Good Good Good Needs work Good". Nothing says *which* check is good, so the outer ring carries no information.
- **Fix:** Make the main-circle text at least 13 px on screen at every width (bigger circles, or a bigger map: on desktop the map is about 440 px wide next to a long list, and it could be wider). Drop the rotated status words from the outer circles. Let the icon and color carry the status, and show the check name ("Hours on the page: Needs work") on hover or tap in a single readable caption under the map.

### H5. The AI answer is empty on an AI visibility checker (must fix for the demo)
- **Where:** In the map, "AI answers: Not checked". In the list, "AI answers: Not checked / Answer 1: Not checked / There was no answer to read." Under "What AI says", "The assistant didn't answer this time."
- **Problem:** The product's headline promise is to show what AI says about you. In the sample a judge will see, that part is blank twice and gray. "Answer 1: Not checked" with no question shown also looks like a placeholder.
- **Fix:** For the contest sample and video, use a run where the AI answer exists. In the live product, merge the two empty rows into one plain row: "AI answers: Not checked. The AI assistant didn't reply this time. Run a new check later to see what it says about you." Don't show "Answer 1" when there is no answer.

### H6. Jargon with no plain explanation
- **Where:** In the Website list: "robots.txt lets AI assistants in", "Sitemap", "AI info sheet (llms.txt)", "Business label", "Summary", "Share picture", "One headline". In Details match: "Not found in Bing map data".
- **Problem:** The owner doesn't know these words. "Summary: Not checked" could mean anything.
- **Fix (label, then a short plain status or a one-line note):**
  - "robots.txt lets AI assistants in" → "Your website lets AI assistants read it: Yes".
  - "Sitemap: Found" → "Page list for search engines (sitemap): Found".
  - "AI info sheet (llms.txt)" → "A short info file for AI (llms.txt): Found". This is fine if the plain words come first.
  - "Business label" → "Name, phone and address tagged for AI: Not found". The fix card already calls it "business label block", so change both.
  - "Summary" → "Search summary (the 2 lines under your link in Google)".
  - "Share picture" → "Picture shown when someone shares your link: Needs work".
  - "One headline" → "One main headline on the page".
  - "Not found in Bing map data" → "Not on Bing Maps yet".

### H7. Rows that repeat themselves
- **Where:** "Found on Google: Found on Google", "Category fits: Category fits", "Hours listed: Hours listed", "Words are in the page itself: Found in the page", "Google profile links to your website: Links to your website", "robots.txt lets AI assistants in: Open to AI assistants".
- **Problem:** It reads like a machine filled in a template. Judges notice this.
- **Fix:** Make the label the question and the status a short answer: "On Google: Yes", "Category: Fits", "Hours on Google: Listed", "Text AI can read: Yes", "Google links to your site: Yes".

### H8. "Free listing: Partly" scores our own sign-up as a health problem
- **Where:** The Free listing main node (amber "Partly") and the rows "Listed on First Answer Pages: Not listed yet" and "Verified stamp: Not checked. No listing yet." The Founding Member line follows.
- **Problem:** Next to real problems, an amber light for "you haven't joined our directory" looks self-serving to a judge and blaming to an owner. "Verified stamp: Not checked" is also not true: we didn't fail to check, there's nothing to check. Design R17 says sales information should have no health color.
- **Fix:** Show the Free listing node in a neutral (non-health) color with the status "Not started". Change the rows to "Listed on First Answer Pages: Not yet. It's free, claim it below." and "Verified stamp: Available after you claim your listing." Keep the Founding Member line as plain text.

### H9. One idea, several words
- **"Listing" means two things.** "Your listing matches your website" and "Your listing links to your website" mean the First Answer Pages listing, but under Google rows an owner reads them as the Google listing. Fix: "Your First Answer Pages listing ...".
- **Hours.** "Hours on the page" (list) and "Hours on the home page" (Fix these first). Use one.
- **AI.** "AI assistants", "AI", "the assistant". Use "AI assistants" everywhere, for example "The AI assistant didn't answer this time."
- **Calling.** "Tap to call: Good" and "Call button: Good" sit next to each other and read like the same check twice. Rename one, for example "Phone number works as a link" and "Call button near the top".
- **Section names.** The list groups are "AI can read it" and "Speaks AI's language". Score by area says "Can AI read your website", and "Speaks AI's language" has no score line. Use the same group names in both places.
- **Fix card title.** "Can AI see your reviews?" is a question, while the other two fix titles are plain labels. Use "Reviews on your website".

### H10. "4 of 12 checks need work" doesn't match what the reader can count
- **Where:** Under the business name, with the long list just below.
- **Problem:** The list shows about 45 rows, 5 red and about 12 amber. A reader can't find "12 checks", and it now competes with the lights.
- **Fix:** "4 of 12 scored checks need work. The lights below show every check, including ones that don't count toward the score." Or drop the line and let the map and list carry it.

### H11. Tone: sentences about us instead of the owner
- **Where:** "We couldn't check this on your website this time." "There was no answer to read." "We found no hours we can read on your website." "No Bing listing was found to compare."
- **Problem:** These are mild, but they describe our process. Tell the owner what it means or what to do.
- **Fix:**
  - "Couldn't check this time. Run a new check later."
  - "Add your hours as plain text on your home page and we'll compare them with Google."
  - "Once you're on Bing Maps, we'll compare your details."

### H12. Phone: tapping a node jumps away from the map
- **Where:** On the 390 px phone, tapping "Website" scrolls the page so the map is off screen and the Website list is outlined.
- **Problem:** It works, but nothing says the circles can be tapped, and after a tap there's no quick way back to the map. On the phone the circles also use only the middle half of the dark box, which leaves a lot of empty dark space.
- **Fix:** Add a small caption under the map: "Tap a circle to see its checks." Make the map fill the box on phones by using a larger radius, which also helps H4.

### H13. British spelling
None found in the section, the map script, or the page HTML. One near-miss is outside the section: the "Fix these first" card says "Write your opening hours". US readers say "business hours", and R19 chose "business hours". Change it to match.

### H14. Anything implying AI will name the business
Nothing found. "So AI can read your name and phone" and "AI assistants pick up changes over days to weeks" are honest. Keep it that way if the empty AI answer is reworded (H5): don't write "so AI will recommend you".

## Does the map look "high tech" enough for the contest video?

Mostly yes. The deep navy panel, the glowing teal core with particle dots, the dashed flowing connectors, and the green, amber and red rings read as a modern status console. That fits "the phone book comes back high-tech". The reduced-motion and no-JS screenshots look the same, so nothing breaks there.

It doesn't wow yet, for three reasons. It's small next to a long list. Its words can't be read (H4). And in a still frame it's static.

**The single change that would make it most impressive:** a one-time "scan" when the section comes on screen. Starting from the center, the connectors light up one main circle at a time. Each circle's outer checks pop in with their color, the check's name flashes in a caption under the map as it turns green, amber or red, and the center counts up to the score. That gives the video a 3 to 4 second "watch it check your business" moment, which is the story of the product, and it makes the map explain itself. Reduced motion should still show the final state at once. Do this together with the H4 size fix, because a scan of unreadable words won't come across on video.
