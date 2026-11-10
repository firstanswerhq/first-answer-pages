// Provider tests (Property 14: mock providers are deterministic).
//
// Sections:
//   1. Shared helpers (fetch stub, output capture)
//   2. Vision half: mock provider, config selection, adapters, key secrecy
//   3. Assistant half: added by a later task (9.6)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { configFromEnv, redactConfig, visionProviderName, assistantProviderName } from '../server/lib/config.js';
import {
  createMockAssistantProvider,
  createAssistantProvider,
  AssistantError,
} from '../server/lib/assistant.js';
import { createMockVisionProvider, createVisionProvider } from '../server/lib/vision.js';
import { extractDraft, ExtractionError } from '../server/lib/extractor.js';

// ---------------------------------------------------------------------------
// 1. Shared helpers
// ---------------------------------------------------------------------------

const KEY = 'sk-test-SECRETKEY-9f8e7d6c5b4a';
const CATEGORIES = [
  { slug: 'plumbers', label: 'Plumbers' },
  { slug: 'electricians', label: 'Electricians' },
  { slug: 'restaurants', label: 'Restaurants' },
  { slug: 'auto-repair', label: 'Auto Repair' },
  { slug: 'hair-salons', label: 'Hair Salons' },
  { slug: 'lawyers', label: 'Lawyers' },
];
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

/** Replace globalThis.fetch for the duration of fn(calls); always restores. */
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(url, init);
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Capture stderr/stdout writes and console output while fn runs. */
async function captureOutput(fn) {
  const chunks = [];
  const origErr = process.stderr.write;
  const origOut = process.stdout.write;
  const consoleMethods = ['log', 'warn', 'error', 'info', 'debug'];
  const origConsole = {};
  const grab = (c) => { chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString()); return true; };
  process.stderr.write = grab;
  process.stdout.write = grab;
  for (const m of consoleMethods) {
    origConsole[m] = console[m];
    console[m] = (...args) => chunks.push(args.map(String).join(' '));
  }
  try {
    await fn();
  } finally {
    process.stderr.write = origErr;
    process.stdout.write = origOut;
    for (const m of consoleMethods) console[m] = origConsole[m];
  }
  return chunks.join('');
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const openAiReply = (content) => ({ choices: [{ message: { content } }] });
const anthropicReply = (text) => ({ content: [{ type: 'text', text }] });
const GOOD_JSON = JSON.stringify({ name: 'Test Plumbing', phone: '(615) 555-0101', category: 'plumbers' });

function realConfig(provider, extra = {}) {
  return configFromEnv({
    VISION_PROVIDER: provider,
    VISION_API_KEY: KEY,
    VISION_MODEL: 'test-model',
    ...extra,
  }, { warn: () => {} });
}

// ---------------------------------------------------------------------------
// 2. Vision half
// ---------------------------------------------------------------------------

describe('mock vision provider', () => {
  test('Property 14: deterministic for identical bytes and always returns an object', async () => {
    const provider = createMockVisionProvider();
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 256 }), async (bytes) => {
        const a = await provider.extract({ bytes, mimeType: 'image/png' });
        const b = await provider.extract({ bytes: new Uint8Array(bytes), mimeType: 'image/png' });
        assert.equal(typeof a, 'object');
        assert.notEqual(a, null);
        assert.ok(!Array.isArray(a));
        assert.deepEqual(a, b);
      }),
      { numRuns: 100 },
    );
  });

  test('makes no fetch calls', async () => {
    await withFetch(() => { throw new Error('should not be called'); }, async (calls) => {
      await createMockVisionProvider().extract({ bytes: BYTES, mimeType: 'image/png' });
      assert.equal(calls.length, 0);
    });
  });
});

describe('extractDraft with the mock provider', () => {
  test('returns fields and missingFields', async () => {
    const result = await extractDraft({
      provider: createMockVisionProvider(),
      bytes: BYTES,
      mimeType: 'image/png',
      categories: CATEGORIES,
    });
    assert.equal(typeof result.fields, 'object');
    assert.ok(Array.isArray(result.missingFields));
  });
});

