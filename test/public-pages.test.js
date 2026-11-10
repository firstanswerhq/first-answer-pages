/**
 * Third review round, public side: hours, robots.txt, canonical and meta
 * description, sitemap category pages, llms.txt details, MCP category
 * matching, request-host fallback for absolute URLs, /about and /privacy,
 * and the footer contact line.
 *
 * Every app runs on a temporary DATA_DIR; nothing touches the network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { listingDetail, filledHours, layout, escapeHtml, CONTACT_MARKER } from '../server/lib/html.js';
import { buildSchema, schemaTypeFor } from '../server/lib/schema.js';
import { generateLlmsTxt } from '../server/lib/llms.js';
import { generateSitemap } from '../server/lib/sitemap.js';
import { categoryForQuery } from '../server/lib/search-match.js';
import { configFromEnv } from '../server/lib/config.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const LIVE = 'https://pages.example.com';
const TOKEN = 'public-pages-admin-token';

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const OWNER = Object.freeze({
  id: 'owner-plumbing-nashville',
  name: 'Owner "Plumbing" <Co>',
  category: 'plumbers',
  phone: '(615) 555-0188',
  hours: { monday: '7:00 AM - 5:00 PM', tuesday: '', wednesday: '  ', sunday: 'Closed' },
  services: ['Leak repair', 'Drain\ncleaning'],
  serviceArea: 'Davidson County',
  description: 'We fix pipes.',
  city: 'Nashville',
  state: 'TN',
});

const servers = [];
const dirs = [];
after(async () => {
  for (const s of servers) {
    s.closeAllConnections?.();
    await new Promise(resolve => s.close(resolve));
  }
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
});

/** @param {{ config?: object, published?: object[] }} [opts] */
async function startApp({ config = {}, published = [] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-public-'));
  dirs.push(dir);
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  const app = createApp({
    dataDir: dir,
    rateLimiter: permissiveLimiter,
    config: { adminToken: TOKEN, ...config },
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port };
}

const text = async (env, p, headers = {}) => {
  const res = await fetch(`${env.base}${p}`, { headers });
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: await res.text() };
};
const canonicalOf = html => /<link rel="canonical" href="([^"]*)">/.exec(html)?.[1];
const descriptionOf = html => /<meta name="description" content="([^"]*)">/.exec(html)?.[1];
const hoursRow = (html, day) => new RegExp(`<tr><th scope="row">${day}</th><td>([^<]*)</td></tr>`).exec(html)?.[1];

// ---- 1. hours -----------------------------------------------------------------------

test('hours: every day shown once any is filled, a skipped day says "Call for hours", a typed "Closed" stays; none filled says "Call for hours"', () => {
  const html = listingDetail({ ...OWNER }, undefined, { categories });
  assert.equal(hoursRow(html, 'Monday'), '7:00 AM - 5:00 PM');
  assert.equal(hoursRow(html, 'Sunday'), 'Closed');
  for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
    assert.equal(hoursRow(html, day), 'Call for hours', day);
  }
  // A typed "closed" in any case reads "Closed"; a skipped day is never "Closed".
  const lower = listingDetail({ ...OWNER, hours: { monday: '8-4', tuesday: 'closed', wednesday: 'CLOSED' } }, undefined, { categories });
  assert.equal(hoursRow(lower, 'Tuesday'), 'Closed');
  assert.equal(hoursRow(lower, 'Wednesday'), 'Closed');
  assert.equal(hoursRow(lower, 'Thursday'), 'Call for hours');

  for (const hours of [{}, { monday: '', friday: '   ' }, undefined, null]) {
    const none = listingDetail({ ...OWNER, hours }, undefined, { categories });
    assert.ok(none.includes('Call for hours'), JSON.stringify(hours));
    assert.ok(!none.includes('<table class="hours">'));
    assert.ok(!none.includes('>Closed<'));
  }
});

test('Property: filledHours keeps exactly the non-blank days, Monday first', () => {
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  fc.assert(
    fc.property(fc.dictionary(fc.constantFrom(...DAYS), fc.oneof(fc.constant(''), fc.constant('  '), fc.constant('Closed'), fc.string())), (hours) => {
      const out = filledHours(hours);
      const expected = DAYS.filter(d => typeof hours[d] === 'string' && hours[d].trim() !== '');
      assert.deepEqual(out.map(([day]) => day.toLowerCase()), expected);
      for (const [, value] of out) assert.notEqual(value.trim(), '');
    }),
  );
});

