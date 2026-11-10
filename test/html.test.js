import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingDetail } from '../server/lib/html.js';

test('listingDetail renders 7 hours rows for lowercase hour keys', () => {
  const listing = {
    id: 'test-business',
    name: 'Test Business',
    category: 'plumbers',
    phone: '(555) 555-0100',
    hours: {
      monday: '8am–5pm',
      tuesday: '8am–5pm',
      wednesday: '8am–5pm',
      thursday: '8am–5pm',
      friday: '8am–5pm',
      saturday: '9am–1pm',
      sunday: 'Closed',
    },
    services: ['Drain cleaning'],
    serviceArea: 'Nashville',
    description: 'We fix pipes.',
    city: 'Nashville',
    state: 'TN',
  };

  const html = listingDetail(listing, '{}');
  const rows = html.match(/<tr>/g) ?? [];
  assert.equal(rows.length, 7);
  assert.ok(html.includes('<th scope="row">Monday</th><td>8am–5pm</td>'));
  assert.ok(html.includes('<th scope="row">Sunday</th><td>Closed</td>'));
});
