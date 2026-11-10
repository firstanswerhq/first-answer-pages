/**
 * Tests for error handling and security headers.
 *
 * One app is built on a temporary DATA_DIR (copies of the real listings.json
 * and categories.json) for the read-only checks; a second one is built for
 * the "store throws" checks so the shared app is never sabotaged. Raw
 * node:http requests are used wherever the exact request path matters, because
 * fetch normalizes some URLs.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// ---- environment helpers ----------------------------------------------------

const envs = [];

const permissiveLimiter = {
  consume: () => ({ allowed: true, retryAfterSeconds: 0 }),
  consumeAll: () => ({ allowed: true, retryAfterSeconds: 0 }),
  peek: () => ({ allowed: true, retryAfterSeconds: 0 }),
};

async function makeEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-errhdr-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const app = createApp({
    dataDir: dir,
    rateLimiter: permissiveLimiter,
    config: { adminToken: 'errors-headers-test-token' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const env = { dir, app, server, port: server.address().port };
  env.base = `http://127.0.0.1:${env.port}`;
  envs.push(env);
  return env;
}

after(async () => {
  for (const env of envs) {
    env.server.closeAllConnections?.();
    await new Promise(resolve => env.server.close(resolve));
    await fs.rm(env.dir, { recursive: true, force: true });
  }
});

/** GET with an explicit request-line path (no URL normalization). */
function rawGet(env, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: env.port, path: reqPath, method: 'GET', agent: false },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * POST declaring a body bigger than the limit, but sending only one byte.
 * The server must answer from the header alone.
 */
function postOversize(env, reqPath, type, declaredLength) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1', port: env.port, path: reqPath, method: 'POST', agent: false,
        headers: { 'content-type': type, 'content-length': String(declaredLength) },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          req.destroy();
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', reject);
      },
    );
    let answered = false;
    req.on('response', () => { answered = true; });
    req.on('error', err => { if (!answered) reject(err); });
    req.write(Buffer.from([0x89]));
  });
}

const env = await makeEnv();
const knownId = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'))
  .find(l => typeof l?.id === 'string').id;

const hasTrace = body =>
  body.includes('    at ') || body.includes('node_modules') || /\.js:\d/.test(body) || /\.js:/.test(body.replace(/\/js\/[\w.-]+\.js/g, ''));

/** Percent-encode only what a request line cannot carry; keep raw '%' as generated. */
function toRequestPath(s) {
  let out = '';
  for (const ch of s) {
    if (ch === '%' || /[A-Za-z0-9\-._~]/.test(ch)) { out += ch; continue; }
    try { out += encodeURIComponent(ch); } catch { out += '%EF%BF%BD'; }
  }
  return out;
}

// ---- Property: arbitrary path segments never produce 500 or a stack trace ----

const percentJunk = fc.oneof(
  fc.array(fc.nat(255).map(n => '%' + n.toString(16).padStart(2, '0')), { maxLength: 8 }).map(a => a.join('')),
  fc.constantFrom('%E0%A4%A', '%', '%zz', '%E0%A4%A%', '%C3%28', '%FF'),
);
const segment = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.fullUnicodeString({ maxLength: 10 }),
  percentJunk,
);

test('arbitrary id segments never give a 500 or leak a stack trace', async () => {
  const prefixes = ['/listings/', '/api/listings/', '/api/verify/', '/seance/', '/api/seance/'];
  await fc.assert(
    fc.asyncProperty(segment, async s => {
      const seg = toRequestPath(s);
      for (const prefix of prefixes) {
        const res = await rawGet(env, prefix + seg);
        assert.ok([200, 400, 404].includes(res.status), `${prefix}${seg} -> ${res.status}`);
        assert.ok(!hasTrace(res.body), `trace-like text in body for ${prefix}${seg}`);
      }
    }),
    { numRuns: 40 },
  );
});

// ---- Examples: errors -------------------------------------------------------

test('malformed percent-encoding in a page path gives a plain 400 page', async () => {
  const res = await rawGet(env, '/listings/%E0%A4%A');
  assert.equal(res.status, 400);
  assert.match(res.headers['content-type'], /html/);
  assert.match(res.body, /Bad request/);
  assert.ok(!hasTrace(res.body));
  assert.ok(!res.body.includes('URIError'));
  assert.ok(!res.body.includes('decode'));
});

test('malformed percent-encoding in an API path gives 400 JSON', async () => {
  const res = await rawGet(env, '/api/listings/%E0%A4%A');
  assert.equal(res.status, 400);
  assert.match(res.headers['content-type'], /json/);
  assert.deepEqual(JSON.parse(res.body), { error: 'Bad request' });
});

test('an oversize upload keeps its 413 status', async () => {
  const res = await postOversize(env, '/rise', 'image/png', MAX_IMAGE_BYTES + 1024);
  assert.equal(res.status, 413);
  assert.ok(!hasTrace(res.body));
});

test('invalid JSON to /api/quotes keeps its 400 status', async () => {
  const res = await fetch(`${env.base}/api/quotes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(typeof body.error, 'string');
});

test('an unexpected throw gives a generic 500 with no internal detail', async () => {
  const broken = await makeEnv();
  broken.app.locals.ctx.store.findById = () => {
    throw new TypeError('secret internal detail /srv/app.js:12');
  };

  const page = await rawGet(broken, '/listings/anything');
  assert.equal(page.status, 500);
  assert.match(page.body, /Something went wrong/);
  for (const bad of ['secret internal detail', '/srv/app.js', 'TypeError', ' at ']) {
    assert.ok(!page.body.includes(bad), `500 page leaked ${JSON.stringify(bad)}`);
  }

  const api = await rawGet(broken, '/api/listings/x');
  assert.equal(api.status, 500);
  assert.deepEqual(JSON.parse(api.body), { error: 'Something went wrong' });

  // Headers hold on the error pages too.
  for (const res of [page, api]) {
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(res.headers['content-security-policy'], "frame-ancestors 'none'");
  }
});

// ---- Examples: headers ------------------------------------------------------

test('x-powered-by is never sent', async () => {
  for (const p of ['/', '/healthz', `/api/listings/${encodeURIComponent(knownId)}`, '/no-such-page']) {
    const res = await rawGet(env, p);
    assert.equal(res.headers['x-powered-by'], undefined, p);
  }
});

test('security headers are present on HTML, JSON, 404, 400, and static responses', async () => {
  const paths = [
    '/',
    `/api/listings/${encodeURIComponent(knownId)}`,
    '/no-such-page',
    '/listings/%E0%A4%A',
    '/css/style.css',
  ];
  for (const p of paths) {
    const res = await rawGet(env, p);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', p);
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin', p);
    assert.equal(res.headers['content-security-policy'], "frame-ancestors 'none'", p);
  }
});

test('the 404 and 400 pages are the expected statuses', async () => {
  assert.equal((await rawGet(env, '/no-such-page')).status, 404);
  assert.equal((await rawGet(env, '/listings/%E0%A4%A')).status, 400);
});

test('draft pages override the referrer policy to no-referrer', async () => {
  const res = await rawGet(env, '/rise/drafts/no-such-draft');
  assert.equal(res.status, 404);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['content-security-policy'], "frame-ancestors 'none'");
});