test('hours: MCP get_listing returns only the filled days, like the page and JSON-LD', async () => {
  const env = await startApp({ published: [OWNER] });
  const res = await fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_listing', arguments: { id: OWNER.id } } }),
  });
  const { result } = await res.json();
  assert.deepEqual(result.structuredContent.listing.hours, { monday: '7:00 AM - 5:00 PM', sunday: 'Closed' });
  const ld = buildSchema(OWNER, null, { baseUrl: LIVE });
  assert.deepEqual(ld.openingHoursSpecification.map(h => h.dayOfWeek), ['Monday']);
});

// ---- 2. schema type -----------------------------------------------------------------

test('the merged shops-and-restaurants category is a LocalBusiness, never a Restaurant', () => {
  assert.equal(schemaTypeFor('shops-and-restaurants'), 'LocalBusiness');
  const ld = buildSchema({ ...OWNER, category: 'shops-and-restaurants' }, null, { baseUrl: LIVE });
  assert.equal(ld['@type'], 'LocalBusiness');
});

// ---- 3. robots.txt ------------------------------------------------------------------

test('robots.txt: live rules plus the sitemap; demo mode disallows everything', async () => {
  const live = await startApp({ config: { demoMode: false, baseUrl: LIVE } });
  const r = await text(live, '/robots.txt');
  assert.equal(r.status, 200);
  assert.match(r.type, /^text\/plain/);
  const lines = r.body.split('\n');
  for (const line of ['User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /rise/drafts/', `Sitemap: ${LIVE}/sitemap.xml`]) {
    assert.ok(lines.includes(line), line);
  }
  assert.ok(!lines.includes('Disallow: /'));

  const demo = await startApp({ config: { demoMode: true, baseUrl: LIVE } });
  const d = await text(demo, '/robots.txt');
  assert.ok(d.body.split('\n').includes('Disallow: /'));
  assert.ok(d.body.includes(`Sitemap: ${LIVE}/sitemap.xml`));
});

// ---- 4. canonical and meta description ----------------------------------------------

test('home, category and listing pages carry a canonical link and a meta description', async () => {
  const env = await startApp({ config: { baseUrl: LIVE }, published: [OWNER] });

  const home = (await text(env, '/')).body;
  assert.equal(canonicalOf(home), `${LIVE}/`);
  assert.ok(descriptionOf(home).length > 20);

  const cat = (await text(env, '/?category=plumber&city=Nashville,%20TN')).body;
  assert.equal(canonicalOf(cat), `${LIVE}/?category=plumbers`);
  assert.match(descriptionOf(cat), /^Plumbers in Nashville: /);

  const page = (await text(env, `/listings/${OWNER.id}?quote=sent`)).body;
  assert.equal(canonicalOf(page), `${LIVE}/listings/${OWNER.id}`);
  const desc = descriptionOf(page);
  assert.equal(desc, escapeHtml(`${OWNER.name} is a plumber in Nashville, TN offering leak repair and drain cleaning. Call ${OWNER.phone}.`));
  assert.ok(desc.length <= 200);
  assert.ok(!page.includes('<Co>'), 'the name is escaped in the meta tag');
});

test('no canonical on admin, draft or error pages', async () => {
  const env = await startApp({ config: { baseUrl: LIVE } });
  for (const [p, headers] of [
    ['/admin/pending', { authorization: `Bearer ${TOKEN}` }],
    ['/admin/login', {}],
    ['/rise/drafts/nope', {}],
    ['/no-such-page', {}],
    ['/listings/no-such-listing', {}],
  ]) {
    const { body } = await text(env, p, headers);
    assert.equal(canonicalOf(body), undefined, p);
  }
});

test('Property: any description and canonical are escaped in the head', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      const html = layout({ title: 't', body: 'b', description: `x${s}`, canonical: `https://a.example/${s}` });
      const head = html.slice(0, html.indexOf('</head>'));
      assert.ok(!/<script/i.test(head.replace('<script type="application/ld+json">', '')));
      const desc = descriptionOf(html);
      if (desc !== undefined) assert.ok(!desc.includes('"') && !desc.includes('<'));
    }),
  );
});

// ---- 5. sitemap categories ----------------------------------------------------------

