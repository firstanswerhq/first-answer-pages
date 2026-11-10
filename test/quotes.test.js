/**
 * Tests for quote requests (Requirements 6; Properties 18, 19, 20).
 *
 * submitQuote tests build a ctx by hand on a temporary data dir with a mock
 * notifier, a fake clock, and a counter for ids. HTTP tests build the whole app
 * on a temporary DATA_DIR. The real data/ directory is never written to.
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
import { createMockNotifier, createResendNotifier } from '../server/lib/notifier.js';
import { createRateLimiter } from '../server/lib/rate-limiter.js';
import { submitQuote } from '../server/lib/quotes.js';
import { escapeHtml } from '../server/lib/html.js';
import { validateQuoteArgs } from '../server/lib/tool-validator.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));

const IDS = [
  'nashville-pipe-pros',
  'honky-tonk-plumbing',
  'cumberland-drain-co',
  'volt-brothers-electric',
  'music-city-wiring',
  'neon-and-ohm-electric',
  'biscuit-and-brine',
];
const L0 = IDS[0];

// ---- environment helpers ----------------------------------------------------

const dirs = [];
const servers = [];

async function makeDataDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-quotes-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  return dir;
}

function makeClock() {
  return { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
}

/** A limiter that never limits. */
function stubLimiter() {
  return {
    consume: () => ({ allowed: true }),
    consumeAll: () => ({ allowed: true }),
    size: () => 0,
  };
}

/** Hand-built ctx for submitQuote. */
async function makeCtx({ rateLimiter, notifier } = {}) {
  const dir = await makeDataDir();
  const clock = makeClock();
  let n = 0;
  return {
    dir,
    store: createDataStore({ dataDir: dir, clock }),
    notifier: notifier ?? createMockNotifier(),
    clock,
    rateLimiter: rateLimiter ?? createRateLimiter({ clock }),
    config: { providerTimeoutMs: 1000 },
    newId: () => `q-${++n}`,
  };
}

const readQuotes = ctx => ctx.store.collection('quotes').read();

/** Whole app on a temp dir, listening on an ephemeral port. */
async function makeEnv({ rateLimiter } = {}) {
  const dir = await makeDataDir();
  const clock = makeClock();
  let n = 0;
  const notifier = createMockNotifier();
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `q-${++n}`,
    notifier,
    rateLimiter,
    config: { providerTimeoutMs: 1000 },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  servers.push(server);
  return { dir, clock, notifier, base: `http://127.0.0.1:${server.address().port}` };
}

async function readQuotesFile(env) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, 'quotes.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

