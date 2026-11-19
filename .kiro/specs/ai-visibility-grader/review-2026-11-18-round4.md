# Review round 4 of the Kiro grader rebuild (Nov 18, 2026)

The code reviewer re-ran its scripts at commit 23b236c. V22 is fixed. V1 to V11 all still hold, the suite passes 1015/1015, and security is unchanged (address guard fuzz 0 differences, safe fetcher unchanged, every new HTML value escaped, no new log lines).

V23 is not fixed: it now drops real business names. Add V32 to tasks.md under "Review fixes" and fix it in server/lib/name-match.js. No shell commands.

V32. Rework the V23 change so it never loses real names.

What broke (confirmed by running):
- name-match.js now skips every bullet after any numbered heading it reads as a name, including group headings. AI answers often group businesses like this:
  - `### 1. Emergency Plumbers` / `### 2. Budget Picks` with businesses as bullets: the competitors became the two headings, and Hiller, Mr. Rooter and Plumbing Pros were lost (the business's position became null).
  - `### 1. Fine Dining` / `### 2. Hot Chicken` for restaurants: Bastion, Hattie B's and Prince's were lost.
  - Neighborhood groups: `**1. Germantown**` / `**2. East Nashville**`.
- The AI check can flip and cost 30 points: "Nashville Plumbing" listed under `### 1. Emergency Plumbers` was named in position 2 before the change and is not named now.
- The top-level offer-word filter dropped a real restaurant called "The Local" listed first: it was named, now it is not.

What to do:
- Treat a heading as a business heading (its bullets are details) only when the heading text looks like one business: it contains a trade or legal word (Plumbing, Roofing, LLC, Inc, Co.), a possessive, or bold business-style text. A heading that names a group, a category or a place ("Emergency Plumbers", "Budget Picks", "Fine Dining", "Hot Chicken", "Germantown") is a group heading, and its bullets are business names.
- Never filter out an entry that matches the business itself.
- Drop offer-only lines only when the whole line is one of a short list of phrases ("Free Estimates", "Same Day Service", "Same-Day Service Available", "24/7 Emergency Service", "Licensed and Insured", "Family Owned"), not when a name merely contains offer words.
- Keep what works: numbered bold names with detail bullets, plain paragraphs, indented detail lines, and "Family Owned Roofing & Repair" as a real name.

Add example tests for these cases to test/grade-name-match.test.js (group headings for plumbers and restaurants, neighborhood groups, "Nashville Plumbing" under a group heading, "The Local" listed first, a business heading with detail bullets, and offer-only lines), so this can't come back. Adding tests is fine; do not change or loosen existing tests.
