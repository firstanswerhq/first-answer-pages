/**
 * The no-storefront box, the service-area Check and the preview line (Feature A, task F4; Requirement 18).
 * Fake assistant, fake fetcher and fake clock; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { normalizeGradeInput } from '../server/lib/grader.js';
import { CHECKS, checkById, runWebsiteChecks, serviceAreaFix } from '../server/lib/grade-checks.js';
import { readPageFacts } from '../server/lib/page-facts.js';
import { gradeFormPage, reportPage, failedPage } from '../server/lib/grade-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 20, 18, 0, 0);
const FORM = { nickname: '', name: 'Capital City Window', city: 'Nashville', state: 'TN', service: 'window cleaning', website: '' };
const HINT = 'Check this box if you go to your customers and don&#39;t show a street address.';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// ---- the form ------------------------------------------------------------------------------------

test('F4: the form has the box, unticked by default, with its label and hint', () => {
  const html = gradeFormPage({ stamp: 'stamp' });
  assert.ok(html.includes('<input type="checkbox" id="g-nostorefront" name="noStorefront" value="1">'));
  assert.ok(html.includes('We go to our customers (no storefront)'));
  assert.ok(html.includes(HINT));
  assert.equal(/name="noStorefront" value="1" checked/.test(html), false);
  // It sits after the website field, inside the form.
  assert.ok(html.indexOf('name="website"') < html.indexOf('name="noStorefront"'));
  assert.ok(html.indexOf('name="noStorefront"') < html.indexOf('</form>'));
});

test('F4: the box stays ticked when the form is shown again', () => {
  const ticked = normalizeGradeInput({ ...FORM, city: '', noStorefront: '1' });
  assert.equal(ticked.ok, false);
  const html = gradeFormPage({ values: ticked.values, errors: ticked.errors, stamp: 'stamp' });
  assert.ok(html.includes('name="noStorefront" value="1" checked'));
  const plain = normalizeGradeInput({ ...FORM, city: '' });
  assert.equal(gradeFormPage({ values: plain.values, errors: plain.errors }).includes(' checked'), false);
});

// ---- the stored input --------------------------------------------------------------------------------

test('F4: the input holds noStorefront: true only when the box is ticked', () => {
  for (const value of ['1', 'on', true]) {
    const r = normalizeGradeInput({ ...FORM, noStorefront: value });
    assert.equal(r.ok, true);
    assert.equal(r.input.noStorefront, true, String(value));
    assert.equal(r.values.noStorefront, true);
  }
  for (const value of [undefined, '', '0', 'yes', 'true', 'off', ['1', '1'], 1, {}]) {
    const r = normalizeGradeInput({ ...FORM, noStorefront: value });
    assert.equal(Object.hasOwn(r.input, 'noStorefront'), false, JSON.stringify(value));
    assert.equal(Object.hasOwn(r.values, 'noStorefront'), false, JSON.stringify(value));
  }
  // An unticked Grade's input is exactly what it was before.
  assert.deepEqual(Object.keys(normalizeGradeInput(FORM).input), ['name', 'city', 'state', 'service', 'website']);
});

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-no-storefront-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { throw new Error('no network in tests'); } },
    newGradeId: () => `nostore${String(++n).padStart(15, '0')}`,
    config: { baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'ns-token', gradeAiCallsPerDay: 150 },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

async function post(env, fields) {
  const page = await (await fetch(`${env.base}/grade`)).text();
  const t = /name="t" value="([^"]+)"/.exec(page)[1];
  env.clock.t += 5000;
  return fetch(`${env.base}/grade`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ ...fields, t }) });
}

test('F4: a check started with the box ticked stores it; one without stores nothing; the reuse key is the same', async () => {
  const env = await startEnv();
  const ticked = await post(env, { ...FORM, noStorefront: '1' });
  assert.equal(ticked.status, 303);
  const tickedId = /\/grade\/([A-Za-z0-9_-]{22})/.exec(ticked.headers.get('location'))[1];
  const plain = await post(env, { ...FORM, name: 'Capital City Window' });
  assert.equal(plain.status, 303);
  const plainId = /\/grade\/([A-Za-z0-9_-]{22})/.exec(plain.headers.get('location'))[1];
  await sleep(50);
  const a = await env.ctx.grader.get(tickedId);
  const b = await env.ctx.grader.get(plainId);
  assert.equal(a.input.noStorefront, true);
  assert.equal(Object.hasOwn(b.input, 'noStorefront'), false);
  assert.equal(a.key, b.key, 'the AI answers do not depend on the box');

  // A 422 shows the box ticked again.
  const again = await post(env, { ...FORM, city: '', noStorefront: '1' });
  assert.equal(again.status, 422);
  assert.ok((await again.text()).includes('name="noStorefront" value="1" checked'));
});

test('F4: "Start again" on the failed page carries the box', () => {
  const base = { id: 'AAAAAAAAAAAAAAAAAAAAAA', input: { ...FORM, website: null } };
  assert.ok(failedPage({ ...base, input: { ...base.input, noStorefront: true } }, { stamp: 's' })
    .includes('<input type="hidden" name="noStorefront" value="1">'));
  assert.equal(failedPage(base, { stamp: 's' }).includes('noStorefront'), false);
});

// ---- the Check -----------------------------------------------------------------------------------------

const site = { ...FORM, website: 'https://example.com/' };
const noStore = { ...site, noStorefront: true };
const FILLER = `<p>${'We clean windows and gutters for homes and shops. '.repeat(8)}</p>`;

function addressResult(body, input) {
  const facts = readPageFacts(`<title>Capital City Window</title><h1>Window cleaning</h1>${FILLER}${body}`);
  return runWebsiteChecks({ facts, robots: { status: 404 }, llms: { status: 404 }, input }).find(r => r.id === 'address-shown');
}

test('F4: in no-storefront mode the Check passes on a service area and fails on a street address alone', () => {
  for (const body of [
    '<p>Serving Nashville and nearby areas.</p>',
    '<p>Our service area: Davidson and Williamson counties.</p>',
    '<p>We proudly serve the greater Nashville area.</p>',
  ]) {
    const r = addressResult(body, noStore);
    assert.equal(r.result, 'pass', body);
    assert.equal(r.detail, 'Your home page says what area you serve.');
  }
  const label = '<script type="application/ld+json">{"@type":"CleaningService","name":"C","telephone":"6155550100","areaServed":"Nashville"}</script>';
  assert.equal(addressResult(label, noStore).result, 'pass', 'areaServed in the business label counts');

  for (const body of ['<p>Visit us at 12 Main Street, Nashville, TN.</p>', '<p>We serve breakfast all day.</p>', '']) {
    const r = addressResult(body, noStore);
    assert.equal(r.result, 'fail', body);
    assert.equal(r.detail, 'We found no service area on your home page.');
  }
});

test('F4: without the box the Check is the address Check as before', () => {
  const street = addressResult('<p>Visit us at 12 Main Street, Nashville, TN.</p>', site);
  assert.equal(street.result, 'pass');
  assert.equal(street.detail, 'Your home page shows a street address.');
  const area = addressResult('<p>Serving Nashville and nearby areas.</p>', site);
  assert.equal(area.result, 'fail', 'a service-area line alone fails the address mode');
  assert.equal(area.detail, 'We found no street address on your home page.');
  // The unticked run of the whole page gives exactly what an input without the key gives.
  const facts = readPageFacts(`<title>Window cleaning in Nashville</title>${FILLER}<p>12 Main Street</p>`);
  const args = { facts, robots: { status: 404 }, llms: { status: 404 } };
  assert.deepEqual(runWebsiteChecks({ ...args, input: site }), runWebsiteChecks({ ...args, input: { ...site, noStorefront: false } }));
});

test('F4: the Check keeps its id, group and points in both modes, and stays a text-based Check', () => {
  const plain = checkById('address-shown');
  const variant = checkById('address-shown', noStore);
  assert.equal(variant.id, plain.id);
  assert.equal(variant.group, 'customer_basics');
  assert.equal(variant.points, plain.points);
  assert.equal(variant.label, 'Service area on your home page');
  assert.equal(plain.label, 'Street address on the home page');
  assert.equal(checkById('address-shown', site).label, plain.label);
  assert.equal(checkById('tap-to-call', noStore), checkById('tap-to-call'), 'other Checks are unchanged');

  const script = readPageFacts('<title>Capital City Window</title><div id="root"></div><script src="app.js"></script>');
  const r = runWebsiteChecks({ facts: script, robots: { status: 404 }, llms: { status: 404 }, input: noStore }).find(x => x.id === 'address-shown');
  assert.equal(r.result, 'not_checked');
  const none = runWebsiteChecks({ facts: null, robots: null, llms: null, input: { ...noStore, website: null } }).find(x => x.id === 'address-shown');
  assert.deepEqual(none, { id: 'address-shown', result: 'not_checked', detail: 'No website given' });
});

test('F4: the service-area texts and fix never say an address is missing', () => {
  const v = checkById('address-shown', noStore);
  for (const text of [v.label, v.passText, v.failText, v.fix]) {
    assert.doesNotMatch(text, /address/i, text);
  }
});

test('F4: the fix uses the Grade\'s own city, "your city" when it is empty, and drops the example past 160 characters', () => {
  assert.equal(
    serviceAreaFix({ city: 'Tallahassee' }),
    'Add a line to your home page that names the area you serve, like "Serving Tallahassee and nearby areas".',
  );
  assert.equal(checkById('address-shown', noStore).fix, serviceAreaFix({ city: 'Nashville' }));
  for (const city of ['', '   ', undefined, null]) {
    assert.ok(serviceAreaFix({ city }).includes('"Serving your city and nearby areas"'), String(city));
  }
  assert.ok(serviceAreaFix(undefined).includes('your city'));

  const long = 'L'.repeat(80);
  const fix = checkById('address-shown', { ...noStore, city: long }).fix;
  assert.ok(Array.from(fix).length <= 160, `${Array.from(fix).length} characters`);
  assert.equal(fix, 'Add a line to your home page that names the area you serve.');
  // Words are never cut: the fix is either the whole sentence or the short one.
  for (let n = 1; n <= 80; n += 1) {
    const f = serviceAreaFix({ city: 'x'.repeat(n) });
    assert.ok(Array.from(f).length <= 160);
    assert.ok(f.endsWith('nearby areas".') || f === 'Add a line to your home page that names the area you serve.');
  }
});

test('F4: every fix, in both modes, is at most 160 characters for an 80-character city', () => {
  const input = { ...noStore, city: 'C'.repeat(80) };
  for (const c of CHECKS) {
    assert.ok(Array.from(checkById(c.id, input).fix).length <= 160, c.id);
    assert.ok(Array.from(checkById(c.id).fix).length <= 160, c.id);
  }
});

// ---- the report ------------------------------------------------------------------------------------------

function grade(input, results = []) {
  const at = new Date(START).toISOString();
  return {
    id: 'BBBBBBBBBBBBBBBBBBBBBB', status: 'done', input, createdAt: at, finishedAt: at, steps: [], facts: null,
    found: { phone: '(615) 555-0100', hours: [], address: '12 Main Street', website: input.website ?? '' },
    results, ai: [], aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: null,
  };
}

test('F4: the preview says "Serves the <city> area" and never "Add your address" in no-storefront mode', () => {
  const ns = reportPage(grade({ ...noStore, website: null }));
  assert.ok(ns.includes('<p>Serves the Nashville area</p>'));
  assert.equal(ns.includes('Add your address'), false);
  assert.equal(ns.includes('Address: 12 Main Street'), false, 'not even the address the scan found');

  const plain = reportPage(grade({ ...FORM, website: null }));
  assert.ok(plain.includes('Address: 12 Main Street'));
  assert.equal(plain.includes('Serves the'), false);
  const empty = reportPage({ ...grade({ ...FORM, website: null }), found: { phone: '', hours: [], address: '', website: '' } });
  assert.ok(empty.includes('Add your address'));

  const odd = reportPage(grade({ ...noStore, city: '<b>Nash</b>', website: null }));
  assert.ok(odd.includes('<p>Serves the &lt;b&gt;Nash&lt;/b&gt; area</p>'));
});

test('F4: the report rows and "Fix these first" use the service-area wording, escaped', () => {
  const results = [{ id: 'address-shown', result: 'fail', detail: 'We found no service area on your home page.' }];
  const html = reportPage(grade({ ...noStore, city: 'St. <Louis>' }, results), { leadGate: false });
  assert.ok(html.includes('Service area on your home page'));
  assert.equal(html.includes('Street address on the home page'), false);
  assert.ok(html.includes('like &quot;Serving St. &lt;Louis&gt; and nearby areas&quot;.'));
  assert.equal(html.includes('Serving St. <Louis>'), false);

  const plain = reportPage(grade(site, [{ id: 'address-shown', result: 'fail', detail: 'We found no street address on your home page.' }]), { leadGate: false });
  assert.ok(plain.includes('Street address on the home page'));
  assert.equal(plain.includes('Service area on your home page'), false);
});
