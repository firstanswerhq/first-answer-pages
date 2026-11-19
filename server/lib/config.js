// Environment-based configuration. This is the only module that decides
// which providers are used from env vars; everything else receives
// resolved dependencies through createApp().
//
// Secrets (API keys, admin token) live only in the object returned by
// configFromEnv() for internal use. Use redactConfig() for anything that
// could be logged or returned.

import { parseFoundersCap, parseFoundersDeadline } from './founders.js';
import { parseFeeCents, DEFAULT_FOUNDER_FEE_CENTS, DEFAULT_YEARLY_FEE_CENTS } from './trust.js';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
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

export const DEFAULT_MAX_AI_CALLS_PER_DAY = 200;

/**
 * MAX_AI_CALLS_PER_DAY: a plain positive integer. Unset gives the default;
 * anything else warns (without echoing the value) and gives the default.
 * @param {string | undefined} value
 * @param {(msg: string) => void} [warn]
 * @returns {number}
 */
export function parseMaxAiCalls(value, warn = console.warn) {
  const v = nonEmpty(value);
  if (v === undefined) return DEFAULT_MAX_AI_CALLS_PER_DAY;
  if (/^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
  warn(
    `MAX_AI_CALLS_PER_DAY must be a positive whole number; using ${DEFAULT_MAX_AI_CALLS_PER_DAY}.`
  );
  return DEFAULT_MAX_AI_CALLS_PER_DAY;
}

export const DEFAULT_GRADE_AI_CALLS_PER_DAY = 60;

/**
 * GRADE_AI_CALLS_PER_DAY: a whole number, 0 or more (0 turns the Grader's AI
 * question off). Unset gives 60; anything else warns (without echoing the
 * value) and gives 60.
 * @param {string | undefined} value
 * @param {(msg: string) => void} [warn]
 * @returns {number}
 */
export function parseGradeAiCalls(value, warn = console.warn) {
  const v = nonEmpty(value);
  if (v === undefined) return DEFAULT_GRADE_AI_CALLS_PER_DAY;
  if (/^(0|[1-9][0-9]*)$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
  warn(`GRADE_AI_CALLS_PER_DAY must be a whole number, 0 or more; using ${DEFAULT_GRADE_AI_CALLS_PER_DAY}.`);
  return DEFAULT_GRADE_AI_CALLS_PER_DAY;
}

export const DEFAULT_GRADE_MAX_RUNNING = 20;

/**
 * GRADE_MAX_RUNNING: how many checks may run at the same time; the rest wait in line. A positive
 * whole number. Unset gives 20; anything else warns (without echoing the value) and gives 20.
 * @param {string | undefined} value
 * @param {(msg: string) => void} [warn]
 * @returns {number}
 */
export function parseGradeMaxRunning(value, warn = console.warn) {
  const v = nonEmpty(value);
  if (v === undefined) return DEFAULT_GRADE_MAX_RUNNING;
  if (/^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
  warn(`GRADE_MAX_RUNNING must be a positive whole number; using ${DEFAULT_GRADE_MAX_RUNNING}.`);
  return DEFAULT_GRADE_MAX_RUNNING;
}

export const DEFAULT_GRADE_NETWORK_PER_DAY = 20;

/**
 * GRADE_NETWORK_PER_DAY: how many new checks one network (an IPv4 /24 or an IPv6 /64) may start a day.
 * A positive whole number. Unset gives 20; anything else warns (without echoing the value) and gives 20.
 * @param {string | undefined} value
 * @param {(msg: string) => void} [warn]
 * @returns {number}
 */
export function parseGradeNetworkPerDay(value, warn = console.warn) {
  const v = nonEmpty(value);
  if (v === undefined) return DEFAULT_GRADE_NETWORK_PER_DAY;
  if (/^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
  warn(`GRADE_NETWORK_PER_DAY must be a positive whole number; using ${DEFAULT_GRADE_NETWORK_PER_DAY}.`);
  return DEFAULT_GRADE_NETWORK_PER_DAY;
}

/** GRADER_ENABLED / GRADER_LEAD_GATE: 'off' (any case) is false; anything else is true. */
export function parseOnOff(value) {
  return nonEmpty(value)?.toLowerCase() !== 'off';
}

// One random key per process, used when GRADER_SECRET is not set.
let processGraderSecret;

export const DEFAULT_SEANCE_TIMEOUT_MS = 120000;

/**
 * SEANCE_TIMEOUT_MS: a plain positive integer (milliseconds). Unset gives the
 * default; anything else warns (without echoing the value) and gives the default.
 * @param {string | undefined} value
 * @param {(msg: string) => void} [warn]
 * @returns {number}
 */
export function parseSeanceTimeout(value, warn = console.warn) {
  const v = nonEmpty(value);
  if (v === undefined) return DEFAULT_SEANCE_TIMEOUT_MS;
  if (/^[1-9][0-9]*$/.test(v) && Number.isSafeInteger(Number(v))) return Number(v);
  warn(`SEANCE_TIMEOUT_MS must be a positive whole number; using ${DEFAULT_SEANCE_TIMEOUT_MS}.`);
  return DEFAULT_SEANCE_TIMEOUT_MS;
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

const RESEND_VARS = ['RESEND_API_KEY', 'NOTIFY_FROM', 'ADMIN_EMAIL'];

/**
 * Notifier name: 'mock' (test runs) | 'console' | 'resend' | 'none'.
 * Unset gives none. An unknown value warns (never echoed) and gives none.
 * Resend with a missing setting warns and gives none (production refuses to
 * start instead; see startupProblems). Warnings never contain values.
 * @param {Record<string, string | undefined>} env
 * @param {{ warn?: (msg: string) => void }} [opts]
 */
export function notifierName(env = process.env, { warn = console.warn } = {}) {
  if (isTestRun(env)) return 'mock';
  const name = providerName(env.NOTIFIER);
  if (name === undefined || name === 'none') return 'none';
  if (KNOWN_NOTIFIERS.has(name)) return name;
  if (name === 'resend') {
    const missing = RESEND_VARS.filter(v => !nonEmpty(env[v]));
    if (missing.length === 0) return 'resend';
    warn(`NOTIFIER=resend needs ${missing.join(', ')}; using none (no emails will be sent).`);
    return 'none';
  }
  warn('NOTIFIER must be none or resend; using none.');
  return 'none';
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
  if (providerName(env.NOTIFIER) === 'resend') {
    for (const v of RESEND_VARS) {
      if (!nonEmpty(env[v])) problems.push(`${v} is required when NOTIFIER=resend in production`);
    }
  }
  for (const prefix of ['VISION', 'SEANCE']) {
    const name = providerName(env[`${prefix}_PROVIDER`]);
    if (!name) continue;
    if (!KNOWN_AI_PROVIDERS.has(name)) {
      problems.push(`${prefix}_PROVIDER must be openai or anthropic`);
      continue;
    }
    if (!nonEmpty(env[`${prefix}_API_KEY`])) {
      problems.push(`${prefix}_API_KEY is required when ${prefix}_PROVIDER is set in production`);
    }
    if (!nonEmpty(env[`${prefix}_MODEL`])) {
      problems.push(`${prefix}_MODEL is required when ${prefix}_PROVIDER is set in production`);
    }
  }
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
  const notifier = notifierName(env, opts);
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
    // CONTACT_EMAIL: shown on /about, /privacy and in the footer when set.
    contactEmail: nonEmpty(env.CONTACT_EMAIL),
    providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    // One overall deadline for a Séance question, including a pause_turn resend.
    seanceTimeoutMs: parseSeanceTimeout(env.SEANCE_TIMEOUT_MS, opts.warn ?? console.warn),
    trustProxy: parseTrustProxy(env.TRUST_PROXY, production, opts.warn ?? console.warn),
    maxAiCallsPerDay: parseMaxAiCalls(env.MAX_AI_CALLS_PER_DAY, opts.warn ?? console.warn),
    // INDEXNOW=off stops the Bing ping on approve/unpublish (it only runs on the live site anyway).
    indexNow: nonEmpty(env.INDEXNOW)?.toLowerCase() === 'off' ? 'off' : 'on',
    testRun: isTestRun(env),

    // Founding Member program: first FOUNDERS_CAP approved listings signed up before FOUNDERS_DEADLINE.
    // FOUNDERS_CAP=0 turns it off.
    founders: { cap: parseFoundersCap(env.FOUNDERS_CAP), deadline: parseFoundersDeadline(env.FOUNDERS_DEADLINE) },

    // Paid Verified stamp. Off unless the Stripe key and all three Twilio values are set.
    trust: {
      stripeSecretKey: nonEmpty(env.STRIPE_SECRET_KEY),
      stripeWebhookSecret: nonEmpty(env.STRIPE_WEBHOOK_SECRET),
      twilioAccountSid: nonEmpty(env.TWILIO_ACCOUNT_SID),
      twilioAuthToken: nonEmpty(env.TWILIO_AUTH_TOKEN),
      twilioVerifyServiceSid: nonEmpty(env.TWILIO_VERIFY_SERVICE_SID),
      founderCents: parseFeeCents(env.VERIFY_FOUNDER_FEE_CENTS, DEFAULT_FOUNDER_FEE_CENTS),
      yearlyCents: parseFeeCents(env.VERIFY_YEARLY_FEE_CENTS, DEFAULT_YEARLY_FEE_CENTS),
    },

    // AI Visibility Grader (/grade).
    graderEnabled: parseOnOff(env.GRADER_ENABLED),
    graderLeadGate: parseOnOff(env.GRADER_LEAD_GATE),
    gradeAiCallsPerDay: parseGradeAiCalls(env.GRADE_AI_CALLS_PER_DAY, opts.warn ?? console.warn),
    gradeMaxRunning: parseGradeMaxRunning(env.GRADE_MAX_RUNNING, opts.warn ?? console.warn),
    gradeNetworkPerDay: parseGradeNetworkPerDay(env.GRADE_NETWORK_PER_DAY, opts.warn ?? console.warn),
    // Signs form stamps and unlock cookies. Without GRADER_SECRET a random per-process key is
    // used (unlocks then reset on restart); graderSecretGenerated lets createApp warn once.
    graderSecret: nonEmpty(env.GRADER_SECRET) ?? (processGraderSecret ??= randomBytes(32).toString('hex')),
    graderSecretGenerated: !nonEmpty(env.GRADER_SECRET),

    // ChatGPT as a second opinion in the AI Visibility Check. Off without CHATGPT_API_KEY.
    chatgpt: { apiKey: nonEmpty(env.CHATGPT_API_KEY), model: nonEmpty(env.CHATGPT_MODEL) },
    // Gemini as a second opinion. Off without GEMINI_API_KEY.
    gemini: { apiKey: nonEmpty(env.GEMINI_API_KEY), model: nonEmpty(env.GEMINI_MODEL) },
    // Grok (xAI) as a second opinion. Off without XAI_API_KEY.
    grok: { apiKey: nonEmpty(env.XAI_API_KEY), model: nonEmpty(env.XAI_MODEL) },
    // Perplexity as a second opinion. Off without PERPLEXITY_API_KEY.
    perplexity: { apiKey: nonEmpty(env.PERPLEXITY_API_KEY), model: nonEmpty(env.PERPLEXITY_MODEL) },
    // "Google's live answer" panel (Gemini with Google Search), shown only to the person who ran a check.
    geminiLive: parseOnOff(env.GEMINI_LIVE_SEARCH),
    // Gemini Decisions as a second check on reading AI answers for names. On with GEMINI_API_KEY unless 'off'.
    geminiNameCheck: parseOnOff(env.GEMINI_NAME_CHECK),
    decisionModel: nonEmpty(env.GEMINI_DECISION_MODEL),

    visionProviderName: vision,
    assistantProviderName: assistant,
    notifierName: notifier,
    // Only populated for the resend notifier.
    resend:
      notifier === 'resend'
        ? {
            apiKey: nonEmpty(env.RESEND_API_KEY),
            from: nonEmpty(env.NOTIFY_FROM),
            adminEmail: nonEmpty(env.ADMIN_EMAIL),
          }
        : undefined,

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
    ...(config.graderSecret !== undefined && { graderSecret: mark(config.graderSecret) }),
    ...(config.resend && { resend: { ...config.resend, apiKey: mark(config.resend.apiKey) } }),
    vision: { ...config.vision, ...(config.vision.apiKey !== undefined && { apiKey: mark(config.vision.apiKey) }) },
    assistant: {
      ...config.assistant,
      ...(config.assistant.apiKey !== undefined && { apiKey: mark(config.assistant.apiKey) }),
    },
    ...(config.chatgpt && { chatgpt: { ...config.chatgpt, apiKey: mark(config.chatgpt.apiKey) } }),
    ...(config.gemini && { gemini: { ...config.gemini, apiKey: mark(config.gemini.apiKey) } }),
    ...(config.grok && { grok: { ...config.grok, apiKey: mark(config.grok.apiKey) } }),
    ...(config.perplexity && { perplexity: { ...config.perplexity, apiKey: mark(config.perplexity.apiKey) } }),
    ...(config.trust && {
      trust: {
        ...config.trust,
        stripeSecretKey: mark(config.trust.stripeSecretKey),
        stripeWebhookSecret: mark(config.trust.stripeWebhookSecret),
        twilioAuthToken: mark(config.trust.twilioAuthToken),
      },
    }),
  };
}
