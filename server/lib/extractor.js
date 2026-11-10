/**
 * extractor.js — turns an uploaded image into a draft listing.
 *
 * extractDraft() asks a vision provider for raw fields, then runs them through
 * validateFields(). Provider failure, timeout, or unusable output throws an
 * ExtractionError (the route maps it to 502). Error messages are fixed text:
 * never keys, response bodies, or image bytes.
 */

import { validateFields } from './listing-fields.js';

export const DEFAULT_EXTRACT_TIMEOUT_MS = 30000;

const MESSAGES = Object.freeze({
  provider_failed: 'The vision provider failed',
  timeout: 'The vision provider timed out',
  unparseable: 'The vision provider returned unusable output',
});

export class ExtractionError extends Error {
  /**
   * @param {'provider_failed' | 'timeout' | 'unparseable'} code
   */
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.provider_failed);
    this.name = 'ExtractionError';
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'provider_failed';
  }
}

/**
 * @param {{
 *   provider: { name: string, extract: Function },
 *   bytes: Uint8Array,
 *   mimeType: string,
 *   categories: { slug: string, label: string }[],
 *   timeoutMs?: number,
 * }} args
 * @returns {Promise<{ fields: object, missingFields: string[] }>}
 */
export async function extractDraft({ provider, bytes, mimeType, categories, timeoutMs = DEFAULT_EXTRACT_TIMEOUT_MS }) {
  const signal = AbortSignal.timeout(timeoutMs);

  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(new ExtractionError('timeout'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => {}); // avoid an unhandled rejection if the call wins the race

  let raw;
  try {
    raw = await Promise.race([provider.extract({ bytes, mimeType, signal }), aborted]);
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    if (signal.aborted) throw new ExtractionError('timeout');
    throw new ExtractionError('provider_failed');
  } finally {
    signal.removeEventListener('abort', onAbort);
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExtractionError('unparseable');
  }
  return validateFields(raw, categories);
}
