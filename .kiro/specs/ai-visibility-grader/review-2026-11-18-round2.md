# Review round 2 of the Kiro grader rebuild (Nov 18, 2026)

The code reviewer re-ran its own scripts against commit cdb55bb (V1 to V11 done, full suite 1015/1015). Result: V1 to V9 and V11 are fixed, V10 is partly fixed, and there is one small new problem. Security is unchanged and still clean (address guard fuzz shows 0 differences, the safe-fetcher block list behaves as before, all new HTML goes through `h()`, no new log lines).

Add these to tasks.md under "Review fixes" as V22 and V23, then fix them. No shell commands.

V22. Never take away a mention when re-reading a carried answer (grader.js, `rereadCarried`). An answer stored by the original code at the 4,000-character cap has no `answerCut` flag. When the Gemini name check is on it gets re-read, and if the business was named only in the cut-off part, the mention is lost: a carried `named: true` became `false` and the AI check said "No. Claude did not name your business." Treat an answer of 4,000 or more characters as cut, and keep `named` true when the earlier read found it. A re-read may add a mention, never remove one.

V23. Competitor names under headings (name-match.js, V10 leftover; the original had the same weakness, so this is an improvement rather than a regression). Unindented bullets under a numbered heading such as `### 2. Joes Plumbing` still list "Same Day Service" and "Free Estimates" as competitors, and a top-level "1. Free Estimates" stays. Bullets that sit under a business heading are details of that business, not new names; and a line that is only an offer ("Free Estimates", "Same Day Service", "24/7 Emergency Service") is not a business name.
