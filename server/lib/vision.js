/**
 * vision.js — vision providers: a deterministic mock and two real adapters.
 *
 * A provider is { name, extract({ bytes, mimeType, signal }) } and resolves to
 * a raw, untrusted object. Callers must run it through validateFields().
 *
 * Keys go only in a request header. Logs carry the provider name and HTTP
 * status, never keys, bodies, or image bytes.
 */

import { createHash } from 'node:crypto';
import { DEFAULT_PROVIDER_TIMEOUT_MS } from './config.js';
import { ExtractionError } from './extractor.js';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export const EXTRACTION_PROMPT =
  'This image is a business card, sign, flyer, or ad for a local business. ' +
  'Reply with strict JSON only (no prose, no code fence) using these keys: ' +
  'name, phone, category, services, hours, serviceArea, description, city, state, address. ' +
  '"services" is an array of short strings. "hours" is an object keyed by lowercase day name ' +
  '(monday to sunday) with a text value. "state" is a two-letter abbreviation. ' +
  'Omit any key whose value is not visible in the image. Do not guess.';

// Fictional businesses only. Phones use the reserved 555-01xx range.
// Categories are slugs from data/categories.json. Some fixtures omit a field on purpose.
const FIXTURES = Object.freeze([
  {
    name: 'Copper Kettle Plumbing',
    phone: '(615) 555-0101',
    category: 'plumbers',
    services: ['Leak repair', 'Water heaters', 'Drain cleaning'],
    hours: { monday: '7:00 AM - 5:00 PM', tuesday: '7:00 AM - 5:00 PM', wednesday: '7:00 AM - 5:00 PM' },
    serviceArea: 'Greater Springfield',
    description: 'We fix pipes, leaks, and water heaters. Call for same-day service.',
    city: 'Springfield',
    state: 'TN',
    address: '12 Mill Street',
  },
  {
    // Missing: phone
    name: 'Lantern Electric',
    category: 'electricians',
    services: ['Rewiring', 'Panel upgrades', 'Outlet repair'],
    hours: { monday: '8:00 AM - 4:00 PM', friday: '8:00 AM - 4:00 PM' },
    serviceArea: 'Riverton and nearby towns',
    description: 'Licensed electricians for homes and small shops.',
    city: 'Riverton',
    state: 'OH',
  },
  {
    name: 'Maple Street Diner',
    phone: '(217) 555-0123',
    category: 'restaurants',
    services: ['Breakfast', 'Lunch', 'Takeout'],
    hours: { monday: '6:00 AM - 2:00 PM', saturday: '7:00 AM - 1:00 PM' },
    serviceArea: 'Fairview',
    description: 'Home cooking, served all day. Eggs, burgers, and pie.',
    city: 'Fairview',
    state: 'IL',
    address: '410 Maple Street',
  },
  {
    // Missing: description
    name: 'Four Corners Auto Repair',
    phone: '(512) 555-0147',
    category: 'auto-repair',
    services: ['Brakes', 'Oil changes', 'Engine diagnostics'],
    hours: { monday: '8:00 AM - 6:00 PM', tuesday: '8:00 AM - 6:00 PM' },
    serviceArea: 'Oakdale County',
    city: 'Oakdale',
    state: 'TX',
    address: '88 Route 9',
  },
  {
    // Missing: services
    name: 'Curl Up and Dye',
    phone: '(704) 555-0162',
    category: 'hair-salons',
    hours: { tuesday: '9:00 AM - 6:00 PM', saturday: '9:00 AM - 3:00 PM' },
    serviceArea: 'Pine Hollow',
    description: 'Cuts, color, and perms. Walk-ins welcome.',
    city: 'Pine Hollow',
    state: 'NC',
  },
  {
    // Missing: city and state
    name: 'Hargrove and Wells Law Office',
    phone: '(303) 555-0178',
    category: 'lawyers',
    services: ['Wills', 'Real estate closings', 'Small claims'],
    hours: { monday: '9:00 AM - 5:00 PM', thursday: '9:00 AM - 5:00 PM' },
    serviceArea: 'Clearwater County',
    description: 'Plain-spoken legal help for families and small businesses.',
  },
]);

/**
 * Deterministic mock: SHA-256 of the bytes picks a fixture. Pure function of
 * its input; never touches the network.
 */
export function createMockVisionProvider() {
  return {
    name: 'mock',
    async extract({ bytes }) {
      const digest = createHash('sha256').update(bytes ?? new Uint8Array(0)).digest();
      const fixture = FIXTURES[digest[0] % FIXTURES.length];
      return structuredClone(fixture);
    },
  };
}

function logStatus(provider, status) {
  process.stderr.write(`[vision] provider=${provider} status=${status}\n`);
}

/** Parse a model reply as strict JSON (a lone code fence is tolerated). */
function parseReply(text) {
  if (typeof text !== 'string') throw new ExtractionError('unparseable');
  let body = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1];
  try {
    const value = JSON.parse(body);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value;
  } catch {
    throw new ExtractionError('unparseable');
  }
}

/** One fetch call; returns parsed response JSON. Logs name and status only. */
async function callProvider(name, url, headers, body, timeoutMs, outerSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const signal = outerSignal ? AbortSignal.any([ctrl.signal, outerSignal]) : ctrl.signal;
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
    throw new ExtractionError(signal.aborted ? 'timeout' : 'provider_failed');
  } finally {
    clearTimeout(timer);
  }
  logStatus(name, res.status);
  if (!res.ok) throw new ExtractionError('provider_failed');
  try {
    return await res.json();
  } catch {
    throw new ExtractionError('unparseable');
  }
}

function createOpenAiVisionProvider({ apiKey, model, baseUrl, timeoutMs }) {
  const root = (baseUrl || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    name: 'openai',
    async extract({ bytes, mimeType, signal }) {
      const dataUrl = `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
      const data = await callProvider(
        'openai',
        `${root}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          }],
        },
        timeoutMs,
        signal,
      );
      return parseReply(data?.choices?.[0]?.message?.content);
    },
  };
}

function createAnthropicVisionProvider({ apiKey, model, timeoutMs }) {
  return {
    name: 'anthropic',
    async extract({ bytes, mimeType, signal }) {
      const data = await callProvider(
        'anthropic',
        ANTHROPIC_URL,
        { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        {
          model,
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType, data: Buffer.from(bytes).toString('base64') },
              },
              { type: 'text', text: EXTRACTION_PROMPT },
            ],
          }],
        },
        timeoutMs,
        signal,
      );
      const block = Array.isArray(data?.content) ? data.content.find(b => b?.type === 'text') : undefined;
      return parseReply(block?.text);
    },
  };
}

/**
 * @param {object} config resolved config from configFromEnv()
 * @returns {{ name: string, extract: Function }}
 */
export function createVisionProvider(config) {
  const name = config?.visionProviderName;
  const v = config?.vision ?? {};
  const timeoutMs = config?.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS;
  if (name === 'openai' && v.apiKey && v.model) {
    return createOpenAiVisionProvider({ apiKey: v.apiKey, model: v.model, baseUrl: v.baseUrl, timeoutMs });
  }
  if (name === 'anthropic' && v.apiKey && v.model) {
    return createAnthropicVisionProvider({ apiKey: v.apiKey, model: v.model, timeoutMs });
  }
  return createMockVisionProvider();
}
