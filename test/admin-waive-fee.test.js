/**
 * high-tech-look Requirement 6: the owner can waive the verification fee for his own listings. Only the payment is
 * skipped: the phone code and the photo ID check still have to pass. Stripe and Twilio are fakes; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { configFromEnv } from '../server/lib/config.js';
import { trustStatus } from '../server/lib/trust.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const NOW = '2026-12-01T18:00:00.000Z';
const ADMIN = { Authorization: 'Bearer t' };
const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
});

function fakes() {
  const state = { checkouts: new Map(), idChecks: new Map(), sent: [], code: '424242', n: 0 };
  return {
    state,
    payments: {
      name: 'fake', testMode: false, webhookEnabled: true,
      async createCheckout(o) { const id = `cs_${++state.n}`; state.checkouts.set(id, { ...o, paid: false }); return { id, url: `https://pay.example/${id}` }; },
      async getCheckout(id) { const c = state.checkouts.get(id); return { paid: Boolean(c?.paid), open: Boolean(c) && !c.paid && !c.expired, url: `https://pay.example/${id}`, paymentIntent: c?.paid ? `pi_${id}` : undefined, listingId: c?.listingId, plan: c?.plan }; },
      async expireCheckout(id) { const c = state.checkouts.get(id); if (!c || c.paid) return false; c.expired = true; return true; },
      async cancelIdCheck(id) { const c = state.idChecks.get(id); if (!c || c.status !== 'requires_input') return false; c.status = 'canceled'; return true; },
      async createIdCheck(o) { const id = `vs_${++state.n}`; state.idChecks.set(id, { ...o, status: 'requires_input' }); return { id, url: `https://id.example/${id}` }; },
      async getIdCheck(id) { const c = state.idChecks.get(id); return { status: c?.status ?? '', failed: c?.status === 'failed', listingId: c?.listingId }; },
      parseWebhook(raw, header) { if (header !== 'good') throw new Error('bad_signature'); const e = JSON.parse(raw.toString()); return { type: e.type, object: e.data.object }; },
    },
    phone: {
      name: 'fake',
      async send(to, channel) { state.sent.push({ to, channel }); },
      async check(to, code) { return code === state.code; },
    },
  };
}

async function site() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-waive-'));
  dirs.push(dir);
  await fs.copyFile(path.join(REPO_DATA, 'categories.json'), path.join(dir, 'categories.json'));
  await fs.writeFile(path.join(dir, 'listings.json'), '[]');
  const draft = {
    id: 'owner-link-1', status: 'pending', missingFields: [], createdAt: NOW,
    fields: { name: 'Ridge Roofing', category: 'roofers', phone: '(615) 555-0101', services: ['Roof repair'], serviceArea: 'Greater Nashville', description: 'Roof repair and replacement.', city: 'Nashville', state: 'TN' },
  };
  const cats = JSON.parse(await fs.readFile(path.join(dir, 'categories.json'), 'utf8'));
  if (!cats.some(c => c.slug === 'roofers')) draft.fields.category = cats[0].slug;
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify([draft]));
  await fs.writeFile(path.join(dir, 'pending.json'), JSON.stringify([{ id: draft.id, draftId: draft.id, submittedAt: NOW, status: 'pending' }]));
  const clock = { at: NOW, now() { return new Date(this.at); } };
  const config = { ...configFromEnv({ ADMIN_TOKEN: 't', BASE_URL: 'http://example.test' }, { warn: () => {} }), demoMode: false, founders: { cap: 500, deadline: '2027-02-01T06:00:00.000Z' } };
  const f = fakes();
  const app = createApp({ dataDir: dir, config, clock, trust: { payments: f.payments, phone: f.phone } });
  const server = app.listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: 'POST', redirect: 'manual', body,
    headers: { ...(body && typeof body === 'string' && !headers['Content-Type'] ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
  });
  const get = async (p, headers = {}) => { const r = await fetch(base + p, { headers }); return { status: r.status, text: await r.text() }; };
  assert.ok((await post('/admin/pending/owner-link-1/approve', undefined, ADMIN)).status < 400);
  const id = /href="\/listings\/([^"]+)"/.exec((await get('/')).text)[1];
  return { app, base, post, get, f, id, clock, dir, V: '/rise/drafts/owner-link-1/verify', store: app.locals.ctx.store };
}

const adminPage = s => s.get('/admin/pending', { ...ADMIN, Accept: 'text/html' });

test('not signed in, the route refuses and nothing is saved', async () => {
  const s = await site();
  const refused = await s.post(`/admin/listings/${s.id}/waive-fee`);
  assert.ok(refused.status >= 400);
  assert.equal(s.store.getTrustRecord(s.id), undefined);
  assert.equal(s.store.getTrustStatus(s.store.findById(s.id)).waived, false);
});

test('the admin page offers the button for an unverified listing, and shows "Fee waived by admin" after', async () => {
  const s = await site();
  const before = (await adminPage(s)).text;
  assert.ok(before.includes('Waive the verification fee'));
  assert.ok(before.includes(`action="/admin/listings/${encodeURIComponent(s.id)}/waive-fee"`));
  assert.equal(before.includes('Fee waived by admin'), false);
  const done = await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  assert.ok(done.status < 400);
  const after = (await adminPage(s)).text;
  assert.ok(after.includes('Fee waived by admin.'));
  assert.equal(after.includes('Waive the verification fee'), false, 'nothing left to waive');
});

test('the record says who and when, and the listing then counts as paid, but not as verified', async () => {
  const s = await site();
  const done = await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { ok: true });
  const record = s.store.getTrustRecord(s.id);
  assert.equal(record.waivedBy, 'admin');
  assert.equal(record.waivedAt, NOW);
  assert.equal(record.paidAt, undefined, 'nothing was paid');
  const status = s.store.getTrustStatus(s.store.findById(s.id));
  assert.equal(status.paid, true);
  assert.equal(status.waived, true);
  assert.equal(status.verified, false);
  assert.equal(status.phoneOk, false);
  assert.equal(status.idOk, false);
  // Saved in the file too.
  const saved = JSON.parse(await fs.readFile(path.join(s.dir, 'trust.json'), 'utf8'));
  assert.equal(saved[s.id].waivedBy, 'admin');
});

test('the payment step is skipped: no checkout is made, but the phone code and the photo ID still have to pass', async () => {
  const s = await site();
  await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  // Pressing the pay button takes no money.
  await s.post(`${s.V}/pay`);
  assert.equal(s.f.state.checkouts.size, 0, 'no payment is started');

  // The stamp is not showing yet.
  assert.doesNotMatch((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
  // Step 2: the phone code is sent and has to be right.
  await s.post(`${s.V}/phone/send`, 'channel=sms');
  assert.deepEqual(s.f.state.sent, [{ to: '+16155550101', channel: 'sms' }]);
  assert.equal((await s.post(`${s.V}/phone/check`, 'code=000000')).headers.get('location'), `${s.V}?note=wrong`);
  assert.equal((await s.post(`${s.V}/phone/check`, 'code=424242')).headers.get('location'), s.V);
  assert.doesNotMatch((await s.get(`/listings/${s.id}`)).text, /verified-badge/, 'the phone alone is not enough');
  // Step 3: the photo ID check has to pass.
  const idStart = await s.post(`${s.V}/id`);
  assert.equal(idStart.headers.get('location').startsWith('https://id.example/'), true);
  assert.doesNotMatch((await s.get(`/listings/${s.id}`)).text, /verified-badge/, 'the ID check has not passed yet');
  [...s.f.state.idChecks.values()][0].status = 'verified';
  await s.get(s.V);
  assert.match((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
  assert.equal(s.store.getTrustStatus(s.store.findById(s.id)).verified, true);
  assert.equal(s.f.state.checkouts.size, 0, 'still no payment');
});

test('S15: the owner\'s verify page says "No fee for this listing." after a waiver, never "Fee paid"', async () => {
  const s = await site();
  const before = (await s.get(s.V)).text;
  assert.equal(before.includes('There is no fee for this listing.'), false);
  await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  const page = (await s.get(s.V)).text;
  assert.ok(page.includes('There is no fee for this listing.'));
  // R27: the page does not sell a fee that is not there.
  assert.ok(page.includes('<h3>The fee</h3>'));
  assert.equal(page.includes('<h3>Pay the fee</h3>'), false);
  assert.equal(page.includes('once for Founding Members'), false, 'no price hint');
  // R26: the admin line says "fee: waived", not "fee paid: yes".
  const admin = (await adminPage(s)).text;
  assert.ok(admin.includes('fee: waived'));
  assert.equal(/fee paid: yes/.test(admin), false);
  assert.equal(/Fee paid/.test(page), false);
});

test('without the phone code, a passed photo ID does not make the stamp either', async () => {
  const s = await site();
  await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  await s.post(`${s.V}/id`);
  const idCheck = [...s.f.state.idChecks.values()][0];
  if (idCheck) idCheck.status = 'verified'; // the ID step may not even start before the phone code
  await s.get(s.V);
  assert.doesNotMatch((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
  assert.equal(s.store.getTrustStatus(s.store.findById(s.id)).verified, false);
});

test('nothing about the waiver shows to the public', async () => {
  const s = await site();
  await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  await s.post(`${s.V}/phone/send`, 'channel=sms');
  await s.post(`${s.V}/phone/check`, 'code=424242');
  await s.post(`${s.V}/id`);
  [...s.f.state.idChecks.values()][0].status = 'verified';
  await s.get(s.V);
  for (const p of ['/', `/listings/${s.id}`, '/llms.txt', '/sitemap.xml', `/api/listings/${s.id}`, '/api/listings']) {
    const text = (await s.get(p)).text;
    assert.equal(/waive|waiver|waived/i.test(text), false, p);
  }
});

test('a waived listing counts toward the Founding Member spots like a paid one', async () => {
  const s = await site();
  assert.equal(s.store.getFounder(s.id).number, 1, 'the spot is given at approval, whatever happens to the fee');
  await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  assert.equal(s.store.getFounder(s.id).number, 1);
  assert.equal(s.store.getFoundersStatus().taken, 1);
  assert.match((await adminPage(s)).text, /Founding Member No\. 1/);
});

test('there is nothing to waive for a listing that is already paid, verified or switched off, or that does not exist', async () => {
  const s = await site();
  assert.equal((await s.post('/admin/listings/no-such-listing/waive-fee', undefined, ADMIN)).status, 404);
  const first = await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  assert.equal(first.status, 200);
  const again = await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN);
  assert.equal(again.status, 409);
  // The record is not changed by the second press.
  assert.equal(s.store.getTrustRecord(s.id).waivedAt, NOW);
  // Switched off by the admin: nothing to waive either.
  await s.post(`/admin/listings/${s.id}/unverify`, undefined, ADMIN);
  assert.equal((await s.post(`/admin/listings/${s.id}/waive-fee`, undefined, ADMIN)).status, 409);
});

test('the admin page shows the fixed notes for a waived fee and for nothing to waive', async () => {
  const s = await site();
  const waived = await s.get('/admin/pending?note=waived', { ...ADMIN, Accept: 'text/html' });
  assert.ok(waived.text.includes('The verification fee is waived for that listing. The phone code and photo ID steps still apply.'));
  const none = await s.get('/admin/pending?note=notwaivable', { ...ADMIN, Accept: 'text/html' });
  assert.ok(none.text.includes('That listing is already paid for, verified or switched off, so there is no fee to waive.'));
});

test('trustStatus: a waived record counts as paid, with no payment, and still needs the phone and the ID', () => {
  const listing = { id: 'x', name: 'Ridge Roofing', phone: '(615) 555-0101' };
  const waived = { waivedAt: NOW, waivedBy: 'admin' };
  const bare = trustStatus(waived, listing, NOW);
  assert.equal(bare.paid, true);
  assert.equal(bare.verified, false);
  const full = trustStatus({
    ...waived,
    phone: { number: '+16155550101', at: '2026-12-01T18:05:00.000Z' },
    identity: { ref: 'vs_1', at: '2026-12-01T18:10:00.000Z', name: 'Ridge Roofing' },
  }, listing, NOW);
  assert.equal(full.verified, true);
  assert.equal(full.expired, false);
  // A record that only says "waived" without the admin as the one who did it is not trusted.
  assert.equal(trustStatus({ waivedAt: NOW }, listing, NOW).paid, false);
  assert.equal(trustStatus({ waivedAt: NOW, waivedBy: 'someone' }, listing, NOW).paid, false);
  // An ordinary record is unchanged.
  assert.equal(trustStatus({}, listing, NOW).paid, false);
  assert.equal(trustStatus({}, listing, NOW).waived, false);
});
