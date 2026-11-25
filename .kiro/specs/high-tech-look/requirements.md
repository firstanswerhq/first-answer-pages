# High-tech look and health orb (owner request, Nov 24, 2026)

Owner: Colby. Approved Nov 24, 2026. Build this after the V225 / V240-V251 batch is committed.
Mockups (reference only, do not copy their code as-is): `.kiro/specs/high-tech-look/mockups/look-1.html` (site look) and `look-3-health-orb.html` (report). The PNGs next to them show how they should look.

## Why
The demo video opens on a black-and-white 1950s family. The old phone book comes back from the dead as something bright and modern. The site should be that modern book: still clearly a phone book, but high tech. The AI Visibility Check report should show the business at the center with the health of each place AI and customers look.

## Rules that still apply
- wording.md and grader-safety.md apply to every new sentence. Plain words, no promise that AI will name a business.
- Every fix sentence is at most 160 characters.
- No third-party logos or brand icons anywhere. Use plain text names: Google, Facebook, Instagram, TikTok, Yelp.
- Keep the self-hosted fonts already in public/fonts. Do not add fonts from other sites. A system monospace stack is fine for labels.
- Do not fetch or read anything outside the project. No shell commands. I run the tests in the cloud.
- Record every changed older test line in the design's table.

## Requirement 1: Site look (look 1, "high-tech phone book")
1.1 Every page (home, category and city pages, listing pages, claim form, check form, report) uses a dark theme: near-black background, one main glow color (cyan), one accent (pink) and one highlight (amber). Put the colors in CSS custom properties in one place.
1.2 The home page main area looks like an open book: a glowing spine down the left edge and A-Z index tabs down the right edge on wide screens. The tab for the category being shown is lit. Tabs hide on phones.
1.3 Headline on the home page: "The phone book is back." with "And AI can read it." on the next line in the glow color. Keep the current sentence under it as the owner wrote it.
1.4 Listings show as cards with a soft glow. Verified listings get a stronger glow and the existing Verified label. Each card shows a small line listing the details AI can read for that listing (for example "Details AI can read: phone, hours, services, area"), built only from fields the listing really has.
1.5 Text and buttons meet WCAG AA contrast on the dark background. Focus outlines stay visible.
1.6 Respect prefers-reduced-motion: no glow pulses or movement when it is set.
1.7 The page must work at 390 px wide with no sideways scrolling.

## Requirement 2: Health orb on the report (look 3)
2.1 At the top of every finished report, show a "health map": the business name in a glowing orb in the center, with one node per signal around it, each joined to the center by a thin line.
2.2 Each node shows the signal name and a status label. Colors: green = good, amber = partly or not linked, red = missing, gray = not checked. Color is never the only cue: the label text always says the status.
2.3 Next to the map (below it on phones), the same signals appear as a plain text list with the same status words, so screen readers and search engines get the same facts. The orb itself is decorative (aria-hidden).
2.4 The orb animates slowly (a canvas of small particles turning). With prefers-reduced-motion, or if canvas is not available, show a still orb. The report must still load and read fine with JavaScript off.
2.5 The map shows the existing score in the center ("Health 68"). The new signals in Requirement 3 do NOT change the score in this version.
2.6 Signals shown (owner, Nov 24: "the health orbs need to be things we know help AI find the business"). Only these eight, chosen from published studies of where AI assistants get local business answers (BrightLocal 2026: business websites are about 42% of AI citations, Google Business Profile about 29%, Yelp about 10%, Facebook the only social site in the top 10; Search Atlas: page text that clearly matches what people ask was the strongest factor, then Google profile quality and reviews):
  1. Website: services and service area in plain words (existing checks)
  2. AI answers (existing)
  3. Google Business Profile
  4. Reviews
  5. Name and phone match
  6. Yelp
  7. Socials (owner idea, Nov 24): one main node with small sub-nodes around it for Facebook, Instagram and TikTok. Each sub-node is "Linked" or "Not linked" (Requirement 3.1 rules). The main node shows "2 of 3 linked" and is green at 3, amber at 1-2, red at 0. Facebook is listed first. In the text list and fix sentences, only Facebook may say it helps AI connect the business; Instagram and TikTok say they help customers find and trust the business, nothing about AI.
  8. Free listing (First Answer Pages)
  Do not add an Ads node.
