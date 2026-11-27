/**
 * watch-html.js: the monthly watch's pages and email text (addon-monthly-watch task 7).
 *
 *  - watchBlock(grade, opts): the small opt-in form in the full report ("Watch this every month"). Empty unless the
 *    route says the watch may be offered (`opts.watch`).
 *  - watchPage, confirmPage, confirmedPage, stopPage, stoppedPage, watchMessagePage: the /watch pages.
 *  - watchEmails({ contactEmail, assistantName }): the plain-text email builders the watch service uses.
 *
 * Every inserted value is escaped with `escapeHtml` on a page, and made one plain line (control characters and line
 * breaks removed) in an email. Business names from AI answers are never linked. Nothing here says that a fix or a
 * listing makes AI name a business.
 */

import { layout, escapeHtml } from './html.js';
import { lastReading } from './watch.js';

const h = value => escapeHtml(value ?? '');
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';

/** The line every alert and the watch page carry (requirement 9). */
export const SNAPSHOT_LINE = 'AI answers change from one time to the next, so this is one snapshot, not a ranking.';
/** Shown instead of the form when WATCH_MAX_ACTIVE watches are running (requirement 7). */
export const WATCH_FULL_TEXT = 'Monthly watch is full right now.';
/** The line above the button (requirement 3). */
export const WATCH_OFFER_TEXT = 'We ask AI the same question once a month. We tell you on your watch page, and by email if you give one, when AI stops naming your business or starts. You can stop any time.';
/** With a notifier that sends no email (requirement 12). */
export const WATCH_PAGE_ONLY_TEXT = 'Alerts show on your watch page only.';
/** A reading that could not run on 3 days in a row. */
export const COULD_NOT_CHECK = "We couldn't check this month";

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
    <p>${h(WATCH_OFFER_TEXT)}</p>
    <button type="submit" class="button">Watch this every month</button>
  </form>
</section>`;
}

// ---- the watch page ---------------------------------------------------------------------------------------------

function readingRow(r) {
  const what = r.source === 'none' ? COULD_NOT_CHECK : (r.named ? 'Named you' : 'Did not name you');
  const others = r.source === 'none' || !Array.isArray(r.competitors) || r.competitors.length === 0
    ? '&nbsp;'
    : r.competitors.map(n => h(n)).join(', ');
  return `<tr><td>${h(watchDay(r.at))}</td><td>${h(what)}</td><td>${others}</td></tr>`;
}

/** The latest change, on top (requirement 10). */
function latestChange(watch) {
  if (!watch.lastChangeAt) return '';
  const last = lastReading(watch);
  if (!last) return '';
  const text = last.named ? 'AI named your business this time.' : 'AI did not name your business this time.';
  return `<p class="notice" role="status">${h(`${watchDay(watch.lastChangeAt)}: ${text}`)}</p>`;
}

/**
 * The owner's own watch page: the last 12 readings (newest first), the latest change on top, which address gets
 * alerts (masked), and a "Stop watching" button. `maskedEmail` comes from `maskEmail`.
 */
export function watchPage(watch, { maskedEmail = '', question = '' } = {}) {
  const name = watch?.input?.name ?? '';
  const readings = (Array.isArray(watch?.readings) ? watch.readings : []).slice(-12).reverse();
  const status = watch.status === 'pending'
    ? `<p class="notice" role="status">Check your email and press Confirm to start the email alerts. Until then this page is not watched.</p>`
    : watch.status === 'paused'
      ? `<p class="notice" role="alert">This watch is paused: our last 3 emails to you did not go through.</p>`
      : '';
  const emailLine = maskedEmail
    ? `<p>Alerts go to ${h(maskedEmail)}.</p>`
    : `<p>${h(WATCH_PAGE_ONLY_TEXT)}</p>`;
  const next = watch.status === 'active' && watch.nextDueAt
    ? `<p>Next check: around ${h(watchDay(watch.nextDueAt))}.</p>`
    : '';
  const asked = question ? `<p>We ask: ${h(question)}</p>` : '';
  const body = `<section class="message watch-page">
  <h1>Monthly watch for ${h(name)}</h1>
  ${latestChange(watch)}
  ${status}
  ${asked}
  ${emailLine}
  ${next}
  <p class="hint">Keep this page's address. It is the only way back to your watch.</p>
  <table class="watch-readings">
    <thead><tr><th scope="col">Date</th><th scope="col">Result</th><th scope="col">Who else was named</th></tr></thead>
    <tbody>
    ${readings.map(readingRow).join('\n    ')}
    </tbody>
  </table>
  <p class="hint">${h(SNAPSHOT_LINE)}</p>
  <form method="POST" action="/watch/${h(watch.id)}/stop">
    <input type="hidden" name="t" value="${h(watch.stopToken)}">
    <button type="submit" class="button">Stop watching</button>
  </form>
</section>`;
  return watchShell(`Monthly watch for ${name}`, body);
}

/** The confirm page: a button, so a mail scanner that opens the link confirms nothing (requirement 4). */
export function confirmPage(watchId, token) {
  const body = `<section class="message">
  <h1>Confirm your monthly watch</h1>
  <p>Press Confirm to get an email when AI stops naming your business or starts.</p>
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
  <p>We will email you when AI stops naming your business or starts. AI assistants pick up changes over days to weeks.</p>
  <p><a href="/watch/${h(watchId)}">Open your watch page</a></p>
</section>`;
  return watchShell('Your monthly watch is on', body);
}

/** The stop page: a button (GET changes nothing, requirement 11). */
export function stopPage(watchId, token) {
  const body = `<section class="message">
  <h1>Stop watching</h1>
  <p>This deletes the watch and your email address. You can start a new watch from a new report later.</p>
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
  <p>We deleted the watch and your email address. We won't email you about it again.</p>
  <p><a href="/grade">Back to the check</a></p>
</section>`;
  return watchShell('The watch is stopped', body);
}

/** A short page with a heading, one line and a link. */
export function watchMessagePage(title, message, link = { href: '/grade', text: 'Back to the check' }) {
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
 * `assistantName` is the main assistant's name for people ("Claude"); `contactEmail` is CONTACT_EMAIL, or ''.
 */
export function watchEmails({ contactEmail = '', assistantName = 'AI' } = {}) {
  const who = plainLine(assistantName) || 'AI';
  const contact = plainLine(contactEmail);
  const footer = urls => [
    `Your watch page: ${urls.page}`,
    `Stop watching: ${urls.stop}`,
    ...(contact ? [`Questions: ${contact}`] : []),
  ];
  return {
    confirm({ watch, urls }) {
      const name = plainLine(watch?.input?.name);
      return {
        subject: `Confirm the monthly watch for ${name}`,
        text: [
          `Someone asked us to email this address when AI stops naming ${name} or starts.`,
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
        started ? `${who} named your business this time.` : `${who} did not name your business this time.`,
        `We asked: ${plainLine(question)}`,
      ];
      if (names.length > 0) lines.push(`${started ? `${who} also named` : `${who} named instead`}: ${names.join(', ')}`);
      lines.push(SNAPSHOT_LINE, ...footer(urls));
      return {
        subject: started ? `AI named ${name} this month` : `AI did not name ${name} this month`,
        text: lines.join('\n'),
      };
    },
  };
}
