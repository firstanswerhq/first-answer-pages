/**
 * Tests for the phone-book design's static pieces: self-hosted fonts and their
 * cache header, no outside requests from the stylesheet, the favicon link, and
 * the home page head.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn(); });

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-design-'));
  for (const n of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_ROOT, 'data', n), path.join(dir, n));
  }
  const app = createApp({ dataDir: dir });
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  cleanups.push(() => new Promise(resolve => server.close(resolve)));
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10 }).catch(() => {}));
  return `http://127.0.0.1:${server.address().port}`;
}

test('every font the stylesheet names is in public/fonts and is served with a year-long cache', async () => {
  const base = await startEnv();
  const css = await fs.readFile(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8');
  const files = [...css.matchAll(/url\("(\/fonts\/[^"]+\.woff2)"\)/g)].map(m => m[1]);
  assert.ok(files.length >= 2, 'the stylesheet loads its own fonts');
  for (const file of files) {
    const res = await fetch(base + file);
    assert.equal(res.status, 200, file);
    assert.match(res.headers.get('content-type'), /font\/woff2/);
    assert.match(res.headers.get('cache-control'), /max-age=31536000/);
    assert.match(res.headers.get('cache-control'), /immutable/);
    await res.arrayBuffer();
  }
});

test('the stylesheet asks no other website for anything', async () => {
  const css = await fs.readFile(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8');
  const outside = css.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '').match(/https?:\/\/|@import/g);
  assert.equal(outside, null);
});

test('pages link the favicon and the home page has its head and search button', async () => {
  const base = await startEnv();
  const home = await (await fetch(base + '/')).text();
  assert.ok(home.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml">'));
  assert.ok(home.includes('<header class="home-head">'));
  assert.ok(home.includes('<button type="submit">Search Directory</button>'));
  assert.equal(home.includes('fonts.googleapis.com'), false);
  const icon = await fetch(base + '/favicon.svg');
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /image\/svg\+xml/);
});
