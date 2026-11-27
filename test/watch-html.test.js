/**
 * addon-monthly-watch task 7 and the 2026-11-27 wording pass: the watch's pages and email text. Every inserted value
 * is escaped (pages) or made one plain line (emails); no promise words, no dollar signs; plain-text emails have no
 * HTML. The wording tests quote the reader list (fixes-2026-11-27-reader.md) item by item.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  watchBlock, watchPage, confirmPage, confirmedPage, stopPage, stoppedPage, watchMessagePage, watchNotFoundPage,
  watchEmails, watchDay, plainLine, assistantLabel, pendingText, pausedText, firstCheckText,
  SNAPSHOT_LINE, WATCH_FULL_TEXT, WATCH_OFFER_TEXT, WATCH_PAGE_ONLY_TEXT, COULD_NOT_CHECK, WATCH_PROMISE,
  NAMED_TEXT, NOT_NAMED_TEXT, NO_OTHERS_TEXT, BOOKMARK_TEXT, STOP_TEXT, SENT_BY, CHANGE_END, RATE_LIMIT_TEXT,
  BAD_CONFIRM_TEXT, BACK_LINK, ALREADY_WATCHING_TEXT,
} from '../server/lib/watch-html.js';
import { newWatch, addReading, maskEmail } from '../server/lib/watch.js';

const START = Date.UTC(2026, 10, 18, 18, 0, 0);
const DAY = 86400000;
const EVIL = '<script>alert(1)</script>';
const PROMISE = /will name|will rank|guarantee|\$/iu;
const BRITISH = /colour|neighbour|licence|centre|organis|favourite/iu;
const TOOL = /\btools?\b/iu;

const grade = { id: 'gradeid000000000000001', status: 'done', input: { name: 'Zephyr Plumbing' } };

function sampleWatch({ name = 'Zephyr Plumbing', email = 'owner@zephyr.example', competitors = ['Other Co'], checked = true } = {}) {
  let w = newWatch({
    id: 'watchid000000000000001', gradeId: grade.id, email,
    input: { name, city: 'Nashville', state: 'TN', service: 'plumbers', website: '' },
    confirmToken: 'confirm-token', stopToken: 'stop-token', now: START,
    first: { named: true, position: 2, total: 5, competitors },
  });
  w = { ...w, status: 'active' };
  if (checked) {
    w = addReading(w, { at: START + 30 * DAY, named: false, total: 4, competitors, source: 'ask' }, { now: START + 30 * DAY, changed: true });
  }
  return w;
}

const urls = { page: 'https://pages.example.test/watch/w1', confirm: 'https://pages.example.test/watch/w1/confirm?t=c', stop: 'https://pages.example.test/watch/w1/stop?t=s' };

// ---- watchBlock -------------------------------------------------------------------------------------------------

test('watchBlock shows nothing without the route\'s go-ahead, or on a printout', () => {
  assert.equal(watchBlock(grade, {}), '');
  assert.equal(watchBlock(grade), '');
  assert.equal(watchBlock(grade, { watch: null }), '');
  assert.equal(watchBlock(grade, { watch: { stamp: 's' }, print: true }), '');
});

test('watchBlock: the form, the promise, the offer line, and the email field only when email alerts are on', () => {
  const withEmail = watchBlock(grade, { watch: { stamp: '123.abc', emailOn: true } });
  assert.ok(withEmail.includes(`action="/grade/${grade.id}/watch"`));
  assert.ok(withEmail.includes('method="POST"'));
  assert.ok(withEmail.includes('name="t" value="123.abc"'));
  assert.ok(withEmail.includes('name="email"'));
  assert.ok(withEmail.includes('Watch this every month'));
  assert.ok(withEmail.includes(WATCH_PROMISE));
  assert.ok(withEmail.includes(WATCH_OFFER_TEXT));
  assert.equal(withEmail.includes('<script'), false, 'works without JavaScript');

  const pageOnly = watchBlock(grade, { watch: { stamp: '123.abc', emailOn: false } });
  assert.equal(pageOnly.includes('name="email"'), false);
  assert.ok(pageOnly.includes(WATCH_PAGE_ONLY_TEXT));
});

test('reader item 3: the offer line', () => {
  assert.equal(WATCH_OFFER_TEXT, 'Free. Once a month we ask Claude the same question again. We email you only if the answer changes, and your email address is used for nothing else. Stop any time.');
});

test('reader items 2 and 10: watchBlock at the cap says it is full, with a next step, and has no form', () => {
  const full = watchBlock(grade, { watch: { full: true, stamp: 's', emailOn: true } });
  assert.ok(full.includes(WATCH_FULL_TEXT));
  assert.equal(WATCH_FULL_TEXT, 'Monthly watch is full right now. Please try again in a few weeks.');
  assert.equal(full.includes('<form'), false);
});

test('watchBlock escapes the stamp, the typed email and the error', () => {
  const out = watchBlock(grade, { watch: { stamp: '"><x', emailOn: true, email: EVIL, error: EVIL } });
  assert.equal(out.includes('<script>'), false);
  assert.ok(out.includes('&lt;script&gt;'));
  assert.equal(out.includes('"><x'), false);
});

// ---- the promise, said the same everywhere ---------------------------------------------------------------------

test('reader item 2: one promise, word for word, on the offer, the confirm page, the confirmed page and the confirm email', () => {
  assert.equal(WATCH_PROMISE, 'We will tell you if an AI assistant starts or stops recommending your business.');
  assert.ok(watchBlock(grade, { watch: { stamp: 's' } }).includes(WATCH_PROMISE));
  assert.ok(confirmPage('w1', 't').includes(WATCH_PROMISE));
  assert.ok(confirmedPage('w1').includes(WATCH_PROMISE));
  assert.ok(watchEmails().confirm({ watch: sampleWatch(), urls }).text.includes(WATCH_PROMISE));
});

test('reader item 6: the confirmed page has no "days to weeks" line', () => {
  assert.equal(confirmedPage('w1').includes('days to weeks'), false);
  assert.equal(confirmedPage('w1').includes('pick up changes'), false);
});

// ---- the watch page ------------------------------------------------------------------------------------------------

test('watchPage: newest first, the latest change on top, the masked address and a stop button', () => {
  const w = sampleWatch();
  const out = watchPage(w, { maskedEmail: maskEmail(w.email), question: 'Who are the best plumbers in Nashville, TN?' });
  assert.ok(out.includes('<meta name="robots" content="noindex, nofollow">'));
  assert.ok(out.includes('Monthly watch for Zephyr Plumbing'));
  assert.ok(out.includes(`${watchDay(new Date(START + 30 * DAY).toISOString())}: Claude did not name your business this time.`));
  assert.ok(out.indexOf(`<td>${NOT_NAMED_TEXT}</td>`) < out.indexOf(`<td>${NAMED_TEXT}</td>`), 'newest first');
  assert.ok(out.includes('Alerts go to o\u2026@z\u2026.example.'));
  assert.equal(out.includes('owner@zephyr.example'), false, 'the full address is never shown');
  assert.ok(out.includes('action="/watch/watchid000000000000001/stop"'));
  assert.ok(out.includes('name="t" value="stop-token"'));
  assert.ok(out.includes('Stop watching'));
  assert.ok(out.includes(SNAPSHOT_LINE));
  assert.ok(out.includes('We ask Claude: Who are the best plumbers in Nashville, TN?'));
  assert.ok(out.includes(`Next monthly check: around ${watchDay(w.nextDueAt)}.`));
  assert.equal(out.includes('<a href="Other'), false, 'names are never linked');
});

test('reader item 8: the table words, the empty cell, the first-check line and the bookmark line', () => {
  assert.equal(NAMED_TEXT, 'Claude named your business');
  assert.equal(NOT_NAMED_TEXT, 'Claude did not name your business');
  assert.equal(NO_OTHERS_TEXT, 'No other businesses named');
  assert.equal(BOOKMARK_TEXT, 'Bookmark this page. If you gave an email, the link is in every message too.');
  const none = watchPage(sampleWatch({ competitors: [] }));
  assert.ok(none.includes(`<td>${NO_OTHERS_TEXT}</td>`));
  assert.ok(none.includes(BOOKMARK_TEXT));
  // Before the first monthly check: only the report's own answer is there.
  const fresh = sampleWatch({ checked: false });
  const page = watchPage(fresh);
  assert.ok(page.includes(firstCheckText(fresh.nextDueAt)));
  assert.equal(firstCheckText(fresh.nextDueAt), `Your first check will appear here by ${watchDay(fresh.nextDueAt)}.`);
  assert.equal(page.includes('Next monthly check'), false);
  assert.equal(watchPage(sampleWatch()).includes('Your first check will appear here'), false);
});

test('reader item 12: "We couldn\'t check this month. We will try again next month." and only the last 12 readings', () => {
  assert.equal(COULD_NOT_CHECK, "We couldn't check this month. We will try again next month.");
  let w = sampleWatch();
  for (let i = 2; i <= 14; i += 1) {
    w = addReading(w, { at: START + i * 30 * DAY, named: true, source: i === 14 ? 'none' : 'ask' }, { now: START + i * 30 * DAY });
  }
  const out = watchPage(w);
  const rows = out.match(/<tr><td>/gu) ?? [];
  assert.equal(rows.length, 12);
  assert.ok(out.includes('We couldn&#39;t check this month. We will try again next month.'));
});

test('reader item 7: the pending and paused pages name the masked address', () => {
  const masked = 'o\u2026@z\u2026.example';
  const pending = watchPage({ ...sampleWatch(), status: 'pending' }, { maskedEmail: masked });
  assert.equal(pendingText(masked), `We sent a message to ${masked}. Press Confirm in it to start the email alerts. Until you do, we will not email you.`);
  assert.ok(pending.includes(pendingText(masked)));
  const paused = watchPage({ ...sampleWatch(), status: 'paused' }, { maskedEmail: masked });
  assert.equal(pausedText(masked), `We paused the monthly checks because 3 emails to ${masked} bounced. Start a new watch from a new report with a working address.`);
  assert.ok(paused.includes(pausedText(masked)));
  assert.ok(pausedText('').includes('3 emails to your address bounced'), 'an address already cleared');
  const pageOnly = watchPage({ ...sampleWatch({ email: null }) });
  assert.ok(pageOnly.includes(WATCH_PAGE_ONLY_TEXT));
});

test('a second start on the same report says it already has a watch', () => {
  assert.ok(watchPage(sampleWatch(), { already: true }).includes(ALREADY_WATCHING_TEXT));
  assert.equal(watchPage(sampleWatch()).includes(ALREADY_WATCHING_TEXT), false);
});

test('watchPage escapes the business name, a competitor name and the question', () => {
  const w = sampleWatch({ name: `Bad ${EVIL}`, competitors: [EVIL, 'A & B'] });
  const out = watchPage(w, { question: `Who does this: "${EVIL}"?` });
  assert.equal(out.includes('<script>'), false);
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(out.includes('A &amp; B'));
});

// ---- the small pages -------------------------------------------------------------------------------------------

test('confirm and stop pages are buttons (a GET changes nothing) and escape the token', () => {
  const c = confirmPage('w1', '"><b>');
  assert.ok(c.includes('method="POST" action="/watch/w1/confirm"'));
  assert.ok(c.includes('<button type="submit" class="button">Confirm</button>'));
  assert.equal(c.includes('"><b>'), false);
  const s = stopPage('w1', 'tok');
  assert.ok(s.includes('method="POST" action="/watch/w1/stop"'));
  assert.ok(s.includes('name="t" value="tok"'));
  assert.ok(confirmedPage('w1').includes('href="/watch/w1"'));
  assert.ok(watchMessagePage(EVIL, EVIL, { href: '/x', text: EVIL }).includes('&lt;script&gt;'));
});

test('reader item 9: the stop pages\' words, and "Back to the AI Grader"', () => {
  assert.equal(STOP_TEXT, 'This ends the monthly watch and deletes any email address we hold. You can start a new one from your report whenever you like.');
  assert.ok(stopPage('w1', 't').includes(STOP_TEXT));
  assert.ok(stoppedPage().includes('>Back to the AI Grader</a>'));
  assert.equal(stoppedPage().includes('Back to the check'), false);
  assert.ok(watchNotFoundPage().includes('>Back to the AI Grader</a>'));
  assert.deepEqual(BACK_LINK, { href: '/grade', text: 'Back to the AI Grader' });
});

test('reader item 10: the messages with a next step', () => {
  assert.equal(RATE_LIMIT_TEXT, 'Too many requests came from your network. Please wait an hour and try again.');
  assert.equal(BAD_CONFIRM_TEXT, 'Open the newest email from the AI Grader and press Confirm again.');
});

test('reader item 5: the snapshot line', () => {
  assert.equal(SNAPSHOT_LINE, 'Claude can answer differently each time you ask, so treat this as one example, not your place in a list.');
});

test('no page has a promise word, a dollar sign, "tool" or a British spelling, and each is noindex', () => {
  const pages = [
    watchBlock(grade, { watch: { stamp: 's', emailOn: true } }),
    watchBlock(grade, { watch: { full: true } }),
    watchPage(sampleWatch(), { maskedEmail: 'o\u2026@z\u2026.example', question: 'Who are the best plumbers in Nashville, TN?' }),
    watchPage({ ...sampleWatch(), status: 'paused' }),
    watchPage({ ...sampleWatch(), status: 'pending' }),
    confirmPage('w1', 't'), confirmedPage('w1'), stopPage('w1', 't'), stoppedPage(), watchNotFoundPage(),
  ];
  for (const p of pages) {
    const text = p.replace(/<script[^>]*src=[^>]*><\/script>/gu, '');
    assert.equal(PROMISE.test(text), false);
    assert.equal(BRITISH.test(p), false);
    assert.equal(TOOL.test(text.replace(/<[^>]*>/gu, ' ')), false);
  }
  for (const p of pages.slice(2)) assert.ok(p.includes('noindex, nofollow'));
});

// ---- emails -------------------------------------------------------------------------------------------------------

test('reader item 4: the change alert\'s subject, body, list line and last line', () => {
  const emails = watchEmails({ contactEmail: 'help@pages.example.test' });
  const w = sampleWatch();
  const stopped = emails.change({
    watch: w, change: 'stopped', question: 'Who are the best plumbers in Nashville, TN? Name your top 5.', urls,
    reading: { competitors: ['A', 'B', 'C', 'D', 'E', 'F'] },
  });
  assert.equal(stopped.subject, 'A change in what Claude says about Zephyr Plumbing');
  const lines = stopped.text.split('\n');
  assert.equal(lines[0], 'Last time we asked, Claude named your business. This time it did not.');
  assert.equal(lines[1], 'We asked: Who are the best plumbers in Nashville, TN? Name your top 5.');
  assert.equal(lines[2], 'Businesses Claude named this time: A, B, C, D, E');
  assert.ok(lines.includes(SNAPSHOT_LINE));
  assert.ok(lines.includes(CHANGE_END));
  assert.equal(CHANGE_END, 'You get an email only when this changes. We check once a month.');
  assert.ok(lines.includes(`Your watch page: ${urls.page}`));
  assert.ok(lines.includes(`Stop watching: ${urls.stop}`));
  assert.ok(lines.includes('Questions: help@pages.example.test'));

  const started = emails.change({ watch: w, change: 'started', question: 'Q?', urls, reading: { competitors: ['A'] } });
  assert.equal(started.subject, 'A change in what Claude says about Zephyr Plumbing');
  assert.ok(started.text.startsWith('Last time we asked, Claude did not name your business. This time it did.'));
  assert.ok(started.text.includes('Businesses Claude named this time: A'));
  assert.equal(watchEmails().change({ watch: w, change: 'started', question: 'Q?', urls, reading: {} }).text.includes('Questions:'), false);
});

test('reader item 1: the confirm email says who sends it, and every footer has the sender line and the stop link', () => {
  const mail = watchEmails().confirm({ watch: sampleWatch(), urls });
  assert.ok(mail.text.startsWith('Someone entered this address on the AI Grader report for Zephyr Plumbing and asked for a free monthly check.'));
  assert.ok(mail.text.includes(urls.confirm));
  assert.ok(mail.text.includes(urls.stop));
  assert.ok(mail.subject.includes('Zephyr Plumbing'));
  for (const m of [mail, watchEmails().change({ watch: sampleWatch(), change: 'stopped', question: 'Q?', urls, reading: {} })]) {
    const lines = m.text.split('\n');
    assert.ok(lines.includes(SENT_BY), 'the sender line');
    assert.equal(SENT_BY, 'Sent by the AI Grader from First Answer Pages.');
    assert.ok(lines.includes(`Stop watching: ${urls.stop}`));
  }
});

test('reader item 1: the postal address line only when NOTIFY_POSTAL_ADDRESS is set; Questions only with CONTACT_EMAIL', () => {
  const w = sampleWatch();
  const none = watchEmails().confirm({ watch: w, urls }).text;
  const lines = none.split('\n');
  assert.equal(lines.at(-1), SENT_BY, 'no postal line and no Questions line when neither is set');
  const withPostal = watchEmails({ postalAddress: 'First Answer, 12 Main St\nNashville, TN 37203' }).confirm({ watch: w, urls }).text.split('\n');
  assert.equal(withPostal.at(-1), 'First Answer, 12 Main St Nashville, TN 37203', 'one plain line');
  assert.equal(withPostal.at(-2), SENT_BY);
  const both = watchEmails({ postalAddress: 'PO Box 1, Nashville, TN', contactEmail: 'help@x.test' }).change({ watch: w, change: 'started', question: 'Q?', urls, reading: {} }).text.split('\n');
  assert.deepEqual(both.slice(-3), [SENT_BY, 'PO Box 1, Nashville, TN', 'Questions: help@x.test']);
  assert.equal(watchEmails({ postalAddress: '   ' }).confirm({ watch: w, urls }).text.split('\n').at(-1), SENT_BY, 'blank means no line');
});

test('emails are plain text: no HTML, no control characters or line breaks in an inserted value, no promises', () => {
  const emails = watchEmails({ contactEmail: 'help@x.test\r\nBcc: a@b.test', postalAddress: 'Box 1\r\nBcc: c@d.test' });
  const w = sampleWatch({ name: 'Zephyr\r\nBcc: evil@x.test\u0000 Plumbing' });
  const all = [
    emails.confirm({ watch: w, urls }),
    emails.change({ watch: w, change: 'stopped', question: 'Who\nis best?', urls, reading: { competitors: ['Other\u202ECo', 'Line\nBreak'] } }),
    emails.change({ watch: w, change: 'started', question: 'Q?', urls, reading: { competitors: [] } }),
  ];
  for (const mail of all) {
    assert.equal(/[\r\n]/u.test(mail.subject), false);
    assert.equal(/<\/?[a-z][^>]*>/iu.test(mail.text), false, 'no HTML');
    assert.equal(/[\u0000-\u0009\u000B-\u001F\u202E]/u.test(mail.text), false);
    assert.equal(PROMISE.test(`${mail.subject}\n${mail.text}`), false);
    assert.equal(BRITISH.test(mail.text), false);
    assert.equal(TOOL.test(mail.text), false);
    for (const line of mail.text.split('\n')) assert.equal(line.startsWith('Bcc:'), false, 'no header injection');
  }
  assert.ok(all[1].text.includes('We asked: Who is best?'));
  assert.ok(all[1].text.includes('Other Co, Line Break'));
});

test('helpers: plainLine, assistantLabel, watchDay', () => {
  assert.equal(plainLine(' a\tb\r\nc\u0000 '), 'a b c');
  assert.equal(plainLine(undefined), '');
  assert.equal(assistantLabel('anthropic'), 'Claude');
  assert.equal(assistantLabel('openai'), 'ChatGPT');
  assert.equal(assistantLabel('mock'), 'AI');
  assert.equal(watchDay('2026-11-24T18:00:00.000Z'), 'November 24, 2026');
  assert.equal(watchDay('nope'), '');
});
