/**
 * high-tech-look Requirement 12: "Website is reachable". The certificate date and a name that no longer resolves come
 * from the same connection the check already makes (a fake connection here, never the network). Nothing in the safe
 * fetcher is loosened: an expired certificate is still refused. A timeout is "Not checked", never red; the business is
 * never said to have closed; the score does not change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import { createSafeFetcher } from '../server/lib/safe-fetch.js';
import { aliveSignals, buildSignals, FIXES, CERT_WARN_DAYS } from '../server/lib/health-signals.js';
import { websiteDownNotes } from '../server/routes/admin.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const DAY = 86400000;
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

/** A fake https/http request: answers 200 with a small page, and a certificate ending at `validTo`, or fails with `error`. */
function fakeRequest({ validTo, error } = {}) {
  const calls = [];
  const send = (url, opts, cb) => {
    calls.push(url);
    const req = new EventEmitter();
    req.destroy = () => {};
    req.end = () => setImmediate(() => {
      if (error) { req.emit('error', error); return; }
      const res = Readable.from([Buffer.from('<!doctype html><title>Zephyr</title><p>Hello</p>')]);
      res.statusCode = 200;
      res.headers = { 'content-type': 'text/html' };
      res.socket = { getPeerCertificate: () => (validTo ? { valid_to: validTo } : {}) };
      cb(res);
    });
    return req;
  };
  return { http: send, https: send, calls };
}
const okLookup = (host, opts, cb) => cb(null, PUBLIC);

test('the safe fetcher reports the certificate end date from the same connection, and only for https', async () => {
  const f = createSafeFetcher({ request: fakeRequest({ validTo: 'Jan 15 12:00:00 2027 GMT' }), lookup: okLookup });
  const res = await f.fetchText('https://zephyr.example/');
  assert.equal(res.status, 200);
  assert.equal(res.certValidTo, new Date('2027-01-15T12:00:00Z').toISOString());
  const plain = await createSafeFetcher({ request: fakeRequest({ validTo: 'Jan 15 12:00:00 2027 GMT' }), lookup: okLookup }).fetchText('http://zephyr.example/');
  assert.equal('certValidTo' in plain, false);
});

test('an expired certificate is still refused (nothing loosened) and is noted as expired', async () => {
  const f = createSafeFetcher({ request: fakeRequest({ error: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' }) }), lookup: okLookup });
  await assert.rejects(f.fetchText('https://zephyr.example/'), err => err.code === 'connect_failed' && err.tls === 'expired');
  const other = createSafeFetcher({ request: fakeRequest({ error: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) }), lookup: okLookup });
  await assert.rejects(other.fetchText('https://zephyr.example/'), err => err.code === 'connect_failed' && err.tls === undefined);
});

test('a name that does not exist is asked twice; only two "not found" answers count; one bad answer then OK works', async () => {
  let asked = 0;
  const nx = (host, opts, cb) => { asked += 1; cb(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })); };
  const hosts = [];
  const nxSeen = (host, opts, cb) => { hosts.push(host); nx(host, opts, cb); };
  await assert.rejects(createSafeFetcher({ request: fakeRequest(), lookup: nxSeen, dnsRetryDelayMs: 0 }).fetchText('https://gone.example/'),
    err => err.code === 'connect_failed' && err.dns === 'not_found');
  // Batch 3 X10: two tries of the name, then one lookup of its www. name (looked up only, never fetched).
  assert.equal(asked, 3, 'two tries and the www. lookup');
  assert.deepEqual(hosts, ['gone.example', 'gone.example', 'www.gone.example']);

  let tries = 0;
  const once = (host, opts, cb) => { tries += 1; return tries === 1 ? cb(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })) : cb(null, PUBLIC); };
  const res = await createSafeFetcher({ request: fakeRequest(), lookup: once, dnsRetryDelayMs: 0 }).fetchText('https://zephyr.example/');
  assert.equal(res.status, 200);
  assert.equal(tries, 2);

  // Any other lookup error is not retried and is not "not found".
  let other = 0;
  const fail = (host, opts, cb) => { other += 1; cb(Object.assign(new Error('timeout'), { code: 'EAI_AGAIN' })); };
  await assert.rejects(createSafeFetcher({ request: fakeRequest(), lookup: fail }).fetchText('https://zephyr.example/'), err => err.dns === undefined);
  assert.equal(other, 1);
  // The address guard still applies.
  const privateLookup = (host, opts, cb) => cb(null, [{ address: '10.0.0.5', family: 4 }]);
  await assert.rejects(createSafeFetcher({ request: fakeRequest(), lookup: privateLookup }).fetchText('https://zephyr.example/'), err => err.code === 'blocked_address');
});