describe('vision config selection', () => {
  const full = { VISION_PROVIDER: 'openai', VISION_API_KEY: KEY, VISION_MODEL: 'm' };

  test('mock when no key is set', () => {
    assert.equal(visionProviderName({ VISION_PROVIDER: 'openai', VISION_MODEL: 'm' }), 'mock');
    assert.equal(visionProviderName({}), 'mock');
  });

  test('mock in test runs even with a full config', () => {
    assert.equal(visionProviderName({ ...full, NODE_TEST_CONTEXT: 'child-v8' }), 'mock');
    assert.equal(configFromEnv({ ...full, NODE_TEST_CONTEXT: '1' }).visionProviderName, 'mock');
  });

  test('mock for an unknown provider', () => {
    assert.equal(visionProviderName({ ...full, VISION_PROVIDER: 'nope' }), 'mock');
  });

  test('real provider is selected with key and model', () => {
    assert.equal(visionProviderName(full), 'openai');
    assert.equal(visionProviderName({ ...full, VISION_PROVIDER: 'Anthropic' }), 'anthropic');
  });

  test('real provider without VISION_MODEL warns (without the key) and returns mock', () => {
    const warnings = [];
    const name = visionProviderName(
      { VISION_PROVIDER: 'anthropic', VISION_API_KEY: KEY },
      { warn: (m) => warnings.push(m) },
    );
    assert.equal(name, 'mock');
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0].includes(KEY));
  });

  test('redactConfig hides keys and admin token', () => {
    const config = configFromEnv({ ...full, SEANCE_ADMIN_TOKEN: 'admin-secret-token' });
    const real = realConfig('openai', { SEANCE_ADMIN_TOKEN: 'admin-secret-token' });
    for (const c of [config, real]) {
      const text = JSON.stringify(redactConfig(c));
      assert.ok(!text.includes(KEY));
      assert.ok(!text.includes('admin-secret-token'));
    }
    assert.equal(redactConfig(real).vision.apiKey, '[set]');
  });
});

