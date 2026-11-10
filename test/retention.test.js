// Tests for retention rules (pruneQuotes, pruneDrafts), store.pruneExpired,
// and notifier memory caps.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';

import {
  pruneQuotes,
  pruneDrafts,
  QUOTE_RETENTION_DAYS,
  DRAFT_EXPIRY_DAYS,
} from '../server/lib/retention.js';
import { createDataStore } from '../server/data.js';
import {
  createMockNotifier,
  createConsoleNotifier,
  createNotifier,
} from '../server/lib/notifier.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2025-06-01T00:00:00.000Z');
const iso = ms => new Date(ms).toISOString();

// ---- generators --------------------------------------------------------------

// createdAt: mostly valid ISO strings 0..400 days old, sometimes missing/invalid.
const createdAtArb = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 0, max: 400 * DAY }).map(off => iso(NOW - off)) },
  { weight: 1, arbitrary: fc.constantFrom(undefined, null, '', 'not a date', 'yesterday', 42) },
);

const quoteArb = fc.record({ id: fc.uuid(), createdAt: createdAtArb }, { requiredKeys: ['id'] });

const STATUSES = ['draft', 'rejected', 'pending', 'publishing', 'published'];
const draftArb = fc.record({
  id: fc.uuid(),
  status: fc.constantFrom(...STATUSES),
  createdAt: createdAtArb,
});

// Independent oracles.
function validTime(createdAt) {
  if (typeof createdAt !== 'string') return null;
  const t = Date.parse(createdAt);
  return Number.isNaN(t) ? null : t;
}
const quoteSurvives = q => {
  const t = validTime(q.createdAt);
  return t === null || NOW - t < QUOTE_RETENTION_DAYS * DAY;
};
const draftSurvives = (d, pendingIds = new Set()) => {
  if (d.status !== 'draft' && d.status !== 'rejected') return true;
  if (pendingIds.has(d.id)) return true;
  const t = validTime(d.createdAt);
  return t === null || NOW - t < DRAFT_EXPIRY_DAYS * DAY;
};

describe('retention constants', () => {
  test('quotes 180 days, drafts 30 days', () => {
    assert.equal(QUOTE_RETENTION_DAYS, 180);
    assert.equal(DRAFT_EXPIRY_DAYS, 30);
  });
});

describe('pruneQuotes', () => {
  test('property: keeps exactly the survivors, in order, without mutating input', () => {
    fc.assert(
      fc.property(fc.array(quoteArb, { maxLength: 30 }), list => {
        const snapshot = structuredClone(list);
        const out = pruneQuotes(list, NOW);
        assert.deepEqual(list, snapshot);
        assert.deepEqual(out, list.filter(quoteSurvives));
      }),
      { numRuns: 100 },
    );
  });

  test('property: quotes with missing or invalid createdAt are kept', () => {
    const badArb = fc.record(
      { id: fc.uuid(), createdAt: fc.constantFrom(undefined, null, '', 'garbage', 7) },
      { requiredKeys: ['id'] },
    );
    fc.assert(
      fc.property(fc.array(badArb, { maxLength: 20 }), list => {
        assert.equal(pruneQuotes(list, NOW).length, list.length);
      }),
      { numRuns: 100 },
    );
  });

  test('property: idempotent', () => {
    fc.assert(
      fc.property(fc.array(quoteArb, { maxLength: 30 }), list => {
        const once = pruneQuotes(list, NOW);
        assert.deepEqual(pruneQuotes(once, NOW), once);
      }),
      { numRuns: 100 },
    );
  });

  test('boundary: exactly 180 days is removed, 1 ms younger is kept', () => {
    const exact = { id: 'a', createdAt: iso(NOW - 180 * DAY) };
    const younger = { id: 'b', createdAt: iso(NOW - 180 * DAY + 1) };
    assert.deepEqual(pruneQuotes([exact, younger], NOW), [younger]);
  });
});

