# Requirements Document

## Introduction

This spec adds two things to First Answer Pages.

1. **Founding Members.** The first 500 businesses that send in their listing by January 31, 2027 (Central time) and are approved get a permanent Founding Member badge with their number ("Founding Member No. 12 of 500"). The program gives early owners a reason to sign up now and a mark that later listings cannot get.
2. **Verified businesses.** An owner can pay to prove there is a real person behind a real business: a code texted to the business phone, plus a photo ID and selfie check. A listing that passes shows a "Verified" stamp. This is what makes the directory more trustworthy than an open one. Founding Members pay $19 once and are verified for life; everyone else pays $49 a year. The fee covers the cost of the checks and keeps fake listings out.

Both parts are built. Part 2 stays off until the site has a Twilio account (text codes) and a Stripe account (the fee and the ID check), which the site owner opens himself.

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

### Requirement 3: Paid verification

**User Story:** As a business owner, I want to prove my business is real, so that customers and AI assistants can trust my listing.

Listing is free for everyone, always. Verification is the paid step. A Founding Member pays $19 once and stays verified for life. Every other business pays $49 per year.

#### Acceptance Criteria

1. THE owner of an approved listing SHALL reach verification from their private listing link (`/rise/drafts/:id/verify`). An unknown link SHALL get a 404.
2. THE fee SHALL be taken on a Stripe Checkout page: VERIFY_FOUNDER_FEE_CENTS (default $19, one time, for life) for a Founding Member, VERIFY_YEARLY_FEE_CENTS (default $49, one year) for everyone else. The site never sees or stores card numbers.
3. A yearly payment SHALL cover one year. WHEN it lapses, THE stamp SHALL come off until the owner pays again; the phone and photo ID checks SHALL NOT need repeating. Renewing early SHALL add a year to the current end date.
4. Phone check: Twilio Verify SHALL text or call the phone number on the listing with a code, and the owner SHALL type it in. The number checked SHALL be the listing's public number, never a number typed at verification time.
5. Identity check: Stripe Identity SHALL check a government photo ID against a selfie. The site SHALL store only the result (when, and the provider's reference id), never the ID image, the ID number or the selfie.
6. The phone and identity checks SHALL open only after the fee is paid.
7. WHEN the fee is paid AND both checks pass, THE listing SHALL show a "Verified" stamp on its card and its page, and llms.txt SHALL say so. Until then it SHALL show nothing new.
8. WHEN a verified listing's phone number changes, THE stamp SHALL come off until the phone check is passed again; WHEN its name changes, until the identity check is passed again.
9. A failed or abandoned check SHALL be retryable without paying again, within limits that cap the site's cost: three codes an hour and three photo ID tries per payment.
10. A payment or identity result SHALL be believed only when Stripe says so: a signed webhook, or the server asking Stripe directly. A browser redirect alone SHALL change nothing. The same payment SHALL be counted once.
11. Without the Stripe key and all three Twilio values, verification SHALL be off: every verification address SHALL return 404 and no page SHALL mention prices.
12. An admin SHALL see each listing's verification state and be able to remove a Verified stamp.
13. Verification data SHALL NOT be added to the listing JSON, the JSON-LD, or the tamper-check hash.
