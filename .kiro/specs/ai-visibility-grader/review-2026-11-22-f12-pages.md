# Review notes: F12 code review and page read, round 2 (Nov 22, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
Read at commit fab5dc9. Code review: READY. Page read (390px and 1280px): READY. Nothing blocks.
These are the fixes worth making. Page text and small handler changes only; add tests, change no older test
except lines that quote a sentence changed here (say which in your summary).

## V90 Owner form: a website typed the short way is thrown away
Typing `mybusiness.com` or `www.mybusiness.com` in the "Website (optional)" box gets the site left out; only `https://...` is kept.
The check form says "Like example.com" and accepts the short form, so the two forms disagree, and most owners type it the short way.
Fix, owner form only: before `normalizeWebsite`, when the trimmed text has no scheme (it does not match `^[a-z][a-z0-9+.-]*:` and does not start with `//`), put `https://` in front; when it starts with `http://`, treat it as the claim does (`claimWebsite`). Then `normalizeWebsite` decides as today, so IP addresses, user names, look-alike logins, `javascript:` and the rest are still refused. `normalizeWebsite` itself does not change, and the re-check on output does not change.
Change the hint to: "The address of your own website, like example.com".
Tests: `mybusiness.com`, `www.mybusiness.com/menu`, `http://mybusiness.com:8080/x?y=1` are kept in clean form; `javascript:alert(1)`, `user@evil.tld`, `127.0.0.1`, `localhost`, `mailto:a@b.com`, a value with a space are still left out; never throws.

## V91 Owner form: the "Saved, but we left out..." line looks like good news
It sits in the green success box. When anything was left out, show that top line in the plain notice style the form already has (not green), in all three cases (website, reviews link, both). A clean save stays green "Saved."

## V92 /grade tab title
Now: "Does AI know your business? Free check". The page heading asks "Can AI find your business?", and the title does not say who it is for.
Change to: "Can AI find your local business? Free AI Visibility Check | First Answer Pages" (keep whatever site-name suffix the page shell already adds; do not add it twice).

## V93 /grade description
Now: "Find out whether AI assistants name your business when someone asks for one like it. Free, no sign-up."
Change to: "See whether AI assistants name your local business when someone asks for one like it, and get a score with plain fixes. Free, no sign-up."
(No assistant brand names, no time claim.)

## V94 /rise has no description and no canonical link, and it is now in the sitemap
Add a description: "List your local business free on First Answer Pages. Send a photo of your card or sign, or type it in. We review every listing."
Add a canonical link from the configured base address, the same way the open /grade pages do (none when the base address is not a plain site address). Only on `GET /rise` itself, never on a draft page.
Check the sentence against how /rise works today before using it; if the photo reader is closed in production, drop the photo sentence and say so in your summary.

## V95 /about never mentions the check
Add one line with a link to /grade, shown only when the grader is on: "Want to know if AI can find your business? Run the free AI Visibility Check."

## V96 /grade/about: jargon
Now: "Its user-agent string is:". Change to: "Our visits identify themselves as:".

## V97 (code review O1) A crash on the open pages loses the noindex header
If `GET /grade` or `GET /grade/about` itself fails, the 500 reply has no `X-Robots-Tag`. No data leaks, but keep the rule simple: in those two handlers, when rendering throws, set `X-Robots-Tag: noindex, nofollow` before passing the error on. One test that forces the failure.
