/**
 * Tests for the MCP endpoint (POST /mcp).
 *
 * Flow tests run against an in-process server on a temporary DATA_DIR (copies
 * of listings.json and categories.json plus generated published.json,
 * verified.json and drafts.json). The real data/ directory is never written to.
 *
 * Property 16: The MCP endpoint never answers 500
 * Property 17: Search returns exactly the matching listings, capped at 25
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nodeFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createDataStore } from '../server/data.js';
import { createMockNotifier } from '../server/lib/notifier.js';
import { createRateLimiter } from '../server/lib/rate-limiter.js';
import { handleRpc, SEARCH_LIMIT } from '../server/lib/mcp.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
};

// ---- fixtures -----------------------------------------------------------------

/** 30 generated listings; see the search tests for what each token matches. */
function generatedListings() {
  const out = [];
  for (let i = 0; i < 30; i++) {
    const n = String(i).padStart(2, '0');
    out.push({
      id: `pub-${n}`,
      name: `Zebra Works ${n}`,
      category: i < 5 ? 'lawyers' : 'plumbers',
      phone: '(615) 555-9999',
      hours: { monday: '9:00 AM - 5:00 PM' },
      services: i === 7 ? ['Obscuretask repair'] : ['Zebra service'],
      serviceArea: 'Zebra County',
      description: i === 3 ? 'We do Amberglow jobs.' : 'Plain work done right.',
      city: i < 5 ? 'Zzyzx' : 'Qville',
      state: 'TN',
    });
  }
  return out;
}

const envs = [];
const tempDirs = [];