2.7 Sub-nodes on every main node (owner, Nov 24: "sub orbs for all the orbs so it links everything First Answer Pages does"). Each main node has small sub-nodes, one per thing the check actually looked at, each with its own status. Only real checks get a sub-node; never invent one. Use the checks the report already runs, for example:
  - Website: use the checks grade-checks.js already runs, as sub-nodes: robots.txt lets AI assistants in (ai-bots-allowed), business label (business-labeled), info sheet llms.txt (info-sheet), sitemap (new, 3.9), title names city and service, one headline, summary, image descriptions, share picture, tap to call, hours, address, call button, reviews visible. Group them so the Website node has three small clusters: "AI can read it" (robots.txt, sitemap, business label, info sheet), "Search basics" and "Customer basics".
  - AI answers: answer 1, answer 2, answer 3 (named, partly, not named, or no answer)
  - Google Business Profile: found, category matches, hours listed
  - Reviews (owner, Nov 24): Google review count, Google star rating, and "Reviews shown on your website" (the existing reviews-visible check). Do not add Yelp review counts or replies to reviews; we have no honest way to read them yet.
  - Name and phone match: website phone, Google phone
  - Yelp: linked from website
  - Socials: Facebook, Instagram, TikTok
  - Free listing: listed, Verified stamp, Founding Member
  Kiro: list the exact sub-nodes in the design from the checks that exist after Requirement 3, and show me the list before building the map.
2.8 Moving light (owner: "lights moving in and out of the healthy links"): small glowing dots travel along each line between the center and a green node, both directions, steadily. Amber links send dots slowly and fade partway. Red links send no dots and the line shows a small break. Gray (not checked) links are dashed and still. Sub-node links behave the same way at a smaller size. With prefers-reduced-motion, no dots move; the line colors and labels alone show the status.
2.9 On phones, the map shows the main nodes only; tapping a main node opens its sub-nodes as a list below the map. The plain text list (2.3) always includes every sub-node and its status.

## Requirement 3: New honest signals
3.1 Yelp, Facebook, Instagram and TikTok: look only at the website pages the check already reads. If the site links to the business's own profile there, status "Linked from your website"; otherwise "Not linked". Share buttons, share intents, "sharer" links and links to the platform's home page do not count. Do not fetch any of those sites' pages.
3.2 Fix text when not linked (at most 160 characters), for example: "Add a link to your Yelp page on your website so people and AI can connect the two."
3.3 Google Business Profile: if the environment variable GOOGLE_PLACES_API_KEY is set, look the business up once per check with Google's Places text search, using the business name and city. Status "Found on Google" when a result's name and city match closely, otherwise "Not found on Google". If the key is not set, or the lookup fails or times out (5 seconds), status is "Not checked" and the check still finishes. Never show the key or raw error text. Count the lookup toward the daily limits the same way other paid calls are counted.
3.4 Reviews: from the same Google result, show the review count and star rating. Green at 10 or more reviews, amber at 1 to 9, red at 0. Gray "Not checked" when there is no Google result. Keep the thresholds in one named constant so the owner can change them.
3.5 Name and phone match: compare the phone number on the business's website with the phone on the Google result (digits only, ignore a leading 1). Status "Matches", "Doesn't match" (show both numbers), or "Not checked" when either is missing.
3.6 Free listing: "Listed" when a published First Answer Pages listing exists for this business (same match the claim flow uses), otherwise "Not listed yet" with the claim link.
3.7 Website and AI answers use the results the check already has. Do not change how they are scored.
3.9 Sitemap (owner, Nov 24): check whether the business website has a sitemap: read the Sitemap: lines in the robots.txt the check already fetches, and if there are none, request /sitemap.xml once (same fetch rules, size limit and timeout as the llms.txt request). Status "Found" when a reply is real XML with at least one <url> or <sitemap> entry, otherwise "Not found". Not scored in this version (2.5). Fix text, at most 160 characters, for example: "Add a sitemap so search engines and AI tools can find all your pages. Most website builders can make one for you."
3.11 "Speaks AI's language" (owner, Nov 24: "AI language on the website"). The Search Atlas study found the strongest factor is page text that plainly matches what people ask AI. Add a fourth cluster under the Website node with these sub-nodes, read only from the pages the check already fetches:
  - "Says what you do": the type of business or a service word from the check form appears in the page's visible text (not only in the title).
  - "Says where you work": the city or service area from the check form appears in the visible text.
  - "Answers common questions": the page has a questions-and-answers section (FAQ heading, details/summary pairs, FAQPage markup, or two or more headings ending in a question mark).
  - "AI info sheet": the existing llms.txt check (move it into this cluster instead of "AI can read it").
  Each is Found / Not found with a fix of at most 160 characters, for example: "Add a short questions-and-answers section that answers what customers ask, like your prices, hours and the areas you serve." Not scored in this version (2.5). Never say these make AI name the business.
3.10 Note: grade-checks.js already has a hidden google-profile check. The Google lookup in 3.3 must reuse or replace it, not run a second lookup.
3.8 Every status label and fix sentence follows wording.md and grader-safety.md: no promise that any of these makes AI name the business.
3.5 Save the new signal results with the Grade so the report, recheck and claim flow read the same facts.
3.6 Website and AI answers use the results the check already has. Do not change how they are scored.

