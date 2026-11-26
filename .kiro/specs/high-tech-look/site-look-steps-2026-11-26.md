# Requirement 1 (site look) in steps, so each step can be tested and reviewed on its own

Read requirements.md Requirement 1 (1.1 to 1.13) and Requirement 5 (keep everything Google, Bing and AI read) first.
Mockups: mockups/look-1.html and look-1.png (the look), mockups/reference-dark-dashboard-2026-11-25.jpg (mood for the live animation, never copy its text or logos).
Do not edit requirements.md. Do not run shell commands. Record every changed older test line in design.md. After each step stop and list the files you changed; Claude runs the full suite twice and sends reviewers before the next step.

Rules for every step
- Titles, headings, meta tags, JSON-LD, sitemap, robots, canonical and noindex stay exactly as they are. Add a test per step that renders the old and new pages and compares those parts (test/step1-public-unchanged.test.js already does this for some pages; extend it).
- Colors only as CSS custom properties in one place. Fonts: self-hosted ones already in public/fonts. No outside files, no libraries.
- Text and buttons meet WCAG AA contrast. Nothing under 12 px. Focus outlines visible. 390 px wide with no sideways scrolling.
- prefers-reduced-motion: no movement.
- American spelling, plain words, no promise that AI will name a business, no fake listings or counts.

Step 1A: the dark theme on every page (1.1, 1.5, 1.6, 1.7). Tokens, backgrounds, text, links, buttons, forms, the report and check pages. The report keeps its own health map colors.
Step 1B: the open-book home page (1.2, 1.3): spine, A-Z tabs on wide screens (the tab for the category shown is lit, tabs hidden on phones), the new headline with the owner's sentence kept under it.
Step 1C: listing cards (1.4, first part of 1.11): soft glow, stronger glow and the existing Verified label for Verified listings, the "Details AI can read: ..." line built only from the listing's real fields, hover and focus lift.
Step 1D: the live network (1.8, 1.9, 1.10, 1.12, 1.13). New file public/js/home-network.js and a CSS block. Real data only: the nodes come from the categories and listings the page already has (put them in the page as a plain HTML list of links, and let the script read that list). Drifting nodes, near nodes joined by fading lines, nodes ease apart, pointer and keyboard focus light a node and its lines, nearby nodes lean toward the pointer. Limits: 60 nodes wide / 24 phone, stop when hidden or off screen, 30 fps cap, fewer nodes if a frame is slow, still picture with reduced motion or no canvas. Tests: the script's math in small pure functions (positions, link opacity, node cap, still mode), the HTML list is present with JavaScript off, canvas is aria-hidden.
Step 1E: the check and report motion (rest of 1.11): the "Checking" page lights its steps as real work finishes (never faster than the real work); the health map's line pulses once on hover or focus of a node (the one-time scan from 2.10 stays).

Order: 1A, 1B, 1C, 1D, 1E. If time runs short, 1E can be dropped; 1D is the one the owner asked for by name ("live animation, things moving, interacting with each other"), so do not drop it.
