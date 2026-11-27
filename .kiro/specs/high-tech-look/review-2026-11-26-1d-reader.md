# Reader review: step 1D — live network + tab contrast fix

**Date:** 2026-11-26  
**Commit:** e5c2774  
**Verdict: GO**

---

## What a human reader sees

### The network on the home page

The unfiltered home page shows a nav block labelled "Categories and listings" holding real links: each category that has listings (linking to `/?category=<slug>`) and up to six of its listings (linking to `/listings/<id>`). The links are real, escaped, and work without JavaScript — a no-JS visitor sees a compact multi-column text directory. No canvas appears in the HTML source; the script adds one with `aria-hidden="true"`.

When JavaScript runs, the script reads the HTML list and draws glowing nodes on a canvas above it: categories as larger dots, listings as smaller dots near their category, with thin lines fading between nearby nodes. The list stays visible below (progressive enhancement, not hidden).

**Nothing reads wrong.** The tagline ("The phone book is back. And AI can read it.") and the owner sentence ("People now ask AI who to call. List your business free so AI can find it.") still read clearly. No lorem ipsum, no placeholder data, no hardcoded business names in the script.

### Tab contrast fix (from 1B code review)

The lit tab (`.book-tab.is-on`) now uses `color: var(--color-on-gold)` where `--color-on-gold: #0F1B33`. That is the page's dark ink on the gold background. The comment in the CSS says "9.8:1 on screen, 5.5:1 on paper" — well above WCAG AA (4.5:1). The old near-white (#FFFEF9) on gold is gone. The fix covers `:hover`, `:visited`, and `:focus-visible` states too, using a specificity-boosted selector (`.book-tabs a.book-tab.is-on`) that overrides the site's link-hover rule. Present in both light and dark themes (`--color-on-gold` is defined in both).

---

## Checklist

| Item | Status |
|------|--------|
| Network list present in HTML for JS-off visitors | ✅ Real links, escaped, no canvas in source |
| Canvas is `aria-hidden="true"` | ✅ Set in JS: `canvas.setAttribute('aria-hidden', 'true')` |
| Nodes from real data, not hardcoded | ✅ `readList(nav)` reads from the HTML list |
| requestAnimationFrame with fps cap | ✅ `shouldDraw()` gates at FRAME_MS (33.3ms = 30fps) |
| Reduced motion check | ✅ `prefers-reduced-motion: reduce` → `stillMode()` = true → one still picture, no drift |
| Pointer/keyboard interaction | ✅ `pointermove` lights nearest node, `click` navigates, `focusin`/`focusout` on links |
| Node limits (60 wide, 24 phone) | ✅ `MAX_NODES_WIDE=60`, `MAX_NODES_PHONE=24`, `PHONE_MAX_WIDTH=600` |
| Slow frame node dropping | ✅ 10 slow frames in a row halves node count, never under `MIN_NODES=8` |
| Tab hidden / off screen → no drawing | ✅ `visibilitychange` + `IntersectionObserver` → `shouldRun()` returns false |
| Tab contrast: dark text on gold lit tab (AA+) | ✅ `--color-on-gold: #0F1B33` on `--color-gold`, 9.8:1 |
| CSS uses tokens only (no raw colors) | ✅ Verified: `#[0-9a-fA-F]` / `rgba?()` absent from network CSS block |
| No libraries, no outside files | ✅ No `import`, no `fetch()`, no URLs in the script |
| Labels at 12px or more | ✅ `LABEL_PX = 12` |
| Network only on unfiltered home page | ✅ `!category && !city` guard in route; test confirms filtered pages omit it |
| Script loaded only when network present | ✅ `...(network ? { scripts: [HOME_NETWORK_SCRIPT] } : {})` |
| No lorem ipsum or placeholder | ✅ Grep clean |
| SEO baseline unaffected | ✅ The only head change is the module script tag, which the baseline test allows |

---

## Notes

- The list and canvas both stay visible (no `.has-canvas` rule hides the list). This is correct: the links are real navigation, not decoration. Hiding them would remove content.
- The `networkList` function escapes HTML entities and URI-encodes IDs — `A & B <Pipes>` renders safely.
- The seeded pseudo-random gives the same still picture on every visit (deterministic).
- The module script uses `export` for pure functions the tests import, and has no `import` statements itself — no dependencies.
- One frame-time constant: `FRAME_MS = 1000 / 30 ≈ 33.3ms`. The `shouldDraw` check allows a 0.5ms tolerance.

**No issues found. GO.**
