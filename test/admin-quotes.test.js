/**
 * Tests for the private ownerEmail field and GET /admin/quotes.
 *
 * ownerEmail is stored on a listing but must never reach a public surface and
 * must not change the owner-confirmed hash. /admin/quotes is token-protected
 * and lists saved quotes newest first. Every environment uses a temporary
 * DATA_DIR (copies of listings.json and categories.json plus seeded files);
 * the real data/ directory is never written to.
 *
 * Property: ownerEmail never appears on a public surface
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { escapeHtml } from '../server/lib/html.js';
import { normalizeFields, validateFields } from '../server/lib/listing-fields.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const TOKEN = 'admin-quotes-test-token';
const BASE_URL = 'http://example.test';
const VERIFIED_DATE = '2025-01-10';
const CREATED_AT = '2025-01-14T00:00:00.000Z';

const seedListings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'))
  .filter(l => l && typeof l === 'object' && typeof l.id === 'string');
const SEED_LISTING = seedListings[0];
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

// ---- fixtures -------------------------------------------------------------------

const PUB_ID = 'quillfeather-plumbing';

/** A complete published listing (own id, so it never collides with seed data). */
function publishedListing(ownerEmail) {
  const listing = {
    id: PUB_ID,
    name: 'Quillfeather Plumbing',
    category: 'plumbers',
    phone: '(615) 555-0142',
    services: ['Leak repair', 'Drain cleaning'],
    serviceArea: 'Greater Springfield',
    description: 'We fix pipes and leaks.',
    city: 'Springfield',
    state: 'TN',
  };
  if (ownerEmail !== undefined) listing.ownerEmail = ownerEmail;
  return listing;
}

function draftEntry(id, fields, status) {
  return {
    id,
    status,
    provider: 'mock',
    fields: {
      name: 'Zephyrine Plumbing',
      category: 'plumbers',
      phone: '(615) 555-0101',
      services: ['Leak repair'],
      serviceArea: 'Greater Springfield',
      description: 'We fix pipes and leaks.',
      city: 'Springfield',
      state: 'TN',
      ...fields,
    },
    missingFields: [],
    createdAt: CREATED_AT,
  };
}

function quoteEntry(id, name, createdAt, details = 'Need a repair.') {
  return {
    id,
    listingId: SEED_LISTING.id,
    name,
    contact: 'caller@example.test',
    details,
    createdAt,
    notified: false,
  };
}

// ---- environment ------------------------------------------------------------------

const envs = new Set();

/**
 * @param {{ quotes?: object[], published?: object[], verified?: object,
 *   drafts?: object[], pending?: object[], adminToken?: string }} [opts]
 *   Pass `adminToken: undefined` explicitly to run with no token configured.
 */
async function makeEnv(opts = {}) {
  const { quotes, published, verified, drafts, pending } = opts;
  const adminToken = 'adminToken' in opts ? opts.adminToken : TOKEN;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-admin-quotes-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const seedFile = (name, value) => value === undefined
    ? undefined
    : fs.writeFile(path.join(dir, name), JSON.stringify(value));
  await Promise.all([
    seedFile('quotes.json', quotes),
    seedFile('published.json', published),
    seedFile('verified.json', verified),
    seedFile('drafts.json', drafts),
    seedFile('pending.json', pending),
  ]);

  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const app = createApp({
    dataDir: dir,
    clock,
    rateLimiter: permissiveLimiter,
    config: { adminToken, baseUrl: BASE_URL },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = {
    dir,
    app,
    store: app.locals.ctx.store,
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    closed: false,
    async close() {
      if (env.closed) return;
      env.closed = true;
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
      await fs.rm(dir, { recursive: true, force: true });
      envs.delete(env);
    },
  };
  envs.add(env);
  return env;
}

after(async () => {
  for (const env of [...envs]) await env.close();
});

// ---- requests ---------------------------------------------------------------------

const bearer = token => (token === undefined ? {} : { authorization: `Bearer ${token}` });
const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });
// An explicit `undefined` token means "send no Authorization header"; omit it for the valid token.
const adminGet = (env, p, ...rest) => get(env, p, bearer(rest.length > 0 ? rest[0] : TOKEN));

let rpcId = 0;
async function callTool(env, name, args) {
  const res = await fetch(env.base + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args },
    }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.error, undefined, JSON.stringify(json.error));
  return json.result;
}

