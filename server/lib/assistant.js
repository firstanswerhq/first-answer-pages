/**
 * assistant.js — assistant providers for the Seance check: a deterministic
 * mock, two real adapters for the main assistant, and a ChatGPT adapter
 * used as a second opinion in the AI Visibility Check.
 *
 * A provider is { name, ask({ prompt, signal, category, businessName, consumeExtra }) }
 * and resolves to { answer, provider, model, webSearch } (the Anthropic adapter
 * adds sources: [{ url, title }], at most 8, http(s) only). The answer is untrusted
 * text. webSearch is true only for the Anthropic adapter, which enables the
 * server-side web_search tool (max 3 uses) and joins all text blocks in order.
 * consumeExtra() is called before a pause_turn resend (a second paid call); when
 * it returns anything but true the first reply is used instead.
 * Only the mock reads category and businessName; real adapters send just the
 * prompt and never the business name. The ChatGPT adapter uses OpenAI's
 * Responses API with its web_search tool (max 3 uses), asks OpenAI not to
 * store the exchange, and treats a reply that did not finish as a failure.
 * The Gemini adapter uses Google's generateContent without web search
 * (see createGeminiAssistantProvider for why).
 *
 * Keys go only in a request header. Logs carry the provider name, the HTTP
 * status and the shape of a reply (why it stopped, block type names, a token
 * count), never keys, prompts, or response bodies.
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
  'shops-and-restaurants': Object.freeze([
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
  'shops-and-restaurants': 'shops and restaurants',
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

/**
 * Log the shape of a reply, never its content: why it stopped, which kinds of
 * blocks came back and how many tokens were written. Enough to tell an empty
 * answer from a paused or cut-off one.
 */
function logShape(provider, data) {
  const clean = v => String(v ?? 'none').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'none';
  const blocks = Array.isArray(data?.content)
    ? data.content.slice(0, 40).map(b => clean(b?.type)).join(',')
    : 'none';
  const out = Number.isFinite(data?.usage?.output_tokens) ? data.usage.output_tokens : 'unknown';
  process.stderr.write(`[assistant] provider=${provider} stop=${clean(data?.stop_reason)} blocks=${blocks || 'none'} out=${out}\n`);
}

const USER_AGENT = 'FirstAnswerPages/1.0 (+https://firstanswerpages.com)';

/**
 * A short, safe label for a refused call: the provider's error type or code
 * (letters, digits and _ only, never its message), or "html" for a web page
 * (such as a firewall block). Never the key, never the reply text.
 */
async function errorKind(res) {
  let text = '';
  try { text = (await res.text()).slice(0, 4000); } catch { return 'unreadable'; }
  if (/^\s*</.test(text)) return /cloudflare/i.test(text) ? 'html-cloudflare' : 'html';
  let data;
  try { data = JSON.parse(text); } catch { return 'not-json'; }
  const err = data?.error ?? data;
  const vals = [err?.type, err?.code, err?.status];
  const kind = vals.find(v => typeof v === 'string') ?? vals.find(v => typeof v === 'number');
  if (kind === undefined) return 'unknown';
  // A code looks like one word; anything sentence-like could quote input, so it is not logged.
  if (typeof kind === 'string' && !/^[A-Za-z0-9_.-]{1,64}$/.test(kind)) return 'other';
  return String(kind).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40) || 'unknown';
}

// One fetch call; returns parsed response JSON. Logs name, status and, on a refusal, a safe error label.
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
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT, ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      logStatus(name, signal.aborted ? 'timeout' : 'network-error');
      throw new AssistantError(signal.aborted ? 'timeout' : 'provider_failed');
    }
    logStatus(name, res.status);
    if (!res.ok) {
      process.stderr.write(`[assistant] provider=${name} error=${await errorKind(res)}\n`);
      throw new AssistantError('provider_failed');
    }
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

