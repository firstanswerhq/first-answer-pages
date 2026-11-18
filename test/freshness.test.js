/**
 * Tests for the freshness features (.kiro/specs/freshness):
 *   1. hours-match: hours agree across the home page, the business label and our listing
 *   2. site-fresh: signs the website was updated lately (injected "now")
 *   3. the monthly standing fix in every report
 *   4. which details were confirmed, and when, on listings (stamp, JSON-LD, llms.txt)
 *   5. the 90-day rule and the owner's "Still correct" button
 *
 * Apps run on a temporary DATA_DIR; nothing touches the network or the repo data/ folder.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createMockVisionProvider } from '../server/lib/vision.js';
import { readPageFacts } from '../server/lib/page-facts.js';
import { runWebsiteChecks, CHECKS, STANDING_FIXES, checkById } from '../server/lib/grade-checks.js';
import {
  hoursFromText, hoursFromStructured, hoursFromListing, compareHours, findListingFor, readDayValue,
} from '../server/lib/grade-hours.js';
import { judgeFreshness, copyrightYear, updatedDates } from '../server/lib/grade-freshness.js';
import { scoreGrade } from '../server/lib/grade-score.js';
import { reportPage } from '../server/lib/grade-html.js';
import {
  confirmedFieldsFor, fieldsText, confirmationView, CONFIRM_FRESH_DAYS,
} from '../server/lib/confirmation.js';
import { listingDetail } from '../server/lib/html.js';
import { buildSchema } from '../server/lib/schema.js';
import { generateLlmsTxt } from '../server/lib/llms.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const NOW = Date.UTC(2026, 10, 18, 15, 0, 0); // Nov 18, 2026
const DAY = 24 * 60 * 60 * 1000;
const input = { city: 'Nashville', service: 'roof repair', website: 'https://example.com/' };
const byId = results => Object.fromEntries(results.map(r => [r.id, r]));

const page = ({ text = '', ld = null, extraLd = '' } = {}) => readPageFacts(`<title>Acme Roofing</title>
  ${ld ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ''}${extraLd}
  <h1>Acme</h1><p>${text} ${'We fix roofs. '.repeat(20)}</p>`);

const label = extra => ({ '@type': 'RoofingContractor', name: 'Acme Roofing', telephone: '(615) 555-0100', ...extra });
const check = (facts, extra = {}) => byId(runWebsiteChecks({ facts, robots: null, llms: null, input, now: NOW, ...extra }));

// ---- 1. hours-match -------------------------------------------------------------------

test('hours are read from page text, the business label and a listing', () => {
  const text = hoursFromText('Open Mon-Fri 8am-5pm, Sat 9 a.m. to noon. Sunday: Closed.');
  assert.deepEqual([...text], [[0, '480-1020'], [1, '480-1020'], [2, '480-1020'], [3, '480-1020'], [4, '480-1020'], [5, '540-720'], [6, 'closed']]);
  const ld = hoursFromStructured({ text: ['Mo-Fr 08:00-17:00, Sa 09:00-12:00'], spec: [] });
  assert.equal(ld.get(4), '480-1020');
  assert.equal(ld.get(5), '540-720');
  const spec = hoursFromStructured({ text: [], spec: [
    { days: ['Monday', 'Tuesday'], opens: '08:00', closes: '17:00' },
    { days: ['Sunday'], opens: '00:00', closes: '00:00' },
  ] });
  assert.deepEqual([...spec], [[0, '480-1020'], [1, '480-1020'], [6, 'closed']]);
  const listed = hoursFromListing({ monday: '7:00 AM - 5:00 PM', sunday: 'Closed', tuesday: 'By appointment' });
  assert.deepEqual([...listed], [[0, '420-1020'], [6, 'closed']]);
});

test('hours written before their days are never paired with the wrong days', () => {
  assert.equal(hoursFromText('Hours: 9am-5pm Mon-Fri, 10am-2pm Sat'), null);
  assert.equal(hoursFromText('Closed Sun, Mon-Sat 9am-6pm'), null);
  // The usual order still reads, including "Sun closed" in the middle.
  assert.deepEqual([...hoursFromText('Sun closed Mon 9am-5pm')], [[6, 'closed'], [0, '540-1020']]);
  assert.equal(hoursFromText('Mon-Fri 8am-5pm Sat 9am-1pm').get(5), '540-780');
  const r = check(page({ text: 'Hours: 9am-5pm Mon-Fri, 10am-2pm Sat', ld: label({ openingHours: 'Mo-Fr 09:00-17:00, Sa 10:00-14:00' }) }));
  assert.equal(r['hours-match'].result, 'not_checked');
});

test('holiday, seasonal and appointment hours are not read as regular hours', () => {
  for (const t of [
    'Holiday hours: Fri 9am-12pm', 'Thanksgiving hours Thu 9am-12pm', 'Summer hours: Mon-Fri 7am-3pm',
    'Mon-Thu 8am-5pm. (Sat 9am-12pm May-Sept)', 'Sat 10am-2pm by appointment only', 'Christmas Eve: Wed 8am-noon',
  ]) assert.equal(hoursFromText(t), null, t);
  const r = check(page({ text: 'Holiday hours: Mon-Fri 10am-2pm', ld: label({ openingHours: 'Mo-Fr 08:00-17:00' }) }));
  assert.notEqual(r['hours-match'].result, 'fail');
});

test('"Su 00:00-00:00" in openingHours means closed, the same as in openingHoursSpecification', () => {
  const ld = hoursFromStructured({ text: ['Mo-Sa 09:00-17:00, Su 00:00-00:00'], spec: [] });
  assert.equal(ld.get(6), 'closed');
  const r = check(page({ text: 'Mon-Sat 9am-5pm, Sunday closed', ld: label({ openingHours: 'Mo-Sa 09:00-17:00, Su 00:00-00:00' }) }));
  assert.equal(r['hours-match'].result, 'pass');
  assert.equal(readDayValue('12am-12am'), null, 'unclear in page text');
});

test('unclear hours are left out instead of guessed', () => {
  assert.equal(readDayValue('9-5'), null, 'no am/pm');
  assert.equal(readDayValue('9-5pm'), null, 'only one side has am/pm');
  assert.equal(hoursFromText('Monterey sunrise tours 8am-5pm'), null, 'not day names');
  assert.equal(hoursFromText('Mon-Fri 8am-5pm. Kitchen: Monday 11am-9pm'), null, 'the page disagrees with itself');
  assert.equal(hoursFromStructured({ text: ['Mo-Fr 08:00-17:00', 'Mo 09:00-17:00'], spec: [] }), null);
  assert.equal(hoursFromStructured({ text: ['Weekdays nine to five'], spec: [] }), null);
});

test('hours-match passes when the page and the business label agree', () => {
  const r = check(page({ text: 'Hours: Monday - Friday 8:00 AM - 5:00 PM', ld: label({ openingHours: 'Mo-Fr 08:00-17:00' }) }));
  assert.equal(r['hours-match'].result, 'pass', r['hours-match'].detail);
  assert.equal(r['hours-match'].detail, 'Your hours say the same thing on your home page and your business label for AI.');
});

test('hours-match fails with plain words when two places clearly differ', () => {
  const r = check(page({ text: 'Open Mon-Fri 8am-5pm', ld: label({ openingHours: 'Mo-Fr 09:00-17:00' }) }));
  assert.equal(r['hours-match'].result, 'fail');
  assert.equal(r['hours-match'].detail,
    'Your home page says Monday 8 AM to 5 PM. Your business label for AI says Monday 9 AM to 5 PM. '
    + "Your hours don't match, so customers and AI can't tell which ones are right.");
  assert.match(checkById('hours-match').fix, /including your Google profile/);
});

test('hours-match is "not checked", never failed, when it cannot compare', () => {
  assert.equal(check(page({ text: 'Open Mon-Fri 8am-5pm' }))['hours-match'].result, 'not_checked', 'one place only');
  // Different days only: nothing to line up.
  const apart = check(page({ text: 'Saturday 9am-1pm', ld: label({ openingHours: 'Mo-Fr 08:00-17:00' }) }));
  assert.equal(apart['hours-match'].result, 'not_checked');
  // A lunch break on one side and plain hours on the other is not called a mismatch.
  const lunch = check(page({ text: 'Mon-Fri 8am-12pm, 1pm-5pm', ld: label({ openingHours: 'Mo-Fr 08:00-17:00' }) }));
  assert.notEqual(lunch['hours-match'].result, 'fail');
  // Holiday rows (validFrom) are not regular hours.
  const holiday = check(page({ text: 'Mon-Fri 8am-5pm', ld: label({ openingHoursSpecification: [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '08:00', closes: '17:00' },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '10:00', closes: '14:00', validFrom: '2026-12-24', validThrough: '2026-12-24' },
  ] }) }));
  assert.equal(holiday['hours-match'].result, 'pass');
  assert.equal(check(null)['hours-match'].result, 'not_checked');
});

test('hours-match also compares the business\'s listing in our directory, by name', () => {
  const facts = page({ text: 'Open Mon-Fri 8am-5pm', ld: label() });
  const listing = { name: 'Acme Roofing', hours: { monday: '7am-5pm' } };
  const r = check(facts, { listing });
  assert.equal(r['hours-match'].result, 'fail');
  assert.match(r['hours-match'].detail, /Your listing in our directory \(Acme Roofing\) says Monday 7 AM to 5 PM\./);
  assert.match(r['hours-match'].detail, /If the hours in our directory are wrong, contact us to change them\.$/);
  // No listing involved: no directory sentence.
  const plain = check(page({ text: 'Open Mon-Fri 8am-5pm', ld: label({ openingHours: 'Mo-Fr 09:00-17:00' }) }));
  assert.doesNotMatch(plain['hours-match'].detail, /our directory/);
});

test('a listing is used only when phone, city and state clearly match one listing', () => {
  const a = { id: 'a', phone: '(615) 555-0100', city: 'Nashville', state: 'TN' };
  const b = { id: 'b', phone: '615.555.0100', city: 'Nashville', state: 'TN' };
  const other = { id: 'c', phone: '(615) 555-0100', city: 'Memphis', state: 'TN' };
  for (const l of [a, b, other]) l.name = 'Acme Roofing';
  const who = { phones: ['tel:+16155550100'], city: 'nashville', state: 'tn', name: 'Acme Roofing LLC' };
  assert.equal(findListingFor([a, other], who), a);
  // Same phone, city and state but a different business name: not used.
  assert.equal(findListingFor([{ ...a, name: 'Zed Plumbing' }], who), null);
  // A different name is fine when the website domain is the same.
  assert.equal(findListingFor([{ ...a, name: 'Zed Plumbing', website: 'https://www.acme.example/' }], { ...who, website: 'acme.example' })?.id, 'a');
  assert.equal(findListingFor([a, b], who), null, 'two matches: unsure');
  assert.equal(findListingFor([other], who), null);
  assert.equal(findListingFor([a], { ...who, phones: [] }), null);
});

test('Property: a source always agrees with itself, so hours-match never fails on one set of hours', () => {
  const time = fc.record({ h: fc.integer({ min: 1, max: 12 }), m: fc.constantFrom(0, 15, 30, 45), pm: fc.boolean() });
  const fmt = t => `${t.h}${t.m ? `:${String(t.m).padStart(2, '0')}` : ''}${t.pm ? 'pm' : 'am'}`;
  const to24 = t => `${String(t.h % 12 + (t.pm ? 12 : 0)).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`;
  fc.assert(fc.property(time, time, (o, c) => {
    fc.pre(to24(o) !== to24(c));
    const facts = page({ text: `Mon-Fri ${fmt(o)}-${fmt(c)}`, ld: label({ openingHours: `Mo-Fr ${to24(o)}-${to24(c)}` }) });
    assert.equal(check(facts)['hours-match'].result, 'pass');
    assert.equal(compareHours([{ label: 'x', hours: hoursFromText(`Mon ${fmt(o)}-${fmt(c)}`) }]).mismatch, null);
  }), { numRuns: 100 });
});

test('the hours reader stays fast on hostile text', () => {
  for (const t of ['Mon, '.repeat(50000), 'Monday through '.repeat(20000), 'Mon-Fri 8am - '.repeat(20000), 'mon & tue / '.repeat(20000)]) {
    const start = Date.now();
    hoursFromText(t);
    assert.ok(Date.now() - start < 1000);
  }
});

// ---- 2. site-fresh -----------------------------------------------------------------------

test('copyright years and "updated" dates are read from page text', () => {
  assert.equal(copyrightYear('© 2019–2026 Acme. Copyright 2021.', 2026), 2026);
  assert.equal(copyrightYear('(c) 2031 typo', 2026), null, 'far-future years are ignored');
  assert.equal(copyrightYear('Call 2026 times', 2026), null);
  assert.equal(copyrightYear('\u00a9 2010 - Present Acme', 2026), 2026);
  assert.equal(copyrightYear('Copyright 2012-today', 2026), 2026);
  assert.equal(copyrightYear('\u00a9 2019-26 Acme', 2026), 2026);
  assert.equal(copyrightYear('\u00a9 2015, 2026 Acme', 2026), 2026);
  assert.equal(copyrightYear('\u00a9 2015, 2018 Acme', 2026), 2018);
  assert.deepEqual(updatedDates('Last updated: March 3, 2026. Updated on 2025-12-01. Updated 2/30/2026'),
    [Date.UTC(2026, 2, 3), Date.UTC(2025, 11, 1)]);
});

test('site-fresh passes on a current year and fails on a clearly old one', () => {
  assert.equal(judgeFreshness(page({ text: '© 2026 Acme' }), { now: NOW }).result, 'pass');
  assert.equal(judgeFreshness(page({ text: '© 2025 Acme' }), { now: NOW }).result, 'pass', 'last year still counts');
  const old = judgeFreshness(page({ text: 'Copyright © 2021 Acme' }), { now: NOW });
  assert.equal(old.result, 'fail');
  assert.equal(old.detail, 'Your website shows © 2021. That can make it look out of date to customers and AI.');
  // The same page judged in 2022 is fine: "now" comes from the caller.
  assert.equal(judgeFreshness(page({ text: '© 2021 Acme' }), { now: Date.UTC(2022, 5, 1) }).result, 'pass');
});

test('site-fresh uses dateModified, "updated" dates and Last-Modified; no date is only a note', () => {
  const ld = judgeFreshness(page({ ld: label({ dateModified: '2026-10-02' }) }), { now: NOW });
  assert.deepEqual(ld, { result: 'pass', detail: 'Your business label says it was updated on Oct 2, 2026.' });
  assert.equal(judgeFreshness(page({ text: 'Last updated: Nov 2, 2026' }), { now: NOW }).result, 'pass');
  const header = judgeFreshness(page(), { now: NOW, lastModified: 'Mon, 16 Nov 2026 10:00:00 GMT' });
  assert.equal(header.result, 'pass');
  // A server date never hides an old year people can see.
  assert.equal(judgeFreshness(page({ text: '© 2020' }), { now: NOW, lastModified: 'Mon, 16 Nov 2026 10:00:00 GMT' }).result, 'fail');
  const none = judgeFreshness(page(), { now: NOW, lastModified: 'Mon, 01 Jan 2018 10:00:00 GMT' });
  assert.equal(none.result, 'not_checked');
  assert.match(none.detail, /^We found no date on your home page\./);
  const built = judgeFreshness({ text: '', scriptBuilt: true, jsonLd: {} }, { now: NOW });
  assert.deepEqual(built, { result: 'not_checked', detail: "Your page loads its words in a way this check can't read yet." });
  assert.equal(header.detail, "Your website's settings say the home page changed on Nov 16, 2026.");
  assert.equal(judgeFreshness(page({ text: '\u00a9 2010 - Present' }), { now: NOW }).result, 'pass');
});

test('site-fresh runs inside the website checks with the injected clock and Last-Modified', () => {
  const r = check(page({ text: '© 2019' }));
  assert.equal(r['site-fresh'].result, 'fail');
  assert.equal(check(page(), { lastModified: 'Wed, 18 Nov 2026 09:00:00 GMT' })['site-fresh'].result, 'pass');
  assert.equal(check(null)['site-fresh'].result, 'not_checked');
});

test('page facts carry dateModified and the raw opening hours', () => {
  const facts = readPageFacts(`<script type="application/ld+json">${JSON.stringify({ '@graph': [
    { '@type': 'WebPage', dateModified: '2026-09-01T10:00:00Z' },
    label({ openingHours: ['Mo-Fr 08:00-17:00'], dateModified: '2026-03-01' }),
  ] })}</script>`);
  assert.equal(facts.jsonLd.dateModified, '2026-09-01T10:00:00Z');
  assert.deepEqual(facts.jsonLd.business.hoursParts, { text: ['Mo-Fr 08:00-17:00'], spec: [] });
});

// ---- 3. report: priority and the standing fix --------------------------------------------

function doneGrade(results) {
  return {
    id: 'g1', status: 'done', createdAt: new Date(NOW).toISOString(), finishedAt: new Date(NOW).toISOString(),
    input: { name: 'Acme Roofing', city: 'Nashville', state: 'TN', service: 'roofers', website: 'https://example.com/' },
    results, score: scoreGrade(results), ai: [], facts: null,
  };
}

test('every report has the monthly standing fix, worth no points and with no claim we checked', () => {
  assert.equal(CHECKS.some(c => c.id === STANDING_FIXES[0].id), false, 'not a Check, so never scored');
  const text = "Once a month, reply to your reviews and add a new photo to your Google business profile. Recent activity shows customers, and AI, that you're still open.";
  assert.equal(STANDING_FIXES[0].text, text);
  const allPass = doneGrade(CHECKS.filter(c => c.id !== 'google-profile').map(c => ({ id: c.id, result: 'pass', detail: c.passText })));
  const someFail = doneGrade([{ id: 'summary', result: 'fail', detail: 'x' }, { id: 'tap-to-call', result: 'pass', detail: 'y' }]);
  for (const grade of [allPass, someFail]) {
    const html = reportPage(grade, { unlocked: true });
    assert.ok(html.includes(text.replace("'", '&#39;')) || html.includes(text), 'standing fix shown');
    assert.doesNotMatch(html, /we (checked|looked at) your Google/i);
    // Shown as a row like the fixes, inside the same box.
    assert.match(html, /<section class="grade-top-fails">[\s\S]*<li><strong>Every month\.<\/strong> Once a month/);
  }
  const html = reportPage(someFail, { unlocked: true });
  assert.ok(html.indexOf('Once a month') < html.indexOf('Not a computer person?'), 'before the hint');
});

test('the about page says we compare hours with a matching listing', async () => {
  const { aboutPage } = await import('../server/lib/grade-html.js');
  assert.match(aboutPage(), /We also compare your hours with your listing in our directory, if we find one with the same phone, name, city and state\./);
});

test('a failed hours-match is listed first under "Fix these first"', () => {
  const grade = doneGrade([
    { id: 'business-labeled', result: 'fail', detail: 'No label.' },
    { id: 'title-city-service', result: 'fail', detail: 'Bad title.' },
    { id: 'hours-match', result: 'fail', detail: 'Hours differ.' },
  ]);
  const html = reportPage(grade, { unlocked: true });
  const top = html.slice(html.indexOf('Fix these first'));
  assert.ok(top.indexOf('Hours match everywhere') < top.indexOf('Business label AI can read'));
  assert.equal(checkById('hours-match').priority, 'high');
});

// ---- 4. confirmed fields and date on listings ------------------------------------------------

const listing = {
  id: 'acme-roofing-nashville', name: 'Acme Roofing', category: 'roofers', phone: '(615) 555-0100',
  address: '12 Main Street', hours: { monday: '8am-5pm' }, services: ['Roof repair'],
  serviceArea: 'Nashville', description: 'We fix roofs.', city: 'Nashville', state: 'TN',
};

test('the owner review page says the stamp will name the details and the date', async () => {
  const { reviewPage } = await import('../server/lib/rise-html.js');
  const html = reviewPage({ id: 'd1', status: 'draft', fields: {}, missingFields: [] }, []);
  assert.match(html, /Once approved, it shows a stamp saying which details you confirmed and when\./);
});

test('confirmed fields are named in plain words', () => {
  assert.deepEqual(confirmedFieldsFor(listing), ['phone', 'address', 'hours']);
  assert.deepEqual(confirmedFieldsFor({ ...listing, address: '', hours: {} }), ['phone']);
  assert.equal(fieldsText(['hours', 'phone', 'address', 'junk']), 'Phone, address and hours');
  assert.equal(fieldsText(['phone', 'hours']), 'Phone and hours');
  assert.equal(fieldsText(undefined), '');
});

const verification = at => ({
  verifiedDate: new Date(at).toISOString().slice(0, 10), verifiedAt: new Date(at).toISOString(),
  confirmedAt: new Date(at).toISOString(), confirmedFields: ['phone', 'address', 'hours'], hash: 'a'.repeat(64),
});

test('the stamp names what was confirmed and when; over 90 days it says "last confirmed"', () => {
  const fresh = listingDetail(listing, undefined, { categories: [], verification: verification(NOW), now: NOW });
  assert.ok(fresh.includes('Phone, address and hours confirmed by the business on <span class="stamp-date">Nov 18, 2026</span>.'));
  const atEdge = listingDetail(listing, undefined, { categories: [], verification: verification(NOW - CONFIRM_FRESH_DAYS * DAY), now: NOW });
  assert.ok(atEdge.includes('Phone, address and hours confirmed by the business on'));
  const old = listingDetail(listing, undefined, { categories: [], verification: verification(NOW - 91 * DAY), now: NOW });
  assert.ok(old.includes('Last confirmed by the business on <span class="stamp-date">Aug 19, 2026</span>.'));
  assert.doesNotMatch(old, /Phone, address and hours confirmed/);
  // Older listings without a field list keep the general line.
  const legacy = listingDetail(listing, undefined, { categories: [], verification: { verifiedDate: '2026-11-09', hash: 'b'.repeat(64) }, now: NOW });
  assert.ok(legacy.includes('Details confirmed by the business on <span class="stamp-date">Nov 9, 2026</span>.'));
});

test('dateModified is the real confirmation date and is never moved forward', () => {
  const old = verification(NOW - 200 * DAY);
  assert.equal(buildSchema(listing, old).dateModified, old.verifiedDate);
  assert.equal(confirmationView(old, NOW).current, false);
  assert.equal(confirmationView(old).current, true, 'no clock given: shown as before');
});

test('llms.txt names the confirmed details and drops "yes" after 90 days', () => {
  const lines = v => generateLlmsTxt([listing], 'http://example.test', [{ slug: 'roofers', label: 'Roofers' }], {
    confirmed: new Set([listing.id]),
    confirmedDates: new Map([[listing.id, v.verifiedDate]]),
    confirmations: new Map([[listing.id, v]]),
    now: NOW,
  }).split('\n');
  const fresh = lines(verification(NOW - 2 * DAY));
  assert.ok(fresh.includes('Details confirmed by the business: yes (2026-11-16)'));
  assert.ok(fresh.includes('Confirmed details: phone, address and hours'));
  const old = lines(verification(NOW - 120 * DAY));
  assert.ok(old.includes('Details last confirmed by the business: 2026-07-21'));
  assert.ok(!old.some(l => l.startsWith('Details confirmed by the business: yes')));
  assert.ok(!old.some(l => l.startsWith('Confirmed details:')));
});

// ---- 5. the owner's "Still correct" button (end to end) ------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const TOKEN = 'freshness-test-token';
const permissiveLimiter = { consume: () => ({ allowed: true }), consumeAll: () => ({ allowed: true }), peek: () => ({ allowed: true }) };

async function makeEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-freshness-'));
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  const clock = { t: Date.UTC(2026, 7, 1, 18, 0, 0), now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir, clock, newId: () => `draft-${++n}`, visionProvider: createMockVisionProvider(),
    rateLimiter: permissiveLimiter,
    config: { adminToken: TOKEN, production: false, baseUrl: 'http://example.test' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, clock, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p) => fetch(env.base + p, { redirect: 'manual' });
const post = (env, p, body = '') => fetch(env.base + p, {
  method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
});

function ownerForm() {
  const p = new URLSearchParams({
    name: 'Copper Kettle Plumbing', category: 'plumbers', phone: '(615) 555-0101', services: 'Leak repair',
    serviceArea: 'Springfield', description: 'We fix pipes.', city: 'Springfield', state: 'TN',
    address: '9 Elm Street', ownerEmail: '',
  });
  p.set('hours_monday', '7:00 AM - 5:00 PM');
  return p.toString();
}

let rpcId = 0;
async function callTool(env, name, args) {
  const res = await fetch(`${env.base}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  return (await res.json()).result;
}

const ldOf = html => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);

test('the owner presses "Still correct" and the listing shows the new date everywhere', async () => {
  const env = await makeEnv();
  const draftPath = (await post(env, '/rise/manual')).headers.get('location');
  assert.equal((await post(env, `${draftPath}/still-correct`)).status, 409, 'not live yet');
  assert.equal((await post(env, `${draftPath}/confirm`, ownerForm())).status, 303);
  const approved = await fetch(`${env.base}/admin/pending/${draftPath.split('/').pop()}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` },
  });
  const { listingId } = await approved.json();

  let html = await (await get(env, `/listings/${listingId}`)).text();
  assert.ok(html.includes('Phone, address and hours confirmed by the business on <span class="stamp-date">Aug 1, 2026</span>.'));
  assert.equal(ldOf(html).dateModified, '2026-08-01');

  // 100 days later the stamp no longer reads as current, and dateModified stays put.
  env.clock.t += 100 * DAY;
  html = await (await get(env, `/listings/${listingId}`)).text();
  assert.ok(html.includes('Last confirmed by the business on <span class="stamp-date">Aug 1, 2026</span>.'));
  assert.equal(ldOf(html).dateModified, '2026-08-01');
  const feed = await (await get(env, '/llms.txt')).text();
  assert.ok(feed.includes('Details last confirmed by the business: 2026-08-01'));

  const live = await (await get(env, draftPath)).text();
  assert.match(live, /more than 90 days ago, so your listing no longer shows them as current\./);
  assert.ok(live.includes(`action="${draftPath}/still-correct"`));
  assert.match(live, /Your listing shows these details as current for 90 days\. Save this page\./);
  assert.match(live, /If something changed, <a href="\/about">contact us<\/a>\./, 'no CONTACT_EMAIL set: the contact page');
  assert.match(live, /<button type="submit" class="button">Yes, still correct<\/button>/);
  assert.ok(live.indexOf('See your listing') < live.indexOf('Yes, still correct'), '"See your listing" comes first');

  // Over 90 days, the JSON answers say the confirmation is not current.
  const apiOld = await (await get(env, `/api/verify/${listingId}`)).json();
  assert.equal(apiOld.current, false);
  assert.deepEqual(apiOld.confirmedFields, ['phone', 'address', 'hours']);
  const mcpOld = await callTool(env, 'get_listing', { id: listingId });
  assert.equal(mcpOld.structuredContent.verification.current, false);
  assert.deepEqual(mcpOld.structuredContent.verification.confirmedFields, ['phone', 'address', 'hours']);

  // A Séance run from before the first confirmation, and the Séance page's stamp.
  await fs.writeFile(path.join(env.dir, 'seance.json'), JSON.stringify([{
    id: 'run-1', listingId, prompt: 'best plumbers in Springfield', provider: 'fake',
    timestamp: '2026-09-01T12:00:00.000Z', answer: 'An answer.', named: false,
  }]));
  const seanceOld = await (await get(env, `/seance/${listingId}`)).text();
  assert.match(seanceOld, /Last confirmed by the business on Aug 1, 2026\./);
  // The run is after the first confirmation (Aug 1) and before "Still correct" (Nov 9).
  const tagBefore = (await (await get(env, `/api/seance/${listingId}`)).json()).runs[0].ownerConfirmation;
  assert.equal(tagBefore, 'after owner confirmation');

  const pressed = await post(env, `${draftPath}/still-correct`);
  assert.equal(pressed.status, 303);
  assert.equal(pressed.headers.get('location'), `${draftPath}?confirmed=1`);
  assert.match(await (await get(env, `${draftPath}?confirmed=1`)).text(), /Your details are confirmed as of today\./);

  // Pressing again the same day changes nothing.
  const savedOnce = await fs.readFile(path.join(env.dir, 'verified.json'), 'utf8');
  env.clock.t += 60 * 60 * 1000;
  const again = await post(env, `${draftPath}/still-correct`);
  assert.equal(again.headers.get('location'), `${draftPath}?confirmed=same`);
  assert.equal(await fs.readFile(path.join(env.dir, 'verified.json'), 'utf8'), savedOnce);
  assert.match(await (await get(env, `${draftPath}?confirmed=same`)).text(), /You already confirmed your details in the last day\. Nothing changed\./);
  env.clock.t -= 60 * 60 * 1000;

  // The Séance keeps its before/after split at the FIRST confirmation date.
  const afterTag = (await (await get(env, `/api/seance/${listingId}`)).json()).runs[0].ownerConfirmation;
  assert.equal(afterTag, tagBefore);
  assert.match(await (await get(env, `/seance/${listingId}`)).text(), /Phone, address and hours confirmed by the business on Nov 9, 2026\./);
  const api = await (await get(env, `/api/listings/${listingId}`)).json();
  assert.equal(api.current, true);

  html = await (await get(env, `/listings/${listingId}`)).text();
  assert.ok(html.includes('Phone, address and hours confirmed by the business on <span class="stamp-date">Nov 9, 2026</span>.'));
  assert.equal(ldOf(html).dateModified, '2026-11-09');
  const saved = JSON.parse(await fs.readFile(path.join(env.dir, 'verified.json'), 'utf8'))[listingId];
  assert.deepEqual(saved.confirmedFields, ['phone', 'address', 'hours']);
  assert.equal(saved.firstVerifiedDate, '2026-08-01');
  assert.equal(saved.confirmedAt, new Date(env.clock.t).toISOString());
  // The tamper check still matches the page after the new date.
  const v = await (await get(env, `/api/verify/${listingId}`)).json();
  assert.equal(v.verifiedDate, '2026-11-09');

  assert.equal((await post(env, '/rise/drafts/nope/still-correct')).status, 404);
});
