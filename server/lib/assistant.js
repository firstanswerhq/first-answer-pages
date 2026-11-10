/**
 * assistant.js — assistant providers for the Seance check: a deterministic
 * mock and two real adapters.
 *
 * A provider is { name, ask({ prompt, signal }) } and resolves to the
 * assistant's answer as a string. The answer is untrusted text.
 *
 * Keys go only in a request header. Logs carry the provider name and HTTP
 * status, never keys, prompts, or response bodies.
 */

import { createHash } from 'node:crypto';
import { DEFAULT_PROVIDER_TIMEOUT_MS } from './config.js';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MESSAGES = Object.freeze({
  provider_failed: 'The assistant provider failed.',
  timeout: 'The assistant provider timed out.',
  unparseable: 'The assistant provider returned an unreadable answer.',
});

/** Typed error with a fixed message. Never carries keys or response bodies. */
export class AssistantError extends Error {
  /** @param {'provider_failed' | 'timeout' | 'unparseable'} code */
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.provider_failed);
    this.name = 'AssistantError';
    this.code = MESSAGES[code] ? code : 'provider_failed';
  }
}

// Canned answers. Fictional names plus names from the data/listings.json seed
// so a "named" result can happen. Some answers name no fixture on purpose.
const CANNED_ANSWERS = Object.freeze([
  'For best plumbers in Nashville, people often mention Nashville Pipe Pros, Honky Tonk Plumbing and Cumberland Drain Co.',
  'For electricians in Nashville, people often mention Volt Brothers Electric, Music City Wiring and Neon & Ohm Electric.',
  'For restaurants in Nashville, people often mention The Griddle House, Biscuit & Brine and Hot Plate Nashville.',
  'For auto repair in Nashville, people often mention Cumberland Auto Works, Five Points Auto and Pedal to the Metal Garage.',
  'For hair salons in Nashville, people often mention Shear Nashville, The Clip Joint and Bangs & Bobs Studio.',
  'For lawyers in Nashville, people often mention Barrett & Hollow Law, Hatch & Greer Attorneys and Stone River Legal.',
  'For best plumbers in Nashville, people often mention Copper Kettle Plumbing, Blue Anchor Pipe Works and Delmar Drain Service.',
  'For electricians in Nashville, people often mention Lantern Electric, Brightline Wiring and Ridgeway Electrical.',
  'I do not have reliable information about that. Try asking a neighbor or checking a local bulletin board.',
  'There are many local businesses in that area, but I cannot name specific ones with confidence.',
]);

/**
 * Deterministic mock: SHA-256 of the prompt picks a canned answer. Pure
 * function of the prompt; never touches the network.
 */
export function createMockAssistantProvider() {
  return {
    name: 'mock',
    async ask({ prompt } = {}) {
      const digest = createHash('sha256').update(String(prompt ?? '')).digest();
      return CANNED_ANSWERS[digest[0] % CANNED_ANSWERS.length];
    },
  };
}

function logStatus(provider, status) {
  process.stderr.write(`[assistant] provider=${provider} status=${status}\n`);
}

/** One fetch call; returns parsed response JSON. Logs name and status only. */
async function callProvider(name, url, headers, body, timeoutMs, outerSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = outerSignal ? AbortSignal.any([ctrl.signal, outerSignal]) : ctrl.signal;
  try {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      logStatus(name, signal.aborted ? 'timeout' : 'network-error');
      throw new AssistantError(signal.aborted ? 'timeout' : 'provider_failed');
    }
    logStatus(name, res.status);
    if (!res.ok) throw new AssistantError('provider_failed');
    try {
      return await res.json();
    } catch {
      throw new AssistantError(signal.aborted ? 'timeout' : 'unparseable');
    }
  } finally {
    clearTimeout(timer);
  }
}

function requireText(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new AssistantError('unparseable');
  return text;
}

function createOpenAiAssistantProvider({ apiKey, model, baseUrl, timeoutMs }) {
  const root = (baseUrl || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    name: 'openai',
    async ask({ prompt, signal } = {}) {
      const data = await callProvider(
        'openai',
        `${root}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        { model, messages: [{ role: 'user', content: String(prompt ?? '') }] },
        timeoutMs,
        signal,
      );
      return requireText(data?.choices?.[0]?.message?.content);
    },
  };
}

function createAnthropicAssistantProvider({ apiKey, model, timeoutMs }) {
  return {
    name: 'anthropic',
    async ask({ prompt, signal } = {}) {
      const data = await callProvider(
        'anthropic',
        ANTHROPIC_URL,
        { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        { model, max_tokens: 1024, messages: [{ role: 'user', content: String(prompt ?? '') }] },
        timeoutMs,
        signal,
      );
      const block = Array.isArray(data?.content) ? data.content.find(b => b?.type === 'text') : undefined;
      return requireText(block?.text);
    },
  };
}

/**
 * @param {object} config resolved config from configFromEnv()
 * @param {{ warn?: (msg: string) => void }} [opts]
 * @returns {{ name: string, ask: Function }}
 */
export function createAssistantProvider(config, { warn = console.warn } = {}) {
  const name = config?.assistantProviderName;
  const a = config?.assistant ?? {};
  const timeoutMs = config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  if ((name === 'openai' || name === 'anthropic') && a.apiKey) {
    if (!a.model) {
      warn(`SEANCE_PROVIDER=${name} requires SEANCE_MODEL; using the mock assistant provider.`);
      return createMockAssistantProvider();
    }
    return name === 'openai'
      ? createOpenAiAssistantProvider({ apiKey: a.apiKey, model: a.model, baseUrl: a.baseUrl, timeoutMs })
      : createAnthropicAssistantProvider({ apiKey: a.apiKey, model: a.model, timeoutMs });
  }
  return createMockAssistantProvider();
}
