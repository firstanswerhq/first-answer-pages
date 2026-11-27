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
import { reportPage, HEALTH_ORB_SCRIPT, HEALTH_SCAN_SCRIPT } from '../server/lib/grade-html.js';
import { csvDate } from '../server/lib/agency-report.js';

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

async function startEnv({ site, places = null, bing = null, gradeLimit = 100000, published, dir: reuseDir, at = NOW } = {}) {
  // `dir` reuses another env's data folder: a restart of the same site (what was in memory is gone).
  const dir = reuseDir ?? await fs.mkdtemp(path.join(os.tmpdir(), 'fap-signals-'));
  if (!reuseDir) {
    for (const name of ['listings.json', 'categories.json']) {
      await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
    }
  }
  if (published) await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  const clock = { t: at, now() { return this.t; } };
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
  return { ctx: app.locals.ctx, claude, aiBudget, clock, dir, app };
}

/** Recheck a Grade and wait until it is done. */
async function recheckDone(env, id) {
  const before = (await env.ctx.grader.get(id)).recheckedAt ?? null;
  assert.deepEqual(await env.ctx.grader.recheck(id), { started: true });
  return until(async () => {
    const x = await env.ctx.grader.get(id);
    return x.recheckedAt && x.recheckedAt !== before && !x.recheckRunning ? x : null;
  }, 'the recheck');
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
  // What was saved: the signals and when the lookups were made, never the lookup results themselves (S5).
  assert.equal('profiles' in g, false);
  assert.equal(g.profilesAt, new Date(NOW).toISOString());
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
  assert.equal('profiles' in g, false);
  for (const [id, s] of Object.entries(g.signals.google)) assert.equal(s.status, 'not_checked', id);
  for (const [id, s] of Object.entries(g.signals.bing)) assert.equal(s.status, 'not_checked', id);
  assert.equal(g.signals.google.found.reason, "We didn't check Google this time.");
});

test('a lookup that fails or throws never stops the report, and nothing about it is red', async () => {
  const places = fakeLookup('places', () => { throw new Error('boom: secret details'); });
  const bing = fakeLookup('bing', { status: 'error', reason: "We couldn't reach Bing this time." });
  const g = await check(await startEnv({ site: fakeSite(defaultRoutes()), places, bing }));
  assert.equal(g.status, 'done');
  assert.equal('profiles' in g, false);
  assert.equal(g.signals.google.found.reason, "We couldn't reach Google this time.", 'R13: says which lookup');
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
  assert.equal(g.signals.google.found.status, 'not_checked');
  // S14: only the reserve held them back, so the reason says that, not that the limit was reached.
  // R2: the reserve is kept for the AI questions, which is true during a new check.
  assert.equal(g.signals.google.found.reason, 'Many checks ran today, so we skipped this to leave room for the AI test. Try again tomorrow.');
  assert.equal(g.signals.bing.found.reason, 'Many checks ran today, so we skipped this to leave room for the AI test. Try again tomorrow.');
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
  assert.equal('profiles' in after, false, 'the lookup results are still not saved');
  assert.equal(after.profilesAt, g.profilesAt);
});

test('S5: the saved Grade holds no Google or Bing details; only the signals and the lookup time', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places: fakeLookup('places', GOOGLE_FOUND), bing: fakeLookup('bing', BING_FOUND) });
  const g = await check(env);
  const file = await fs.readFile(path.join(env.dir, 'grades.json'), 'utf8');
  // Google's own wording of the name and address, and its rating count, appear nowhere in the saved file.
  for (const raw of ['Zephyr Plumbing LLC', '12 Main St, Nashville, TN 37203, USA', '"ratingCount"', '"businessStatus"', '"primaryType"']) {
    assert.equal(file.includes(raw), false, raw);
  }
  assert.equal(g.signals.google.found.status, 'good');
});