after(async () => {
  for (const server of servers) {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

const VALID = Object.freeze({
  id: L0,
  name: 'Pat Jones',
  contact: 'pat@example.com',
  details: 'Kitchen sink is leaking.\nCan you come Tuesday?',
});

const postJson = (env, p, body) => fetch(env.base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const postForm = (env, p, params) => fetch(env.base + p, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params).toString(),
});

// ---- generators -------------------------------------------------------------

const idArb = fc.constantFrom(...IDS);
const joined = (chars, min, max) =>
  fc.array(fc.constantFrom(...chars), { minLength: min, maxLength: max }).map(a => a.join(''));

const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];
const nameArb = joined([...LETTERS, ' ', 'A', 'B'], 1, 40).filter(s => s.trim().length > 0);
const contactArb = fc.oneof(
  fc.tuple(joined(LETTERS, 1, 10), joined(LETTERS, 1, 8)).map(([a, b]) => `${a}@${b}.com`),
  fc.integer({ min: 0, max: 9999 }).map(n => `615-555-${String(n).padStart(4, '0')}`),
);
const detailsArb = joined([...LETTERS, ' ', '.', ',', '\n', '\t', '1'], 1, 200)
  .filter(s => s.trim().length > 0);

const validArgsArb = fc.record({ id: idArb, name: nameArb, contact: contactArb, details: detailsArb });

const DEFECTS = {
  unknownId: a => ({ ...a, id: 'no-such-listing' }),
  blankName: a => ({ ...a, name: '   ' }),
  longName: a => ({ ...a, name: 'a'.repeat(101) }),
  badContact: a => ({ ...a, contact: 'not a contact' }),
  emptyDetails: a => ({ ...a, details: '' }),
  longDetails: a => ({ ...a, details: 'a'.repeat(2001) }),
  missingField: a => { const { details, ...rest } = a; void details; return rest; },
  extraKey: a => ({ ...a, extra: 'x' }),
  numberName: a => ({ ...a, name: 42 }),
};

/** { args, ok } where `ok` is known from construction, not from the validator. */
const caseArb = fc.oneof(
  validArgsArb.map(args => ({ args, ok: true })),
  fc.tuple(validArgsArb, fc.constantFrom(...Object.keys(DEFECTS)))
    .map(([a, d]) => ({ args: DEFECTS[d](a), ok: false })),
);

const NUMRUNS = 30;

// ---- Property 18 ------------------------------------------------------------

test('Property 18: a quote is stored if and only if validation accepts (known cases)', async () => {
  // **Validates: Requirements 6.2, 6.3, 6.10**
  const ctx = await makeCtx({ rateLimiter: stubLimiter() });
  await fc.assert(
    fc.asyncProperty(caseArb, async ({ args, ok }) => {
      const before = (await readQuotes(ctx)).length;
      const result = await submitQuote(ctx, args, '10.0.0.1');
      const after = (await readQuotes(ctx)).length;
      if (ok) {
        assert.equal(result.status, 'ok');
        assert.equal(after, before + 1);
      } else {
        assert.equal(result.status, 'invalid');
        assert.equal(after, before);
      }
    }),
    { numRuns: NUMRUNS },
  );
});

test('Property 18: a quote is stored if and only if validation accepts (arbitrary input)', async () => {
  // **Validates: Requirements 6.2, 6.3, 6.10**
  const ctx = await makeCtx({ rateLimiter: stubLimiter() });
  const mixed = fc.record({
    id: fc.oneof(idArb, fc.anything()),
    name: fc.oneof(nameArb, fc.anything()),
    contact: fc.oneof(contactArb, fc.anything()),
    details: fc.oneof(detailsArb, fc.anything()),
  });
  await fc.assert(
    fc.asyncProperty(fc.oneof(fc.anything(), mixed), async args => {
      const accepted = validateQuoteArgs(args, ctx.store).ok;
      const before = (await readQuotes(ctx)).length;
      const result = await submitQuote(ctx, args, '10.0.0.1');
      const after = (await readQuotes(ctx)).length;
      assert.equal(result.status, accepted ? 'ok' : 'invalid');
      assert.equal(after, before + (accepted ? 1 : 0));
    }),
    { numRuns: NUMRUNS },
  );
});

// ---- Property 19 ------------------------------------------------------------

const controlChar = fc.oneof(
  fc.integer({ min: 0, max: 0x1f }),
  fc.integer({ min: 0x7f, max: 0x9f }),
).map(c => String.fromCharCode(c));
const noiseArb = fc.array(
  fc.oneof(controlChar, fc.constantFrom(' ', '  ', '<', '>', '&', '"', "'")),
  { maxLength: 6 },
).map(a => a.join(''));

// Noise that is only whitespace and control characters, safe around an email/phone.
const padArb = fc.array(fc.oneof(controlChar, fc.constant(' ')), { maxLength: 6 }).map(a => a.join(''));
const dirtyContact = fc.tuple(
  padArb,
  fc.constantFrom('a@example.com', 'o\'brien&co@example.com', 'x<y>@example.com', '615-555-0101', '(615) 555-0101'),
  padArb,
).map(([l, c, r]) => l + c + r);

const dirtyArgsArb = fc.record({
  id: fc.constantFrom('neon-and-ohm-electric', 'biscuit-and-brine', L0),
  name: fc.tuple(noiseArb, fc.constantFrom('Bob', 'A&B <Co>'), noiseArb).map(p => p.join('')),
  contact: dirtyContact,
  details: fc.tuple(noiseArb, fc.constantFrom('x', 'a < b & "c"\nline2\tcol'), noiseArb, fc.boolean())
    .map(([l, m, r, crlf]) => l + (crlf ? m.replace('\n', '\r\n') : m) + r),
});

const CONTROL_NO_TAB_NL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;
const CONTROL_ANY = /[\u0000-\u001F\u007F-\u009F]/;

test('Property 19: stored quote text is sanitized and notification text is escaped', async () => {
  // **Validates: Requirements 6.3, 6.4, 6.5, 6.10**
  const ctx = await makeCtx({ rateLimiter: stubLimiter() });
  await fc.assert(
    fc.asyncProperty(dirtyArgsArb, async args => {
      const result = await submitQuote(ctx, args, '10.0.0.1');
      assert.equal(result.status, 'ok');

      const stored = (await readQuotes(ctx)).find(q => q.id === result.quoteId);
      assert.ok(stored);

      for (const field of ['name', 'contact']) {
        assert.ok(!CONTROL_ANY.test(stored[field]), `${field} has a control character`);
        assert.equal(stored[field], stored[field].trim());
      }
      assert.ok(!CONTROL_NO_TAB_NL.test(stored.details), 'details has a control character');
      assert.ok(!stored.details.includes('\r'));
      assert.equal(stored.details, stored.details.trim());

      const sent = ctx.notifier.sent.at(-1);
      assert.equal(sent.quote.id, result.quoteId);
      // Remove the five entities the notifier emits; nothing raw may remain.
      const leftover = sent.text.replace(/&(?:amp|lt|gt|quot|#39);/g, '');
      assert.ok(!/[<>&"']/.test(leftover), `raw character in notice: ${JSON.stringify(sent.text)}`);
      assert.ok(!CONTROL_NO_TAB_NL.test(sent.text));
    }),
    { numRuns: NUMRUNS },
  );
});

// ---- Property 20 ------------------------------------------------------------

test('Property 20: quote round trip through quotes.json', async () => {
  // **Validates: Requirements 6.1, 6.2, 6.6**
  const ctx = await makeCtx({ rateLimiter: stubLimiter() });
  await fc.assert(
    fc.asyncProperty(validArgsArb, fc.integer({ min: 0, max: 100000 }), async (args, advanceMs) => {
      ctx.clock.t += advanceMs;
      const expectedAt = new Date(ctx.clock.now()).toISOString();
      const clean = validateQuoteArgs(args, ctx.store);
      assert.ok(clean.ok);

      const result = await submitQuote(ctx, args, '10.0.0.1');
      assert.equal(result.status, 'ok');

      const onDisk = JSON.parse(await fs.readFile(path.join(ctx.dir, 'quotes.json'), 'utf8'));
      const matches = onDisk.filter(q => q.id === result.quoteId);
      assert.equal(matches.length, 1);
      assert.deepEqual(matches[0], {
        id: result.quoteId,
        listingId: args.id,
        name: clean.value.name,
        contact: clean.value.contact,
        details: clean.value.details,
        createdAt: expectedAt,
        notified: true,
      });
      assert.deepEqual(Object.keys(matches[0]).sort(),
        ['contact', 'createdAt', 'details', 'id', 'listingId', 'name', 'notified']);
    }),
    { numRuns: NUMRUNS },
  );
});

// ---- notifier examples ------------------------------------------------------

test('notifier success sets notified true', async () => {
  const ctx = await makeCtx();
  const result = await submitQuote(ctx, VALID, '10.0.0.1');
  assert.deepEqual(result, { status: 'ok', quoteId: 'q-1' });
  const [stored] = await readQuotes(ctx);
  assert.equal(stored.notified, true);
  assert.equal(ctx.notifier.sent.length, 1);
  assert.equal(stored.createdAt, '2025-01-15T12:00:00.000Z');
});

test('notifier failure keeps the quote with notified false and still returns ok', async () => {
  const ctx = await makeCtx();
  ctx.notifier.failNext = true;
  const result = await submitQuote(ctx, VALID, '10.0.0.1');
  assert.equal(result.status, 'ok');
  const quotes = await readQuotes(ctx);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].id, result.quoteId);
  assert.equal(quotes[0].notified, false);
});

// ---- rate limit examples ----------------------------------------------------

test('5 quotes per hour per address, then rate_limited with retryAfterSeconds', async () => {
  const ctx = await makeCtx();
  for (let i = 0; i < 5; i++) {
    const r = await submitQuote(ctx, { ...VALID, id: IDS[i] }, '10.0.0.1');
    assert.equal(r.status, 'ok');
  }
  const limited = await submitQuote(ctx, { ...VALID, id: IDS[5] }, '10.0.0.1');
  assert.equal(limited.status, 'rate_limited');
  assert.equal(limited.retryAfterSeconds, 3600);
  assert.equal((await readQuotes(ctx)).length, 5);

  // Another address is unaffected.
  assert.equal((await submitQuote(ctx, { ...VALID, id: IDS[5] }, '10.0.0.2')).status, 'ok');

  // After the window passes, the first address may submit again.
  ctx.clock.t += 3600 * 1000;
  assert.equal((await submitQuote(ctx, { ...VALID, id: IDS[5] }, '10.0.0.1')).status, 'ok');
});

test('3 quotes per hour per listing per address, with exact wait time', async () => {
  const ctx = await makeCtx();
  for (let i = 0; i < 3; i++) {
    assert.equal((await submitQuote(ctx, VALID, '10.0.0.1')).status, 'ok');
  }
  ctx.clock.t += 600 * 1000;
  const limited = await submitQuote(ctx, VALID, '10.0.0.1');
  assert.equal(limited.status, 'rate_limited');
  assert.equal(limited.retryAfterSeconds, 3000);
  assert.equal((await readQuotes(ctx)).length, 3);

  // A different listing or a different address is still allowed.
  assert.equal((await submitQuote(ctx, { ...VALID, id: IDS[1] }, '10.0.0.1')).status, 'ok');
  assert.equal((await submitQuote(ctx, VALID, '10.0.0.2')).status, 'ok');
});

test('invalid input consumes no rate limit budget', async () => {
  const ctx = await makeCtx();
  for (let i = 0; i < 10; i++) {
    const r = await submitQuote(ctx, { ...VALID, contact: 'nope' }, '10.0.0.1');
    assert.equal(r.status, 'invalid');
    assert.equal(r.argument, 'contact');
  }
  for (let i = 0; i < 3; i++) {
    assert.equal((await submitQuote(ctx, VALID, '10.0.0.1')).status, 'ok');
  }
  assert.equal((await readQuotes(ctx)).length, 3);
});

// ---- no-JS form post --------------------------------------------------------

test('form post stores the quote and redirects 303 to ?quote=sent', async () => {
  const env = await makeEnv();
  const res = await postForm(env, `/listings/${L0}/quote`, {
    name: VALID.name, contact: VALID.contact, details: VALID.details,
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/listings/${L0}?quote=sent`);
  const quotes = await readQuotesFile(env);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].listingId, L0);
  assert.equal(quotes[0].name, VALID.name);

  const page = await fetch(env.base + res.headers.get('location'));
  assert.match(await page.text(), /Thanks! Your request is saved and we&#39;ll pass it to the business\. If you need help sooner, call them at /);
});

test('form post with invalid input gets 422 and stores nothing', async () => {
  const env = await makeEnv();
  const res = await postForm(env, `/listings/${L0}/quote`, {
    name: VALID.name, contact: 'nope', details: VALID.details,
  });
  assert.equal(res.status, 422);
  assert.equal((await readQuotesFile(env)).length, 0);
});

test('form post to an unknown listing gets 404 and stores nothing', async () => {
  const env = await makeEnv();
  const res = await postForm(env, '/listings/no-such-listing/quote', {
    name: VALID.name, contact: VALID.contact, details: VALID.details,
  });
  assert.equal(res.status, 404);
  assert.equal((await readQuotesFile(env)).length, 0);
});

test('form post: the id in the path overrides an id in the body', async () => {
  const env = await makeEnv();
  const res = await postForm(env, `/listings/${L0}/quote`, {
    id: IDS[1], name: VALID.name, contact: VALID.contact, details: VALID.details,
  });
  assert.equal(res.status, 303);
  const quotes = await readQuotesFile(env);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].listingId, L0);
});

// ---- POST /api/quotes -------------------------------------------------------

test('POST /api/quotes returns 201 with the quote id', async () => {
  const env = await makeEnv();
  const res = await postJson(env, '/api/quotes', VALID);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { quoteId: 'q-1' });
  const quotes = await readQuotesFile(env);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].id, 'q-1');
});

test('POST /api/quotes returns 422 with error and argument', async () => {
  const env = await makeEnv();
  const res = await postJson(env, '/api/quotes', { ...VALID, contact: 'nope' });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.argument, 'contact');
  assert.equal(typeof body.error, 'string');
  assert.equal((await readQuotesFile(env)).length, 0);
});

test('POST /api/quotes returns 429 with Retry-After when the listing limit is hit', async () => {
  const env = await makeEnv();
  for (let i = 0; i < 3; i++) {
    assert.equal((await postJson(env, '/api/quotes', VALID)).status, 201);
  }
  const res = await postJson(env, '/api/quotes', VALID);
  assert.equal(res.status, 429);
  const body = await res.json();
  assert.equal(res.headers.get('retry-after'), String(body.retryAfterSeconds));
  assert.ok(Number.isInteger(body.retryAfterSeconds) && body.retryAfterSeconds >= 1);
  assert.equal((await readQuotesFile(env)).length, 3);
});

test('POST /api/quotes returns 400 for malformed JSON', async () => {
  const env = await makeEnv();
  const res = await postJson(env, '/api/quotes', '{bad json');
  assert.equal(res.status, 400);
  assert.equal(typeof (await res.json()).error, 'string');
  assert.equal((await readQuotesFile(env)).length, 0);
});

// ---- parity with the MCP request_quote tool --------------------------------

function callMcp(env, args) {
  return postJson(env, '/mcp', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'request_quote', arguments: args },
  });
}

test('Parity: POST /api/quotes and MCP request_quote accept and reject the same arguments', async () => {
  // **Validates: Requirements 6.2, 6.3, 6.10**
  const env = await makeEnv({ rateLimiter: stubLimiter() });
  await fc.assert(
    fc.asyncProperty(caseArb, async ({ args, ok }) => {
      const api = await postJson(env, '/api/quotes', args);
      const mcpRes = await callMcp(env, args);
      const mcp = await mcpRes.json();
      const mcpAccepted = mcp.error === undefined && !mcp.result?.isError;

      assert.equal(api.status === 201, ok);
      assert.equal(mcpAccepted, ok);
      if (!ok) {
        assert.equal(api.status, 422);
        assert.equal(mcp.error.code, -32602);
      }
    }),
    { numRuns: 20 },
  );
});

test('Parity: a valid MCP request_quote stores the same quote shape', async () => {
  const env = await makeEnv();
  const mcp = await (await callMcp(env, VALID)).json();
  assert.equal(mcp.result.isError, undefined);
  const quotes = await readQuotesFile(env);
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].id, mcp.result.structuredContent.quoteId);
  assert.deepEqual(Object.keys(quotes[0]).sort(),
    ['contact', 'createdAt', 'details', 'id', 'listingId', 'name', 'notified']);
});

// ---- listing page -----------------------------------------------------------

test('listing page contains the quote form and the webmcp module script tag', async () => {
  const env = await makeEnv();
  const res = await fetch(`${env.base}/listings/${L0}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(`<form class="quote-form" method="post" action="/listings/${L0}/quote"`));
  assert.ok(html.includes('<script type="module" src="/js/webmcp.js"></script>'));
});

// ---- quote confirmation wording (task 15.5) ---------------------------------

const sentenceFor = phone =>
  `Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at ${phone}.`;

test('?quote=sent page has the new sentence with the escaped apostrophe and the listing phone', async () => {
  const env = await makeEnv();
  const seed = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'));
  const phone = seed.find(l => l && l.id === L0).phone;
  assert.ok(phone);

  const res = await fetch(`${env.base}/listings/${L0}?quote=sent`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes(escapeHtml(sentenceFor(phone))), 'full sentence missing');
  assert.ok(html.includes(`we&#39;ll pass it to the business. If you need help sooner, call them at ${escapeHtml(phone)}.`));
  assert.ok(!html.includes("we'll pass it"), 'apostrophe must be HTML-escaped in the raw page');

  // Without the query flag the notice is absent.
  const plain = await (await fetch(`${env.base}/listings/${L0}`)).text();
  assert.ok(!plain.includes('pass it to the business'));
});

test('the old "will contact you" phrase appears nowhere under server/ or public/js', () => {
  const OLD = 'The business will contact you';
  const roots = [
    fileURLToPath(new URL('../server/', import.meta.url)),
    fileURLToPath(new URL('../public/js/', import.meta.url)),
  ];
  let scanned = 0;
  for (const root of roots) {
    for (const rel of nodeFs.readdirSync(root, { recursive: true })) {
      const full = path.join(root, String(rel));
      if (!nodeFs.statSync(full).isFile()) continue;
      scanned++;
      assert.ok(!nodeFs.readFileSync(full, 'utf8').includes(OLD), `old phrase found in ${full}`);
    }
  }
  assert.ok(scanned > 0, 'no files were scanned');
});

test('Property: confirmation page and MCP message carry any trusted phone, HTML-escaped on the page', async () => {
  // **Validates: Requirements 6.2, 6.3**
  const phoneArb = joined([...'0123456789', ' ', '-', '(', ')', '+', '<', '>', '&', '"', "'"], 1, 14)
    .filter(s => s === s.trim());
  const nameProp = joined([...LETTERS, ' ', '<', '&', '"'], 1, 20).filter(s => s.trim().length > 0);

  await fc.assert(
    fc.asyncProperty(phoneArb, nameProp, async (phone, name) => {
      const dir = await makeDataDir();
      await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify([{
        id: 'phone-prop',
        name,
        category: 'plumbers',
        phone,
        hours: { monday: '9:00 AM - 5:00 PM' },
        services: ['Pipe repair'],
        serviceArea: 'Nashville',
        description: 'We fix pipes.',
        city: 'Nashville',
        state: 'TN',
      }]));
      let n = 0;
      const app = createApp({
        dataDir: dir,
        clock: makeClock(),
        newId: () => `p-${++n}`,
        notifier: createMockNotifier(),
        rateLimiter: { consume: () => ({ allowed: true }), consumeAll: () => ({ allowed: true }), peek: () => ({ allowed: true }) },
        config: { providerTimeoutMs: 1000 },
      });
      const server = app.listen(0, '127.0.0.1');
      try {
        await new Promise((resolve, reject) => {
          server.once('listening', resolve);
          server.once('error', reject);
        });
        const env = { base: `http://127.0.0.1:${server.address().port}` };

        const res = await fetch(`${env.base}/listings/phone-prop?quote=sent`);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes(escapeHtml(sentenceFor(phone))), 'escaped sentence missing');
        if (escapeHtml(phone) !== phone) assert.ok(!html.includes(sentenceFor(phone)), 'raw phone leaked into the page');

        const mcp = await (await callMcp(env, {
          id: 'phone-prop', name: 'Pat Jones', contact: 'pat@example.com', details: 'Leak under the sink.',
        })).json();
        assert.equal(mcp.error, undefined);
        assert.ok(mcp.result.structuredContent.message.includes(phone));
        assert.equal(mcp.result.structuredContent.message, sentenceFor(phone));
      } finally {
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
      }
    }),
    { numRuns: 30 },
  );
});

// ---- quote form errors and success box (task 17.14) -------------------------

const permissiveLimiter = () => ({
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
});

const countOf = (text, needle) => text.split(needle).length - 1;

test('422 re-render: invalid contact shows the full listing page, kept values, and the error alert', async () => {
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });
  const res = await postForm(env, `/listings/${L0}/quote`, {
    name: 'Pat <b>Jones</b>', contact: 'nope', details: 'Leak under "sink" & more',
  });
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.ok(html.includes('Nashville Pipe Pros') || html.includes('<article class="listing-detail">'), 'listing page missing');
  assert.ok(html.includes('<article class="listing-detail">'));
  assert.ok(html.includes('<form class="quote-form"'));
  assert.ok(html.includes(`value="${escapeHtml('Pat <b>Jones</b>')}"`), 'name not kept');
  assert.ok(html.includes(`>${escapeHtml('Leak under "sink" & more')}</textarea>`), 'details not kept');
  assert.match(html, /<p class="form-error" role="alert">Please enter a phone number or email\.<\/p>/);
  assert.equal((await readQuotesFile(env)).length, 0);
});

