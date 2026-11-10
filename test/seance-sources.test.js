/**
 * Tests for task 21.2 (Séance part): SEANCE_TIMEOUT_MS, Séance sources, and the
 * pause_turn resend that consumes a second budget unit.
 *
 * Only `fetch` is stubbed, and only for the provider calls. The in-process HTTP
 * client keeps the real fetch captured at load time. Apps run on temporary
 * DATA_DIR copies of listings.json and categories.json; the real data/ folder
 * is never written.
 *
 * Property: collectSources output is bounded, unique, http(s) only, titled.
 * **Validates: task 21.2 (Séance sources)**
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import { createApp } from '../server/app.js';
import {
  configFromEnv,
  parseSeanceTimeout,
  DEFAULT_SEANCE_TIMEOUT_MS,
  DEFAULT_PROVIDER_TIMEOUT_MS,
} from '../server/lib/config.js';
import { createAssistantProvider, collectSources, AssistantError } from '../server/lib/assistant.js';
import { createVisionProvider } from '../server/lib/vision.js';
import { ExtractionError } from '../server/lib/extractor.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { runSeance } from '../server/lib/seance.js';
import { seanceReportPage } from '../server/lib/seance-html.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2025, 0, 15, 12, 0, 0);
const TOKEN = 'seance-sources-test-token';
const KEY = 'sk-test-SOURCES-KEY-1a2b3c';
const PROMPT = 'best plumbers in Nashville';

// The HTTP client must not see the stub, so keep the real fetch.
const realFetch = globalThis.fetch;

/** Replace globalThis.fetch while fn runs; `impl(url, init, callNumber)`. Always restores. */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(url, init, calls.length);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fetch that never answers until the request signal aborts. */
const hang = (_url, init) => new Promise((_, reject) => {
  if (init.signal.aborted) return reject(new Error('aborted'));
  init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});

/** A fetch that answers `body` after `ms`, or rejects if the signal aborts first. */
const delayed = (ms, body) => (_url, init) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve(jsonResponse(body)), ms);
  init.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(new Error('aborted'));
  }, { once: true });
});

const textReply = (text, extra = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra });
const pauseReply = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'pause_turn' });

/** Hand-built config for an Anthropic assistant (configFromEnv gives the mock under node --test). */
const anthropicConfig = (extra = {}) => ({
  assistantProviderName: 'anthropic',
  assistant: { provider: 'anthropic', apiKey: KEY, model: 'claude-test' },
  ...extra,
});

// ---- environment ------------------------------------------------------------------

const permissiveLimiter = {
  consume: () => ({ allowed: true }),
  consumeAll: () => ({ allowed: true }),
  peek: () => ({ allowed: true }),
};

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv({ assistantProvider, aiBudget } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-sources-'));
  for (const name of ['listings.json', 'categories.json']) {
    await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  }
  const clock = { t: START, now() { return this.t; } };
  let n = 0;
  const app = createApp({
    dataDir: dir,
    clock,
    newId: () => `run-${++n}`,
    rateLimiter: permissiveLimiter,
    assistantProvider,
    aiBudget,
    config: { adminToken: TOKEN, baseUrl: 'http://example.test' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const ctx = app.locals.ctx;
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await ctx.aiBudget?.flush?.();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, ctx, base: `http://127.0.0.1:${server.address().port}` };
}

const postRun = (env, id) => realFetch(`${env.base}/seance/run`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ id }),
});

