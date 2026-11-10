/**
 * Tests for "type it in" (task 21.2): POST /rise/manual opens an empty draft
 * without the photo reader or the AI budget, production with no vision key
 * shows only type-it-in, and the client script's static contents.
 *
 * Apps run on temporary DATA_DIR copies of listings.json and categories.json;
 * the repo data/ folder is never written. Providers are stubs.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { RULES } from '../server/lib/rate-limiter.js';
import { createMockVisionProvider } from '../server/lib/vision.js';
import { DEMO_BANNER_TEXT } from '../server/lib/rise-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const RISE_JS = fileURLToPath(new URL('../public/js/rise.js', import.meta.url));
const TOKEN = 'rise-manual-test-token';
const START = Date.UTC(2025, 0, 15, 12, 0, 0);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

// ---- environment ------------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/** A vision stub that counts calls; `name` decides whether the routes treat it as real. */
function countingVision(name) {
  const stub = {
    name,
    calls: 0,
    async extract() {
      stub.calls += 1;
      throw new Error('the photo reader must not be called');
    },
  };
  return stub;
}

async function startEnv({ visionProvider, config = {}, rateLimiter, aiBudget } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-rise-manual-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `draft-${++n}`,
    visionProvider,
    rateLimiter,
    aiBudget,
    config: { adminToken: TOKEN, baseUrl: 'http://example.test', ...config },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, clock, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });
const postManual = env => fetch(`${env.base}/rise/manual`, { method: 'POST', redirect: 'manual' });
const bearer = { authorization: `Bearer ${TOKEN}` };

async function readJson(env, name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// ---- /rise page ---------------------------------------------------------------------

test('GET /rise with the photo reader enabled shows the "No photo? Type it in" form', async () => {
  const env = await startEnv({ visionProvider: createMockVisionProvider() });
  const res = await get(env, '/rise');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('No photo? Type it in'));
  assert.match(html, /<form[^>]*method="POST"[^>]*action="\/rise\/manual"/);
  assert.ok(html.includes('id="rise-form"'), 'the photo form is still there');
});

// ---- POST /rise/manual -----------------------------------------------------------------

test('POST /rise/manual redirects to an empty manual draft, with no photo call and no AI budget used', async () => {
  const vision = countingVision('anthropic');
  const clock = { t: START, now() { return this.t; } };
  const budget = createAiBudget({ clock, limit: 1 });
  const env = await startEnv({ visionProvider: vision, aiBudget: budget });

  const res = await postManual(env);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/rise/drafts/draft-1');

  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, 'draft-1');
  assert.equal(drafts[0].provider, 'manual');
  assert.equal(drafts[0].status, 'draft');
  assert.deepEqual(drafts[0].fields, {});

  assert.equal(vision.calls, 0, 'the vision provider was never called');
  assert.equal(budget.peek().remaining, 1, 'the AI budget was not used');
  assert.equal(budget.peek().allowed, true);

  const page = await get(env, '/rise/drafts/draft-1');
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  for (const marker of ['name="name"', 'id="f-category"', 'name="phone"', 'name="services"',
    'name="serviceArea"', 'name="description"', 'name="city"', 'name="state"', 'name="hours_monday"']) {
    assert.ok(html.includes(marker), marker);
  }
  assert.ok(html.includes('Confirm and send for review'));
  assert.ok(!html.includes('demo-banner'), 'no demo banner on a typed-in draft');
  assert.ok(!html.includes(DEMO_BANNER_TEXT));
  assert.equal(vision.calls, 0);
});

test('POST /rise/manual is rate limited with the rise rule: the (limit+1)th request gets 429', async () => {
  const env = await startEnv({ visionProvider: countingVision('anthropic') });
  assert.equal(RULES.rise.limit, 10);
  for (let i = 0; i < RULES.rise.limit; i++) {
    assert.equal((await postManual(env)).status, 303, `request ${i + 1}`);
  }
  const limited = await postManual(env);
  assert.equal(limited.status, 429);
  const retry = Number(limited.headers.get('retry-after'));
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= RULES.rise.windowMs / 1000, `retry-after ${retry}`);
  assert.match(await limited.text(), /Please wait \d+ seconds/);
  assert.equal((await readJson(env, 'drafts.json', [])).length, RULES.rise.limit, 'the limited request made no draft');

  env.clock.t += RULES.rise.windowMs + 1000;
  assert.equal((await postManual(env)).status, 303, 'allowed again after the window');
});

