import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import fc from 'fast-check';
import { createSafeFetcher, SafeFetchError } from '../server/lib/safe-fetch.js';
import { isPublicAddress } from '../server/lib/ip-guard.js';

// Guard: the real network functions must never be called by this suite.
const realHttp = http.request;
const realHttps = https.request;
before(() => {
  http.request = () => { throw new Error('real http.request called'); };
  https.request = () => { throw new Error('real https.request called'); };
});
after(() => {
  http.request = realHttp;
  https.request = realHttps;
});

/**
 * Fake transport. Like Node, it asks opts.lookup where to connect and records
 * the addresses it "connected" to. `routes(href)` returns { status, headers, body }.
 */
function fakeTransport(routes) {
  const connections = [];
  const sent = [];
  const fn = (url, opts, cb) => {
    const u = new URL(url);
    const req = new EventEmitter();
    req.end = () => {
      const host = u.hostname.replace(/^\[|\]$/g, '');
      opts.lookup(host, { all: true }, (err, list) => {
        if (err) return req.emit('error', err);
        connections.push(...list.map(a => a.address));
        sent.push(opts.headers);
        const route = routes(u.href);
        if (route === 'hang') return;
        const res = Readable.from([route.body ?? Buffer.alloc(0)]);
        res.statusCode = route.status ?? 200;
        res.headers = route.headers ?? {};
        cb(res);
      });
    };
    return req;
  };
  return { request: { http: fn, https: fn }, connections, sent };
}

const lookupFrom = map => (host, opts, cb) => {
  const addrs = map[host] ?? ['93.184.216.34'];
  setImmediate(() => cb(null, addrs.map(address => ({ address, family: address.includes(':') ? 6 : 4 }))));
};

const rejectsWith = async (promise, code) => {
  await assert.rejects(promise, err => err instanceof SafeFetchError && err.code === code, `expected ${code}`);
};

// Feature: ai-visibility-grader, Property 2: Redirects never reach a refused address
test('Property 2: redirects never reach a refused address', async () => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 0, max: 7 }),
    fc.array(fc.integer({ min: 0, max: 7 }), { maxLength: 3 }),
    async (n, blockedIdx) => {
      const dnsMap = {};
      for (const i of blockedIdx) dnsMap[`h${i}.example`] = ['10.0.0.5'];
      const t = fakeTransport(href => {
        const i = Number(/h(\d+)\.example/.exec(href)[1]);
        return i < n
          ? { status: 302, headers: { location: `https://h${i + 1}.example/` } }
          : { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('ok') };
      });
      const fetcher = createSafeFetcher({ request: t.request, lookup: lookupFrom(dnsMap) });
      const firstBlocked = blockedIdx.length ? Math.min(...blockedIdx) : undefined;
      let outcome;
      try {
        outcome = (await fetcher.fetchText('https://h0.example/')).status;
      } catch (err) {
        outcome = err.code;
      }
      if (firstBlocked !== undefined && firstBlocked <= Math.min(n, 5)) assert.equal(outcome, 'blocked_address');
      else if (n > 5) assert.equal(outcome, 'too_many_redirects');
      else assert.equal(outcome, 200);
      for (const address of t.connections) assert.equal(isPublicAddress(address), true, address);
    },
  ), { numRuns: 150 });
});

// Feature: ai-visibility-grader, Property 3: Size limit holds after decompression
test('Property 3: size limit holds after decompression', async () => {
  const encoders = {
    identity: b => b,
    gzip: b => zlib.gzipSync(b),
    deflate: b => zlib.deflateSync(b),
    br: b => zlib.brotliCompressSync(b),
  };
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 0, max: 5000 }),
    fc.integer({ min: 1, max: 2000 }),
    fc.constantFrom(...Object.keys(encoders)),
    async (len, maxBytes, enc) => {
      const body = encoders[enc](Buffer.alloc(len, 0x61));
      const headers = enc === 'identity' ? {} : { 'content-encoding': enc };
      const t = fakeTransport(() => ({ status: 200, headers, body }));
      const fetcher = createSafeFetcher({ request: t.request, lookup: lookupFrom({}), maxBytes });
      const result = await fetcher.fetchText('https://example.com/');
      assert.equal(result.text.length, Math.min(len, maxBytes));
      assert.equal(result.truncated, len > maxBytes);
    },
  ), { numRuns: 120 });
});

