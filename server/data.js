/**
 * data.js — data store
 *
 * createDataStore({ dataDir, fs, clock, validateFields, makeSlug }) builds a store
 * synchronously from JSON files in dataDir. Reads are served from an immutable
 * in-memory snapshot. Writes go only through updateJsonFile (json-file.js) and
 * only after the file rename succeeds is the snapshot swapped.
 *
 * Legacy exports (getListings, getCategories, findById, filterListings,
 * groupByCategory) delegate to a lazily created default store built from
 * DATA_DIR or the repo data/ directory.
 *
 * Draft shape this module relies on (drafts.json entries):
 *   { id, status: 'draft'|'publishing'|'published', fields: {...listing fields},
 *     reservedId?, listingId? }
 *
 * Field validation and slug creation live in ./lib/listing-fields.js (task 3.1).
 * Until that file exists, publishDraft cannot validate: it rejects with a
 * StoreError ("listing-fields unavailable") before writing anything. Tests can
 * inject `validateFields` and `makeSlug` instead. Injected/imported contracts:
 *   validateFields(fields, categories) -> { fields?, missingFields: string[] }
 *     (a bare string[] of failing field names is also accepted)
 *   makeSlug(name, city, takenIds: Set<string>) -> string
 */

import nodeFs from 'node:fs';
import path from 'node:path';
import { readJsonFile, updateJsonFile, StoreError } from './lib/json-file.js';
import { configFromEnv } from './lib/config.js';

const COLLECTIONS = new Set(['drafts', 'quotes', 'seance']);
const MODEL_KEYS = [
  'name', 'category', 'phone', 'hours', 'services', 'serviceArea',
  'description', 'city', 'state', 'address',
];

const warn = msg => process.stderr.write(`[data] ${msg}\n`);

/** Synchronous read of a JSON file. Missing -> fallback; corrupt -> throws. */
function loadSync(fsImpl, filePath, fallback) {
  const readFileSync = fsImpl.readFileSync ?? nodeFs.readFileSync;
  let text;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    throw new StoreError(`Cannot read ${filePath}`, { cause: err, path: filePath, code: err?.code });
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new StoreError(`Invalid JSON in ${filePath}`, { cause: err, path: filePath, code: 'EBADJSON' });
  }
}

function expectArray(value, filePath) {
  if (!Array.isArray(value)) {
    throw new StoreError(`Expected an array in ${filePath}`, { path: filePath, code: 'EBADSHAPE' });
  }
  return value;
}

function expectObject(value, filePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoreError(`Expected an object in ${filePath}`, { path: filePath, code: 'EBADSHAPE' });
  }
  return value;
}

const withoutComments = items => items.filter(
  item => item && typeof item === 'object' && !Object.hasOwn(item, '_comment'),
);

/** Seed first; on id collision the seed wins and the later entry is dropped. */
function mergeListings(seed, published) {
  const seen = new Set();
  const out = [];
  for (const l of seed) {
    if (!seen.has(l.id)) { seen.add(l.id); out.push(l); }
  }
  for (const l of published) {
    if (seen.has(l.id)) {
      warn(`Duplicate listing id "${l.id}" in published.json ignored; seed entry wins.`);
      continue;
    }
    seen.add(l.id);
    out.push(l);
  }
  return Object.freeze(out);
}

const defaultClock = { now: () => new Date() };

/**
 * @param {{ dataDir: string, fs?: object, clock?: { now(): Date|number },
 *           validateFields?: Function, makeSlug?: Function }} options
 */
