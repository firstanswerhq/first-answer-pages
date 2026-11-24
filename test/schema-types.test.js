/**
 * Owner decision D5 (task O5, Requirement 30, V156): the business-label Check knows every schema.org local-business
 * type (the car-wash fix). A type counts with a name and a telephone; Organization and its non-local subtypes count
 * only with a telephone and an address too; OnlineBusiness and OnlineStore never count; a leading schema.org address
 * is removed before the lookup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_BUSINESS_TYPE_LIST, LOCAL_BUSINESS_TYPES, ORGANIZATION_TYPES } from '../server/lib/schema-types.js';
import { readPageFacts } from '../server/lib/page-facts.js';

const ADDRESS = { '@type': 'PostalAddress', streetAddress: '12 Main Street', addressLocality: 'Nashville', addressRegion: 'TN' };

/** The business the Check reads from a page whose one JSON-LD block has this node, or null. */
function businessOf(node) {
  const html = `<!doctype html><html><head><title>Home</title>
<script type="application/ld+json">${JSON.stringify(node)}</script></head>
<body><h1>Home</h1><p>${'words '.repeat(60)}</p></body></html>`;
  return readPageFacts(html).jsonLd?.business ?? null;
}

/** What the business-labeled Check needs: a business node with a name and a telephone. */
const labeled = node => {
  const b = businessOf(node);
  return Boolean(b && b.name && b.telephone);
};

const NAMED = { name: 'Sparkle Auto Wash', telephone: '(615) 555-0142' };

test('the list: plain names, each once, and everything the Check knew before is still there', () => {
  assert.ok(LOCAL_BUSINESS_TYPE_LIST.length > 100);
  assert.equal(new Set(LOCAL_BUSINESS_TYPE_LIST).size, LOCAL_BUSINESS_TYPE_LIST.length, 'each name once');
  for (const name of LOCAL_BUSINESS_TYPE_LIST) assert.match(name, /^[A-Za-z0-9]+$/, name);
  assert.equal(LOCAL_BUSINESS_TYPES.size, LOCAL_BUSINESS_TYPE_LIST.length);
  const before = [
    'LocalBusiness', 'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'BarOrPub', 'Bakery',
    'HomeAndConstructionBusiness', 'RoofingContractor', 'HVACBusiness', 'Plumber', 'Electrician',
    'GeneralContractor', 'HousePainter', 'Locksmith', 'MovingCompany', 'AutomotiveBusiness', 'AutoRepair',
    'HealthAndBeautyBusiness', 'HairSalon', 'BeautySalon', 'DaySpa', 'LegalService', 'Attorney',
    'ProfessionalService', 'FinancialService', 'InsuranceAgency', 'RealEstateAgent', 'Dentist',
    'MedicalBusiness', 'Store',
  ];
  for (const name of before) assert.ok(LOCAL_BUSINESS_TYPES.has(name), name);
  // The two online types and the made-up and non-business ones are not on it.
  for (const name of ['OnlineBusiness', 'OnlineStore', 'Organization', 'Corporation', 'NGO', 'Person', 'WebSite', 'MadeUpBusinessType', 'CleaningService']) {
    assert.equal(LOCAL_BUSINESS_TYPES.has(name), false, name);
    assert.equal(LOCAL_BUSINESS_TYPE_LIST.includes(name), false, name);
  }
  // None of them is in the Organization list either, except Organization itself and the non-local subtypes.
  assert.equal(ORGANIZATION_TYPES.has('OnlineBusiness'), false);
  assert.equal(ORGANIZATION_TYPES.has('OnlineStore'), false);
  assert.ok(ORGANIZATION_TYPES.has('Organization') && ORGANIZATION_TYPES.has('Corporation') && ORGANIZATION_TYPES.has('NGO'));
  for (const name of ORGANIZATION_TYPES) assert.equal(LOCAL_BUSINESS_TYPES.has(name), false, name);
});

test('D5: types of every kind pass with a name and telephone, and fail without the telephone', () => {
  const types = [
    'AutoWash', 'NailSalon', 'VeterinaryCare', 'ExerciseGym', 'Hotel', 'Florist', 'Pharmacy', 'AccountingService',
    'Electrician', 'GeneralContractor', 'HVACBusiness', 'HousePainter', 'Locksmith', 'MovingCompany', 'Plumber',
    'RoofingContractor', 'FireStation', 'Hospital', 'Library', 'TattooParlor', 'Notary', 'TireShop', 'PetStore',
  ];
  for (const type of types) {
    assert.ok(LOCAL_BUSINESS_TYPES.has(type), `${type} is on the list`);
    assert.equal(labeled({ '@type': type, ...NAMED }), true, `${type} passes`);
    assert.equal(labeled({ '@type': type, name: NAMED.name }), false, `${type} fails without a telephone`);
  }
});

test('D5: the car wash from the bug report is read, with a full address too', () => {
  const b = businessOf({ '@context': 'https://schema.org', '@type': 'AutoWash', ...NAMED, address: ADDRESS });
  assert.ok(b);
  assert.equal(b.name, 'Sparkle Auto Wash');
  assert.equal(b.telephone, '(615) 555-0142');
  assert.equal(b.type, 'AutoWash');
  assert.equal(b.address?.city, 'Nashville');
});

test('D5: CleaningService still passes; made-up and non-business types still fail', () => {
  assert.equal(labeled({ '@type': 'CleaningService', ...NAMED }), true);
  for (const type of ['MadeUpBusinessType', 'Person', 'WebSite']) {
    assert.equal(labeled({ '@type': type, ...NAMED, address: ADDRESS }), false, type);
  }
});

test('V156: a schema.org address in front of the type is removed before the lookup, in any case', () => {
  for (const type of ['https://schema.org/AutoWash', 'http://schema.org/AutoWash', 'schema:AutoWash', 'SCHEMA:AutoWash', 'HTTPS://Schema.org/AutoWash']) {
    assert.equal(labeled({ '@type': type, ...NAMED }), true, type);
  }
  assert.equal(labeled({ '@type': 'https://schema.org/MadeUpBusinessType', ...NAMED, address: ADDRESS }), false);
  assert.equal(labeled({ '@type': ['Thing', 'schema:Plumber'], ...NAMED }), true, 'in a list of types');
  assert.equal(labeled({ '@type': 'https://example.com/AutoWash', ...NAMED }), false, 'another site\'s address is not removed');
});

test('V156: Corporation and the other Organization subtypes count only with a telephone and an address', () => {
  for (const type of ['Organization', 'Corporation', 'NGO', 'https://schema.org/Corporation']) {
    assert.equal(labeled({ '@type': type, ...NAMED, address: ADDRESS }), true, `${type} with phone and address`);
    assert.equal(labeled({ '@type': type, ...NAMED }), false, `${type} without an address`);
    assert.equal(labeled({ '@type': type, name: NAMED.name, address: ADDRESS }), false, `${type} without a telephone`);
    assert.equal(labeled({ '@type': type, name: NAMED.name }), false, `${type} without either`);
  }
});

test('V156: OnlineStore and OnlineBusiness never count as local', () => {
  for (const type of ['OnlineStore', 'OnlineBusiness', 'schema:OnlineStore', 'https://schema.org/OnlineStore']) {
    assert.equal(labeled({ '@type': type, ...NAMED, address: ADDRESS }), false, type);
    assert.equal(labeled({ '@type': type, ...NAMED }), false, type);
  }
  // Together with a real local type, the local type counts.
  assert.equal(labeled({ '@type': ['OnlineStore', 'Store'], ...NAMED }), true);
});
