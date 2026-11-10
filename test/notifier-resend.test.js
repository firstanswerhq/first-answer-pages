// Tests for the none and resend notifiers and the NOTIFIER setting.
// fetch is always a stub: no network calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNoneNotifier, createResendNotifier } from '../server/lib/notifier.js';
import { notifierName, startupProblems } from '../server/lib/config.js';

const quote = { id: 'q1', name: 'Pat', contact: 'pat@example.com', details: 'Fix a leak' };
const KEY = 'sekret-key-123';

test('none notifier never claims it sent anything', async () => {
  assert.deepEqual(await createNoneNotifier().notify({ quote, listing: { name: 'X' } }), { notifier: 'none', sent: false });
});

test('resend notifier posts to Resend, to owner and admin, with the bearer key', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  const n = createResendNotifier({ apiKey: KEY, from: 'q@x.test', adminEmail: 'admin@x.test', fetch });
  const result = await n.notify({ quote, listing: { name: 'Pipe Pros', ownerEmail: 'owner@x.test' } });
  assert.deepEqual(result, { notifier: 'resend', sent: true });
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ['owner@x.test', 'admin@x.test']);
  assert.ok(body.text.includes('Pipe Pros') && body.text.includes('Fix a leak'));
});

test('resend notifier skips a bad owner email and reports failure without the key', async () => {
  const bodies = [];
  const ok = async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
  await createResendNotifier({ apiKey: KEY, from: 'q@x.test', adminEmail: 'admin@x.test', fetch: ok })
    .notify({ quote, listing: { name: 'A', ownerEmail: 'not an email' } });
  assert.deepEqual(bodies[0].to, ['admin@x.test']);

  const bad = async () => ({ ok: false, status: 401 });
  const r1 = await createResendNotifier({ apiKey: KEY, from: 'q@x.test', adminEmail: 'a@x.test', fetch: bad }).notify({ quote, listing: { name: 'A' } });
  assert.equal(r1.sent, false);
  const boom = async () => { throw new Error(`failed with ${KEY}`); };
  const r2 = await createResendNotifier({ apiKey: KEY, from: 'q@x.test', adminEmail: 'a@x.test', fetch: boom }).notify({ quote, listing: { name: 'A' } });
  assert.equal(r2.sent, false);
  assert.ok(!JSON.stringify([r1, r2]).includes(KEY));
});

test('NOTIFIER setting: default none, resend needs all three, production refuses to start without them', () => {
  const warn = () => {};
  assert.equal(notifierName({}, { warn }), 'none');
  assert.equal(notifierName({ NOTIFIER: 'bogus' }, { warn }), 'none');
  assert.equal(notifierName({ NOTIFIER: 'resend' }, { warn }), 'none');
  assert.equal(notifierName({ NOTIFIER: 'resend', RESEND_API_KEY: 'k', NOTIFY_FROM: 'f@x.test', ADMIN_EMAIL: 'a@x.test' }, { warn }), 'resend');
  const base = { NODE_ENV: 'production', DATA_DIR: '/d', BASE_URL: 'https://x.test', NOTIFIER: 'resend', RESEND_API_KEY: 'k' };
  const problems = startupProblems(base);
  assert.ok(problems.some(p => p.includes('NOTIFY_FROM')) && problems.some(p => p.includes('ADMIN_EMAIL')));
  assert.ok(!problems.join(' ').includes('"k"'));
});