async function readSeanceFile(env) {
  try {
    return JSON.parse(await fs.readFile(path.join(env.dir, 'seance.json'), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// ---- 1. SEANCE_TIMEOUT_MS ---------------------------------------------------------

const TIMEOUT_WARNING = 'SEANCE_TIMEOUT_MS must be a positive whole number; using 120000.';

test('SEANCE_TIMEOUT_MS defaults to 120000 and the photo reader default stays 30000', () => {
  assert.equal(DEFAULT_SEANCE_TIMEOUT_MS, 120000);
  assert.equal(DEFAULT_PROVIDER_TIMEOUT_MS, 30000);
  const warns = [];
  const config = configFromEnv({}, { warn: m => warns.push(m) });
  assert.equal(config.seanceTimeoutMs, 120000);
  assert.equal(config.providerTimeoutMs, 30000);
  assert.deepEqual(warns, []);
});

test('SEANCE_TIMEOUT_MS: a valid positive whole number is used and the photo timeout is unchanged', () => {
  const warns = [];
  const config = configFromEnv({ SEANCE_TIMEOUT_MS: '45000' }, { warn: m => warns.push(m) });
  assert.equal(config.seanceTimeoutMs, 45000);
  assert.equal(config.providerTimeoutMs, 30000);
  assert.deepEqual(warns, []);
  assert.equal(parseSeanceTimeout(' 300 ', () => assert.fail('no warning expected')), 300);
  assert.equal(parseSeanceTimeout('', () => assert.fail('no warning expected')), 120000);
  assert.equal(parseSeanceTimeout(undefined, () => assert.fail('no warning expected')), 120000);
});

test('SEANCE_TIMEOUT_MS: invalid values warn with the exact message, never echo the value, and use 120000', () => {
  for (const value of ['0', '-1', '1.5', 'abc', '1e3', '12 34']) {
    const warns = [];
    const config = configFromEnv({ SEANCE_TIMEOUT_MS: value }, { warn: m => warns.push(m) });
    assert.equal(config.seanceTimeoutMs, 120000, value);
    // Exact comparison: a digit value such as 0 can legitimately appear inside "120000".
    assert.deepEqual(warns, [TIMEOUT_WARNING], value);
    if (/\D/.test(value)) assert.ok(!warns[0].includes(value), `warning echoes ${value}`);
  }
});

test('an anthropic assistant built from config times out after seanceTimeoutMs with code timeout', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 40 }), { warn() {} });
  await withFetch(hang, async (calls) => {
    await assert.rejects(assistant.ask({ prompt: PROMPT }), (err) => {
      assert.ok(err instanceof AssistantError);
      assert.equal(err.code, 'timeout');
      return true;
    });
    assert.equal(calls.length, 1);
  });
});

test('the assistant uses seanceTimeoutMs, not providerTimeoutMs, when both are set', async () => {
  const assistant = createAssistantProvider(
    anthropicConfig({ providerTimeoutMs: 20, seanceTimeoutMs: 2000 }),
    { warn() {} },
  );
  // The reply arrives after 120 ms: too late for 20 ms, well inside 2000 ms.
  await withFetch(delayed(120, textReply('Try Acme Plumbing.')), async () => {
    const result = await assistant.ask({ prompt: PROMPT });
    assert.equal(result.answer, 'Try Acme Plumbing.');
  });
});

test('a hand-built config without seanceTimeoutMs falls back to providerTimeoutMs', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ providerTimeoutMs: 40 }), { warn() {} });
  await withFetch(hang, async () => {
    await assert.rejects(assistant.ask({ prompt: PROMPT }), err => err.code === 'timeout');
  });
});

test('pause_turn: the first call and the resend share ONE deadline (second hangs -> timeout)', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 60 }), { warn() {} });
  const impl = (url, init, n) => (n === 1 ? delayed(25, pauseReply('Searching.'))(url, init) : hang(url, init));
  await withFetch(impl, async (calls) => {
    await assert.rejects(
      assistant.ask({ prompt: PROMPT, consumeExtra: () => true }),
      err => err instanceof AssistantError && err.code === 'timeout',
    );
    assert.equal(calls.length, 2, 'the resend was attempted');
  });
});

test('pause_turn: two slow requests that fit separately still time out together', async () => {
  // 100 ms + 100 ms against one 150 ms deadline. A per-request timer would let both finish.
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 150 }), { warn() {} });
  const impl = (url, init, n) =>
    (n === 1 ? delayed(100, pauseReply('Searching.')) : delayed(100, textReply('Done.')))(url, init);
  await withFetch(impl, async (calls) => {
    await assert.rejects(
      assistant.ask({ prompt: PROMPT, consumeExtra: () => true }),
      err => err instanceof AssistantError && err.code === 'timeout',
    );
    assert.equal(calls.length, 2);
  });
});

