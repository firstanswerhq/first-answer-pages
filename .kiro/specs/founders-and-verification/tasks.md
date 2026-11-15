# Implementation Plan

- [x] 1. Founding Member program
  - [x] 1.1 `server/lib/founders.js`: settings, next number, who earns a spot, status summary (Req 1)
  - [x] 1.2 `server/data.js`: `founders.json`, number assigned on approval, `getFounder`, `getFoundersStatus` (Req 1)
  - [x] 1.3 `FOUNDERS_CAP` and `FOUNDERS_DEADLINE` settings, README rows (Req 1.6, 1.7)
  - [x] 1.4 Badge on listing cards and listing pages; invite on home and /rise; styles (Req 2)
  - [x] 1.5 Tests: `test/founders.test.js`, including the property test for unique, capped numbers
- [x] 2. Paid verification
  - [x] 2.1 `server/lib/trust.js`: fees, plans, phone format, and the rule for when a listing is Verified (Req 3.2, 3.3, 3.7, 3.8)
  - [x] 2.2 `server/lib/trust-providers.js`: Stripe Checkout, Stripe Identity, signed webhook check, Twilio Verify (Req 3.2, 3.4, 3.5, 3.10)
  - [x] 2.3 `server/data.js`: `trust.json` records (Req 3.5, 3.13)
  - [x] 2.4 `server/routes/verify.js`: owner page, pay, phone code, photo ID, webhook, limits (Req 3.1, 3.6, 3.9, 3.10)
  - [x] 2.5 Verified stamp on cards, listing pages and llms.txt; prices in the founders invite (Req 3.7)
  - [x] 2.6 Off without keys; admin state line and "Remove Verified stamp" (Req 3.11, 3.12)
  - [x] 2.7 Tests with stand-in providers: `test/trust.test.js`; README settings
- [ ] 3. Go live (site owner)
  - [ ] 3.1 Open Stripe and Twilio accounts; turn on Stripe Identity; create a Twilio Verify service
  - [ ] 3.2 Add test keys in the host settings and run one full verification in test mode
  - [ ] 3.3 Switch to live keys
