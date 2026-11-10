// Environment-based configuration. This is the only module that decides
// which providers are used from env vars; everything else receives
// resolved dependencies through createApp().
//
// Secrets (API keys, admin token) live only in the object returned by
// configFromEnv() for internal use. Use redactConfig() for anything that
// could be logged or returned.

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_DATA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'data'
);

export const DEFAULT_PROVIDER_TIMEOUT_MS = 30000;
export const DEFAULT_BASE_URL = 'http://localhost:3000';

export const DEFAULT_SITE_NAME = 'First Answer Pages';
const MAX_SITE_NAME_LENGTH = 80;

/**
 * SITE_NAME: single line, control characters removed, trimmed, max 80 chars.
 * Falls back to the default when unset or empty after cleaning.
 * @param {string | undefined} value
 * @returns {string}
 */
export function parseSiteName(value) {
  if (typeof value !== 'string') return DEFAULT_SITE_NAME;
  const cleaned = value
    .replace(/[\n\r\u2028\u2029\u0085]|\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SITE_NAME_LENGTH)
    .trim();
  return cleaned || DEFAULT_SITE_NAME;
}

const KNOWN_AI_PROVIDERS = new Set(['openai', 'anthropic']);
const KNOWN_NOTIFIERS = new Set(['console']);

/**
 * True when running under Node's test runner (it sets NODE_TEST_CONTEXT
 * in child processes).
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isTestRun(env = process.env) {
  return Boolean(env.NODE_TEST_CONTEXT);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function providerName(value) {
  const v = nonEmpty(value);
  return v ? v.toLowerCase() : undefined;
}

/**
 * Resolve Express `trust proxy` as a non-negative integer hop count only.
 * `true`, `false`, subnets, negatives, floats and other strings are ignored
 * with a warning (the raw value is never echoed). When TRUST_PROXY is unset
 * (or invalid) the default is 1 in production and undefined otherwise.
 */
function parseTrustProxy(value, production, warn = console.warn) {
  const v = nonEmpty(value);
  if (v !== undefined) {
    if (/^\d+$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
    warn('TRUST_PROXY must be a non-negative whole number (proxy hop count); ignoring it.');
  }
  return production ? 1 : undefined;
}

/**
 * DEMO_MODE: 'true'/'1' => true, 'false'/'0' => false (case-insensitive).
 * Unset or unrecognized: true, unless running in production (then false).
 */
export function parseDemoMode(value, production) {
  const v = nonEmpty(value)?.toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return !production;
}

/**
 * Vision provider name: 'openai' | 'anthropic' | 'mock'.
 * Mock unless the provider is known, VISION_API_KEY is set, and this is
 * not a test run. A real provider without VISION_MODEL warns and falls
 * back to mock. The warning never contains secret values.
 * @param {Record<string, string | undefined>} env
 * @param {{ warn?: (msg: string) => void }} [opts]
 */
export function visionProviderName(env = process.env, { warn = console.warn } = {}) {
  if (isTestRun(env)) return 'mock';
  const name = providerName(env.VISION_PROVIDER);
  if (!name || !KNOWN_AI_PROVIDERS.has(name)) return 'mock';
  if (!nonEmpty(env.VISION_API_KEY)) return 'mock';
  if (!nonEmpty(env.VISION_MODEL)) {
    warn(`VISION_PROVIDER=${name} requires VISION_MODEL; using the mock vision provider.`);
    return 'mock';
  }
  return name;
}

/**
 * Assistant (Seance) provider name: 'openai' | 'anthropic' | 'mock'.
 */
export function assistantProviderName(env = process.env) {
  if (isTestRun(env)) return 'mock';
  const name = providerName(env.SEANCE_PROVIDER);
  if (!name || !KNOWN_AI_PROVIDERS.has(name)) return 'mock';
  if (!nonEmpty(env.SEANCE_API_KEY)) return 'mock';
  return name;
}

/**
 * Notifier name: 'console' | 'mock'. Mock when unset, unknown, or in a
 * test run.
 */
export function notifierName(env = process.env) {
  if (isTestRun(env)) return 'mock';
  const name = providerName(env.NOTIFIER);
  return name && KNOWN_NOTIFIERS.has(name) ? name : 'mock';
}

/**
 * Fatal startup problems, one line each. Only production has requirements.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function startupProblems(env = process.env) {
  if (nonEmpty(env.NODE_ENV) !== 'production') return [];
  const problems = [];
  if (!nonEmpty(env.DATA_DIR)) problems.push('DATA_DIR is required in production');
  if (!nonEmpty(env.BASE_URL)) problems.push('BASE_URL is required in production');
  return problems;
}

/**
 * Resolve the full configuration from an env object.
 * The result contains secrets: keep it internal.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ warn?: (msg: string) => void }} [opts]
 */
export function configFromEnv(env = process.env, opts = {}) {
  const vision = visionProviderName(env, opts);
  const assistant = assistantProviderName(env);
  const notifier = notifierName(env);
  const production = nonEmpty(env.NODE_ENV) === 'production';

  return {
    production,
    demoMode: parseDemoMode(env.DEMO_MODE, production),
    siteName: parseSiteName(env.SITE_NAME),
    // Writable files (drafts, pending, published, quotes, seance, verified).
    dataDir: nonEmpty(env.DATA_DIR) ? path.resolve(env.DATA_DIR.trim()) : REPO_DATA_DIR,
    // Read-only seed files (listings.json, categories.json): always the repo data/ folder.
    seedDir: REPO_DATA_DIR,
    // ADMIN_TOKEN guards /admin/* and /seance/run; SEANCE_ADMIN_TOKEN is the older fallback name.
    adminToken: nonEmpty(env.ADMIN_TOKEN) || nonEmpty(env.SEANCE_ADMIN_TOKEN),
    baseUrl: (nonEmpty(env.BASE_URL) || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    trustProxy: parseTrustProxy(env.TRUST_PROXY, production, opts.warn ?? console.warn),
    testRun: isTestRun(env),

    visionProviderName: vision,
    assistantProviderName: assistant,
    notifierName: notifier,

    // Only populated for a real provider; mock needs none of this.
    vision:
      vision === 'mock'
        ? { provider: 'mock' }
        : {
            provider: vision,
            apiKey: nonEmpty(env.VISION_API_KEY),
            model: nonEmpty(env.VISION_MODEL),
            baseUrl: nonEmpty(env.VISION_BASE_URL),
          },
    assistant:
      assistant === 'mock'
        ? { provider: 'mock' }
        : {
            provider: assistant,
            apiKey: nonEmpty(env.SEANCE_API_KEY),
            model: nonEmpty(env.SEANCE_MODEL),
            baseUrl: nonEmpty(env.SEANCE_BASE_URL),
          },
  };
}

/**
 * A copy of the config that is safe to log or return: key and token
 * values are replaced by a set/unset marker.
 * @param {ReturnType<typeof configFromEnv>} config
 */
export function redactConfig(config) {
  const mark = (v) => (v ? '[set]' : '[unset]');
  return {
    ...config,
    adminToken: mark(config.adminToken),
    vision: { ...config.vision, ...(config.vision.apiKey !== undefined && { apiKey: mark(config.vision.apiKey) }) },
    assistant: {
      ...config.assistant,
      ...(config.assistant.apiKey !== undefined && { apiKey: mark(config.assistant.apiKey) }),
    },
  };
}
