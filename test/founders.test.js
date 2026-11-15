/**
 * Founding Member program: the first `cap` approved listings whose owners
 * signed up before the deadline get a permanent number and badge.
 * Every test uses its own temporary data folder.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createDataStore } from '../server/data.js';
import { createApp } from '../server/app.js';
import { configFromEnv } from '../server/lib/config.js';
import {
  parseFoundersCap, parseFoundersDeadline, earnsFounderSpot, nextFounderNumber, foundersStatus,
  formatFoundersDeadline, DEFAULT_FOUNDERS_CAP, DEFAULT_FOUNDERS_DEADLINE,
} from '../server/lib/founders.js';
import { founderBadge, foundersInvite } from '../server/lib/html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const DEADLINE = '2027-02-01T06:00:00.000Z';
const BEFORE = '2026-12-01T12:00:00.000Z';
const dirs = [];
after(async () => { for (const d of dirs) await fs.rm(d, { recursive: true, force: true }); });

function draft(i, status = 'pending') {
  return {
    id: `d${i}`, status, missingFields: [], createdAt: BEFORE,
    fields: {
      name: `Founder Test Plumbing ${i}`, category: 'plumbers', phone: `(615) 555-01${String(i).padStart(2, '0')}`,
      services: ['Leak repair'], serviceArea: 'Greater Springfield', description: 'We fix pipes and leaks.',
      city: 'Springfield', state: 'TN',
    },
  };
}

async function makeDir(count, { submittedAt = BEFORE } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-founders-'));
  dirs.push(dir);
  await fs.copyFile(path.join(REPO_DATA, 'categories.json'), path.join(dir, 'categories.json'));
  await fs.writeFile(path.join(dir, 'listings.json'), '[]');
  const drafts = Array.from({ length: count }, (_, i) => draft(i + 1));
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify(drafts));
  await fs.writeFile(path.join(dir, 'pending.json'), JSON.stringify(
    drafts.map(d => ({ id: d.id, draftId: d.id, submittedAt, status: 'pending' })),
  ));
  return dir;
}

function storeFor(dir, { cap = 500, now = BEFORE, deadline = DEADLINE } = {}) {
  const clock = { at: now, now() { return new Date(this.at); } };
  const store = createDataStore({ dataDir: dir, clock, includeSamples: false, founders: { cap, deadline } });
  return { store, clock };
}

test('settings: defaults, and bad values fall back to the defaults', () => {
  assert.equal(parseFoundersCap(undefined), DEFAULT_FOUNDERS_CAP);
  assert.equal(parseFoundersCap('250'), 250);
  assert.equal(parseFoundersCap('0'), 0);
  assert.equal(parseFoundersCap('-5'), DEFAULT_FOUNDERS_CAP);
  assert.equal(parseFoundersCap('lots'), DEFAULT_FOUNDERS_CAP);
  assert.equal(parseFoundersDeadline(undefined), DEFAULT_FOUNDERS_DEADLINE);
  assert.equal(parseFoundersDeadline('not a date'), DEFAULT_FOUNDERS_DEADLINE);
  assert.equal(parseFoundersDeadline('2027-01-31'), DEFAULT_FOUNDERS_DEADLINE);
  assert.equal(parseFoundersDeadline('2027-06-30'), '2027-07-01T05:00:00.000Z'); // summer time
  assert.equal(parseFoundersDeadline('2027-02-30'), DEFAULT_FOUNDERS_DEADLINE); // no such day
  assert.equal(parseFoundersDeadline('2027-03-01T00:00:00'), DEFAULT_FOUNDERS_DEADLINE); // no zone
  assert.equal(parseFoundersDeadline('2027-03-01T00:00:00Z'), '2027-03-01T00:00:00.000Z');
  const cfg = configFromEnv({}, { warn: () => {} });
  assert.deepEqual(cfg.founders, { cap: 500, deadline: DEFAULT_FOUNDERS_DEADLINE });
});

test('the default deadline reads as January 31, 2027', () => {
  assert.equal(formatFoundersDeadline(DEFAULT_FOUNDERS_DEADLINE), 'January 31, 2027');
});

test('approved listings get numbers 1, 2, 3 in approval order', async () => {
  const { store } = storeFor(await makeDir(3));
  for (const id of ['d2', 'd1', 'd3']) assert.equal((await store.publishDraft(id)).status, 200);
  const numbers = store.getListings().map(l => [l.name, store.getFounder(l.id)?.number]);
  assert.deepEqual(Object.fromEntries(numbers), {
    'Founder Test Plumbing 2': 1, 'Founder Test Plumbing 1': 2, 'Founder Test Plumbing 3': 3,
  });
  assert.deepEqual(store.getFoundersStatus(), { cap: 500, taken: 3, left: 497, open: true, deadline: DEADLINE });
});

test('approving the same listing twice keeps its number', async () => {
  const { store } = storeFor(await makeDir(2));
  const first = await store.publishDraft('d1');
  await store.publishDraft('d1');
  await store.publishDraft('d2');
  assert.equal(store.getFounder(first.listing.id).number, 1);
  assert.equal(store.getFoundersStatus().taken, 2);
});

test('the cap is firm: listing number cap + 1 is not a founder', async () => {
  const { store } = storeFor(await makeDir(3), { cap: 2 });
  const results = [];
  for (const id of ['d1', 'd2', 'd3']) results.push(await store.publishDraft(id));
  assert.deepEqual(results.map(r => store.getFounder(r.listing.id)?.number), [1, 2, undefined]);
  assert.equal(store.getFoundersStatus().open, false);
  assert.equal(store.getFoundersStatus().left, 0);
});

test('signed up before the deadline but approved after it: still a founder', async () => {
  const { store } = storeFor(await makeDir(1, { submittedAt: '2027-01-31T23:00:00.000Z' }), { now: '2027-02-10T12:00:00.000Z' });
  const r = await store.publishDraft('d1');
  assert.equal(store.getFounder(r.listing.id).number, 1);
});

test('signed up after the deadline: not a founder', async () => {
  const { store } = storeFor(await makeDir(1, { submittedAt: '2027-02-01T06:00:00.000Z' }), { now: '2027-02-10T12:00:00.000Z' });
  const r = await store.publishDraft('d1');
  assert.equal(r.status, 200);
  assert.equal(store.getFounder(r.listing.id), undefined);
  assert.equal(store.getFoundersStatus().open, false);
});

test('a retry after a crash keeps the reserved number and its place in line', async () => {
  const dir = await makeDir(2);
  // d1 crashed mid-approval after its number was reserved: draft left at "publishing".
  const drafts = JSON.parse(await fs.readFile(path.join(dir, 'drafts.json'), 'utf8'));
  drafts[0].status = 'publishing';
  drafts[0].reservedId = 'crashed-one';
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify(drafts));
  await fs.writeFile(path.join(dir, 'founders.json'), JSON.stringify({ 'crashed-one': { number: 1, joinedAt: BEFORE } }));
  const { store } = storeFor(dir);
  assert.equal(store.getFounder('crashed-one'), undefined, 'no badge until the listing is public');
  const second = await store.publishDraft('d2');
  const first = await store.publishDraft('d1');
  assert.equal(first.listing.id, 'crashed-one');
  assert.equal(store.getFounder('crashed-one').number, 1);
  assert.equal(store.getFounder(second.listing.id).number, 2);
});

test('an unreadable sign-up time falls back to the approval time', async () => {
  const { store } = storeFor(await makeDir(1, { submittedAt: 'yesterday' }));
  const r = await store.publishDraft('d1');
  assert.equal(store.getFounder(r.listing.id).number, 1);
});

test('sample listings are never founders', async () => {
  const dir = await makeDir(1);
  await fs.copyFile(path.join(REPO_DATA, 'listings.json'), path.join(dir, 'listings.json'));
  const clock = { now: () => new Date(BEFORE) };
  const store = createDataStore({ dataDir: dir, clock, includeSamples: true, founders: { cap: 500, deadline: DEADLINE } });
  await store.publishDraft('d1');
  const samples = store.getListings().filter(l => store.isSeed(l.id));
  assert.ok(samples.length > 0);
  for (const l of samples) assert.equal(store.getFounder(l.id), undefined);
  assert.equal(store.getFoundersStatus().taken, 1);
});

test('cap 0 turns the program off', async () => {
  const { store } = storeFor(await makeDir(1), { cap: 0 });
  const r = await store.publishDraft('d1');
  assert.equal(store.getFounder(r.listing.id), undefined);
  assert.equal(foundersInvite(store.getFoundersStatus()), '');
});

test('an unpublished founder loses the badge and the number is never reused', async () => {
  const { store } = storeFor(await makeDir(2));
  const a = await store.publishDraft('d1');
  await store.unpublish(a.listing.id);
  assert.equal(store.getFounder(a.listing.id), undefined);
  const b = await store.publishDraft('d2');
  assert.equal(store.getFounder(b.listing.id).number, 2);
  assert.equal(store.getFoundersStatus().left, 498);
});

test('founder numbers survive a restart', async () => {
  const dir = await makeDir(2);
  const one = storeFor(dir);
  const a = await one.store.publishDraft('d1');
  const two = storeFor(dir);
  assert.equal(two.store.getFounder(a.listing.id).number, 1);
  const b = await two.store.publishDraft('d2');
  assert.equal(two.store.getFounder(b.listing.id).number, 2);
});

test('property: numbers are unique, start at 1, and never pass the cap', () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 12 }), fc.integer({ min: 0, max: 20 }), (cap, signups) => {
    const map = {};
    for (let i = 0; i < signups; i += 1) {
      if (earnsFounderSpot({ cap, deadline: DEADLINE }, map, BEFORE)) {
        map[`l${i}`] = { number: nextFounderNumber(map) };
      }
    }
    const numbers = Object.values(map).map(e => e.number);
    assert.equal(numbers.length, Math.min(cap, signups));
    assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => i + 1));
    const status = foundersStatus({ cap, deadline: DEADLINE }, map, BEFORE);
    assert.equal(status.taken + status.left, cap);
  }));
});

test('badge and invite wording', () => {
  assert.equal(founderBadge(undefined), '');
  assert.equal(founderBadge({ number: 0 }), '');
  assert.match(founderBadge({ number: 12, cap: 500 }), /Founding Member<\/span> <span class="founder-badge-number">No\. 12 of 500</);
  const invite = foundersInvite({ cap: 500, taken: 3, left: 497, open: true, deadline: DEADLINE });
  assert.match(invite, /Listing is free for everyone, always\. The first 500 businesses that send in their listing by January 31, 2027 \(Central time\) and are approved become Founding Members and get a numbered badge for life\. Spots go in the order listings are approved\. <strong>497 spots left\.<\/strong>/);
  assert.match(foundersInvite({ cap: 500, left: 1, open: true, deadline: DEADLINE }), /1 spot left\./);
  assert.doesNotMatch(invite, /\$/, 'no prices while verification is off');
  assert.match(foundersInvite({ cap: 500, left: 9, open: true, deadline: DEADLINE }, { fees: { founderCents: 1900, yearlyCents: 4900 } }),
    /Verified stamp for a one-time \$19, good for life\. For everyone else it is \$49 a year\./);
  assert.equal(foundersInvite({ cap: 500, left: 0, open: false, deadline: DEADLINE }), '');
});

test('pages: badge on the card and the listing page, invite on home and sign-up, nothing added to the API or the hash', async () => {
  const dir = await makeDir(1);
  const config = { ...configFromEnv({ ADMIN_TOKEN: 't', BASE_URL: 'http://example.test' }, { warn: () => {} }), demoMode: false };
  const app = createApp({ dataDir: dir, config, clock: { now: () => new Date(BEFORE) } });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const before = await (await fetch(`${base}/`)).text();
    assert.match(before, /500 spots left\./);
    assert.ok(before.indexOf('founders-invite') < before.indexOf('no-results'), 'invite comes before the listings');
    assert.match(before, /<a href="\/rise">Claim your spot/);
    assert.doesNotMatch(before, /founder-badge/);
    const rise = await (await fetch(`${base}/rise`)).text();
    assert.match(rise, /Founding Members/);
    assert.doesNotMatch(rise, /Claim your spot/);

    const approve = await fetch(`${base}/admin/pending/d1/approve`, { method: 'POST', headers: { Authorization: 'Bearer t' } });
    assert.ok(approve.status < 400, `approve returned ${approve.status}`);

    const home = await (await fetch(`${base}/`)).text();
    assert.match(home, /No\. 1 of 500/);
    assert.match(home, /499 spots left\./);
    const filtered = await (await fetch(`${base}/?category=plumbers`)).text();
    assert.match(filtered, /No\. 1 of 500/);
    assert.doesNotMatch(filtered, /founders-invite/);

    const id = /href="\/listings\/([^"]+)"/.exec(home)[1];
    assert.match(await (await fetch(`${base}/listings/${id}`)).text(), /Founding Member<\/span> <span class="founder-badge-number">No\. 1 of 500/);
    const api = await (await fetch(`${base}/api/listings/${id}`)).text();
    assert.doesNotMatch(api, /founding|joinedAt/i);
    const page = await (await fetch(`${base}/listings/${id}`)).text();
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)[1];
    assert.doesNotMatch(ld, /founding|joinedAt/i);
    assert.doesNotMatch(await (await fetch(`${base}/llms.txt`)).text(), /founding member/i);
    // The tamper-check hash is the same with or without the founder number.
    const hash = JSON.parse(api).verificationHash;
    const check = await (await fetch(`${base}/api/verify/${id}?hash=${hash}`)).json();
    assert.equal(JSON.stringify(check).includes('true'), true);
  } finally {
    await new Promise(r => server.close(r));
  }
});