test('the photo reader still uses providerTimeoutMs and ignores seanceTimeoutMs', async () => {
  const vision = createVisionProvider({
    visionProviderName: 'anthropic',
    vision: { provider: 'anthropic', apiKey: KEY, model: 'vision-test' },
    providerTimeoutMs: 30,
    seanceTimeoutMs: 60000,
  });
  await withFetch(hang, async () => {
    const started = Date.now();
    await assert.rejects(
      vision.extract({ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' }),
      err => err instanceof ExtractionError && err.code === 'timeout',
    );
    assert.ok(Date.now() - started < 10000, 'timed out on the photo timeout, not the Séance one');
  });
});

// ---- 2. Sources -----------------------------------------------------------------------

const citationReply = (citations, text = 'Try Nashville Pipe Pros.') => ({
  content: [{ type: 'text', text, citations }],
  stop_reason: 'end_turn',
});

test('collectSources: dedupes by URL, keeps http(s) only, falls back to the hostname for the title', () => {
  const out = collectSources(citationReply([
    { url: 'https://example.org/a', title: 'First' },
    { url: 'https://example.org/a', title: 'Duplicate' },
    { url: 'HTTP://EXAMPLE.com/b', title: 'Upper' },
    { url: 'javascript:alert(1)', title: 'bad' },
    { url: 'data:text/html,<b>x</b>', title: 'bad' },
    { url: 'ftp://example.com/file', title: 'bad' },
    { url: 'not a url at all', title: 'bad' },
    { url: 42, title: 'bad' },
    null,
    { url: 'https://www.example.net/page', title: undefined },
    { url: 'https://www.example.net/other', title: 7 },
  ]));
  assert.deepEqual(out, [
    { url: 'https://example.org/a', title: 'First' },
    { url: 'http://example.com/b', title: 'Upper' },
    { url: 'https://www.example.net/page', title: 'www.example.net' },
    { url: 'https://www.example.net/other', title: 'www.example.net' },
  ]);
});

test('collectSources: keeps at most 8 and gathers citations from every text block', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.org/${i}`, title: `T${i}` }));
  assert.equal(collectSources(citationReply(many)).length, 8);
  const split = {
    content: [
      { type: 'text', text: 'a', citations: many.slice(0, 5) },
      { type: 'server_tool_use', id: 'x', name: 'web_search', input: {} },
      { type: 'web_search_tool_result', content: [{ url: 'https://ignored.test/', title: 'ignored' }] },
      { type: 'text', text: 'b', citations: many.slice(5) },
    ],
  };
  const out = collectSources(split);
  assert.deepEqual(out.map(s => s.url), many.slice(0, 8).map(s => s.url));
  assert.deepEqual(collectSources({}), []);
  assert.deepEqual(collectSources(null), []);
  assert.deepEqual(collectSources({ content: [{ type: 'text', text: 'no citations' }] }), []);
});

test('collectSources: control characters in a title are cleaned', () => {
  const [source] = collectSources(citationReply([
    { url: 'https://example.org/a', title: 'A\u0000B\nC\u007f D\t\u0085E' },
  ]));
  assert.equal(source.title, 'A B C D E');
  assert.equal(collectSources(citationReply([{ url: 'https://example.org/z', title: '\u0001\u0002 \n' }]))[0].title, 'example.org');
  const long = collectSources(citationReply([{ url: 'https://example.org/l', title: 'x'.repeat(500) }]))[0].title;
  assert.equal(long.length, 200);
});

test('Property: collectSources output is at most 8, unique, http(s) only, with clean non-empty titles', () => {
  // **Validates: task 21.2 (Séance sources)**
  // Hostnames stay short: a title that falls back to a hostname is not capped at 200 by the code.
  const hostArb = fc.stringMatching(/^[a-z0-9]{1,20}(\.[a-z0-9]{1,20}){0,3}$/);
  const urlArb = fc.oneof(
    fc.tuple(fc.constantFrom('http', 'https'), hostArb, fc.stringMatching(/^[a-z0-9/_-]{0,20}$/))
      .map(([scheme, host, rest]) => `${scheme}://${host}/${rest}`),
    fc.constantFrom(
      'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x', 'not a url', '',
      '//example.com', 'mailto:a@b.c', 'HTTPS://Example.COM/A', 'http://example.com/a',
      'https://example.com/a', ' https://example.com/a ', 'file:///etc/passwd',
    ),
    fc.string({ maxLength: 30 }),
    fc.constant(undefined),
    fc.integer(),
  );
  const titleArb = fc.oneof(fc.fullUnicodeString({ maxLength: 300 }), fc.constant(undefined), fc.integer());
  const citationArb = fc.oneof(
    fc.record({ url: urlArb, title: titleArb }),
    fc.constant(null),
    fc.constant({}),
  );

  fc.assert(
    fc.property(fc.array(citationArb, { maxLength: 30 }), (citations) => {
      const out = collectSources(citationReply(citations));
      assert.ok(out.length <= 8);
      assert.equal(new Set(out.map(s => s.url)).size, out.length, 'urls are unique');
      for (const s of out) {
        const protocol = new URL(s.url).protocol;
        assert.ok(protocol === 'http:' || protocol === 'https:', s.url);
        assert.equal(typeof s.title, 'string');
        assert.ok(s.title.length > 0, 'title is not empty');
        assert.ok(Array.from(s.title).length <= 200, 'title is at most 200 code points');
      }
    }),
    { numRuns: 200 },
  );
});