test('strictSize turns a too-large body into too_large', async () => {
  const t = fakeTransport(() => ({ body: Buffer.alloc(50, 0x61) }));
  const fetcher = createSafeFetcher({ request: t.request, lookup: lookupFrom({}), maxBytes: 10 });
  await rejectsWith(fetcher.fetchText('https://example.com/', { strictSize: true }), 'too_large');
});

test('refused URLs never reach the transport', async () => {
  const t = fakeTransport(() => ({ body: Buffer.from('x') }));
  const fetcher = createSafeFetcher({ request: t.request, lookup: lookupFrom({ 'internal.example': ['192.168.1.5'] }) });
  const blocked = [
    'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://2130706433/', 'http://0x7f.1/',
    'http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost-ish.example@10.0.0.1/',
    'http://internal.example/',
  ];
  for (const url of blocked) {
    await assert.rejects(fetcher.fetchText(url), err => err instanceof SafeFetchError, url);
  }
  await rejectsWith(fetcher.fetchText('http://[::1]/'), 'blocked_address');
  await rejectsWith(fetcher.fetchText('http://[::ffff:7f00:1]/'), 'blocked_address');
  await rejectsWith(fetcher.fetchText('http://2130706433/'), 'blocked_address');
  await rejectsWith(fetcher.fetchText('http://0x7f.1/'), 'blocked_address');
  await rejectsWith(fetcher.fetchText('http://internal.example/'), 'blocked_address');
  await rejectsWith(fetcher.fetchText('https://example.com:8443/'), 'bad_url');
  await rejectsWith(fetcher.fetchText('http://example.com:22/'), 'bad_url');
  await rejectsWith(fetcher.fetchText('https://user:pw@example.com/'), 'bad_url');
  await rejectsWith(fetcher.fetchText('ftp://example.com/'), 'bad_url');
  await rejectsWith(fetcher.fetchText('not a url'), 'bad_url');
  assert.deepEqual(t.connections, []);
});

test('a DNS answer mixing public and private addresses is refused', async () => {
  const t = fakeTransport(() => ({ body: Buffer.from('x') }));
  const fetcher = createSafeFetcher({
    request: t.request,
    lookup: lookupFrom({ 'mixed.example': ['93.184.216.34', '10.0.0.9'] }),
  });
  await rejectsWith(fetcher.fetchText('https://mixed.example/'), 'blocked_address');
  assert.deepEqual(t.connections, []);
});

test('connects only to the checked address, with only the three allowed headers', async () => {
  const t = fakeTransport(() => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('hello') }));
  const fetcher = createSafeFetcher({
    request: t.request, lookup: lookupFrom({ 'ok.example': ['93.184.216.34'] }), userAgent: 'TestBot/1',
  });
  const result = await fetcher.fetchText('https://ok.example/');
  assert.equal(result.text, 'hello');
  assert.deepEqual(t.connections, ['93.184.216.34']);
  assert.deepEqual(Object.keys(t.sent[0]).sort(), ['Accept', 'Accept-Encoding', 'User-Agent']);
  assert.equal(t.sent[0]['User-Agent'], 'TestBot/1');
});

test('a slow server times out', async () => {
  const t = fakeTransport(() => 'hang');
  const fetcher = createSafeFetcher({ request: t.request, lookup: lookupFrom({}), timeoutMs: 40 });
  await rejectsWith(fetcher.fetchText('https://example.com/'), 'timeout');
});
