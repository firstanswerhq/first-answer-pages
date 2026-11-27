# Three new features for the AI Visibility Check and listings (approved by the owner, Nov 18, 2026)

Colby ran the live check on a real client: a window and pressure washing company in Tallahassee that goes to its customers and has no storefront, and that has 52 five-star Google reviews. Two things showed up that the check should handle for every small business. He approved both ("yes and yes"). This note is the request; Kiro writes the spec changes and builds it.

How to do this, in order:
1. Add both features to the ai-visibility-grader spec: new numbered requirements in requirements.md (user stories with acceptance criteria in the existing style), the matching sections in design.md, and a new section of tasks in tasks.md headed "Owner-approved features (Nov 18)" (F1, F2, ...), placed after the "Review fixes" section. Then stop, so the spec can be reviewed before any code is written.
2. After the review, build the tasks one at a time. No shell commands; the cloud runs the tests and sends back failures.
3. Follow .kiro/steering/wording.md and grader-safety.md: plain words, American spelling, never promise AI will name a business, never invent, copy or edit reviews.

## Feature A: Businesses with no storefront (service-area businesses)

Many small businesses (cleaners, roofers, plumbers, mobile services) go to their customers and don't show a street address. Google lets them hide their address and show a service area instead. Today the check's "Street address on the home page" check fails them, even though its own fix text says "or your service area if you travel to customers".

What it should do:
- The form gets one more optional checkbox: "We go to our customers (no storefront)". It is stored with the Grade.
- When it is ticked, the address check becomes "Service area on your home page". It passes when the home page names the area served, for example "Serving Tallahassee and nearby areas", "Service area:", "Areas we serve", "We serve ...", the city name followed by "and surrounding areas", or an `areaServed` value in the page's business label (JSON-LD). Same points as the address check. Its fail text and fix talk only about the service area, never about a missing address.
- The free listing preview shows "Serves the <city> area" instead of "Add your address".
- The fix kit's business label for these businesses uses `areaServed` (the city and state) and leaves out `address`/`streetAddress`.
- Claim: the Draft for these businesses leaves the address empty and fills the listing's existing `serviceArea` field (for example "Tallahassee and nearby areas"). Listings already treat address as optional and already have a `serviceArea` field; check the listing page and its business label read well without an address.
- Without the box ticked, everything works exactly as today.
- Tests: add example tests for the form box, the check passing and failing in both modes, the preview line, the fix kit label and the claimed Draft. Never change or loosen existing tests; if an existing test's numbers must change because of a new requirement, say exactly which and why.

## Feature B: Reviews AI can see

The client has 52 five-star Google reviews, but Claude's answer said it "didn't see a star rating for it in the results". AI assistants often can't see reviews that live only inside Google. The check should tell owners this and show them how to fix it.

What it should do:
- A new check, "Reviews AI can see", in the Customer basics group. It passes when the home page shows real review signals AI can read: review or testimonial text ("reviews", "testimonials", a quoted customer comment with a name), a rating written out ("5.0 stars", "4.9 out of 5", "★★★★★"), a link to the business's reviews on Google (google.com/maps, g.page, maps.app.goo.gl, search.google.com/local), Yelp (yelp.com/biz), Facebook or Nextdoor, or review data in the page's business label (`aggregateRating` or `review`).
- Fail text: plain and specific, e.g. "We found no customer reviews on your home page. AI assistants often can't see reviews that are only inside Google." Fix: "Put 3 or more of your real customer reviews on your home page, with each customer's first name and the date, and add a link to your Google reviews." Never suggest writing, editing or copying reviews from anywhere without the source.
- Scoring: it is worth points in Customer basics. Keep the total at 100. Propose the new point split in design.md, and update the score fixtures and any test that pins the old totals, listing every number that changes and why, so the reviewer can check nothing else moved.
- The free listing gets an optional "Reviews link" field (an https link to the business's Google, Yelp, Facebook or Nextdoor reviews), shown on the listing page as "See our reviews on Google" (or Yelp, and so on). Claim fills it when the home page has such a link. Validate it as an https link to one of those sites only. The listing page shows only the link, never a star rating or review count.
- Tests: example tests for passing and failing pages (each signal type), the fix text, the new listing field (valid and invalid links), and the claim fill.

## Feature C: Link each listing to the business's own website (approved Nov 18, 10:27 PM)

Listings don't store or show the business's website today, so search engines and AI that read a listing page can't connect it to the business's real site.

What it should do:
- Listings get an optional "Website" field: an https link to the business's own site (validated as a public https URL; no IP addresses, no login or tracking parameters kept).
- The listing page shows it as a plain "Website" link, and the listing's business label (JSON-LD) adds it under `sameAs` (the label's `url` stays the listing page).
- The owner form and the admin review page show and edit the field like the other optional fields.
- Claim from the AI Visibility Check fills it from the website the owner typed on the check.
- `llms.txt` and the MCP tools include the website for listings that have one.
- Tests: example tests for valid and invalid links, the listing page link and label, the claim fill, and llms.txt. Never change or loosen existing tests.

## Feature D: Let Google and Bing find the main pages (added Nov 18, 10:50 PM)

Colby's goal, in his words: "We want google to find these companies when it crawls our site, and we want Bing to do the same." The site is now in Google Search Console and Bing Webmaster Tools. Listings already reach the sitemap (each approved listing and its category page) and Bing gets an IndexNow ping on approval. Two gaps remain:

1. sitemap.xml lists only the home page, category pages and listings. Add the public pages that exist today: `/about`, `/verified`, `/privacy` and `/rise` (List your business free). Only pages that return 200 and are not marked noindex go in.
2. The AI Visibility Check's start page is hidden from search today, because Requirement 9.6 keeps every `/grade` page out of the sitemap and every `/grade` response sends `X-Robots-Tag: noindex, nofollow`. Open exactly two pages to search engines: the form at `GET /grade` (no query string) and `GET /grade/about`. Each sends no noindex header or meta, has a plain title and summary for search results, and goes in sitemap.xml. Everything else under `/grade` stays exactly as it is today: every report (`/grade/:id`), the status JSON, the claim flow, every error page, the form when it is shown again with errors, and `/grade` when the grader is off (GRADER_ENABLED=off) keep `noindex, nofollow`, `no-referrer` and `no-store`, and stay out of the sitemap, llms.txt, MCP and IndexNow. Update Requirement 9.6 (and the matching design.md text) to say this, and do not change any rate limit or AI budget.

Tests: the sitemap lists the four pages and `/grade` and `/grade/about`, and still lists no report, draft or admin address; `GET /grade` and `GET /grade/about` send no noindex; a report page, the status JSON, the claim pages, a form shown again with errors, and the grader-off 404 still send `noindex, nofollow`. Never change or loosen existing tests; if an existing test pins the old "every /grade page is noindex" rule, say exactly which one and why it must change.

Build D after the F tasks for A, B and C. Claude will confirm with Colby before D starts.