async function verifyHash(env, id) {
  const res = await get(env, `/api/verify/${id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.verified, true);
  assert.match(body.hash, /^[0-9a-f]{64}$/);
  return body.hash;
}

// ---- GET /admin/quotes: auth ------------------------------------------------------------

test('GET /admin/quotes without a token is 401 with WWW-Authenticate', async () => {
  const env = await makeEnv();
  const res = await adminGet(env, '/admin/quotes', undefined);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') ?? '', /^Bearer/);
  await res.arrayBuffer();
});

test('GET /admin/quotes with a wrong token is 401 with WWW-Authenticate', async () => {
  const env = await makeEnv({ quotes: [quoteEntry('q1', 'Secret Sam', CREATED_AT)] });
  const res = await adminGet(env, '/admin/quotes', 'not-the-token');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') ?? '', /^Bearer/);
  const text = await res.text();
  assert.ok(!text.includes('Secret Sam'), 'quote data must not leak on 401');
});

test('GET /admin/quotes is 403 when no admin token is configured', async () => {
  const env = await makeEnv({ adminToken: undefined, quotes: [quoteEntry('q1', 'Secret Sam', CREATED_AT)] });
  for (const token of [undefined, TOKEN]) {
    const res = await adminGet(env, '/admin/quotes', token);
    assert.equal(res.status, 403);
    const text = await res.text();
    assert.ok(!text.includes('Secret Sam'));
  }
});

// ---- GET /admin/quotes: content ------------------------------------------------------------

test('GET /admin/quotes lists saved quotes newest first with the listing name', async () => {
  // Seeded out of order on purpose.
  const env = await makeEnv({
    quotes: [
      quoteEntry('q-middle', 'Middle Mia', '2025-01-12T10:00:00.000Z'),
      quoteEntry('q-oldest', 'Oldest Olga', '2025-01-05T10:00:00.000Z'),
      quoteEntry('q-newest', 'Newest Nora', '2025-01-14T10:00:00.000Z'),
    ],
  });
  const res = await adminGet(env, '/admin/quotes');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /html/);
  const html = await res.text();

  const pos = key => {
    const i = html.indexOf(key);
    assert.ok(i !== -1, `${key} should be on the page`);
    return i;
  };
  assert.ok(pos('Newest Nora') < pos('Middle Mia'), 'newest before middle');
  assert.ok(pos('Middle Mia') < pos('Oldest Olga'), 'middle before oldest');
  assert.ok(pos('q-newest') < pos('q-middle'), 'ids: newest before middle');
  assert.ok(pos('q-middle') < pos('q-oldest'), 'ids: middle before oldest');

  assert.ok(html.includes(escapeHtml(SEED_LISTING.name)), 'shows the listing name');
  assert.ok(!html.includes('No quote requests yet.'));
});

test('GET /admin/quotes escapes stored values', async () => {
  const env = await makeEnv({
    quotes: [quoteEntry('q-evil', '<b id="x">', CREATED_AT, '<script>alert(1)</script>')],
  });
  const res = await adminGet(env, '/admin/quotes');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(!html.includes('<b id="x">'), 'raw name markup must not appear');
  assert.ok(!html.includes('<script'), 'no script element may appear');
  assert.ok(html.includes(escapeHtml('<b id="x">')));
  assert.ok(html.includes(escapeHtml('<script>alert(1)</script>')));
});

test('GET /admin/quotes sends no-store and noindex headers', async () => {
  const env = await makeEnv({ quotes: [quoteEntry('q1', 'Header Hal', CREATED_AT)] });
  const res = await adminGet(env, '/admin/quotes');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
  await res.arrayBuffer();
});

test('GET /admin/quotes shows the empty state when nothing is saved', async () => {
  const env = await makeEnv(); // no quotes.json at all
  const res = await adminGet(env, '/admin/quotes');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('No quote requests yet.'));
});

// ---- ownerEmail: hash ---------------------------------------------------------------------------

test('changing ownerEmail does not change the verification hash; changing name does', async () => {
  const env = await makeEnv({
    published: [publishedListing('owner-a@example.com')],
    verified: { [PUB_ID]: VERIFIED_DATE },
  });
  const before = await verifyHash(env, PUB_ID);

  const updated = await env.store.updatePublished(PUB_ID, { ownerEmail: 'owner-b@example.org' });
  assert.equal(updated.ownerEmail, 'owner-b@example.org');
  assert.equal(await verifyHash(env, PUB_ID), before, 'ownerEmail must not affect the hash');

  await env.store.updatePublished(PUB_ID, { name: 'Quillfeather Plumbing and Heating' });
  assert.notEqual(await verifyHash(env, PUB_ID), before, 'a public field change must change the hash');
});

// ---- ownerEmail: private surfaces -------------------------------------------------------------------

test('ownerEmail is shown on GET /admin/pending (private)', async () => {
  const email = 'private-owner@example.com';
  const env = await makeEnv({
    drafts: [draftEntry('dp1', { ownerEmail: email }, 'pending')],
    pending: [{ id: 'dp1', draftId: 'dp1', submittedAt: CREATED_AT, status: 'pending' }],
  });
  const res = await adminGet(env, '/admin/pending');
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes(email));
});

test('the draft form shows an editable email input', async () => {
  const email = 'draft-owner@example.com';
  const env = await makeEnv({ drafts: [draftEntry('df1', { ownerEmail: email }, 'draft')] });
  const res = await get(env, '/rise/drafts/df1');
  assert.equal(res.status, 200);
  const html = await res.text();
  const input = html.match(/<input[^>]*name="ownerEmail"[^>]*>/);
  assert.ok(input, 'ownerEmail input should be present');
  assert.match(input[0], /type="email"/);
  assert.ok(input[0].includes(`value="${email}"`), 'input should carry the saved email');
  assert.ok(!/readonly|disabled/.test(input[0]), 'input must be editable');
});

// ---- ownerEmail: normalization -----------------------------------------------------------------------

test('ownerEmail normalization accepts a plain address and rejects malformed values', () => {
  const emailOf = value => normalizeFields({ ownerEmail: value }, categories).ownerEmail;

  assert.equal(emailOf('a@b.co'), 'a@b.co');
  for (const bad of ['a@b', 'a b@c.co', '@c.co', 'a@@c.co', '', undefined, null, 42, true, {}, ['a@b.co']]) {
    assert.equal(emailOf(bad), '', `${JSON.stringify(bad)} should be rejected`);
  }
  assert.equal(normalizeFields({}, categories).ownerEmail, '', 'absent email is empty');
});

test('ownerEmail is optional: never listed in missingFields', () => {
  for (const value of ['', 'a@b', 'a@b.co', 42, undefined]) {
    const { missingFields } = validateFields({ ownerEmail: value }, categories);
    assert.ok(!missingFields.includes('ownerEmail'), `${JSON.stringify(value)} must not be a missing field`);
  }
  const { fields } = validateFields({ ownerEmail: 'a@b' }, categories);
  assert.equal(fields.ownerEmail, '');
});

// ---- ownerEmail: never public (property) -------------------------------------------------------------------

const ALNUM = [...'abcdefghijklmnopqrstuvwxyz0123456789'];
const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];
const emailArb = fc.tuple(
  fc.stringOf(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 12 }),
  fc.stringOf(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 10 }),
  fc.stringOf(fc.constantFrom(...LETTERS), { minLength: 2, maxLength: 4 }),
).map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

test('Property: ownerEmail never appears on any public surface', async () => {
  const env = await makeEnv({
    published: [publishedListing('start@example.com')],
    verified: { [PUB_ID]: VERIFIED_DATE },
  });

  await fc.assert(
    fc.asyncProperty(emailArb, async email => {
      await env.store.updatePublished(PUB_ID, { ownerEmail: email });
      // Control: the email really is stored on the listing.
      assert.equal(env.store.findById(PUB_ID).ownerEmail, email);

      const surfaces = [];
      const fetchText = async p => {
        const res = await get(env, p);
        assert.equal(res.status, 200, `${p} should be 200`);
        return res.text();
      };

      const page = await fetchText(`/listings/${PUB_ID}`);
      surfaces.push(['listing page', page]);
      const ld = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      assert.ok(ld, 'page should have a JSON-LD block');
      surfaces.push(['JSON-LD', ld[1]]);

      surfaces.push(['/api/listings/:id', await fetchText(`/api/listings/${PUB_ID}`)]);
      surfaces.push(['/llms.txt', await fetchText('/llms.txt')]);
      surfaces.push(['/sitemap.xml', await fetchText('/sitemap.xml')]);
      surfaces.push(['/seance/:id', await fetchText(`/seance/${PUB_ID}`)]);
      surfaces.push(['/', await fetchText('/')]);

      const got = await callTool(env, 'get_listing', { id: PUB_ID });
      assert.notEqual(got.isError, true);
      surfaces.push(['MCP get_listing', JSON.stringify(got)]);

      const found = await callTool(env, 'search_listings', { query: 'quillfeather' });
      assert.notEqual(found.isError, true);
      assert.ok(found.structuredContent.listings.some(l => l.id === PUB_ID), 'search should find the listing');
      surfaces.push(['MCP search_listings', JSON.stringify(found)]);

      for (const [label, text] of surfaces) {
        assert.ok(!text.includes(email), `${email} leaked on ${label}`);
      }
    }),
    { numRuns: 15 },
  );
});
