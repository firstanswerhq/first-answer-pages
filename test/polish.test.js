/**
 * Tests for task 21.3 (owner wording and polish).
 *
 * Every app runs on a temporary DATA_DIR (copies of the real listings.json and
 * categories.json); the repo data/ folder is never written. Requests go only to
 * the local test servers. No provider, network call, or timer is involved.
 *
 * Properties:
 *   - a query value other than '1' never shows the saved or discarded note
 *   - buildPrompt always reads "best <phrase> in <city>" with a hyphen-free phrase
 *   - makeSlug is always a clean slug and never repeats a city already in the name
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { createMockVisionProvider } from '../server/lib/vision.js';
import { createMockAssistantProvider } from '../server/lib/assistant.js';
import { DEFAULT_BASE_URL } from '../server/lib/config.js';
import { escapeHtml, listingDetail } from '../server/lib/html.js';
import { makeSlug } from '../server/lib/listing-fields.js';
import { baseUrlFor } from '../server/lib/base-url.js';
import { buildPrompt } from '../server/lib/seance.js';
import { seanceReportPage } from '../server/lib/seance-html.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO_DATA = path.join(REPO_ROOT, 'data');
const TOKEN = 'polish-test-admin-token';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const sampleListings = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'listings.json'), 'utf8'));

// ---- environment ------------------------------------------------------------

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function makeDir(files = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-polish-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  cleanups.push(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function appFor(dir, config = {}) {
  const clock = { t: Date.UTC(2025, 0, 15, 12, 0, 0), now() { return this.t; } };
  let counter = 0;
  return createApp({
    dataDir: dir,
    clock,
    newId: () => `draft-${++counter}`,
    visionProvider: createMockVisionProvider(),
    assistantProvider: createMockAssistantProvider(),
    rateLimiter: permissiveLimiter,
    config: { adminToken: TOKEN, production: false, ...config },
  });
}

/** @param {{ files?: Record<string,string>, config?: object }} [opts] */
async function makeEnv({ files = {}, config = {} } = {}) {
  const dir = await makeDir(files);
  const server = appFor(dir, config).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  });
  return { dir, base: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

const get = (env, p, headers = {}) => fetch(env.base + p, { redirect: 'manual', headers });

const postForm = (env, p, params = '', headers = {}) => fetch(env.base + p, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: params instanceof URLSearchParams ? params.toString() : params,
});

const COMPLETE = Object.freeze({
  name: 'Copper Kettle Plumbing',
  category: 'plumbers',
  phone: '(615) 555-0101',
  services: ['Leak repair', 'Water heaters'],
  serviceArea: 'Greater Springfield',
  description: 'We fix pipes, leaks, and water heaters.',
  city: 'Springfield',
  state: 'TN',
  address: '12 Mill Street',
});

function completeForm(extra = {}) {
  const p = new URLSearchParams();
  const fields = { ...COMPLETE, ...extra };
  for (const key of ['name', 'category', 'phone', 'serviceArea', 'description', 'city', 'state', 'address', 'ownerEmail']) {
    p.set(key, fields[key] ?? '');
  }
  p.set('services', fields.services.join('\n'));
  p.set('hours_monday', '7:00 AM - 5:00 PM');
  return p;
}

/** POST /rise/manual and return the draft path, e.g. /rise/drafts/draft-1. */
async function newManualDraft(env) {
  const res = await postForm(env, '/rise/manual');
  assert.equal(res.status, 303);
  return res.headers.get('location');
}

const countOf = (text, part) => text.split(part).length - 1;
const mainOf = html => html.slice(html.indexOf('<main>'), html.indexOf('</main>'));

// ---- 1. /rise wording -----------------------------------------------------------

test('GET /rise: new heading and title, no old name, no advanced or developer bits, noscript hint', async () => {
  const env = await makeEnv();
  const res = await get(env, '/rise');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>List your business free<\/h1>/);
  assert.match(html, /<title>List your business free/);
  assert.ok(!html.includes('Rise from the Grave'));
  assert.ok(!html.includes('Advanced'));
  assert.ok(!html.includes('imageBase64'));
  assert.ok(!/<textarea/i.test(html));
  assert.ok(!/curl/i.test(html));
  assert.match(html, /<noscript>[\s\S]*Photo upload needs JavaScript[\s\S]*<\/noscript>/);
});

