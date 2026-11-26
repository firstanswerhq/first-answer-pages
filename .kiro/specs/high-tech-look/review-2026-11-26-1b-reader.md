# Step 1B Review -- Human-style Reader (2026-11-26)

**GO**

---

## Screenshots

All PNGs saved to `/mnt/user-data/outputs/site-1b-shots/`:

| File                  | Page              | Width  |
|-----------------------|-------------------|--------|
| home-1280.png         | Home              | 1280px |
| home-390.png          | Home              | 390px  |
| listing-1280.png      | Listing detail    | 1280px |
| listing-390.png       | Listing detail    | 390px  |
| check-1280.png        | Check (grade)     | 1280px |
| check-390.png         | Check (grade)     | 390px  |
| home-focus-ring.png   | Home (focus test) | 1280px |

Server: `DEMO_MODE=true`, throwaway data dir, Playwright with `colorScheme: 'dark'` and `deviceScaleFactor: 2`.

---

## Open-book home page (Req 1.2, 1.3)

### Does it look like an open phone book with a spine and A-Z tabs?

**Yes.** The `.book` container has a rounded rectangle with a vertical spine on the left edge (`::before` pseudo-element with a gradient from `--color-surface-2` through `--color-spine`). On desktop (1280px) the spine is 2.75rem wide and uses a blue-tinted gradient that reads as a book binding. The whole container sits against the dark background with a medium box-shadow, giving the impression of a physical object.

### A-Z tabs on wide screens, hidden on phones?

**Yes.** The `.book-tabs` nav is `display: none` by default and shown at `@media (min-width: 900px)` as a vertical column of letter tabs positioned `right: -1rem` (protruding from the book edge). Each tab is 2rem wide with a right-side border-radius (`0 8px 8px 0`), looking like physical tab dividers. Letters visible at 1280px: A, E, H, L, P, S (one per category). At 390px: tabs are completely hidden. **Pass.**

### Active tab lit?

The CSS has `.book-tab.is-on` with a gold background and glow shadow. In the default view (no category filter), no tab is lit, which is correct. When a category is selected via `?category=...`, the matching tab lights up. **Pass.**

### Headline clear?

**Yes.** The headline structure is:
- Small caps label: "LOCAL BUSINESS DIRECTORY" (the actual `<h1>`)
- Large italic tagline: "The phone book is back." / "And AI can read it." (second line in the cyan primary color)
- Separator rule
- Owner sentence below: "People now ask AI who to call. List your business free so AI can find it."

The hierarchy is clear and reads naturally. The tagline is the dominant visual element. **Pass.**

### Owner sentence under it?

**Yes.** The `.home-why` paragraph ("People now ask AI who to call. List your business free so AI can find it.") appears directly below the tagline, in the muted text color. It is present at both 1280px and 390px. **Pass.**

---

## Dark theme across pages

**Holds.** All three page types (home, listing detail, check/grade) render with:
- Dark body background: `rgb(7, 11, 22)`
- Dark surface panels: `#0C1324`
- Light text: `#E8EEFC`
- Cyan accent: `#38E1FF`
- Consistent nav bar, footer, and form styling

No white flashes, no light-mode bleed-through on any page. **Pass.**

---

## Accessibility checks

### Contrast (WCAG AA)

| Pair                     | Ratio  | Required | Result |
|--------------------------|--------|----------|--------|
| Text on body bg          | 16.91  | 4.5      | Pass   |
| Text on surface          | 15.93  | 4.5      | Pass   |
| Muted text on body bg    | 9.66   | 4.5      | Pass   |
| Muted text on surface    | 9.10   | 4.5      | Pass   |
| Primary (cyan) on body   | 12.52  | 4.5      | Pass   |
| Primary (cyan) on surface| 11.80  | 4.5      | Pass   |

All combinations well above AA thresholds. **Pass.**

### 12px floor

Smallest declared font-size in the stylesheet is `0.75rem` (12px), used on the book tabs and one helper-text instance. The CSS includes an explicit comment: "12 px is the smallest text on the site (was 0.72rem)." No sub-12px sizes found. **Pass.**

### No horizontal scroll at 390px

Programmatic check on all three pages at 390px viewport:
- Home: `scrollWidth` = `clientWidth` = 390. No overflow.
- Listing: `scrollWidth` = `clientWidth` = 390. No overflow.
- Check: `scrollWidth` = `clientWidth` = 390. No overflow.

**Pass.**

### Focus rings visible

Tabbing through the home page at 1280px shows a clear orange/amber focus outline (`--color-focus: #FFB547`, 3px solid, 2px offset) on interactive elements. The screenshot (`home-focus-ring.png`) shows the "H" book-tab with a visible focus ring. The CSS applies `outline: 3px solid var(--color-focus); outline-offset: 2px` to `a:focus-visible`, `button:focus-visible`, `input:focus-visible`, `select:focus-visible`, and `textarea:focus-visible`. **Pass.**

---

## Minor observations (not blockers)

1. **Book tabs only show 6 letters** (A, E, H, L, P, S) corresponding to the 6 categories that have demo listings. With 13 total categories, the tabs will grow as listings are added. The current state is fine for demo mode.

2. **Founding Members callout** has an orange/gold border that stands out well against the dark theme and reads as a distinct callout. Good visual hierarchy.

3. **Form fields** (category select, city input, check page form) all have visible borders against the dark surface. Labels are clearly paired with their inputs. The check page form has helpful hint text in italic muted style.

---

## Verdict

**GO.** The open-book metaphor lands: spine on the left, A-Z category tabs on the right at desktop widths (hidden on mobile), clear headline with the owner sentence below. Dark theme holds across home, listing, and check pages. All accessibility requirements pass: contrast well above AA, 12px font floor enforced, no horizontal scroll at 390px, and focus rings are visible and correctly colored.
