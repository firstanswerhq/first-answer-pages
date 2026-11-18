# Requirements: Aged phone book design

## Introduction

First Answer Pages brings the old phone book back for AI. The owner wants the site to keep the look of his original design (book-style serif, slanted headline, near-black ink, cream paper, navy button) and to feel like an old phone book: aged paper and browned edges, with the old-time Rozha One numbers. This spec covers the stylesheet, the fonts, the small markup changes the look needs, and the wording fixes found while reviewing it.

## Requirements

### Requirement 1: Original lettering

**User story:** As the owner, I want the site to look like my original design, so that it feels like the directory I approved.

#### Acceptance criteria
1. WHEN any page loads THEN headings, the site name and body text SHALL use the book serif, and page titles SHALL use the slanted headline serif.
2. Headings SHALL be mixed case in near-black ink, never all capitals or navy.
3. Buttons SHALL use the book serif, so no two buttons on a page use different fonts.
4. Form fields MAY use the condensed sans for easy typing.

### Requirement 2: Old-time numbers

1. Phone numbers, the report score and numbered list markers SHALL use the Rozha One digits.
2. Running text and the hours table SHALL use the book serif digits, so letters and numbers match.

### Requirement 3: Aged paper

1. The page SHALL show paper grain and browned edges that stay fixed while scrolling.
2. All text SHALL keep WCAG AA contrast on the paper, edges included.
3. WHEN "more contrast" is turned on THEN the textures SHALL switch off.

### Requirement 4: Phone-book pieces

1. Directory rows SHALL show dot leaders from the name to the number and print in 3 columns at 1100 px and up, 2 on tablets, 1 on phones.
2. A listing page SHALL show a call box with the number large in old-time digits. It SHALL say "Tap to call" on touch screens and "Call" with a mouse. Its accessible name SHALL include the number.
3. A listing page SHALL show hours as a printed table with a rule under each day.
4. The Founding Members box SHALL look like a clip-out coupon; Verified SHALL look like a rubber stamp.

### Requirement 5: Works everywhere

1. No page SHALL scroll sideways at any width from 320 px up.
2. The header button and site name SHALL fit on one row from 320 px up.
3. Fonts SHALL be served from this site with their license files; no page SHALL request another host.

### Requirement 6: Clear wording

1. Report counts SHALL use the right singular or plural ("1 of 1 check needs work").
2. Every sentence SHALL read clearly to a business owner, with American spelling, and SHALL NOT promise that AI will name a business.