async function makeEnv({ rateLimiter = permissiveLimiter, clock } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-mcp-'));
  tempDirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(generatedListings()));
  await fs.writeFile(path.join(dir, 'verified.json'), JSON.stringify({ 'pub-01': '2025-01-10' }));
  await fs.writeFile(path.join(dir, 'drafts.json'), JSON.stringify([
    {
      id: 'draft-ghost',
      status: 'draft',
      reservedId: 'ghost-draft-plumbing',
      fields: { name: 'Ghost Draft Plumbing', category: 'plumbers', city: 'Ghostville', state: 'TN' },
    },
    {
      id: 'draft-awaiting',
      status: 'pending',
      reservedId: 'awaiting-review-plumbing',
      fields: { name: 'Awaiting Review Plumbing', category: 'plumbers', city: 'Ghostville', state: 'TN' },
    },
  ]));

  const theClock = clock ?? { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const notifier = createMockNotifier();
  let counter = 0;
  const app = createApp({
    dataDir: dir,
    clock: theClock,
    notifier,
    rateLimiter,
    newId: () => `quote-${++counter}`,
    config: { baseUrl: 'http://example.test' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = { dir, clock: theClock, notifier, server, base: `http://127.0.0.1:${server.address().port}` };
  envs.push(env);
  return env;
}

after(async () => {
  for (const env of envs) {
    env.server.closeAllConnections?.();
    await new Promise(resolve => env.server.close(resolve));
  }
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** POST a raw body to /mcp. Returns { res, text, json } (json is undefined if not JSON). */
async function postRaw(env, body) {
  const res = await fetch(env.base + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { res, text, json };
}

let rpcId = 0;
function rpc(env, method, params) {
  const msg = { jsonrpc: '2.0', id: ++rpcId, method };
  if (params !== undefined) msg.params = params;
  return postRaw(env, JSON.stringify(msg));
}

const callTool = (env, name, args) => rpc(env, 'tools/call', { name, arguments: args });

async function readQuotes(env) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, 'quotes.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const main = await makeEnv();

// ---- example flow ---------------------------------------------------------------

test('initialize returns protocol version, tools capability, and server info', async () => {
  const { res, json } = await rpc(main, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(res.status, 200);
  assert.equal(json.jsonrpc, '2.0');
  assert.equal(json.result.protocolVersion, '2025-03-26');
  assert.ok(json.result.capabilities.tools);
  assert.equal(typeof json.result.serverInfo.name, 'string');
});

test('initialize with an unsupported version answers with a supported one', async () => {
  const { json } = await rpc(main, 'initialize', { protocolVersion: '1999-01-01' });
  assert.equal(json.result.protocolVersion, '2025-06-18');
});

test('notifications/initialized returns 202 with an empty body', async () => {
  const { res, text } = await postRaw(main, JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(res.status, 202);
  assert.equal(text, '');
});

test('ping returns an empty result', async () => {
  const { res, json } = await rpc(main, 'ping');
  assert.equal(res.status, 200);
  assert.deepEqual(json.result, {});
});

test('tools/list returns exactly three tools with name, description, and inputSchema', async () => {
  const { json } = await rpc(main, 'tools/list');
  const tools = json.result.tools;
  assert.equal(tools.length, 3);
  assert.deepEqual(tools.map(t => t.name).sort(), ['get_listing', 'request_quote', 'search_listings']);
  for (const t of tools) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 0);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('response echoes the request id', async () => {
  const { json } = await postRaw(main, JSON.stringify({ jsonrpc: '2.0', id: 'abc-1', method: 'ping' }));
  assert.equal(json.id, 'abc-1');
});

// ---- search_listings --------------------------------------------------------------

function searchResult(json) {
  assert.equal(json.error, undefined, JSON.stringify(json.error));
  assert.notEqual(json.result.isError, true);
  return json.result.structuredContent;
}

test('search_listings with no filters caps at 25 and reports the count', async () => {
  const { json } = await callTool(main, 'search_listings', {});
  const out = searchResult(json);
  assert.equal(out.listings.length, SEARCH_LIMIT);
  assert.equal(out.count, 25);
  assert.equal(typeof json.result.content[0].text, 'string');
});

test('search_listings caps a 30-listing match at 25', async () => {
  const { json } = await callTool(main, 'search_listings', { query: 'zebra' });
  const out = searchResult(json);
  assert.equal(out.count, 25);
  assert.equal(out.listings.length, 25);
  assert.ok(out.listings.every(l => l.id.startsWith('pub-')));
});

test('search_listings summaries carry id, name, url and the public fields', async () => {
  const { json } = await callTool(main, 'search_listings', { query: 'amberglow' });
  const out = searchResult(json);
  assert.equal(out.count, 1);
  const l = out.listings[0];
  assert.equal(l.id, 'pub-03');
  assert.equal(l.name, 'Zebra Works 03');
  assert.equal(l.category, 'lawyers');
  assert.equal(l.city, 'Zzyzx');
  assert.equal(l.url, 'http://example.test/listings/pub-03');
});

test('search_listings filters by category and city together', async () => {
  const { json } = await callTool(main, 'search_listings', { category: 'lawyers', city: 'zzyzx' });
  const out = searchResult(json);
  assert.deepEqual(out.listings.map(l => l.id), ['pub-00', 'pub-01', 'pub-02', 'pub-03', 'pub-04']);
});

test('search_listings category filter alone only returns that category', async () => {
  const { json } = await callTool(main, 'search_listings', { category: 'lawyers' });
  const out = searchResult(json);
  assert.ok(out.count >= 5);
  assert.ok(out.listings.every(l => l.category === 'lawyers'));
});

test('search_listings city filter is case-insensitive', async () => {
  const { json } = await callTool(main, 'search_listings', { city: 'ZZYZX' });
  assert.equal(searchResult(json).count, 5);
});

test('search_listings matches the query in description and in services, ignoring case', async () => {
  const d = searchResult((await callTool(main, 'search_listings', { query: 'AMBERGLOW' })).json);
  assert.deepEqual(d.listings.map(l => l.id), ['pub-03']);
  const s = searchResult((await callTool(main, 'search_listings', { query: 'obscuretask' })).json);
  assert.deepEqual(s.listings.map(l => l.id), ['pub-07']);
});

test('search_listings query does not match other fields such as phone', async () => {
  const { json } = await callTool(main, 'search_listings', { query: '9999' });
  assert.equal(searchResult(json).count, 0);
});

test('search_listings with no matches returns an empty list, not an error', async () => {
  const { json } = await callTool(main, 'search_listings', { category: 'lawyers', city: 'Qville' });
  const out = searchResult(json);
  assert.deepEqual(out.listings, []);
  assert.equal(out.count, 0);
});

test('search_listings treats empty strings as not supplied', async () => {
  const { json } = await callTool(main, 'search_listings', { category: '', city: '', query: '' });
  assert.equal(searchResult(json).count, 25);
});

test('search_listings rejects an unknown argument with -32602 naming it', async () => {
  const { json } = await callTool(main, 'search_listings', { bogus: 1 });
  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /bogus/);
});

// ---- get_listing --------------------------------------------------------------------

test('get_listing returns a verified listing with date and hash', async () => {
  const { json } = await callTool(main, 'get_listing', { id: 'pub-01' });
  assert.equal(json.result.isError, undefined);
  const out = json.result.structuredContent;
  assert.equal(out.listing.id, 'pub-01');
  assert.equal(out.verification.verified, true);
  assert.equal(out.verification.verifiedDate, '2025-01-10');
  assert.match(out.verification.hash, /^[0-9a-f]{64}$/);
});

test('get_listing returns verified false for an unconfirmed listing', async () => {
  const { json } = await callTool(main, 'get_listing', { id: 'pub-02' });
  const out = json.result.structuredContent;
  assert.equal(out.listing.id, 'pub-02');
  assert.deepEqual(out.verification, { verified: false, verifiedDate: null, hash: null });
});

test('get_listing finds a seed listing', async () => {
  const seed = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'))
    .find(l => l && !Object.hasOwn(l, '_comment'));
  const { json } = await callTool(main, 'get_listing', { id: seed.id });
  assert.equal(json.result.structuredContent.listing.id, seed.id);
});

test('get_listing with an unknown id is a tool error, not a protocol error', async () => {
  const { res, json } = await callTool(main, 'get_listing', { id: 'no-such-listing' });
  assert.equal(res.status, 200);
  assert.equal(json.error, undefined);
  assert.equal(json.result.isError, true);
  assert.equal(typeof json.result.content[0].text, 'string');
});

test('get_listing without id is -32602 naming id', async () => {
  const { json } = await callTool(main, 'get_listing', {});
  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /\bid\b/);
});

// ---- unpublished drafts -------------------------------------------------------------

test('unpublished drafts are not returned by search or get_listing', async () => {
  const drafts = JSON.parse(await fs.readFile(path.join(main.dir, 'drafts.json'), 'utf8'));
  assert.equal(drafts.length, 2); // a draft and a pending draft really are on disk

  const search = searchResult((await callTool(main, 'search_listings', { query: 'ghost' })).json);
  assert.equal(search.count, 0);
  const awaiting = searchResult((await callTool(main, 'search_listings', { query: 'awaiting review' })).json);
  assert.equal(awaiting.count, 0);
  const byCity = searchResult((await callTool(main, 'search_listings', { city: 'Ghostville' })).json);
  assert.equal(byCity.count, 0);

  for (const id of ['draft-ghost', 'ghost-draft-plumbing', 'draft-awaiting', 'awaiting-review-plumbing']) {
    const { json } = await callTool(main, 'get_listing', { id });
    assert.equal(json.result.isError, true);
  }
});

// ---- request_quote --------------------------------------------------------------------

test('request_quote with valid arguments stores the quote and calls the notifier', async () => {
  const before = (await readQuotes(main)).length;
  const sentBefore = main.notifier.sent.length;
  const { res, json } = await callTool(main, 'request_quote', {
    id: 'pub-01',
    name: 'Pat Smith',
    contact: 'pat@example.com',
    details: 'Need a quote for a leaking pipe.',
  });
  assert.equal(res.status, 200);
  assert.equal(json.error, undefined);
  assert.notEqual(json.result.isError, true);
  const quoteId = json.result.structuredContent.quoteId;
  assert.equal(typeof quoteId, 'string');

  const quotes = await readQuotes(main);
  assert.equal(quotes.length, before + 1);
  const stored = quotes.find(q => q.id === quoteId);
  assert.equal(stored.listingId, 'pub-01');
  assert.equal(stored.name, 'Pat Smith');
  assert.equal(stored.contact, 'pat@example.com');
  assert.equal(stored.notified, true);

  assert.equal(main.notifier.sent.length, sentBefore + 1);
  assert.equal(main.notifier.sent.at(-1).quote.id, quoteId);
});

test('request_quote with an invalid contact is -32602 naming contact and stores nothing', async () => {
  const before = (await readQuotes(main)).length;
  const sentBefore = main.notifier.sent.length;
  const { json } = await callTool(main, 'request_quote', {
    id: 'pub-01',
    name: 'Pat Smith',
    contact: 'not a contact',
    details: 'Need a quote.',
  });
  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /contact/);
  assert.equal((await readQuotes(main)).length, before);
  assert.equal(main.notifier.sent.length, sentBefore);
});

test('request_quote with a missing argument is -32602 naming it and stores nothing', async () => {
  const before = (await readQuotes(main)).length;
  const { json } = await callTool(main, 'request_quote', { id: 'pub-01', name: 'Pat', contact: 'pat@example.com' });
  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /details/);
  assert.equal((await readQuotes(main)).length, before);
});

test('request_quote for an unknown listing is -32602 naming id and stores nothing', async () => {
  const before = (await readQuotes(main)).length;
  const { json } = await callTool(main, 'request_quote', {
    id: 'ghost-draft-plumbing',
    name: 'Pat',
    contact: 'pat@example.com',
    details: 'Hello',
  });
  assert.equal(json.error.code, -32602);
  assert.match(json.error.message, /\bid\b/);
  assert.equal((await readQuotes(main)).length, before);
});

// ---- protocol errors -------------------------------------------------------------------

test('unknown method is -32601', async () => {
  const { res, json } = await rpc(main, 'resources/list');
  assert.equal(res.status, 200);
  assert.equal(json.error.code, -32601);
});

test('unknown tool is -32602', async () => {
  const { json } = await callTool(main, 'delete_everything', {});
  assert.equal(json.error.code, -32602);
});

test('tools/call without a name is -32602', async () => {
  const { json } = await rpc(main, 'tools/call', {});
  assert.equal(json.error.code, -32602);
});

test('invalid JSON is 400 with -32700', async () => {
  const { res, json } = await postRaw(main, '{nope');
  assert.equal(res.status, 400);
  assert.equal(json.jsonrpc, '2.0');
  assert.equal(json.error.code, -32700);
});

test('an empty body is 400 with -32700', async () => {
  const { res, json } = await postRaw(main, '');
  assert.equal(res.status, 400);
  assert.equal(json.error.code, -32700);
});

test('a batch is 400 with -32600', async () => {
  const { res, json } = await postRaw(main, JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]));
  assert.equal(res.status, 400);
  assert.equal(json.error.code, -32600);
});

test('a non-JSON-RPC object is 400 with -32600', async () => {
  const { res, json } = await postRaw(main, JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }));
  assert.equal(res.status, 400);
  assert.equal(json.error.code, -32600);
});

test('GET and DELETE are 405 with Allow: POST', async () => {
  for (const method of ['GET', 'DELETE']) {
    const res = await fetch(main.base + '/mcp', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'POST', method);
    await res.text();
  }
});

test('a body just over 64 KiB is 413', async () => {
  const body = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"' + 'a'.repeat(70000) + '"}}';
  const { res, json } = await postRaw(main, body);
  assert.equal(res.status, 413);
  assert.equal(json.jsonrpc, '2.0');
});

