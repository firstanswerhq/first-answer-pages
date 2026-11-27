/**
 * watch-html.js: the monthly watch's pages and email text (addon-monthly-watch task 7, wording pass 2026-11-27).
 *
 *  - watchBlock(grade, opts): the small opt-in form in the full report ("Watch this every month"). Empty unless the
 *    route says the watch may be offered (`opts.watch`).
 *  - watchPage, confirmPage, confirmedPage, stopPage, stoppedPage, watchMessagePage: the /watch pages.
 *  - watchEmails({ contactEmail, postalAddress }): the plain-text email builders the watch service uses.
 *
 * Every inserted value is escaped with `escapeHtml` on a page, and made one plain line (control characters and line
 * breaks removed) in an email. Business names from AI answers are never linked. Nothing here says that a fix or a
 * listing makes AI name a business. The assistant is named "Claude" everywhere; the watch's own run is "the monthly
 * check" and the report is "the AI Grader".
 */

import { layout, escapeHtml } from './html.js';
import { lastReading } from './watch.js';

const h = value => escapeHtml(value ?? '');
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';

/** The assistant the monthly check asks, by name, on every page and in every email. */
export const WATCH_ASSISTANT = 'Claude';
/** The one promise, worded the same on the offer, the confirm pages and the confirm email. */
export const WATCH_PROMISE = 'We will tell you if an AI assistant starts or stops recommending your business.';
/** The line every alert and the watch page carry. */
export const SNAPSHOT_LINE = 'Claude can answer differently each time you ask, so treat this as one example, not your place in a list.';
/** Shown instead of the form when WATCH_MAX_ACTIVE watches are running. */
export const WATCH_FULL_TEXT = 'Monthly watch is full right now. Please try again in a few weeks.';
/** The line above the button. */
export const WATCH_OFFER_TEXT = 'Free. Once a month we ask Claude the same question again. We email you only if the answer changes, and your email address is used for nothing else. Stop any time.';
/** With a notifier that sends no email. */
export const WATCH_PAGE_ONLY_TEXT = 'Alerts show on your watch page only.';
/** A monthly check that could not run on 3 days in a row. */
export const COULD_NOT_CHECK = "We couldn't check this month. We will try again next month.";
/** The table's cells. */
export const NAMED_TEXT = 'Claude named your business';
export const NOT_NAMED_TEXT = 'Claude did not name your business';
export const NO_OTHERS_TEXT = 'No other businesses named';
/** Under the table. */
export const BOOKMARK_TEXT = 'Bookmark this page. If you gave an email, the link is in every message too.';
/** The stop page. */
export const STOP_TEXT = 'This ends the monthly watch and deletes any email address we hold. You can start a new one from your report whenever you like.';
/** Every email's footer. */
export const SENT_BY = 'Sent by the AI Grader from First Answer Pages.';
/** The change alert's last line. */
export const CHANGE_END = 'You get an email only when this changes. We check once a month.';
/** Next steps on the short message pages. */
export const RATE_LIMIT_TEXT = 'Too many requests came from your network. Please wait an hour and try again.';
export const BAD_CONFIRM_TEXT = 'Open the newest email from the AI Grader and press Confirm again.';
export const ALREADY_WATCHING_TEXT = 'You already have a watch for this report. This is its page.';
export const BACK_LINK = Object.freeze({ href: '/grade', text: 'Back to the AI Grader' });

/**
 * The same date text the report uses ("November 24, 2026", the Chicago day). Kept here rather than imported from
 * grade-html.js, which imports this file.
 */
export function watchDay(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
    : '';
}

