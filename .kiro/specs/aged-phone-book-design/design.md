# Design: Aged phone book design

## Overview

One hand-written stylesheet, `public/css/style.css`, keeps every existing class name. It has three layers, in order:

1. The base site styles.
2. "AGED PHONE BOOK": paper, edges, stamps, coupon, index-card AI answers, columns.
3. "CLASSIC TYPE": the original design's lettering on top of layer 2.

Later rules in layer 3 win, so the aged layer can be changed without losing the lettering.

## Fonts

| Family name in CSS | File | Use |
|---|---|---|
| Headline Serif | playfair-display-latin-700-{normal,italic}.woff2 | Page titles, slanted |
| Book Serif | source-serif-4-latin-{400,400-italic,600,700}.woff2 | Text, headings, buttons |
| Fira Sans Condensed | fira-sans-condensed-*.woff2 | Form fields only |
| Old Numbers | rozha-one-latin-400-normal.woff2, U+0030-0039 | Phone numbers, score, list markers |

All fonts are under the SIL Open Font License, and the license files sit next to them in `public/fonts`.

## Markup changes

- `html.js`: the call button holds `<span class="call-label">Tap to call</span> <span class="call-number">…</span>`. The stamp has a "what was confirmed" line built only from fields the listing has. The quote form says "Request a quote" and "Send quote request". The footer reads "a phone book for local businesses that AI can read. Free to list."
- `grade-html.js`: AI answers are wrapped in index cards. The report header says "AI Visibility Check" and "A report from First Answer Pages". The count is singular or plural as needed, and a few sentences are reworded.
- `rise-html.js`: the photo button comes before the coupon, plus wording fixes.
- `routes/verify.js`: the badges section.

## Testing

- The full `node --test` suite, including the wording and trademark checks.
- A Playwright pass at 320, 360, 390, 414, 768, 1024, 1366 and 1920 px, checking sideways scroll on every page.
- Two independent reviews: one technical, and one a human-eyes read.