test('S5: a recheck more than 30 days later makes no lookup and says to run a new check', async () => {
  const places = fakeLookup('places', GOOGLE_FOUND);
  const bing = fakeLookup('bing', BING_FOUND);
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places, bing });
  const g = await check(env);
  // Exactly 30 days later the kept lookups are still used.
  env.clock.t = NOW + 30 * 86400000;
  const within = await recheckDone(env, g.id);
  assert.equal(within.signals.google.found.status, 'good');
  // A day later they are too old.
  env.clock.t = NOW + 31 * 86400000;
  const late = await recheckDone(env, g.id);
  assert.equal(places.calls.length, 1, 'no new Google lookup');
  assert.equal(bing.calls.length, 1, 'no new Bing search');
  for (const [id, s] of Object.entries(late.signals.google)) {
    assert.equal(s.status, 'not_checked', id);
    assert.equal(s.reason, 'Run a new check to look on Google again.', id);
  }
  for (const [id, s] of Object.entries(late.signals.bing)) {
    assert.equal(s.status, 'not_checked', id);
    assert.equal(s.reason, 'Run a new check to look on Bing again.', id);
  }
  // The website signals are still read again.
  assert.equal(late.signals.website.sitemap.status, 'good');
});

test('S5: after a restart nothing of the lookups is left, so a recheck says to run a new check', async () => {
  const places = fakeLookup('places', GOOGLE_FOUND);
  const first = await startEnv({ site: fakeSite(defaultRoutes()), places });
  const g = await check(first);
  await first.aiBudget.flush?.();
  const restarted = await startEnv({ site: fakeSite(defaultRoutes()), places, dir: first.dir });
  const after = await recheckDone(restarted, g.id);
  assert.equal(places.calls.length, 1);
  assert.equal(after.signals.google.phoneMatch.reason, 'Run a new check to look on Google again.');
});

test('S5 and S14: a Grade from before the lookups existed, or one saved with raw lookups, is cleaned and read right', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()) });
  const g = await check(env);
  // Make two Grades by hand: one from before this step (no lookup time), one saved by the first build (raw lookups).
  const file = path.join(env.dir, 'grades.json');
  const list = JSON.parse(await fs.readFile(file, 'utf8'));
  const base = list.find(x => x.id === g.id);
  const old = { ...structuredClone(base), id: 'sgold00000000000000001' };
  delete old.profilesAt;
  delete old.signals;
  const raw = { ...structuredClone(base), id: 'sgraw00000000000000001', profiles: GOOGLE_FOUND };
  delete raw.profilesAt;
  await fs.writeFile(file, JSON.stringify([...list, old, raw]));
  // The restarted site has both lookups on (T6: with a lookup off, the reason says it is off instead).
  const restarted = await startEnv({
    site: fakeSite(defaultRoutes()), dir: env.dir, places: fakeLookup('places', GOOGLE_FOUND), bing: fakeLookup('bing', BING_FOUND),
  });
  const oldAfter = await recheckDone(restarted, old.id);
  assert.equal(oldAfter.signals.google.found.reason, 'This report was made before this check existed. Run a new check to see it.');
  assert.equal(oldAfter.signals.bing.found.reason, 'This report was made before this check existed. Run a new check to see it.');
  // The raw lookups saved by the first build are removed from every Grade, and their time is kept.
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  const rawAfter = saved.find(x => x.id === raw.id);
  assert.equal('profiles' in rawAfter, false);
  assert.equal(rawAfter.profilesAt, raw.finishedAt);
  assert.equal(JSON.stringify(saved).includes('Zephyr Plumbing LLC'), false);
  const rawRecheck = await recheckDone(restarted, raw.id);
  assert.equal(rawRecheck.signals.google.found.reason, 'Run a new check to look on Google again.');
});