test('the old name appears on no rendered owner page', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  const pages = [
    await (await get(env, '/rise')).text(),
    await (await get(env, '/rise?discarded=1')).text(),
    await (await get(env, draftPath)).text(),
    await (await get(env, '/rise/drafts/no-such-draft')).text(), // messagePage with the default link
    await (await postForm(env, '/rise/drafts/no-such-draft/discard')).text(),
  ];
  const unsupported = await fetch(env.base + '/rise', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello',
  });
  assert.equal(unsupported.status, 415);
  pages.push(await unsupported.text());

  // Thank-you page after a confirm.
  assert.equal((await postForm(env, `${draftPath}/confirm`, completeForm())).status, 303);
  pages.push(await (await get(env, draftPath)).text());

  for (const html of pages) assert.ok(!html.includes('Rise from the Grave'));
});

test('no .js, .css or .html file under server/ or public/ contains the old name', async () => {
  for (const top of ['server', 'public']) {
    const dir = path.join(REPO_ROOT, top);
    for (const rel of await fs.readdir(dir, { recursive: true })) {
      if (!/\.(js|css|html)$/.test(rel)) continue;
      const text = await fs.readFile(path.join(dir, rel), 'utf8');
      assert.ok(!text.includes('Rise from the Grave'), `${top}/${rel}`);
    }
  }
});

test('POST /rise with an urlencoded imageBase64 body still creates a draft', async () => {
  const env = await makeEnv();
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('tiny-polish-test-image'),
  ]);
  const res = await postForm(env, '/rise', new URLSearchParams({ imageBase64: png.toString('base64') }));
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /^\/rise\/drafts\/draft-\d+$/);
});

// ---- 2. draft page ----------------------------------------------------------------

test('draft page: tel and email inputs, saved note only after a save, review wording, discard confirmation', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);

  const html = await (await get(env, draftPath)).text();
  assert.match(html, /<input type="tel" id="f-phone"/);
  assert.match(html, /<input type="email" id="f-ownerEmail"/);
  assert.ok(html.includes('We review every listing before it goes live.'));
  assert.ok(!html.includes('This is not an ownership check'));
  assert.ok(!html.includes('saved-note'));
  assert.match(html, /<details class="discard-confirm">/);
  assert.ok(html.includes('Discard this draft?'));
  assert.match(html, /<button type="submit">Yes, discard<\/button>/);
  assert.ok(!html.includes('confirm('));
  assert.ok(!html.includes('alert('));

  const save = await postForm(env, draftPath, completeForm());
  assert.equal(save.status, 303);
  assert.equal(save.headers.get('location'), `${draftPath}?saved=1`);

  const saved = await (await get(env, `${draftPath}?saved=1`)).text();
  // At the top of the page (owner-flow fix 2), so a phone sees it after the reload.
  assert.match(saved, /<p class="notice saved-note" role="status">Saved\.<\/p>/);
  const again = await (await get(env, draftPath)).text();
  assert.ok(!again.includes('saved-note'));
});

test('confirm with missing fields shows the exact fix message', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  const res = await postForm(env, `${draftPath}/confirm`);
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.match(html, />Please fix the highlighted fields, then press Confirm again\.<\/p>/);
  assert.ok(!html.includes('This is not an ownership check'));
  assert.ok(html.includes('We review every listing before it goes live.'));
  assert.ok(!html.includes('confirm('));
  assert.ok(!html.includes('alert('));
});

test('discard redirects to /rise?discarded=1, which shows the note only with the flag', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  const res = await postForm(env, `${draftPath}/discard`);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/rise?discarded=1');

  assert.match(await (await get(env, '/rise?discarded=1')).text(), /<p class="notice" role="status">Draft discarded\.<\/p>/);
  assert.ok(!(await (await get(env, '/rise')).text()).includes('Draft discarded.'));
});

test('property: a query value other than "1" shows no saved note and no discarded note', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  await fc.assert(
    fc.asyncProperty(fc.string({ maxLength: 12 }).filter(v => v !== '1'), async value => {
      const q = encodeURIComponent(value);
      const draft = await (await get(env, `${draftPath}?saved=${q}`)).text();
      const start = await (await get(env, `/rise?discarded=${q}`)).text();
      return !draft.includes('saved-note') && !start.includes('Draft discarded.');
    }),
    { numRuns: 20 },
  );
});

// ---- 3. thank-you page ------------------------------------------------------------