test('422 re-render: blank name and empty details give their own messages', async () => {
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });

  const noName = await postForm(env, `/listings/${L0}/quote`, {
    name: '   ', contact: VALID.contact, details: VALID.details,
  });
  assert.equal(noName.status, 422);
  assert.match(await noName.text(), /<p class="form-error" role="alert">Please enter your name\.<\/p>/);

  const noDetails = await postForm(env, `/listings/${L0}/quote`, {
    name: VALID.name, contact: VALID.contact, details: '',
  });
  assert.equal(noDetails.status, 422);
  const html = await noDetails.text();
  assert.match(html, /<p class="form-error" role="alert">Please tell the business what you need\.<\/p>/);
  assert.ok(html.includes(`value="${VALID.name}"`));

  assert.equal((await readQuotesFile(env)).length, 0);
});

test('303 then ?quote=sent shows the success box before the listing article and after <main>', async () => {
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });
  const res = await postForm(env, `/listings/${L0}/quote`, {
    name: VALID.name, contact: VALID.contact, details: VALID.details,
  });
  assert.equal(res.status, 303);
  const html = await (await fetch(env.base + res.headers.get('location'))).text();

  const seed = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'));
  const phone = seed.find(l => l && l.id === L0).phone;
  const box = `<p class="notice success-box" role="status">${escapeHtml(sentenceFor(phone))}</p>`;
  const boxAt = html.indexOf(box);
  assert.ok(boxAt >= 0, 'success box missing');
  const mainAt = html.indexOf('<main>');
  const articleAt = html.indexOf('<article class="listing-detail">');
  assert.ok(mainAt >= 0 && articleAt >= 0);
  assert.ok(mainAt < boxAt, 'box must come after <main>');
  assert.ok(boxAt < articleAt, 'box must come before the listing article');
});

