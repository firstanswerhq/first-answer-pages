# Batch 3 fixes (Nov 25, 2026)

Review: review-2026-11-25-batch3.md (NO-GO, X1-X16). Fix all of them, using its fixes. Must-fix first (X1-X7).

Owner decisions (Claude decided on the owner's standing "whatever you think is best"):
- X5 (changes Requirement 11.1): two checks are the same business only when the website is the same AND (the host is the same, or the city and state are the same). Franchise locations in different cities on one domain, and different pages on shared hosts (facebook.com, instagram.com, yelp.com, linktr.ee, sites.google.com, etc.), are different businesses. Keep the page path for shared hosts.
- X6: checks run by the admin are marked and never block anyone else.
- X7: the no-website match uses name + city + state.
- X11 (changes Requirement 12.1a): amber only when the certificate expires in 7 days or fewer (many healthy sites renew automatically about 30 days before expiry). Green above 7 days.
- X15: run the fair-use lookup after the bot check and the per-network rate limit, so nobody can probe "was this business checked" without limits.

Rules as always: score and public SEO unchanged, sentences 160 characters or less, American spelling, nothing promising AI will name a business, tests for each item, record in the design table. Do not edit requirements.md. Do not run shell commands, including "exit".
