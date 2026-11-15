/**
 * The paid Verified stamp: fee, phone code, photo ID check.
 * Stripe and Twilio are replaced by fakes; no network is used.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { configFromEnv } from '../server/lib/config.js';
import {
  trustStatus, toE164, planFor, paidThroughAfter, parseFeeCents, formatFee, MAX_ID_ATTEMPTS,
} from '../server/lib/trust.js';
import { createStripePayments, createTwilioPhone, createTrustProviders } from '../server/lib/trust-providers.js';
import { verifiedBadge } from '../server/lib/html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const NOW = '2026-12-01T18:00:00.000Z';
const dirs = [];
const servers = [];
after(async () => {
  for (const s of servers) await new Promise(r => s.close(r));
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
});

const LISTING = { id: 'x', name: 'Ridge Roofing', phone: '(615) 555-0101' };
const full = () => ({
  plan: 'founder', paidAt: NOW, paidThrough: null,
  phone: { number: '+16155550101', at: '2026-12-01T18:05:00.000Z' },
  identity: { ref: 'vs_1', at: '2026-12-01T18:10:00.000Z', name: 'Ridge Roofing' },
});

// ---- pure rules ---------------------------------------------------------

test('phone numbers: only 10-digit US numbers are accepted', () => {
  assert.equal(toE164('(615) 555-0101'), '+16155550101');
  assert.equal(toE164('1-615-555-0101'), '+16155550101');
  assert.equal(toE164('+1 615 555 0101'), '+16155550101');
  assert.equal(toE164('555-0101'), null);
  assert.equal(toE164('(015) 555-0101'), null);
  assert.equal(toE164(''), null);
});

test('fees: founders pay once, everyone else per year', () => {
  const fees = { founderCents: 1900, yearlyCents: 4900 };
  assert.deepEqual(planFor({ number: 3 }, fees), { plan: 'founder', amountCents: 1900 });
  assert.deepEqual(planFor(undefined, fees), { plan: 'yearly', amountCents: 4900 });
  assert.equal(formatFee(1900), '$19');
  assert.equal(formatFee(1950), '$19.50');
  assert.equal(parseFeeCents('2500', 1900), 2500);
  assert.equal(parseFeeCents('free', 1900), 1900);
  assert.equal(parseFeeCents('5', 1900), 1900);
  assert.equal(paidThroughAfter('founder', {}, Date.parse(NOW)), null);
  assert.equal(paidThroughAfter('yearly', {}, Date.parse(NOW)), '2027-12-01T18:00:00.000Z');
  // Renewing early adds a year to the end date, not to today.
  assert.equal(paidThroughAfter('yearly', { paidThrough: '2027-06-01T00:00:00.000Z' }, Date.parse(NOW)), '2028-05-31T00:00:00.000Z');
});

test('the stamp needs all three: fee, phone, photo ID', () => {
  assert.equal(trustStatus(full(), LISTING, NOW).verified, true);
  assert.equal(trustStatus(full(), LISTING, NOW).verifiedAt, '2026-12-01T18:10:00.000Z');
  for (const drop of ['paidAt', 'phone', 'identity']) {
    const r = full(); delete r[drop];
    assert.equal(trustStatus(r, LISTING, NOW).verified, false, `without ${drop}`);
  }
  assert.equal(trustStatus(undefined, LISTING, NOW).verified, false);
});

test('the stamp comes off when the phone or the name changes, or an admin removes it', () => {
  assert.equal(trustStatus(full(), { ...LISTING, phone: '(615) 555-0199' }, NOW).verified, false);
  assert.equal(trustStatus(full(), { ...LISTING, phone: '(615) 555-0199' }, NOW).idOk, true);
  assert.equal(trustStatus(full(), { ...LISTING, name: 'Ridge Roofing and Siding' }, NOW).verified, false);
  assert.equal(trustStatus({ ...full(), removedAt: NOW }, LISTING, NOW).verified, false);
});

test('a yearly plan lapses after its end date; a founder plan never does', () => {
  const yearly = { ...full(), plan: 'yearly', paidThrough: '2027-12-01T18:00:00.000Z' };
  assert.equal(trustStatus(yearly, LISTING, '2027-11-30T00:00:00.000Z').verified, true);
  assert.equal(trustStatus(yearly, LISTING, '2027-12-01T18:00:00.000Z').verified, false);
  assert.equal(trustStatus(full(), LISTING, '2046-01-01T00:00:00.000Z').verified, true);
});

test('badge wording', () => {
  assert.equal(verifiedBadge({ verified: false }), '');
  assert.equal(verifiedBadge(undefined), '');
  assert.match(verifiedBadge({ verified: true }), />Verified</);
  assert.match(verifiedBadge({ verified: true, verifiedAt: '2026-12-01T18:10:00.000Z' }, { detail: true }),
    /Business phone confirmed and owner&#39;s photo ID checked, Dec 1, 2026|Business phone confirmed and owner's photo ID checked, Dec 1, 2026/);
});

// ---- provider clients -----------------------------------------------------

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), init });
    const { status = 200, json } = handler(String(url), init);
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  f.calls = calls;
  return f;
}

test('Stripe: the payment page is asked for with the right amount and listing', async () => {
  const f = fakeFetch(() => ({ json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' } }));
  const stripe = createStripePayments({ secretKey: 'sk_test_abc', fetch: f });
  assert.equal(stripe.testMode, true);
  const s = await stripe.createCheckout({ listingId: 'ridge', plan: 'founder', amountCents: 1900, description: 'Verification', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
  assert.deepEqual(s, { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(init.headers.Authorization, 'Bearer sk_test_abc');
  const body = new URLSearchParams(init.body);
  assert.equal(body.get('mode'), 'payment');
  assert.equal(body.get('line_items[0][price_data][unit_amount]'), '1900');
  assert.equal(body.get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(body.get('metadata[listing_id]'), 'ridge');
  assert.equal(body.get('metadata[plan]'), 'founder');
});

test('Stripe: the ID check asks for a matching selfie', async () => {
  const f = fakeFetch(() => ({ json: { id: 'vs_1', url: 'https://verify.stripe.com/start/vs_1' } }));
  const stripe = createStripePayments({ secretKey: 'sk_live_abc', fetch: f });
  assert.equal(stripe.testMode, false);
  await stripe.createIdCheck({ listingId: 'ridge', returnUrl: 'https://x/back' });
  const body = new URLSearchParams(f.calls[0].init.body);
  assert.equal(f.calls[0].url, 'https://api.stripe.com/v1/identity/verification_sessions');
  assert.equal(body.get('type'), 'document');
  assert.equal(body.get('options[document][require_matching_selfie]'), 'true');
});

test('Stripe: a refused call is an error that carries no key or response text', async () => {
  const f = fakeFetch(() => ({ status: 401, json: { error: { message: 'Invalid API Key provided: sk_test_abc' } } }));
  const stripe = createStripePayments({ secretKey: 'sk_test_abc', fetch: f });
  await assert.rejects(() => stripe.getCheckout('cs_1'), err => {
    assert.equal(err.code, 'rejected');
    assert.doesNotMatch(`${err.message} ${JSON.stringify(err)}`, /sk_test|Invalid API/);
    return true;
  });
});

function sign(secret, body, t) {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

test('Stripe webhook: only a correctly signed, fresh message is accepted', () => {
  const clock = { now: () => new Date(NOW) };
  const stripe = createStripePayments({ secretKey: 'sk_test_abc', webhookSecret: 'whsec_x', clock });
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
  const t = Math.floor(Date.parse(NOW) / 1000);
  assert.equal(stripe.parseWebhook(Buffer.from(body), sign('whsec_x', body, t)).type, 'checkout.session.completed');
  assert.throws(() => stripe.parseWebhook(Buffer.from(body), sign('whsec_wrong', body, t)), /bad_signature/);
  assert.throws(() => stripe.parseWebhook(Buffer.from(body.replace('cs_1', 'cs_2')), sign('whsec_x', body, t)), /bad_signature/);
  assert.throws(() => stripe.parseWebhook(Buffer.from(body), sign('whsec_x', body, t - 301)), /bad_signature/);
  assert.throws(() => stripe.parseWebhook(Buffer.from(body), ''), /bad_signature/);
  assert.throws(() => stripe.parseWebhook(Buffer.from(body), `t=${t},v1=zz`), /bad_signature/);
  const off = createStripePayments({ secretKey: 'sk_test_abc' });
  assert.throws(() => off.parseWebhook(Buffer.from(body), sign('', body, t)), /webhook_off/);
});

test('Twilio: sends by text or call, and a wrong or expired code is just "no"', async () => {
  const f = fakeFetch(url => {
    if (url.endsWith('/Verifications')) return { json: { status: 'pending' } };
    return { status: 404, json: { code: 20404 } };
  });
  const tw = createTwilioPhone({ accountSid: 'AC1', authToken: 'tok', serviceSid: 'VA1', fetch: f });
  await tw.send('+16155550101', 'call');
  assert.equal(f.calls[0].url, 'https://verify.twilio.com/v2/Services/VA1/Verifications');
  assert.equal(new URLSearchParams(f.calls[0].init.body).get('Channel'), 'call');
  assert.equal(f.calls[0].init.headers.Authorization, `Basic ${Buffer.from('AC1:tok').toString('base64')}`);
  assert.equal(await tw.check('+16155550101', '123456'), false);
  const ok = createTwilioPhone({ accountSid: 'AC1', authToken: 'tok', serviceSid: 'VA1', fetch: fakeFetch(() => ({ json: { status: 'approved' } })) });
  assert.equal(await ok.check('+16155550101', '123456'), true);
});

test('verification is off unless every key is set', () => {
  const cfg = env => configFromEnv(env, { warn: () => {} });
  assert.equal(createTrustProviders(cfg({})), undefined);
  assert.equal(createTrustProviders(cfg({ STRIPE_SECRET_KEY: 'sk_test_a' })), undefined);
  const on = createTrustProviders(cfg({ STRIPE_SECRET_KEY: 'sk_test_a', TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SERVICE_SID: 'VA' }));
  assert.equal(on.payments.name, 'stripe');
  assert.equal(on.phone.name, 'twilio');
});

// ---- the whole flow through the site ---------------------------------------

function fakes() {
  const state = { checkouts: new Map(), idChecks: new Map(), sent: [], code: '424242', n: 0 };
  return {
    state,
    payments: {
      name: 'fake', testMode: true, webhookEnabled: true,
      async createCheckout(o) { const id = `cs_${++state.n}`; state.checkouts.set(id, { ...o, paid: false }); return { id, url: `https://pay.example/${id}` }; },
      async getCheckout(id) { const c = state.checkouts.get(id); return { paid: Boolean(c?.paid), listingId: c?.listingId, plan: c?.plan }; },
      async createIdCheck(o) { const id = `vs_${++state.n}`; state.idChecks.set(id, { ...o, status: 'requires_input' }); return { id, url: `https://id.example/${id}` }; },
      async getIdCheck(id) { const c = state.idChecks.get(id); return { status: c?.status ?? '', listingId: c?.listingId }; },
      parseWebhook(raw, header) { if (header !== 'good') throw new Error('bad_signature'); const e = JSON.parse(raw.toString()); return { type: e.type, object: e.data.object }; },
    },
    phone: {
      name: 'fake',
      async send(to, channel) { state.sent.push({ to, channel }); },
      async check(to, code) { return code === state.code; },
    },
  };
}

async function site({ founders = { cap: 500, deadline: '2027-02-01T06:00:00.000Z' }, withTrust = true } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-trust-'));
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
  const config = { ...configFromEnv({ ADMIN_TOKEN: 't', BASE_URL: 'http://example.test' }, { warn: () => {} }), demoMode: false, founders };
  const f = fakes();
  const app = createApp({ dataDir: dir, config, clock, ...(withTrust ? { trust: { payments: f.payments, phone: f.phone } } : {}) });
  const server = app.listen(0);
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, {
    method: 'POST', redirect: 'manual', body,
    headers: { ...(body && typeof body === 'string' && !headers['Content-Type'] ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...headers },
  });
  const get = async p => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
  const approve = await post('/admin/pending/owner-link-1/approve', undefined, { Authorization: 'Bearer t' });
  assert.ok(approve.status < 400);
  const home = await get('/');
  const id = /href="\/listings\/([^"]+)"/.exec(home.text)[1];
  return { base, post, get, f, id, clock, dir, V: '/rise/drafts/owner-link-1/verify' };
}

test('off: with no keys every verification address is a 404 and nothing mentions it', async () => {
  const s = await site({ withTrust: false });
  assert.equal((await s.get(s.V)).status, 404);
  assert.equal((await s.post(`${s.V}/pay`)).status, 404);
  assert.equal((await s.post('/webhooks/stripe', '{}')).status, 404);
  assert.doesNotMatch((await s.get('/rise/drafts/owner-link-1')).text, /Verified stamp/);
  assert.doesNotMatch((await s.get('/')).text, /\$19|\$49/);
});

test('a founder goes through all three steps and gets the stamp for a one-time $19', async () => {
  const s = await site();
  assert.match((await s.get('/rise/drafts/owner-link-1')).text, /href="\/rise\/drafts\/owner-link-1\/verify">Get the Verified stamp/);
  assert.match((await s.get('/')).text, /one-time \$19, good for life\. For everyone else it is \$49 a year\./);

  let page = (await s.get(s.V)).text;
  assert.match(page, /As a Founding Member you pay \$19 once and stay verified for life\./);
  assert.match(page, /Test mode/);
  assert.equal((page.match(/Opens after the fee is paid/g) ?? []).length, 2);

  // Steps 2 and 3 do nothing before the fee is paid.
  await s.post(`${s.V}/phone/send`, 'channel=sms');
  await s.post(`${s.V}/id`);
  assert.equal(s.f.state.sent.length, 0);
  assert.equal(s.f.state.idChecks.size, 0);

  const pay = await s.post(`${s.V}/pay`);
  assert.equal(pay.status, 303);
  assert.equal(pay.headers.get('location'), 'https://pay.example/cs_1');
  const checkout = s.f.state.checkouts.get('cs_1');
  assert.equal(checkout.amountCents, 1900);
  assert.equal(checkout.plan, 'founder');
  assert.equal(checkout.listingId, s.id);
  assert.equal(checkout.successUrl, 'http://example.test/rise/drafts/owner-link-1/verify');

  // Coming back without paying changes nothing.
  assert.match((await s.get(s.V)).text, /Pay \$19/);
  checkout.paid = true;
  page = (await s.get(s.V)).text;
  assert.match(page, /Fee paid\./);
  assert.match(page, /ending in 0101/);

  const sent = await s.post(`${s.V}/phone/send`, 'channel=call');
  assert.equal(sent.headers.get('location'), `${s.V}?note=called`);
  assert.deepEqual(s.f.state.sent, [{ to: '+16155550101', channel: 'call' }]);
  assert.equal((await s.post(`${s.V}/phone/check`, 'code=000000')).headers.get('location'), `${s.V}?note=wrong`);
  assert.equal((await s.post(`${s.V}/phone/check`, 'code=abc')).headers.get('location'), `${s.V}?note=wrong`);
  assert.equal((await s.post(`${s.V}/phone/check`, 'code=424242')).headers.get('location'), s.V);
  assert.match((await s.get(s.V)).text, /The phone number on your listing is confirmed\./);

  const idStart = await s.post(`${s.V}/id`);
  assert.equal(idStart.headers.get('location'), 'https://id.example/vs_2');
  assert.doesNotMatch((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
  s.f.state.idChecks.get('vs_2').status = 'verified';
  assert.match((await s.get(s.V)).text, /Ridge Roofing is Verified\./);

  assert.match((await s.get(`/listings/${s.id}`)).text, /verified-badge-title">Verified<\/span> <span class="verified-badge-note">Business phone confirmed/);
  assert.match((await s.get('/')).text, /verified-badge/);
  assert.match((await s.get('/llms.txt')).text, /Verified: yes \(business phone confirmed and owner's photo ID checked\)/);
  // Nothing private is stored, and the listing JSON and hash are untouched.
  const stored = await fs.readFile(path.join(s.dir, 'trust.json'), 'utf8');
  assert.doesNotMatch(stored, /424242|selfie|license/i);
  assert.doesNotMatch((await s.get(`/api/listings/${s.id}`)).text, /trust|paidAt|identity/i);
  // Years later a founder is still verified.
  s.clock.at = '2036-01-01T00:00:00.000Z';
  assert.match((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
});

test('a later business pays $49 for one year, and the stamp lapses until it renews', async () => {
  const s = await site({ founders: { cap: 0, deadline: '2027-02-01T06:00:00.000Z' } });
  assert.match((await s.get(s.V)).text, /Verification is \$49 per year\./);
  await s.post(`${s.V}/pay`);
  const c = s.f.state.checkouts.get('cs_1');
  assert.equal(c.amountCents, 4900);
  assert.equal(c.plan, 'yearly');
  c.paid = true;
  assert.match((await s.get(s.V)).text, /Paid through December 1, 2027\./);
  await s.post(`${s.V}/phone/check`, 'code=424242');
  await s.post(`${s.V}/id`);
  s.f.state.idChecks.get('vs_2').status = 'verified';
  await s.get(s.V);
  assert.match((await s.get(`/listings/${s.id}`)).text, /verified-badge/);

  s.clock.at = '2027-12-02T00:00:00.000Z';
  assert.doesNotMatch((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
  const page = (await s.get(s.V)).text;
  assert.match(page, /Pay \$49/);
  assert.match(page, /Photo ID and selfie matched\./, 'no second ID check to renew');
  await s.post(`${s.V}/pay`);
  s.f.state.checkouts.get('cs_3').paid = true;
  await s.get(s.V);
  assert.match((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
});

test('webhook: a signed Stripe message marks payment and ID even if the owner never comes back', async () => {
  const s = await site();
  const send = (type, object, sig = 'good') => s.post('/webhooks/stripe', JSON.stringify({ type, data: { object } }), { 'Stripe-Signature': sig, 'Content-Type': 'application/json' });
  const paid = { id: 'cs_hook', payment_status: 'paid', metadata: { listing_id: s.id, plan: 'founder' } };
  assert.equal((await send('checkout.session.completed', paid, 'forged')).status, 400);
  assert.match((await s.get(s.V)).text, /Pay \$19/);
  assert.equal((await send('checkout.session.completed', { ...paid, payment_status: 'unpaid' })).status, 200);
  assert.match((await s.get(s.V)).text, /Pay \$19/);
  assert.equal((await send('checkout.session.completed', paid)).status, 200);
  assert.equal((await send('checkout.session.completed', paid)).status, 200); // sent twice: counted once
  assert.match((await s.get(s.V)).text, /Fee paid\./);
  assert.equal((await send('identity.verification_session.verified', { id: 'vs_hook', metadata: { listing_id: 'no-such-listing' } })).status, 200);
  assert.equal((await send('identity.verification_session.verified', { id: 'vs_hook', metadata: { listing_id: s.id } })).status, 200);
  assert.match((await s.get(s.V)).text, /Photo ID and selfie matched\./);
  const record = JSON.parse(await fs.readFile(path.join(s.dir, 'trust.json'), 'utf8'))[s.id];
  assert.deepEqual(record.payments, ['cs_hook']);
});

test('limits: three codes an hour and three photo ID tries per payment', async () => {
  const s = await site();
  await s.post(`${s.V}/pay`);
  s.f.state.checkouts.get('cs_1').paid = true;
  await s.get(s.V);
  for (let i = 0; i < 3; i += 1) assert.equal((await s.post(`${s.V}/phone/send`, 'channel=sms')).headers.get('location'), `${s.V}?note=sent`);
  assert.equal((await s.post(`${s.V}/phone/send`, 'channel=sms')).headers.get('location'), `${s.V}?note=slow`);
  assert.equal(s.f.state.sent.length, 3);
  for (let i = 0; i < MAX_ID_ATTEMPTS; i += 1) assert.equal((await s.post(`${s.V}/id`)).status, 303);
  const fourth = await s.post(`${s.V}/id`);
  assert.equal(fourth.headers.get('location'), s.V);
  assert.equal(s.f.state.idChecks.size, MAX_ID_ATTEMPTS);
  assert.match((await s.get(s.V)).text, /did not pass after three tries/);
});

test('a wrong private link gets nothing', async () => {
  const s = await site();
  assert.equal((await s.get('/rise/drafts/not-a-real-link/verify')).status, 404);
  assert.equal((await s.post('/rise/drafts/not-a-real-link/verify/pay')).status, 404);
  assert.equal(s.f.state.checkouts.size, 0);
});

test('admin can see the state and take the stamp off', async () => {
  const s = await site();
  await s.post(`${s.V}/pay`);
  s.f.state.checkouts.get('cs_1').paid = true;
  await s.get(s.V);
  await s.post(`${s.V}/phone/check`, 'code=424242');
  await s.post(`${s.V}/id`);
  s.f.state.idChecks.get('vs_2').status = 'verified';
  await s.get(s.V);
  const admin = await fetch(`${s.base}/admin/pending`, { headers: { Authorization: 'Bearer t', Accept: 'text/html' } });
  const html = await admin.text();
  assert.match(html, /Verified stamp: showing/);
  assert.match(html, /Founding Member No\. 1/);
  assert.equal((await s.post(`/admin/listings/${s.id}/unverify`)).status >= 400, true, 'needs the admin token');
  const off = await s.post(`/admin/listings/${s.id}/unverify`, undefined, { Authorization: 'Bearer t' });
  assert.ok(off.status < 400);
  assert.doesNotMatch((await s.get(`/listings/${s.id}`)).text, /verified-badge/);
  assert.match((await s.get(s.V)).text, /has been turned off/);
});