test('Property: the 422 page re-shows name and details escaped and adds no script tags', async () => {
  // **Validates: Requirements 6.2, 6.3**
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });
  const baseline = await (await fetch(`${env.base}/listings/${L0}`)).text();
  const baseScripts = countOf(baseline, '<script');

  const textArb = fc.oneof(
    fc.string(),
    fc.fullUnicodeString(),
    fc.constantFrom(
      '<script>alert(1)</script>',
      'say "hi" & \'bye\'',
      "O'Brien & Sons",
      '"><script>alert(1)</script>',
      '</textarea><script>alert(1)</script>',
    ),
  );

  await fc.assert(
    fc.asyncProperty(textArb, textArb, async (name, details) => {
      const res = await postForm(env, `/listings/${L0}/quote`, { name, contact: 'nope', details });
      assert.equal(res.status, 422);
      const html = await res.text();

      // The route keeps at most 2000 characters and applies no trimming.
      const keptName = name.slice(0, 2000);
      const keptDetails = details.slice(0, 2000);
      assert.ok(html.includes(`value="${escapeHtml(keptName)}"`), 'name not re-shown escaped');
      assert.ok(html.includes(`>${escapeHtml(keptDetails)}</textarea>`), 'details not re-shown escaped');
      assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script from input leaked');
      assert.equal(countOf(html, '<script'), baseScripts);
    }),
    { numRuns: 25 },
  );
  assert.equal((await readQuotesFile(env)).length, 0);
});

