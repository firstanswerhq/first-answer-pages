/**
 * Tests for the seed folder / writable data folder split and startup checks.
 *
 * listings.json and categories.json are read-only seeds (seedDir). Every other
 * file (drafts, pending, published, quotes, seance, verified) lives in the
 * writable dataDir. Every test uses fresh temp directories; the real data/
 * folder is only read.
 */

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createDataStore } from '../server/data.js';
import { configFromEnv, startupProblems } from '../server/lib/config.js';
import { createMockVisionProvider } from '../server/lib/vision.js';

const REPO_DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const SEED_FILES = ['listings.json', 'categories.json'];
const WRITABLE_FILES = ['drafts.json', 'pending.json', 'published.json', 'quotes.json', 'seance.json', 'verified.json'];

// ---- helpers ------------------------------------------------------------------

const tempDirs = [];
const servers = [];

async function tmp(prefix = 'fap-datadir-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function copySeeds(dir) {
  for (const name of SEED_FILES) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
}

async function snapshot(dir, names) {
  const out = {};
  for (const name of names) out[name] = await fs.readFile(path.join(dir, name));
  return out;
}

function assertSame(before, after, label) {
  for (const name of Object.keys(before)) {
    assert.ok(before[name].equals(after[name]), `${label}/${name} changed`);
  }
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

after(async () => {
  for (const s of servers) {
    if (s.listening) await closeServer(s);
  }
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});

const distinctiveListing = {
  id: 'seed-only-widgets',
  name: 'Seed Only Widgets',
  category: 'plumbers',
  phone: '(615) 555-0188',
  hours: { monday: '8:00 AM - 5:00 PM' },
  services: ['Widgets'],
  serviceArea: 'Nashville',
  description: 'We make widgets.',
  city: 'Nashville',
  state: 'TN',
};
const decoyListing = { ...distinctiveListing, id: 'decoy-in-data-dir', name: 'Decoy In Data Dir' };
const categoriesJson = [{ slug: 'plumbers', label: 'Plumbers' }];

// ---- config ---------------------------------------------------------------------

describe('configFromEnv seedDir / dataDir', () => {
  test('DATA_DIR changes dataDir only; seedDir stays the repo data/ folder', () => {
    const cfg = configFromEnv({ DATA_DIR: '/some/other' });
    assert.equal(cfg.seedDir, REPO_DATA);
    assert.equal(cfg.dataDir, path.resolve('/some/other'));
    assert.notEqual(cfg.dataDir, cfg.seedDir);
  });

  test('without DATA_DIR both are the repo data/ folder', () => {
    const cfg = configFromEnv({});
    assert.equal(cfg.seedDir, REPO_DATA);
    assert.equal(cfg.dataDir, REPO_DATA);
  });

  test('empty DATA_DIR counts as unset', () => {
    assert.equal(configFromEnv({ DATA_DIR: '' }).dataDir, REPO_DATA);
  });
});

describe('startupProblems', () => {
  test('non-production returns [] even without DATA_DIR and BASE_URL', () => {
    assert.deepEqual(startupProblems({}), []);
    assert.deepEqual(startupProblems({ NODE_ENV: 'development' }), []);
  });

  test('production without DATA_DIR mentions DATA_DIR', () => {
    const problems = startupProblems({ NODE_ENV: 'production', BASE_URL: 'https://example.com' });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /DATA_DIR/);
  });

  test('production without BASE_URL mentions BASE_URL', () => {
    const problems = startupProblems({ NODE_ENV: 'production', DATA_DIR: '/data' });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /BASE_URL/);
  });

  test('production with both returns []', () => {
    assert.deepEqual(startupProblems({ NODE_ENV: 'production', DATA_DIR: '/data', BASE_URL: 'https://example.com' }), []);
  });

  test('empty-string values count as missing', () => {
    const problems = startupProblems({ NODE_ENV: 'production', DATA_DIR: '', BASE_URL: '' });
    assert.equal(problems.length, 2);
    assert.ok(problems.some(p => /DATA_DIR/.test(p)));
    assert.ok(problems.some(p => /BASE_URL/.test(p)));
  });
});

// ---- store ----------------------------------------------------------------------

