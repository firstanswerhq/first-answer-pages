# Design: Freshness

## Overview

Two new Grader checks, one standing tip, and a confirmation record for listings. No new pages. Everything is read from what the Grader already fetched, so no new outside requests.

## Components

| File | Job |
|---|---|
| `server/lib/grade-hours.js` | Reads hours from the page text, the business label and the matching listing. Lines up the days. Reports a mismatch only when two places plainly disagree. |
| `server/lib/grade-freshness.js` | Finds the newest copyright year, "updated" date, `dateModified` and `Last-Modified`. A picture credit never hides the site's own year, and a credit year counts only when the page has no other year. |
| `server/lib/grade-checks.js` | Adds hours-match (5 points, high priority) and site-fresh (2 points). The Google profile check goes from 15 to 8 points, so the total stays 100. Adds the monthly standing tip (not scored). |
| `server/lib/confirmation.js` | `confirmedAt`, `confirmedFields`, `firstVerifiedDate` in `verified.json`, kept outside the listing, so the hash does not change. Has the 90-day rule. |
| `server/lib/data.js` | `reconfirmListing` with a 24-hour no-op. |
| `server/lib/html.js`, `rise-html.js`, `rise.js` | The stamp line, and the "Yes, still correct" button (`POST /rise/drafts/:id/still-correct`). |
| `server/routes/api.js`, `mcp.js`, `llms.js` | `current` and `confirmedFields` in the machine-readable answers. |

## Rules that keep it honest

- When a time or day is unclear, the result is "Not checked", never a guess.
- Hours for one part of a business (kitchen, happy hour, service department, a branch) are never compared with the main hours.
- Sample listings are never used to match a website.
- No promise that AI will name a business, and no claim that we checked a Google profile.

## Testing

`test/freshness.test.js` covers real-world hours strings, footers and the 90-day rule, plus fast-check properties. There were two independent review rounds (six findings, then one, then one false pass), all fixed.
