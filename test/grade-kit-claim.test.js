/**
 * The fix kit's business label and the claimed Draft for no-storefront businesses and review links
 * (Features A and B, task F5). Fake assistant, fake fetcher, fake clock; no network.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { jsonLdBlock } from '../server/lib/fix-kit.js';
import { bestReviewsLink, foundOf } from '../server/lib/grader.js';
import { reportPage } from '../server/lib/grade-html.js';
import { buildSchema } from '../server/lib/schema.js';
import { listingDetail } from '../server/lib/html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 22, 18, 0, 0);
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));

const GOOGLE = 'https://www.google.com/maps/place/Capital+City+Window';
const YELP = 'https://www.yelp.com/biz/capital-city-window-nashville';
const FB_REVIEWS = 'https://www.facebook.com/CapitalCityWindow/reviews';
const FB_PAGE = 'https://www.facebook.com/CapitalCityWindow';
const WRITE_REVIEW = 'https://search.google.com/local/writereview?placeid=ChIJ123';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Parse the JSON-LD inside the kit's script block. */
function label(block) {
  assert.ok(block.startsWith('<script type="application/ld+json">\n'));
  assert.ok(block.endsWith('\n</script>'));
  const inner = block.slice('<script type="application/ld+json">\n'.length, -'\n</script>'.length);
  assert.equal(inner.includes('<'), false, 'no raw < inside the block');
  return JSON.parse(inner);
}

const KIT = {
  name: 'Capital City Window', service: 'window cleaning', city: 'Tallahassee', state: 'fl',
  phone: '(850) 555-0100', website: 'https://example.com/', address: '12 Main Street', hours: [],
};

// ---- the fix kit label ------------------------------------------------------------------------------

test('F5: without the flag the label is as before, with the street address and the city as areaServed', () => {
  const data = label(jsonLdBlock(KIT));
  assert.deepEqual(data.address, {
    '@type': 'PostalAddress', streetAddress: '12 Main Street', addressLocality: 'Tallahassee', addressRegion: 'FL',
  });
  assert.equal(data.areaServed, 'Tallahassee');
  assert.equal(jsonLdBlock(KIT), jsonLdBlock({ ...KIT, noStorefront: false }), 'false is the same as no flag');
});

test('F5: with the flag the label names "<City>, <ST>" as areaServed and has no address at all', () => {
  const data = label(jsonLdBlock({ ...KIT, noStorefront: true }));
  assert.equal(data.areaServed, 'Tallahassee, FL');
  assert.equal(Object.hasOwn(data, 'address'), false);
  assert.equal(JSON.stringify(data).includes('streetAddress'), false);
  assert.equal(JSON.stringify(data).includes('12 Main Street'), false);
  assert.equal(data.name, 'Capital City Window');
  assert.equal(data.telephone, '(850) 555-0100');
  // The city alone when there is no state.
  assert.equal(label(jsonLdBlock({ ...KIT, state: '', noStorefront: true })).areaServed, 'Tallahassee');
});

test('F5: the label is safe with odd text and never holds a rating or a review', () => {
  for (const noStorefront of [true, false]) {
    const odd = { ...KIT, name: 'A </script><b>"x"</b>', city: '<Nash>', noStorefront };
    const data = label(jsonLdBlock(odd));
    assert.equal(data.name, 'A </script><b>"x"</b>');
    for (const key of ['aggregateRating', 'review', 'reviewCount', 'ratingValue']) {
      assert.equal(JSON.stringify(data).includes(key), false, key);
    }
  }
});

test('F5: the report passes the flag from the Grade into the kit', () => {
  const grade = flag => ({
    id: 'kitAAAAAAAAAAAAAAAAAAA', status: 'done', input: { name: 'Capital City Window', city: 'Tallahassee', state: 'FL', service: 'window cleaning', website: 'https://example.com/', ...(flag ? { noStorefront: true } : {}) },
    createdAt: new Date(START).toISOString(), finishedAt: new Date(START).toISOString(), steps: [], facts: null,
    found: { phone: '(850) 555-0100', hours: [], address: '12 Main Street', website: 'https://example.com/', reviewsLink: GOOGLE },
    results: [], ai: [], aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: null,
  });
  const ns = reportPage(grade(true), { leadGate: false });
  const kit = /<pre id="kit-label">([\s\S]*?)<\/pre>/.exec(ns)[1];
  assert.ok(kit.includes('Tallahassee, FL'));
  assert.equal(kit.includes('streetAddress'), false);
  const plain = /<pre id="kit-label">([\s\S]*?)<\/pre>/.exec(reportPage(grade(false), { leadGate: false }))[1];
  assert.ok(plain.includes('streetAddress'));
  for (const html of [ns, plain]) assert.equal(html.includes('aggregateRating'), false);
});

// ---- the best review link -----------------------------------------------------------------------------

test('F5: the best review link is Google, then Yelp, then Facebook or Nextdoor, in page order within each kind', () => {
  assert.equal(bestReviewsLink([FB_REVIEWS, GOOGLE]), GOOGLE);
  assert.equal(bestReviewsLink([YELP, FB_REVIEWS]), YELP);
  assert.equal(bestReviewsLink([FB_REVIEWS, 'https://nextdoor.com/pages/capital-city-window/']), FB_REVIEWS);
  assert.equal(bestReviewsLink(['https://nextdoor.com/pages/capital-city-window/', FB_REVIEWS]), 'https://nextdoor.com/pages/capital-city-window/');
  assert.equal(bestReviewsLink(['https://maps.google.com/?cid=1', GOOGLE]), 'https://maps.google.com/?cid=1', 'the first Google link');
  for (const none of [[], [FB_PAGE], [WRITE_REVIEW], [FB_PAGE, WRITE_REVIEW, 'https://example.com/reviews'], undefined, 'x', [5, null]]) {
    assert.equal(bestReviewsLink(none), '', JSON.stringify(none));
  }
});