test('batch 3 X10: a name with only www. set up is not called dead; the second try waits about a second', async () => {
  const nxBare = (host, opts, cb) => (host.startsWith('www.') ? cb(null, PUBLIC) : cb(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })));
  const request = fakeRequest();
  await assert.rejects(createSafeFetcher({ request, lookup: nxBare, dnsRetryDelayMs: 0 }).fetchText('https://zephyr.example/'),
    err => err.code === 'connect_failed' && err.dns === 'www_only');
  assert.equal(request.calls.length, 0, 'nothing is fetched from www.');
  // The wait between the two tries.
  const times = [];
  const timed = (host, opts, cb) => { times.push(Date.now()); cb(Object.assign(new Error('nx'), { code: 'ENOTFOUND' })); };
  await assert.rejects(createSafeFetcher({ request: fakeRequest(), lookup: timed, dnsRetryDelayMs: 200 }).fetchText('https://gone.example/'));
  assert.ok(times[1] - times[0] >= 150, `waited ${times[1] - times[0]} ms`);
  // The address row: Not checked with a reason, never red.
  const row = aliveSignals({ hasSite: true, alive: { reached: false, wwwOnly: true }, now: NOW }).addressWorks;
  assert.equal(row.status, 'not_checked');
  assert.ok(row.reason.includes('www.'));
  assert.equal(FIXES.addressWorks, 'Check that your website address is spelled right, works with and without www, and that your domain name is still paid for.');
});

test('12.1a: valid, expiring, expired (with its date or by its error), http-only and unreadable', () => {
  const at = alive => aliveSignals({ hasSite: true, alive, now: NOW }).certificate;
  const iso = ms => new Date(ms).toISOString();
  assert.deepEqual([at({ reached: true, https: true, certValidTo: iso(NOW + 90 * DAY) }).status, at({ reached: true, https: true, certValidTo: iso(NOW + 90 * DAY) }).label], ['good', 'Valid']);
  // Batch 3 X11: amber only at 7 days or fewer (many sites renew by themselves about 30 days before the end).
  assert.equal(CERT_WARN_DAYS, 7);
  const soon = at({ reached: true, https: true, certValidTo: iso(NOW + 5 * DAY) });
  assert.deepEqual([soon.status, soon.label, soon.fix], ['partly', 'Expires in 5 days', FIXES.certificate]);
  assert.equal(at({ reached: true, https: true, certValidTo: iso(NOW + CERT_WARN_DAYS * DAY) }).status, 'partly', '7 days or fewer');
  assert.equal(at({ reached: true, https: true, certValidTo: iso(NOW + 8 * DAY) }).status, 'good', 'green above 7 days');
  assert.equal(at({ reached: true, https: true, certValidTo: iso(NOW + 10 * DAY) }).status, 'good');
  assert.equal(at({ reached: true, https: true, certValidTo: iso(NOW + 0.5 * DAY) }).label, 'Expires in 1 day');
  const gone = at({ reached: true, https: true, certValidTo: '2026-11-20T00:00:00.000Z' });
  assert.deepEqual([gone.status, gone.label], ['missing', 'Expired on November 20, 2026']);
  assert.deepEqual([at({ reached: false, certExpired: true }).status, at({ reached: false, certExpired: true }).label], ['missing', 'Expired']);
  assert.equal(at({ reached: true, https: false }).status, 'not_checked');
  assert.match(at({ reached: true, https: false }).reason, /https/);
  assert.equal(at({ reached: true, https: true, certValidTo: null }).status, 'not_checked');
  assert.equal(at(null).status, 'not_checked');
  assert.equal(aliveSignals({ hasSite: false, alive: null, now: NOW }).certificate.reason, 'No website given.');
});

