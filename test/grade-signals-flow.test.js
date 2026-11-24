/**
 * high-tech-look Step 1, through the whole check: the new signals are worked out once, saved with the Grade, read
 * again on a recheck without a second paid lookup, never change the score, and never stop the report. The network is
 * always fake: the safe fetcher serves a made-up site, and the Google and Bing lookups are fakes.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { createAiBudget } from '../server/lib/ai-budget.js';

const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };

const HOME = `<!doctype html><html><head><title>Zephyr Plumbing | Plumbers in Nashville, TN</title></head><body>
<h1>Zephyr Plumbing</h1>
<p>We are plumbers serving Nashville. Call (615) 555-0142. ${'We fix pipes and drains. '.repeat(15)}</p>
<h2>How much does a drain cleaning cost?</h2><p>It depends.</p><h2>Do you work on weekends?</h2><p>Yes.</p>
<a href="/plumbing-repair">Plumbing repair</a> <a href="/water-heater-plumbing">Water heater plumbing</a>
<a href="https://www.facebook.com/ZephyrPlumbing">Facebook</a> <a href="tel:+16155550142">Call now</a>
</body></html>`;
const SITEMAP = '<?xml version="1.0"?><urlset><url><loc>https://zephyr.example/</loc><lastmod>2026-10-01</lastmod></url></urlset>';
const NOT_NAMED = '1. Other Co\n2. Another Co';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

/** A made-up website: `routes` maps a path to { status, text }; anything else is a 404. Every request is recorded. */
function fakeSite(routes) {
  const fetcher = {
    calls: [],
    async fetchText(url) {
      fetcher.calls.push(url);
      const u = new URL(url);
      const route = routes[u.pathname];
      if (typeof route === 'function') return route(url);
      if (!route) return { status: 404, text: 'Not found', contentType: 'text/plain', finalUrl: url };
      return { status: route.status ?? 200, text: route.text ?? '', contentType: route.contentType ?? 'text/html', finalUrl: url };
    },
  };
  return fetcher;
}

const defaultRoutes = (extra = {}) => ({
  '/': { text: HOME },
  '/robots.txt': { text: 'User-agent: *\nAllow: /\nSitemap: https://zephyr.example/sitemap-main.xml', contentType: 'text/plain' },
  '/sitemap-main.xml': { text: SITEMAP, contentType: 'application/xml' },
  ...extra,
});

/** A fake Google or Bing client that records every call. */
function fakeLookup(name, reply) {
  const client = {
    name,
    calls: [],
    async lookup(query) {
      client.calls.push(query);
      return typeof reply === 'function' ? reply(query) : reply;
    },
  };
  return client;
}

const GOOGLE_FOUND = {
  status: 'found',
  place: {
    name: 'Zephyr Plumbing LLC', address: '12 Main St, Nashville, TN 37203, USA', phone: '(615) 555-0142',
    website: 'https://zephyr.example/', hasHours: true, hoursByDay: {}, businessStatus: 'OPERATIONAL',
    primaryType: 'plumber', rating: 4.6, ratingCount: 133, newestReviewAt: new Date(NOW - 20 * 86400000).toISOString(),
  },
};
const BING_FOUND = {
  status: 'found',
  place: { name: 'Zephyr Plumbing', phone: '+1 615-555-0142', address: '12 Main Street, Nashville, TN 37203', website: 'https://zephyr.example' },
};