describe('pruneDrafts', () => {
  test('property: removes exactly old draft/rejected drafts, in order, no mutation', () => {
    fc.assert(
      fc.property(fc.array(draftArb, { maxLength: 30 }), list => {
        const snapshot = structuredClone(list);
        const out = pruneDrafts(list, NOW);
        assert.deepEqual(list, snapshot);
        assert.deepEqual(out, list.filter(d => draftSurvives(d)));
      }),
      { numRuns: 100 },
    );
  });

  test('property: pending, publishing, published are never removed regardless of age', () => {
    const protectedArb = fc.record({
      id: fc.uuid(),
      status: fc.constantFrom('pending', 'publishing', 'published'),
      createdAt: fc.integer({ min: 0, max: 2000 * DAY }).map(off => iso(NOW - off)),
    });
    fc.assert(
      fc.property(fc.array(protectedArb, { maxLength: 20 }), list => {
        assert.deepEqual(pruneDrafts(list, NOW), list);
      }),
      { numRuns: 100 },
    );
  });

  test('property: drafts with invalid createdAt are kept', () => {
    const badArb = fc.record({
      id: fc.uuid(),
      status: fc.constantFrom('draft', 'rejected'),
      createdAt: fc.constantFrom(undefined, null, '', 'garbage', 7),
    }, { requiredKeys: ['id', 'status'] });
    fc.assert(
      fc.property(fc.array(badArb, { maxLength: 20 }), list => {
        assert.deepEqual(pruneDrafts(list, NOW), list);
      }),
      { numRuns: 100 },
    );
  });

  test('property: a draft with a pending-status entry is never expired', () => {
    fc.assert(
      fc.property(
        fc.array(draftArb, { maxLength: 20 }),
        fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
        fc.array(fc.constantFrom('pending', 'approved', 'rejected', 'unpublished'), { minLength: 20, maxLength: 20 }),
        (list, flags, statuses) => {
          const pending = [];
          const ids = new Set();
          list.forEach((d, i) => {
            if (!flags[i]) return;
            pending.push({ id: d.id, draftId: d.id, status: statuses[i] });
            if (statuses[i] === 'pending') ids.add(d.id);
          });
          const out = pruneDrafts(list, NOW, pending);
          assert.deepEqual(out, list.filter(d => draftSurvives(d, ids)));
        },
      ),
      { numRuns: 100 },
    );
  });

  test('property: idempotent', () => {
    fc.assert(
      fc.property(fc.array(draftArb, { maxLength: 30 }), list => {
        const once = pruneDrafts(list, NOW);
        assert.deepEqual(pruneDrafts(once, NOW), once);
      }),
      { numRuns: 100 },
    );
  });

  test('boundary: exactly 30 days is removed, 1 ms younger is kept', () => {
    const exact = { id: 'a', status: 'draft', createdAt: iso(NOW - 30 * DAY) };
    const younger = { id: 'b', status: 'rejected', createdAt: iso(NOW - 30 * DAY + 1) };
    assert.deepEqual(pruneDrafts([exact, younger], NOW), [younger]);
  });

  test('pending entry matched by draftId or id protects an old draft; non-pending entry does not', () => {
    const old = iso(NOW - 90 * DAY);
    const list = [
      { id: 'd1', status: 'draft', createdAt: old },
      { id: 'd2', status: 'draft', createdAt: old },
      { id: 'd3', status: 'rejected', createdAt: old },
    ];
    const pending = [
      { draftId: 'd1', status: 'pending' },
      { id: 'd2', status: 'pending' },
      { draftId: 'd3', status: 'rejected' },
    ];
    assert.deepEqual(pruneDrafts(list, NOW, pending).map(d => d.id), ['d1', 'd2']);
  });
});

