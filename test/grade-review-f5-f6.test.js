/**
 * The F5 review (V80: a block end is a line break for the service-area test) and the F6 review (V81: a bad
 * reviews link never comes out of the JSON API or MCP). No network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { readPageFacts, serviceAreaPattern, serviceAreaSource } from '../server/lib/page-facts.js';
import { publicListing } from '../server/lib/public-listing.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const MB = 1024 * 1024;

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

// ---- V80 ----------------------------------------------------------------------------------------------

const nashville = serviceAreaPattern('Nashville');
const servesNashville = html => nashville.test(serviceAreaSource(readPageFacts(html)));

test('V80: text split across blocks with no period is not read as one sentence', () => {
  for (const html of [
    '<p>We serve breakfast all day</p><p>Visit us at 12 Main St, Nashville, TN</p>',
    '<h2>We serve breakfast all day</h2><div>12 Main St Nashville</div>',
    '<li>Now serving lunch</li><li>Nashville location</li>',
    '<td>Serving brunch</td><td>Nashville</td>',
    'We serve coffee<br>Nashville',
    'We serve coffee<br/>Nashville',
    'We serve coffee<BR class="x" />Nashville',
  ]) {
    assert.equal(servesNashville(html), false, html);
  }
});

test('V80: a service-area line inside one block still passes', () => {
  for (const html of [
    '<h2>Serving Nashville and nearby areas</h2>',
    '<li>Serving Franklin, Brentwood and Nashville</li>',
    '<p>We proudly serve the <strong>greater Nashville</strong> area.</p>',
    '<div><p>Serving <a href="/area">Nashville</a> and surrounding areas</p></div>',
  ]) {
    assert.equal(servesNashville(html), true, html);
  }
  // The page text everything else reads is unchanged: one line, no breaks.
  const f = readPageFacts('<p>We serve breakfast</p><p>Nashville</p>');
  assert.equal(f.text, 'We serve breakfast Nashville');
  assert.equal(f.areaText, 'We serve breakfast\nNashville');
});

test('V80: hand-built facts with only text are read as before, and areaText keeps the 200,000-character cut', () => {
  assert.equal(serviceAreaSource({ text: 'Serving Nashville' }), 'Serving Nashville');
  const long = readPageFacts(`<p>${'word '.repeat(60000)}</p>`);
  assert.ok(long.areaText.length <= 200000);
  assert.equal(readPageFacts('').areaText, '');
  assert.equal(readPageFacts(undefined).areaText, '');
});

test('V80: a 1 MB page of <p>serving</p> stays under 200 ms', () => {
  const html = '<p>serving</p>'.repeat(Math.ceil(MB / 14)).slice(0, MB);
  readPageFacts(html.slice(0, 2000)); // warm up
  const start = performance.now();
  const facts = readPageFacts(html);
  const found = nashville.test(serviceAreaSource(facts));
  const ms = performance.now() - start;
  assert.equal(found, false);
  assert.ok(ms < 200, `took ${Math.round(ms)} ms`);
});

// ---- V81 ----------------------------------------------------------------------------------------------

const BAD_LINKS = ['javascript:alert(1)', 'https://www.yelp.com/biz_redir?url=https%3A%2F%2Fevil.tld', 'http://www.yelp.com/biz/x', 42];

test('V81: publicListing leaves out a reviews link that is not a valid one', () => {
  for (const bad of BAD_LINKS) {
    const out = publicListing({ id: 'a', name: 'A', reviewsLink: bad, ownerEmail: 'x@example.com' });
    assert.equal(Object.hasOwn(out, 'reviewsLink'), false, String(bad));
    assert.equal(Object.hasOwn(out, 'ownerEmail'), false);
  }
  const good = 'https://www.yelp.com/biz/a';
  assert.equal(publicListing({ id: 'a', reviewsLink: good }).reviewsLink, good);
  assert.deepEqual(publicListing({ id: 'a', name: 'A' }), { id: 'a', name: 'A' }, 'no key is added');
});

async function startEnv(published) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-review-f5-f6-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  await fs.writeFile(path.join(dir, 'published.json'), JSON.stringify(published));
  const app = createApp({ dataDir: dir, config: { adminToken: 'f5f6-token', baseUrl: 'http://example.test', demoMode: true, production: false } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { base: `http://127.0.0.1:${server.address().port}` };
}

const HAND_EDITED = {
  id: 'quillon-plumbing-nashville', name: 'Quillon Plumbing', category: 'plumbers', phone: '(615) 555-0177',
  services: ['Leak repair'], serviceArea: 'Nashville', description: 'We fix pipes.', city: 'Nashville', state: 'TN',
  reviewsLink: 'javascript:alert(1)',
};

const mcp = (env, name, args) => fetch(`${env.base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
}).then(r => r.text());

test('V81: a hand-edited bad link never comes out of the JSON API', async () => {
  const env = await startEnv([HAND_EDITED]);
  const res = await fetch(`${env.base}/api/listings/${HAND_EDITED.id}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(text.includes('Quillon Plumbing'));
  assert.equal(text.includes('javascript:'), false);
  assert.equal(text.includes('reviewsLink'), false);
});

test('V81: a hand-edited bad link never comes out of MCP get_listing or search_listings', async () => {
  const env = await startEnv([HAND_EDITED, { ...HAND_EDITED, id: 'quillon-two-nashville', name: 'Quillon Two', phone: '(615) 555-0178', reviewsLink: 'https://www.yelp.com/biz_redir?url=https%3A%2F%2Fevil.tld' }]);
  const got = await mcp(env, 'get_listing', { id: HAND_EDITED.id });
  assert.ok(got.includes('Quillon Plumbing'));
  assert.equal(got.includes('javascript:'), false);
  assert.equal(got.includes('reviewsLink'), false);

  const found = await mcp(env, 'search_listings', { query: 'Quillon' });
  assert.ok(found.includes('Quillon Plumbing') && found.includes('Quillon Two'));
  assert.equal(found.includes('javascript:'), false);
  assert.equal(found.includes('biz_redir'), false);
  assert.equal(found.includes('evil.tld'), false);
});
