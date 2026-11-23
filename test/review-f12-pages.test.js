/**
 * The F12 code review and page read, round 2 (V90 to V97). No network beyond the local test server.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { ownerWebsite, riseCanonical } from '../server/routes/rise.js';
import { normalizeWebsite } from '../server/lib/listing-fields.js';
import { FORM_SEARCH_TITLE, FORM_SEARCH_DESCRIPTION, aboutPage } from '../server/lib/grade-html.js';
import {
  reviewPage, uploadPage, WEBSITE_HINT, SAVED_WEBSITE_LEFT_OUT, SAVED_LINK_LEFT_OUT, SAVED_BOTH_LEFT_OUT,
  RISE_DESCRIPTION, RISE_DESCRIPTION_NO_PHOTO,
} from '../server/lib/rise-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const categories = JSON.parse(await fs.readFile(path.join(REPO_DATA, 'categories.json'), 'utf8'));
const BASE_URL = 'https://firstanswer.example';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv(config = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-review-f12-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const app = createApp({ dataDir: dir, config: { adminToken: 'f12-token', baseUrl: BASE_URL, demoMode: false, production: false, ...config } });
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
  return { dir, ctx: app.locals.ctx, base: `http://127.0.0.1:${server.address().port}` };
}

// ---- V90 ----------------------------------------------------------------------------------------------

const keep = typed => normalizeWebsite(ownerWebsite(typed));

test('V90: a website typed the short way, or with http://, is kept in clean form', () => {
  assert.equal(keep('mybusiness.com'), 'https://mybusiness.com/');
  assert.equal(keep('  www.mybusiness.com/menu  '), 'https://www.mybusiness.com/menu');
  assert.equal(keep('http://mybusiness.com:8080/x?y=1'), 'https://mybusiness.com/x');
  assert.equal(keep('https://mybusiness.com/'), 'https://mybusiness.com/');
  assert.equal(keep('MyBusiness.com'), 'https://mybusiness.com/');
});

test('V90: what normalizeWebsite refuses is still left out', () => {
  for (const typed of ['javascript:alert(1)', 'user@evil.tld', '127.0.0.1', 'localhost', 'mailto:a@b.com',
    'my business.com', '//evil.example/x', 'ftp://example.com/', 'https://user:pw@example.com/', 'http://10.0.0.1/', '']) {
    assert.equal(keep(typed), '', typed);
  }
});

test('V90: ownerWebsite never throws', () => {
  fc.assert(fc.property(fc.oneof(fc.string(), fc.fullUnicodeString(), fc.anything()), value => {
    const out = ownerWebsite(value);
    assert.equal(typeof out, 'string');
    assert.equal(typeof normalizeWebsite(out), 'string');
  }), { numRuns: 300 });
});

test('V90: the owner form keeps a short-form website and shows the new hint', async () => {
  assert.equal(WEBSITE_HINT, 'The address of your own website, like example.com');
  const env = await startEnv();
  const res = await fetch(`${env.base}/rise/manual`, { method: 'POST', redirect: 'manual' });
  const id = /\/rise\/drafts\/([^/?]+)/.exec(res.headers.get('location'))[1];
  const saved = await fetch(`${env.base}/rise/drafts/${id}`, {
    method: 'POST', redirect: 'manual',
    body: new URLSearchParams({ name: 'Zephyr Plumbing', website: 'www.zephyrplumbing.com/menu' }),
  });
  assert.equal(saved.headers.get('location'), `/rise/drafts/${id}?saved=1`, 'nothing was left out');
  const drafts = await env.ctx.store.collection('drafts').read();
  assert.equal(drafts.find(d => d.id === id).fields.website, 'https://www.zephyrplumbing.com/menu');
  const page = await (await fetch(`${env.base}/rise/drafts/${id}`)).text();
  assert.ok(page.includes(WEBSITE_HINT));
});

// ---- V91 ----------------------------------------------------------------------------------------------

test('V91: the "Saved, but…" line is a plain notice; a clean save stays the green "Saved."', () => {
  const draft = { id: 'd1', fields: {}, missingFields: [] };
  for (const [opts, text] of [
    [{ websiteLeftOut: true }, SAVED_WEBSITE_LEFT_OUT],
    [{ reviewsLeftOut: true }, SAVED_LINK_LEFT_OUT],
    [{ websiteLeftOut: true, reviewsLeftOut: true }, SAVED_BOTH_LEFT_OUT],
  ]) {
    const html = reviewPage(draft, categories, { saved: true, ...opts });
    assert.ok(html.includes(`<p class="notice" role="status">${text}</p>`), text);
    assert.equal(html.includes('saved-note'), false, text);
  }
  const clean = reviewPage(draft, categories, { saved: true });
  assert.ok(clean.includes('<p class="notice saved-note" role="status">Saved.</p>'));
});

// ---- V92, V93, V96, V97 --------------------------------------------------------------------------------------

test('V92 and V93: the /grade title and description', async () => {
  assert.equal(FORM_SEARCH_TITLE, 'Can AI find your local business? Free AI Visibility Check | First Answer Pages');
  assert.equal(FORM_SEARCH_DESCRIPTION, 'See whether AI assistants name your local business when someone asks for one like it, and get a score with plain fixes. Free. No account needed.');
  const env = await startEnv();
  const html = await (await fetch(`${env.base}/grade`)).text();
  assert.ok(html.includes(`<title>${FORM_SEARCH_TITLE}</title>`));
  assert.equal((html.match(/First Answer Pages<\/title>/g) ?? []).length, 1);
  assert.equal(html.includes('First Answer Pages | First Answer Pages'), false, 'the site name is not added twice');
  assert.ok(html.includes(`<meta name="description" content="${FORM_SEARCH_DESCRIPTION}">`));
  for (const brand of ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok']) {
    assert.equal(FORM_SEARCH_DESCRIPTION.includes(brand), false, brand);
  }
});

test('V96: /grade/about says "Our visits identify themselves as:"', () => {
  const html = aboutPage({ userAgent: 'FirstAnswerPagesBot/1.0' });
  assert.ok(html.includes('Our visits identify themselves as: <code>FirstAnswerPagesBot/1.0</code>'));
  assert.equal(html.includes('user-agent string'), false);
});

test('V97: a crash on GET /grade or GET /grade/about still sends noindex', async () => {
  const env = await startEnv();
  const original = env.ctx.store.getCategories;
  env.ctx.store.getCategories = () => { throw new Error('forced failure'); };
  const form = await fetch(`${env.base}/grade`);
  env.ctx.store.getCategories = original;
  assert.equal(form.status, 500);
  assert.equal(form.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await form.text()).includes('forced failure'), false);

  Object.defineProperty(env.ctx, 'graderUserAgent', { configurable: true, get() { throw new Error('forced failure'); } });
  const about = await fetch(`${env.base}/grade/about`);
  assert.equal(about.status, 500);
  assert.equal(about.headers.get('x-robots-tag'), 'noindex, nofollow');
});

// ---- V94 ----------------------------------------------------------------------------------------------

test('V94: GET /rise has the description and a canonical link from the base address; draft pages have neither', async () => {
  const env = await startEnv();
  const page = await (await fetch(`${env.base}/rise`)).text();
  // The base address, not the request's own host (127.0.0.1 here).
  assert.ok(page.includes(`<link rel="canonical" href="${BASE_URL}/rise">`));
  assert.equal(page.includes('href="http://127.0.0.1'), false);
  const description = /<meta name="description" content="([^"]*)">/.exec(page)?.[1];
  assert.ok([RISE_DESCRIPTION, RISE_DESCRIPTION_NO_PHOTO].includes(description), description);

  const res = await fetch(`${env.base}/rise/manual`, { method: 'POST', redirect: 'manual' });
  const draft = await (await fetch(`${env.base}${res.headers.get('location')}`)).text();
  assert.equal(draft.includes('rel="canonical"'), false);
  // The meta tag only: the draft form has its own description box (a textarea named "description").
  assert.equal(draft.includes('<meta name="description"'), false);
});

test('V94: the photo sentence is said only while the photo reader is open, and the canonical link needs a plain base address', () => {
  assert.equal(RISE_DESCRIPTION, 'List your local business free on First Answer Pages. Send a photo of your card or sign, or type it in. We review every listing.');
  assert.ok(uploadPage({ photoEnabled: true }).includes(RISE_DESCRIPTION));
  const closed = uploadPage({ photoEnabled: false });
  assert.ok(closed.includes(RISE_DESCRIPTION_NO_PHOTO));
  assert.equal(closed.includes('photo of your card'), false);
  assert.equal(riseCanonical({ baseUrl: 'https://firstanswer.example/' }), 'https://firstanswer.example/rise');
  for (const bad of [undefined, '', 'firstanswer.example', 'https://firstanswer.example/sub', 'javascript:x', 42]) {
    assert.equal(riseCanonical({ baseUrl: bad }), '', String(bad));
  }
  assert.equal(uploadPage({ photoEnabled: true }).includes('rel="canonical"'), false, 'no canonical without a base address');
});

// ---- V95 ----------------------------------------------------------------------------------------------

test('V95: /about links to the check only while the grader is on', async () => {
  const on = await startEnv();
  const page = await (await fetch(`${on.base}/about`)).text();
  assert.ok(page.includes('<p>Want to know if AI can find your business? <a href="/grade">Run the free AI Visibility Check.</a></p>'));
  const off = await startEnv({ graderEnabled: false });
  const offPage = await (await fetch(`${off.base}/about`)).text();
  assert.equal(offPage.includes('Run the free AI Visibility Check'), false);
  assert.equal(offPage.includes('href="/grade"'), false);
});