export function createDataStore({ dataDir, fs, clock = defaultClock, validateFields, makeSlug } = {}) {
  if (typeof dataDir !== 'string' || dataDir === '') {
    throw new TypeError('createDataStore requires a dataDir');
  }
  const fsImpl = fs ?? nodeFs;
  const io = fs ? { fs } : {}; // undefined -> json-file.js default
  const file = name => path.join(dataDir, name);

  // ---- synchronous load -------------------------------------------------
  let seed;
  let categories;
  let state;

  function load() {
    seed = withoutComments(expectArray(loadSync(fsImpl, file('listings.json'), []), 'listings.json'));
    categories = Object.freeze(expectArray(loadSync(fsImpl, file('categories.json'), []), 'categories.json'));
    const published = withoutComments(
      expectArray(loadSync(fsImpl, file('published.json'), []), 'published.json'),
    );
    const verified = expectObject(loadSync(fsImpl, file('verified.json'), {}), 'verified.json');
    state = {
      published,
      verified: Object.freeze({ ...verified }),
      listings: mergeListings(seed, published),
    };
  }
  load();

  /** Replace the snapshot atomically (readers never see a partial state). */
  function swap({ published = state.published, verified = state.verified } = {}) {
    state = { published, verified, listings: mergeListings(seed, published) };
  }

  // ---- locks --------------------------------------------------------------
  const locks = new Map();
  function withLock(name, fn) {
    const tail = locks.get(name) ?? Promise.resolve();
    const result = tail.then(() => fn());
    const newTail = result.then(() => undefined, () => undefined);
    locks.set(name, newTail);
    newTail.then(() => { if (locks.get(name) === newTail) locks.delete(name); });
    return result;
  }

  // ---- collections ----------------------------------------------------------
  function collection(name) {
    if (typeof name !== 'string' || !COLLECTIONS.has(name)) {
      throw new Error(`Unknown collection: ${String(name)}`);
    }
    const target = file(`${name}.json`);
    return {
      read: () => readJsonFile(target, [], io),
      update: mutator => updateJsonFile(target, mutator, { ...io, fallback: [] }),
      append: item => updateJsonFile(target, list => { list.push(item); }, { ...io, fallback: [] }),
    };
  }

  // ---- reads ----------------------------------------------------------------
  const getListings = () => state.listings;
  const getCategories = () => categories;
  const findById = id => state.listings.find(l => l.id === id);
  const getVerifiedDate = id => (Object.hasOwn(state.verified, id) ? state.verified[id] : undefined);

  function searchListings({ category, city, query, limit } = {}) {
    const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const out = [];
    for (const l of state.listings) {
      if (category && l.category !== category) continue;
      if (city && String(l.city ?? '').toLowerCase() !== String(city).toLowerCase()) continue;
      if (q) {
        // Requirement 5.4: substring of name, description, or any service only.
        const fields = [
          l.name, l.description,
          ...(Array.isArray(l.services) ? l.services : []),
        ];
        if (!fields.some(f => typeof f === 'string' && f.toLowerCase().includes(q))) continue;
      }
      out.push(l);
      if (Number.isInteger(limit) && limit >= 0 && out.length >= limit) break;
    }
    return out;
  }

  // ---- listing-fields (lazy) ------------------------------------------------
  let fieldsApi;
  async function getFieldsApi() {
    if (fieldsApi) return fieldsApi;
    if (validateFields && makeSlug) {
      fieldsApi = { validateFields, makeSlug };
      return fieldsApi;
    }
    let mod;
    try {
      mod = await import('./lib/listing-fields.js');
    } catch (err) {
      throw new StoreError('listing-fields unavailable; cannot validate a draft', { cause: err });
    }
    fieldsApi = {
      validateFields: validateFields ?? mod.validateFields,
      makeSlug: makeSlug ?? mod.makeSlug,
    };
    return fieldsApi;
  }

  function failingFields(result, fields) {
    const list = Array.isArray(result) ? result : (result?.missingFields ?? []);
    const failing = new Set(list);
    // Safety net for design gap 1: description, city, two-letter uppercase state.
    if (typeof fields.description !== 'string' || fields.description.trim() === '') failing.add('description');
    if (typeof fields.city !== 'string' || fields.city.trim() === '') failing.add('city');
    if (typeof fields.state !== 'string' || !/^[A-Z]{2}$/.test(fields.state)) failing.add('state');
    return [...failing];
  }

  function buildListing(id, fields) {
    const listing = { id };
    for (const key of MODEL_KEYS) {
      if (fields[key] === undefined) continue;
      if (key === 'address' && (fields.address === '' || fields.address === null)) continue;
      listing[key] = structuredClone(fields[key]);
    }
    return listing;
  }

  const todayUtc = () => new Date(clock.now()).toISOString().slice(0, 10);

  // ---- publish ----------------------------------------------------------------
  /**
   * @param {string} draftId
   * @returns {Promise<{ status: number, listing?: object, missingFields?: string[], error?: string }>}
   *   status 200 ok, 404 unknown draft, 409 wrong state, 422 invalid fields.
   */
  function publishDraft(draftId) {
    return withLock('publish', async () => {
      const drafts = collection('drafts');
      const api = await getFieldsApi();

      // 1. read the draft
      const all = await drafts.read();
      const draft = Array.isArray(all) ? all.find(d => d && d.id === draftId) : undefined;
      if (!draft) return { status: 404, error: 'Draft not found' };
      if (draft.status === 'published') {
        const existing = findById(draft.listingId);
        return existing ? { status: 200, listing: existing } : { status: 409, error: 'Published listing missing' };
      }
      if (draft.status !== 'draft' && draft.status !== 'publishing') {
        return { status: 409, error: 'Draft cannot be published' };
      }

      // 2. validate; nothing written on failure
      const fields = draft.fields && typeof draft.fields === 'object' ? draft.fields : {};
      const failing = failingFields(api.validateFields(fields, categories), fields);
      if (failing.length > 0) return { status: 422, missingFields: failing };

      // 3. reserve id and mark publishing
      let id = draft.reservedId;
      if (!id) {
        const taken = new Set(state.listings.map(l => l.id));
        for (const d of all) if (d && d.reservedId) taken.add(d.reservedId);
        id = api.makeSlug(fields.name, fields.city, taken);
        await drafts.update(list => {
          const d = list.find(x => x.id === draftId);
          if (d) { d.status = 'publishing'; d.reservedId = id; }
        });
      } else if (draft.status !== 'publishing') {
        await drafts.update(list => {
          const d = list.find(x => x.id === draftId);
          if (d) d.status = 'publishing';
        });
      }

      // 4. append to published.json unless present
      let listing;
      const publishedNext = await updateJsonFile(file('published.json'), list => {
        const found = list.find(l => l && l.id === id);
        listing = found ?? buildListing(id, fields);
        if (!found) list.push(listing);
      }, { ...io, fallback: [] });

      // 5. verified date (UTC, from the clock); keep an earlier date on retry
      let date;
      const verifiedNext = await updateJsonFile(file('verified.json'), map => {
        if (!Object.hasOwn(map, id)) map[id] = todayUtc();
        date = map[id];
      }, { ...io, fallback: {} });

      // 6. mark the draft published
      await drafts.update(list => {
        const d = list.find(x => x.id === draftId);
        if (d) { d.status = 'published'; d.listingId = id; }
      });

      // 7. swap the snapshot
      swap({
        published: withoutComments(publishedNext),
        verified: Object.freeze({ ...verifiedNext }),
      });
      void date;
      return { status: 200, listing: findById(id) ?? listing };
    });
  }

  /**
   * Internal: patch a published (non-seed) listing. `id` cannot change.
   * Returns the updated listing, or undefined for an unknown/seed id.
   */
  function updatePublished(id, patch) {
    return withLock('publish', async () => {
      if (!state.published.some(l => l.id === id)) return undefined;
      const next = await updateJsonFile(file('published.json'), list => {
        const l = list.find(x => x && x.id === id);
        if (l) Object.assign(l, structuredClone(patch), { id });
      }, { ...io, fallback: [] });
      swap({ published: withoutComments(next) });
      return findById(id);
    });
  }

  /** Re-read listings, categories, published and verified from disk. */
  function reload() {
    load();
  }

  return {
    getListings, getCategories, findById, searchListings, getVerifiedDate,
    publishDraft, updatePublished, reload, withLock, collection,
  };
}

