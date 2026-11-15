# Implementation Plan

- [x] 1. Founding Member program
  - [x] 1.1 `server/lib/founders.js`: settings, next number, who earns a spot, status summary (Req 1)
  - [x] 1.2 `server/data.js`: `founders.json`, number assigned on approval, `getFounder`, `getFoundersStatus` (Req 1)
  - [x] 1.3 `FOUNDERS_CAP` and `FOUNDERS_DEADLINE` settings, README rows (Req 1.6, 1.7)
  - [x] 1.4 Badge on listing cards and listing pages; invite on home and /rise; styles (Req 2)
  - [x] 1.5 Tests: `test/founders.test.js`, including the property test for unique, capped numbers
- [ ] 2. Paid verification
  - [ ] 2.1 Private owner link per approved listing (Req 3.1)
  - [ ] 2.2 Stripe Checkout for the $19 fee, signed webhook (Req 3.2, 3.8)
  - [ ] 2.3 Twilio Verify phone code against the listing's number (Req 3.3)
  - [ ] 2.4 Stripe Identity session, signed webhook, result-only storage (Req 3.4, 3.8)
  - [ ] 2.5 "Verified" stamp; removal when phone or name changes (Req 3.5, 3.6)
  - [ ] 2.6 Off without keys; admin view and removal (Req 3.9, 3.10)
  - [ ] 2.7 Tests with stubbed providers; README setup steps
