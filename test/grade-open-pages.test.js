/**
 * The plain /grade form and /grade/about are open to search engines; nothing else under /grade is (Feature D,
 * task F12; Requirements 9.6, 22.2, 22.3). Fake assistant and fake clock; no network beyond the local server.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';
import { FORM_SEARCH_TITLE, FORM_SEARCH_DESCRIPTION, ABOUT_SEARCH_DESCRIPTION } from '../server/lib/grade-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 22, 18, 0, 0);
const BASE_URL = 'https://firstanswer.example';
const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function startEnv(config = {}, { indexNow } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-grade-open-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    assistantProvider: { name: 'anthropic', async ask() { return { answer: '1. Other Co', provider: 'anthropic', model: 'stub', webSearch: true }; } },
    extraAssistants: [],
    nameChecker: null,
    safeFetcher: { async fetchText() { throw new Error('no network in tests'); } },
    newGradeId: () => `open${String(++n).padStart(18, '0')}`,
    ...(indexNow ? { indexNow } : {}),
    config: {
      baseUrl: BASE_URL, demoMode: false, production: false, graderLeadGate: true, graderSecret: 'test-secret',
      adminToken: 'open-pages-token', gradeAiCallsPerDay: 150, gradeMainAsks: 1, ...config,
    },
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
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {});
  });
  return { clock, ctx: app.locals.ctx, port: server.address().port, base: `http://127.0.0.1:${server.address().port}` };
}

/** One raw request, so the path (a bare "?", a trailing "/") and the Host header are sent exactly as written. */
function raw(env, { method = 'GET', path: p, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (body !== undefined) {
      h['content-type'] = 'application/x-www-form-urlencoded';
      h['content-length'] = String(Buffer.byteLength(body));
    }
    const req = http.request({ host: '127.0.0.1', port: env.port, method, path: p, headers: h, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function assertClosed(res, label) {
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow', label);
  assert.equal(res.headers['referrer-policy'], 'no-referrer', label);
  assert.equal(res.headers['cache-control'], 'no-store', label);
  if (String(res.headers['content-type'] ?? '').includes('html') && res.text) {
    assert.ok(res.text.includes(ROBOTS_META), `${label}: robots meta`);
    assert.equal(res.text.includes('rel="canonical"'), false, `${label}: no canonical`);
  }
}

// ---- the two open pages ---------------------------------------------------------------------------------

test('F12: GET /grade has no noindex header or meta, a canonical link from the base address, a title and a description', async () => {
  const env = await startEnv();
  const res = await raw(env, { path: '/grade' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-robots-tag'], undefined);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.text.includes('name="robots"'), false);
  assert.ok(res.text.includes(`<link rel="canonical" href="${BASE_URL}/grade">`));
  assert.ok(res.text.includes(`<title>${FORM_SEARCH_TITLE}</title>`));
  assert.ok(res.text.includes(`<meta name="description" content="${FORM_SEARCH_DESCRIPTION}">`));
  assert.ok(res.text.includes('Can AI find your business?'), 'the page heading is unchanged');
});

test('F12: GET /grade/about is open the same way', async () => {
  const env = await startEnv();
  const res = await raw(env, { path: '/grade/about' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['x-robots-tag'], undefined);
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.text.includes('name="robots"'), false);
  assert.ok(res.text.includes(`<link rel="canonical" href="${BASE_URL}/grade/about">`));
  assert.ok(res.text.includes('<title>About the AI Visibility Check | First Answer Pages</title>'));
  assert.ok(res.text.includes(`<meta name="description" content="${ABOUT_SEARCH_DESCRIPTION.replace(/'/g, '&#39;')}">`));
});

test('F12: the canonical link uses the configured base address, never the typed Host', async () => {
  const env = await startEnv();
  for (const p of ['/grade', '/grade/about']) {
    const res = await raw(env, { path: p, headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example' } });
    assert.equal(res.text.includes('evil.example'), false, p);
    assert.ok(res.text.includes(`href="${BASE_URL}${p}"`), p);
  }
});

test('F12: the titles and descriptions follow the wording rules', () => {
  for (const text of [FORM_SEARCH_TITLE, FORM_SEARCH_DESCRIPTION, ABOUT_SEARCH_DESCRIPTION]) {
    assert.doesNotMatch(text, /yellow\s*pages|\bYP\b|guarantee|\$\d|colour|centre|favourite|organis/i, text);
    assert.doesNotMatch(text, /will (name|recommend|mention)/i, text);
  }
});

// ---- everything else stays closed ----------------------------------------------------------------------------

test('F12: a query string (even a bare "?"), a trailing slash, another case and HEAD all keep noindex', async () => {
  const env = await startEnv();
  for (const p of ['/grade?x=1', '/grade?', '/grade/', '/grade/about?x=1', '/grade/about?', '/grade/about/', '/GRADE', '/Grade/About']) {
    const res = await raw(env, { path: p });
    assertClosed(res, p);
  }
  for (const p of ['/grade', '/grade/about']) {
    const res = await raw(env, { method: 'HEAD', path: p });
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow', `HEAD ${p}`);
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

async function startCheck(env, fields = {}) {
  const page = await raw(env, { path: '/grade' });
  const t = /name="t" value="([^"]+)"/.exec(page.text)[1];
  env.clock.t += 5000;
  const body = new URLSearchParams({
    nickname: '', t, name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: '', ...fields,
  }).toString();
  return raw(env, { method: 'POST', path: '/grade', body });
}

test('F12: the 422 form, a report, the status JSON, the claim, a missing report and the failed page keep noindex', async () => {
  const env = await startEnv();
  const bad = await startCheck(env, { city: '' });
  assert.equal(bad.status, 422);
  assertClosed(bad, '422 form');

  const started = await startCheck(env);
  assert.equal(started.status, 303);
  assertClosed(started, 'POST /grade');
  const id = /\/grade\/([A-Za-z0-9_-]{22})/.exec(started.headers.location)[1];
  for (let i = 0; i < 250; i += 1) {
    const s = JSON.parse((await raw(env, { path: `/grade/${id}/status.json` })).text);
    if (s.done) break;
    await sleep(20);
  }
  assertClosed(await raw(env, { path: `/grade/${id}` }), 'report');
  assertClosed(await raw(env, { path: `/grade/${id}?opened=1` }), 'report with a query');
  assertClosed(await raw(env, { path: `/grade/${id}/status.json` }), 'status JSON');
  const claim = await raw(env, { method: 'POST', path: `/grade/${id}/claim`, body: '' });
  assertClosed(claim, 'claim');
  assertClosed(await raw(env, { path: `/grade/${'Z'.repeat(22)}` }), 'missing report');
  assertClosed(await raw(env, { path: '/grade/nope' }), 'unknown /grade path');
});

test('F12: with the grader off every /grade path is a 404 with noindex, no referrer and no store', async () => {
  const env = await startEnv({ graderEnabled: false });
  for (const p of ['/grade', '/grade/about', '/grade?x=1']) {
    const res = await raw(env, { path: p });
    assert.equal(res.status, 404, p);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow', p);
    assert.equal(res.headers['referrer-policy'], 'no-referrer', p);
    assert.equal(res.headers['cache-control'], 'no-store', p);
  }
});

// ---- the sitemap, llms.txt, MCP and IndexNow ------------------------------------------------------------------

test('F12: the sitemap lists /grade and /grade/about and never a report, draft or admin address', async () => {
  const env = await startEnv();
  const started = await startCheck(env);
  const id = /\/grade\/([A-Za-z0-9_-]{22})/.exec(started.headers.location)[1];
  const xml = (await raw(env, { path: '/sitemap.xml' })).text;
  assert.ok(xml.includes(`<loc>${BASE_URL}/grade</loc>`));
  assert.ok(xml.includes(`<loc>${BASE_URL}/grade/about</loc>`));
  assert.equal(xml.includes(id), false);
  assert.equal(/\/grade\/[A-Za-z0-9_-]{22}/.test(xml), false);
  assert.equal(/\/rise\/drafts|\/admin/.test(xml), false);
  // In demo mode, and with the grader off, the /grade pages are not listed.
  const demo = await startEnv({ demoMode: true });
  assert.equal((await raw(demo, { path: '/sitemap.xml' })).text.includes('/grade'), false);
  const off = await startEnv({ graderEnabled: false });
  assert.equal((await raw(off, { path: '/sitemap.xml' })).text.includes('/grade'), false);
});

test('F12: llms.txt, the MCP tools and IndexNow still never see /grade', async () => {
  const pinged = [];
  const indexNow = { submit: async urls => { pinged.push(...urls); return { ok: true }; }, latestFor: () => undefined, recent: () => [] };
  const env = await startEnv({}, { indexNow });
  const started = await startCheck(env);
  const id = /\/grade\/([A-Za-z0-9_-]{22})/.exec(started.headers.location)[1];
  await raw(env, { path: `/grade/${id}` });
  await raw(env, { path: '/grade' });
  await raw(env, { path: '/grade/about' });
  assert.equal((await raw(env, { path: '/llms.txt' })).text.includes('/grade'), false);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const tools = await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: env.port, method: 'POST', path: '/mcp', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(tools.includes('/grade'), false);
  assert.equal(pinged.some(u => String(u).includes('/grade')), false);
});
