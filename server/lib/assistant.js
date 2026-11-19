/**
 * assistant.js — AI assistant providers: a deterministic mock, the main
 * adapters (openai, anthropic), four second-opinion adapters (ChatGPT, Gemini,
 * Grok, Perplexity) and Google's live answer (Gemini with Google Search).
 *
 * A provider is { name, ask({ prompt, category, businessName, signal, consumeExtra }) }
 * and resolves to { answer, provider, model, webSearch, sources? }. Failures
 * throw AssistantError with a fixed message and a code of provider_failed,
 * timeout or unparseable.
 *
 * Keys go only in a request header. Logs carry the provider name, an HTTP
 * status, a safe error label and the shape of a reply (block types, stop
 * reason, token count). They never carry keys, prompts, answers or search
 * results.
 */

import { createHash } from 'node:crypto';
import { DEFAULT_PROVIDER_TIMEOUT_MS, DEFAULT_SEANCE_TIMEOUT_MS } from './config.js';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const XAI_RESPONSES_URL = 'https://api.x.ai/v1/responses';
const PERPLEXITY_AGENT_URL = 'https://api.perplexity.ai/v1/agent';
const GEMINI_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

const CHATGPT_DEFAULT_MODEL = 'gpt-6.1-terra';
const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const GROK_DEFAULT_MODEL = 'grok-4.7';
const PERPLEXITY_DEFAULT_MODEL = 'perplexity/sonar';

// Thinking counts toward max_tokens: 1024 ran out before any answer text on the live site.
const ANTHROPIC_MAX_TOKENS = 4096;
const SECOND_OPINION_MAX_TOKENS = 8192;
const MAX_SOURCES = 8;
const MAX_TITLE_CODE_POINTS = 200;
const USER_AGENT = 'FirstAnswerPages/1.0 (+https://firstanswerhq.com)';

const WEB_SEARCH_TOOL = Object.freeze({ type: 'web_search_20250305', name: 'web_search', max_uses: 3 });

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const MESSAGES = Object.freeze({
  provider_failed: 'The AI assistant failed',
  timeout: 'The AI assistant timed out',
  unparseable: 'The AI assistant returned unusable output',
});

export class AssistantError extends Error {
  /**
   * @param {'provider_failed' | 'timeout' | 'unparseable'} code
   * @param {{ status?: number, retryAfterSeconds?: number }} [details] the provider's HTTP status and
   *   its retry-after value in seconds, when it gave one (used to retry once after a 429 or 529)
   */
  constructor(code, details = {}) {
    super(MESSAGES[code] ?? MESSAGES.provider_failed);
    this.name = 'AssistantError';
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'provider_failed';
    if (Number.isInteger(details?.status)) this.status = details.status;
    if (Number.isFinite(details?.retryAfterSeconds) && details.retryAfterSeconds >= 0) {
      this.retryAfterSeconds = details.retryAfterSeconds;
    }
  }
}

// ---------------------------------------------------------------------------
// Logging and HTTP helpers
// ---------------------------------------------------------------------------

const log = line => process.stderr.write(`[assistant] ${line}\n`);

/** A short label made only of letters, digits and underscores, so a hostile value cannot forge a log line. */
const clean = v => String(v ?? 'none').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'none';

/** Names of the first 40 blocks or items of a reply, never their content. */
const typeList = list => (Array.isArray(list)
  ? list.slice(0, 40).map(b => clean(b?.type)).join(',')
  : 'none') || 'none';

/** Log the shape of an Anthropic reply: why it stopped, block type names, tokens written. */
function logShape(provider, data) {
  const out = Number.isFinite(data?.usage?.output_tokens) ? data.usage.output_tokens : 'unknown';
  log(`provider=${provider} stop=${clean(data?.stop_reason)} blocks=${typeList(data?.content)} out=${out}`);
}

/**
 * A label for a refused call that is safe to log: a single-word type, status or
 * code from the provider's error object (words win over numbers), or html when a
 * firewall page came back, else "other". A bare string error is never used.
 */