test('runSeance stores only valid http(s) sources and omits the key when there are none', async () => {
  const env = await startEnv();
  const withSources = { name: 'stub', ask: async () => ({
    answer: 'Hello.',
    provider: 'stub',
    sources: [
      { url: 'javascript:alert(1)', title: 'bad' },
      { url: 'https://a.test/x', title: 'A', extra: 'dropped' },
      { url: 'ftp://b.test/', title: 'B' },
      { url: 'https://c.test/', title: 5 },
      null,
    ],
  }) };
  const run = await runSeance({ ...env.ctx, assistantProvider: withSources }, 'nashville-pipe-pros');
  assert.deepEqual(run.sources, [{ url: 'https://a.test/x', title: 'A' }]);

  for (const result of [
    { answer: 'No sources.', provider: 'stub' },
    { answer: 'Empty.', provider: 'stub', sources: [] },
    { answer: 'All bad.', provider: 'stub', sources: [{ url: 'javascript:1', title: 'x' }] },
    'plain string answer',
  ]) {
    const bare = await runSeance({ ...env.ctx, assistantProvider: { name: 'stub', ask: async () => result } }, 'nashville-pipe-pros');
    assert.ok(!('sources' in bare), `no sources key for ${JSON.stringify(result)}`);
    assert.ok(Object.values(bare).every(v => v !== undefined), 'no undefined values');
  }

  const stored = await readSeanceFile(env);
  assert.equal(stored.length, 5);
  assert.deepEqual(stored[0], run);
  assert.ok(stored.slice(1).every(r => !('sources' in r)));
});

test('POST /seance/run with an anthropic assistant stores sources and the report and JSON show them', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 5000 }), { warn() {} });
  const env = await startEnv({ assistantProvider: assistant });
  const id = 'nashville-pipe-pros';
  const reply = citationReply([
    { url: 'https://example.org/a', title: 'Plumber guide <b>' },
    { url: 'javascript:alert(1)', title: 'bad' },
    { url: 'https://example.org/a', title: 'dup' },
    { url: 'https://www.example.net/page?x=1&y=2' },
  ]);

  const res = await withFetch(() => jsonResponse(reply), () => postRun(env, id));
  assert.equal(res.status, 201);
  const { run } = await res.json();
  const expected = [
    { url: 'https://example.org/a', title: 'Plumber guide <b>' },
    { url: 'https://www.example.net/page?x=1&y=2', title: 'www.example.net' },
  ];
  assert.deepEqual(run.sources, expected);
  assert.deepEqual((await readSeanceFile(env))[0], run, 'stored run deep-equals the returned run');

  const html = await (await realFetch(`${env.base}/seance/${id}`)).text();
  assert.ok(html.includes('Sources:'));
  assert.equal((html.match(/rel="noopener noreferrer nofollow"/g) ?? []).length, 2);
  assert.ok(html.includes('<a href="https://example.org/a" rel="noopener noreferrer nofollow">Plumber guide &lt;b&gt;</a>'));
  assert.ok(html.includes('href="https://www.example.net/page?x=1&amp;y=2"'));
  assert.ok(!html.includes('Plumber guide <b>'), 'title is escaped');
  assert.ok(!html.includes('javascript:'));

  const json = await (await realFetch(`${env.base}/api/seance/${id}`)).json();
  assert.deepEqual(json.runs[0].sources, expected);
});

test('the report never links a non-http(s) URL, even if a stored run contains one', () => {
  const listing = { id: 'x-plumbing', name: 'X Plumbing' };
  const run = {
    id: 'r1', listingId: listing.id, prompt: PROMPT, provider: 'anthropic',
    timestamp: '2025-01-01T00:00:00.000Z', answer: 'An answer.', named: false,
  };
  const mixed = seanceReportPage(listing, [{
    ...run,
    sources: [
      { url: 'javascript:alert(1)', title: 'bad js' },
      { url: 'data:text/html,hi', title: 'bad data' },
      { url: 'https://ok.test/p?a=1&b="2"', title: '<i>Ok</i> & "co"' },
      { url: 'ftp://old.test/', title: 'bad ftp' },
    ],
  }], null);
  const line = /<p class="seance-sources">([\s\S]*?)<\/p>/.exec(mixed);
  assert.ok(line, 'sources line present');
  assert.ok(line[1].startsWith('Sources: '));
  assert.equal((line[1].match(/<a /g) ?? []).length, 1);
  assert.ok(line[1].includes('href="https://ok.test/p?a=1&amp;b=&quot;2&quot;"'));
  assert.ok(line[1].includes('&lt;i&gt;Ok&lt;/i&gt; &amp; &quot;co&quot;'));
  assert.ok(line[1].includes('rel="noopener noreferrer nofollow"'));
  assert.ok(!mixed.includes('javascript:') && !mixed.includes('data:text') && !mixed.includes('ftp://'));

  for (const sources of [undefined, [], [{ url: 'javascript:alert(1)', title: 'x' }]]) {
    const html = seanceReportPage(listing, [{ ...run, ...(sources ? { sources } : {}) }], null);
    assert.ok(!html.includes('Sources:'), JSON.stringify(sources));
    assert.ok(!html.includes('seance-sources'));
  }
});