// ---------------------------------------------------------------------------
// Legacy exports backed by a lazily created default store
// ---------------------------------------------------------------------------

let defaultStore;

/** The default store, created on first use. Exits the process on load failure. */
export function getDefaultStore() {
  if (!defaultStore) {
    try {
      const { dataDir } = configFromEnv(process.env, { warn: () => {} });
      defaultStore = createDataStore({ dataDir });
    } catch (err) {
      process.stderr.write(`[data] Failed to load data files: ${err.message}\n`);
      process.exit(1);
    }
  }
  return defaultStore;
}

/** Returns the full listings array. */
export function getListings() {
  return getDefaultStore().getListings();
}

/** Returns the full categories array. */
export function getCategories() {
  return getDefaultStore().getCategories();
}

/** @param {string} id @returns {object|undefined} */
export function findById(id) {
  return getDefaultStore().findById(id);
}

/**
 * Filters listings by optional category and/or city (city is case-insensitive).
 * @param {{ category?: string, city?: string }} [filters]
 * @returns {object[]} a new array
 */
export function filterListings({ category, city } = {}) {
  return getDefaultStore().searchListings({ category, city });
}

/**
 * Groups listings into a Map keyed by category slug, in categories.json order.
 * Categories with no listings are omitted.
 * @param {object[]} listingsArray
 * @returns {Map<string, object[]>}
 */
export function groupByCategory(listingsArray) {
  return groupListings(listingsArray, getDefaultStore().getCategories());
}

/**
 * Same as groupByCategory but with an explicit categories list (used by
 * routes that hold an injected store).
 * @param {object[]} listingsArray
 * @param {{ slug: string }[]} categoryList
 * @returns {Map<string, object[]>}
 */
export function groupListings(listingsArray, categoryList) {
  const map = new Map();
  for (const { slug } of categoryList) {
    const group = listingsArray.filter(l => l.category === slug);
    if (group.length > 0) map.set(slug, group);
  }
  return map;
}
