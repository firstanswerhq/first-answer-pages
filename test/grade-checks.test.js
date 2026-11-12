import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, runWebsiteChecks, checkById } from '../server/lib/grade-checks.js';
import { readPageFacts } from '../server/lib/page-facts.js';

const input = { city: 'Nashville', service: 'roof repair', website: 'https://example.com/' };
const byId = results => Object.fromEntries(results.map(r => [r.id, r]));

const goodHtml = `<title>Acme Roofing | Roof Repair in Nashville, TN</title>
  <meta name="description" content="Acme Roofing repairs and replaces roofs across Nashville. Call for a free estimate today.">
  <meta property="og:image" content="https://example.com/a.jpg">
  <script type="application/ld+json">{"@type":"RoofingContractor","name":"Acme Roofing","telephone":"(615) 555-0100"}</script>
  <h1>Nashville Roof Repair</h1><img src="a.jpg" alt="Crew on a roof">
  <a href="tel:+16155550100">Call now</a><p>Open Mon-Fri 8am-5pm at 12 Main Street. ${'We fix roofs. '.repeat(20)}</p>`;

test('the checks add up to 100 points and every fix is at most 160 characters', () => {
  assert.equal(CHECKS.length, 14);
  assert.equal(CHECKS.reduce((n, c) => n + c.points, 0), 100);
  assert.equal(new Set(CHECKS.map(c => c.id)).size, 14);
  for (const c of CHECKS) assert.ok(Array.from(c.fix).length <= 160, c.id);
  assert.equal(checkById('ai-named').points, 30);
});

test('a well set up site passes every website check', () => {
  const r = byId(runWebsiteChecks({
    facts: readPageFacts(goodHtml),
    robots: { status: 200, text: 'User-agent: *\nAllow: /' },
    llms: { status: 200, contentType: 'text/plain', text: '# Acme Roofing\nRoof repair in Nashville.' },
    input,
  }));
  for (const [id, res] of Object.entries(r)) {
    if (id === 'google-profile') continue;
    assert.equal(res.result, 'pass', `${id}: ${res.detail}`);
  }
  assert.equal(r['google-profile'].result, 'not_checked');
  assert.equal(r['google-profile'].detail, 'Google check coming soon');
  assert.equal(r['ai-named'], undefined);
  assert.equal(Object.keys(r).length, 13);
});

test('a bare site fails with plain reasons', () => {
  const r = byId(runWebsiteChecks({
    facts: readPageFacts(`<title>Home</title><h1>A</h1><h1>B</h1><img src="a.jpg"><p>${'words '.repeat(60)}</p>`),
    robots: { status: 200, text: 'User-agent: GPTBot\nDisallow: /' },
    llms: { status: 200, contentType: 'text/html', text: '<html>not found page</html>' },
    input,
  }));
  assert.equal(r['ai-bots-allowed'].result, 'fail');
  assert.deepEqual(r['ai-bots-allowed'].blocked, ['GPTBot']);
  assert.equal(r['info-sheet'].result, 'fail');
  assert.equal(r['title-city-service'].detail, 'Your title is "Home".');
  assert.equal(r['one-headline'].detail, 'We found 2 main headlines.');
  assert.equal(r['image-descriptions'].detail, '1 of 1 pictures have no description.');
  for (const id of ['business-labeled', 'summary', 'share-picture', 'tap-to-call', 'hours-shown', 'address-shown', 'call-button']) {
    assert.equal(r[id].result, 'fail', id);
  }
});

test('nothing is failed when it could not be read', () => {
  const none = runWebsiteChecks({ facts: null, robots: null, llms: null, input: { ...input, website: null } });
  assert.ok(none.every(r => r.result === 'not_checked'));
  assert.ok(none.filter(r => r.id !== 'google-profile').every(r => r.detail === 'No website given'));

  const down = byId(runWebsiteChecks({ facts: null, robots: null, llms: null, input }));
  assert.ok(Object.values(down).every(r => r.result === 'not_checked'));
  assert.equal(down['tap-to-call'].detail, "We couldn't reach your website.");

  const big = byId(runWebsiteChecks({ facts: null, robots: { status: 500 }, llms: null, input, failure: 'Your home page is too large to read.' }));
  assert.equal(big['summary'].detail, 'Your home page is too large to read.');
  assert.equal(big['ai-bots-allowed'].result, 'not_checked');

  const missing = byId(runWebsiteChecks({ facts: null, robots: { status: 404 }, llms: { status: 404 }, input }));
  assert.equal(missing['ai-bots-allowed'].result, 'pass');
  assert.equal(missing['info-sheet'].result, 'fail');
});

test('a script-built page skips the text checks but still checks the title', () => {
  const facts = readPageFacts('<title>Roof Repair Nashville</title><div id="root"></div><script src="app.js"></script>');
  const r = byId(runWebsiteChecks({ facts, robots: { status: 404 }, llms: { status: 404 }, input }));
  for (const id of ['one-headline', 'hours-shown', 'address-shown', 'call-button']) {
    assert.equal(r[id].result, 'not_checked', id);
  }
  assert.equal(r['title-city-service'].result, 'pass');
});