// ---- notifier integration and /admin/quotes (task 21.4) ---------------------

const ADMIN_TOKEN = 'quotes-notify-admin-token';
const RESEND_KEY = 'resend-secret-key-do-not-leak';
const OWNER_EMAIL = 'owner@example.com';
const PUB_ID = 'quillfeather-plumbing';
const PUB_LISTING = Object.freeze({
  id: PUB_ID,
  name: 'Quillfeather Plumbing',
  category: 'plumbers',
  phone: '(615) 555-0142',
  services: ['Leak repair'],
  serviceArea: 'Greater Springfield',
  description: 'We fix pipes and leaks.',
  city: 'Springfield',
  state: 'TN',
  ownerEmail: OWNER_EMAIL,
});

/**
 * App with a published listing that has a private owner email, an admin
 * token, and either an injected notifier or a notifier chosen by config.
 */
async function makeNotifyEnv({ notifier, config = {} } = {}) {
  const dir = await makeDataDir();
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify([PUB_LISTING]));
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock: makeClock(),
    newId: () => `n-${++n}`,
    notifier,
    rateLimiter: permissiveLimiter(),
    config: { providerTimeoutMs: 1000, adminToken: ADMIN_TOKEN, ...config },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  servers.push(server);
  return { dir, base: `http://127.0.0.1:${server.address().port}` };
}

