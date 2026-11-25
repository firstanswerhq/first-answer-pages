/**
 * high-tech-look Requirement 9: receipts in the AI lookup (server/lib/mcp.js). For each field returned (phone, hours,
 * services, area, website): the date it was last confirmed and by whom, or null when unknown, never an invented date.
 * Every lookup answer has fetchedAt. "Verified" only ever appears with who checked and when. The tool descriptions
 * say up front that the lookup is free.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDataStore } from '../server/data.js';
import {
  handleRpc, TOOLS, FREE_NOTE, RECEIPT_FIELDS, CONFIRMED_BY_BUSINESS, CONFIRMED_BY_CHECK, receiptsFor,
} from '../server/lib/mcp.js';

const NOW = Date.UTC(2026, 10, 26, 18, 0, 0);
const dirs = [];
after(async () => {
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

const base = (id, name, extra = {}) => ({
  id, name, category: 'plumbers', phone: '(615) 555-0142', hours: { monday: '8:00 AM - 5:00 PM' },
  services: ['Drain cleaning'], serviceArea: 'Nashville area', description: 'We fix pipes.', city: 'Nashville',
  state: 'TN', website: 'https://zephyr.example/', ...extra,
});

const LISTINGS = [
  base('rec-confirmed', 'Confirmed Plumbing'),
  base('rec-plain', 'Plain Plumbing'),
  // Confirmed with the older plain-date record; no website and no hours.
  { ...base('rec-sparse', 'Sparse Plumbing', { hours: {} }), website: undefined },
  base('rec-verified', 'Verified Plumbing'),
  base('rec-practice', 'Practice Plumbing'),
].map(l => JSON.parse(JSON.stringify(l)));

const VERIFIED = {
  'rec-confirmed': { verifiedDate: '2026-11-01', verifiedAt: '2026-11-01T15:30:00.000Z' },
  'rec-sparse': '2026-10-05',
  'rec-verified': '2026-09-01',
};

const TRUST = {
  'rec-verified': {
    waivedAt: '2026-11-09T00:00:00.000Z', waivedBy: 'admin',
    phone: { number: '+16155550142', at: '2026-11-10T10:00:00.000Z' },
    identity: { ref: 'vs_1', at: '2026-11-12T09:00:00.000Z', name: 'Verified Plumbing' },
  },
  // A practice run with a test key: never a stamp.
  'rec-practice': {
    waivedAt: '2026-11-09T00:00:00.000Z', waivedBy: 'admin', test: true,
    phone: { number: '+16155550142', at: '2026-11-10T10:00:00.000Z' },
    identity: { ref: 'vs_2', at: '2026-11-12T09:00:00.000Z', name: 'Practice Plumbing' },
  },
};

async function makeCtx() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-receipts-'));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'listings.json'), '[]');
  await fs.writeFile(path.join(dir, 'categories.json'), JSON.stringify([{ slug: 'plumbers', name: 'Plumbers' }]));
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(LISTINGS));
  await fs.writeFile(path.join(dir, 'verified.json'), JSON.stringify(VERIFIED));
  await fs.writeFile(path.join(dir, 'trust.json'), JSON.stringify(TRUST));
  const clock = { now: () => NOW };
  const store = createDataStore({ dataDir: dir, clock });
  return { store, clock, config: { baseUrl: 'http://example.test' } };
}

const ctx = await makeCtx();

async function call(name, args) {
  const r = await handleRpc(ctx, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, '127.0.0.1');
  assert.equal(r.status, 200);
  assert.equal(r.body.error, undefined, JSON.stringify(r.body.error));
  assert.notEqual(r.body.result.isError, true);
  return r.body.result.structuredContent;
}

/** Every object anywhere in a value that says "verified" true must say who and when. */
function assertNoBareVerified(value, where = 'answer') {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoBareVerified(v, `${where}[${i}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (value.verified === true) {
    assert.ok(value.verifiedDate || value.checkedAt, `${where}: verified without when`);
    assert.ok(value.confirmedBy || value.checkedBy, `${where}: verified without who`);
  }
  if (Object.hasOwn(value, 'verifiedCheck') && value.verifiedCheck !== null) {
    assert.equal(typeof value.verifiedCheck.checkedBy, 'string', `${where}: Verified without who`);
    assert.equal(typeof value.verifiedCheck.checkedAt, 'string', `${where}: Verified without when`);
  }
  for (const [k, v] of Object.entries(value)) assertNoBareVerified(v, `${where}.${k}`);
}

test('9.1: a business-confirmed listing has the stored date and "business" on every field it returns', async () => {
  const out = await call('get_listing', { id: 'rec-confirmed' });
  assert.deepEqual(Object.keys(out.receipts), RECEIPT_FIELDS);
  for (const field of RECEIPT_FIELDS) {
    assert.deepEqual(out.receipts[field], { lastConfirmed: '2026-11-01T15:30:00.000Z', confirmedBy: CONFIRMED_BY_BUSINESS }, field);
  }
  // 9.3: the owner's wording and date are kept.
  assert.equal(out.verification.verified, true);
  assert.equal(out.verification.verifiedDate, '2026-11-01');
  assert.equal(out.verification.confirmedBy, 'business');
  assert.equal(out.verification.label, 'Details confirmed by the business');
  assert.equal(out.verifiedCheck, null, 'no Verified stamp');
});

test('9.1: unknown means null, never a made-up date', async () => {
  const plain = await call('get_listing', { id: 'rec-plain' });
  for (const field of RECEIPT_FIELDS) assert.deepEqual(plain.receipts[field], { lastConfirmed: null, confirmedBy: null }, field);
  assert.deepEqual(plain.verification, { verified: false, verifiedDate: null, hash: null });
  assert.equal(plain.verifiedCheck, null);
  // A field the listing doesn't have is null even when the business confirmed its details; the plain-date record is used as stored.
  const sparse = await call('get_listing', { id: 'rec-sparse' });
  assert.deepEqual(sparse.receipts.website, { lastConfirmed: null, confirmedBy: null });
  assert.deepEqual(sparse.receipts.hours, { lastConfirmed: null, confirmedBy: null });
  assert.deepEqual(sparse.receipts.phone, { lastConfirmed: '2026-10-05', confirmedBy: 'business' });
  assert.deepEqual(sparse.receipts.area, { lastConfirmed: '2026-10-05', confirmedBy: 'business' });
  // No date in any receipt is the time of the lookup itself.
  for (const out of [plain, sparse]) {
    for (const r of Object.values(out.receipts)) assert.notEqual(r.lastConfirmed, new Date(NOW).toISOString());
  }
});

test('9.1, 9.3: the Verified check confirms the phone, with who checked and when; other fields keep the business date', async () => {
  const out = await call('get_listing', { id: 'rec-verified' });
  assert.deepEqual(out.verifiedCheck, { checkedBy: 'First Answer phone and ID check', checkedAt: '2026-11-12T09:00:00.000Z' });
  assert.deepEqual(out.receipts.phone, { lastConfirmed: '2026-11-12T09:00:00.000Z', confirmedBy: CONFIRMED_BY_CHECK });
  assert.deepEqual(out.receipts.hours, { lastConfirmed: '2026-09-01', confirmedBy: 'business' });
  // A practice run is never a stamp, and its phone has no receipt from the check.
  const practice = await call('get_listing', { id: 'rec-practice' });
  assert.equal(practice.verifiedCheck, null);
  assert.deepEqual(practice.receipts.phone, { lastConfirmed: null, confirmedBy: null });
  for (const id of ['rec-confirmed', 'rec-plain', 'rec-sparse', 'rec-verified', 'rec-practice']) {
    assertNoBareVerified(await call('get_listing', { id }), id);
  }
});

test('9.1, 9.2: search answers carry the same receipts and fetchedAt; get_listing has fetchedAt too', async () => {
  const found = await call('search_listings', { query: 'plumbing' });
  assert.equal(found.fetchedAt, new Date(NOW).toISOString());
  assert.equal(found.count, LISTINGS.length);
  for (const l of found.listings) {
    assert.deepEqual(l.receipts, receiptsFor(ctx.store, ctx.store.findById(l.id), found.fetchedAt), l.id);
  }
  assert.deepEqual(found.listings.find(l => l.id === 'rec-confirmed').receipts.website,
    { lastConfirmed: '2026-11-01T15:30:00.000Z', confirmedBy: 'business' });
  assertNoBareVerified(found);
  const empty = await call('search_listings', { city: 'Nowhere' });
  assert.equal(empty.fetchedAt, new Date(NOW).toISOString(), 'an empty answer has it too');
  const one = await call('get_listing', { id: 'rec-plain' });
  assert.equal(one.fetchedAt, new Date(NOW).toISOString());
  assert.ok(Number.isFinite(Date.parse(one.fetchedAt)));
});

test('9: the lookup tools say up front that they are free; the wording is plain', () => {
  assert.equal(FREE_NOTE, 'Free: there is no charge for this lookup.');
  for (const name of ['search_listings', 'get_listing']) {
    const tool = TOOLS.find(t => t.name === name);
    assert.ok(tool.description.startsWith(FREE_NOTE), name);
    assert.match(tool.description, /last confirmed and by whom/);
    assert.match(tool.description, /fetchedAt/);
    assert.equal(/guarantee|\$\d|colour|centre|will (?:name|recommend)/i.test(tool.description), false, name);
  }
});
