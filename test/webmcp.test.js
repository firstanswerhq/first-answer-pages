/**
 * Tests for the WebMCP script (public/js/webmcp.js) using stubbed globals,
 * plus two checks against the real server (script tag, quote form, static file).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerWebMcp } from '../public/js/webmcp.js';
import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const PAGE_ID = 'copper-kettle-plumbing-springfield';
const PAGE_NAME = 'Copper Kettle Plumbing';

// ---- stub helpers -----------------------------------------------------------

function makeConsole() {
  const calls = [];
  const rec = level => (...args) => calls.push({ level, args });
  return { calls, log: rec('log'), warn: rec('warn'), error: rec('error'), info: rec('info') };
}

function makeDocument(extra = {}) {
  return {
    querySelector(selector) {
      if (selector !== '[data-listing-id]') return null;
      return { dataset: { listingId: PAGE_ID, listingName: PAGE_NAME } };
    },
    ...extra,
  };
}

/** A model context that records registrations. */
function makeContext() {
  const tools = [];
  return { tools, registerTool(tool) { tools.push(tool); } };
}

function makeFetch(respond) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  fn.calls = calls;
  return fn;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup({ confirm = () => true, respond = () => jsonResponse(201, { quoteId: 'q-1' }) } = {}) {
  const context = makeContext();
  const fetch = makeFetch(respond);
  const console = makeConsole();
  const document = makeDocument();
  const confirmCalls = [];
  const window = { confirm: msg => { confirmCalls.push(msg); return confirm(msg); } };
  registerWebMcp({ navigator: { modelContext: context }, document, window, fetch, console });
  const byName = Object.fromEntries(context.tools.map(t => [t.name, t]));
  return { context, fetch, console, document, window, confirmCalls, byName };
}

const VALID_INPUT = { name: 'Pat Doe', contact: 'pat@example.com', details: 'Need a leaking sink fixed.' };

// ---- import and absent context ---------------------------------------------

test('importing the module has no side effects in Node', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof registerWebMcp, 'function');
});

test('does nothing when modelContext is absent', () => {
  const fetch = makeFetch(() => jsonResponse(200, {}));
  const console = makeConsole();
  assert.doesNotThrow(() => registerWebMcp({
    navigator: {}, document: makeDocument(), window: {}, fetch, console,
  }));
  assert.equal(fetch.calls.length, 0);
  assert.equal(console.calls.length, 0);
});

test('does nothing when called with no environment at all', () => {
  assert.doesNotThrow(() => registerWebMcp());
});

test('falls back to document.modelContext when navigator.modelContext is absent', () => {
  const context = makeContext();
  registerWebMcp({
    navigator: {},
    document: makeDocument({ modelContext: context }),
    window: {},
    fetch: makeFetch(() => jsonResponse(200, {})),
    console: makeConsole(),
  });
  assert.deepEqual(context.tools.map(t => t.name).sort(), ['get_listing', 'request_quote']);
});

// ---- registration -----------------------------------------------------------

test('registers get_listing and request_quote with annotations and schemas', () => {
  const { context, byName } = setup();
  assert.equal(context.tools.length, 2);

  const getListing = byName.get_listing;
  const requestQuote = byName.request_quote;
  assert.ok(getListing && requestQuote);

  assert.equal(getListing.annotations.readOnlyHint, true);
  assert.equal(requestQuote.annotations.readOnlyHint, false);

  assert.equal(requestQuote.requiresConfirmation, true);
  assert.equal(requestQuote.annotations.requiresConfirmation, true);

  for (const tool of [getListing, requestQuote]) {
    assert.equal(typeof tool.description, 'string');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(typeof tool.execute, 'function');
  }
  assert.deepEqual(requestQuote.inputSchema.required, ['name', 'contact', 'details']);
  assert.ok(requestQuote.inputSchema.properties.name);
  assert.ok(requestQuote.inputSchema.properties.contact);
  assert.ok(requestQuote.inputSchema.properties.details);
});

test('a failing first registration does not stop the second or throw', () => {
  const tools = [];
  let calls = 0;
  const context = {
    registerTool(tool) {
      calls++;
      if (calls === 1) throw new Error('boom');
      tools.push(tool);
    },
  };
  assert.doesNotThrow(() => registerWebMcp({
    navigator: { modelContext: context },
    document: makeDocument(),
    window: {},
    fetch: makeFetch(() => jsonResponse(200, {})),
    console: makeConsole(),
  }));
  assert.equal(calls, 2);
  assert.deepEqual(tools.map(t => t.name), ['request_quote']);
});

