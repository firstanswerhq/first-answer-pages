# Review notes: V172-V176 and V177-V183 re-review (Nov 23, 2026)

Written by Claude (reviewer), not by Kiro. Kiro makes the changes.
Commits 9c6f7ed and 395151d reviewed. Verdict GO, 1600/1600. In a browser at 390 and 1280 wide both buttons now measure the same (20.8px, 700, 56px tall, same width and edges as the search form), no sideways scroll, and the check button is gone from filtered pages. All 19 stored listings give identical JSON-LD hours to before. Fix these as one task before O5.

## V184 "12am-12am" still says closed all day
schema.js about 186: the 12-hour branch of parseHoursRange never runs the new equal-times check. Return `settle({ opens, closes })` there too. Tests: "12am-12am" gives 00:00-23:59; "9am-9am" gives null.

## V185 The Fix Kit label lets a half-ambiguous range through
grader.js about 511 checks am/pm on both times together, so "Mo-Fr 9am-5:00" gives "Mo-Fr 09:00-05:00". Check each side on its own: a side with no am/pm is used only when the whole range passes the 24-hour rule, or that side's hour is 0, 13 or more, or has a leading zero; otherwise skip the range. Tests: "Mo-Fr 9am-5:00" and "Mo-Fr 5:00-9pm" give [].

## V186 (owner decision) A neutral Services placeholder
rise-html.js about 240: "Drain cleaning, water heaters" only fits plumbers. Use the placeholder "List what you offer, one per line", which fits every trade. Update the test (grade-claim-hours.test.js about 214).

## V187 The Fix Kit label and open-all-day hours
grader.js about 509 and schemaTime drop "00:00-24:00" and "00:00-00:00". In schemaHours, try the 24-hour reader first and use its result (00:00-23:59), so the label matches the form and the JSON-LD. Test it.

## V188 The hours people read are still wrong
grader.js about 543, readableTime (used by readableHours in grade-html.js about 534 and 768): "Mo-Fr 8:00-5:00" shows as "8:00 am to 5:00 am". Same rule: with no am/pm, show the line as found unless the 24-hour reader reads it, and then use that result ("00:00-00:00" reads "12:00 am to 11:59 pm"). Tests for "8:00-5:00", "9:30-4:30", "08:00-17:00" and "00:00-00:00".

## V189 Tests for V184, V185 and V188, as listed above.