test('thank-you page: one "Thanks!", the review sentence, and the hear-back sentence', async () => {
  const env = await makeEnv();
  const review = escapeHtml("We'll review your listing, usually within one business day.");
  const emailLine = escapeHtml("We'll email you when it's live.");

  const withEmail = await newManualDraft(env);
  const confirmed = await postForm(env, `${withEmail}/confirm`, completeForm({ ownerEmail: 'owner@example.test' }));
  assert.equal(confirmed.status, 303);
  const page = mainOf(await (await get(env, withEmail)).text());
  assert.equal(countOf(page, 'Thanks!'), 1);
  assert.equal(countOf(page, review), 1);
  // The old automatic-email promise is gone; the page says the owner will hear back
  // (the admin gets a ready-made email link after approve or reject).
  assert.equal(countOf(page, emailLine), 0);
  assert.equal(countOf(page, escapeHtml("If you gave us your email, we'll let you know when it's live.")), 1);

  const without = await newManualDraft(env);
  assert.equal((await postForm(env, `${without}/confirm`, completeForm({ ownerEmail: '' }))).status, 303);
  const plain = mainOf(await (await get(env, without)).text());
  assert.equal(countOf(plain, 'Thanks!'), 1);
  assert.equal(countOf(plain, review), 1);
  assert.ok(!plain.includes(emailLine));
});

// ---- 4. stamp date ----------------------------------------------------------------