test('the 120th request in a minute succeeds and the 121st is 429 with Retry-After', async () => {
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const env = await makeEnv({ rateLimiter: createRateLimiter({ clock }), clock });
  const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

  for (let i = 0; i < 120; i++) {
    const { res } = await postRaw(env, ping);
    assert.equal(res.status, 200, `request ${i + 1}`);
  }
  const { res, json } = await postRaw(env, ping);
  assert.equal(res.status, 429);
  const retry = Number(res.headers.get('retry-after'));
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 60, `Retry-After was ${retry}`);
  assert.equal(json.jsonrpc, '2.0');

  clock.t += 61 * 1000;
  const after = await postRaw(env, ping);
  assert.equal(after.res.status, 200);
});

// ---- Property 16 -------------------------------------------------------------------------

const KNOWN_METHODS = ['initialize', 'ping', 'tools/list', 'tools/call'];
const TOOL_NAMES = ['search_listings', 'get_listing', 'request_quote'];

const jsonAny = fc.json().map(s => JSON.parse(s));

const toolCallParams = fc.record(
  {
    name: fc.oneof(fc.constantFrom(...TOOL_NAMES), fc.string()),
    arguments: fc.oneof(
      jsonAny,
      fc.record({ id: fc.string(), name: fc.string(), contact: fc.string(), details: fc.string() }, { requiredKeys: [] }),
      fc.record({ category: fc.string(), city: fc.string(), query: fc.string() }, { requiredKeys: [] }),
    ),
  },
  { requiredKeys: ['name'] },
);