test('uses provideContext({ tools }) when registerTool is absent', () => {
  const provided = [];
  const context = { provideContext(arg) { provided.push(arg); } };
  registerWebMcp({
    navigator: { modelContext: context },
    document: makeDocument(),
    window: {},
    fetch: makeFetch(() => jsonResponse(200, {})),
    console: makeConsole(),
  });
  assert.equal(provided.length, 2);
  for (const arg of provided) {
    assert.ok(Array.isArray(arg.tools));
    assert.equal(arg.tools.length, 1);
  }
  assert.deepEqual(provided.map(a => a.tools[0].name).sort(), ['get_listing', 'request_quote']);
});

// ---- request_quote ----------------------------------------------------------

test('request_quote: user declines -> no fetch, result says declined', async () => {
  const { byName, fetch, confirmCalls } = setup({ confirm: () => false });
  const result = await byName.request_quote.execute(VALID_INPUT);
  assert.equal(fetch.calls.length, 0);
  assert.equal(confirmCalls.length, 1);
  assert.ok(confirmCalls[0].includes(PAGE_NAME));
  assert.ok(confirmCalls[0].includes(VALID_INPUT.details));
  assert.match(result.content[0].text, /declined/i);
});

test('request_quote: user confirms -> one POST to /api/quotes with the page listing id', async () => {
  const { byName, fetch } = setup({ confirm: () => true });
  const result = await byName.request_quote.execute({ ...VALID_INPUT, id: 'some-other-listing' });
  assert.equal(fetch.calls.length, 1);
  const { url, init } = fetch.calls[0];
  assert.equal(url, '/api/quotes');
  assert.equal(init.method, 'POST');
  const body = JSON.parse(init.body);
  assert.equal(body.id, PAGE_ID);
  assert.equal(body.name, VALID_INPUT.name);
  assert.equal(body.contact, VALID_INPUT.contact);
  assert.equal(body.details, VALID_INPUT.details);
  assert.ok(!result.isError);
  assert.ok(result.content[0].text.includes('q-1'));
});

test('request_quote: server rejects with 422 -> error result, nothing inserted into the DOM', async () => {
  const inserted = [];
  const { byName, document } = setup({
    respond: () => jsonResponse(422, { error: 'details is required' }),
  });
  for (const method of ['appendChild', 'insertBefore', 'append', 'prepend']) {
    document[method] = (...args) => inserted.push(args);
  }
  const result = await byName.request_quote.execute(VALID_INPUT);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /details is required/);
  assert.equal(inserted.length, 0);
});

test('request_quote: fetch rejects -> error result, not thrown', async () => {
  const { byName } = setup({
    respond: () => { throw new Error('network down'); },
  });
  const result = await byName.request_quote.execute(VALID_INPUT);
  assert.equal(result.isError, true);
});

// ---- get_listing ------------------------------------------------------------

test('get_listing fetches /api/listings/<id> and returns the JSON as text', async () => {
  const { byName, fetch } = setup({
    respond: () => jsonResponse(200, { id: PAGE_ID, name: PAGE_NAME }),
  });
  const result = await byName.get_listing.execute();
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, `/api/listings/${PAGE_ID}`);
  assert.ok(!result.isError);
  assert.ok(result.content[0].text.includes(PAGE_NAME));
});

test('get_listing: fetch rejects -> error result, not thrown', async () => {
  const { byName } = setup({
    respond: () => { throw new Error('network down'); },
  });
  const result = await byName.get_listing.execute();
  assert.equal(result.isError, true);
});

// ---- real server ------------------------------------------------------------

let env;

async function getEnv() {
  if (env) return env;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-webmcp-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const app = createApp({ dataDir: dir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  env = { dir, server, base: `http://127.0.0.1:${server.address().port}` };
  return env;
}

after(async () => {
  if (!env) return;
  env.server.closeAllConnections?.();
  await new Promise(resolve => env.server.close(resolve));
  await fs.rm(env.dir, { recursive: true, force: true });
});

test('listing page includes the WebMCP script tag and the plain quote form', async () => {
  const { base } = await getEnv();
  const listings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'));
  const id = listings.find(l => l.id).id;
  const res = await fetch(`${base}/listings/${id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('<script type="module" src="/js/webmcp.js">'));
  assert.ok(html.includes(`data-listing-id="${id}"`));
  assert.ok(html.includes(`action="/listings/${encodeURIComponent(id)}/quote"`));
});

test('GET /js/webmcp.js is served', async () => {
  const { base } = await getEnv();
  const res = await fetch(`${base}/js/webmcp.js`);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('registerWebMcp'));
});