test('Step 2: the report shows the health map under the score, with the report\'s own score and the same statuses', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places: fakeLookup('places', GOOGLE_FOUND), bing: fakeLookup('bing', BING_FOUND) });
  const g = await check(env);
  const html = reportPage(g, { leadGate: false });
  const score = /<span class="num">(\d+)<\/span>/.exec(html)?.[1];
  assert.ok(score, 'the report has a score');
  assert.equal(Number(score), g.score.score, 'the score is the stored one: the map changes nothing');
  // H1: the same number, in the score's own form.
  assert.ok(html.includes(`class="health-orb-score" data-score="${score}">Score ${score}/100</text>`), 'the orb shows the same number');
  // Order: the heading, then the health map, then "What AI says".
  assert.ok(html.indexOf('<h1>Zephyr Plumbing</h1>') < html.indexOf('<section class="health"'));
  assert.ok(html.indexOf('<section class="health"') < html.indexOf('<h2>What AI says</h2>'));
  // The AI answers node reads the report's own answers: the stub named other businesses only.
  assert.match(html, /<span class="health-group-name">AI answers:<\/span> <span class="health-status">Needs work<\/span>/);
  assert.match(html, /<strong class="health-row-name">Answer 1 \(Claude\):<\/strong> <span class="health-status">Didn(?:'|&#39;|&#x27;)t name you<\/span>/);
  assert.match(html, /<strong class="health-row-name">On Google:<\/strong> <span class="health-status">Yes<\/span>/);
  assert.match(html, /<strong class="health-row-name">Facebook:<\/strong> <span class="health-status">Linked<\/span>/);
  // J1, J2: the listing card and the rows use the same facts. The page shows the phone, so the card has it.
  assert.match(html, /<span class="phone">[^<]*555-0142<\/span>/);
  assert.equal(html.includes('Add your phone number'), false);
  assert.match(html, /<strong class="health-row-name">Tap-to-call phone number:<\/strong> <span class="health-status">Good<\/span>/);
  // The question that was asked is shown (J3).
  assert.match(html, /<p class="grade-question">The question we asked: Who are the best [^<]*Nashville, TN\?[^<]*<\/p>/);
  // Decoration only, after the content; the page keeps its noindex and title.
  assert.match(html, /<div class="health-map" id="health-map" aria-hidden="true">/);
  // A module script, so it runs only after the page is read (deferred).
  assert.ok(html.includes(`<script type="module" src="${HEALTH_ORB_SCRIPT}"></script>`));
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<title>AI Visibility Check for Zephyr Plumbing/);
  // The orb script file is there and is small.
  const js = await fs.readFile(fileURLToPath(new URL(`../public${HEALTH_ORB_SCRIPT}`, import.meta.url)), 'utf8');
  assert.ok(js.length > 0 && js.length < 12000);
});

test('J1, J2 (sparse page): the card says "Add your ..." only for what was really not found, and the rows agree', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()) });
  const g = await check(env);
  // A page whose tap-to-call link and address passed the Checks, but whose number and address could not be read.
  const sparse = structuredClone(g);
  sparse.found = { ...sparse.found, phone: '', address: '', hours: [] };
  sparse.results = sparse.results.map(r => (['tap-to-call', 'address-shown'].includes(r.id) ? { ...r, result: 'pass' } : r));
  const html = reportPage(sparse, { leadGate: false });
  assert.ok(html.includes("Add your phone number (we saw a tap-to-call link but couldn&#39;t read the number)")
    || html.includes("Add your phone number (we saw a tap-to-call link but couldn't read the number)"));
  assert.ok(/Add your street address \(we saw one on your website but couldn(?:'|&#39;|&#x27;)t copy it\)/.test(html));
  assert.match(html, /<strong class="health-row-name">Tap-to-call phone number:<\/strong> <span class="health-status">Found a link, but not the number<\/span>/);
  assert.match(html, /<strong class="health-row-name">Street address on the home page:<\/strong> <span class="health-status">Found, but not on one line<\/span>/);
  // Nothing found and nothing passed: plain "Add your ..." and red rows, never a contradiction.
  const none = structuredClone(sparse);
  none.results = none.results.map(r => (['tap-to-call', 'address-shown'].includes(r.id) ? { ...r, result: 'fail' } : r));
  const plain = reportPage(none, { leadGate: false });
  assert.ok(plain.includes('Add your phone number<') || plain.includes('Add your phone number</'));
  assert.equal(plain.includes('we saw a tap-to-call link'), false);
  assert.match(plain, /<strong class="health-row-name">Tap-to-call phone number:<\/strong> <span class="health-status">Needs work<\/span>/);
});

test('Step 2: the locked report shows the map and the statuses without the fixes; the full report adds the fixes', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places: fakeLookup('places', GOOGLE_FOUND), bing: fakeLookup('bing', { status: 'not_found' }) });
  const g = await check(env);
  const locked = reportPage(g, { leadGate: true, unlocked: false });
  const full = reportPage(g, { leadGate: true, unlocked: true });
  const section = html => /<section class="health"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
  assert.ok(section(locked).includes('Not on Bing Maps yet'));
  assert.equal(section(locked).includes('<strong>Fix:</strong>'), false);
  assert.ok(section(full).includes('<strong>Fix:</strong>'));
  // The same score either way.
  assert.equal(/<span class="num">(\d+)<\/span>/.exec(locked)?.[1], /<span class="num">(\d+)<\/span>/.exec(full)?.[1]);
});