test('sitemap lists category pages that have live listings; production leaves samples out', async () => {
  const xml = generateSitemap([{ id: 'a', category: 'plumbers' }, { id: 'b', category: 'lawyers' }], LIVE, categories);
  assert.ok(xml.includes(`<loc>${LIVE}/?category=plumbers</loc>`));
  assert.ok(xml.includes(`<loc>${LIVE}/?category=lawyers</loc>`));
  assert.ok(!xml.includes('category=electricians'));

  const prod = await startApp({ config: { production: true, demoMode: false, baseUrl: LIVE }, published: [OWNER] });
  const body = (await text(prod, '/sitemap.xml')).body;
  assert.ok(body.includes(`<loc>${LIVE}/?category=plumbers</loc>`));
  assert.ok(body.includes(`<loc>${LIVE}/listings/${OWNER.id}</loc>`));
  assert.ok(!body.includes('nashville-pipe-pros'));
  assert.ok(!body.includes('category=lawyers'), 'no category page for samples that are not live');
});

// ---- 6. llms.txt --------------------------------------------------------------------

test('llms.txt gives services, service area and hours, each on one line', () => {
  const txt = generateLlmsTxt([OWNER], LIVE, categories);
  const lines = txt.split('\n');
  assert.ok(lines.includes('Services: Leak repair; Drain cleaning'));
  assert.ok(lines.includes('Service Area: Davidson County'));
  assert.ok(lines.includes('Hours: Monday 7:00 AM - 5:00 PM; Sunday Closed'));
  const none = generateLlmsTxt([{ ...OWNER, hours: {} }], LIVE, categories).split('\n');
  assert.ok(none.includes('Hours: Call for hours'));
});

test('Property: hostile services and hours never add a line to llms.txt', () => {
  fc.assert(
    fc.property(fc.array(fc.string(), { maxLength: 4 }), fc.string(), (services, monday) => {
      const base = generateLlmsTxt([{ ...OWNER, services: ['x'], hours: { monday: 'y' } }], LIVE, categories).split('\n').length;
      const out = generateLlmsTxt([{ ...OWNER, services, hours: { monday } }], LIVE, categories).split('\n');
      // Services may be dropped (empty) but never split onto extra lines.
      assert.ok(out.length <= base);
      assert.ok(out.some(l => l.startsWith('Hours: ')));
    }),
  );
});

// ---- 7. MCP category matching -------------------------------------------------------

test('MCP search: a query naming a trade finds every listing in it', async () => {
  assert.equal(categoryForQuery('plumber', categories), 'plumbers');
  assert.equal(categoryForQuery('emergency plumbing', categories), 'plumbers');
  assert.equal(categoryForQuery('zzz', categories), undefined);

  const env = await startApp({ config: { demoMode: true } });
  const call = async (args) => {
    const res = await fetch(`${env.base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_listings', arguments: args } }),
    });
    return (await res.json()).result.structuredContent;
  };
  const plumbers = await call({ query: 'plumber' });
  assert.deepEqual(plumbers.listings.map(l => l.id).sort(), ['cumberland-drain-co', 'honky-tonk-plumbing', 'nashville-pipe-pros']);
  const withCity = await call({ query: 'Plumbers', city: 'Nashville, TN' });
  assert.ok(withCity.listings.every(l => l.category === 'plumbers'));
  // A conflicting explicit category wins over the query's trade.
  const conflict = await call({ query: 'plumber', category: 'lawyers' });
  assert.ok(conflict.listings.every(l => l.category === 'lawyers'));
  // A plain word still matches names and services as before.
  const pipes = await call({ query: 'pipe' });
  assert.ok(pipes.listings.some(l => l.id === 'nashville-pipe-pros'));
});

// ---- 8. request host when BASE_URL is unset -----------------------------------------

test('without BASE_URL, MCP, llms.txt, sitemap and robots.txt use the request host and port', async () => {
  const env = await startApp({ config: { demoMode: true } });
  const here = `http://127.0.0.1:${env.port}`;
  const res = await fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_listings', arguments: { query: 'plumber' } } }),
  });
  const { listings } = (await res.json()).result.structuredContent;
  assert.ok(listings.length > 0);
  for (const l of listings) assert.ok(l.url.startsWith(`${here}/listings/`), l.url);
  for (const p of ['/llms.txt', '/sitemap.xml', '/robots.txt']) {
    const { body } = await text(env, p);
    assert.ok(body.includes(here), p);
    assert.ok(!body.includes('localhost:3000'), p);
  }
});

