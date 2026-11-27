# Step 1C Reader Review — 2026-11-26

## Verdict: GO

Commit: 0bb1f50 (branch kiro-rebuild-grader)
Server: DEMO_MODE=true, throwaway data dir with two verified listings (Nashville Pipe Pros, Volt Brothers Electric via trust.json).
Screenshots saved to `/mnt/user-data/outputs/site-1c-shots/`.

---

## What was checked

| Page | 1280 px | 390 px |
|---|---|---|
| Home (listing cards visible) | home-1280.png | home-390.png |
| Listing detail (verified) | listing-detail-1280.png | listing-detail-390.png |
| Grade / check page | grade-1280.png | grade-390.png |
| Hover state (home) | home-hover-1280.png | — |
| Focus state (home) | home-focus-1280.png | — |

---

## 1C Spec Items

### Soft glow on cards — PASS
Every `.listing-card` has `box-shadow: 0 0 12px var(--color-glow-soft)` (cyan at 12% opacity). Visible in both the 1280 and 390 screenshots as a subtle halo around each card. Cards have a dark surface-2 background (#0A142B) with a 1px border in --color-line, rounded at 12px. The glow reads as intended: present but not competing with the content.

### Stronger glow + Verified label on verified listings — PASS
Verified cards get the `.is-verified` class: border switches to --color-primary (cyan) and glow jumps to `0 0 20px var(--color-glow)` (cyan at 35% opacity). Visibly brighter than non-verified neighbors in the screenshots. The existing "VERIFIED" badge (green checkmark, cyan background, dark text) renders inside the card below the city line. Both Nashville Pipe Pros (Plumbers) and Volt Brothers Electric (Electricians) sort to the top of their category and show the stronger glow + badge. The verified badge on the detail page also renders correctly with explanation text and "What this means" link.

### "Details AI can read: ..." line — PASS
Every listing card shows a monospace green line: "Details AI can read: phone, hours, services, area, address" (or a subset based on the listing's actual fields). Cumberland Drain Co. shows "phone, hours, services, area" (no address field). The line is built from real fields only via `readableFields()` in html.js — never faked. Font is 0.75rem (12px) in ui-monospace, preceded by a bullet. Color is --color-success (#4ADE80), which passes AA contrast on the card background (10.50:1).

### Hover/focus lift — PASS
- **Hover**: home-hover-1280.png shows the Nashville Pipe Pros card lifted (`translateY(-2px)`) with an amplified cyan glow (`0 0 24px`) and cyan border. The transition is 0.15s ease-out.
- **Focus**: home-focus-1280.png shows focus rings (3px solid --color-focus, 2px offset) on the focused element. The `.listing-card:focus-within` rule provides the same lift and glow as hover.
- **Reduced motion**: the `prefers-reduced-motion: reduce` block sets `transform: none !important` on hover/focus cards, so the glow stays but the lift disappears. All transitions are killed globally.

---

## Accessibility Checks

### Contrast (WCAG AA) — ALL PASS
Computed ratios against the actual backgrounds:

| Pair | Ratio | AA Normal | AA Large |
|---|---|---|---|
| Body text (#E8EEFC) on page bg (#04101F) | 16.44:1 | PASS | PASS |
| Body text on card bg (#0A142B) | 15.74:1 | PASS | PASS |
| Cyan links (#38E1FF) on card bg | 11.66:1 | PASS | PASS |
| Green listing-ai (#4ADE80) on card bg | 10.50:1 | PASS | PASS |
| Muted text (#A9B6D3) on page bg | 9.39:1 | PASS | PASS |
| Button text (dark) on cyan button bg | 12.18:1 | PASS | PASS |

### 12 px floor — PASS
Puppeteer sweep of all leaf text nodes at 390px: zero elements below 12px on any of the three pages. The smallest text is the listing-ai line at exactly 12px (0.75rem). The CSS comment at line 2063 confirms this was deliberate: "12 px is the smallest text on the site (was 0.72rem)".

### No horizontal scroll at 390 px — PASS
Programmatic check: `document.documentElement.scrollWidth === document.documentElement.clientWidth` (390 === 390) on all three pages. No overflow.

### Focus rings — PASS
Global rule at line 172: `outline: 3px solid var(--color-focus); outline-offset: 2px` on `a:focus-visible`, `button:focus-visible`, `input:focus-visible`, `select:focus-visible`, `textarea:focus-visible`, `summary:focus-visible`. Visible in home-focus-1280.png as a bright ring around the book-tab "L" and around the book container.

---

## Minor Observations (not blockers)

1. **Verified badge in card**: The badge renders as a small cyan pill with dark text inside the card. On the 390px mobile view, it is legible but compact. No issue, just noting it is tighter on mobile.

2. **Card grid at 390px**: Cards stack single-column as expected. Padding and gutter look correct (16px side gutter visible).

3. **Detail page verified stamp**: The detail page for Nashville Pipe Pros shows both the "VERIFIED" banner at top and the "DETAILS CONFIRMED BY THE BUSINESS" stamp lower down. Both render correctly at both widths.

4. **Grade page**: Clean form layout at both widths. No 1C-specific changes expected here, and none are visible — it carries the 1A dark theme correctly.

---

## Conclusion

Step 1C listing cards are implemented correctly. Soft glow on all cards, stronger glow with Verified label on verified cards, the "Details AI can read" line from real fields only, hover/focus lift with reduced-motion handling, and all accessibility requirements met. GO.
