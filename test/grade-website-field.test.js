/**
 * The website validator and the optional `website` listing field (Feature C, task F8; Requirement 21).
 * Pure functions plus one publish through the store and the public output. No network: nothing is looked up.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { normalizeWebsite, normalizeFields, validateFields, MAX_WEBSITE } from '../server/lib/listing-fields.js';
import { publicListing } from '../server/lib/public-listing.js';
import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const TOKEN = 'website-field-token';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const GOOD_LISTING = {
  name: 'Zephyr Plumbing', category: 'plumbers', phone: '615-555-0101', services: ['Leak repair'],
  serviceArea: 'Nashville', description: 'We fix pipes.', city: 'Nashville', state: 'TN',
};

// ---- the validator ----------------------------------------------------------------------------------

test('F8: valid websites come back as https://<host><path>', () => {
  const cases = [
    ['https://example.com', 'https://example.com/'],
    ['https://example.com/', 'https://example.com/'],
    ['https://www.zephyrplumbing.com/', 'https://www.zephyrplumbing.com/'],
    ['https://zephyr-plumbing.co.uk/about/team', 'https://zephyr-plumbing.co.uk/about/team'],
    ['  https://Example.COM/Menu  ', 'https://example.com/Menu'],
    ['HTTPS://example.com/', 'https://example.com/'],
    ['https://example.com/a%20b', 'https://example.com/a%20b'],
  ];
  for (const [input, output] of cases) assert.equal(normalizeWebsite(input), output, input);
});

test('F8: the query string and the # part are dropped; a default :443 and one trailing dot are removed', () => {
  assert.equal(normalizeWebsite('https://example.com/menu?utm_source=x&token=secret#top'), 'https://example.com/menu');
  assert.equal(normalizeWebsite('https://example.com/?login=me'), 'https://example.com/');
  assert.equal(normalizeWebsite('https://example.com:443/'), 'https://example.com/');
  assert.equal(normalizeWebsite('https://example.com./'), 'https://example.com/');
  assert.equal(normalizeWebsite('https://example.com.'), 'https://example.com/');
});

test('F8: refused: http, IP addresses, localhost, user names, ports, names with no dot, and anything too long', () => {
  const refused = [
    'http://example.com/',
    'ftp://example.com/',
    'javascript:alert(1)',
    'https:example.com', // not written out in full
    'https:/example.com',
    'example.com',
    'https://203.0.113.7/',
    'https://127.0.0.1/',
    'https://127.0.0.1./',
    'https://10.0.0.1/',
    'https://0x7f.1/', // an IPv4 address written another way
    'https://2130706433/',
    'https://[::1]/',
    'https://[2001:db8::1]/',
    'https://localhost/',
    'https://localhost./',
    'https://shop.localhost/',
    'https://user:pass@example.com/',
    'https://user@example.com/',
    'https://example.com:8443/',
    'https://example.com:80/',
    'https://intranet/',
    'https://example..com/',
    'https://example.com../',
    `https://example.com/${'a'.repeat(MAX_WEBSITE)}`,
    `https://example.com/${'a'.repeat(700)}`,
    'https://exa mple.com/',
    'https://example.com/\nhttps://evil.example/',
    '',
    '   ',
  ];
  for (const value of refused) assert.equal(normalizeWebsite(value), '', value);
  for (const notText of [undefined, null, 42, {}, ['https://example.com/'], true]) {
    assert.equal(normalizeWebsite(notText), '', String(notText));
  }
  assert.equal(MAX_WEBSITE, 300);
  // Just inside the limit.
  const fits = `https://example.com/${'a'.repeat(MAX_WEBSITE - 'https://example.com/'.length)}`;
  assert.equal(fits.length, 300);
  assert.equal(normalizeWebsite(fits), fits);
  // A long query string does not count against the limit, since it is dropped.
  assert.equal(normalizeWebsite(`https://example.com/?q=${'x'.repeat(400)}`), 'https://example.com/');
});

test('F8: the validator never throws, and its output is a fixed point', () => {
  fc.assert(fc.property(fc.oneof(fc.string(), fc.fullUnicodeString(), fc.webUrl(), fc.anything()), value => {
    const out = normalizeWebsite(value);
    assert.equal(typeof out, 'string');
    if (out !== '') {
      assert.ok(out.startsWith('https://'));
      assert.ok(out.length <= MAX_WEBSITE);
      assert.equal(out.includes('?'), false);
      assert.equal(out.includes('#'), false);
      assert.equal(normalizeWebsite(out), out);
    }
  }), { numRuns: 500 });
});

// ---- the listing field -------------------------------------------------------------------------------------

test('F8: validateFields keeps a valid website and leaves an invalid one out; it is never a missing field', () => {
  const kept = validateFields({ ...GOOD_LISTING, website: 'https://zephyrplumbing.com/?ref=x' }, categories);
  assert.equal(kept.fields.website, 'https://zephyrplumbing.com/');
  assert.deepEqual(kept.missingFields, []);
  for (const bad of ['http://zephyrplumbing.com/', 'https://127.0.0.1/', 'zephyr', '', 42, null]) {
    const out = validateFields({ ...GOOD_LISTING, website: bad }, categories);
    assert.equal(Object.hasOwn(out.fields, 'website'), false, String(bad));
    assert.deepEqual(out.missingFields, []);
  }
  assert.equal(validateFields({}, categories).missingFields.includes('website'), false);
});

test('F8: the result has no website key when the input has none or an invalid one, and normalizing again changes nothing', () => {
  const empty = normalizeFields({}, categories);
  assert.equal(Object.hasOwn(empty, 'website'), false);
  for (const key of ['name', 'category', 'phone', 'hours', 'services', 'serviceArea', 'description', 'city', 'state', 'address', 'ownerEmail']) {
    assert.ok(Object.hasOwn(empty, key), key);
  }
  const once = validateFields({ ...GOOD_LISTING, website: 'https://Example.com./menu#x' }, categories);
  assert.equal(once.fields.website, 'https://example.com/menu');
  assert.deepEqual(validateFields(once.fields, categories).fields, once.fields);
  const proto = normalizeFields(JSON.parse('{"__proto__": {"website": "https://example.com/"}}'), categories);
  assert.equal(Object.hasOwn(proto, 'website'), false);
  assert.equal(({}).website, undefined);
});

// ---- the public output re-checks the stored value -----------------------------------------------------------

test('F8: publicListing returns a stored website only in its clean form, and drops a bad one', () => {
  assert.equal(publicListing({ id: 'a', website: 'https://Example.com/menu?token=1' }).website, 'https://example.com/menu');
  for (const bad of ['javascript:alert(1)', 'http://example.com/', 'https://10.0.0.1/', 'https://user:pass@example.com/', 7]) {
    assert.equal(Object.hasOwn(publicListing({ id: 'a', website: bad }), 'website'), false, String(bad));
  }
  assert.deepEqual(publicListing({ id: 'a', name: 'A' }), { id: 'a', name: 'A' });
});

// ---- publishing -----------------------------------------------------------------------------------------------

async function startEnv(published = []) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-website-field-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  if (published.length > 0) await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  const app = createApp({ dataDir: dir, config: { adminToken: TOKEN, baseUrl: 'http://example.test', demoMode: true, production: false } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { dir, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

async function pendingDraft(env, fields) {
  const id = `draft-${Math.random().toString(36).slice(2, 10)}`;
  const { fields: clean, missingFields } = validateFields(fields, categories);
  await env.ctx.store.collection('drafts').append({ id, status: 'pending', provider: 'manual', fields: clean, missingFields, createdAt: new Date().toISOString() });
  await env.ctx.store.collection('pending').append({ id, draftId: id, submittedAt: new Date().toISOString(), status: 'pending' });
  return id;
}

test('F8: an approved Draft publishes its website, and one without gains no key', async () => {
  const env = await startEnv();
  const withSite = await pendingDraft(env, { ...GOOD_LISTING, website: 'https://zephyrplumbing.com/' });
  const without = await pendingDraft(env, { ...GOOD_LISTING, name: 'Aster Plumbing', phone: '615-555-0102' });
  for (const id of [withSite, without]) {
    const res = await fetch(`${env.base}/admin/pending/${id}/approve`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200, await res.text());
  }
  const zephyr = env.ctx.store.getListings().find(l => l.name === 'Zephyr Plumbing');
  const aster = env.ctx.store.getListings().find(l => l.name === 'Aster Plumbing');
  assert.equal(zephyr.website, 'https://zephyrplumbing.com/');
  assert.equal(Object.hasOwn(aster, 'website'), false);
  const published = JSON.parse(await fs.readFile(path.join(env.dir, 'published.json'), 'utf8'));
  assert.equal(published.find(l => l.name === 'Aster Plumbing').website, undefined);

  const api = await (await fetch(`${env.base}/api/listings/${zephyr.id}`)).json();
  assert.equal(JSON.stringify(api).includes('https://zephyrplumbing.com/'), true);
});

test('F8: a hand-edited bad website never comes out of the JSON API or MCP', async () => {
  const listing = {
    id: 'quillon-plumbing-nashville', name: 'Quillon Plumbing', category: 'plumbers', phone: '(615) 555-0177',
    services: ['Leak repair'], serviceArea: 'Nashville', description: 'We fix pipes.', city: 'Nashville', state: 'TN',
    website: 'javascript:alert(1)',
  };
  const env = await startEnv([listing, { ...listing, id: 'quillon-two-nashville', name: 'Quillon Two', phone: '(615) 555-0178', website: 'https://10.0.0.5/admin' }]);
  const api = await (await fetch(`${env.base}/api/listings/${listing.id}`)).text();
  assert.ok(api.includes('Quillon Plumbing'));
  assert.equal(api.includes('javascript:'), false);
  assert.equal(api.includes('"website"'), false);

  const rpc = (name, args) => fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  }).then(r => r.text());
  for (const out of [await rpc('get_listing', { id: 'quillon-two-nashville' }), await rpc('search_listings', { query: 'Quillon' })]) {
    assert.ok(out.includes('Quillon'));
    assert.equal(out.includes('javascript:'), false);
    assert.equal(out.includes('10.0.0.5'), false);
  }
});
