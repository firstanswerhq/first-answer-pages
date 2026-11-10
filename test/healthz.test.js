/**
 * healthz.test.js — GET /healthz, engines, and start script.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));

const permissive = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'healthz-'));
  copyFileSync(join(REPO_DATA, 'listings.json'), join(dir, 'listings.json'));
  copyFileSync(join(REPO_DATA, 'categories.json'), join(dir, 'categories.json'));
  return dir;
}

const servers = [];
const dirs = [];

async function start(deps = {}) {
  const dir = makeTempDir();
  dirs.push(dir);
  const app = createApp({ dataDir: dir, ...deps });
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return { dir, base: `http://127.0.0.1:${server.address().port}` };
}

after(async () => {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise(resolve => s.close(resolve));
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

test('GET /healthz returns 200 and exactly {ok:true} as JSON, no auth needed', async () => {
  const { base } = await start({ rateLimiter: permissive });
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /json/);
  assert.deepEqual(await res.json(), { ok: true });
});

test('/healthz sends the nosniff header', async () => {
  const { base } = await start({ rateLimiter: permissive });
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  await res.arrayBuffer();
});

test('/healthz does not touch data: still 200 after listings.json is deleted', async () => {
  const { base, dir } = await start({ rateLimiter: permissive });
  rmSync(join(dir, 'listings.json'), { force: true });
  writeFileSync(join(dir, 'drafts.json'), '{not valid json');
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('/healthz is not rate limited (300 calls with the real limiter)', async () => {
  const { base } = await start(); // default app uses the real createRateLimiter
  for (let i = 0; i < 300; i++) {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200, `request ${i} got ${res.status}`);
    await res.arrayBuffer();
  }
});

test('package.json: engines, scripts, type, and pinned dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.engines.node, '22.x');
  assert.equal(pkg.scripts.start, 'node server/index.js');
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.type, 'module');

  assert.deepEqual(Object.keys(pkg.dependencies), ['express']);
  assert.deepEqual(Object.keys(pkg.devDependencies), ['fast-check']);
  for (const v of [pkg.dependencies.express, pkg.devDependencies['fast-check']]) {
    assert.match(v, /^\d+\.\d+\.\d+$/, `version "${v}" must be pinned exactly`);
  }
});