describe('vision adapters (stubbed fetch)', () => {
  test('zero fetch calls without a key', async () => {
    await withFetch(() => { throw new Error('should not be called'); }, async (calls) => {
      const config = configFromEnv({ VISION_PROVIDER: 'openai', VISION_MODEL: 'm' });
      const provider = createVisionProvider(config);
      assert.equal(provider.name, 'mock');
      await extractDraft({ provider, bytes: BYTES, mimeType: 'image/png', categories: CATEGORIES });
      assert.equal(calls.length, 0);
    });
  });

  test('openai request shape: URL, key in header only', async () => {
    await withFetch(() => jsonResponse(openAiReply(GOOD_JSON)), async (calls) => {
      const provider = createVisionProvider(realConfig('openai'));
      assert.equal(provider.name, 'openai');
      const raw = await provider.extract({ bytes: BYTES, mimeType: 'image/png' });
      assert.equal(raw.name, 'Test Plumbing');
      assert.equal(calls.length, 1);
      const { url, init } = calls[0];
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, `Bearer ${KEY}`);
      assert.ok(!init.body.includes(KEY));
      assert.ok(!url.includes(KEY));
      assert.equal(JSON.parse(init.body).model, 'test-model');
    });
  });

  test('openai honors VISION_BASE_URL', async () => {
    await withFetch(() => jsonResponse(openAiReply(GOOD_JSON)), async (calls) => {
      const provider = createVisionProvider(realConfig('openai', { VISION_BASE_URL: 'http://localhost:9999/v1/' }));
      await provider.extract({ bytes: BYTES, mimeType: 'image/png' });
      assert.equal(calls[0].url, 'http://localhost:9999/v1/chat/completions');
    });
  });

  test('anthropic request shape: URL, key in header only', async () => {
    await withFetch(() => jsonResponse(anthropicReply(GOOD_JSON)), async (calls) => {
      const provider = createVisionProvider(realConfig('anthropic'));
      assert.equal(provider.name, 'anthropic');
      const raw = await provider.extract({ bytes: BYTES, mimeType: 'image/jpeg' });
      assert.equal(raw.name, 'Test Plumbing');
      const { url, init } = calls[0];
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], KEY);
      assert.ok(!init.body.includes(KEY));
      assert.equal(JSON.parse(init.body).model, 'test-model');
    });
  });

  for (const provider of ['openai', 'anthropic']) {
    describe(`${provider} failures`, () => {
      const extract = (config) =>
        extractDraft({
          provider: createVisionProvider(config),
          bytes: BYTES,
          mimeType: 'image/png',
          categories: CATEGORIES,
        });

      test('non-2xx response -> provider_failed', async () => {
        await withFetch(() => jsonResponse({ error: KEY }, 500), async () => {
          await assert.rejects(extract(realConfig(provider)), (err) => {
            assert.ok(err instanceof ExtractionError);
            assert.equal(err.code, 'provider_failed');
            return true;
          });
        });
      });

      test('network failure -> provider_failed', async () => {
        await withFetch(() => { throw new Error(`connect failed ${KEY}`); }, async () => {
          await assert.rejects(extract(realConfig(provider)), (err) => {
            assert.equal(err.code, 'provider_failed');
            assert.ok(!err.message.includes(KEY));
            return true;
          });
        });
      });

      test('timeout -> timeout', async () => {
        const hang = (_url, init) =>
          new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        await withFetch(hang, async () => {
          const config = { ...realConfig(provider), providerTimeoutMs: 25 };
          await assert.rejects(extract(config), (err) => {
            assert.ok(err instanceof ExtractionError);
            assert.equal(err.code, 'timeout');
            return true;
          });
        });
      });

      test('unparseable reply -> unparseable', async () => {
        const reply = provider === 'openai' ? openAiReply('not json at all') : anthropicReply('not json at all');
        await withFetch(() => jsonResponse(reply), async () => {
          await assert.rejects(extract(realConfig(provider)), (err) => {
            assert.ok(err instanceof ExtractionError);
            assert.equal(err.code, 'unparseable');
            return true;
          });
        });
      });

      test('key never appears in output or error messages during failures', async () => {
        const scenarios = [
          () => jsonResponse({ error: KEY }, 401),
          () => { throw new Error(`boom ${KEY}`); },
          () => jsonResponse(provider === 'openai' ? openAiReply(`bad ${KEY}`) : anthropicReply(`bad ${KEY}`)),
        ];
        const messages = [];
        const output = await captureOutput(async () => {
          for (const scenario of scenarios) {
            await withFetch(scenario, async () => {
              try {
                await extract(realConfig(provider));
                assert.fail('expected failure');
              } catch (err) {
                if (!(err instanceof ExtractionError)) throw err;
                messages.push(err.message, err.code, String(err.stack));
              }
            });
          }
        });
        assert.ok(!output.includes(KEY));
        for (const m of messages) assert.ok(!m.includes(KEY));
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Assistant half
// ---------------------------------------------------------------------------

const PROMPT = 'Who are the best plumbers in Nashville?';

// Providers resolve { answer, provider, model, webSearch }; older stubs may return a string.
const textOf = r => (typeof r === 'string' ? r : r.answer);

function realAssistantConfig(provider, extra = {}) {
  return configFromEnv({
    SEANCE_PROVIDER: provider,
    SEANCE_API_KEY: KEY,
    SEANCE_MODEL: 'seance-model',
    ...extra,
  }, { warn: () => {} });
}

describe('mock assistant provider', () => {
  test('Property 14: same text for identical prompts, always a non-empty string', async () => {
    const provider = createMockAssistantProvider();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (prompt) => {
        const a = textOf(await provider.ask({ prompt }));
        const b = textOf(await provider.ask({ prompt }));
        assert.equal(typeof a, 'string');
        assert.ok(a.trim().length > 0);
        assert.equal(a, b);
      }),
      { numRuns: 100 },
    );
  });

  test('makes no fetch calls', async () => {
    await withFetch(() => { throw new Error('should not be called'); }, async (calls) => {
      const answer = textOf(await createMockAssistantProvider().ask({ prompt: PROMPT }));
      assert.equal(typeof answer, 'string');
      assert.equal(calls.length, 0);
    });
  });
});

describe('assistant config selection', () => {
  const full = { SEANCE_PROVIDER: 'openai', SEANCE_API_KEY: KEY, SEANCE_MODEL: 'm' };

  test('mock when no key is set', () => {
    assert.equal(assistantProviderName({ SEANCE_PROVIDER: 'openai', SEANCE_MODEL: 'm' }), 'mock');
    assert.equal(assistantProviderName({}), 'mock');
  });

  test('mock in test runs even with a full config', () => {
    assert.equal(assistantProviderName({ ...full, NODE_TEST_CONTEXT: 'child-v8' }), 'mock');
    assert.equal(configFromEnv({ ...full, NODE_TEST_CONTEXT: '1' }).assistantProviderName, 'mock');
  });

  test('mock for an unknown provider', () => {
    assert.equal(assistantProviderName({ ...full, SEANCE_PROVIDER: 'nope' }), 'mock');
  });

  test('real provider is selected with a key', () => {
    assert.equal(assistantProviderName(full), 'openai');
    assert.equal(assistantProviderName({ ...full, SEANCE_PROVIDER: 'Anthropic' }), 'anthropic');
  });

  test('real provider without SEANCE_MODEL warns (without the key) and returns mock', () => {
    const warnings = [];
    const config = configFromEnv(
      { SEANCE_PROVIDER: 'anthropic', SEANCE_API_KEY: KEY },
      { warn: (m) => warnings.push(m) },
    );
    assert.equal(config.assistantProviderName, 'anthropic');
    const provider = createAssistantProvider(config, { warn: (m) => warnings.push(m) });
    assert.equal(provider.name, 'mock');
    assert.equal(warnings.length, 1);
    assert.ok(!warnings[0].includes(KEY));
  });

  test('redactConfig hides the assistant key', () => {
    const real = realAssistantConfig('openai');
    assert.ok(!JSON.stringify(redactConfig(real)).includes(KEY));
    assert.equal(redactConfig(real).assistant.apiKey, '[set]');
  });
});

describe('assistant adapters (stubbed fetch)', () => {
  test('zero fetch calls without a key', async () => {
    await withFetch(() => { throw new Error('should not be called'); }, async (calls) => {
      const config = configFromEnv({ SEANCE_PROVIDER: 'openai', SEANCE_MODEL: 'm' });
      const provider = createAssistantProvider(config);
      assert.equal(provider.name, 'mock');
      await provider.ask({ prompt: PROMPT });
      assert.equal(calls.length, 0);
    });
  });

  test('openai request shape: URL, key in header only, prompt as user message', async () => {
    await withFetch(() => jsonResponse(openAiReply('Try Acme Plumbing.')), async (calls) => {
      const provider = createAssistantProvider(realAssistantConfig('openai'));
      assert.equal(provider.name, 'openai');
      const answer = textOf(await provider.ask({ prompt: PROMPT }));
      assert.equal(answer, 'Try Acme Plumbing.');
      assert.equal(calls.length, 1);
      const { url, init } = calls[0];
      assert.equal(url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.authorization, `Bearer ${KEY}`);
      assert.ok(!init.body.includes(KEY));
      assert.ok(!url.includes(KEY));
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'seance-model');
      assert.deepEqual(body.messages, [{ role: 'user', content: PROMPT }]);
    });
  });

  test('openai honors SEANCE_BASE_URL', async () => {
    await withFetch(() => jsonResponse(openAiReply('ok')), async (calls) => {
      const provider = createAssistantProvider(
        realAssistantConfig('openai', { SEANCE_BASE_URL: 'http://localhost:9999/v1/' }),
      );
      await provider.ask({ prompt: PROMPT });
      assert.equal(calls[0].url, 'http://localhost:9999/v1/chat/completions');
    });
  });

  test('anthropic request shape: URL, key in header only, prompt as user message', async () => {
    await withFetch(() => jsonResponse(anthropicReply('Try Acme Plumbing.')), async (calls) => {
      const provider = createAssistantProvider(realAssistantConfig('anthropic'));
      assert.equal(provider.name, 'anthropic');
      const result = await provider.ask({ prompt: PROMPT });
      assert.equal(result.answer, 'Try Acme Plumbing.');
      const { url, init } = calls[0];
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      assert.equal(init.headers['x-api-key'], KEY);
      assert.ok(!init.body.includes(KEY));
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'seance-model');
      assert.deepEqual(body.messages, [{ role: 'user', content: PROMPT }]);
    });
  });

  for (const provider of ['openai', 'anthropic']) {
    describe(`${provider} assistant failures`, () => {
      const ask = (config) => createAssistantProvider(config).ask({ prompt: PROMPT });
      const reply = (text) => (provider === 'openai' ? openAiReply(text) : anthropicReply(text));

      test('non-2xx response -> provider_failed', async () => {
        await withFetch(() => jsonResponse({ error: KEY }, 500), async () => {
          await assert.rejects(ask(realAssistantConfig(provider)), (err) => {
            assert.ok(err instanceof AssistantError);
            assert.equal(err.code, 'provider_failed');
            return true;
          });
        });
      });

      test('network failure -> provider_failed', async () => {
        await withFetch(() => { throw new Error(`connect failed ${KEY}`); }, async () => {
          await assert.rejects(ask(realAssistantConfig(provider)), (err) => {
            assert.ok(err instanceof AssistantError);
            assert.equal(err.code, 'provider_failed');
            assert.ok(!err.message.includes(KEY));
            return true;
          });
        });
      });

      test('timeout -> timeout', async () => {
        const hang = (_url, init) =>
          new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          });
        await withFetch(hang, async () => {
          const config = { ...realAssistantConfig(provider), providerTimeoutMs: 25 };
          await assert.rejects(ask(config), (err) => {
            assert.ok(err instanceof AssistantError);
            assert.equal(err.code, 'timeout');
            return true;
          });
        });
      });

      test('unreadable reply -> unparseable', async () => {
        const bodies = [
          () => new Response('not json at all', { status: 200 }),
          () => jsonResponse({ unexpected: true }),
          () => jsonResponse(reply('')),
        ];
        for (const body of bodies) {
          await withFetch(body, async () => {
            await assert.rejects(ask(realAssistantConfig(provider)), (err) => {
              assert.ok(err instanceof AssistantError);
              assert.equal(err.code, 'unparseable');
              return true;
            });
          });
        }
      });

      test('key never appears in output or error messages during failures', async () => {
        const scenarios = [
          () => jsonResponse({ error: KEY }, 401),
          () => { throw new Error(`boom ${KEY}`); },
          () => jsonResponse(reply('')),
        ];
        const messages = [];
        const output = await captureOutput(async () => {
          for (const scenario of scenarios) {
            await withFetch(scenario, async () => {
              try {
                await ask(realAssistantConfig(provider));
                assert.fail('expected failure');
              } catch (err) {
                if (!(err instanceof AssistantError)) throw err;
                messages.push(err.message, err.code, String(err.stack));
              }
            });
          }
        });
        assert.ok(!output.includes(KEY));
        for (const m of messages) assert.ok(!m.includes(KEY));
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 3b. Trade-matched mock assistant (task 14.5)
// ---------------------------------------------------------------------------

// Independent oracle of the fixture business names, by category slug.
const TRADE_FIXTURES = {
  plumbers: ['Nashville Pipe Pros', 'Honky Tonk Plumbing', 'Cumberland Drain Co', 'Copper Kettle Plumbing', 'Blue Anchor Pipe Works', 'Delmar Drain Service'],
  electricians: ['Volt Brothers Electric', 'Music City Wiring', 'Neon & Ohm Electric', 'Lantern Electric', 'Brightline Wiring', 'Ridgeway Electrical'],
  restaurants: ['The Griddle House', 'Biscuit & Brine', 'Hot Plate Nashville', 'Skillet & Smoke', 'Fifth Street Diner', 'The Corner Table'],
  'auto-repair': ['Cumberland Auto Works', 'Five Points Auto', 'Pedal to the Metal Garage', 'Lug Nut Garage', 'Riverside Brake & Tire', 'Old Hickory Auto Service'],
  'hair-salons': ['Shear Nashville', 'The Clip Joint', 'Bangs & Bobs Studio', 'Velvet Scissors', 'Lucky Comb Salon', 'Main Street Barber & Style'],
  lawyers: ['Barrett & Hollow Law', 'Hatch & Greer Attorneys', 'Stone River Legal', 'Marlow & Pike Law', 'Capitol Hill Legal', 'Dunmore Attorneys'],
};
const TRADE_SLUGS = Object.keys(TRADE_FIXTURES);
const ALL_FIXTURE_NAMES = Object.values(TRADE_FIXTURES).flat();

const mentioned = (answer, names) => names.filter(n => answer.includes(n));

describe('trade-matched mock assistant', () => {
  // Known slugs, unknown strings (including prototype keys), or no category.
  const arbCategory = fc.oneof(
    fc.constantFrom(...TRADE_SLUGS),
    fc.string({ maxLength: 20 }).filter(s => !TRADE_SLUGS.includes(s)),
    fc.constantFrom('constructor', '__proto__', 'toString', 'unknown-trade', ''),
    fc.constant(undefined),
  );
  // The "Zqx " prefix keeps generated names out of every canned answer and fixture name.
  const arbBusinessName = fc.oneof(
    fc.constant(undefined),
    fc.constant(''),
    fc.constant('   '),
    fc.stringMatching(/^[A-Za-z0-9 ]{0,20}$/).map(s => `Zqx ${s}`),
  );

  test('deterministic, non-empty, and never names a business from a different trade', async () => {
    // **Validates: trade-matched mock (task 14.5)**
    const provider = createMockAssistantProvider();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 80 }), arbCategory, arbBusinessName, async (prompt, category, businessName) => {
        const args = { prompt, category, businessName };
        const a = textOf(await provider.ask(args));
        const b = textOf(await provider.ask({ ...args }));
        assert.equal(typeof a, 'string');
        assert.ok(a.trim().length > 0);
        assert.equal(a, b);

        const known = typeof category === 'string' && TRADE_SLUGS.includes(category);
        const name = typeof businessName === 'string' ? businessName.trim() : '';
        if (!known) {
          // Unknown or missing category: neutral answer, no fixture names, no business name.
          assert.deepEqual(mentioned(a, ALL_FIXTURE_NAMES), []);
          if (name !== '') assert.ok(!a.includes(name));
          return;
        }
        const otherTrades = ALL_FIXTURE_NAMES.filter(n => !TRADE_FIXTURES[category].includes(n));
        assert.deepEqual(mentioned(a, otherTrades), []);
        if (name === '' || !a.includes(name)) {
          // Same-trade pool answer or neutral answer: every fixture name belongs to this trade.
          for (const n of mentioned(a, ALL_FIXTURE_NAMES)) assert.ok(TRADE_FIXTURES[category].includes(n));
        }
      }),
      { numRuns: 300 },
    );
  });

  test('share of answers naming the business is between 0.2 and 0.5', async () => {
    // The mock names the business when a hash byte % 3 === 0, so the expected share is
    // about 1/3. Over 600 fixed pairs the standard deviation is about 0.02, so the
    // 0.2 to 0.5 tolerance is several deviations wide. The pairs are fixed, so the
    // result is deterministic and the test cannot flake.
    const provider = createMockAssistantProvider();
    const total = 600;
    let named = 0;
    for (let i = 0; i < total; i++) {
      const businessName = `Zqx Business ${i} Plumbing`;
      const answer = textOf(await provider.ask({
        prompt: `best plumbers in City${i % 25}`,
        category: 'plumbers',
        businessName,
      }));
      if (answer.includes(businessName)) named++;
    }
    const share = named / total;
    assert.ok(share >= 0.2 && share <= 0.5, `share was ${share}`);
  });
});

// ---------------------------------------------------------------------------
// 3c. Anthropic web search request (task 20.6)
// ---------------------------------------------------------------------------

describe('anthropic web search request', () => {
  const askAnthropic = () => createAssistantProvider(realAssistantConfig('anthropic')).ask({ prompt: PROMPT });

  test('sends exactly the web_search tool with max_uses 3 and max_tokens >= 1024', async () => {
    await withFetch(() => jsonResponse(anthropicReply('ok')), async (calls) => {
      await askAnthropic();
      assert.equal(calls.length, 1);
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
      assert.ok(body.max_tokens >= 1024);
    });
  });

  test('sends no anthropic-beta header; key only in x-api-key and never in logs', async () => {
    await withFetch(() => jsonResponse(anthropicReply('ok')), async (calls) => {
      const output = await captureOutput(async () => { await askAnthropic(); });
      const { url, init } = calls[0];
      const names = Object.keys(init.headers).map(h => h.toLowerCase());
      assert.ok(!names.includes('anthropic-beta'));
      assert.equal(init.headers['x-api-key'], KEY);
      for (const [k, v] of Object.entries(init.headers)) {
        if (k.toLowerCase() !== 'x-api-key') assert.ok(!String(v).includes(KEY));
      }
      assert.ok(!init.body.includes(KEY));
      assert.ok(!url.includes(KEY));
      assert.ok(!output.includes(KEY));
    });
  });

  test('answer joins text blocks in order and ignores search blocks', async () => {
    const content = [
      { type: 'text', text: 'Let me check. ' },
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'plumbers' } },
      { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', title: 'IGNORED', url: 'https://x.test' }] },
      { type: 'text', text: 'Try Acme ' },
      { type: 'text', text: 'Plumbing.' },
    ];
    await withFetch(() => jsonResponse({ content, stop_reason: 'end_turn' }), async () => {
      const result = await askAnthropic();
      assert.equal(result.answer, 'Let me check. Try Acme Plumbing.');
    });
  });

  test('pause_turn triggers exactly one extra request with assistant content last', async () => {
    const first = [
      { type: 'text', text: 'Searching. ' },
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'q' } },
    ];
    const replies = [
      { content: first, stop_reason: 'pause_turn' },
      { content: [{ type: 'text', text: 'Final answer.' }], stop_reason: 'end_turn' },
    ];
    await withFetch(() => jsonResponse(replies.shift()), async (calls) => {
      const result = await askAnthropic();
      assert.equal(calls.length, 2);
      assert.equal(result.answer, 'Final answer.');
      const second = JSON.parse(calls[1].init.body);
      assert.deepEqual(second.messages[0], { role: 'user', content: PROMPT });
      assert.deepEqual(second.messages[second.messages.length - 1], { role: 'assistant', content: first });
      assert.deepEqual(second.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]);
    });
  });

  test('a second pause_turn does not loop further', async () => {
    const paused = { content: [{ type: 'text', text: 'still going' }], stop_reason: 'pause_turn' };
    await withFetch(() => jsonResponse(paused), async (calls) => {
      const result = await askAnthropic();
      assert.equal(calls.length, 2);
      assert.equal(result.answer, 'still going');
    });
  });

  test('openai sends no tools and mock makes no request', async () => {
    await withFetch(() => jsonResponse(openAiReply('ok')), async (calls) => {
      const result = await createAssistantProvider(realAssistantConfig('openai')).ask({ prompt: PROMPT });
      assert.equal(result.webSearch, false);
      assert.ok(!('tools' in JSON.parse(calls[0].init.body)));
    });
    await withFetch(() => { throw new Error('should not be called'); }, async (calls) => {
      const result = await createMockAssistantProvider().ask({ prompt: PROMPT });
      assert.equal(result.webSearch, false);
      assert.equal(calls.length, 0);
    });
  });

  test('result is {answer, provider, model, webSearch}', async () => {
    await withFetch(() => jsonResponse(anthropicReply('Try Acme.')), async () => {
      const result = await askAnthropic();
      assert.deepEqual(result, { answer: 'Try Acme.', provider: 'anthropic', model: 'seance-model', webSearch: true });
    });
  });

  test('Property: answer is the ordered join of text blocks, whatever other blocks appear', async () => {
    // **Validates: Requirements 20 (anthropic web search answer extraction)**
    const arbBlock = fc.oneof(
      fc.record({ type: fc.constant('text'), text: fc.string({ maxLength: 30 }) }),
      fc.record({ type: fc.constant('server_tool_use'), id: fc.string({ maxLength: 8 }), name: fc.constant('web_search'), input: fc.record({ query: fc.string({ maxLength: 20 }) }) }),
      fc.record({ type: fc.constant('web_search_tool_result'), tool_use_id: fc.string({ maxLength: 8 }), content: fc.array(fc.record({ type: fc.constant('web_search_result'), title: fc.string({ maxLength: 20 }) }), { maxLength: 3 }) }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(arbBlock, { maxLength: 8 }), async (content) => {
        const expected = content.filter(b => b.type === 'text').map(b => b.text).join('');
        await withFetch(() => jsonResponse({ content, stop_reason: 'end_turn' }), async () => {
          if (expected.trim() === '') {
            await assert.rejects(askAnthropic(), (err) => err instanceof AssistantError && err.code === 'unparseable');
          } else {
            const result = await askAnthropic();
            assert.equal(result.answer, expected);
            assert.equal(result.webSearch, true);
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});
