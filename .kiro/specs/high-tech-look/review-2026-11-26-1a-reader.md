# Reader review: step 1A dark theme (commit e90ebfe), 2026-11-26

## Verdict: GO (with a short polish list; nothing blocks 1B)

Judged as a contest judge or customer would, not as a code checker. Shots are in /mnt/user-data/outputs/site-1a-shots/ (desktop 1280 and phone 390 for home, two listings, check, check-about, claim, claim form, about, privacy, 404, report, report with preparer line, health-map close-ups, focus shots, print PDFs and a print contact sheet).

How it was run: the real server (node server/index.js, DEMO_MODE on, throwaway DATA_DIR) for site pages; the report came from the render harness, served through the real server so fonts and CSS load. Mockups: the folder .kiro/specs/high-tech-look/mockups/ does not exist in this worktree, so I judged against the Requirement 1 text and the steps file only.

## Does it look like a high-tech phone book? Yes, on the pages that exist today
- One look everywhere: near-black navy page, soft blue glow at the top, cyan buttons and links, amber thin rules and focus ring, condensed phone-book lettering, curvy old-style numbers on phone numbers and the score. Home, listing, check, claim form, about, privacy, 404 and report all share the same nav bar, footer, surfaces and form styling. No page is still light and none is half-themed.
- The phone-book feel survives: dotted leader lines between names and numbers, A-Z style section headings with amber rules, the numbered "68 / 100" score.
- Expected gaps, not 1A faults: the home headline is still "Local Business Directory" (1B), cards are still plain rows (1C), no network (1D). Pink (accent) is defined but I saw almost none on screen; the look will read as "cyan and amber" until 1B to 1D use it.

## Measured checks
| Check | Result |
|---|---|
| Text contrast (every visible text element, computed against its real stacked background) | 0 failures below AA on all 24 page/size combinations |
| Smallest visible text | 12 px (report), 12.8 px (listing labels); nothing under 12 |
| Horizontal scroll at 390 | None on any page |
| Body and page background | Dark everywhere (rgb 7,11,22); no white panels found |
| Forms | Inputs have visible borders (about 3:1), labels and hints are readable, submit buttons are clear. Checkbox on the check form is a plain white native box, fine |
| Keyboard focus | 3 px amber outline on links, buttons, inputs; on the home form the ring sits on the whole field wrapper (clear in the shot) |
| Reduced motion | With the setting on, no animation or transition is running anywhere; the CSS also hides the animated orb. With it off, only the 0.15 s button hover transition runs |
| Page errors | None |
| Print | Report, print page, home and listing all print on white with dark ink. The dedicated print page leaves the map out and drops green rows |

## Fix list, ranked by severity
1. Low-medium: Home form icons (tag beside "Category", pin beside "City") are almost invisible, dark navy on a dark field. They are decorative so nothing breaks, but it looks like a missing icon. Give them the muted text color.
2. Low-medium: Report health map text is drawn small. It is a scaled picture, so the node names and statuses land at about 12 to 13 px on desktop (near the floor), and the tiny check marks on the little sub-nodes are about 10 px. The map is aria-hidden and the full text list sits beside it, so this is not an accessibility failure, but the sub-node symbols are hard to read on desktop. Consider a slightly larger map or bigger sub-node symbols.
3. Low: Printing the normal report page (browser print of /grade/:id) still prints the health map with dark filled circles, which is ink-heavy. The old CSS did the same (same fill color before 1A), so 1A did not cause it, but "print must stay ink-friendly" is not fully true for that route. Make the map nodes white-filled in the print block. The dedicated print route is fine.
4. Low: On desktop the report shows a large empty column under the health map while the long check list scrolls on the right. Not a 1A change, but it is the most noticeable bare patch on the dark report.
5. Cosmetic: the glow on the nav button and the two big cyan home buttons is the same cyan slab; with 1B/1C adding glow cards, watch that the page does not become all cyan. Pink is unused so far.

## Not tested
Hover glow (none in 1A), the animated orb frame by frame, and the real printing dialog (checked with print emulation and PDF output instead). Mockups folder missing from the worktree.
