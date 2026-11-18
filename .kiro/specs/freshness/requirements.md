# Requirements Document

## Introduction

This spec adds freshness to First Answer Pages: signs that a business's details are current, in the AI Visibility Grader and on listings.

1. **Hours match (Grader).** The Grader compares the hours a business states in the places it can read: the home page text, the business label (JSON-LD), and the business's listing in this directory when one clearly matches. Different hours in different places can lead an AI assistant to tell people to call first.
2. **Site freshness (Grader).** The Grader looks for signs the website was updated lately: a copyright year, `dateModified`, an "updated" date, and the `Last-Modified` header.
3. **Monthly standing fix (Grader).** Every report has one piece of advice about keeping the Google profile active. It is not a check and is not scored.
4. **Confirmed fields and date (listings).** The stamp says which details the business confirmed and when, for example "Phone, address and hours confirmed by the business on Nov 18, 2026."
5. **Freshness rule (listings).** A confirmation older than 90 days is no longer shown as current, and the owner can confirm the same details again with one button.

### Fit with the existing specs

The tamper-check stamp from `super-pages` keeps its hash and its `/api/verify/:id` check. Which details were confirmed is stored beside the listing in `verified.json`, never inside the listing, so the listing JSON and the hash input do not change. The Grader's checks still total 100 points: the never-shown Google profile check gives up 7 of its points (15 to 8) to the two new checks, so no score shown today changes because of the move.

### Wording rules

Plain words, short sentences, American spelling. Never promise or imply that a fix or a listing will make an AI assistant name a business. Never say we checked a Google profile; we don't. No Google, Yelp or Reddit scraping.

## Requirements

### Requirement 1: Hours match

**User Story:** As a business owner, I want to know if my hours say different things in different places, so that customers and AI assistants get one clear answer.

#### Acceptance Criteria

1. THE Grader SHALL read hours from the visible home-page text, from the business label's `openingHours` and `openingHoursSpecification`, and from the business's First Answer listing.
2. THE listing SHALL be used only WHEN the website's phone (business label or tap-to-call link) matches exactly one owner listing by its 10 digits AND that listing has the same city and state as the check AND its name looks like the checked name (or its website has the same domain). Sample listings SHALL never be used. Otherwise the listing SHALL be left out.
2a. WHEN the page writes hours or "closed" before the days ("9am-5pm Mon-Fri", "Closed Sun, Mon-Sat 9am-6pm"), THE page text SHALL NOT be used.
2b. Hours within about 60 characters of holiday, season, month, special, temporary or appointment words SHALL be skipped.
2c. "00:00-00:00" in an `openingHours` string SHALL mean closed, the same as in `openingHoursSpecification`.
3. Business-label rows with `validFrom` or `validThrough` (holiday or seasonal hours) SHALL be left out.
4. A time SHALL be read only WHEN it is clear: am/pm on both ends, "noon", "midnight", or 24-hour `HH:MM`. Anything else SHALL be left out, never guessed.
5. WHEN one place gives two different values for the same day, THAT place SHALL be left out.
6. THE check SHALL fail only WHEN two places give plainly different hours for the same day (one range each, or closed on one side and open on the other). Split hours (a lunch break) against plain hours SHALL NOT fail.
7. WHEN fewer than two places can be read, or no day can be lined up, THE result SHALL be "Not checked" with a plain reason.
8. THE failure SHALL name the day and both places, then say: "Your hours don't match, so customers and AI can't tell which ones are right." WHEN the listing is one of the two places, THE failure SHALL name it and add "If the hours in our directory are wrong, contact us to change them." THE fix SHALL say to make the hours the same everywhere, including the Google profile.
9. THE check SHALL be high priority: a failed hours check SHALL be listed first under "Fix these first". It is worth 5 points.

### Requirement 2: Site freshness

**User Story:** As a business owner, I want to know if my website looks out of date, so that I can fix the easy signs.

