/**
 * addon-monthly-watch task 4: sendToOwner on every notifier. Resend sends one plain-text email to one valid address
 * with only the unsubscribe headers; a failure returns sent: false and never throws; the key and the address are never
 * in a result. The none and console notifiers send nothing (the console logs no address, subject or text); the mock
 * records the email in memory and can be told to fail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createResendNotifier, createNoneNotifier, createConsoleNotifier, createMockNotifier, createNotifier, OWNER_HEADERS,
} from '../server/lib/notifier.js';

const KEY = 're_test_secret_key';
const EMAIL = {
  to: 'owner@acmewash.example',
  subject: 'AI did not name Acme Wash\nthis month',
  text: 'Claude did not name your business this time.\u0000\nWe asked: Who are the best...',
  headers: {
    'List-Unsubscribe': '<https://pages.example.test/watch/abc/stop?t=tok>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'X-Evil': 'injected',
    Bcc: 'someone@example.com',
  },
};

function fakeFetch(reply = { ok: true, status: 200 }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (reply instanceof Error) throw reply;
    return reply;
  };
  fn.calls = calls;
  return fn;
}

const resend = (fetch, extra = {}) => createResendNotifier({
  apiKey: KEY, from: 'Alerts <alerts@pages.example.test>', adminEmail: 'admin@pages.example.test', fetch, ...extra,
});

test('resend: one plain-text email to the owner only, with the unsubscribe headers and nothing else', async () => {
  const fetch = fakeFetch();
  const result = await resend(fetch).sendToOwner(EMAIL);
  assert.deepEqual(result, { notifier: 'resend', sent: true });
  assert.equal(fetch.calls.length, 1);
  const { url, init, body } = fetch.calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(body.to, ['owner@acmewash.example'], 'never the admin, never anyone else');
  assert.equal(body.from, 'Alerts <alerts@pages.example.test>');
  assert.equal(body.subject, 'AI did not name Acme Wash this month', 'one line');
  assert.equal(body.text.includes('\u0000'), false, 'no control characters');
  assert.equal('html' in body, false, 'plain text only');
  assert.deepEqual(body.headers, {
    'List-Unsubscribe': '<https://pages.example.test/watch/abc/stop?t=tok>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
  assert.deepEqual(OWNER_HEADERS, ['List-Unsubscribe', 'List-Unsubscribe-Post']);
});

test('resend: a header value can\'t add another header; no headers means none are sent', async () => {
  const fetch = fakeFetch();
  await resend(fetch).sendToOwner({ ...EMAIL, headers: { 'List-Unsubscribe': '<https://x.example/stop>\r\nBcc: evil@example.com' } });
  assert.deepEqual(fetch.calls[0].body.headers, { 'List-Unsubscribe': '<https://x.example/stop>Bcc: evil@example.com' });
  assert.equal(/[\r\n]/.test(fetch.calls[0].body.headers['List-Unsubscribe']), false);
  await resend(fetch).sendToOwner({ to: EMAIL.to, subject: 's', text: 't' });
  assert.equal('headers' in fetch.calls[1].body, false);
});

test('resend: a bad address sends nothing; a failure returns sent: false and never throws; no key or address in a result', async () => {
  const fetch = fakeFetch();
  for (const to of ['', 'not-an-address', 'a@b', 'one@example.com, two@example.com', undefined, `${'x'.repeat(250)}@example.com`]) {
    assert.deepEqual(await resend(fetch).sendToOwner({ ...EMAIL, to }), { notifier: 'resend', sent: false, error: 'invalid_to' }, String(to));
  }
  assert.equal(fetch.calls.length, 0);
  const refused = await resend(fakeFetch({ ok: false, status: 422 })).sendToOwner(EMAIL);
  assert.deepEqual(refused, { notifier: 'resend', sent: false, error: 'http_422' });
  const thrown = await resend(fakeFetch(Object.assign(new Error(`boom ${KEY} ${EMAIL.to}`), { name: 'TypeError' }))).sendToOwner(EMAIL);
  assert.deepEqual(thrown, { notifier: 'resend', sent: false, error: 'TypeError' });
  for (const r of [refused, thrown]) {
    assert.equal(JSON.stringify(r).includes(KEY), false);
    assert.equal(JSON.stringify(r).includes(EMAIL.to), false);
  }
  // A send that takes too long is given up on.
  const slow = async (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))));
  assert.deepEqual(await resend(slow, { timeoutMs: 5 }).sendToOwner(EMAIL), { notifier: 'resend', sent: false, error: 'TimeoutError' });
});

test('none and console send nothing; the console logs no address, subject or text', async () => {
  assert.deepEqual(await createNoneNotifier().sendToOwner(EMAIL), { notifier: 'none', sent: false });
  const lines = [];
  const consoleNotifier = createConsoleNotifier({ write: line => lines.push(line) });
  assert.deepEqual(await consoleNotifier.sendToOwner(EMAIL), { notifier: 'console', sent: false });
  assert.deepEqual(lines, ['{"event":"watch-email"}\n']);
});

test('mock: records the email in memory, and can be told to fail the next sends', async () => {
  const mock = createMockNotifier();
  assert.deepEqual(await mock.sendToOwner(EMAIL), { notifier: 'mock', sent: true });
  assert.equal(mock.owners.length, 1);
  assert.equal(mock.owners[0].to, EMAIL.to);
  assert.equal(mock.owners[0].headers['List-Unsubscribe'], EMAIL.headers['List-Unsubscribe']);
  mock.failOwnerSends = 2;
  assert.equal((await mock.sendToOwner(EMAIL)).sent, false);
  assert.equal((await mock.sendToOwner(EMAIL)).sent, false);
  assert.equal((await mock.sendToOwner(EMAIL)).sent, true);
  assert.equal(mock.owners.length, 2);
  // Every notifier the app can build has it.
  for (const name of ['mock', 'none', 'console']) {
    assert.equal(typeof createNotifier({ notifierName: name, testRun: true }).sendToOwner, 'function', name);
  }
  assert.equal(typeof createNotifier({ notifierName: 'resend', resend: { apiKey: 'k', from: 'f', adminEmail: 'a@b.example' } }).sendToOwner, 'function');
});