test('owner-confirmed listing wraps the date in span.stamp-date, and the CSS keeps it on one line', async () => {
  const env = await makeEnv();
  const draftPath = await newManualDraft(env);
  assert.equal((await postForm(env, `${draftPath}/confirm`, completeForm())).status, 303);
  const approved = await fetch(`${env.base}/admin/pending/${draftPath.split('/').pop()}/approve`, {
    method: 'POST', headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(approved.status, 200);
  const { listingId } = await approved.json();

  const html = await (await get(env, `/listings/${listingId}`)).text();
  const match = /<span class="stamp-date">([^<]+)<\/span>/.exec(html);
  assert.ok(match, 'stamp-date span present');
  assert.match(match[1], /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);

  const css = await fs.readFile(path.join(REPO_ROOT, 'public', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.stamp-date\b[^{}]*\{[^}]*white-space:\s*nowrap/);
});

// ---- 5. hours ---------------------------------------------------------------------

const HOURS_LISTING = Object.freeze({
  id: 'hours-test-co',
  name: 'Hours Test Co',
  category: 'plumbers',
  phone: '(615) 555-0150',
  hours: { monday: '7:00 AM - 5:00 PM', tuesday: '', wednesday: '   ' },
  services: ['Pipes'],
  serviceArea: 'Nashville',
  description: 'We fix pipes.',
  city: 'Nashville',
  state: 'TN',
});

function hoursRow(html, day) {
  const m = new RegExp(`<tr><th scope="row">${day}</th><td>([^<]*)</td></tr>`).exec(html);
  return m ? m[1] : undefined;
}

// Updated by the final read: once any day is filled every day is shown, and a day the owner
// left blank reads "Call for hours", never "Closed".
test('listingDetail shows Monday and "Call for hours" for empty, blank, and missing days', () => {
  const html = listingDetail({ ...HOURS_LISTING }, undefined, { categories });
  assert.equal(hoursRow(html, 'Monday'), '7:00 AM - 5:00 PM');
  for (const day of DAY_NAMES.slice(1)) assert.equal(hoursRow(html, day), 'Call for hours', day);
  assert.ok(!html.includes('>Closed<'));
});

test('listing page: every day in the table, blank ones "Call for hours", and JSON-LD lists only Monday', async () => {
  const env = await makeEnv({
    files: { 'published.json': JSON.stringify([HOURS_LISTING]) },
    config: { baseUrl: 'http://example.test' },
  });
  const res = await get(env, `/listings/${HOURS_LISTING.id}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(hoursRow(html, 'Monday'), '7:00 AM - 5:00 PM');
  for (const day of DAY_NAMES.slice(1)) assert.equal(hoursRow(html, day), 'Call for hours', day);

  const ld = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(html);
  assert.ok(ld, 'JSON-LD block present');
  const data = JSON.parse(ld[1]);
  assert.deepEqual(data.openingHoursSpecification.map(h => h.dayOfWeek), ['Monday']);
});

// ---- 6. categories, titles, Séance prompt ---------------------------------------------

test('categories: exactly one restaurant category, and every sample listing uses a known category', () => {
  const restaurant = categories.filter(c => /restaurant/i.test(c.label) || /restaurant/i.test(c.slug));
  assert.equal(restaurant.length, 1);
  const slugs = new Set(categories.map(c => c.slug));
  for (const l of sampleListings) {
    if (l && typeof l === 'object' && l.id) assert.ok(slugs.has(l.category), `${l.id}: ${l.category}`);
  }
});

test('category page titles use the site name; the unfiltered home title is unchanged', async () => {
  const plain = await makeEnv();
  const filtered = await (await get(plain, '/?category=plumbers&city=Nashville')).text();
  assert.match(filtered, /<title>Plumbers in Nashville \| First Answer Pages<\/title>/);
  assert.match(await (await get(plain, '/')).text(), /<title>First Answer Pages: Local Business Directory<\/title>/);

  // SITE_NAME replaces the default name in every HTML page, titles included.
  const named = await makeEnv({ config: { siteName: 'Test Pages' } });
  assert.match(await (await get(named, '/?category=plumbers&city=Nashville')).text(),
    /<title>Plumbers in Nashville \| Test Pages<\/title>/);
  assert.match(await (await get(named, '/')).text(), /<title>Test Pages: Local Business Directory<\/title>/);
});

test('buildPrompt: natural phrase for every category, "businesses" for other, fallback for unknown', () => {
  for (const c of categories) {
    const prompt = buildPrompt({ category: c.slug, city: 'Nashville' }, categories);
    assert.match(prompt, /^best [a-z]+(?: [a-z]+)* in Nashville$/, c.slug);
    assert.ok(!prompt.includes('-'), c.slug);
  }
  assert.equal(buildPrompt({ category: 'auto-repair', city: 'Nashville' }, categories), 'best auto repair shops in Nashville');
  assert.equal(buildPrompt({ category: 'plumbers', city: 'Nashville' }, categories), 'best plumbers in Nashville');
  if (categories.some(c => c.slug === 'other')) {
    assert.equal(buildPrompt({ category: 'other', city: 'Nashville' }, categories), 'best businesses in Nashville');
  }
  assert.equal(buildPrompt({ category: 'no-such-slug', city: 'X' }, categories), 'best businesses in X');
});

test('property: buildPrompt starts with "best ", ends with " in <city>", and the phrase has no hyphen', () => {
  fc.assert(
    fc.property(fc.constantFrom(...categories), fc.string({ maxLength: 30 }), (category, city) => {
      const prompt = buildPrompt({ category: category.slug, city }, categories);
      const tail = ` in ${city}`;
      if (!prompt.startsWith('best ') || !prompt.endsWith(tail)) return false;
      const phrase = prompt.slice('best '.length, prompt.length - tail.length);
      return phrase !== '' && !phrase.includes('-') && phrase === phrase.toLowerCase();
    }),
    { numRuns: 100 },
  );
});

// ---- 7. Séance report --------------------------------------------------------------

const SEANCE_LISTING = { id: 'nashville-pipe-pros', name: 'Nashville Pipe Pros' };

function seanceRun(extra) {
  return {
    id: 'run-1',
    listingId: SEANCE_LISTING.id,
    prompt: 'best plumbers in Nashville',
    timestamp: '2025-01-15T12:00:00.000Z',
    answer: 'Try a local plumber.',
    named: false,
    ...extra,
  };
}

test('Séance report: a mock run never shows the word "mock"', () => {
  const html = seanceReportPage(SEANCE_LISTING, [seanceRun({ provider: 'mock', model: 'mock' })], null);
  assert.ok(!/mock/i.test(html));
  assert.ok(html.includes('Demo answer (no AI connected)'));
});

test('Séance report: an anthropic run shows its model in the meta line', () => {
  const html = seanceReportPage(SEANCE_LISTING, [seanceRun({ provider: 'anthropic', model: 'claude-x' })], null);
  assert.match(html, /<p class="seance-meta">anthropic &middot; claude-x &middot; best plumbers in Nashville/);
});

// ---- 8. listing ids ----------------------------------------------------------------

test('makeSlug: city is skipped only when it is a whole word of the name', () => {
  assert.equal(makeSlug('Bellevue Plumbing Co', 'Bellevue', new Set()), 'bellevue-plumbing-co');
  assert.equal(makeSlug('Acme Plumbing', 'Bellevue', new Set()), 'acme-plumbing-bellevue');
  assert.equal(makeSlug('Belle Plumbing', 'Bellevue', new Set()), 'belle-plumbing-bellevue');
  assert.equal(makeSlug('Acme Plumbing', 'Bellevue', new Set(['acme-plumbing-bellevue'])), 'acme-plumbing-bellevue-2');
  assert.equal(
    makeSlug('Bellevue Plumbing Co', 'Bellevue', new Set(['bellevue-plumbing-co', 'bellevue-plumbing-co-2'])),
    'bellevue-plumbing-co-3',
  );
});

const slugify = v => v.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Whole-word (hyphen-delimited) occurrences of `part` in `slug`, overlaps counted. */
function wholeWordCount(slug, part) {
  const padded = `-${slug}-`;
  const needle = `-${part}-`;
  let n = 0;
  for (let i = padded.indexOf(needle); i !== -1; i = padded.indexOf(needle, i + 1)) n += 1;
  return n;
}

test('property: makeSlug is always a clean slug and never repeats a city already in the name', () => {
  const word = fc.constantFrom('bellevue', 'plumbing', 'co', 'acme', 'nashville', 'a1', 'x');
  const name = fc.array(word, { maxLength: 6 }).map(w => w.join(' '));
  const city = fc.constantFrom('Bellevue', 'Nashville', 'New York', 'Co', 'x', '');
  fc.assert(
    fc.property(name, city, (n, c) => {
      const out = makeSlug(n, c, new Set());
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(out)) return false;
      const nameSlug = slugify(n);
      const citySlug = slugify(c);
      if (citySlug !== '' && wholeWordCount(nameSlug, citySlug) > 0) {
        if (wholeWordCount(out, citySlug) > wholeWordCount(nameSlug, citySlug)) return false;
        const doubled = `-${citySlug}-${citySlug}`;
        if (out.endsWith(doubled) && !nameSlug.endsWith(doubled)) return false;
      }
      return true;
    }),
    { numRuns: 200 },
  );
  // Arbitrary text still gives a clean slug.
  fc.assert(
    fc.property(fc.string({ maxLength: 40 }), fc.string({ maxLength: 20 }), (n, c) =>
      /^[a-z0-9]+(-[a-z0-9]+)*$/.test(makeSlug(n, c, new Set()))),
    { numRuns: 200 },
  );
});

// ---- 9. base URL -------------------------------------------------------------------

test('baseUrlFor: table of configured, local, invalid-host, and production cases', () => {
  const req = (host, protocol = 'http') => ({ protocol, get: () => host });

  assert.equal(baseUrlFor(req('127.0.0.1:4321'), { baseUrl: 'https://x.test' }), 'https://x.test');
  assert.equal(baseUrlFor(req('127.0.0.1:4321'), { baseUrl: 'https://x.test/' }), 'https://x.test');
  assert.equal(baseUrlFor(req('127.0.0.1:4321'), { baseUrl: DEFAULT_BASE_URL }), 'http://127.0.0.1:4321');
  assert.equal(baseUrlFor(req('127.0.0.1:4321', 'https'), { baseUrl: DEFAULT_BASE_URL }), 'https://127.0.0.1:4321');
  for (const bad of ['evil.test/<script>', 'a b']) {
    assert.equal(baseUrlFor(req(bad), { baseUrl: DEFAULT_BASE_URL }), DEFAULT_BASE_URL, bad);
  }
  assert.equal(baseUrlFor(req('127.0.0.1:4321'), { baseUrl: DEFAULT_BASE_URL, production: true }), DEFAULT_BASE_URL);
});

test('llms.txt and sitemap.xml use the local address when BASE_URL is the default', async () => {
  const env = await makeEnv({ config: { baseUrl: DEFAULT_BASE_URL } });
  const origin = `http://127.0.0.1:${env.port}`;

  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(llms.includes(`${origin}/listings/`));
  assert.ok(!llms.includes('localhost:3000'));

  const sitemap = await (await get(env, '/sitemap.xml')).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.length > 0);
  for (const loc of locs) assert.ok(loc.startsWith(origin), loc);
});

test('llms.txt and sitemap.xml use an explicit BASE_URL', async () => {
  const env = await makeEnv({ config: { baseUrl: 'https://pages.example.test' } });

  const llms = await (await get(env, '/llms.txt')).text();
  assert.ok(llms.includes('https://pages.example.test/listings/'));
  assert.ok(!llms.includes('127.0.0.1'));

  const sitemap = await (await get(env, '/sitemap.xml')).text();
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.ok(locs.length > 0);
  for (const loc of locs) assert.ok(loc.startsWith('https://pages.example.test'), loc);
});

// ---- 10. docs and spec text ---------------------------------------------------------

test('README documents the Render deploy and has no "Super Pages"', async () => {
  const readme = await fs.readFile(path.join(REPO_ROOT, 'README.md'), 'utf8');
  assert.match(readme, /^#{1,6} Go live on Render/m);
  for (const part of [
    'https://render.com/pricing', 'Blueprint', 'Manual Deploy', '/admin/login', '/admin/whoami',
    'TRUST_PROXY', 'ADMIN_TOKEN', 'Environment',
  ]) {
    assert.ok(readme.includes(part), part);
  }
  assert.ok(!readme.includes('Super Pages'));
});

test('spec titles do not say "Super Pages", and app.js has no "honours"', async () => {
  for (const name of ['requirements.md', 'design.md', 'tasks.md']) {
    const text = await fs.readFile(path.join(REPO_ROOT, '.kiro', 'specs', 'super-pages', name), 'utf8');
    const heading = text.split(/\r?\n/).find(line => line.startsWith('# '));
    assert.ok(heading, `${name} has a heading`);
    assert.ok(!heading.includes('Super Pages'), `${name}: ${heading}`);
  }
  const app = await fs.readFile(path.join(REPO_ROOT, 'server', 'app.js'), 'utf8');
  assert.ok(!app.includes('honours'));
});

// ---- 11. /admin/whoami and the startup log ---------------------------------------------

const bearer = { authorization: `Bearer ${TOKEN}` };

test('/admin/whoami: requires admin', async () => {
  const env = await makeEnv();
  const noToken = await get(env, '/admin/whoami');
  assert.equal(noToken.status, 401);
  assert.deepEqual(await noToken.json(), { error: 'Unauthorized' });

  const browser = await get(env, '/admin/whoami', { accept: 'text/html' });
  assert.equal(browser.status, 302);
  assert.equal(browser.headers.get('location'), '/admin/login');
});

test('/admin/whoami: HTML explains TRUST_PROXY and shows req.ip; JSON has ip, ips, trustProxy', async () => {
  const env = await makeEnv();
  const json = await (await get(env, '/admin/whoami', { ...bearer, accept: 'application/json' })).json();
  assert.equal(typeof json.ip, 'string');
  assert.ok(json.ip !== '');
  assert.ok(Array.isArray(json.ips));
  assert.equal(typeof json.trustProxy, 'string');

  const res = await get(env, '/admin/whoami', { ...bearer, accept: 'text/html' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /html/);
  const html = await res.text();
  assert.ok(html.includes('Open this page from your phone. Set TRUST_PROXY to the smallest number that shows your real IP address.'));
  assert.ok(html.includes(`<strong>${escapeHtml(json.ip)}</strong>`));
});

test('/admin/whoami: with trustProxy 1 the forwarded address is req.ip', async () => {
  const env = await makeEnv({ config: { trustProxy: 1 } });
  const res = await get(env, '/admin/whoami', {
    ...bearer, accept: 'application/json', 'x-forwarded-for': '203.0.113.7',
  });
  assert.deepEqual(await res.json(), { ip: '203.0.113.7', ips: ['203.0.113.7'], trustProxy: '1' });
});

test('/admin/whoami: a forwarded value with markup is escaped in the HTML', async () => {
  const env = await makeEnv({ config: { trustProxy: 1 } });
  const evil = '<b>x</b>';
  const html = await (await get(env, '/admin/whoami', {
    ...bearer, accept: 'text/html', 'x-forwarded-for': evil,
  })).text();
  assert.ok(!html.includes(evil));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
});

/** Runs fn (which must be synchronous) and returns everything written to stdout meanwhile. */
function captureStdout(fn) {
  const original = process.stdout.write;
  let out = '';
  process.stdout.write = chunk => { out += String(chunk); return true; };
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return out;
}

test('startup logs "trust proxy = 1" in production only', async () => {
  const dir = await makeDir();
  const production = captureStdout(() => {
    appFor(dir, {
      production: true, demoMode: false, trustProxy: 1, baseUrl: 'https://pages.example.test',
    });
  });
  assert.ok(production.includes('trust proxy = 1'));

  const development = captureStdout(() => {
    appFor(dir, { production: false, demoMode: true, trustProxy: 1, baseUrl: 'https://pages.example.test' });
  });
  assert.ok(!development.includes('trust proxy ='));
});
