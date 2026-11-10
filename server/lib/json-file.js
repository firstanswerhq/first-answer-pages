// The only module that writes JSON files.
// Per-path write queue plus atomic write (temp file, fsync, rename).

import nodeFs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [10, 25, 50];

/** Error raised for unreadable, corrupt, or unwritable stores. */
export class StoreError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown, path?: string, code?: string }} [info]
   */
  constructor(message, info = {}) {
    super(message, info.cause !== undefined ? { cause: info.cause } : undefined);
    this.name = 'StoreError';
    this.path = info.path;
    this.code = info.code;
  }
}

// Module-level so two stores on one directory in this process still serialize.
const queues = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read and parse a file. Returns undefined when the file does not exist. */
async function readParsed(filePath, fs) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return undefined;
    throw new StoreError(`Cannot read ${filePath}`, { cause: err, path: filePath, code: err?.code });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new StoreError(`Invalid JSON in ${filePath}`, { cause: err, path: filePath, code: 'EBADJSON' });
  }
}

/**
 * Read a JSON file. Missing file returns the fallback; bad JSON throws StoreError.
 * @param {string} filePath
 * @param {*} fallback
 * @param {{ fs?: object }} [options]
 */
export async function readJsonFile(filePath, fallback, { fs = nodeFs } = {}) {
  const value = await readParsed(path.resolve(filePath), fs);
  return value === undefined ? fallback : value;
}

/** Write text to a temp file in the same directory, fsync it, rename over target. */
async function atomicWrite(target, text, fs) {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, target);
        return;
      } catch (err) {
        if (attempt < RETRY_DELAYS_MS.length && err && RETRY_CODES.has(err.code)) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    try {
      await fs.unlink(tmp);
    } catch {
      // temp file may not exist; nothing more to clean up
    }
    if (err instanceof StoreError) throw err;
    throw new StoreError(`Cannot write ${target}`, { cause: err, path: target, code: err?.code });
  }
}

/**
 * Queued read-modify-write.
 * The mutator receives the freshly read value (or options.fallback when the file
 * is missing, default []). It returns the new value to write; if it returns
 * undefined, the (possibly mutated in place) current value is written.
 * Resolves to the value written. A throwing mutator or bad JSON aborts the
 * update and leaves the file untouched.
 * @param {string} filePath
 * @param {(current: *) => * | Promise<*>} mutator
 * @param {{ fs?: object, fallback?: * }} [options]
 */
export function updateJsonFile(filePath, mutator, { fs = nodeFs, fallback = [] } = {}) {
  const key = path.resolve(filePath);

  const run = async () => {
    const existing = await readParsed(key, fs);
    const current = existing === undefined ? structuredClone(fallback) : existing;
    const returned = await mutator(current);
    const next = returned === undefined ? current : returned;
    await atomicWrite(key, JSON.stringify(next, null, 2) + '\n', fs);
    return next;
  };

  const tail = queues.get(key) ?? Promise.resolve();
  const result = tail.then(run);
  const newTail = result.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, newTail);
  newTail.then(() => {
    if (queues.get(key) === newTail) queues.delete(key);
  });
  return result;
}