const adminQuotesPage = async env => {
  const res = await fetch(`${env.base}/admin/quotes`, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } });
  assert.equal(res.status, 200);
  return res.text();
};

const sendPubQuote = env => postForm(env, `/listings/${PUB_ID}/quote`, {
  name: VALID.name, contact: VALID.contact, details: VALID.details,
});

/** Capture process.stderr.write while fn runs; always restores it. */
async function withStderr(fn) {
  const original = process.stderr.write;
  const chunks = [];
  process.stderr.write = chunk => { chunks.push(String(chunk)); return true; };
  try {
    await fn();
  } finally {
    process.stderr.write = original;
  }
  return chunks.join('');
}

test('no email set up (notifier none): the quote claims no email and /admin/quotes says so', async () => {
  const env = await makeNotifyEnv({ config: { notifierName: 'none' } });
  const res = await sendPubQuote(env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/listings/${PUB_ID}?quote=sent`);

  const [stored] = await readQuotesFile(env);
  assert.equal(stored.listingId, PUB_ID);
  assert.notEqual(stored.emailed, true, 'must not claim an email was sent');
  assert.equal(stored.emailed, false);
  assert.equal(stored.notifier, 'none');
  assert.equal(stored.notified, false);

  const html = await adminQuotesPage(env);
  assert.ok(html.includes('Emailed: no (email not set up)'));
  assert.ok(!html.includes('Emailed: yes'));
  assert.ok(html.includes('Quillfeather Plumbing'), 'business name');
  assert.ok(html.includes('(615) 555-0142'), 'business phone');
  assert.ok(html.includes(OWNER_EMAIL), 'owner email (private)');
  assert.ok(html.includes(escapeHtml(VALID.name)));
});

test('resend success: /admin/quotes says "Emailed: yes", the owner and admin are emailed, the key stays private', async () => {
  const calls = [];
  const fetchStub = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  const notifier = createResendNotifier({
    apiKey: RESEND_KEY, from: 'quotes@example.test', adminEmail: 'admin@example.test', fetch: fetchStub,
  });
  const env = await makeNotifyEnv({ notifier });

  let res;
  const stderr = await withStderr(async () => { res = await sendPubQuote(env); });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/listings/${PUB_ID}?quote=sent`);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.deepEqual(JSON.parse(calls[0].init.body).to, [OWNER_EMAIL, 'admin@example.test']);

  const [stored] = await readQuotesFile(env);
  assert.equal(stored.emailed, true);
  assert.equal(stored.notifier, 'resend');
  assert.equal(stored.notified, true);

  const html = await adminQuotesPage(env);
  assert.ok(html.includes('Emailed: yes'));
  assert.ok(!html.includes('Emailed: no'));

  const onDisk = await fs.readFile(path.join(env.dir, 'quotes.json'), 'utf8');
  for (const [label, text] of [['admin page', html], ['stderr', stderr], ['quotes.json', onDisk]]) {
    assert.ok(!text.includes(RESEND_KEY), `key leaked in ${label}`);
  }
});

