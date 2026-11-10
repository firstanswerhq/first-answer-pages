import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import nodeFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';

import { readJsonFile, updateJsonFile, StoreError } from '../server/lib/json-file.js';

const root = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'json-file-test-'));
let counter = 0;

/** Fresh path inside a fresh subdirectory so temp-file listings are isolated. */
async function freshPath() {
  const dir = path.join(root, `case-${counter++}`);
  await nodeFs.mkdir(dir, { recursive: true });
  return { dir, file: path.join(dir, 'data.json') };
}

after(async () => {
  await nodeFs.rm(root, { recursive: true, force: true });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wrap real fs; readFile and rename wait a delay taken from the list first. */
function delayedFs(delays) {
  let i = 0;
  const next = () => delays[i++ % delays.length];
  return {
    mkdir: (...a) => nodeFs.mkdir(...a),
    open: (...a) => nodeFs.open(...a),
    unlink: (...a) => nodeFs.unlink(...a),
    readFile: async (...a) => {
      await sleep(next());
      const out = await nodeFs.readFile(...a);
      await sleep(next());
      return out;
    },
    rename: async (...a) => {
      await sleep(next());
      return nodeFs.rename(...a);
    },
  };
}

/**
 * Feature: super-pages, Property 25: Concurrent writes lose nothing
 * **Validates: Requirements 4.10, 14.4, 14.8**
 */
test('Property 25: concurrent appends keep every record exactly once', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 2, max: 10 }),
      fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 20 }),
      async (n, delays) => {
        const { file } = await freshPath();
        const fs = delayedFs(delays);
        const records = Array.from({ length: n }, (_, k) => ({ id: `rec-${k}` }));

        const writes = records.map((rec) =>
          updateJsonFile(
            file,
            (current) => {
              current.push(rec);
            },
            { fs, fallback: [] }
          )
        );

        // The file must always parse as JSON while writes are in flight.
        let watching = true;
        const watcher = (async () => {
          while (watching) {
            try {
              JSON.parse(await nodeFs.readFile(file, 'utf8'));
            } catch (err) {
              if (err.code !== 'ENOENT') throw err;
            }
            await sleep(1);
          }
        })();

        try {
          await Promise.all(writes);
        } finally {
          watching = false;
          await watcher;
        }

        const final = JSON.parse(await nodeFs.readFile(file, 'utf8'));
        assert.ok(Array.isArray(final));
        assert.equal(final.length, n);
        assert.deepEqual(
          final.map((r) => r.id).sort(),
          records.map((r) => r.id).sort()
        );
      }
    ),
    { numRuns: 25 }
  );
});

test('mutator may return a new value instead of mutating in place', async () => {
  const { file } = await freshPath();
  const written = await updateJsonFile(file, (cur) => [...cur, 'a']);
  assert.deepEqual(written, ['a']);
  assert.deepEqual(await readJsonFile(file, null), ['a']);
});

test('missing file reads as the fallback', async () => {
  const { file } = await freshPath();
  assert.deepEqual(await readJsonFile(file, { fallback: true }), { fallback: true });
  assert.deepEqual(await readJsonFile(file, []), []);
});

test('failed rename leaves previous content intact and removes the temp file', async () => {
  const { dir, file } = await freshPath();
  await updateJsonFile(file, (cur) => {
    cur.push('original');
  });
  const before = await nodeFs.readFile(file, 'utf8');

  const failingFs = {
    mkdir: (...a) => nodeFs.mkdir(...a),
    open: (...a) => nodeFs.open(...a),
    unlink: (...a) => nodeFs.unlink(...a),
    readFile: (...a) => nodeFs.readFile(...a),
    rename: async () => {
      throw Object.assign(new Error('injected failure'), { code: 'EIO' });
    },
  };

  await assert.rejects(
    updateJsonFile(file, (cur) => {
      cur.push('new');
    }, { fs: failingFs }),
    (err) => err instanceof StoreError
  );

  assert.equal(await nodeFs.readFile(file, 'utf8'), before);
  assert.deepEqual(await nodeFs.readdir(dir), ['data.json']);
});

test('corrupt file is not overwritten and the update rejects', async () => {
  const { file } = await freshPath();
  const corrupt = '{ this is not json';
  await nodeFs.writeFile(file, corrupt, 'utf8');

  let called = false;
  await assert.rejects(
    updateJsonFile(file, (cur) => {
      called = true;
      cur.push('x');
    }),
    (err) => err instanceof StoreError
  );
  assert.equal(called, false);
  assert.equal(await nodeFs.readFile(file, 'utf8'), corrupt);

  await assert.rejects(readJsonFile(file, []), (err) => err instanceof StoreError);
});

test('a failed write does not block later writes', async () => {
  const { dir, file } = await freshPath();
  let failNext = true;
  const flakyFs = {
    mkdir: (...a) => nodeFs.mkdir(...a),
    open: (...a) => nodeFs.open(...a),
    unlink: (...a) => nodeFs.unlink(...a),
    readFile: (...a) => nodeFs.readFile(...a),
    rename: async (...a) => {
      if (failNext) {
        failNext = false;
        throw Object.assign(new Error('injected failure'), { code: 'EIO' });
      }
      return nodeFs.rename(...a);
    },
  };

  const first = updateJsonFile(file, (cur) => {
    cur.push('lost');
  }, { fs: flakyFs });
  const second = updateJsonFile(file, (cur) => {
    cur.push('kept');
  }, { fs: flakyFs });

  await assert.rejects(first, (err) => err instanceof StoreError);
  await second;

  assert.deepEqual(JSON.parse(await nodeFs.readFile(file, 'utf8')), ['kept']);
  assert.deepEqual(await nodeFs.readdir(dir), ['data.json']);
});
