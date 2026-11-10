/**
 * assistant.js — assistant providers for the Seance check: a deterministic
 * mock and two real adapters.
 *
 * A provider is { name, ask({ prompt, signal, category, businessName, consumeExtra }) }
 * and resolves to { answer, provider, model, webSearch } (the Anthropic adapter
 * adds sources: [{ url, title }], at most 8, http(s) only). The answer is untrusted
 * text. webSearch is true only for the Anthropic adapter, which enables the
 * server-side web_search tool (max 3 uses) and joins all text blocks in order.
 * consumeExtra() is called before a pause_turn resend (a second paid call); when
 * it returns anything but true the first reply is used instead.
 * Only the mock reads category and businessName; real adapters send just the
 * prompt and never the business name.
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

// Canned answers, one pool per category slug (data/categories.json). Each pool
// names fictional or seed businesses of that trade only.
const TRADE_ANSWERS = Object.freeze({
  plumbers: Object.freeze([
    'For best plumbers in Nashville, people often mention Nashville Pipe Pros, Honky Tonk Plumbing and Cumberland Drain Co.',
    'For best plumbers in Nashville, people often mention Copper Kettle Plumbing, Blue Anchor Pipe Works and Delmar Drain Service.',
  ]),
  electricians: Object.freeze([
    'For electricians in Nashville, people often mention Volt Brothers Electric, Music City Wiring and Neon & Ohm Electric.',
    'For electricians in Nashville, people often mention Lantern Electric, Brightline Wiring and Ridgeway Electrical.',
  ]),
  restaurants: Object.freeze([
    'For restaurants in Nashville, people often mention The Griddle House, Biscuit & Brine and Hot Plate Nashville.',
    'For restaurants in Nashville, people often mention Skillet & Smoke, Fifth Street Diner and The Corner Table.',
  ]),
  'auto-repair': Object.freeze([
    'For auto repair in Nashville, people often mention Cumberland Auto Works, Five Points Auto and Pedal to the Metal Garage.',
    'For auto repair in Nashville, people often mention Lug Nut Garage, Riverside Brake & Tire and Old Hickory Auto Service.',
  ]),
  'hair-salons': Object.freeze([
    'For hair salons in Nashville, people often mention Shear Nashville, The Clip Joint and Bangs & Bobs Studio.',
    'For hair salons in Nashville, people often mention Velvet Scissors, Lucky Comb Salon and Main Street Barber & Style.',
  ]),
  lawyers: Object.freeze([
    'For lawyers in Nashville, people often mention Barrett & Hollow Law, Hatch & Greer Attorneys and Stone River Legal.',
    'For lawyers in Nashville, people often mention Marlow & Pike Law, Capitol Hill Legal and Dunmore Attorneys.',
  ]),
});

// Trade phrase for the "names this business" answer, per category slug.
const TRADE_PHRASES = Object.freeze({
  plumbers: 'plumbers',
  electricians: 'electricians',
  restaurants: 'restaurants',
  'auto-repair': 'auto repair',
  'hair-salons': 'hair salons',
  lawyers: 'lawyers',
});

// Neutral answers name no business and fit any trade.
const NEUTRAL_ANSWERS = Object.freeze([
  'I do not have reliable information about that. Try asking a neighbor or checking a local bulletin board.',
  'There are many local businesses in that area, but I cannot name specific ones with confidence.',
]);

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Deterministic mock: SHA-256 of the prompt and business name picks a canned
 * answer from the pool for the listing's category plus neutral fallbacks. An
 * unknown or missing category uses neutral fallbacks only. About 1 in 3
 * answers for a known category name `businessName` when one is given. Pure
 * function of { prompt, category, businessName }; never touches the network.
 */
export function createMockAssistantProvider() {
  return {
    name: 'mock',
    async ask(args = {}) {
      const answer = mockAnswer(args ?? {});
      return { answer, provider: 'mock', model: 'mock', webSearch: false };
    },
  };
}

function mockAnswer({ prompt, category, businessName }) {
  const name = typeof businessName === 'string' ? businessName.trim() : '';
  const digest = createHash('sha256')
    .update(`${String(prompt ?? '')}|${name}`)
    .digest();
  const known = typeof category === 'string' && hasOwn(TRADE_ANSWERS, category);
  if (!known) return NEUTRAL_ANSWERS[digest[0] % NEUTRAL_ANSWERS.length];

  const pool = TRADE_ANSWERS[category];
  if (name !== '' && digest[0] % 3 === 0) {
    const trade = TRADE_PHRASES[category];
    // The sibling name comes from the trade pool, so it is the same trade.
    const sibling = pool[digest[1] % pool.length]
      .replace(/^.*mention /, '')
      .replace(/\.$/, '')
      .split(/, | and /)[0];
    return `For ${trade} in Nashville, people often mention ${name}, along with ${sibling}.`;
  }
  const choices = [...pool, ...NEUTRAL_ANSWERS];
  return choices[digest[1] % choices.length];
}