function errorLabel(data, text, secret) {
  const err = data !== null && typeof data === 'object' ? data.error : undefined;
  if (err !== null && typeof err === 'object') {
    for (const candidate of [err.type, err.status, err.code]) {
      if (typeof candidate !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]{0,39}$/.test(candidate)) continue;
      if (secret && candidate.includes(secret)) continue;
      return candidate;
    }
  }
  if (typeof text === 'string' && /^\s*<(!doctype|html)/i.test(text)) {
    return /cloudflare/i.test(text.slice(0, 20000)) ? 'html-cloudflare' : 'html';
  }
  return 'other';
}

/** The retry-after header as seconds (a number, or an HTTP date), or undefined when there is none. */
function retryAfterSeconds(res) {
  const raw = typeof res?.headers?.get === 'function' ? res.headers.get('retry-after') : null;
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(raw.trim())) return Number(raw.trim());
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : undefined;
}

/** One deadline for everything a single ask() does, including a resend. */
function startDeadline(timeoutMs, outer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = outer ? AbortSignal.any([ctrl.signal, outer]) : ctrl.signal;
  return { signal, stop: () => clearTimeout(timer) };
}

/** POST JSON and return the parsed reply. Logs the provider name, a safe label and the status only. */
async function postJson({ provider, url, headers, body, signal, secret }) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    const timedOut = signal.aborted;
    log(`provider=${provider} error=${timedOut ? 'timeout' : 'network'}`);
    throw new AssistantError(timedOut ? 'timeout' : 'provider_failed');
  }
  let text;
  try {
    text = await res.text();
  } catch {
    throw new AssistantError(signal.aborted ? 'timeout' : 'provider_failed');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    log(`provider=${provider} error=${errorLabel(data, text, secret)} status=${Number(res.status) || 0}`);
    throw new AssistantError('provider_failed', {
      status: Number(res.status) || undefined,
      retryAfterSeconds: retryAfterSeconds(res),
    });
  }
  if (data === undefined) throw new AssistantError('unparseable');
  return data;
}

/** Run one request under its own deadline (used by every adapter that makes a single call). */
async function withDeadline(timeoutMs, outer, fn) {
  const deadline = startDeadline(timeoutMs, outer);
  try {
    return await fn(deadline.signal);
  } finally {
    deadline.stop();
  }
}

