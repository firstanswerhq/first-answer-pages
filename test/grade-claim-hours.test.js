/**
 * O4 (D4, V155): a listing claimed from a report leaves Services blank, so confirm waits for the owner, and the
 * hours are filled in the form's own style ("7am-6pm"). parseHoursRange also reads 24-hour "HH:MM-HH:MM", so
 * listings published earlier with hours like "07:00-18:00" get their opening hours in the JSON-LD.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { formStyleHours, schemaHours, readableHours } from '../server/lib/grader.js';
import { buildSchema, parseHoursRange } from '../server/lib/schema.js';
import { listingMetaDescription } from '../server/routes/listings.js';

// ---- formStyleHours -----------------------------------------------------------------------------------------------

test('formStyleHours: 24-hour ranges become the form style', () => {
  assert.equal(formStyleHours('07:00-18:00'), '7am-6pm');
  assert.equal(formStyleHours('08:30-17:00'), '8:30am-5pm');
  assert.equal(formStyleHours('00:00-12:00'), '12am-12pm');
  assert.equal(formStyleHours('12:00-23:45'), '12pm-11:45pm');
  assert.equal(formStyleHours('9:00-13:05'), '9am-1:05pm');
  assert.equal(formStyleHours('07:00 to 18:00'), '7am-6pm');
  assert.equal(formStyleHours('07:00\u201318:00'), '7am-6pm');
  assert.equal(formStyleHours('8:00-17:00'), '8am-5pm');
});

test('V177: a range is 24-hour only when an hour has a leading zero or is 0 or 13 or more', () => {
  assert.equal(formStyleHours('0:00-12:00'), '12am-12pm');
  assert.equal(formStyleHours('8:00-13:00'), '8am-1pm');
});

test('V178, V179: 00:00-00:00 is open all day; 24:00 is only a closing time, and means 23:59', () => {
  assert.equal(formStyleHours('00:00-24:00'), '12am-11:59pm');
  assert.equal(formStyleHours('08:00-24:00'), '8am-11:59pm');
  assert.equal(formStyleHours('00:00-00:00'), '12am-11:59pm');
  assert.equal(formStyleHours('08:00-08:00'), '08:00-08:00', 'any other equal pair is kept as found');
  assert.deepEqual(parseHoursRange('00:00-24:00'), { opens: '00:00', closes: '23:59' });
  assert.deepEqual(parseHoursRange('00:00-00:00'), { opens: '00:00', closes: '23:59' });
  assert.deepEqual(parseHoursRange('08:00-24:00'), { opens: '08:00', closes: '23:59' });
  assert.equal(parseHoursRange('08:00-08:00'), null);
  assert.equal(parseHoursRange('12:00-12:00'), null);
  assert.equal(parseHoursRange('24:00-24:00'), null);
  assert.equal(parseHoursRange('24:00-08:00'), null, '24:00 is not an opening time');
  assert.equal(parseHoursRange('24:30-08:00'), null);
  assert.equal(parseHoursRange('08:00-24:30'), null);
});

test('V184: the 12-hour form follows the same equal-times rule', () => {
  assert.deepEqual(parseHoursRange('12am-12am'), { opens: '00:00', closes: '23:59' });
  assert.equal(parseHoursRange('9am-9am'), null);
  assert.deepEqual(parseHoursRange('9am-5pm'), { opens: '09:00', closes: '17:00' });
});

test('V185, V187: the fix kit label checks each side, and keeps open-all-day hours', () => {
  assert.deepEqual(schemaHours(['Mo-Fr 9am-5:00']), []);
  assert.deepEqual(schemaHours(['Mo-Fr 5:00-9pm']), []);
  assert.deepEqual(schemaHours(['Mo-Fr 9am-17:00']), ['Mo-Fr 09:00-17:00'], 'a side that is clear on its own is used');
  assert.deepEqual(schemaHours(['Mo-Fr 00:00-24:00']), ['Mo-Fr 00:00-23:59']);
  assert.deepEqual(schemaHours(['Mo-Fr 00:00-00:00']), ['Mo-Fr 00:00-23:59']);
  assert.deepEqual(schemaHours(['Mo-Fr 9am-9am']), []);
});

test('V188: the hours people read follow the same rule', () => {
  assert.deepEqual(readableHours(['Mo-Fr 8:00-5:00']), ['Monday to Friday, 8:00-5:00']);
  assert.deepEqual(readableHours(['Mo-Fr 9:30-4:30']), ['Monday to Friday, 9:30-4:30']);
  assert.deepEqual(readableHours(['Mo-Fr 08:00-17:00']), ['Monday to Friday, 8:00 am to 5:00 pm']);
  assert.deepEqual(readableHours(['Mo-Fr 00:00-00:00']), ['Monday to Friday, 12:00 am to 11:59 pm']);
  assert.deepEqual(readableHours(['Mo-Fr 9am-5pm']), ['Monday to Friday, 9:00 am to 5:00 pm']);
});

test('V177: the fix kit label reads 24-hour times only when they cannot be 12-hour times', () => {
  assert.deepEqual(schemaHours(['Mo-Fr 08:00-17:00']), ['Mo-Fr 08:00-17:00']);
  assert.deepEqual(schemaHours(['Mo-Fr 07:00-18:00']), ['Mo-Fr 07:00-18:00']);
  assert.deepEqual(schemaHours(['Mo-Fr 9am-5pm']), ['Mo-Fr 09:00-17:00']);
  assert.deepEqual(schemaHours(['Mo-Fr 8:00-5:00']), []);
  assert.deepEqual(schemaHours(['Mo-Fr 9:00-5:00']), []);
  assert.deepEqual(schemaHours(['Mo-Fr 12:00-1:00']), []);
});

test('formStyleHours: any other value is kept as found', () => {
  for (const value of [
    '9am-5pm', 'Closed', 'By appointment', '', '25:00-26:00', '07:60-18:00', '08:00-08:00', '24:00-24:00', '24:00-08:00',
    // V177: could be 12-hour times with no am or pm, so they are not read as 24-hour
    '8:00-5:00', '9:00 - 5:00', '12:00-1:00', '9:00-5:30', '8:00 to 12:00',
  ]) {
    assert.equal(formStyleHours(value), value, value);
  }
  assert.equal(formStyleHours(undefined), undefined);
  assert.equal(formStyleHours(null), null);
  assert.equal(formStyleHours(700), 700);
});

// ---- parseHoursRange ----------------------------------------------------------------------------------------------

test('parseHoursRange reads both the 12-hour and the 24-hour forms', () => {
  assert.deepEqual(parseHoursRange('7am-6pm'), { opens: '07:00', closes: '18:00' });
  assert.deepEqual(parseHoursRange('7:00 AM - 5:00 PM'), { opens: '07:00', closes: '17:00' });
  assert.deepEqual(parseHoursRange('07:00-18:00'), { opens: '07:00', closes: '18:00' });
  assert.deepEqual(parseHoursRange('8:00-17:00'), { opens: '08:00', closes: '17:00' });
  assert.deepEqual(parseHoursRange('07:00 to 18:00'), { opens: '07:00', closes: '18:00' });
  assert.deepEqual(parseHoursRange('08:30\u201317:30'), { opens: '08:30', closes: '17:30' });
  assert.deepEqual(parseHoursRange('00:00-23:59'), { opens: '00:00', closes: '23:59' });
  assert.deepEqual(parseHoursRange('9:00-13:05'), { opens: '09:00', closes: '13:05' });
});

test('parseHoursRange still refuses what it cannot read for sure', () => {
  for (const value of [
    '25:00-26:00', '07:60-18:00', '24:00-24:00', '7:00', '07:00-', '13:00 AM - 5:00 PM',
    // V177: could be 12-hour times with no am or pm
    '8:00-5:00', '9:00 - 5:00', '12:00-1:00', '9:00-5:30',
    '0:30 AM - 5:00 PM', '7:60 AM - 5:00 PM', 'Closed', 'garbage', '', undefined, null, 700, {},
  ]) {
    assert.equal(parseHoursRange(value), null, String(value));
  }
});

test('buildSchema: hours in either form give the same opening hours', () => {
  const listing = hours => ({
    id: 'zephyr-plumbing', name: 'Zephyr Plumbing', phone: '(615) 555-0142', description: 'We fix pipes.',
    city: 'Nashville', state: 'TN', services: ['Drain cleaning'], category: 'plumbers', hours,
  });
  const a = buildSchema(listing({ monday: '07:00-18:00', saturday: 'Closed' }), null, { baseUrl: 'http://example.test/' });
  const b = buildSchema(listing({ monday: '7am-6pm', saturday: 'Closed' }), null, { baseUrl: 'http://example.test/' });
  assert.deepEqual(a.openingHoursSpecification, [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '07:00', closes: '18:00' },
  ]);
  assert.deepEqual(b.openingHoursSpecification, a.openingHoursSpecification);
});

// ---- the claim ----------------------------------------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const AT = new Date(NOW - 60 * 1000).toISOString();
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const ID = 'claimHoursAAAAAAAAAAAA';
const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-o4-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 2000, gradeLimit: 1000 });
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: { name: 'anthropic', async ask() { throw new Error('not used'); } },
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { return { status: 404, text: '', contentType: 'text/plain' }; } },
    graderTiming: { sleep: async () => {} },
    config: {
      baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'o4-token',
      gradeAiCallsPerDay: 1000, gradeMainAsks: 1, demoMode: false,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await aiBudget.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { ctx: app.locals.ctx, dir, base: `http://127.0.0.1:${server.address().port}` };
}

async function storeGrade(env, hours) {
  const g = {
    id: ID, status: 'done', input: INPUT, key: 'claim-hours', createdAt: AT, finishedAt: AT, steps: [], facts: null,
    found: { phone: '(615) 555-0142', hours, address: '', website: '', reviewsLink: '' },
    results: [], ai: [], aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: { total: 0, max: 0 },
    previousScore: null, recheckedAt: null, extraAiStartedAt: AT,
  };
  await env.ctx.store.collection('grades').update(list => { list.push(g); });
}

async function readDraft(env, draftId) {
  const drafts = JSON.parse(await fs.readFile(path.join(env.dir, 'drafts.json'), 'utf8'));
  return drafts.find(d => d.id === draftId);
}

test('claim: Services is left blank and flagged, and hours are in the form style', async () => {
  const env = await startEnv();
  await storeGrade(env, ['Mo-Fr 07:00-18:00']);
  const result = await env.ctx.grader.claim(ID);
  assert.equal(result.status, 303);
  const draft = await readDraft(env, result.draftId);
  assert.deepEqual(draft.fields.services, []);
  assert.ok(draft.missingFields.includes('services'));
  assert.equal(draft.fields.hours.monday, '7am-6pm');
  assert.equal(draft.fields.hours.friday, '7am-6pm');
  assert.equal(draft.fields.hours.saturday, undefined);
  assert.equal(draft.fields.category, 'plumbers');
  assert.equal(draft.fields.city, 'Nashville');
  assert.equal(draft.fields.state, 'TN');
  assert.equal(draft.fields.serviceArea, 'Nashville');
  assert.equal(draft.fields.phone, '(615) 555-0142');
});

test('claim: hours already in the form style are kept', async () => {
  const env = await startEnv();
  await storeGrade(env, ['Monday, Wednesday 9am-5pm']);
  const result = await env.ctx.grader.claim(ID);
  const draft = await readDraft(env, result.draftId);
  assert.equal(draft.fields.hours.monday, '9am-5pm');
  assert.equal(draft.fields.hours.wednesday, '9am-5pm');
});

test('claim: the form shows an empty Services box marked as needing input', async () => {
  const env = await startEnv();
  await storeGrade(env, ['Mo-Fr 07:00-18:00']);
  const { draftId } = await env.ctx.grader.claim(ID);
  const res = await fetch(`${env.base}/rise/drafts/${draftId}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  const label = /<label for="f-services">([^]*?)<\/label>/.exec(html)?.[1] ?? '';
  assert.ok(label.includes('Needs your input'), label);
  assert.equal(label.includes('Required'), false);
  assert.ok(html.includes('class="field missing"'));
  // V182, V186: a neutral line in the empty box, as a placeholder (not a value)
  assert.ok(html.includes('<textarea id="f-services" name="services" rows="5" placeholder="List what you offer, one per line">'));
  const box = /<textarea id="f-services"[^>]*>([^]*?)<\/textarea>/.exec(html)?.[1];
  assert.equal(box?.trim(), '');
});

test('claim: the listing text built from the claimed fields no longer says "offering plumbers"', async () => {
  const env = await startEnv();
  await storeGrade(env, ['Mo-Fr 07:00-18:00']);
  const { draftId } = await env.ctx.grader.claim(ID);
  const draft = await readDraft(env, draftId);
  const text = listingMetaDescription({ ...draft.fields, id: 'zephyr-plumbing', description: 'We fix pipes.' });
  assert.equal(text.includes('offering'), false);
  assert.equal(text.includes('offering plumbers'), false);
  // Once the owner types services, the sentence uses those.
  const filled = listingMetaDescription({ ...draft.fields, id: 'zephyr-plumbing', description: 'We fix pipes.', services: ['Drain cleaning'] });
  assert.ok(filled.includes('offering drain cleaning'));
});

test('claim: confirm is blocked until Services is filled', async () => {
  const env = await startEnv();
  await storeGrade(env, ['Mo-Fr 07:00-18:00']);
  const { draftId } = await env.ctx.grader.claim(ID);
  const result = await env.ctx.store.submitDraft(draftId);
  assert.equal(result.status, 422);
  assert.ok(result.missingFields.includes('services'));
});