async function startEnv({ site, places = null, bing = null, gradeLimit = 100000, published } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-signals-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  if (published) await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  const clock = { t: NOW, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 100000, gradeLimit });
  const claude = { name: 'anthropic', calls: 0, async ask() { claude.calls += 1; return { answer: NOT_NAMED, provider: 'anthropic', model: 'stub', webSearch: true }; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    aiBudget,
    assistantProvider: claude,
    extraAssistants: [],
    nameChecker: null,
    placesLookup: places,
    bingLookup: bing,
    safeFetcher: site,
    graderTiming: { sleep: async () => {} },
    newGradeId: () => `sg${String(++n).padStart(20, '0')}`,
    config: {
      baseUrl: 'http://example.test', graderLeadGate: false, graderSecret: 'test-secret', adminToken: 'signals-token',
      gradeAiCallsPerDay: 100000, gradeMainAsks: 1, demoMode: false,
    },
  });
  cleanups.push(async () => {
    await aiBudget.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { ctx: app.locals.ctx, claude, aiBudget, clock };
}

async function until(fn, what) {
  for (let i = 0; i < 600; i += 1) {
    const value = await fn();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function check(env, input = INPUT) {
  const id = await env.ctx.grader.start(input);
  return until(async () => {
    const g = await env.ctx.grader.get(id);
    return g && g.status !== 'running' ? g : null;
  }, 'the check');
}

test('the signals are saved with the Grade: one Google lookup, one Bing search, and the sitemap named in robots.txt', async () => {
  const site = fakeSite(defaultRoutes());
  const places = fakeLookup('places', GOOGLE_FOUND);
  const bing = fakeLookup('bing', BING_FOUND);
  const env = await startEnv({ site, places, bing });
  const g = await check(env);
  assert.equal(g.status, 'done');
  assert.equal(places.calls.length, 1, 'one Google lookup');
  assert.equal(bing.calls.length, 1, 'one Bing search');
  assert.deepEqual(places.calls[0], { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', website: 'https://zephyr.example/' });
  // The sitemap: the address in robots.txt, asked for once, and /sitemap.xml not asked for.
  assert.equal(site.calls.filter(u => u.endsWith('/sitemap-main.xml')).length, 1);
  assert.equal(site.calls.some(u => u.endsWith('/sitemap.xml')), false);
  // What was saved.
  assert.equal(g.profiles.places.status, 'found');
  assert.equal(g.profiles.bing.status, 'found');
  assert.equal(g.signals.version, 1);
  assert.equal(g.signals.website.sitemap.label, 'Found');
  assert.equal(g.signals.website.answersQuestions.status, 'good');
  assert.equal(g.signals.google.found.label, 'Found on Google');
  assert.equal(g.signals.google.reviewCount.status, 'good');
  assert.equal(g.signals.google.phoneMatch.status, 'good');
  assert.equal(g.signals.bing.found.status, 'good');
  assert.equal(g.signals.links.facebook.status, 'good');
  assert.equal(g.signals.links.yelp.status, 'partly');
  assert.equal(g.signals.listing.listed.label, 'Not listed yet');
  // Each lookup is one paid call, counted with the AI question (1 here): 3 in all.
  assert.equal(env.aiBudget.usage({ kind: 'grade' }).used, 3);
  // Saved and read back the same.
  const again = await env.ctx.grader.get(g.id);
  assert.deepEqual(again.signals, g.signals);
});

test('with no Sitemap line in robots.txt, /sitemap.xml is asked for once', async () => {
  const site = fakeSite(defaultRoutes({
    '/robots.txt': { text: 'User-agent: *\nAllow: /', contentType: 'text/plain' },
    '/sitemap.xml': { text: SITEMAP, contentType: 'application/xml' },
  }));
  const g = await check(await startEnv({ site }));
  assert.equal(site.calls.filter(u => u.endsWith('/sitemap.xml')).length, 1);
  assert.equal(g.signals.website.sitemap.status, 'good');
  assert.equal(g.status, 'done');
});

test('a site with no sitemap says Not found; a site that blocks the request says Not checked; the report is still made', async () => {
  const none = await check(await startEnv({ site: fakeSite(defaultRoutes({ '/robots.txt': { text: 'User-agent: *\nAllow: /', contentType: 'text/plain' } })) }));
  assert.equal(none.status, 'done');
  assert.equal(none.signals.website.sitemap.status, 'missing');
  assert.equal(none.signals.website.sitemap.label, 'Not found');
  const blocked = await check(await startEnv({ site: fakeSite(defaultRoutes({ '/sitemap-main.xml': { status: 403, text: 'no' } })) }));
  assert.equal(blocked.status, 'done');
  assert.equal(blocked.signals.website.sitemap.status, 'not_checked');
  const down = await check(await startEnv({ site: fakeSite(defaultRoutes({ '/sitemap-main.xml': () => { throw Object.assign(new Error('x'), { code: 'timeout' }); } })) }));
  assert.equal(down.signals.website.sitemap.status, 'not_checked');
  assert.equal(down.status, 'done');
});

test('the signals never change the score or the Checks: the same site with and without lookups and a sitemap', async () => {
  const withEverything = await check(await startEnv({ site: fakeSite(defaultRoutes()), places: fakeLookup('places', GOOGLE_FOUND), bing: fakeLookup('bing', BING_FOUND) }));
  const bare = await check(await startEnv({ site: fakeSite(defaultRoutes({ '/robots.txt': { text: 'User-agent: *\nAllow: /', contentType: 'text/plain' }, '/sitemap-main.xml': { status: 404, text: '' } })) }));
  assert.deepEqual(withEverything.results, bare.results);
  assert.deepEqual(withEverything.score, bare.score);
  assert.equal(withEverything.results.length, bare.results.length);
  assert.notDeepEqual(withEverything.signals, bare.signals, 'the signals themselves differ');
});

test('without keys (no lookups) every Google and Bing signal is Not checked, and the check is the same otherwise', async () => {
  const g = await check(await startEnv({ site: fakeSite(defaultRoutes()) }));
  assert.equal(g.profiles.places.status, 'off');
  assert.equal(g.profiles.bing.status, 'off');
  for (const [id, s] of Object.entries(g.signals.google)) assert.equal(s.status, 'not_checked', id);
  for (const [id, s] of Object.entries(g.signals.bing)) assert.equal(s.status, 'not_checked', id);
  assert.equal(g.signals.google.found.reason, "Google lookups aren't turned on here.");
});

test('a lookup that fails or throws never stops the report, and nothing about it is red', async () => {
  const places = fakeLookup('places', () => { throw new Error('boom: secret details'); });
  const bing = fakeLookup('bing', { status: 'error', reason: "We couldn't reach Bing this time." });
  const g = await check(await startEnv({ site: fakeSite(defaultRoutes()), places, bing }));
  assert.equal(g.status, 'done');
  assert.equal(g.profiles.places.status, 'error');
  assert.equal(JSON.stringify(g).includes('secret details'), false, 'no raw error text is saved');
  for (const [id, s] of Object.entries(g.signals.google)) assert.equal(s.status, 'not_checked', id);
  assert.equal(g.signals.bing.found.reason, "We couldn't reach Bing this time.");
  assert.ok(Number.isInteger(g.score.score), 'the score is still worked out');
});

test('the lookups never use the day\'s last calls: with 12 left they are skipped and the AI question is still asked', async () => {
  const places = fakeLookup('places', GOOGLE_FOUND);
  const bing = fakeLookup('bing', BING_FOUND);
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places, bing, gradeLimit: 12 });
  const g = await check(env);
  assert.equal(places.calls.length, 0);
  assert.equal(bing.calls.length, 0);
  assert.equal(g.profiles.places.status, 'limit');
  assert.equal(g.signals.google.found.status, 'not_checked');
  assert.match(g.signals.google.found.reason, /Today's limit for AI questions/);
  assert.equal(env.claude.calls, 1, 'the AI question was asked');
  assert.equal(g.ai.length, 1);
});

test('a recheck reads the website again and reuses the saved lookups: no second Google or Bing call', async () => {
  const site = fakeSite(defaultRoutes());
  const places = fakeLookup('places', GOOGLE_FOUND);
  const bing = fakeLookup('bing', BING_FOUND);
  const env = await startEnv({ site, places, bing });
  const g = await check(env);
  const before = env.aiBudget.usage({ kind: 'grade' }).used;
  const sitemapAsks = site.calls.filter(u => u.endsWith('/sitemap-main.xml')).length;
  assert.deepEqual(await env.ctx.grader.recheck(g.id), { started: true });
  const after = await until(async () => {
    const x = await env.ctx.grader.get(g.id);
    return x.recheckedAt && !x.recheckRunning ? x : null;
  }, 'the recheck');
  assert.equal(places.calls.length, 1);
  assert.equal(bing.calls.length, 1);
  assert.equal(env.aiBudget.usage({ kind: 'grade' }).used, before, 'no new paid call');
  assert.equal(site.calls.filter(u => u.endsWith('/sitemap-main.xml')).length, sitemapAsks + 1, 'the website is read again');
  assert.equal(after.signals.google.found.status, 'good');
  assert.deepEqual(after.profiles, g.profiles);
});

test('a site that times out or blocks us gives gray website signals, and the lookups still work', async () => {
  const timeout = Object.assign(new Error('timed out'), { code: 'timeout' });
  const down = fakeSite({ '/': () => { throw timeout; }, '/robots.txt': () => { throw timeout; }, '/sitemap.xml': () => { throw timeout; } });
  const places = fakeLookup('places', GOOGLE_FOUND);
  const g = await check(await startEnv({ site: down, places }));
  assert.equal(g.status, 'done');
  for (const id of ['wordsInPage', 'saysWhatYouDo', 'saysWhereYouWork', 'answersQuestions', 'pagePerService']) {
    assert.equal(g.signals.website[id].status, 'not_checked', id);
  }
  assert.equal(g.signals.website.sitemap.status, 'not_checked');
  assert.equal(g.signals.google.found.status, 'good');
  assert.equal(g.signals.links.facebook.status, 'not_checked');
  const blocked = await check(await startEnv({ site: fakeSite({
    '/': { status: 403, text: 'Forbidden' }, '/robots.txt': { status: 403, text: '' }, '/sitemap.xml': { status: 403, text: '' },
  }) }));
  assert.equal(blocked.status, 'done');
  assert.equal(blocked.signals.website.saysWhatYouDo.status, 'not_checked');
  assert.equal(blocked.signals.website.sitemap.status, 'not_checked');
});

test('a business with no website still gets its Google signals; the website ones are Not checked', async () => {
  const places = fakeLookup('places', GOOGLE_FOUND);
  const g = await check(await startEnv({ site: fakeSite({}), places }), { ...INPUT, website: '' });
  assert.equal(g.status, 'done');
  assert.equal(places.calls.length, 1);
  assert.equal(places.calls[0].website, undefined);
  assert.equal(g.signals.google.found.status, 'good');
  assert.equal(g.signals.google.linksToWebsite.status, 'not_checked');
  assert.equal(g.signals.website.sitemap.reason, 'No website given.');
  assert.equal(g.signals.links.facebook.reason, 'No website given.');
});

test('a published listing of the business is found, with its Verified and Founding Member state', async () => {
  const listing = {
    id: 'zephyr-plumbing-nashville', name: 'Zephyr Plumbing', category: 'plumbers', phone: '(615) 555-0142',
    description: 'We fix pipes and drains.', city: 'Nashville', state: 'TN', services: ['Drain cleaning'],
    serviceArea: 'Nashville', hours: { monday: '8am-5pm' }, address: '12 Main Street, Nashville, TN 37203',
    website: 'https://zephyr.example/',
  };
  const g = await check(await startEnv({ site: fakeSite(defaultRoutes()), published: [listing] }));
  assert.equal(g.signals.listing.listed.status, 'good');
  assert.equal(g.signals.listing.listed.listingId, 'zephyr-plumbing-nashville');
  assert.equal(g.signals.listing.matchesWebsite.status, 'good');
  assert.equal(g.signals.listing.linksToWebsite.label, 'Linked');
  assert.equal(g.signals.listing.verified.label, 'Not verified yet');
  // Another business in the same city is not this one.
  const other = await check(await startEnv({ site: fakeSite(defaultRoutes()), published: [{ ...listing, name: 'Ridgeline Roofing' }] }));
  assert.equal(other.signals.listing.listed.label, 'Not listed yet');
});
