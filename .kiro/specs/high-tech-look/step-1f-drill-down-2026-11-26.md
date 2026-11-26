# Step 1F — Health orb drill-down

The health map (the circles around the orb) becomes interactive.
The click/tap hints already exist in the HTML but nothing happens yet.
This step makes them work.

## What to build

### Level 1: tap a main circle → expand to sub-checks

When the visitor clicks or taps one of the seven main circles (Website,
AI answers, Google profile, Reviews, Details match, Links, Free listing):

1. The other six main circles and the orb fade to 20 % opacity.
2. The tapped circle moves to the center and grows (CSS transition,
   ~400 ms ease-out).
3. Its sub-check circles appear around it, sized and colored by their
   status (green / amber / red / gray). Each sub-check circle shows
   its short name from SUB_NODES and its status symbol.
4. A small × close button appears in the top-right corner of the map.
   Clicking it (or pressing Escape, or clicking outside the expanded
   area) returns to the overview with a reverse transition.
5. On phones the sub-checks can stack vertically in a scrollable column
   beside the expanded circle if they don't fit in an orbit.

### Level 2: tap a sub-check circle → fix panel

When the visitor clicks a sub-check circle inside the expanded view:

1. A panel slides in from the right (or bottom on phones) showing:
   - **Status**: the check's result in one sentence (the same text from
     the health map list row).
   - **How to fix it**: the fix advice from the fix kit. Use the same
     data the fix kit already builds in grade-html.js / fix-kit.js —
     the specific, copy-paste-ready advice for that check. If the check
     is green, show "This one's good — no changes needed."
   - **Check again** button: links to the recheck POST route
     (POST /grade/:id/recheck) if the report has an id, or shows
     "Run a new check to see if this improved."
   - **Get help fixing this**: a CTA line. Text:
     "Want someone to handle this? [Contact us](mailto:)" with a
     mailto link. If a "Prepared by" agency is set, use the agency's
     email and name instead of "us." If neither is set, omit this line.
2. The panel has a back arrow to return to the Level 1 expanded view.
3. The panel content is generated server-side as hidden `<div>` elements
   inside each sub-node's HTML, so no extra fetch is needed.

### Animation

- All transitions use CSS transitions, not JS animation.
- Respect prefers-reduced-motion: skip the transition, show/hide
  instantly.
- The orb particle canvas pauses (or dims) during drill-down so it
  doesn't distract from the sub-checks.

### Print

- The print stylesheet hides the drill-down panels and shows the
  standard flat health map list. The fix kit already prints at the
  end of the report. No change to print layout.

### Tests

Write test/health-drill.test.js with pure-function tests:
- The HTML contains a hidden detail panel for every sub-check.
- Each panel has the check's status text and fix advice.
- The "Check again" and "Get help" links are present when expected
  and absent when not.
- The fix advice matches what fix-kit.js produces for that check.
- Panels for green checks say "no changes needed" (not fix advice).

Write the interaction JS in public/js/health-drill.js:
- Reads the already-rendered HTML (progressive enhancement).
- No new data fetches.
- Keyboard accessible: Enter/Space opens, Escape closes.
- Focus management: focus moves into the panel on open, returns on
  close.

### Same rules

- SEO parts unchanged with baseline test, tokens only.
- AA contrast, 12px floor, 390px minimum.
- No shell commands, no exit, no Select-String, skip any permission
  prompt.
- Record decisions in design.md, then stop and list every file you
  changed.
