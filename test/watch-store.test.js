/**
 * addon-monthly-watch task 2: the `watches` collection is on the data store's allow-list (it appends and reads, and
 * other names are still refused), and the two new rate limit rules are there: watch-start 5 an hour, watch-manage
 * 20 an hour. The steering files name the new collection.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDataStore } from '../server/data.js';
import { RULES, createRateLimiter } from '../server/lib/rate-limiter.js';

const dirs = [];
after(async () => {
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
});

async function freshStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-store-'));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'listings.json'), '[]');
  await fs.writeFile(path.join(dir, 'categories.json'), '[]');
  return { dir, store: createDataStore({ dataDir: dir }) };
}

test('the watches collection appends and reads, in its own file', async () => {
  const { dir, store } = await freshStore();
  const watches = store.collection('watches');
  assert.deepEqual(await watches.read(), [], 'empty before the first write');
  const record = { id: 'w'.repeat(22), gradeId: 'g'.repeat(22), status: 'active', readings: [] };
  await watches.append(record);
  await watches.append({ ...record, id: 'v'.repeat(22) });
  const read = await watches.read();
  assert.equal(read.length, 2);
  assert.deepEqual(read[0], record);
  // It is written to watches.json in the data folder.
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'watches.json'), 'utf8'));
  assert.equal(onDisk.length, 2);
  // update works too (the service changes a record in place).
  await watches.update(list => { list.find(w => w.id === record.id).status = 'paused'; });
  assert.equal((await watches.read()).find(w => w.id === record.id).status, 'paused');
});

test('the allow-list still refuses any other name', async () => {
  const { store } = await freshStore();
  for (const name of ['watch', 'Watches', 'published', 'verified', '../watches', '', undefined]) {
    assert.throws(() => store.collection(name), /Unknown collection/, String(name));
  }
  for (const name of ['drafts', 'quotes', 'seance', 'pending', 'grades', 'leads', 'watches']) {
    assert.doesNotThrow(() => store.collection(name), name);
  }
});

test('the watch rate limit rules: start 5 an hour, confirm and stop 20 an hour', () => {
  assert.deepEqual({ ...RULES['watch-start'] }, { limit: 5, windowMs: 60 * 60 * 1000 });
  assert.deepEqual({ ...RULES['watch-manage'] }, { limit: 20, windowMs: 60 * 60 * 1000 });
  assert.ok(Object.isFrozen(RULES['watch-start']) && Object.isFrozen(RULES['watch-manage']));
  // The 6th start in an hour from one client is refused; an hour later it is allowed again.
  const clock = { t: 1_000_000, now() { return this.t; } };
  const limiter = createRateLimiter({ clock });
  for (let i = 0; i < 5; i += 1) assert.equal(limiter.consume('watch-start:203.0.113.1', RULES['watch-start']).allowed, true);
  assert.equal(limiter.consume('watch-start:203.0.113.1', RULES['watch-start']).allowed, false);
  clock.t += 60 * 60 * 1000 + 1;
  assert.equal(limiter.consume('watch-start:203.0.113.1', RULES['watch-start']).allowed, true);
});

test('the steering files list watches among the allow-listed collections', async () => {
  for (const file of ['structure.md', 'tech.md']) {
    const text = await fs.readFile(fileURLToPath(new URL(`../.kiro/steering/${file}`, import.meta.url)), 'utf8');
    assert.match(text, /`grades`, `leads`, `watches`/, file);
  }
});