/** One line of plain text for an email: control characters, direction marks and line breaks removed. */
export function plainLine(value) {
  return String(value ?? '')
    .replace(/[\p{Cc}\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** The assistant's name for people ("Claude"), from the provider name. Unknown or demo: "AI". */
export function assistantLabel(providerName) {
  const labels = { anthropic: 'Claude', openai: 'ChatGPT' };
  return labels[String(providerName ?? '').toLowerCase()] ?? 'AI';
}

function watchShell(title, body) {
  return layout({ title, body, head: ROBOTS_META });
}

// ---- the opt-in block in the full report ------------------------------------------------------------------------

/**
 * The opt-in form, placed after "Made some changes?" in the full report. `opts.watch` comes from the route:
 * `{ full?: boolean, emailOn?: boolean, stamp: string }`. Without it (watch off, not eligible, a printout) it is ''.
 * Works without JavaScript.
 */
export function watchBlock(grade, opts = {}) {
  const w = opts?.watch;
  if (!w || typeof w !== 'object' || opts.print === true || !grade || typeof grade.id !== 'string') return '';
  if (w.full === true) {
    return `<section class="grade-watch">
  <h2>Watch this every month</h2>
  <p class="hint">${h(WATCH_FULL_TEXT)}</p>
</section>`;
  }
  const emailField = w.emailOn === true
    ? `<p><label for="watch-email">Email for alerts (optional)</label>
    <input id="watch-email" name="email" type="email" autocomplete="email" maxlength="254" value="${h(w.email ?? '')}"></p>
    ${w.error ? `<p class="form-error" role="alert">${h(w.error)}</p>` : ''}`
    : `<p class="hint">${h(WATCH_PAGE_ONLY_TEXT)}</p>`;
  return `<section class="grade-watch">
  <h2>Watch this every month</h2>
  <form method="POST" action="/grade/${h(grade.id)}/watch">
    <input type="hidden" name="t" value="${h(w.stamp ?? '')}">
    ${emailField}
    <p>${h(WATCH_PROMISE)}</p>
    <p>${h(WATCH_OFFER_TEXT)}</p>
    <button type="submit" class="button">Watch this every month</button>
  </form>
</section>`;
}

// ---- the watch page ---------------------------------------------------------------------------------------------

function readingRow(r) {
  const what = r.source === 'none' ? COULD_NOT_CHECK : (r.named ? NAMED_TEXT : NOT_NAMED_TEXT);
  const others = r.source === 'none'
    ? '&nbsp;'
    : (!Array.isArray(r.competitors) || r.competitors.length === 0 ? h(NO_OTHERS_TEXT) : r.competitors.map(n => h(n)).join(', '));
  return `<tr><td>${h(watchDay(r.at))}</td><td>${h(what)}</td><td>${others}</td></tr>`;
}

/** The latest change, on top. */
function latestChange(watch) {
  if (!watch.lastChangeAt) return '';
  const last = lastReading(watch);
  if (!last) return '';
  const text = last.named ? `${WATCH_ASSISTANT} named your business this time.` : `${WATCH_ASSISTANT} did not name your business this time.`;
  return `<p class="notice" role="status">${h(`${watchDay(watch.lastChangeAt)}: ${text}`)}</p>`;
}

/** "We sent a message to a…@e….com. …" (the masked address, or "your address" when there is none). */
export function pendingText(maskedEmail) {
  return `We sent a message to ${maskedEmail || 'your address'}. Press Confirm in it to start the email alerts. Until you do, we will not email you.`;
}

export function pausedText(maskedEmail) {
  return `We paused the monthly checks because 3 emails to ${maskedEmail || 'your address'} bounced. Start a new watch from a new report with a working address.`;
}

/** Before the first monthly check (only the report's own answer is there). */
export const firstCheckText = dueAt => `Your first check will appear here by ${watchDay(dueAt)}.`;

/**
 * The owner's own watch page: the last 12 readings (newest first), the latest change on top, which address gets
 * alerts (masked), and a "Stop watching" button. `maskedEmail` comes from `maskEmail`. `already` says a second start
 * on the same report came here.
 */
export function watchPage(watch, { maskedEmail = '', question = '', already = false } = {}) {
  const name = watch?.input?.name ?? '';
  const all = Array.isArray(watch?.readings) ? watch.readings : [];
  const readings = all.slice(-12).reverse();
  const status = watch.status === 'pending'
    ? `<p class="notice" role="status">${h(pendingText(maskedEmail))}</p>`
    : watch.status === 'paused'
      ? `<p class="notice" role="alert">${h(pausedText(maskedEmail))}</p>`
      : '';
  const alreadyLine = already ? `<p class="notice" role="status">${h(ALREADY_WATCHING_TEXT)}</p>` : '';
  const emailLine = maskedEmail
    ? `<p>Alerts go to ${h(maskedEmail)}.</p>`
    : `<p>${h(WATCH_PAGE_ONLY_TEXT)}</p>`;
  const monthly = all.filter(r => r && r.source !== 'report');
  const next = watch.status === 'active' && watch.nextDueAt
    ? (monthly.length === 0
      ? `<p>${h(firstCheckText(watch.nextDueAt))}</p>`
      : `<p>Next monthly check: around ${h(watchDay(watch.nextDueAt))}.</p>`)
    : '';
  const asked = question ? `<p>We ask Claude: ${h(question)}</p>` : '';
  const body = `<section class="message watch-page">
  <h1>Monthly watch for ${h(name)}</h1>
  ${alreadyLine}
  ${latestChange(watch)}
  ${status}
  ${asked}
  ${emailLine}
  ${next}
  <table class="watch-readings">
    <thead><tr><th scope="col">Date</th><th scope="col">Result</th><th scope="col">Who else was named</th></tr></thead>
    <tbody>
    ${readings.map(readingRow).join('\n    ')}
    </tbody>
  </table>
  <p class="hint">${h(SNAPSHOT_LINE)}</p>
  <p class="hint">${h(BOOKMARK_TEXT)}</p>
  <form method="POST" action="/watch/${h(watch.id)}/stop">
    <input type="hidden" name="t" value="${h(watch.stopToken)}">
    <button type="submit" class="button">Stop watching</button>
  </form>
</section>`;
  return watchShell(`Monthly watch for ${name}`, body);
}

/** The confirm page: a button, so a mail scanner that opens the link confirms nothing. */
export function confirmPage(watchId, token) {
  const body = `<section class="message">
  <h1>Confirm your monthly watch</h1>
  <p>${h(WATCH_PROMISE)}</p>
  <p>Press Confirm to start the email alerts.</p>
  <form method="POST" action="/watch/${h(watchId)}/confirm">
    <input type="hidden" name="t" value="${h(token)}">
    <button type="submit" class="button">Confirm</button>
  </form>
</section>`;
  return watchShell('Confirm your monthly watch', body);
}

export function confirmedPage(watchId) {
  const body = `<section class="message">
  <h1>Your monthly watch is on</h1>
  <p>${h(WATCH_PROMISE)}</p>
  <p><a href="/watch/${h(watchId)}">Open your watch page</a></p>
</section>`;
  return watchShell('Your monthly watch is on', body);
}

/** The stop page: a button (GET changes nothing). */
export function stopPage(watchId, token) {
  const body = `<section class="message">
  <h1>Stop watching</h1>
  <p>${h(STOP_TEXT)}</p>
  <form method="POST" action="/watch/${h(watchId)}/stop">
    <input type="hidden" name="t" value="${h(token)}">
    <button type="submit" class="button">Stop watching</button>
  </form>
</section>`;
  return watchShell('Stop watching', body);
}

export function stoppedPage() {
  const body = `<section class="message">
  <h1>The watch is stopped</h1>
  <p>We ended the monthly watch and deleted any email address we held. We won't email you about it again.</p>
  <p><a href="${h(BACK_LINK.href)}">${h(BACK_LINK.text)}</a></p>
</section>`;
  return watchShell('The watch is stopped', body);
}

/** A short page with a heading, one line and a link. */
export function watchMessagePage(title, message, link = BACK_LINK) {
  const body = `<section class="message">
  <h1>${h(title)}</h1>
  <p>${h(message)}</p>
  <p><a href="${h(link.href)}">${h(link.text)}</a></p>
</section>`;
  return watchShell(title, body);
}

export const watchNotFoundPage = () => watchMessagePage(
  'Watch not found',
  'We could not find that watch. It may have been stopped.',
);

// ---- email text -------------------------------------------------------------------------------------------------

/**
 * The plain-text email builders the watch service calls (`emails` option of `createWatchService`).
 * `contactEmail` is CONTACT_EMAIL (the "Questions" line); `postalAddress` is NOTIFY_POSTAL_ADDRESS (a line only when set).
 */
export function watchEmails({ contactEmail = '', postalAddress = '' } = {}) {
  const contact = plainLine(contactEmail);
  const postal = plainLine(postalAddress);
  const footer = urls => [
    '',
    `Your watch page: ${urls.page}`,
    `Stop watching: ${urls.stop}`,
    SENT_BY,
    ...(postal ? [postal] : []),
    ...(contact ? [`Questions: ${contact}`] : []),
  ];
  return {
    confirm({ watch, urls }) {
      const name = plainLine(watch?.input?.name);
      return {
        subject: `Confirm the monthly watch for ${name}`,
        text: [
          `Someone entered this address on the AI Grader report for ${name} and asked for a free monthly check.`,
          WATCH_PROMISE,
          `To start the emails, open this page and press Confirm: ${urls.confirm}`,
          'If this was not you, do nothing. We delete the request in 7 days.',
          ...footer(urls),
        ].join('\n'),
      };
    },
    change({ watch, change, reading, question, urls }) {
      const name = plainLine(watch?.input?.name);
      const started = change === 'started';
      const names = (Array.isArray(reading?.competitors) ? reading.competitors : []).map(plainLine).filter(Boolean).slice(0, 5);
      const lines = [
        started
          ? `Last time we asked, ${WATCH_ASSISTANT} did not name your business. This time it did.`
          : `Last time we asked, ${WATCH_ASSISTANT} named your business. This time it did not.`,
        `We asked: ${plainLine(question)}`,
      ];
      if (names.length > 0) lines.push(`Businesses ${WATCH_ASSISTANT} named this time: ${names.join(', ')}`);
      lines.push(SNAPSHOT_LINE, CHANGE_END, ...footer(urls));
      return { subject: `A change in what ${WATCH_ASSISTANT} says about ${name}`, text: lines.join('\n') };
    },
  };
}
