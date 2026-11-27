/**
 * Owner decision D3 (task O3, Requirement 28): the home page says why this matters, and the AI Visibility Check has
 * as much weight as the search box. The sentence always shows; the button only when the grader is on and the home page is unfiltered (V174); with the
 * grader off there is no /grade link anywhere on the page, the footer included (V154).
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const SENTENCE = 'People now ask AI who to call. List your business free so AI can find it.';
const BUTTON = '<p class="home-check"><a class="button" href="/grade">Check if AI can find your business</a></p>';

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv(config = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-home-check-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const app = createApp({
    dataDir: dir,
    config: { baseUrl: 'http://example.test', graderLeadGate: false, graderSecret: 'test-secret', gradeMainAsks: 1, ...config },
  });
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
  return `http://127.0.0.1:${server.address().port}`;
}

const home = async (base, p = '/') => (await fetch(base + p)).text();

test('D3: the sentence is under the headline and tagline, in the header, with the grader on or off', async () => {
  for (const config of [{}, { graderEnabled: true }, { graderEnabled: false }]) {
    const html = await home(await startEnv(config));
    const header = /<header class="home-head">[^]*?<\/header>/.exec(html)?.[0] ?? '';
    assert.ok(header.includes(`<p class="home-why">${SENTENCE}</p>`), JSON.stringify(config));
    assert.ok(header.indexOf('<h1>') < header.indexOf('class="tagline"'), 'headline, then tagline');
    assert.ok(header.indexOf('class="tagline"') < header.indexOf('class="home-why"'), 'then the sentence');
  }
});

test('D3: with the grader on, the check is a button right under the search, before the listings', async () => {
  const html = await home(await startEnv());
  assert.ok(html.includes(BUTTON));
  const search = html.indexOf('<form class="filters"');
  const formEnd = html.indexOf('</form>', search);
  const button = html.indexOf(BUTTON);
  assert.ok(search !== -1 && formEnd !== -1);
  assert.ok(formEnd < button, 'after the search form');
  assert.ok(button < html.indexOf('</main>'));
  assert.equal(html.slice(formEnd, button).includes('<section'), false, 'nothing between the form and the button');
  // The small text link it replaces is gone.
  assert.equal(html.includes('grade-link'), false);
  assert.equal(html.includes('Get a free check'), false);
  // The search button is still there, unchanged.
  assert.ok(html.includes('<button type="submit">Search Directory</button>'));
  assert.ok(html.includes('<header class="home-head">'));
});

test('V174: the button is on the unfiltered home page only; the sentence is on every view', async () => {
  const base = await startEnv();
  assert.ok((await home(base)).includes(BUTTON));
  for (const p of ['/?category=plumbers', '/?city=Nashville', '/?category=plumbers&city=Nashville', '/?category=nonsense']) {
    const html = await home(base, p);
    assert.equal(html.includes('home-check'), false, `no button on ${p}`);
    assert.equal(html.includes('Check if AI can find your business'), false, p);
    assert.ok(html.includes(`<p class="home-why">${SENTENCE}</p>`), `the sentence stays on ${p}`);
    assert.ok(html.includes('<button type="submit">Search Directory</button>'), p);
  }
});

test('V154: with the grader off there is no /grade link anywhere on the home page, the footer included', async () => {
  const base = await startEnv({ graderEnabled: false });
  for (const p of ['/', '/?category=plumbers', '/?category=plumbers&city=Nashville', '/?city=Nashville']) {
    const html = await home(base, p);
    assert.equal(/\/grade/.test(html), false, `no /grade anywhere on ${p}`);
    assert.equal(html.includes('home-check'), false, p);
    assert.equal(html.includes('Check if AI can find your business'), false, p);
    assert.ok(html.includes(`<p class="home-why">${SENTENCE}</p>`), `the sentence stays on ${p}`);
    assert.ok(html.includes('<footer class="site-footer">'));
  }
  // The check's own pages are 404 then, as before.
  assert.equal((await fetch(`${base}/grade`)).status, 404);
});

test('D3 (V176): the rendered header text is plain, with no promise that AI will name the business', async () => {
  const html = await home(await startEnv());
  const header = /<header class="home-head">[^]*?<\/header>/.exec(html)?.[0] ?? '';
  const text = header.replace(/<[^>]*>/g, ' ');
  assert.ok(text.includes(SENTENCE), 'the sentence is in the rendered header');
  assert.equal(/guarantee|will name|will recommend|\$\d/i.test(text), false);
});

test('D3: it stays readable at phone width: the button fills the line, wraps, and nothing is fixed wider than the screen', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const rule = selector => new RegExp(`${selector.replace(/[.\\[\]"()*+?^$|{}]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const button = rule('.home-check a.button');
  assert.ok(button, 'the button rule exists');
  assert.ok(/display:\s*block/.test(button));
  assert.ok(/box-sizing:\s*border-box/.test(button));
  assert.ok(/width:\s*100%/.test(button));
  assert.ok(/min-height:\s*3\.5rem/.test(button), 'as tall as the search button');
  assert.ok(/font-size:\s*1\.3rem/.test(button), 'the search button\'s size');
  assert.equal(/white-space:\s*nowrap/.test(button), false, 'the text wraps');
  assert.equal(/(^|[^-])width:\s*\d+(\.\d+)?(px|rem|em)/.test(button), false, 'no fixed width');
  // V172: it lines up with the 44rem search form.
  const box = rule('.home-check');
  assert.ok(/max-width:\s*44rem/.test(box), 'as wide as the search form at most');
  assert.ok(/margin:\s*0\.75rem auto 1\.25rem/.test(box), 'centered like the form');
  // V173: the search button's rule is the one that applies (it outranks `main form button:not([class])`), and
  // the two buttons carry the same size, weight and height.
  const search = rule('.filters button[type="submit"]');
  assert.ok(search, 'the search button rule exists, with [type="submit"] for its specificity');
  assert.equal(css.includes('main form button:not([class])'), true, 'the rule it has to outrank is still there');
  for (const key of ['min-height', 'font-size', 'font-weight']) {
    const a = new RegExp(`${key}:\\s*([^;]+);`).exec(search)?.[1];
    const b = new RegExp(`${key}:\\s*([^;]+);`).exec(button)?.[1];
    assert.ok(a && a === b, `${key}: search ${a}, check ${b}`);
  }
  assert.ok(/font-family:\s*"Fira Sans Condensed"/.test(search));
  const why = rule('.home-head .home-why');
  assert.ok(why, 'the sentence rule exists');
  assert.equal(/white-space:\s*nowrap/.test(why), false);
  assert.ok(/max-width:/.test(why) && /overflow-wrap:/.test(why));
  // The small link's styles are gone with its markup.
  assert.equal(/\.grade-link/.test(css), false);
});