describe('store.pruneExpired', () => {
  let dir;
  let n = 0;
  const fixedClock = { now: () => new Date(NOW) };

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-test-'));
  });
  after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function freshDir() {
    const d = path.join(dir, `case-${n++}`);
    await fs.mkdir(d, { recursive: true });
    return d;
  }
  const writeJson = (d, name, value) => fs.writeFile(path.join(d, name), JSON.stringify(value, null, 2) + '\n');
  const readText = (d, name) => fs.readFile(path.join(d, name), 'utf8');
  const exists = async p => fs.access(p).then(() => true, () => false);

  test('removes expired entries, returns counts, second call changes nothing', async () => {
    const d = await freshDir();
    const quotes = [
      { id: 'q-old', createdAt: iso(NOW - 200 * DAY) },
      { id: 'q-new', createdAt: iso(NOW - 10 * DAY) },
      { id: 'q-bad', createdAt: 'nope' },
    ];
    const drafts = [
      { id: 'd-old', status: 'draft', createdAt: iso(NOW - 40 * DAY) },
      { id: 'd-old-rej', status: 'rejected', createdAt: iso(NOW - 31 * DAY) },
      { id: 'd-old-pend', status: 'draft', createdAt: iso(NOW - 40 * DAY) },
      { id: 'd-old-pub', status: 'published', createdAt: iso(NOW - 400 * DAY) },
      { id: 'd-new', status: 'draft', createdAt: iso(NOW - 5 * DAY) },
    ];
    const pending = [{ id: 'd-old-pend', draftId: 'd-old-pend', status: 'pending' }];
    const published = [{ id: 'keep-me' }];
    await writeJson(d, 'quotes.json', quotes);
    await writeJson(d, 'drafts.json', drafts);
    await writeJson(d, 'pending.json', pending);
    await writeJson(d, 'published.json', published);

    const otherBefore = {
      pending: await readText(d, 'pending.json'),
      published: await readText(d, 'published.json'),
    };

    const store = createDataStore({ dataDir: d, clock: fixedClock });
    const removed = await store.pruneExpired({ quotes: true, drafts: true });
    assert.deepEqual(removed, { quotes: 1, drafts: 2 });

    assert.deepEqual(JSON.parse(await readText(d, 'quotes.json')).map(q => q.id), ['q-new', 'q-bad']);
    assert.deepEqual(
      JSON.parse(await readText(d, 'drafts.json')).map(x => x.id),
      ['d-old-pend', 'd-old-pub', 'd-new'],
    );

    // Other files untouched.
    assert.equal(await readText(d, 'pending.json'), otherBefore.pending);
    assert.equal(await readText(d, 'published.json'), otherBefore.published);

    // Second call: nothing removed, files byte-identical, mtimes unchanged (no write).
    const qText = await readText(d, 'quotes.json');
    const dText = await readText(d, 'drafts.json');
    const qMtime = (await fs.stat(path.join(d, 'quotes.json'))).mtimeMs;
    const dMtime = (await fs.stat(path.join(d, 'drafts.json'))).mtimeMs;

    const again = await store.pruneExpired({ quotes: true, drafts: true });
    assert.deepEqual(again, { quotes: 0, drafts: 0 });
    assert.equal(await readText(d, 'quotes.json'), qText);
    assert.equal(await readText(d, 'drafts.json'), dText);
    assert.equal((await fs.stat(path.join(d, 'quotes.json'))).mtimeMs, qMtime);
    assert.equal((await fs.stat(path.join(d, 'drafts.json'))).mtimeMs, dMtime);
  });

  test('only prunes the collections requested', async () => {
    const d = await freshDir();
    await writeJson(d, 'quotes.json', [{ id: 'q-old', createdAt: iso(NOW - 200 * DAY) }]);
    await writeJson(d, 'drafts.json', [{ id: 'd-old', status: 'draft', createdAt: iso(NOW - 40 * DAY) }]);
    const store = createDataStore({ dataDir: d, clock: fixedClock });
    const removed = await store.pruneExpired({ quotes: false, drafts: true });
    assert.deepEqual(removed, { quotes: 0, drafts: 1 });
    assert.equal(JSON.parse(await readText(d, 'quotes.json')).length, 1);
    assert.equal(JSON.parse(await readText(d, 'drafts.json')).length, 0);
  });

  test('missing files are not created', async () => {
    const d = await freshDir();
    const store = createDataStore({ dataDir: d, clock: fixedClock });
    const removed = await store.pruneExpired({ quotes: true, drafts: true });
    assert.deepEqual(removed, { quotes: 0, drafts: 0 });
    for (const name of ['quotes.json', 'drafts.json', 'pending.json']) {
      assert.equal(await exists(path.join(d, name)), false, `${name} should not exist`);
    }
  });
});

describe('notifier memory', () => {
  const payload = i => ({
    quote: { id: `q${i}`, name: 'N', contact: 'c', details: 'd', listingId: 'l1' },
    listing: { id: 'l1', name: 'Listing' },
  });

  test('createMockNotifier({maxSent: 3}) keeps only the newest 3 after 10 notifies', async () => {
    const n = createMockNotifier({ maxSent: 3 });
    for (let i = 0; i < 10; i++) await n.notify(payload(i));
    assert.deepEqual(n.sent.map(s => s.quote.id), ['q7', 'q8', 'q9']);
  });

  test('default createMockNotifier is unbounded', async () => {
    const n = createMockNotifier();
    for (let i = 0; i < 200; i++) await n.notify(payload(i));
    assert.equal(n.sent.length, 200);
  });

  test("createNotifier({notifierName: 'console'}) has no sent array", () => {
    const n = createNotifier({ notifierName: 'console' });
    assert.equal(n.name, 'console');
    assert.equal('sent' in n, false);
  });

  test('console notifier does not accumulate (write stub, 1000 notifies)', async () => {
    let writes = 0;
    let last = '';
    const n = createConsoleNotifier({ write: line => { writes++; last = line; } });
    for (let i = 0; i < 1000; i++) await n.notify(payload(i));
    assert.equal(writes, 1000);
    assert.equal('sent' in n, false);
    assert.deepEqual(JSON.parse(last), { event: 'quote', quoteId: 'q999', listingId: 'l1' });
  });

  test("createNotifier mock with testRun:false is capped at 50", async () => {
    const n = createNotifier({ notifierName: 'mock', testRun: false });
    for (let i = 0; i < 200; i++) await n.notify(payload(i));
    assert.ok(n.sent.length <= 50);
    assert.equal(n.sent.length, 50);
    assert.equal(n.sent.at(-1).quote.id, 'q199');
  });

  test("createNotifier mock with testRun:true is unbounded", async () => {
    const n = createNotifier({ notifierName: 'mock', testRun: true });
    for (let i = 0; i < 200; i++) await n.notify(payload(i));
    assert.equal(n.sent.length, 200);
  });
});
