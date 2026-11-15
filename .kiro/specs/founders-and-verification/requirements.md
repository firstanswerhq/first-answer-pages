# Requirements Document

## Introduction

This spec adds two things to First Answer Pages.

1. **Founding Members.** The first 500 businesses that send in their listing by January 31, 2027 (Central time) and are approved get a permanent Founding Member badge with their number ("Founding Member No. 12 of 500"). The program gives early owners a reason to sign up now and a mark that later listings cannot get.
2. **Verified businesses.** An owner can pay a one-time $19 fee to prove there is a real person behind a real business: a code texted to the business phone, plus a photo ID and selfie check. A listing that passes shows a "Verified" stamp. This is what makes the directory more trustworthy than an open one. Founding Members pay the same fee; the fee covers the cost of the checks and keeps fake listings out.

Part 1 is built. Part 2 is specified here and built next; it needs a Twilio account (text codes) and a Stripe account (the fee and the ID check), which the site owner opens himself.

### Fit with the existing specs

The existing "Owner-confirmed" stamp (a tamper-check hash from `super-pages`) is unchanged and is a different thing: it says the listing has not changed since the owner confirmed it, and it says plainly that it is not proof of identity. "Verified" is the proof of identity. The two never share wording. Founder numbers and verification results are stored beside the listing, never inside it, so the listing JSON, the JSON-LD and the tamper-check hash do not change.

### Wording rules

The words "Yellow Pages" and "YP", and any walking-fingers logo, are never used. American spelling. Every number shown (spots left, founder numbers) is a real count; nothing is made up.

## Requirements

### Requirement 1: Founding Member numbers

**User Story:** As an early business owner, I want a permanent founder number, so that my listing shows I was here first.

#### Acceptance Criteria

1. WHEN an admin approves a listing AND fewer than FOUNDERS_CAP numbers have been handed out AND the owner sent the listing in before FOUNDERS_DEADLINE, THE Data_Store SHALL give the listing the next founder number, starting at 1.
2. THE deadline test SHALL use the moment the owner sent the listing in for review, not the moment of approval, so a slow review never costs an owner their spot.
3. A founder number SHALL never change, never be reused, and never be given to a second listing, including after a restart and after a listing is unpublished.
4. WHEN FOUNDERS_CAP numbers have been handed out OR the deadline has passed, THE Data_Store SHALL hand out no more numbers.
5. Sample (demo) listings SHALL never be founders.
6. WHEN FOUNDERS_CAP is 0, the program SHALL be off: no numbers, no badge, no invite.
7. FOUNDERS_CAP SHALL default to 500 and FOUNDERS_DEADLINE to the end of January 31, 2027 in Nashville time; an unreadable setting SHALL fall back to the default.

### Requirement 2: Founding Member badge and invite

**User Story:** As a visitor, I want to see which businesses are Founding Members, and as an owner I want to know how many spots are left.

#### Acceptance Criteria

1. THE listing card and the listing page of a public founder SHALL show "Founding Member No. N of 500".
2. WHEN a founder listing is unpublished, its badge SHALL not appear anywhere.
3. WHILE spots are open, the unfiltered home page and the sign-up page (/rise) SHALL show an invite with the real number of spots left and the last day to sign up.
4. WHEN the program is closed or off, the invite SHALL not appear.
5. Founder data SHALL NOT be added to the listing JSON, the JSON-LD, or the tamper-check hash.

### Requirement 3: Paid verification (to build)

**User Story:** As a business owner, I want to prove my business is real, so that customers and AI assistants can trust my listing.

#### Acceptance Criteria

1. THE owner of an approved listing SHALL be able to start verification from a private link tied to that listing.
2. THE fee SHALL be $19, one time, taken by Stripe Checkout. The site never sees or stores card numbers.
3. Phone check: Twilio Verify SHALL text a code to the phone number on the listing; the owner SHALL type it in. The number checked SHALL be the listing's public number, never a number typed at verification time.
4. Identity check: Stripe Identity SHALL check a government photo ID against a selfie. The site SHALL store only the result (passed, when, and the provider's reference id), never the ID image, the ID number or the selfie.
5. WHEN the fee is paid AND both checks pass, THE listing SHALL show a "Verified" stamp with the date. Until then it SHALL show nothing new.
6. WHEN a verified listing's phone number or business name changes, THE Verified stamp SHALL be removed until the affected check is passed again.
7. A failed or abandoned check SHALL be retryable without paying again.
8. Payment and identity results SHALL be accepted only from signed provider webhooks, never from a browser redirect alone.
9. Without Twilio and Stripe keys set, verification SHALL be off and every verification address SHALL return 404. Keys are set only in the host's settings by the site owner.
10. An admin SHALL be able to see each listing's verification state and remove a Verified stamp.