// Current Claude models think before they answer, and that thinking counts
// toward max_tokens. 1024 was used up by searching and thinking before any
// answer text was written (stop_reason max_tokens, no text block). 4096 leaves
// room for both. The stored answer is still capped separately.
const ANTHROPIC_MAX_TOKENS = 4096;

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
        { model, max_tokens: ANTHROPIC_MAX_TOKENS, messages: msgs, tools: [ANTHROPIC_WEB_SEARCH_TOOL] },
        null,
        overall,
      );

      try {
        let data = await send(messages);
        logShape('anthropic', data);
        // pause_turn: the server-side search loop paused mid-turn. Continue exactly
        // once by resending the user message plus the assistant content so far, then
        // use the second reply. No further loop, even if it also pauses. The resend
        // is a second paid call: when the caller has no budget left for it, the
        // first reply is used as it is.
        if (data?.stop_reason === 'pause_turn' && Array.isArray(data.content) && extraAllowed(consumeExtra)) {
          data = await send([...messages, { role: 'assistant', content: data.content }]);
          logShape('anthropic', data);
        }
        // Cut off before the answer was written: any text so far is only a preamble
        // such as "I'll search for that", not something to score a business on.
        if (data?.stop_reason === 'max_tokens' && Array.isArray(data.content)
          && data.content[data.content.length - 1]?.type !== 'text') {
          throw new AssistantError('unparseable');
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

const CHATGPT_URL = 'https://api.openai.com/v1/responses';
export const DEFAULT_CHATGPT_MODEL = 'gpt-6.1-terra';

/** Answer text from a Responses API reply: every output_text part of every message item, in order. */
function joinOutputText(data) {
  if (!Array.isArray(data?.output)) return '';
  return data.output
    .filter(item => item?.type === 'message' && Array.isArray(item.content))
    .flatMap(item => item.content)
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('');
}

/** url_citation annotations from a Responses API reply, in the shape collectSources() reads. */
function chatGptCitations(data) {
  const citations = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      for (const a of Array.isArray(part?.annotations) ? part.annotations : []) {
        if (a?.type === 'url_citation') citations.push({ url: a.url, title: a.title });
      }
    }
  }
  return collectSources({ content: [{ type: 'text', citations }] });
}

/**
 * ChatGPT with live web search (OpenAI Responses API). A second opinion beside
 * the main assistant: the same question, asked of the AI most people use.
 */
export function createChatGptAssistantProvider({ apiKey, model = DEFAULT_CHATGPT_MODEL, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS }) {
  return {
    name: 'chatgpt',
    async ask({ prompt, signal } = {}) {
      const data = await callProvider(
        'chatgpt',
        CHATGPT_URL,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          input: String(prompt ?? ''),
          tools: [{ type: 'web_search', search_context_size: 'low' }],
          max_tool_calls: 3,
          max_output_tokens: 8192,
          store: false,
        },
        timeoutMs,
        signal,
      );
      const types = Array.isArray(data?.output) ? data.output.map(i => String(i?.type ?? '').replace(/[^a-z_]/gi, '')).join(',') : 'none';
      process.stderr.write(`[assistant] provider=chatgpt status=${String(data?.status ?? 'unknown').replace(/[^a-z_]/gi, '')} items=${types || 'none'}\n`);
      // A reply that did not finish may stop mid-list, so it is never scored as a full answer.
      if (data?.status !== 'completed') throw new AssistantError('unparseable');
      return {
        answer: requireText(joinOutputText(data)),
        provider: 'chatgpt',
        model,
        webSearch: Array.isArray(data?.output) && data.output.some(i => i?.type === 'web_search_call'),
        sources: chatGptCitations(data),
      };
    },
  };
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';

/** Answer text from a generateContent reply: every text part of the first candidate, in order. */
function joinGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.filter(p => typeof p?.text === 'string' && p.thought !== true).map(p => p.text).join('');
}

/**
 * Gemini as a second opinion: Google's generateContent, answering from what
 * the model already knows. Google Search grounding is deliberately NOT used:
 * Google's terms forbid analyzing grounded results, storing them for reports,
 * or showing them to anyone but the person who asked, and this check does all
 * three. The key goes only in the x-goog-api-key header. A reply that did not
 * finish normally (finishReason other than STOP) is a failure.
 */
export function createGeminiAssistantProvider({ apiKey, model = DEFAULT_GEMINI_MODEL, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS }) {
  const safeModel = String(model).replace(/[^A-Za-z0-9._-]/g, '');
  return {
    name: 'gemini',
    async ask({ prompt, signal } = {}) {
      const data = await callProvider(
        'gemini',
        `${GEMINI_BASE}${safeModel}:generateContent`,
        { 'x-goog-api-key': apiKey },
        {
          contents: [{ role: 'user', parts: [{ text: String(prompt ?? '') }] }],
          generationConfig: { maxOutputTokens: 8192 },
        },
        timeoutMs,
        signal,
      );
      const finish = String(data?.candidates?.[0]?.finishReason ?? 'none').replace(/[^A-Z_a-z]/g, '');
      process.stderr.write(`[assistant] provider=gemini finish=${finish}\n`);
      if (finish !== 'STOP') throw new AssistantError('unparseable');
      return {
        answer: requireText(joinGeminiText(data)),
        provider: 'gemini',
        model: safeModel,
        webSearch: false,
        sources: [],
      };
    },
  };
}