## Requirement 5: Keep everything Google, Bing and AI read (owner: "we can't forget what this thing does")
The site is open to Google and Bing and is built so AI can read business details. The new look must not change any of that.
5.1 Every page keeps the same server-rendered HTML text, headings, title, meta description, canonical link and robots rules (index/noindex) it has today. The look is CSS and small scripts only; no content moves into canvas, images or JavaScript.
5.2 Every listing keeps its structured business label (the LocalBusiness JSON-LD) exactly as today, and the listing's phone, hours, services and area stay as plain text on the page.
5.3 sitemap.xml, robots.txt and the noindex rules for reports and empty filtered pages stay as they are.
5.4 No new client-side rendering for content. Pages must read the same with JavaScript off.
5.5 Pages stay fast: no large images or videos added; the orb script is small and loads after the page content.
5.6 Tests: the existing SEO, JSON-LD, sitemap and noindex tests keep passing unchanged, plus a test that the home page and a listing page contain the same visible text before and after the theme change.

## Requirement 6: Owner can waive the verification fee (owner request, Nov 24)
The owner will list a few of his own businesses and will not pay for his own verification.
6.1 On the admin listing page, add a button "Waive the verification fee" for a listing that is not verified yet. Pressing it lets that listing start verification with no payment step.
6.2 The phone code and photo ID steps still happen exactly as for everyone else. The Verified stamp still means the owner passed both checks. Only the payment is skipped.
6.3 Record who waived the fee and when, and show "Fee waived by admin" on the admin page. Nothing about the waiver shows to the public.
6.4 Waived listings count toward the Founding Member spots the same way paid ones do.
6.5 Admin-only: the route needs the existing admin sign-in and form protection. Tests cover: not signed in is refused, the payment step is skipped, the phone and ID steps are still required, and the record is saved.