test('Step 2: a report saved before the signals still shows the map, every new row Not checked, and the same score', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()) });
  const g = await check(env);
  const old = structuredClone(g);
  delete old.signals;
  delete old.profilesAt;
  const a = reportPage(g, { leadGate: false });
  const b = reportPage(old, { leadGate: false });
  assert.equal(/<span class="num">(\d+)<\/span>/.exec(a)?.[1], /<span class="num">(\d+)<\/span>/.exec(b)?.[1]);
  // V10: the rows say it short; one note says it with the report's own link (V244: every mention of it is a link).
  assert.match(b, /<strong class="health-row-name">Page list for search engines \(sitemap\):<\/strong> <span class="health-status">Not checked<\/span> <span class="health-why">Made before this check existed\.<\/span>/);
  assert.match(b, /<p class="health-note health-old">This report was made before these checks existed\. <a [^>]*>Run a new check<\/a> to see them\.<\/p>/);
  const healthSection = /<section class="health"[\s\S]*?<\/section>/.exec(b)?.[0] ?? '';
  assert.equal(/run a new check/i.test(healthSection.replace(/<a [^>]*>[^<]*<\/a>/g, '')), false);
  // Every section of the report is still there (nothing moved behind JavaScript).
  for (const heading of ['What AI says', 'Score by area', 'Health of your setup']) assert.ok(b.includes(heading), heading);
});

test('Requirement 12: the certificate date from the home page request is read, and the score does not change', async () => {
  const home = validTo => url => ({ status: 200, text: HOME, contentType: 'text/html', finalUrl: url, certValidTo: validTo });
  const soon = await check(await startEnv({ site: fakeSite(defaultRoutes({ '/': home(new Date(NOW + 5 * 86400000).toISOString()) })) }));
  const fine = await check(await startEnv({ site: fakeSite(defaultRoutes({ '/': home(new Date(NOW + 200 * 86400000).toISOString()) })) }));
  assert.equal(soon.signals.website.certificate.label, 'Expires in 5 days');
  assert.equal(soon.signals.website.certificate.status, 'partly');
  assert.equal(fine.signals.website.certificate.status, 'good');
  assert.equal(fine.signals.website.addressWorks.status, 'good');
  assert.deepEqual(soon.results, fine.results, 'the Checks are the same');
  assert.deepEqual(soon.score, fine.score, 'the score is the same');
  // A site that does not answer: Not checked, never red.
  const down = await check(await startEnv({ site: fakeSite(defaultRoutes({ '/': () => { throw Object.assign(new Error('x'), { code: 'timeout' }); } })) }));
  assert.equal(down.signals.website.addressWorks.status, 'not_checked');
  // The rows are in the report, under "Website basics" (batch 5 K9).
  const html = reportPage(soon, { leadGate: false });
  assert.match(html, /<h4 class="health-cluster">Website basics<\/h4>/);
  assert.match(html, /<strong class="health-row-name">Security certificate:<\/strong> <span class="health-status">Expires in 5 days<\/span>/);
  assert.ok(html.includes(`<script type="module" src="${HEALTH_SCAN_SCRIPT}"></script>`), 'the scan script is loaded (2.10)');
});