// ---- production with no vision key ------------------------------------------------------

const PRODUCTION = { production: true, demoMode: false };

test('production with the mock vision provider: /rise shows only type-it-in and POST /rise stays 503', async () => {
  const env = await startEnv({ visionProvider: createMockVisionProvider(), config: PRODUCTION });

  const page = await get(env, '/rise');
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('List your business free'));
  assert.match(html, /<form[^>]*method="POST"[^>]*action="\/rise\/manual"/);
  assert.ok(!html.includes('Photo listing is coming soon'));
  assert.ok(!html.includes('id="rise-form"'));
  assert.ok(!html.includes('/js/rise.js'), 'no photo script on the type-it-in page');

  const upload = await fetch(`${env.base}/rise`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'image/jpeg' },
    body: JPEG,
  });
  assert.equal(upload.status, 503);
  assert.ok((await upload.text()).includes('Photo listing is coming soon'));
  assert.deepEqual(await readJson(env, 'drafts.json', []), []);

  // Type it in still works there.
  assert.equal((await postManual(env)).status, 303);
  assert.equal((await readJson(env, 'drafts.json', []))[0].provider, 'manual');
});

test('a manual draft can be confirmed and approved in production, and the admin page says "Typed in by the owner"', async () => {
  const env = await startEnv({ visionProvider: createMockVisionProvider(), config: PRODUCTION });
  assert.equal((await postManual(env)).status, 303);

  const form = new URLSearchParams({
    name: 'Typed Plumbing',
    category: 'plumbers',
    phone: '(615) 555-0177',
    services: 'Leak repair\nDrain cleaning',
    serviceArea: 'Greater Springfield',
    description: 'We fix pipes and leaks.',
    city: 'Springfield',
    state: 'TN',
    address: '',
  });
  const confirm = await fetch(`${env.base}/rise/drafts/draft-1/confirm`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  assert.equal(confirm.status, 303, 'confirm is accepted (not blocked like a demo-reader draft)');
  assert.equal(confirm.headers.get('location'), '/rise/drafts/draft-1');

  const drafts = await readJson(env, 'drafts.json', []);
  assert.equal(drafts[0].status, 'pending');
  assert.equal(drafts[0].provider, 'manual');
  assert.equal(drafts[0].fields.name, 'Typed Plumbing');

  const pending = await get(env, '/admin/pending', bearer);
  assert.equal(pending.status, 200);
  const pendingHtml = await pending.text();
  assert.ok(pendingHtml.includes('Typed Plumbing'));
  assert.ok(pendingHtml.includes('Typed in by the owner'));
  assert.ok(!/mock/i.test(pendingHtml));

  const approve = await fetch(`${env.base}/admin/pending/draft-1/approve`, {
    method: 'POST',
    redirect: 'manual',
    headers: bearer,
  });
  assert.equal(approve.status, 200);
  const body = await approve.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.listingId, 'string');

  const listing = await get(env, `/listings/${body.listingId}`);
  assert.equal(listing.status, 200);
  assert.ok((await listing.text()).includes('Typed Plumbing'));
});

// ---- the client script (static checks only; it runs in a browser) -------------------------

test('public/js/rise.js: progress text, textContent only, and no old refusal wording', async () => {
  const src = await fs.readFile(RISE_JS, 'utf8');
  // The source may spell the ellipsis as the escape \u2026 or as the character itself.
  const escaped = String.raw`Reading your photo\u2026 this takes about 10 seconds`;
  const literal = 'Reading your photo\u2026 this takes about 10 seconds';
  assert.ok(src.includes(escaped) || src.includes(literal), 'has the Reading your photo message');
  assert.ok(src.includes('textContent'));
  assert.ok(!src.includes('innerHTML'));
  assert.ok(!src.includes('upload was refused'));
  // It shows the server's own message, read as text from the error page.
  assert.ok(src.includes('DOMParser'));
  assert.ok(src.includes('section.message'));
});