// ---- 3. pause_turn resend and the budget ------------------------------------------------

const PAUSED = [
  { type: 'text', text: 'Searching. ' },
  { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'q' } },
];

test('pause_turn: consumeExtra returning true sends the resend and uses the second reply', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 5000 }), { warn() {} });
  const replies = [{ content: PAUSED, stop_reason: 'pause_turn' }, textReply('Second reply.')];
  let asked = 0;
  await withFetch((_u, _i, n) => jsonResponse(replies[n - 1]), async (calls) => {
    const result = await assistant.ask({ prompt: PROMPT, consumeExtra: () => { asked++; return true; } });
    assert.equal(calls.length, 2);
    assert.equal(asked, 1);
    assert.equal(result.answer, 'Second reply.');
  });
});

test('pause_turn: consumeExtra returning anything but true makes exactly ONE request and uses the first reply', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 5000 }), { warn() {} });
  const first = { content: [{ type: 'text', text: 'First reply.' }, PAUSED[1]], stop_reason: 'pause_turn' };
  for (const consumeExtra of [() => false, () => 1, () => 'true', () => undefined, () => { throw new Error('boom'); }]) {
    await withFetch(() => jsonResponse(first), async (calls) => {
      const result = await assistant.ask({ prompt: PROMPT, consumeExtra });
      assert.equal(calls.length, 1);
      assert.equal(result.answer, 'First reply.');
    });
  }
});

test('pause_turn: no resend and no text in the first reply rejects with unparseable', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 5000 }), { warn() {} });
  const noText = { content: [PAUSED[1]], stop_reason: 'pause_turn' };
  await withFetch(() => jsonResponse(noText), async (calls) => {
    await assert.rejects(
      assistant.ask({ prompt: PROMPT, consumeExtra: () => false }),
      err => err instanceof AssistantError && err.code === 'unparseable',
    );
    assert.equal(calls.length, 1);
  });
});

test('POST /seance/run charges the budget twice when a resend happens (limit 3: run 1 uses 2, run 2 gets 1)', async () => {
  const assistant = createAssistantProvider(anthropicConfig({ seanceTimeoutMs: 5000 }), { warn() {} });
  const clock = { t: START, now() { return this.t; } };
  const budget = createAiBudget({ clock, limit: 3 });
  const env = await startEnv({ assistantProvider: assistant, aiBudget: budget });

  const replies = [
    { content: [{ type: 'text', text: 'Searching.' }], stop_reason: 'pause_turn' },
    textReply('Final answer.'),
    { content: [{ type: 'text', text: 'First reply text' }], stop_reason: 'pause_turn' },
  ];
  await withFetch((_u, _i, n) => jsonResponse(replies[n - 1]), async (calls) => {
    const first = await postRun(env, 'nashville-pipe-pros');
    assert.equal(first.status, 201);
    assert.equal((await first.json()).run.answer, 'Final answer.');
    assert.equal(calls.length, 2, 'run 1 made the first call and the resend');
    assert.equal(budget.peek().remaining, 1, 'run 1 used two units');

    const second = await postRun(env, 'honky-tonk-plumbing');
    assert.equal(second.status, 201);
    assert.equal((await second.json()).run.answer, 'First reply text', 'no unit left for a resend');
    assert.equal(calls.length, 3, 'run 2 made one request only');
    assert.equal(budget.peek().remaining, 0);
    assert.equal(budget.peek().allowed, false);

    const third = await postRun(env, 'cumberland-drain-co');
    assert.equal(third.status, 429);
    assert.equal(calls.length, 3, 'a denied run never reaches the provider');
  });
  assert.equal((await readSeanceFile(env)).length, 2);
});
