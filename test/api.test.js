import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from '../server/app.js';
import { findById } from '../server/data.js';

let server;
let baseUrl;

before(async () => {
  // Port 0 lets the OS pick a free port
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('GET /api/listings/nashville-pipe-pros returns 200 and the listing as JSON', async () => {
  const res = await fetch(`${baseUrl}/api/listings/nashville-pipe-pros`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await res.json(), findById('nashville-pipe-pros'));
});

test('GET /api/listings/does-not-exist returns 404 and a JSON error', async () => {
  const res = await fetch(`${baseUrl}/api/listings/does-not-exist`);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await res.json(), { error: 'Listing not found' });
});
