# Review round 6 of the Kiro grader rebuild (Nov 18, 2026)

The code reviewer re-ran its scripts on commit dc44a9d. All five V32 cases now pass (group headings keep their businesses, "Nashville Plumbing" and "The Local" are named again, business headings drop their detail bullets, offer-only lines are dropped). V1 to V11 and V22 still hold, security is unchanged, and the suite passes 1022/1022.

But V32 is only partly fixed: a real business heading with Title Case bullets is now read as a group heading. Add V34 to tasks.md under "Review fixes", fix it in server/lib/name-match.js, and add example tests for every case below to test/grade-name-match.test.js (additions only). No shell commands.

V34. A business heading with Title Case detail bullets must stay a business.

What breaks now (confirmed by running):
- `### 1. The Catbird Seat` followed by `- Known For: Tasting Menu`, `- Price Range: $$$$`, `- Must Try: ...` (the same shape for Bastion and Rolf and Daughters): all three restaurants vanish and the competitors become "Known For", "Price Range" and "Must Try". Commit cdb55bb kept them.
- `**1. Mr. Rooter**` followed by `- Best For: Drain Clogs`: the business's own position becomes null and Hiller is lost.
- `### 1. The Local` followed by `- Neighborhood Favorite`: the business is not named, which costs 30 points. `heading()` never applies the `own()` guard. cdb55bb and the original named it at position 1.

What to do:
- Apply the `own()` guard in `heading()`: a heading that matches the business itself is always that business, never a group.
- Ignore "Label: value" bullets (anything before a colon, like "Known For:", "Best For:", "Price Range:") as names; they are details.
- Treat a heading as a group heading only when its text holds a plural group noun ("Plumbers", "Picks", "Options", "Restaurants", "Spots") or a category/place word, or when the bullets after it themselves look like business names (not "Label: value" and not offer phrases). Otherwise a numbered heading is one business and its bullets are details.
- Keep everything that works now: the V32 group cases, "Nashville Plumbing" under a group heading, "The Local" listed first, offer-only lines dropped, "Family Owned Roofing & Repair" kept.