test('resend failure: /admin/quotes says "sending failed", the visitor still gets the normal redirect, the key stays private', async () => {
  const failures = {
    'http error': async () => ({ ok: false, status: 500 }),
    'network error': async () => { throw new Error(`connect failed using ${RESEND_KEY}`); },
  };
  for (const [label, fetchStub] of Object.entries(failures)) {
    const notifier = createResendNotifier({
      apiKey: RESEND_KEY, from: 'quotes@example.test', adminEmail: 'admin@example.test', fetch: fetchStub,
    });
    const env = await makeNotifyEnv({ notifier });

    let res;
    const stderr = await withStderr(async () => { res = await sendPubQuote(env); });
    assert.equal(res.status, 303, label);
    assert.equal(res.headers.get('location'), `/listings/${PUB_ID}?quote=sent`, label);

    const quotes = await readQuotesFile(env);
    assert.equal(quotes.length, 1, `${label}: the quote is still saved`);
    assert.equal(quotes[0].emailed, false, label);
    assert.equal(quotes[0].notifier, 'resend', label);

    const html = await adminQuotesPage(env);
    assert.ok(html.includes('Emailed: no (sending failed)'), label);
    assert.ok(!html.includes('Emailed: yes'), label);
    assert.ok(!html.includes('email not set up'), label);

    const onDisk = await fs.readFile(path.join(env.dir, 'quotes.json'), 'utf8');
    for (const [where, text] of [['admin page', html], ['stderr', stderr], ['quotes.json', onDisk]]) {
      assert.ok(!text.includes(RESEND_KEY), `${label}: key leaked in ${where}`);
    }
  }
});