test('F5: foundOf gives an empty reviews link for old Grades', () => {
  assert.equal(foundOf({ found: { phone: '', hours: [], address: '', website: '' } }).reviewsLink, '');
  assert.equal(foundOf({ facts: { phone: '1' } }).reviewsLink, '');
  assert.equal(foundOf({ found: { phone: '', hours: [], address: '', website: '', reviewsLink: GOOGLE } }).reviewsLink, GOOGLE);
});

// ---- the scan and the claim ------------------------------------------------------------------------------

function page(links) {
  return `<!doctype html><html><head><title>Capital City Window | Window Cleaning in Nashville, TN</title></head><body>
    <h1>Window cleaning in Nashville</h1>
    <p>${'We clean windows for homes and shops across town. '.repeat(8)}</p>
    <p>Visit us at 12 Main Street, Nashville, TN. Call <a href="tel:+16155550100">(615) 555-0100</a>.</p>
    ${links.map(l => `<a href="${l}">link</a>`).join(' ')}
  </body></html>`;
}

async function startEnv(html) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-kit-claim-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock: { now: () => START },
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: {
      async fetchText(url) {
        if (new URL(url).pathname === '/') return { status: 200, text: html, contentType: 'text/html', finalUrl: url };
        return { status: 404, text: '', contentType: 'text/plain' };
      },
    },
    newGradeId: () => `claim${String(++n).padStart(17, '0')}`,
    config: { baseUrl: 'http://example.test', graderLeadGate: true, graderSecret: 'test-secret', adminToken: 'claim-token', gradeAiCallsPerDay: 150 },
  });
  cleanups.push(async () => {
    await app.locals.ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return app.locals.ctx;
}

const INPUT = { name: 'Capital City Window', city: 'Nashville', state: 'TN', service: 'window cleaning', website: 'https://capitalcitywindow.example/' };

/** Run a check to the end, claim it, and return the Grade and the Draft's fields. */
async function runAndClaim(ctx, input) {
  const id = await ctx.grader.start(input);
  for (let i = 0; i < 300; i += 1) {
    const g = await ctx.grader.get(id);
    if (g && g.status === 'done') break;
    await sleep(20);
  }
  const grade = await ctx.grader.get(id);
  assert.equal(grade.status, 'done');
  const claimed = await ctx.grader.claim(id);
  assert.equal(claimed.status, 303);
  const drafts = await ctx.store.collection('drafts').read();
  const draft = drafts.find(d => d.id === claimed.draftId);
  assert.ok(draft);
  return { grade, draft };
}

test('F5: with a Facebook reviews link and a Google maps link on the page, the scan and the claim pick the Google one', async () => {
  const ctx = await startEnv(page([FB_REVIEWS, GOOGLE]));
  const { grade, draft } = await runAndClaim(ctx, INPUT);
  assert.equal(grade.found.reviewsLink, GOOGLE);
  assert.equal(draft.fields.reviewsLink, GOOGLE);
  assert.equal(draft.missingFields.includes('reviewsLink'), false);
});

test('F5: a page with only a footer Facebook link or a write-a-review link fills nothing', async () => {
  for (const links of [[FB_PAGE], [WRITE_REVIEW], []]) {
    const ctx = await startEnv(page(links));
    const { grade, draft } = await runAndClaim(ctx, INPUT);
    assert.equal(grade.found.reviewsLink, '', JSON.stringify(links));
    assert.equal(Object.hasOwn(draft.fields, 'reviewsLink'), false, JSON.stringify(links));
  }
});

test('F5: an unticked claim keeps the address and the city as the service area', async () => {
  const ctx = await startEnv(page([YELP]));
  const { draft } = await runAndClaim(ctx, INPUT);
  assert.equal(draft.fields.serviceArea, 'Nashville');
  assert.ok(draft.fields.address.includes('12 Main Street'));
  assert.equal(draft.fields.reviewsLink, YELP);
});

test('F5: a no-storefront claim has no address and "<city> and nearby areas", and neither is a missing field', async () => {
  const ctx = await startEnv(page([GOOGLE]));
  const { grade, draft } = await runAndClaim(ctx, { ...INPUT, noStorefront: true });
  assert.equal(grade.input.noStorefront, true);
  assert.ok(grade.found.address.includes('12 Main Street'), 'the page showed an address');
  assert.equal(draft.fields.address, '', 'but the Draft leaves it out');
  assert.equal(draft.fields.serviceArea, 'Nashville and nearby areas');
  assert.equal(draft.missingFields.includes('address'), false);
  assert.equal(draft.missingFields.includes('serviceArea'), false);
  assert.equal(draft.fields.reviewsLink, GOOGLE);

  // Rendered as a listing with the existing listing and schema code: the city row, the service area, and a
  // business label without streetAddress.
  const listing = { ...draft.fields, id: 'capital-city-window-nashville', description: 'We clean windows.' };
  const schema = buildSchema(listing, null, { baseUrl: 'https://firstanswer.example' });
  assert.equal(Object.hasOwn(schema.address, 'streetAddress'), false);
  assert.equal(schema.address.addressLocality, 'Nashville');
  assert.equal(schema.areaServed, 'Nashville and nearby areas');
  const html = listingDetail(listing, JSON.stringify(schema), { categories });
  assert.ok(html.includes('<dt>City</dt>\n    <dd>Nashville, TN</dd>'));
  assert.equal(html.includes('<dt>Address</dt>'), false);
  assert.ok(html.includes('<dt>Service area</dt>\n    <dd>Nashville and nearby areas</dd>'));
  assert.equal(html.includes('streetAddress'), false);
});