function timeoutFrom(config) {
  const n = config?.seanceTimeoutMs ?? config?.providerTimeoutMs;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SEANCE_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** { url, title } for an http(s) address, or null. The title is one clean line of at most 200 code points. */
function normalizeSource(rawUrl, rawTitle) {
  if (typeof rawUrl !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  let title = '';
  if (typeof rawTitle === 'string') {
    title = rawTitle.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
    title = Array.from(title).slice(0, MAX_TITLE_CODE_POINTS).join('').trim();
  }
  return { url: parsed.href, title: title || parsed.hostname };
}

function addSource(list, seen, rawUrl, rawTitle) {
  if (list.length >= MAX_SOURCES) return;
  const source = normalizeSource(rawUrl, rawTitle);
  if (!source || seen.has(source.url)) return;
  seen.add(source.url);
  list.push(source);
}

/**
 * Sources cited in an Anthropic reply: the citations on its text blocks, deduped
 * by address, http(s) only, at most 8, each with a clean title.
 * @param {object} data parsed Messages API reply
 * @returns {{ url: string, title: string }[]}
 */
export function collectSources(data) {
  const out = [];
  const seen = new Set();
  const content = Array.isArray(data?.content) ? data.content : [];
  for (const block of content) {
    if (block?.type !== 'text' || !Array.isArray(block.citations)) continue;
    for (const c of block.citations) addSource(out, seen, c?.url, c?.title);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

// Fictional businesses only, by trade. The mock never names a business from another trade.
const TRADE_POOLS = Object.freeze({
  plumbers: ['Nashville Pipe Pros', 'Honky Tonk Plumbing', 'Cumberland Drain Co', 'Copper Kettle Plumbing', 'Blue Anchor Pipe Works', 'Delmar Drain Service'],
  electricians: ['Volt Brothers Electric', 'Music City Wiring', 'Neon & Ohm Electric', 'Lantern Electric', 'Brightline Wiring', 'Ridgeway Electrical'],
  restaurants: ['The Griddle House', 'Biscuit & Brine', 'Hot Plate Nashville', 'Skillet & Smoke', 'Fifth Street Diner', 'The Corner Table'],
  'auto-repair': ['Cumberland Auto Works', 'Five Points Auto', 'Pedal to the Metal Garage', 'Lug Nut Garage', 'Riverside Brake & Tire', 'Old Hickory Auto Service'],
  'hair-salons': ['Shear Nashville', 'The Clip Joint', 'Bangs & Bobs Studio', 'Velvet Scissors', 'Lucky Comb Salon', 'Main Street Barber & Style'],
  lawyers: ['Barrett & Hollow Law', 'Hatch & Greer Attorneys', 'Stone River Legal', 'Marlow & Pike Law', 'Capitol Hill Legal', 'Dunmore Attorneys'],
});

const MOCK_INTROS = Object.freeze([
  'Here are a few local options people often mention:',
  'These are some well-reviewed local choices:',
  'A few businesses come up often for this search:',
  'Here are some places to start:',
]);

const MOCK_OUTROS = Object.freeze([
  'Call each one and ask about price and timing before you book.',
  'Check recent reviews and confirm hours before you go.',
  'It helps to ask for a written quote first.',
  'Hours and prices change, so call ahead.',
]);

// Used when there is no known trade: no business is named.
const MOCK_NEUTRAL = Object.freeze([
  'I could not find enough reliable information to name a specific business. Check recent reviews, ask neighbors, and get a quote from more than one place.',
  'There is not enough clear, current information for me to recommend a particular business. Look at local reviews and call a few places to compare.',
  'I am not able to point to one business with confidence. Ask people nearby who they use, and compare quotes before you choose.',
]);

/** Pure function of its input: SHA-256 of the prompt and name picks the answer. Never touches the network. */
export function createMockAssistantProvider() {
  return {
    name: 'mock',
    async ask({ prompt, category, businessName } = {}) {
      const name = typeof businessName === 'string' ? businessName.trim() : '';
      const digest = createHash('sha256').update(`${String(prompt ?? '')}\u0000${name}`).digest();
      const pool = typeof category === 'string' && Object.hasOwn(TRADE_POOLS, category)
        ? TRADE_POOLS[category]
        : undefined;
      let answer;
      if (!pool) {
        answer = MOCK_NEUTRAL[digest[3] % MOCK_NEUTRAL.length];
      } else {
        const start = digest[1] % pool.length;
        const names = [0, 1, 2].map(i => pool[(start + i) % pool.length]);
        // About 1 in 3 answers name the business, so a before-and-after can show change.
        if (name !== '' && digest[0] % 3 === 0) names.splice(digest[2] % (names.length + 1), 0, name);
        const list = names.map((n, i) => `${i + 1}. ${n}`).join('\n');
        answer = `${MOCK_INTROS[digest[3] % MOCK_INTROS.length]}\n${list}\n${MOCK_OUTROS[digest[4] % MOCK_OUTROS.length]}`;
      }
      return { answer, provider: 'mock', model: 'mock', webSearch: false };
    },
  };
}

// ---------------------------------------------------------------------------
// Main adapters: openai and anthropic
// ---------------------------------------------------------------------------

function createOpenAiAssistantProvider({ apiKey, model, baseUrl, timeoutMs }) {
  const root = (baseUrl || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    name: 'openai',
    async ask({ prompt, signal: outer } = {}) {
      const data = await withDeadline(timeoutMs, outer, signal => postJson({
        provider: 'openai',
        url: `${root}/chat/completions`,
        headers: { authorization: `Bearer ${apiKey}` },
        body: { model, messages: [{ role: 'user', content: prompt }] },
        signal,
        secret: apiKey,
      }));
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') throw new AssistantError('unparseable');
      return { answer: content.trim(), provider: 'openai', model, webSearch: false, sources: [] };
    },
  };
}

/** The answer is every text block in order. A reply cut off by max_tokens counts only when it ends in text. */
function anthropicAnswer(data) {
  const content = Array.isArray(data?.content) ? data.content : null;
  if (!content) throw new AssistantError('unparseable');
  if (data.stop_reason === 'max_tokens') {
    const last = [...content].reverse().find(b => b?.type !== 'thinking' && b?.type !== 'redacted_thinking');
    if (last?.type !== 'text') throw new AssistantError('unparseable');
  }
  const text = content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
  if (text.trim() === '') throw new AssistantError('unparseable');
  return text;
}

async function mayResend(consumeExtra) {
  if (typeof consumeExtra !== 'function') return true;
  try {
    return (await consumeExtra()) === true;
  } catch {
    return false;
  }
}

function createAnthropicAssistantProvider({ apiKey, model, timeoutMs }) {
  return {
    name: 'anthropic',
    async ask({ prompt, signal: outer, consumeExtra } = {}) {
      // One deadline covers the first call and a pause_turn resend.
      const deadline = startDeadline(timeoutMs, outer);
      try {
        const request = async messages => {
          const data = await postJson({
            provider: 'anthropic',
            url: ANTHROPIC_URL,
            headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
            body: { model, max_tokens: ANTHROPIC_MAX_TOKENS, messages, tools: [WEB_SEARCH_TOOL] },
            signal: deadline.signal,
            secret: apiKey,
          });
          logShape('anthropic', data);
          return data;
        };
        const first = [{ role: 'user', content: prompt }];
        let data = await request(first);
        // pause_turn: the search is not finished. Send the reply back once (a second paid call,
        // when the caller allows it) and use the text of the second reply, even if it pauses again.
        if (data?.stop_reason === 'pause_turn' && Array.isArray(data.content) && await mayResend(consumeExtra)) {
          data = await request([...first, { role: 'assistant', content: data.content }]);
        }
        return {
          answer: anthropicAnswer(data),
          provider: 'anthropic',
          model,
          webSearch: true,
          sources: collectSources(data),
        };
      } finally {
        deadline.stop();
      }
    },
  };
}

/**
 * The main assistant: openai or anthropic with a key and a model, else the mock.
 * A real provider without SEANCE_MODEL warns (never with the key) and gives the mock.
 * @param {object} config resolved config from configFromEnv()
 * @param {{ warn?: (msg: string) => void }} [opts]
 */
export function createAssistantProvider(config, { warn = console.warn } = {}) {
  const name = config?.assistantProviderName;
  const a = config?.assistant ?? {};
  if ((name === 'openai' || name === 'anthropic') && a.apiKey) {
    if (!a.model) {
      warn(`SEANCE_PROVIDER=${name} requires SEANCE_MODEL; using the mock assistant provider.`);
      return createMockAssistantProvider();
    }
    const timeoutMs = timeoutFrom(config);
    return name === 'openai'
      ? createOpenAiAssistantProvider({ apiKey: a.apiKey, model: a.model, baseUrl: a.baseUrl, timeoutMs })
      : createAnthropicAssistantProvider({ apiKey: a.apiKey, model: a.model, timeoutMs });
  }
  return createMockAssistantProvider();
}

// ---------------------------------------------------------------------------
// Second opinions: ChatGPT, Grok and Perplexity (Responses-style replies)
// ---------------------------------------------------------------------------

/** Remove inline source markers. `matchAt(text, i)` returns the end of a marker at i, or -1. */
function stripMarkers(text, matchAt) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const j = text.indexOf('[', i);
    if (j === -1) {
      out += text.slice(i);
      break;
    }
    const end = matchAt(text, j);
    if (end === -1) {
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    let k = j;
    while (k > i && (text[k - 1] === ' ' || text[k - 1] === '\t')) k -= 1;
    out += text.slice(i, k);
    i = end;
  }
  return out;
}

/** Grok marker: [[3]](https://example.com/page) */
function grokMarkerEnd(t, j) {
  if (t[j + 1] !== '[') return -1;
  let k = j + 2;
  const digits = k;
  while (k < t.length && k - digits < 4 && t[k] >= '0' && t[k] <= '9') k += 1;
  if (k === digits || t.slice(k, k + 3) !== ']](') return -1;
  k += 3;
  const limit = Math.min(t.length, k + 2000);
  for (; k < limit; k += 1) {
    const c = t[k];
    if (c === ')') return k + 1;
    if (c === ' ' || c === '\n' || c === '\t') return -1;
  }
  return -1;
}

/** Perplexity marker: [web:1], [web:1, web:3] or [web:2-4]. Only a short, closed marker counts. */
function perplexityMarkerEnd(t, j) {
  if (!t.startsWith('[web:', j)) return -1;
  const close = t.indexOf(']', j);
  if (close === -1 || close - j > 200) return -1;
  return /^\[web:\d+(?:\s*[,\u2013-]\s*(?:web:)?\d+)*\]$/.test(t.slice(j, close + 1)) ? close + 1 : -1;
}

/**
 * Read a Responses-style reply (OpenAI, xAI, Perplexity). Anything but status
 * "completed" is a failure, even when some text came back.
 */
function readResponses(provider, data) {
  log(`provider=${provider} status=${clean(data?.status)} items=${typeList(data?.output)}`);
  if (data?.status !== 'completed') throw new AssistantError('unparseable');
  const output = Array.isArray(data.output) ? data.output : [];
  const parts = output
    .filter(item => item?.type === 'message')
    .flatMap(item => (Array.isArray(item.content) ? item.content : []))
    .filter(part => part?.type === 'output_text' && typeof part.text === 'string');
  const sources = [];
  const seen = new Set();
  for (const part of parts) {
    for (const note of Array.isArray(part.annotations) ? part.annotations : []) {
      if (note?.type === 'url_citation') addSource(sources, seen, note.url, note.title);
    }
  }
  for (const item of output) {
    if (item?.type !== 'search_results' || !Array.isArray(item.results)) continue;
    for (const r of item.results) addSource(sources, seen, r?.url, r?.title);
  }
  if (Array.isArray(data.citations)) {
    for (const url of data.citations) addSource(sources, seen, url);
  }
  return { text: parts.map(p => p.text).join(''), sources };
}

function responsesProvider({ name, url, apiKey, model, timeoutMs, buildBody, clean: tidy = t => t }) {
  return {
    name,
    async ask({ prompt, signal: outer } = {}) {
      const data = await withDeadline(timeoutMs, outer, signal => postJson({
        provider: name,
        url,
        headers: { authorization: `Bearer ${apiKey}`, 'user-agent': USER_AGENT },
        body: buildBody(model, prompt),
        signal,
        secret: apiKey,
      }));
      const { text, sources } = readResponses(name, data);
      const answer = tidy(text).trim();
      if (answer === '') throw new AssistantError('unparseable');
      return { answer, provider: name, model, webSearch: true, sources };
    },
  };
}

/** ChatGPT: OpenAI Responses API with web search (at most 3 searches), nothing stored. */
export function createChatGptAssistantProvider({ apiKey, model, timeoutMs } = {}) {
  return responsesProvider({
    name: 'chatgpt',
    url: OPENAI_RESPONSES_URL,
    apiKey,
    model: model || CHATGPT_DEFAULT_MODEL,
    timeoutMs: timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    buildBody: (m, prompt) => ({
      model: m,
      input: prompt,
      tools: [{ type: 'web_search', search_context_size: 'low' }],
      max_tool_calls: 3,
      max_output_tokens: SECOND_OPINION_MAX_TOKENS,
      store: false,
    }),
  });
}

/** Grok: xAI Responses API with web search, nothing stored. Inline [[n]](url) markers are removed. */
export function createGrokAssistantProvider({ apiKey, model, timeoutMs } = {}) {
  return responsesProvider({
    name: 'grok',
    url: XAI_RESPONSES_URL,
    apiKey,
    model: model || GROK_DEFAULT_MODEL,
    timeoutMs: timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    buildBody: (m, prompt) => ({
      model: m,
      input: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search' }],
      store: false,
    }),
    clean: text => stripMarkers(text, grokMarkerEnd),
  });
}

/** Perplexity: Agent API with fast web search. Inline [web:n] markers are removed. */
export function createPerplexityAssistantProvider({ apiKey, model, timeoutMs } = {}) {
  return responsesProvider({
    name: 'perplexity',
    url: PERPLEXITY_AGENT_URL,
    apiKey,
    model: model || PERPLEXITY_DEFAULT_MODEL,
    timeoutMs: timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    buildBody: (m, prompt) => ({
      model: m,
      input: prompt,
      tools: [{ type: 'web_search', search_type: 'fast', max_results: 8 }],
    }),
    clean: text => stripMarkers(text, perplexityMarkerEnd),
  });
}

// ---------------------------------------------------------------------------
// Gemini: second opinion (no grounding) and Google's live answer (grounded)
// ---------------------------------------------------------------------------

/** Read a generateContent reply. A finishReason other than STOP is a failure. */
function readGemini(provider, data) {
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
  log(`provider=${provider} finish=${clean(candidate?.finishReason)}`);
  if (candidate?.finishReason !== 'STOP') throw new AssistantError('unparseable');
  const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
  const text = parts.filter(p => typeof p?.text === 'string').map(p => p.text).join('').trim();
  if (text === '') throw new AssistantError('unparseable');
  return { text, candidate };
}

function geminiRequest({ apiKey, model, timeoutMs, outer, body, provider }) {
  return withDeadline(timeoutMs, outer, signal => postJson({
    provider,
    url: `${GEMINI_ROOT}/${encodeURIComponent(model)}:generateContent`,
    headers: { 'x-goog-api-key': apiKey, 'user-agent': USER_AGENT },
    body,
    signal,
    secret: apiKey,
  }));
}

/**
 * Gemini as a second opinion. It is asked WITHOUT Google Search grounding:
 * Google's grounding terms forbid analyzing, storing or sharing grounded results
 * the way the report does.
 */
export function createGeminiAssistantProvider({ apiKey, model, timeoutMs } = {}) {
  const useModel = model || GEMINI_DEFAULT_MODEL;
  return {
    name: 'gemini',
    async ask({ prompt, signal: outer } = {}) {
      const data = await geminiRequest({
        apiKey,
        model: useModel,
        timeoutMs: timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
        outer,
        provider: 'gemini',
        body: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: SECOND_OPINION_MAX_TOKENS },
        },
      });
      const { text } = readGemini('gemini', data);
      return { answer: text, provider: 'gemini', model: useModel, webSearch: false, sources: [] };
    },
  };
}

/**
 * Google's live answer: Gemini with Google Search. Resolves { text, sources, suggestionsHtml }.
 * Google's Search Suggestions HTML is returned exactly as sent. Callers show it once and
 * never store, log, name-match or score it.
 */
export function createGeminiLiveSearch({ apiKey, model, timeoutMs } = {}) {
  const useModel = model || GEMINI_DEFAULT_MODEL;
  return {
    name: 'gemini-live',
    async ask({ prompt, signal: outer } = {}) {
      const data = await geminiRequest({
        apiKey,
        model: useModel,
        timeoutMs: timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
        outer,
        provider: 'gemini-live',
        body: {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { maxOutputTokens: SECOND_OPINION_MAX_TOKENS },
        },
      });
      const { text, candidate } = readGemini('gemini-live', data);
      const meta = candidate.groundingMetadata;
      const sources = [];
      const seen = new Set();
      for (const chunk of Array.isArray(meta?.groundingChunks) ? meta.groundingChunks : []) {
        addSource(sources, seen, chunk?.web?.uri, chunk?.web?.title);
      }
      const html = meta?.searchEntryPoint?.renderedContent;
      return { text, sources, suggestionsHtml: typeof html === 'string' ? html : '' };
    },
  };
}

/** Google's live answer provider, or null without GEMINI_API_KEY, when switched off, or in a test run. */
export function createGeminiLive(config) {
  const key = config?.gemini?.apiKey;
  if (!key || config?.geminiLive === false || config?.testRun) return null;
  return createGeminiLiveSearch({ apiKey: key, model: config.gemini.model, timeoutMs: timeoutFrom(config) });
}

// ---------------------------------------------------------------------------
// Second opinions as a set
// ---------------------------------------------------------------------------

/**
 * The second-opinion assistants that have keys, in a fixed order: chatgpt, gemini,
 * grok, perplexity. None in a test run.
 * @param {object} config resolved config from configFromEnv()
 * @returns {{ name: string, ask: Function }[]}
 */
export function createExtraAssistants(config) {
  if (!config || config.testRun) return [];
  const timeoutMs = timeoutFrom(config);
  const out = [];
  const make = (entry, factory) => {
    if (entry?.apiKey) out.push(factory({ apiKey: entry.apiKey, model: entry.model, timeoutMs }));
  };
  make(config.chatgpt, createChatGptAssistantProvider);
  make(config.gemini, createGeminiAssistantProvider);
  make(config.grok, createGrokAssistantProvider);
  make(config.perplexity, createPerplexityAssistantProvider);
  return out;
}
