/**
 * addon-monthly-watch task 7: the watch's pages and email text. Every inserted value is escaped (pages) or made one
 * plain line (emails); no promise words, no dollar signs; plain-text emails have no HTML.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  watchBlock, watchPage, confirmPage, confirmedPage, stopPage, stoppedPage, watchMessagePage, watchNotFoundPage,
  watchEmails, watchDay, plainLine, assistantLabel, SNAPSHOT_LINE, WATCH_FULL_TEXT, WATCH_OFFER_TEXT,
  WATCH_PAGE_ONLY_TEXT, COULD_NOT_CHECK,
} from '../server/lib/watch-html.js';
import { newWatch, addReading, maskEmail } from '../server/lib/watch.js';

const START = Date.UTC(2026, 10, 18, 18, 0, 0);
const DAY = 86400000;
const EVIL = '<script>alert(1)</script>';
const PROMISE = /will name|guarantee|\$/iu;
const BRITISH = /colour|neighbour|licence|centre|organis|favourite/iu;

const grade = { id: 'gradeid000000000000001', status: 'done', input: { name: 'Zephyr Plumbing' } };

function sampleWatch({ name = 'Zephyr Plumbing', email = 'owner@zephyr.example', competitors = ['Other Co'] } = {}) {
  let w = newWatch({
    id: 'watchid000000000000001', gradeId: grade.id, email,
    input: { name, city: 'Nashville', state: 'TN', service: 'plumbers', website: '' },
    confirmToken: 'confirm-token', stopToken: 'stop-token', now: START,
    first: { named: true, position: 2, total: 5, competitors },
  });
  w = { ...w, status: 'active' };
  w = addReading(w, { at: START + 30 * DAY, named: false, total: 4, competitors, source: 'ask' }, { now: START + 30 * DAY, changed: true });
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

test('watchBlock: the form, its plain line, and the email field only when email alerts are on', () => {
  const withEmail = watchBlock(grade, { watch: { stamp: '123.abc', emailOn: true } });
  assert.ok(withEmail.includes(`action="/grade/${grade.id}/watch"`));
  assert.ok(withEmail.includes('method="POST"'));
  assert.ok(withEmail.includes('name="t" value="123.abc"'));
  assert.ok(withEmail.includes('name="email"'));
  assert.ok(withEmail.includes('Watch this every month'));
  assert.ok(withEmail.includes(WATCH_OFFER_TEXT));
  assert.equal(withEmail.includes('<script'), false, 'works without JavaScript');

  const pageOnly = watchBlock(grade, { watch: { stamp: '123.abc', emailOn: false } });
  assert.equal(pageOnly.includes('name="email"'), false);
  assert.ok(pageOnly.includes(WATCH_PAGE_ONLY_TEXT));
});

test('watchBlock at the cap says it is full and has no form', () => {
  const full = watchBlock(grade, { watch: { full: true, stamp: 's', emailOn: true } });
  assert.ok(full.includes(WATCH_FULL_TEXT));
  assert.equal(WATCH_FULL_TEXT, 'Monthly watch is full right now.');
  assert.equal(full.includes('<form'), false);
});

test('watchBlock escapes the stamp, the typed email and the error', () => {
  const out = watchBlock(grade, { watch: { stamp: '"><x', emailOn: true, email: EVIL, error: EVIL } });
  assert.equal(out.includes('<script>'), false);
  assert.ok(out.includes('&lt;script&gt;'));
  assert.equal(out.includes('"><x'), false);
});

// ---- pages --------------------------------------------------------------------------------------------------------

test('watchPage: readings newest first, the latest change on top, the masked address and a stop button', () => {
  const w = sampleWatch();
  const out = watchPage(w, { maskedEmail: maskEmail(w.email), question: 'Who are the best plumbers in Nashville, TN?' });
  assert.ok(out.includes('<meta name="robots" content="noindex, nofollow">'));
  assert.ok(out.includes('Monthly watch for Zephyr Plumbing'));
  assert.ok(out.includes(`${watchDay(new Date(START + 30 * DAY).toISOString())}: AI did not name your business this time.`));
  assert.ok(out.indexOf('Did not name you') < out.indexOf('Named you<'), 'newest first');
  assert.ok(out.includes('Alerts go to o\u2026@z\u2026.example.'));
  assert.equal(out.includes('owner@zephyr.example'), false, 'the full address is never shown');
  assert.ok(out.includes('action="/watch/watchid000000000000001/stop"'));
  assert.ok(out.includes('name="t" value="stop-token"'));
  assert.ok(out.includes('Stop watching'));
  assert.ok(out.includes(SNAPSHOT_LINE));
  assert.ok(out.includes('We ask: Who are the best plumbers in Nashville, TN?'));
  assert.equal(out.includes('<a href="Other'), false, 'names are never linked');
});

test('watchPage keeps only the last 12 readings and shows "We couldn\'t check this month"', () => {
  let w = sampleWatch();
  for (let i = 2; i <= 14; i += 1) {
    w = addReading(w, { at: START + i * 30 * DAY, named: true, source: i === 14 ? 'none' : 'ask' }, { now: START + i * 30 * DAY });
  }
  const out = watchPage(w);
  const rows = out.match(/<tr><td>/gu) ?? [];
  assert.equal(rows.length, 12);
  assert.ok(out.includes(COULD_NOT_CHECK.replace("'", "&#39;")), "the page shows the plain-words line (the apostrophe is escaped)");
});

test('watchPage: pending, paused and page-only states say so', () => {
  const pending = watchPage({ ...sampleWatch(), status: 'pending' });
  assert.ok(pending.includes('press Confirm'));
  const paused = watchPage({ ...sampleWatch(), status: 'paused' });
  assert.ok(paused.includes('This watch is paused'));
  const pageOnly = watchPage({ ...sampleWatch({ email: null }) });
  assert.ok(pageOnly.includes(WATCH_PAGE_ONLY_TEXT));
});

test('watchPage escapes the business name, a competitor name and the question', () => {
  const w = sampleWatch({ name: `Bad ${EVIL}`, competitors: [EVIL, 'A & B'] });
  const out = watchPage(w, { question: `Who does this: "${EVIL}"?` });
  assert.equal(out.includes('<script>'), false);
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(out.includes('A &amp; B'));
});

test('confirm and stop pages are buttons (a GET changes nothing) and escape the token', () => {
  const c = confirmPage('w1', '"><b>');
  assert.ok(c.includes('method="POST" action="/watch/w1/confirm"'));
  assert.ok(c.includes('<button type="submit" class="button">Confirm</button>'));
  assert.equal(c.includes('"><b>'), false);
  const s = stopPage('w1', 'tok');
  assert.ok(s.includes('method="POST" action="/watch/w1/stop"'));
  assert.ok(s.includes('name="t" value="tok"'));
  assert.ok(s.includes('deletes the watch and your email address'));
  assert.ok(stoppedPage().includes('We deleted the watch and your email address.'));
  assert.ok(confirmedPage('w1').includes('href="/watch/w1"'));
  assert.ok(watchMessagePage(EVIL, EVIL, { href: '/x', text: EVIL }).includes('&lt;script&gt;'));
});

test('no page has a promise word, a dollar sign or a British spelling, and each is noindex', () => {
  const pages = [
    watchBlock(grade, { watch: { stamp: 's', emailOn: true } }),
    watchBlock(grade, { watch: { full: true } }),
    watchPage(sampleWatch(), { maskedEmail: 'o\u2026@z\u2026.example', question: 'Who are the best plumbers in Nashville, TN?' }),
    watchPage({ ...sampleWatch(), status: 'paused' }),
    confirmPage('w1', 't'), confirmedPage('w1'), stopPage('w1', 't'), stoppedPage(), watchNotFoundPage(),
  ];
  for (const p of pages) {
    assert.equal(PROMISE.test(p.replace(/<script[^>]*src=[^>]*><\/script>/gu, '')), false);
    assert.equal(BRITISH.test(p), false);
  }
  for (const p of pages.slice(2)) assert.ok(p.includes('noindex, nofollow'));
});

// ---- emails -------------------------------------------------------------------------------------------------------

test('the change email: what changed, the question, up to 5 names, the snapshot line, both links', () => {
  const emails = watchEmails({ contactEmail: 'help@pages.example.test', assistantName: 'Claude' });
  const w = sampleWatch();
  const stopped = emails.change({
    watch: w, change: 'stopped', question: 'Who are the best plumbers in Nashville, TN? Name your top 5.', urls,
    reading: { competitors: ['A', 'B', 'C', 'D', 'E', 'F'] },
  });
  assert.equal(stopped.subject, 'AI did not name Zephyr Plumbing this month');
  const lines = stopped.text.split('\n');
  assert.equal(lines[0], 'Claude did not name your business this time.');
  assert.equal(lines[1], 'We asked: Who are the best plumbers in Nashville, TN? Name your top 5.');
  assert.equal(lines[2], 'Claude named instead: A, B, C, D, E');
  assert.ok(lines.includes(SNAPSHOT_LINE));
  assert.ok(lines.includes(`Your watch page: ${urls.page}`));
  assert.ok(lines.includes(`Stop watching: ${urls.stop}`));
  assert.ok(lines.includes('Questions: help@pages.example.test'));

  const started = emails.change({ watch: w, change: 'started', question: 'Q?', urls, reading: { competitors: ['A'] } });
  assert.equal(started.subject, 'AI named Zephyr Plumbing this month');
  assert.ok(started.text.startsWith('Claude named your business this time.'));
  assert.ok(started.text.includes('Claude also named: A'));
  assert.equal(watchEmails().change({ watch: w, change: 'started', question: 'Q?', urls, reading: {} }).text.includes('Questions:'), false);
});

test('the confirm email has the confirm and stop links', () => {
  const mail = watchEmails().confirm({ watch: sampleWatch(), urls });
  assert.ok(mail.text.includes(urls.confirm));
  assert.ok(mail.text.includes(urls.stop));
  assert.ok(mail.subject.includes('Zephyr Plumbing'));
});

test('emails are plain text: no HTML, no control characters or line breaks in an inserted value, no promises', () => {
  const emails = watchEmails({ contactEmail: 'help@x.test\r\nBcc: a@b.test', assistantName: 'Claude' });
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