/**
 * Gemini WITH Google Search grounding, for the "Google's live answer" panel only.
 * Google's grounding terms allow showing the answer only to the person who asked,
 * with Google's Search Suggestions unchanged, and forbid analyzing, storing or
 * sharing it. So this result is never name-matched, scored, logged or saved:
 * the route shows it once to the browser that ran the check.
 * Returns { text, sources: [{ url, title }], suggestionsHtml }.
 */
export function createGeminiLiveSearch({ apiKey, model = DEFAULT_GEMINI_MODEL, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS }) {
  const safeModel = String(model).replace(/[^A-Za-z0-9._-]/g, '');
  return {
    name: 'gemini-live',
    async ask({ prompt, signal } = {}) {
      const data = await callProvider(
        'gemini-live',
        `${GEMINI_BASE}${safeModel}:generateContent`,
        { 'x-goog-api-key': apiKey },
        {
          contents: [{ role: 'user', parts: [{ text: String(prompt ?? '') }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: 8192 },
        },
        timeoutMs,
        signal,
      );
      const cand = data?.candidates?.[0];
      const finish = String(cand?.finishReason ?? 'none').replace(/[^A-Z_a-z]/g, '');
      process.stderr.write(`[assistant] provider=gemini-live finish=${finish}\n`);
      if (finish !== 'STOP') throw new AssistantError('unparseable');
      const meta = cand?.groundingMetadata ?? {};
      const sources = (Array.isArray(meta.groundingChunks) ? meta.groundingChunks : [])
        .map(c => c?.web)
        .filter(w => w && typeof w.uri === 'string' && /^https:\/\//i.test(w.uri))
        .slice(0, 10)
        .map(w => ({ url: w.uri, title: typeof w.title === 'string' ? w.title : '' }));
      const html = meta.searchEntryPoint?.renderedContent;
      return {
        text: requireText(joinGeminiText(data)),
        sources,
        suggestionsHtml: typeof html === 'string' && html.length <= 100_000 ? html : '',
      };
    },
  };
}

const GROK_URL = 'https://api.x.ai/v1/responses';
export const DEFAULT_GROK_MODEL = 'grok-4.7';

/** Bare https URLs from xAI's top-level citations list, in the shape collectSources() reads. */
function grokCitations(data) {
  const fromAnnotations = chatGptCitations(data);
  if (fromAnnotations.length > 0) return fromAnnotations;
  const list = Array.isArray(data?.citations) ? data.citations : [];
  const citations = list
    .map(c => (typeof c === 'string' ? { url: c, title: '' } : { url: c?.url, title: c?.title }))
    .filter(c => typeof c.url === 'string');
  return collectSources({ content: [{ type: 'text', citations }] });
}

/**
 * Grok (xAI) with live web search, through xAI's Responses API (same shape as
 * OpenAI's). A second opinion: shown beside the main answers, never scored.
 * xAI's terms give us the output; we never present it as written by a person.
 */
export function createGrokAssistantProvider({ apiKey, model = DEFAULT_GROK_MODEL, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS }) {
  return {
    name: 'grok',
    async ask({ prompt, signal } = {}) {
      const data = await callProvider(
        'grok',
        GROK_URL,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          input: [{ role: 'user', content: String(prompt ?? '') }],
          tools: [{ type: 'web_search' }],
          max_output_tokens: 8192,
          store: false,
        },
        timeoutMs,
        signal,
      );
      const status = String(data?.status ?? 'unknown').replace(/[^a-z_]/gi, '');
      process.stderr.write(`[assistant] provider=grok status=${status}\n`);
      // A reply that did not finish may stop mid-list, so it is never shown as a full answer.
      if (data?.status !== undefined && data.status !== 'completed') throw new AssistantError('unparseable');
      const sources = grokCitations(data);
      // Grok may write its sources into the text as links like [[1]](https://...); the list is kept separately.
      const answer = requireText(joinOutputText(data)).replace(/[ \t]?\[\[\d+\]\]\((?:[^()\s]|\([^()\s]*\))*\)/g, '');
      return {
        answer: requireText(answer),
        provider: 'grok',
        model,
        webSearch: (Array.isArray(data?.output) && data.output.some(i => /search/i.test(String(i?.type ?? '')))) || sources.length > 0,
        sources,
      };
    },
  };
}

const PERPLEXITY_URL = 'https://api.perplexity.ai/v1/agent';
export const DEFAULT_PERPLEXITY_MODEL = 'perplexity/sonar';

/** Search results Perplexity read, in the shape collectSources() reads. */
function perplexitySources(data) {
  const citations = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== 'search_results') continue;
    for (const r of Array.isArray(item.results) ? item.results : []) citations.push({ url: r?.url, title: r?.title });
  }
  return collectSources({ content: [{ type: 'text', citations }] });
}

