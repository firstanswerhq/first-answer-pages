/**
 * Tests for the configurable SITE_NAME: config parsing, applySiteName, and
 * the rendered pages, llms.txt, and MCP serverInfo.title.
 *
 * Every app runs on a temporary data dir (copies of the seed files); the real
 * data/ directory is never written to.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import { configFromEnv, parseSiteName, DEFAULT_SITE_NAME } from '../server/lib/config.js';
import { applySiteName, escapeHtml } from '../server/lib/html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const SEED_ID = 'nashville-pipe-pros';
const HTML_PATHS = ['/', `/listings/${SEED_ID}`, '/rise'];

/**
 * Runs `fn({ base })` against a fresh app on a temp data dir, then closes the
 * server and removes the dir.
 */
async function withApp(config, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-site-name-'));
  let server;
  try {
    for (const name of ['listings.json', 'categories.json']) {
      await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
    }
    const app = createApp({ dataDir: dir, config });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    return await fn({ base: `http://127.0.0.1:${server.address().port}` });
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function getText(base, p) {
  const res = await fetch(base + p);
  return { res, text: await res.text() };
}

async function initialize(base) {
  const res = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18' },
    }),
  });
  return res.json();
}

describe('SITE_NAME config', () => {
  test('defaults to First Answer Pages', () => {
    assert.equal(configFromEnv({}).siteName, 'First Answer Pages');
    assert.equal(DEFAULT_SITE_NAME, 'First Answer Pages');
  });

  test('SITE_NAME env is trimmed', () => {
    assert.equal(configFromEnv({ SITE_NAME: '  Music City Pages  ' }).siteName, 'Music City Pages');
  });

  test('control characters are removed', () => {
    assert.equal(parseSiteName('Music\nCity\u0007 Pages'), 'Music City Pages');
    assert.equal(parseSiteName('A\r\nB'), 'A B');
  });

  test('capped at 80 characters', () => {
    const name = parseSiteName('x'.repeat(200));
    assert.equal(name.length, 80);
  });

  test('empty or whitespace-only falls back to the default', () => {
    assert.equal(configFromEnv({ SITE_NAME: '' }).siteName, DEFAULT_SITE_NAME);
    assert.equal(configFromEnv({ SITE_NAME: '   \t ' }).siteName, DEFAULT_SITE_NAME);
    assert.equal(configFromEnv({ SITE_NAME: '\n\u0007' }).siteName, DEFAULT_SITE_NAME);
  });
});

describe('applySiteName', () => {
  const html = '<title>First Answer Pages</title><a>First Answer Pages</a><p>First Answer Pages.</p>';

  test('default name is a no-op', () => {
    assert.equal(applySiteName(html, DEFAULT_SITE_NAME), html);
  });

  test('replaces every occurrence', () => {
    const out = applySiteName(html, 'Acme Book');
    assert.equal(out, '<title>Acme Book</title><a>Acme Book</a><p>Acme Book.</p>');
  });

  test('escapes the name', () => {
    assert.equal(applySiteName('First Answer Pages', 'A <b> & "c"'), escapeHtml('A <b> & "c"'));
  });

  test('is safe for $& and $1 in names', () => {
    assert.equal(applySiteName('x First Answer Pages y', 'Cost $& $1'), 'x Cost $& $1 y');
    assert.equal(applySiteName('First Answer Pages', "$1 $' $`"), escapeHtml("$1 $' $`"));
  });
});

describe('SITE_NAME in pages', () => {
  test('default name: home nav still reads First Answer Pages', async () => {
    await withApp({ siteName: DEFAULT_SITE_NAME }, async ({ base }) => {
      const { text } = await getText(base, '/');
      assert.ok(text.includes('<a href="/">First Answer Pages</a>'));
    });
  });

  test('custom name: footer shows it; /healthz and JSON are unaffected', async () => {
    await withApp({ siteName: 'Music City Pages' }, async ({ base }) => {
      const home = await getText(base, '/');
      assert.ok(home.text.includes('<a href="/">Music City Pages</a>'));
      assert.ok(home.text.includes('<p>Music City Pages. A free local business directory.</p>'));

      const health = await getText(base, '/healthz');
      assert.deepEqual(JSON.parse(health.text), { ok: true });

      const baseline = await withApp({ siteName: DEFAULT_SITE_NAME }, async ({ base: b }) =>
        (await getText(b, `/api/listings/${SEED_ID}`)).text);
      const api = await getText(base, `/api/listings/${SEED_ID}`);
      assert.equal(api.res.status, 200);
      assert.equal(api.text, baseline);
    });
  });
});

describe('SITE_NAME property', () => {
  const chars = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \'&<>"'];
  const safeName = fc
    .stringOf(fc.constantFrom(...chars), { minLength: 1, maxLength: 40 })
    .filter(s =>
      /[A-Za-z]/.test(s) &&
      s === s.trim() &&
      !s.includes('  ') &&
      !s.includes(DEFAULT_SITE_NAME));

  test('custom name replaces the default everywhere', async () => {
    // Baseline pages with the default name, used to ignore raw-name matches
    // that come from the page's own markup.
    const baselines = await withApp({ siteName: DEFAULT_SITE_NAME }, async ({ base }) => {
      const out = {};
      for (const p of HTML_PATHS) out[p] = (await getText(base, p)).text;
      return out;
    });

    await fc.assert(
      fc.asyncProperty(safeName, async siteName => {
        const escaped = escapeHtml(siteName);
        await withApp({ siteName }, async ({ base }) => {
          for (const p of HTML_PATHS) {
            const { res, text } = await getText(base, p);
            assert.equal(res.status, 200, p);
            assert.ok(text.includes(`<a href="/">${escaped}</a>`), `nav on ${p}`);
            const title = /<title>([^]*?)<\/title>/.exec(text)?.[1] ?? '';
            assert.ok(title.includes(escaped), `title on ${p}`);
            assert.ok(!text.includes(DEFAULT_SITE_NAME), `default name left on ${p}`);

            if ((siteName.includes('<') || siteName.includes('&')) && !baselines[p].includes(siteName)) {
              const stripped = text.split(escaped).join('');
              assert.ok(!stripped.includes(siteName), `raw name unescaped on ${p}`);
            }
          }

          const llms = await getText(base, '/llms.txt');
          assert.ok(llms.text.startsWith(`# ${siteName}\n`));
          assert.ok(!llms.text.includes(DEFAULT_SITE_NAME));

          const rpc = await initialize(base);
          assert.equal(rpc.result.serverInfo.title, siteName);
          assert.equal(rpc.result.serverInfo.name, 'first-answer-pages');
        });
      }),
      { numRuns: 15 },
    );
  });
});