// ---- quote page: refresh, 422 markup, empty contact (task 21.4) -------------

test('GET /listings/:id/quote redirects 303 to the listing; an unknown id is 404', async () => {
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });
  const res = await fetch(`${env.base}/listings/${L0}/quote`, { redirect: 'manual' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/listings/${L0}`);
  await res.arrayBuffer();

  const missing = await fetch(`${env.base}/listings/no-such-listing/quote`, { redirect: 'manual' });
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  assert.equal((await readQuotesFile(env)).length, 0);
});

test('422 page: the error box is focusable, labelled as an alert, and comes before the listing detail', async () => {
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });
  const res = await postForm(env, `/listings/${L0}/quote`, {
    name: VALID.name, contact: 'nope', details: VALID.details,
  });
  assert.equal(res.status, 422);
  const html = await res.text();

  assert.match(html, /<div id="quote-error" role="alert" tabindex="-1"/);
  assert.ok(html.includes('id="quote-error"'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('tabindex="-1"'));
  assert.ok(html.includes('id="quote-form"'));
  assert.equal(countOf(html, 'id="quote-error"'), 1);

  const errorAt = html.indexOf('id="quote-error"');
  const formAt = html.indexOf('id="quote-form"');
  const detailAt = html.indexOf('<article class="listing-detail">');
  assert.ok(detailAt >= 0);
  assert.ok(errorAt < detailAt, 'error box must come before the listing detail');
  assert.ok(formAt < detailAt, 'form must come before the listing detail');
  assert.ok(errorAt < formAt, 'error box must come before the form');

  // A normal page has the form after the detail and no error box.
  const plain = await (await fetch(`${env.base}/listings/${L0}`)).text();
  assert.ok(!plain.includes('id="quote-error"'));
  assert.ok(plain.indexOf('<article class="listing-detail">') < plain.indexOf('id="quote-form"'));
});

const EMPTY_CONTACT = 'Please enter a phone number or email.';

test('empty contact: the API, MCP and form all say "Please enter a phone number or email."', async () => {
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });

  for (const contact of ['', '   ']) {
    const api = await postJson(env, '/api/quotes', { ...VALID, contact });
    assert.equal(api.status, 422, JSON.stringify(contact));
    const body = await api.json();
    assert.equal(body.argument, 'contact');
    assert.equal(body.error, EMPTY_CONTACT);
    assert.ok(!body.error.includes('characters'));

    const mcp = await (await callMcp(env, { ...VALID, contact })).json();
    assert.equal(mcp.error.code, -32602);
    assert.equal(mcp.error.message, `Invalid argument: contact: ${EMPTY_CONTACT}`);
    assert.ok(!mcp.error.message.includes('characters'));

    const form = await postForm(env, `/listings/${L0}/quote`, { ...VALID, contact });
    assert.equal(form.status, 422);
    const html = await form.text();
    assert.ok(html.includes(`<p class="form-error" role="alert">${EMPTY_CONTACT}</p>`));
    assert.ok(!html.includes('characters'));
  }
  assert.equal((await readQuotesFile(env)).length, 0);
});

test('Property: a contact with nothing but spaces and control characters gets the plain-language message', async () => {
  const env = await makeEnv({ rateLimiter: permissiveLimiter() });
  const blankArb = fc.array(fc.constantFrom(' ', '\t', '\u0007', '\u0000', '\u007f'), { maxLength: 12 })
    .map(a => a.join(''));

  await fc.assert(
    fc.asyncProperty(blankArb, async contact => {
      const api = await postJson(env, '/api/quotes', { ...VALID, contact });
      assert.equal(api.status, 422);
      const body = await api.json();
      assert.equal(body.argument, 'contact');
      assert.equal(body.error, EMPTY_CONTACT);

      const mcp = await (await callMcp(env, { ...VALID, contact })).json();
      assert.equal(mcp.error.message, `Invalid argument: contact: ${EMPTY_CONTACT}`);
    }),
    { numRuns: 15 },
  );
  assert.equal((await readQuotesFile(env)).length, 0);
});