const methodArb = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...KNOWN_METHODS, 'notifications/initialized') },
  { weight: 1, arbitrary: fc.string() },
);

const idArb = fc.oneof(
  { weight: 4, arbitrary: fc.integer() },
  { weight: 2, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.constant(undefined) },
);

const envelopeArb = fc.record({
  jsonrpc: fc.oneof({ weight: 8, arbitrary: fc.constant('2.0') }, { weight: 1, arbitrary: fc.string() }),
  method: methodArb,
  id: idArb,
  params: fc.oneof(fc.constant(undefined), jsonAny, toolCallParams),
});

/** Checks common to every response: status below 500, JSON-RPC body unless 202. */
function checkEnvelope({ res, text, json }) {
  assert.ok(res.status < 500, `status ${res.status}: ${text.slice(0, 200)}`);
  if (text === '') {
    assert.equal(res.status, 202);
  } else {
    assert.ok(json !== undefined, `non-JSON body with status ${res.status}: ${text.slice(0, 200)}`);
    assert.equal(json.jsonrpc, '2.0');
  }
}

function parsesAsJson(bytes) {
  try {
    JSON.parse(Buffer.from(bytes).toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

test('Property 16: arbitrary bytes never produce a 500, and non-JSON gives -32700', async () => {
  // **Validates: Requirements 5.8, 5.9, 5.10, 5.11, 5.12, 5.16**
  await fc.assert(
    fc.asyncProperty(fc.uint8Array({ maxLength: 300 }), async bytes => {
      const r = await postRaw(main, bytes);
      checkEnvelope(r);
      if (!parsesAsJson(bytes)) {
        assert.equal(r.res.status, 400);
        assert.equal(r.json.error.code, -32700);
      }
    }),
    { numRuns: 50 },
  );
});

test('Property 16: arbitrary JSON values never produce a 500', async () => {
  // **Validates: Requirements 5.8, 5.9, 5.10, 5.11, 5.12, 5.16**
  await fc.assert(
    fc.asyncProperty(fc.json(), async text => {
      checkEnvelope(await postRaw(main, text));
    }),
    { numRuns: 50 },
  );
});

test('Property 16: JSON-RPC envelopes never produce a 500; unknown methods give -32601', async () => {
  // **Validates: Requirements 5.8, 5.9, 5.10, 5.11, 5.12, 5.16**
  await fc.assert(
    fc.asyncProperty(envelopeArb, async env => {
      const r = await postRaw(main, JSON.stringify(env));
      checkEnvelope(r);
      const validId = typeof env.id === 'string' || typeof env.id === 'number';
      if (env.jsonrpc === '2.0' && validId && !KNOWN_METHODS.includes(env.method)) {
        assert.equal(r.res.status, 200);
        assert.equal(r.json.error.code, -32601);
      }
    }),
    { numRuns: 50 },
  );
});

// ---- Property 17 -------------------------------------------------------------------------

const CATEGORY_SLUGS = ['plumbers', 'electricians', 'restaurants', 'auto-repair', 'hair-salons', 'lawyers'];
const WORDS = ['pipe', 'Leak', 'fix', 'oak', 'Main', 'heat', 'Rooter', 'amber'];

const wordArb = fc.constantFrom(...WORDS);
const textArb = fc.array(wordArb, { minLength: 1, maxLength: 4 }).map(a => a.join(' '));

const listingArb = fc.record({
  name: textArb,
  category: fc.constantFrom(...CATEGORY_SLUGS),
  city: fc.constantFrom('Springfield', 'springfield', 'Nashville', 'NASHVILLE', 'Memphis'),
  description: textArb,
  services: fc.array(textArb, { maxLength: 3 }),
});

const listingSetArb = fc
  .array(listingArb, { maxLength: 45 })
  .map(arr => arr.map((l, i) => ({
    id: `g-${i}`,
    ...l,
    phone: '(615) 555-0100',
    hours: {},
    serviceArea: 'Metro',
    state: 'TN',
  })));

const filtersArb = fc.record({
  category: fc.option(fc.constantFrom(...CATEGORY_SLUGS, ''), { nil: undefined }),
  city: fc.option(fc.constantFrom('springfield', 'NASHVILLE', 'Memphis', 'Nowhere', ''), { nil: undefined }),
  query: fc.option(
    fc.oneof(
      wordArb,
      wordArb.map(w => w.toUpperCase()),
      wordArb.map(w => w.slice(0, 3)),
      fc.constantFrom('', 'zzzz', 'o'),
    ),
    { nil: undefined },
  ),
});

/** Naive reference filter, written independently of the store. */
function oracle(listings, { category, city, query }) {
  return listings.filter(l => {
    if (category && l.category !== category) return false;
    if (city && l.city.toLowerCase() !== city.toLowerCase()) return false;
    if (query) {
      const q = query.toLowerCase();
      const haystacks = [l.name, l.description, ...l.services].map(s => s.toLowerCase());
      if (!haystacks.some(s => s.includes(q))) return false;
    }
    return true;
  });
}

const p17Dir = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'fap-mcp-p17-'));
tempDirs.push(p17Dir);

test('Property 17: search returns exactly the matching listings in store order, capped at 25', async () => {
  // **Validates: Requirements 5.4, 5.5, 5.17, 5.18**
  await fc.assert(
    fc.asyncProperty(listingSetArb, filtersArb, async (listings, filters) => {
      nodeFs.writeFileSync(path.join(p17Dir, 'listings.json'), JSON.stringify(listings));
      const store = createDataStore({ dataDir: p17Dir });
      const ctx = { store, config: { baseUrl: 'http://example.test' } };

      const args = {};
      for (const key of ['category', 'city', 'query']) {
        if (filters[key] !== undefined) args[key] = filters[key];
      }
      const r = await handleRpc(
        ctx,
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_listings', arguments: args } },
        '127.0.0.1',
      );
      assert.equal(r.status, 200);
      assert.equal(r.body.error, undefined);
      const out = r.body.result.structuredContent;

      const expected = oracle(listings, filters).slice(0, 25).map(l => l.id);
      assert.deepEqual(out.listings.map(l => l.id), expected);
      assert.equal(out.count, out.listings.length);
      assert.ok(out.count <= 25);

      const byId = new Map(listings.map(l => [l.id, l]));
      for (const summary of out.listings) {
        const [match] = oracle([byId.get(summary.id)], filters);
        assert.ok(match, `returned ${summary.id} does not satisfy the filters`);
      }
    }),
    { numRuns: 100 },
  );
});

test('request_quote success message is the new sentence with the listing phone', async () => {
  const { json } = await callTool(main, 'request_quote', {
    id: 'pub-01',
    name: 'Pat Smith',
    contact: 'pat@example.com',
    details: 'Need a quote for a leaking pipe.',
  });
  assert.equal(json.error, undefined);
  assert.notEqual(json.result.isError, true);
  assert.equal(
    json.result.structuredContent.message,
    "Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at (615) 555-9999.",
  );
  assert.ok(!JSON.stringify(json).includes('will contact you'));
});

// ---- CORS preflight -------------------------------------------------------------

const headerList = value => (value ?? '').split(',').map(s => s.trim().toLowerCase());

test('OPTIONS /mcp returns 204 with an empty body and CORS headers', async () => {
  const res = await fetch(main.base + '/mcp', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(await res.text(), '');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const allowHeaders = headerList(res.headers.get('access-control-allow-headers'));
  for (const h of ['content-type', 'accept', 'mcp-session-id']) {
    assert.ok(allowHeaders.includes(h), `missing allowed header ${h}`);
  }
  const methods = (res.headers.get('access-control-allow-methods') ?? '').split(',').map(s => s.trim().toUpperCase());
  assert.ok(methods.includes('POST'));
  assert.ok(methods.includes('OPTIONS'));
});

test('OPTIONS /mcp is not rate limited', async () => {
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  const env = await makeEnv({ rateLimiter: createRateLimiter({ clock }), clock });
  const ping = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
  for (let i = 0; i < 120; i++) {
    assert.equal((await postRaw(env, ping)).res.status, 200);
  }
  const limited = await postRaw(env, ping);
  assert.equal(limited.res.status, 429);
  assert.equal(limited.res.headers.get('access-control-allow-origin'), '*');
  const pre = await fetch(env.base + '/mcp', { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
});

test('POST success, 413 and GET 405 replies carry access-control-allow-origin *', async () => {
  const ok = await postRaw(main, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
  assert.equal(ok.res.status, 200);
  assert.equal(ok.res.headers.get('access-control-allow-origin'), '*');

  const big = await postRaw(main, 'x'.repeat(70000));
  assert.equal(big.res.status, 413);
  assert.equal(big.res.headers.get('access-control-allow-origin'), '*');

  const get405 = await fetch(main.base + '/mcp');
  assert.equal(get405.status, 405);
  assert.equal(get405.headers.get('allow'), 'POST');
  assert.equal(get405.headers.get('access-control-allow-origin'), '*');
});
