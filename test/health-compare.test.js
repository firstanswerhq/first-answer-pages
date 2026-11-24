/**
 * The tolerant comparisons behind the "details match" signals (checklist A1 to A6) and the rule for picking one
 * result out of a lookup's results. Pure functions: no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  phoneDigits, comparePhone, phonesInText, compareNames, addressParts, compareAddresses, addressInText,
  googleHoursByDay, compareHours, pickCandidate,
} from '../server/lib/health-compare.js';

test('phone: digits only, a leading 1 is dropped, anything that is not 10 digits is unknown', () => {
  assert.equal(phoneDigits('(615) 555-0142'), '6155550142');
  assert.equal(phoneDigits('+1 615-555-0142'), '6155550142');
  assert.equal(phoneDigits('1-615-555-0142'), '6155550142');
  assert.equal(phoneDigits('555-0142'), '');
  assert.equal(phoneDigits(undefined), '');
  assert.equal(comparePhone('(615) 555-0142', '615.555.0142'), 'match');
  assert.equal(comparePhone('(615) 555-0142', '(615) 555-0199'), 'differ');
  assert.equal(comparePhone('', '(615) 555-0142'), 'unknown');
  assert.equal(comparePhone('(615) 555-0142', 'call us'), 'unknown');
});

test('phones written in a page\'s text and tel links are found', () => {
  const found = phonesInText('Call (615) 555-0142 or 615.555.0199. Fax 555-1111.', ['tel:+16155550177']);
  assert.deepEqual([...found].sort(), ['6155550142', '6155550177', '6155550199']);
});

test('names: case, punctuation, LLC and Inc are ignored; a missing word or a typo is close; another name differs', () => {
  assert.equal(compareNames('Zephyr Plumbing LLC', 'ZEPHYR PLUMBING, Inc.'), 'match');
  assert.equal(compareNames("Joe's Pizza & Subs", "Joe's Pizza and Subs"), 'match');
  assert.equal(compareNames('Zephyr Plumbing', 'Zephyr Plumbing and Heating'), 'close');
  assert.equal(compareNames('Zephyr Plumbng', 'Zephyr Plumbing'), 'close');
  assert.equal(compareNames('Zephyr Plumbing', 'Ridgeline Roofing'), 'differ');
  assert.equal(compareNames('', 'Zephyr Plumbing'), 'unknown');
  assert.equal(compareNames('Zephyr Plumbing', undefined), 'unknown');
});

test('addresses: St and Street, Ave and Avenue, case and punctuation are the same; another number or street differs', () => {
  assert.equal(compareAddresses('12 Main Street, Nashville, TN 37203', '12 Main St, Nashville, TN 37203, USA'), 'match');
  assert.equal(compareAddresses('400 church avenue', '400 Church Ave.'), 'match');
  assert.equal(compareAddresses('12 Main Street', '12 Main St, Nashville, TN 37203'), 'match');
  assert.equal(compareAddresses('12 Main Street Suite 4, Nashville, TN 37203', '12 Main St, Nashville, TN 37203'), 'match');
  assert.equal(compareAddresses('12 Main St, Nashville, TN 37203', '12 Main St, Nashville, TN 37204'), 'close');
  assert.equal(compareAddresses('12 Main St, Nashville, TN', '14 Main St, Nashville, TN'), 'differ');
  assert.equal(compareAddresses('12 Main St, Nashville, TN', '12 Oak Ave, Nashville, TN'), 'differ');
  assert.equal(compareAddresses('Nashville, TN', '12 Main St, Nashville, TN'), 'unknown');
  assert.equal(compareAddresses('', '12 Main St'), 'unknown');
  assert.equal(addressParts('12 Main Street, Nashville, TN 37203').zip, '37203');
});

test('an address written anywhere in a page\'s text is found, whatever the abbreviation', () => {
  assert.equal(addressInText('12 Main St, Nashville, TN 37203', 'Visit us at 12 Main Street in Nashville.'), true);
  assert.equal(addressInText('12 Main St, Nashville, TN 37203', 'Visit us at 14 Main Street in Nashville.'), false);
  assert.equal(addressInText('Nashville', 'anything'), false);
});

test('hours: Google\'s periods become one range per day, and a day that cannot be compared for sure is left out', () => {
  const periods = [
    { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
    { open: { day: 2, hour: 8, minute: 30 }, close: { day: 2, hour: 17, minute: 0 } },
    { open: { day: 5, hour: 20, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }, // past midnight
    { open: { day: 3, hour: 8 }, close: { day: 3, hour: 12 } }, { open: { day: 3, hour: 13 }, close: { day: 3, hour: 17 } }, // two periods
    { open: { day: 0, hour: 0, minute: 0 } }, // open all day, no close
  ];
  assert.deepEqual(googleHoursByDay(periods), {
    monday: { opens: '08:00', closes: '17:00' },
    tuesday: { opens: '08:30', closes: '17:00' },
  });
  assert.deepEqual(googleHoursByDay(undefined), {});
});

test('hours compared day by day: all the same, some days differ, every day differs, or nothing to compare', () => {
  const g = { monday: { opens: '08:00', closes: '17:00' }, tuesday: { opens: '08:00', closes: '17:00' }, wednesday: { opens: '08:00', closes: '17:00' } };
  assert.equal(compareHours({ monday: { opens: '08:00', closes: '17:00' }, tuesday: { opens: '08:00', closes: '17:00' } }, g).result, 'match');
  assert.equal(compareHours({ monday: { opens: '08:00', closes: '17:00' }, tuesday: { opens: '09:00', closes: '17:00' } }, g).result, 'some');
  assert.equal(compareHours({ monday: { opens: '09:00', closes: '17:00' }, tuesday: { opens: '09:00', closes: '17:00' } }, g).result, 'differ');
  assert.equal(compareHours({ monday: { opens: '09:00', closes: '17:00' } }, g).result, 'some', 'one day alone is never red');
  assert.equal(compareHours({ saturday: { opens: '09:00', closes: '12:00' } }, g).result, 'unknown');
  assert.equal(compareHours({}, g).result, 'unknown');
});

const cand = (name, address, extra = {}) => ({ name, address, ...extra });

test('picking a result: one clear match is found; none is not found; several or another place is unsure', () => {
  const wanted = { name: 'Zephyr Plumbing', city: 'Nashville', website: 'https://zephyr.example/' };
  // one clear match
  assert.equal(pickCandidate([cand('Zephyr Plumbing LLC', '12 Main St, Nashville, TN'), cand('Other Co', '1 Oak, Nashville, TN')], wanted).status, 'found');
  // nothing came back
  assert.equal(pickCandidate([], wanted).status, 'not_found');
  // results came back but none looks like the business
  assert.equal(pickCandidate([cand('Ridgeline Roofing', '1 Oak, Nashville, TN')], wanted).status, 'not_found');
  // a chain: the right name in another city is not counted, and nothing is guessed
  const chain = pickCandidate([cand('Zephyr Plumbing', '9 Elm, Memphis, TN'), cand('Zephyr Plumbing', '3 Pine, Knoxville, TN')], wanted);
  assert.equal(chain.status, 'unsure');
  // a chain with a store in the typed city: that one is picked
  const picked = pickCandidate([cand('Zephyr Plumbing', '9 Elm, Memphis, TN'), cand('Zephyr Plumbing', '12 Main St, Nashville, TN')], wanted);
  assert.equal(picked.status, 'found');
  assert.ok(picked.place.address.includes('Nashville'));
  // two with similar names in the city: narrowed by the website, else an exact name, else unsure
  const two = [cand('Zephyr Plumbing and Heating', '1 A St, Nashville, TN', { website: 'https://other.example' }), cand('Zephyr Plumbing', '2 B St, Nashville, TN', { website: 'https://zephyr.example/about' })];
  assert.equal(pickCandidate(two, wanted).place.address, '2 B St, Nashville, TN');
  const exactOnly = [cand('Zephyr Plumbing', '1 A St, Nashville, TN'), cand('Zephyr Plumbing Supply', '2 B St, Nashville, TN')];
  assert.equal(pickCandidate(exactOnly, { name: 'Zephyr Plumbing', city: 'Nashville' }).place.address, '1 A St, Nashville, TN');
  const same = [cand('Zephyr Plumbing', '1 A St, Nashville, TN'), cand('Zephyr Plumbing', '2 B St, Nashville, TN')];
  assert.equal(pickCandidate(same, { name: 'Zephyr Plumbing', city: 'Nashville' }).status, 'unsure');
  // a typo in the typed name still finds the business
  assert.equal(pickCandidate([cand('Zephyr Plumbing', '12 Main St, Nashville, TN')], { name: 'Zephyr Plumbng', city: 'Nashville' }).status, 'found');
  // a typo in the typed city: the name matches but not the place, so nothing is guessed
  assert.equal(pickCandidate([cand('Zephyr Plumbing', '12 Main St, Nashville, TN')], { name: 'Zephyr Plumbing', city: 'Nashvile' }).status, 'unsure');
  // a business outside the US matches by the city field when the address has none
  assert.equal(pickCandidate([cand('Zephyr Plumbing', '12 King St', { city: 'Toronto' })], { name: 'Zephyr Plumbing', city: 'Toronto' }).status, 'found');
});