test('Requirement 13: the full report has share of voice, evidence and downloads; "Prepared by" is saved and printed', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()) });
  const g = await check(env);
  const server = env.app.listen(0, '127.0.0.1');
  cleanups.push(() => new Promise(r => server.close(r)));
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const report = await (await fetch(`${base}/grade/${g.id}`)).text();
  assert.match(report, /<h2>Who AI named, across 1 answer<\/h2>/);
  // Batch 6 fix B item 6: with one answer a plain sentence, not a "0 of 1" table.
  assert.match(report, /<p class="grade-voice-summary">The one answer didn(?:'|&#39;)t name you[^<]*\.<\/p>/);
  assert.equal(/<section class="grade-voice">[\s\S]*?<table/.test(report.split('<section class="grade-sites">')[0]), false);
  // Batch 6 item 6: the reviewers' wording, with the report's one time zone label.
  assert.match(report, /<p class="hint grade-evidence">Evidence: Claude stub, [^<]+ C[SD]T, live web search on\.<\/p>/);
  assert.ok(report.includes(`href="/grade/${g.id}/print">Print or save as PDF</a>`), 'K18');
  assert.ok(report.includes(`href="/grade/${g.id}/data.csv">Download data (CSV)</a>`));
  assert.ok(report.includes("<p>These answers didn't list their sources.</p>"));
  // The locked report has none of these.
  const locked = reportPage(g, { leadGate: true, unlocked: false });
  assert.equal(locked.includes('Print or save as PDF'), false);
  assert.equal(locked.includes('Who AI named'), false);

  const saved = await fetch(`${base}/grade/${g.id}/prepared-by`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ preparedBy: `<b>Acme</b> Agency ${'x'.repeat(80)}` }),
  });
  assert.equal(saved.status, 303);
  const stored = await env.ctx.grader.get(g.id);
  assert.equal(stored.preparedBy, `bAcme/b Agency ${'x'.repeat(80)}`.slice(0, 60));
  assert.ok(Array.from(stored.preparedBy).length <= 60);

  const print = await fetch(`${base}/grade/${g.id}/print`);
  assert.equal(print.status, 200);
  assert.match(print.headers.get('x-robots-tag') ?? '', /noindex/);
  const printText = await print.text();
  // Batch 6 item 2: "Prepared by" is the title box's kicker.
  assert.ok(printText.includes(`<span class="grade-eyebrow-sub grade-prepared-by">Prepared by ${stored.preparedBy}</span>`));
  assert.equal(printText.includes('<b>Acme'), false);

  const csv = await fetch(`${base}/grade/${g.id}/data.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /^text\/csv/);
  assert.match(csv.headers.get('content-disposition') ?? '', /attachment; filename="ai-visibility-check-/);
  const lines = (await csv.text()).split('\r\n');
  // Batch 5 K17: the header row comes first; "Prepared by" and the report's own facts are columns on every row.
  assert.ok(lines[0].startsWith('business,website,city,state,check_date,score,prepared_by,section,group,item,status,'));
  // Batch 6 item 7b: the check date in Central time, no seconds.
  assert.ok(lines[1].startsWith(`Zephyr Plumbing,https://zephyr.example/,Nashville,TN,${csvDate(g.finishedAt)},${g.score.score},${stored.preparedBy},`));
  assert.ok(lines.some(l => /,answer,,,,,,,Claude,stub,yes,"[^"]*",no,/.test(l)));
  assert.ok(lines.some(l => l.includes(',check,')), 'one row per scored check');
  assert.ok(lines.some(l => l.includes(',named,,Zephyr Plumbing,you,')), 'the checked business is a named row');
});