#### Acceptance Criteria

1. "Now" SHALL come from the app's injected clock, so results are the same in every test run.
2. THE check SHALL pass WHEN the page shows a copyright year of this year or last year, OR an "updated" date, a `dateModified` or a `Last-Modified` header within the last 365 days.
3. THE check SHALL fail WHEN the newest copyright year is older than last year and no visible or business-label date is recent. A `Last-Modified` header alone SHALL NOT outweigh an old year people can see.
4. WHEN no date is found, THE result SHALL be "Not checked" with a short note, never a fail.
5. Copyright years more than one year in the future SHALL be ignored. "Present", "today" and "now" SHALL count as this year, a 2-digit end year ("2019-26") SHALL share the start year's century, and a list ("2015, 2026") SHALL count as its newest year. Text built by page scripts SHALL be skipped, with the reason "Your page loads its words in a way this check can't read yet."
6. THE check is worth 2 points.

### Requirement 3: Monthly standing fix

**User Story:** As a business owner, I want one simple monthly habit, so that my business keeps looking open.

#### Acceptance Criteria

1. EVERY report SHALL show: "Once a month, reply to your reviews and add a new photo to your Google business profile. Recent activity shows customers, and AI, that you're still open." It SHALL be a row like the fixes, before the "Not a computer person?" hint.
2. IT SHALL NOT be a check, SHALL NOT be scored, and SHALL NOT say that we checked the Google profile.
3. IT SHALL reuse the existing report styles.

### Requirement 4: Confirmed fields and date on listings

**User Story:** As a visitor or an AI assistant, I want to know which details the business confirmed and when, so that I know what to trust.

#### Acceptance Criteria

1. WHEN an admin approves a listing, `verified.json` SHALL store `confirmedAt` and `confirmedFields` (phone, plus address and hours when the listing has them) beside `verifiedDate` and `verifiedAt`.
2. THE stamp SHALL read "<Fields> confirmed by the business on <date>.", for example "Phone, address and hours confirmed by the business on Nov 18, 2026."
3. Older entries without `confirmedFields` SHALL read "Details confirmed by the business on <date>." Nothing misleading SHALL be shown for them.
3a. THE Séance page SHALL use the same line and the same 90-day rule.
3b. `/api/verify/:id`, `/api/listings/:id` and the MCP `get_listing` tool SHALL add `current` and `confirmedFields` for a confirmed listing.
4. THE JSON-LD `dateModified` SHALL be the confirmation date.
5. `/llms.txt` SHALL add "Confirmed details: phone, address and hours" under a current confirmation.

### Requirement 5: Freshness rule and "Still correct"

**User Story:** As a business owner, I want to say my listing is still correct, so that it keeps showing as current.

#### Acceptance Criteria

1. WHEN a confirmation is more than 90 days old, THE stamp SHALL read "Last confirmed by the business on <date>." and `/llms.txt` SHALL read "Details last confirmed by the business: <date>" with no "yes".
2. `dateModified` SHALL stay the real confirmation date. It SHALL NOT be moved forward unless the owner confirms again.
3. THE owner's private draft link SHALL show when the details were last confirmed, say that the listing shows them as current for 90 days, and have a "Yes, still correct" button (`POST /rise/drafts/:id/still-correct`). "See your listing" SHALL come before it and before the Verified button.
4. Pressing it SHALL set `confirmedAt`, `verifiedAt` and `verifiedDate` to now for the same fields. The hash SHALL change with the new date. A second press within 24 hours SHALL change nothing.
4a. THE first confirmation date SHALL be kept as `firstVerifiedDate`, and the Séance SHALL split runs into before and after at that date, so pressing the button never relabels its history.
5. A draft that is not live SHALL get 409; an unknown draft SHALL get 404. The button SHALL use the `POST /rise` rate limit.
6. THE site SHALL NOT send any email or text for this.