/**
 * Perplexity (Sonar) with live web search, through Perplexity's Agent API.
 * A second opinion: shown beside the main answers, never scored.
 */
export function createPerplexityAssistantProvider({ apiKey, model = DEFAULT_PERPLEXITY_MODEL, timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS }) {
  return {
    name: 'perplexity',
    async ask({ prompt, signal } = {}) {
      const data = await callProvider(
        'perplexity',
        PERPLEXITY_URL,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          input: String(prompt ?? ''),
          tools: [{ type: 'web_search', search_type: 'fast', max_results: 8 }],
          max_output_tokens: 8192,
        },
        timeoutMs,
        signal,
      );
      const status = String(data?.status ?? 'unknown').replace(/[^a-z_]/gi, '');
      process.stderr.write(`[assistant] provider=perplexity status=${status}\n`);
      if (data?.status !== undefined && data.status !== 'completed') throw new AssistantError('unparseable');
      // Perplexity marks its sources inline like [web:1]; the source list is shown separately.
      const answer = requireText(joinOutputText(data)).replace(/[ \t]?\[web:\d+(?:\s*[-,]\s*(?:web:)?\d+)*[\s,]*\]/g, '');
      const sources = perplexitySources(data);
      return {
        answer: requireText(answer),
        provider: 'perplexity',
        model,
        webSearch: sources.length > 0,
        sources,
      };
    },
  };
}

/** The live Google panel's provider, or null when it is off (no key, switched off, or a test run). */
export function createGeminiLive(config) {
  const g = config?.gemini;
  if (!g?.apiKey || config?.geminiLive === false || config?.testRun === true) return null;
  const timeoutMs = config?.seanceTimeoutMs ?? config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  return createGeminiLiveSearch({ apiKey: g.apiKey, model: g.model || DEFAULT_GEMINI_MODEL, timeoutMs });
}

/**
 * Extra assistants asked beside the main one in the AI Visibility Check.
 * Empty unless their keys are set; never used in a test run.
 * @returns {{ name: string, ask: Function }[]}
 */
export function createExtraAssistants(config) {
  const extras = [];
  const c = config?.chatgpt;
  if (c?.apiKey && config?.testRun !== true) {
    const timeoutMs = config?.seanceTimeoutMs ?? config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    extras.push(createChatGptAssistantProvider({ apiKey: c.apiKey, model: c.model || DEFAULT_CHATGPT_MODEL, timeoutMs }));
  }
  const g = config?.gemini;
  if (g?.apiKey && config?.testRun !== true) {
    const timeoutMs = config?.seanceTimeoutMs ?? config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    extras.push(createGeminiAssistantProvider({ apiKey: g.apiKey, model: g.model || DEFAULT_GEMINI_MODEL, timeoutMs }));
  }
  const x = config?.grok;
  if (x?.apiKey && config?.testRun !== true) {
    const timeoutMs = config?.seanceTimeoutMs ?? config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    extras.push(createGrokAssistantProvider({ apiKey: x.apiKey, model: x.model || DEFAULT_GROK_MODEL, timeoutMs }));
  }
  const p = config?.perplexity;
  if (p?.apiKey && config?.testRun !== true) {
    const timeoutMs = config?.seanceTimeoutMs ?? config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
    extras.push(createPerplexityAssistantProvider({ apiKey: p.apiKey, model: p.model || DEFAULT_PERPLEXITY_MODEL, timeoutMs }));
  }
  return extras;
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