test('U4: lookups older than 30 days are dropped from memory when new ones are kept, even without a recheck', async () => {
  const places = fakeLookup('places', GOOGLE_FOUND);
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places });
  const a = await check(env);
  // 31 days later another check keeps its own lookups; the first Grade's are past 30 days and are dropped then.
  env.clock.t = NOW + 31 * 86400000;
  await check(env, { ...INPUT, name: 'Another Plumbing Co' });
  // Move the clock back inside the 30 days: had the old entry stayed in memory, this recheck would reuse it.
  env.clock.t = NOW + 86400000;
  const after = await recheckDone(env, a.id);
  assert.equal(after.signals.google.found.reason, 'Run a new check to look on Google again.', 'the old lookups were gone');
  assert.equal(places.calls.length, 2, 'no lookup on the recheck');
});

test('T3: no value read from Google or Bing reaches grades.json, also on mismatches and after a recheck', async () => {
  const google = {
    status: 'found',
    place: {
      ...GOOGLE_FOUND.place, phone: '(615) 555-0199', address: '14 Main St, Nashville, TN 37203, USA',
      name: 'Zephyr Plumbing and Heating Co', rating: 3.9, ratingCount: 7, newestReviewAt: '2026-01-02T03:04:05.000Z',
      hoursByDay: { monday: { opens: '09:00', closes: '17:00' } },
    },
  };
  const bingMismatch = { status: 'found', place: { name: 'Zephyr Plumbing', phone: '+1 615-555-0177', address: '77 Oak Ave, Nashville, TN 37203', website: '' } };
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places: fakeLookup('places', google), bing: fakeLookup('bing', bingMismatch) });
  const g = await check(env);
  assert.equal(g.signals.google.phoneMatch.status, 'missing', 'the mismatch is still shown');
  assert.equal(g.signals.google.rating.status, 'partly');
  const raws = ['555-0199', '14 Main St', 'Zephyr Plumbing and Heating', '2026-01-02T03:04:05', '555-0177', '77 Oak Ave'];
  const assertClean = async when => {
    const file = await fs.readFile(path.join(env.dir, 'grades.json'), 'utf8');
    for (const raw of raws) assert.equal(file.includes(raw), false, `${when}: ${raw}`);
    const saved = JSON.parse(file).find(x => x.id === g.id);
    for (const group of ['google', 'bing']) {
      for (const [id, entry] of Object.entries(saved.signals[group])) {
        for (const key of ['google', 'bing', 'rating', 'count', 'newest']) assert.equal(key in entry, false, `${when}: ${group}.${id}.${key}`);
      }
    }
  };
  await assertClean('after the check');
  await recheckDone(env, g.id);
  await assertClean('after a recheck');
});

test('T3: signals saved with Google values before this fix are cleaned the first time a check runs', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()) });
  const g = await check(env);
  const file = path.join(env.dir, 'grades.json');
  const list = JSON.parse(await fs.readFile(file, 'utf8'));
  // A copy saved by the earlier build, with Google values in its signals; it is not rechecked itself.
  const dirty = { ...structuredClone(list.find(x => x.id === g.id)), id: 'sgdirty000000000000001' };
  dirty.signals.google.phoneMatch = { id: 'phoneMatch', status: 'missing', label: "Doesn't match", fix: 'x', website: '(615) 555-0142', google: '(615) 555-0199' };
  dirty.signals.google.rating = { id: 'rating', status: 'good', label: '4.3 or higher', rating: 4.6 };
  await fs.writeFile(file, JSON.stringify([...list, dirty]));
  const restarted = await startEnv({ site: fakeSite(defaultRoutes()), dir: env.dir });
  // The first recheck after the start cleans every Grade.
  await recheckDone(restarted, g.id);
  const saved = JSON.parse(await fs.readFile(file, 'utf8')).find(x => x.id === dirty.id);
  assert.equal('google' in saved.signals.google.phoneMatch, false);
  assert.equal(saved.signals.google.phoneMatch.website, '(615) 555-0142');
  assert.equal('rating' in saved.signals.google.rating, false);
});