## Requirement 7: Full healthy-setup coverage (owner, Nov 24)
7.1 healthy-setup-checklist.md in this folder is the master list. Build every item marked HAVE, ADD or KEY as a sub-node in the health map and a row in the plain text list. Items marked LATER are not shown.
7.2 Where this file and the checklist differ, the checklist wins for which checks exist; this file wins for wording, safety, SEO and test rules.
7.3 Main nodes become: Website (clusters: AI can read it, Speaks AI's language, Search basics, Customer basics), AI answers, Google profile, Reviews, Details match (A1-A5), Links (F1-F5 plus Yelp and Socials), Free listing.

## Requirement 8: It must work for any business a judge types in (owner, Nov 24)
A judge may enter any real company. Every check must give a true answer or an honest "Not checked", never a wrong red or a crash.
8.1 Handle, with a test for each: no website; a site that only shows text after scripts run; a site that times out, redirects many times, blocks bots (403/429) or returns a parked or "coming soon" page; very large pages; non-English pages; a chain with many locations (pick the one in the typed city, or say "Not checked" if unsure); a service-area business with no public address; two Google results with similar names (pick only on a clear match, else "Not checked"); a business outside the US; a typo in the name or city.
8.2 When a check can't be sure, it says "Not checked" with a one-line reason, never "Not found". "Not found" is only for when we looked and it is truly missing.
8.3 Each outside call has a timeout, and the whole check still finishes in the same time limit it has today. One failed signal never stops the others or the report.
8.4 Daily limits and bot protection still apply to the new lookups.
8.5 Claude will run a "judge test" after the build: 25 real businesses of different kinds and cities through the full check, and compare each signal with what a person sees by hand. Every mismatch becomes a fix before go-live.

## Requirement 10: Monthly health watch (owner, Nov 24). Build only if time allows, after Requirements 1-8 and before 9.
10.1 For Verified listings (and later a paid plan), re-run the full health check once a month and email the owner the health map, calling out every light that changed since last time (for example "Your Google hours no longer match your website").
10.2 Free listings keep the self-serve check and Recheck; no automatic runs for them.
10.3 The monthly runs share the daily AI and lookup limits; spread them across the month so they never use more than a set share (a named constant, default 25%) of each day's limit.
10.4 The owner can turn the emails off with one link; the admin page shows each listing's last and next run.
10.5 Never describe this feature anywhere on the site until it is built and tested.

## Requirement 9: Receipts in the AI lookup (owner, Nov 24; from Moltbook agent answers to Q8/Q9). LAST step; skip if time runs short.
9.1 The listing lookup tool (server/lib/mcp.js) adds, for each field it returns (phone, hours, services, area, website): the date it was last confirmed and by whom ("business" for owner-confirmed, "First Answer phone and ID check" for the Verified check), or null when unknown. Never invent a date.
9.2 Every lookup answer includes fetchedAt (the time the answer was built).
9.3 "Verified" only ever appears with who checked and when. Owner confirmation keeps the existing "Details confirmed by the business" wording with its date.
9.4 Tests: dates match stored data, null when missing, fetchedAt present, no "verified" without who and when.

## Requirement 2.10: One-time scan when the health map appears (owner, Nov 25)
2.10.1 The first time the health map scrolls into view, play a short "scan" (about 3 seconds, once per page load): the main nodes light up one at a time in a fixed order, a caption under the map names each check as it turns its color, and the center counts up to the score.
2.10.2 The final state is exactly the normal map; the scan never shows a status the list does not show, and never shows a different number from the score.
2.10.3 Reduced motion, JavaScript off, or a hidden tab: no scan, the map shows its final state at once. The caption is aria-hidden (the list already has every fact).
2.10.4 Tests: final state equals the no-scan state; reduced motion skips it; it runs once.

## Requirement 11: Fair use of the AI part of the check (owner, Nov 25)
Why: a new check asks several AI assistants and makes paid Google and Bing lookups, so repeated new checks on the same business cost real money. "Check again" (website only, no AI, no new paid lookup) stays free and unlimited.
11.1 One full check with AI per business per 7 days. A business is the same when the website's registered domain matches (shared hosts like facebook.com or wixsite.com use the full page path, as in name-match SHARED_DOMAINS), or, with no website, the same name and city after normalizing.
11.2 When someone starts a new check for a business that already has one from the last 7 days, do not run a new AI check. Show a short page: "This business was checked on <date>. Open that report and use Check again to see your website changes. AI assistants usually take days to weeks to notice changes, so we ask them again after <date>." with a button to that report. The report link is only shown to the person who ran it before (same browser cookie or the email they gave); anyone else sees the same message with no link and the date the AI can be asked again.
11.3 The admin (owner) is never limited, so he can test.
11.4 Verified listings are not limited for their own business (the monthly health watch in Requirement 10 also covers them).
11.5 The existing limits stay: GRADE_NETWORK_PER_DAY, the daily AI budget and the bot check.
11.6 The 7 days is one named setting, GRADE_AI_REPEAT_DAYS (default 7, 0 turns the limit off).
11.7 Tests: same domain within 7 days is sent to the message; different page on a shared host is not; day 8 runs; admin and Verified are not limited; "Check again" is unaffected; the message is 160 characters or less per sentence, American spelling.
11.8 A paid "ask AI again sooner" option is NOT built now; it waits until real cost per check is known from the provider dashboards.

## Requirement 12: Website still alive (owner, Nov 25; idea from Moltbook Q9 answers)
Why: an expired security certificate or a website address that no longer works means browsers show a warning or nothing, and AI assistants can't read the site. Both are public facts we can check for free on every check, with no paid lookup.
12.1 Add a "Website is reachable" cluster under the Website node with two sub-nodes, read from the same connection the check already makes (no extra paid call):
  a. Security certificate: green when valid for more than 30 days; amber "Expires in N days" when 30 or fewer; red "Expired on <date>" when expired. "Not checked" when the site is http-only or the date can't be read.
  b. Website address works: green when the address resolves and answers; red "Your website address doesn't load" only when the name no longer resolves (DNS NXDOMAIN) on two tries; a timeout or any other error is "Not checked", never red.
12.2 Never tell the owner the business "may have closed". The fix sentences tell them what to do ("Renew your website's security certificate so browsers and AI can open your site.").
12.3 Listings side (admin only): when a listing's website shows an expired certificate or an address that no longer resolves, show a "Website may be down" note on the admin page so the owner can look before trusting the listing. Never shown publicly.
12.4 No WHOIS or RDAP lookups in this version.
12.5 Tests with a fake connection: valid, expiring, expired, http-only, NXDOMAIN twice, NXDOMAIN once then OK, timeout; score unchanged; sentences 160 characters or less, American spelling.

## Requirement 4: Tests
4.1 Unit tests for profile-link detection, including share buttons, tracking parameters, mixed case, www and m. subdomains, and pages with no links.
4.2 Tests for the Google lookup with the key missing, a match, no match, an error and a timeout (fake the network; no real calls in tests).
4.3 Tests that the report shows the health map and the plain text list with the same statuses, that the orb is aria-hidden, and that no third-party logo images or brand icon fonts are used.
4.4 Tests that the score is unchanged by the new signals.
4.5 All existing tests keep passing, or each changed line is listed in the design's table with the reason.

## Order of work
1. Requirement 3 (signals and saving them), with tests.
2. Requirement 2 (health map), with tests.
3. Requirement 2.10 (scan), Requirement 11 (fair use) and Requirement 12 (website still alive), with tests.
4. Requirement 1 (site look), with tests.
Stop after each step and tell me what changed, so I can run the tests and review before the next step.