test('with BASE_URL set, MCP URLs use it', async () => {
  const env = await startApp({ config: { demoMode: true, baseUrl: LIVE } });
  const res = await fetch(`${env.base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_listings', arguments: { query: 'plumber' } } }),
  });
  for (const l of (await res.json()).result.structuredContent.listings) assert.ok(l.url.startsWith(`${LIVE}/listings/`));
});

// ---- 9. /about, /privacy, footer and CONTACT_EMAIL ----------------------------------

test('/about and /privacy say what they should, and every page links to them', async () => {
  const env = await startApp({ config: { baseUrl: LIVE } });
  const about = await text(env, '/about');
  assert.equal(about.status, 200);
  assert.match(about.body, /free local business directory/i);
  assert.match(about.body, /List your business free/);

  const privacy = await text(env, '/privacy');
  assert.equal(privacy.status, 200);
  for (const phrase of ['180 days', '30 days', "Anthropic's Claude", 'never save the photo', 'never sell', 'removed', 'quote request']) {
    assert.ok(privacy.body.includes(phrase), phrase);
  }
  for (const p of ['/', '/about', '/privacy', '/rise', '/no-such-page', '/listings/nashville-pipe-pros']) {
    const { body } = await text(env, p);
    assert.ok(body.includes('<a href="/about">About</a>'), p);
    assert.ok(body.includes('<a href="/privacy">Privacy</a>'), p);
    assert.ok(!body.includes(CONTACT_MARKER), `marker swapped on ${p}`);
    assert.ok(!/Questions\? Email/.test(body), `no contact line without CONTACT_EMAIL on ${p}`);
    for (const banned of ['Rise from the Grave', 'Super Pages', 'Yellow Pages']) assert.ok(!body.includes(banned), banned);
  }
});

test('CONTACT_EMAIL shows as escaped plain text on /about, /privacy and in every footer', async () => {
  assert.equal(configFromEnv({ CONTACT_EMAIL: ' hello@pages.example.com ' }, { warn: () => {} }).contactEmail, 'hello@pages.example.com');
  assert.equal(configFromEnv({}, { warn: () => {} }).contactEmail, undefined);

  const env = await startApp({ config: { contactEmail: 'help@pages.example.com' } });
  for (const p of ['/', '/about', '/privacy', '/no-such-page']) {
    const { body } = await text(env, p);
    assert.ok(body.includes('Questions? Email help@pages.example.com.'), p);
    assert.ok(!body.includes('mailto:'), 'plain text, not a link');
  }
  const hostile = await startApp({ config: { contactEmail: '<b>x</b>@y' } });
  const { body } = await text(hostile, '/about');
  assert.ok(body.includes('&lt;b&gt;x&lt;/b&gt;@y'));
  assert.ok(!body.includes('<b>x</b>'));
});

test('the demo footer line still lands inside the footer', async () => {
  const env = await startApp({ config: { demoMode: true } });
  const { body } = await text(env, '/');
  const footer = body.slice(body.indexOf('<footer'), body.indexOf('</footer>'));
  assert.ok(footer.includes('Sample listings for demonstration'));
  assert.ok(footer.includes('<a href="/privacy">Privacy</a>'));
});


test('listing meta description: trade noun, up to 3 services, phone, at most 160 characters', async () => {
  const { listingMetaDescription } = await import('../server/routes/listings.js');
  assert.equal(
    listingMetaDescription({ name: 'Acme Plumbing', category: 'plumbers', city: 'Nashville', state: 'TN', phone: '(615) 555-0100', services: ['drain cleaning', 'leak repair', 'water heaters', 'gas lines'] }),
    'Acme Plumbing is a plumber in Nashville, TN offering drain cleaning, leak repair and water heaters. Call (615) 555-0100.',
  );
  assert.equal(
    listingMetaDescription({ name: 'Bright Sparks', category: 'electricians', city: 'Franklin', state: 'TN', phone: '(615) 555-0101', services: ['panels'] }),
    'Bright Sparks is an electrician in Franklin, TN offering panels. Call (615) 555-0101.',
  );
  assert.match(listingMetaDescription({ name: 'Odd Jobs', category: 'other', city: 'Nashville', state: 'TN', phone: '(615) 555-0102', services: [] }), /^Odd Jobs is a local business in Nashville, TN\. Call/);
  const long = listingMetaDescription({ name: 'Long Name Services', category: 'plumbers', city: 'Nashville', state: 'TN', phone: '(615) 555-0103', services: ['x'.repeat(60), 'y'.repeat(60), 'z'.repeat(60)] });
  assert.ok(long.length <= 160, long);
  assert.ok(listingMetaDescription({ name: 'N'.repeat(300), category: 'plumbers', services: [] }).length <= 160);
});