describe('createDataStore with separate seedDir', () => {
  test('reads seeds from seedDir, ignores dataDir seeds, writes only writable files to dataDir', async () => {
    const seedDir = await tmp('fap-seed-');
    const dataDir = await tmp('fap-writable-');
    await fs.writeFile(path.join(seedDir, 'listings.json'), JSON.stringify([distinctiveListing]));
    await fs.writeFile(path.join(seedDir, 'categories.json'), JSON.stringify(categoriesJson));
    // Decoys in the writable dir must be ignored and left untouched.
    await fs.writeFile(path.join(dataDir, 'listings.json'), JSON.stringify([decoyListing]));
    await fs.writeFile(path.join(dataDir, 'categories.json'), JSON.stringify([{ slug: 'decoy', label: 'Decoy' }]));

    const seedBefore = await snapshot(seedDir, SEED_FILES);
    const dataBefore = await snapshot(dataDir, SEED_FILES);

    const store = createDataStore({
      dataDir,
      seedDir,
      validateFields: fields => ({ fields, missingFields: [] }),
      makeSlug: () => 'published-widgets',
    });

    assert.ok(store.findById('seed-only-widgets'));
    assert.equal(store.findById('decoy-in-data-dir'), undefined);
    assert.deepEqual(store.getCategories().map(c => c.slug), ['plumbers']);

    // Series of operations: drafts, submit, publish, quotes, seance.
    const draftFields = { ...distinctiveListing, id: undefined, name: 'Published Widgets' };
    const mkDraft = id => ({ id, status: 'draft', fields: { ...draftFields } });
    await store.collection('drafts').append(mkDraft('d1'));
    await store.collection('drafts').append(mkDraft('d2'));
    assert.equal((await store.submitDraft('d1')).status, 200);
    assert.equal((await store.publishDraft('d2')).status, 200);
    await store.collection('quotes').append({ id: 'q1', listingId: 'seed-only-widgets', createdAt: new Date().toISOString() });
    await store.collection('seance').append({ id: 's1', listingId: 'seed-only-widgets' });
    await store.pruneExpired();

    // Writable files exist only in dataDir.
    const dataFiles = (await fs.readdir(dataDir)).sort();
    for (const name of WRITABLE_FILES) assert.ok(dataFiles.includes(name), `${name} missing in dataDir`);
    const seedFiles = (await fs.readdir(seedDir)).sort();
    assert.deepEqual(seedFiles, [...SEED_FILES].sort());
    assert.ok(!dataFiles.some(f => f.endsWith('.tmp')));

    // Seeds never written.
    assertSame(seedBefore, await snapshot(seedDir, SEED_FILES), 'seedDir');
    assertSame(dataBefore, await snapshot(dataDir, SEED_FILES), 'dataDir');
  });
});

// ---- createApp startup ------------------------------------------------------------

describe('createApp startup', () => {
  test('throws "No categories found" when categories.json is empty', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'listings.json'), JSON.stringify([distinctiveListing]));
    await fs.writeFile(path.join(dir, 'categories.json'), '[]');
    assert.throws(() => createApp({ dataDir: dir }), /No categories found/);
  });

  test('starts when the data dir has categories', async () => {
    const dir = await tmp();
    await copySeeds(dir);
    const app = createApp({ dataDir: dir });
    assert.equal(typeof app, 'function');
    assert.ok(app.locals.ctx.store.getCategories().length > 0);
    await new Promise(resolve => setTimeout(resolve, 50)); // let the startup prune settle
  });
});

// ---- property -----------------------------------------------------------------------

describe('writable files stay in DATA_DIR', () => {
  test('Property: any sequence of app actions only creates known writable files and never touches seeds', async () => {
    // **Validates: Requirements 16.9 (data folders and startup checks)**
    const SEED_ID = 'nashville-pipe-pros';
    const TOKEN = 'data-dir-test-token';
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('FAP-DATA-DIR-TEST'),
    ]);
    const permissive = {
      consume: () => ({ allowed: true, retryAfterSeconds: 0 }),
      consumeAll: () => ({ allowed: true, retryAfterSeconds: 0 }),
      peek: () => ({ allowed: true, retryAfterSeconds: 0 }),
    };
    const assistantProvider = { name: 'mock', ask: async () => 'Try Nashville Pipe Pros.' };

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 0, maxLength: 6 }),
        async actions => {
          const seedDir = await tmp('fap-prop-seed-');
          const dataDir = await tmp('fap-prop-data-');
          await copySeeds(seedDir);
          const seedBefore = await snapshot(seedDir, SEED_FILES);

          const app = createApp({
            dataDir,
            seedDir,
            rateLimiter: permissive,
            visionProvider: createMockVisionProvider(),
            assistantProvider,
            config: { adminToken: TOKEN, production: false },
          });
          const server = await listen(app);
          const base = `http://127.0.0.1:${server.address().port}`;

          try {
            for (const action of actions) {
              let res;
              switch (action) {
                case 0: res = await fetch(`${base}/`, { redirect: 'manual' }); break;
                case 1: res = await fetch(`${base}/rise`, { redirect: 'manual' }); break;
                case 2:
                  res = await fetch(`${base}/rise`, {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { 'content-type': 'image/png' },
                    body: png,
                  });
                  break;
                case 3:
                  res = await fetch(`${base}/api/quotes`, {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      id: SEED_ID,
                      name: 'Pat Example',
                      contact: '615-555-0100',
                      details: 'Need a leaking pipe fixed.',
                    }),
                  });
                  break;
                case 4: res = await fetch(`${base}/llms.txt`, { redirect: 'manual' }); break;
                default:
                  res = await fetch(`${base}/seance/run`, {
                    method: 'POST',
                    redirect: 'manual',
                    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
                    body: JSON.stringify({ id: SEED_ID }),
                  });
              }
              await res.arrayBuffer();
            }

            const files = await fs.readdir(dataDir);
            assert.ok(files.every(f => !f.endsWith('.tmp')), `leftover tmp file in ${files}`);
            for (const f of files) {
              assert.ok(WRITABLE_FILES.includes(f), `unexpected file in DATA_DIR: ${f}`);
            }
            assert.deepEqual((await fs.readdir(seedDir)).sort(), [...SEED_FILES].sort());
            assertSame(seedBefore, await snapshot(seedDir, SEED_FILES), 'seedDir');
          } finally {
            await closeServer(server);
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});