test('T6: after a restart, a lookup with no key says it is off, not "run a new check"', async () => {
  const first = await startEnv({ site: fakeSite(defaultRoutes()), places: fakeLookup('places', GOOGLE_FOUND), bing: fakeLookup('bing', BING_FOUND) });
  const g = await check(first);
  // Restarted with Google still on and Bing switched off.
  const restarted = await startEnv({ site: fakeSite(defaultRoutes()), dir: first.dir, places: fakeLookup('places', GOOGLE_FOUND) });
  const after = await recheckDone(restarted, g.id);
  assert.equal(after.signals.google.found.reason, 'Run a new check to look on Google again.');
  assert.equal(after.signals.bing.found.reason, "We didn't check Bing this time.");
  assert.equal(after.signals.bing.details.reason, "We didn't check Bing this time.");
});

test('S6: each lookup\'s outcome is counted for the day (ok or error), with no key or body', async () => {
  const env = await startEnv({
    site: fakeSite(defaultRoutes()),
    places: fakeLookup('places', GOOGLE_FOUND),
    bing: fakeLookup('bing', { status: 'error', reason: "We couldn't reach Bing this time." }),
  });
  await check(env);
  await check(env, { ...INPUT, name: 'Zephyr Plumbing Two' });
  const notes = env.aiBudget.notes();
  assert.equal(notes.placesOk, 2);
  assert.equal(notes.placesError ?? 0, 0);
  assert.equal(notes.bingOk ?? 0, 0);
  assert.equal(notes.bingError, 2);
  const summary = env.ctx.gradeGuard.summary();
  assert.deepEqual(summary.lookups, { placesOk: 2, placesError: 0, bingOk: 0, bingError: 2 });
  // Not found and unsure are answers, so they count as ok; a lookup that is off or held back is not counted.
  const env2 = await startEnv({
    site: fakeSite(defaultRoutes()),
    places: fakeLookup('places', { status: 'not_found', reason: 'x' }),
    bing: fakeLookup('bing', { status: 'unsure', reason: 'x' }),
  });
  await check(env2);
  assert.deepEqual(env2.ctx.gradeGuard.summary().lookups, { placesOk: 1, placesError: 0, bingOk: 1, bingError: 0 });
  const off = await startEnv({ site: fakeSite(defaultRoutes()) });
  await check(off);
  assert.deepEqual(off.ctx.gradeGuard.summary().lookups, { placesOk: 0, placesError: 0, bingOk: 0, bingError: 0 });
});

test('S6: the admin page shows the lookup count line when a lookup is on, and not when none is', async () => {
  const env = await startEnv({ site: fakeSite(defaultRoutes()), places: fakeLookup('places', GOOGLE_FOUND), bing: fakeLookup('bing', BING_FOUND) });
  await check(env);
  const server = env.app.listen(0, '127.0.0.1');
  cleanups.push(() => new Promise(r => server.close(r)));
  await new Promise(r => server.once('listening', r));
  const page = await fetch(`http://127.0.0.1:${server.address().port}/admin/grades`, { headers: { authorization: 'Bearer signals-token', accept: 'text/html' } });
  assert.equal(page.status, 200);
  const text = await page.text();
  assert.ok(text.includes('Lookups today: Google 1 ok, 0 errors; Bing 1 ok, 0 errors.'), 'the line is shown');
  assert.equal(/AIza|subscription-key/i.test(text), false, 'no key');

  const none = await startEnv({ site: fakeSite(defaultRoutes()) });
  const server2 = none.app.listen(0, '127.0.0.1');
  cleanups.push(() => new Promise(r => server2.close(r)));
  await new Promise(r => server2.once('listening', r));
  const page2 = await fetch(`http://127.0.0.1:${server2.address().port}/admin/grades`, { headers: { authorization: 'Bearer signals-token', accept: 'text/html' } });
  assert.equal((await page2.text()).includes('Lookups today'), false);
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