test('12.1b: the address is red only when the name no longer resolves (twice); a timeout is Not checked', () => {
  const at = alive => aliveSignals({ hasSite: true, alive, now: NOW }).addressWorks;
  assert.deepEqual([at({ reached: true }).status, at({ reached: true }).label], ['good', 'Works']);
  const dead = at({ reached: false, dnsNotFound: true });
  assert.deepEqual([dead.status, dead.label, dead.fix], ['missing', "Your website address doesn't load", FIXES.addressWorks]);
  const timeout = at({ reached: false });
  assert.equal(timeout.status, 'not_checked', 'a timeout or other error is never red');
  assert.ok(timeout.reason);
  // Batch 5 K9: with no facts from the connection, it says only that the address wasn't tested.
  assert.equal(at(null).status, 'not_checked');
  assert.equal(at(null).reason, "We didn't test your website address on this check.");
  assert.equal(/couldn't reach/.test(at(null).reason), false);
  // Batch 3 X9: an expired certificate was seen, so the address resolved and answered.
  assert.deepEqual([at({ reached: false, certExpired: true }).status, at({ reached: false, certExpired: true }).label], ['good', 'Works']);
});

test('12.2: never "may have closed"; fixes say what to do; every sentence is short and in American spelling', () => {
  const s = buildSignals({ input: { name: 'Zephyr', city: 'Nashville', website: 'https://zephyr.example/' }, alive: { reached: false, dnsNotFound: true, certExpired: true }, now: NOW });
  for (const v of [s.website.certificate, s.website.addressWorks]) {
    for (const text of [v.label, v.reason, v.fix].filter(Boolean)) {
      assert.ok(text.length <= 160, text);
      assert.equal(/closed|out of business|guarantee|colour|centre|licence|\$\d/i.test(text), false, text);
    }
  }
  assert.equal(FIXES.certificate, "Renew your website's security certificate so browsers and AI can open your site.");
});

test('12.3: the admin note "Website may be down" comes from the newest check of the listing\'s business', () => {
  const listings = [
    { id: 'a', website: 'https://zephyr.example/' }, { id: 'b', website: 'https://ridge.example/' }, { id: 'c', website: '' },
  ];
  const grade = (website, w, at, listingId) => ({
    input: { website }, finishedAt: at, signals: { website: w, listing: { listed: { listingId } } },
  });
  const ok = { certificate: { status: 'good' }, addressWorks: { status: 'good' } };
  const notes = websiteDownNotes(listings, [
    grade('https://zephyr.example/', { certificate: { status: 'missing' }, addressWorks: { status: 'good' } }, '2026-11-01T00:00:00Z'),
    grade('https://zephyr.example/', { certificate: { status: 'good' }, addressWorks: { status: 'missing' } }, '2026-11-20T00:00:00Z'),
    grade('https://ridge.example/', { certificate: { status: 'missing' }, addressWorks: { status: 'good' } }, '2026-11-01T00:00:00Z'),
    grade('https://ridge.example/', ok, '2026-11-22T00:00:00Z'),
  ]);
  assert.match(notes.get('a'), /^Website may be down: the last check found its address doesn't load\./);
  assert.equal(notes.has('b'), false, 'the newest check is fine');
  assert.equal(notes.has('c'), false);
  for (const note of notes.values()) assert.equal(/closed/i.test(note), false);
});
