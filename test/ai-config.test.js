/**
 * Tests for AI-related configuration: MAX_AI_CALLS_PER_DAY parsing, model
 * names read from env only, and production startup problems for the vision
 * and Séance providers.
 *
 * All env objects are passed explicitly; no network or real providers.
 *
 * **Validates: docs/launch-fixes.md (AI config and startup checks)**
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  DEFAULT_MAX_AI_CALLS_PER_DAY,
  parseMaxAiCalls,
  configFromEnv,
  startupProblems,
} from '../server/lib/config.js';

function collect() {
  const warnings = [];
  return { warnings, warn: (m) => warnings.push(m) };
}

const PROD_BASE = { NODE_ENV: 'production', DATA_DIR: '/tmp/data', BASE_URL: 'https://example.com' };

// ---- MAX_AI_CALLS_PER_DAY ---------------------------------------------------

test('default is 200', () => {
  assert.equal(DEFAULT_MAX_AI_CALLS_PER_DAY, 200);
});

test('unset MAX_AI_CALLS_PER_DAY gives 200 without a warning', () => {
  const { warnings, warn } = collect();
  assert.equal(parseMaxAiCalls(undefined, warn), 200);
  assert.equal(configFromEnv({}, { warn }).maxAiCallsPerDay, 200);
  assert.deepEqual(warnings, []);
});

test('a valid positive integer is used', () => {
  const { warnings, warn } = collect();
  assert.equal(parseMaxAiCalls('50', warn), 50);
  assert.equal(configFromEnv({ MAX_AI_CALLS_PER_DAY: '1' }, { warn }).maxAiCallsPerDay, 1);
  assert.deepEqual(warnings, []);
});

test('invalid values warn without echoing the value and use 200', () => {
  for (const bad of ['0', '-5', '1.5', 'abc', '12abc', '1e3', '0x10', '+7', '007']) {
    const { warnings, warn } = collect();
    assert.equal(parseMaxAiCalls(bad, warn), 200, bad);
    assert.equal(warnings.length, 1, bad);
    // A fixed message proves the value is never echoed (a plain includes() check
    // trips on '0', which is part of the default 200).
    assert.equal(warnings[0], 'MAX_AI_CALLS_PER_DAY must be a positive whole number; using 200.', bad);
  }
});

test('property: result is the positive integer value of the string, or 200', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.string(),
        fc.nat().map(String),
        fc.integer().map(String),
        fc.double().map(String)
      ),
      (s) => {
        const result = configFromEnv({ MAX_AI_CALLS_PER_DAY: s }, { warn: () => {} })
          .maxAiCallsPerDay;
        const t = s.trim();
        const expected =
          /^[1-9][0-9]*$/.test(t) && Number.isSafeInteger(Number(t)) ? Number(t) : 200;
        assert.equal(result, expected);
        assert.ok(Number.isInteger(result) && result > 0);
      }
    ),
    { numRuns: 200 }
  );
});

// ---- model names ------------------------------------------------------------

test('SEANCE_MODEL and VISION_MODEL are read from env only', () => {
  const env = {
    SEANCE_PROVIDER: 'anthropic',
    SEANCE_API_KEY: 'sk-seance-secret',
    SEANCE_MODEL: 'seance-model-x',
    VISION_PROVIDER: 'openai',
    VISION_API_KEY: 'sk-vision-secret',
    VISION_MODEL: 'vision-model-y',
  };
  const config = configFromEnv(env, { warn: () => {} });
  assert.equal(config.assistant.model, 'seance-model-x');
  assert.equal(config.vision.model, 'vision-model-y');
});

test('no default model: without env models, real providers are not used', () => {
  const { warnings, warn } = collect();
  const config = configFromEnv(
    {
      SEANCE_PROVIDER: 'anthropic',
      SEANCE_API_KEY: 'sk-seance-secret',
      VISION_PROVIDER: 'openai',
      VISION_API_KEY: 'sk-vision-secret',
    },
    { warn }
  );
  assert.equal(config.vision.provider, 'mock');
  assert.equal(config.vision.model, undefined);
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes('sk-vision-secret'));
});

// ---- production startup problems --------------------------------------------

test('non-production has no startup problems', () => {
  assert.deepEqual(startupProblems({ VISION_PROVIDER: 'bogus' }), []);
});

test('production refuses missing key and model for both providers', () => {
  for (const prefix of ['VISION', 'SEANCE']) {
    const problems = startupProblems({ ...PROD_BASE, [`${prefix}_PROVIDER`]: 'openai' });
    assert.ok(
      problems.includes(`${prefix}_API_KEY is required when ${prefix}_PROVIDER is set in production`)
    );
    assert.ok(
      problems.includes(`${prefix}_MODEL is required when ${prefix}_PROVIDER is set in production`)
    );
  }
});

test('production refuses an unknown provider', () => {
  for (const prefix of ['VISION', 'SEANCE']) {
    const problems = startupProblems({ ...PROD_BASE, [`${prefix}_PROVIDER`]: 'bogus' });
    assert.deepEqual(problems, [`${prefix}_PROVIDER must be openai or anthropic`]);
  }
});

test('production with complete provider settings has no problems', () => {
  const problems = startupProblems({
    ...PROD_BASE,
    VISION_PROVIDER: 'openai',
    VISION_API_KEY: 'k1',
    VISION_MODEL: 'm1',
    SEANCE_PROVIDER: 'anthropic',
    SEANCE_API_KEY: 'k2',
    SEANCE_MODEL: 'm2',
  });
  assert.deepEqual(problems, []);
});

test('startup problems never contain key values', () => {
  const vKey = 'sk-vision-SECRET-123';
  const sKey = 'sk-seance-SECRET-456';
  const problems = startupProblems({
    ...PROD_BASE,
    VISION_PROVIDER: 'openai',
    VISION_API_KEY: vKey,
    SEANCE_PROVIDER: 'anthropic',
    SEANCE_API_KEY: sKey,
  });
  assert.ok(problems.length > 0);
  const text = problems.join('\n');
  assert.ok(!text.includes(vKey));
  assert.ok(!text.includes(sKey));
});

test('property: startup problems never include the API key', () => {
  fc.assert(
    fc.property(
      fc.constantFrom('VISION', 'SEANCE'),
      fc.constantFrom('openai', 'anthropic'),
      fc.hexaString({ minLength: 12, maxLength: 40 }).map((h) => `sk-${h}`),
      (prefix, provider, key) => {
        // Key is set but model is missing, so a problem is reported.
        const problems = startupProblems({
          ...PROD_BASE,
          [`${prefix}_PROVIDER`]: provider,
          [`${prefix}_API_KEY`]: key,
        });
        assert.ok(problems.length > 0);
        for (const p of problems) assert.ok(!p.includes(key));
      }
    ),
    { numRuns: 100 }
  );
});
