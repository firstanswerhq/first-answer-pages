# Healthy setup checklist (owner request, Nov 24, 2026)

Owner: "go through a complete list of known things and make sure we cover them all, like matching numbers and addresses and links, everything that makes a healthy setup."

Sources: Whitespark Local Search Ranking Factors 2026; BrightLocal Local AI Visibility Study; Search Atlas "How LLMs rank local businesses"; Insites study of 10,000 businesses; Search Engine Land AI local visibility report 2026.

Status key: HAVE = the check runs today. ADD = build now (honest, can be checked). KEY = build now, needs GOOGLE_PLACES_API_KEY. LATER = can't check honestly yet; show nothing for it.

## A. Name, address, phone match (Whitespark #15 "website NAP matches Google"; SEL: only 55-68% of businesses shown accurately by AI)
| # | Check | How | Status |
|---|---|---|---|
| A1 | Phone on website matches Google | digits only, drop leading 1 | KEY |
| A2 | Address on website matches Google | street number + street name + ZIP, case and abbreviation tolerant (St/Street, Ave/Avenue) | KEY |
| A3 | Business name on website matches Google | ignore case, punctuation, LLC/Inc | KEY |
| A4 | Hours on website match Google hours | compare per day when both are readable; otherwise "Not checked" | KEY |
| A5 | First Answer listing matches the website (phone, address) | when a listing exists | ADD |
| A6 | Same details on Bing (Azure Maps POI search: name, phone, address, website) | env AZURE_MAPS_KEY; one search per check; "Not checked" without the key | KEY |
| A7 | Same name and address on Apple Maps | owner, Nov 24: not worth the $99 yet; do not build | LATER |
| A8 | Same details on Yelp, BBB | needs their APIs | LATER |

## B. Google Business Profile (Whitespark #1-#10 are almost all GBP; BrightLocal: 29% of AI citations)
| # | Check | How | Status |
|---|---|---|---|
| B1 | Found on Google | Places text search, name + city | KEY |
| B2 | Open, not marked closed | businessStatus is OPERATIONAL | KEY |
| B3 | Main category fits the business type | primaryType vs the type on the check form | KEY |
| B4 | Hours set | regularOpeningHours present | KEY |
| B5 | Google profile links to the business website | websiteUri domain = the website checked | KEY |
| B6 | Profile claimed/verified, photos, posts | not available from the lookup | LATER |

## C. Reviews (Insites: AI-visible businesses averaged 133 reviews vs 11; SEL: AI filters out middling ratings; Whitespark #6, #9, #11, #14)
| # | Check | How | Status |
|---|---|---|---|
| C1 | Google review count | userRatingCount; green 10+, amber 1-9, red 0 | KEY |
| C2 | Google star rating | rating; green 4.3+, amber 3.8-4.2, red below 3.8 (named constants) | KEY |
| C3 | Newest review is recent | newest review publishTime within 90 days | KEY |
| C4 | Reviews shown on the website | existing reviews-visible | HAVE |
| C5 | Owner replies to reviews | not in the lookup data | LATER |

## D. Website says it plainly ("AI language"; Search Atlas: strongest factor; Whitespark local organic #1 "a page for each service", #2 local wording; Insites: visible sites had 2x the pages and fresher content)
| # | Check | How | Status |
|---|---|---|---|
| D1 | Says what you do | service/type words in visible text | ADD |
| D2 | Says where you work | city or service area in visible text | ADD |
| D3 | Answers common questions | FAQ section or question headings | ADD |
| D4 | A page for each service | sitemap or internal links show more than one service page | ADD |
| D5 | Recently updated | newest sitemap lastmod within 12 months; "Not checked" if no dates | ADD |
| D6 | Title names city and service | existing | HAVE |
| D7 | One headline, summary, image descriptions, share picture | existing | HAVE |
| D8 | Phone, address, hours on the page; tap to call; call button | existing | HAVE |

## E. AI and search engines can get in (robots, sitemap)
| # | Check | How | Status |
|---|---|---|---|
| E1 | robots.txt lets AI assistants in | existing ai-bots-allowed | HAVE |
| E2 | Sitemap found | requirement 3.9 | ADD |
| E3 | Text is in the page itself, not only added by scripts | raw HTML has the business name and phone | ADD |
| E4 | Business label (schema) | existing; studies show little effect, keep low | HAVE |
| E5 | AI info sheet (llms.txt) | existing; studies show little effect, keep low | HAVE |

## F. Links between profiles ("everything linked")
| # | Check | How | Status |
|---|---|---|---|
| F1 | Website links to its Google profile | a Google Maps / g.page / maps link on the site | ADD |
| F2 | Google profile links back to the website | same as B5 | KEY |
| F3 | Website links to Yelp | requirement 3.1 | ADD |
| F4 | Website links to Facebook, Instagram, TikTok | Socials node | ADD |
| F5 | First Answer listing links to the website | listing has a website | HAVE |

## G. Listed in trusted places (Whitespark: 3 of the top 5 AI factors are citation factors)
| # | Check | How | Status |
|---|---|---|---|
| G1 | First Answer Pages listing, Verified stamp | existing data | HAVE |
| G2 | Found on Bing maps (Azure Maps) | same lookup as A6 | KEY |
| G3 | Found on Apple Maps | not now (A7) | LATER |
| G4 | Yelp, BBB, industry directories | need their APIs or permission | LATER |

## Not shown at all
Ads, backlinks, distance to the searcher, clicks and calls from Google: we can't see them from outside. Never show a status for these.

## Notes for Kiro
- Everything marked KEY comes from ONE Places lookup per check (request only the fields used: displayName, formattedAddress, nationalPhoneNumber, websiteUri, regularOpeningHours, businessStatus, primaryType, rating, userRatingCount, reviews.publishTime). Never two lookups.
- Without the key, every KEY item shows "Not checked" (gray), never red.
- None of these change the score in this version (requirement 2.5).
- Thresholds live in one named constants file.