function logStatus(provider, status) {
  process.stderr.write(`[assistant] provider=${provider} status=${status}\n`);
}

/** One fetch call; returns parsed response JSON. Logs name and status only. */
async function callProvider(name, url, headers, body, timeoutMs, outerSignal) {
  const ctrl = new AbortController();
  // timeoutMs null: the caller owns the deadline and passes it in outerSignal.
  const timer = typeof timeoutMs === 'number' ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
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
      const answer = requireText(data?.choices?.[0]?.message?.content);
      return { answer, provider: 'openai', model, webSearch: false };
    },
  };
}

const ANTHROPIC_WEB_SEARCH_TOOL = Object.freeze({ type: 'web_search_20250305', name: 'web_search', max_uses: 3 });

/** Concatenate, in order, every text block's text. Other block types are ignored. */
function joinTextBlocks(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('');
}

const MAX_SOURCES = 8;
const MAX_SOURCE_TITLE_CHARS = 200;

/**
 * Citations from the text blocks (`block.citations[]` with url and title),
 * deduped by URL, at most 8. Only http: and https: URLs are kept. A title that
 * is missing or not a string falls back to the URL's hostname.
 * @returns {{ url: string, title: string }[]}
 */
export function collectSources(data) {
  if (!Array.isArray(data?.content)) return [];
  const seen = new Set();
  const sources = [];
  for (const block of data.content) {
    if (block?.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const c of block.citations) {
      if (sources.length >= MAX_SOURCES) return sources;
      if (typeof c?.url !== 'string') continue;
      let parsed;
      try {
        parsed = new URL(c.url.trim());
      } catch {
        continue;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      if (seen.has(parsed.href)) continue;
      seen.add(parsed.href);
      const title = typeof c.title === 'string'
        ? Array.from(c.title.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim())
          .slice(0, MAX_SOURCE_TITLE_CHARS).join('').trim()
        : '';
      sources.push({ url: parsed.href, title: title || parsed.hostname });
    }
  }
  return sources;
}

function createAnthropicAssistantProvider({ apiKey, model, timeoutMs }) {
  return {
    name: 'anthropic',
    async ask({ prompt, signal, consumeExtra } = {}) {
      const headers = { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION };
      const messages = [{ role: 'user', content: String(prompt ?? '') }];
      // One overall deadline for the whole ask: the first call and any resend.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const overall = signal ? AbortSignal.any([ctrl.signal, signal]) : ctrl.signal;
      const send = (msgs) => callProvider(
        'anthropic',
        ANTHROPIC_URL,
        headers,
        { model, max_tokens: 1024, messages: msgs, tools: [ANTHROPIC_WEB_SEARCH_TOOL] },
        null,
        overall,
      );

      try {
        let data = await send(messages);
        // pause_turn: the server-side search loop paused mid-turn. Continue exactly
        // once by resending the user message plus the assistant content so far, then
        // use the second reply. No further loop, even if it also pauses. The resend
        // is a second paid call: when the caller has no budget left for it, the
        // first reply is used as it is.
        if (data?.stop_reason === 'pause_turn' && Array.isArray(data.content) && extraAllowed(consumeExtra)) {
          data = await send([...messages, { role: 'assistant', content: data.content }]);
        }
        return {
          answer: requireText(joinTextBlocks(data)),
          provider: 'anthropic',
          model,
          webSearch: true,
          sources: collectSources(data),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** True when there is no budget callback, or it grants one more call. Never throws. */
function extraAllowed(consumeExtra) {
  if (typeof consumeExtra !== 'function') return true;
  try {
    return consumeExtra() === true;
  } catch {
    return false;
  }
}

/**
 * @param {object} config resolved config from configFromEnv()
 * @param {{ warn?: (msg: string) => void }} [opts]
 * @returns {{ name: string, ask: Function }}
 */
export function createAssistantProvider(config, { warn = console.warn } = {}) {
  const name = config?.assistantProviderName;
  const a = config?.assistant ?? {};
  // Séance has its own, longer deadline; hand-built configs fall back to providerTimeoutMs.
  const timeoutMs = config?.seanceTimeoutMs ?? config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
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
