/**
 * drafts.js — Draft_Store
 *
 * createDraftStore({ store, clock, newId }) wraps store.collection('drafts').
 * Operations return result objects instead of throwing for expected failures:
 *   { status: 200|201, draft }          success
 *   { status: 404, error }              unknown draft
 *   { status: 409, error }              draft is not in status 'draft'
 * Storage failures (StoreError) still propagate to the caller.
 *
 * Draft shape: { id, status: 'draft'|'publishing'|'published', fields,
 *   missingFields, createdAt, reservedId?, listingId? }
 * Status transitions to 'publishing'/'published' are made by store.publishDraft.
 */

import { randomUUID } from 'node:crypto';

const defaultClock = { now: () => new Date() };

const NOT_FOUND = Object.freeze({ status: 404, error: 'Draft not found' });

/**
 * @param {{ store: { collection(name: string): object },
 *           clock?: { now(): Date|number }, newId?: () => string }} options
 */
export function createDraftStore({ store, clock = defaultClock, newId = randomUUID } = {}) {
  if (!store || typeof store.collection !== 'function') {
    throw new TypeError('createDraftStore requires a store with collection()');
  }
  const drafts = () => store.collection('drafts');
  const copy = value => structuredClone(value);

  /** Create a draft with status 'draft'. */
  async function create({ fields, missingFields } = {}) {
    const draft = {
      id: newId(),
      status: 'draft',
      fields: copy(fields ?? {}),
      missingFields: Array.isArray(missingFields) ? [...missingFields] : [],
      createdAt: new Date(clock.now()).toISOString(),
    };
    await drafts().append(draft);
    return { status: 201, draft: copy(draft) };
  }

  /** Look up a draft by id. */
  async function get(id) {
    const list = await drafts().read();
    const draft = Array.isArray(list) ? list.find(d => d && d.id === id) : undefined;
    return draft ? { status: 200, draft: copy(draft) } : { ...NOT_FOUND };
  }

  /** Replace fields and missingFields; only allowed while status is 'draft'. */
  async function updateFields(id, fields, missingFields) {
    let outcome = { ...NOT_FOUND };
    await drafts().update(list => {
      const d = list.find(x => x && x.id === id);
      if (!d) return;
      if (d.status !== 'draft') {
        outcome = { status: 409, error: 'Draft can no longer be edited' };
        return;
      }
      d.fields = copy(fields ?? {});
      d.missingFields = Array.isArray(missingFields) ? [...missingFields] : [];
      outcome = { status: 200, draft: copy(d) };
    });
    return outcome;
  }

  /** Delete a draft; only drafts with status 'draft' can be discarded. */
  async function discard(id) {
    let outcome = { ...NOT_FOUND };
    await drafts().update(list => {
      const i = list.findIndex(x => x && x.id === id);
      if (i === -1) return;
      if (list[i].status !== 'draft') {
        outcome = { status: 409, error: 'Draft is being published or already published' };
        return;
      }
      const [removed] = list.splice(i, 1);
      outcome = { status: 200, draft: copy(removed) };
    });
    return outcome;
  }

  return { create, get, updateFields, discard };
}
