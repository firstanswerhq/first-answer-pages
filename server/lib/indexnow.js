/**
 * indexnow.js — tell Bing (and the other IndexNow engines, which share
 * submissions) that a page is new or changed, so it is read in days instead
 * of weeks. Google does not take part; it is added by hand in Search Console.
 *
 * createIndexNow({ baseUrl, dataDir, enabled, fetch, clock, timeoutMs })
 *   .enabled           whether submissions are sent at all
 *   .reason            why it is off (shown on the admin page), or ''
 *   .key               the site key (only when enabled), served at /{key}.txt
 *   .submit(urls, tag) fire-and-forget; resolves to the log entry, never rejects
 *   .recent()          the last 20 submissions, newest first
 *   .latestFor(tag)    the newest log entry for a tag (e.g. a listing id)
 *
 * Protocol (checked Nov 10, 2026): POST https://api.indexnow.org/indexnow,
 * Content-Type: application/json; charset=utf-8, body
 * { host, key, keyLocation, urlList }. 200 and 202 are success.
 * The key is 32 characters from [a-z0-9] (the rules allow 8 to 128 letters,
 * digits and dashes) and lives in DATA_DIR/indexnow-key.txt so it survives
 * restarts and deploys. Logs show the status code only, never the key.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_KEY_FILE = 'indexnow-key.txt';
const KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const MAX_LOG = 20;

/** 32 random characters from [a-z0-9]. */
export function newIndexNowKey() {
  const bytes = randomBytes(32);
  let key = '';
  for (const b of bytes) key += ALPHABET[b % ALPHABET.length];
  return key;
}

/**
 * Why IndexNow is off for this config, or '' when it may run.
 * Real sites only: production, demo mode off, an https BASE_URL that is not a
 * local or .test host, and INDEXNOW not set to off. Test runs never send
 * unless the test passes its own fetch.
 * @param {object} config
 * @param {{ hasStubFetch?: boolean }} [opts]
 */
export function indexNowOffReason(config, { hasStubFetch = false } = {}) {
  if (config?.indexNow === 'off') return 'turned off';
  if (config?.production !== true) return 'only on the live site';
  if (config?.demoMode) return 'demo mode is on';
  let url;
  try {
    url = new URL(String(config?.baseUrl ?? ''));
  } catch {
    return 'BASE_URL is not set';
  }
  if (url.protocol !== 'https:') return 'BASE_URL is not https';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.test')) {
    return 'BASE_URL is a local address';
  }
  if (config?.testRun && !hasStubFetch) return 'test run';
  return '';
}

/** Read the saved key, or make and save a new one. Returns '' if the disk refuses. */
function loadOrCreateKey(dataDir, fsImpl) {
  const file = path.join(dataDir, INDEXNOW_KEY_FILE);
  try {
    const saved = fsImpl.readFileSync(file, 'utf8').trim();
    if (KEY_PATTERN.test(saved)) return saved;
  } catch {
    // no key yet
  }
  const key = newIndexNowKey();
  try {
    fsImpl.mkdirSync(dataDir, { recursive: true });
    fsImpl.writeFileSync(file, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
    return key;
  } catch {
    process.stderr.write('[indexnow] could not save the key; IndexNow is off\n');
    return '';
  }
}

/**
 * @param {{
 *   baseUrl: string, dataDir: string, enabled?: boolean, reason?: string,
 *   fetch?: typeof fetch, clock?: { now(): number }, timeoutMs?: number, fs?: object,
 * }} opts
 */
export function createIndexNow({
  baseUrl, dataDir, enabled = false, reason = '', fetch: fetchImpl = globalThis.fetch,
  clock = { now: () => Date.now() }, timeoutMs = 10000, fs: fsImpl = fs,
} = {}) {
  const log = [];
  let key = '';
  let offReason = enabled ? '' : (reason || 'off');

  if (enabled) {
    key = loadOrCreateKey(dataDir, fsImpl);
    if (!key) offReason = 'the key could not be saved';
  }
  const on = enabled && Boolean(key);

  const base = String(baseUrl ?? '').replace(/\/+$/, '');
  let host = '';
  try {
    host = new URL(base).hostname;
  } catch {
    host = '';
  }

  function record(entry) {
    log.unshift(entry);
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    return entry;
  }

  /**
   * Send one batch. Never throws and never makes the caller wait: call it
   * without await (or await it in tests). Only same-host http(s) URLs are sent.
   * @param {string[]} urls
   * @param {string} [tag] e.g. the listing id, for the admin page note
   */
  async function submit(urls, tag = '') {
    const urlList = [...new Set((Array.isArray(urls) ? urls : []).filter(u => {
      try {
        const parsed = new URL(u);
        return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.hostname === host;
      } catch {
        return false;
      }
    }))];
    const entry = {
      at: new Date(clock.now()).toISOString(), tag: String(tag ?? ''), urls: urlList,
      state: 'sending', status: null, ok: false, reason: '',
    };
    if (!on) return record({ ...entry, state: 'skipped', reason: offReason });
    if (urlList.length === 0) return record({ ...entry, state: 'skipped', reason: 'no pages to send' });
    record(entry);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation: `${base}/${key}.txt`, urlList }),
        signal: ctrl.signal,
      });
      entry.status = res.status;
      entry.ok = res.status === 200 || res.status === 202;
      entry.state = 'done';
      if (!entry.ok) entry.reason = `status ${res.status}`;
      try { await res.arrayBuffer(); } catch { /* body not needed */ }
      process.stderr.write(`[indexnow] status=${res.status}\n`);
    } catch (err) {
      entry.state = 'done';
      entry.reason = ctrl.signal.aborted ? 'timed out' : 'could not connect';
      process.stderr.write(`[indexnow] status=${ctrl.signal.aborted ? 'timeout' : 'error'}\n`);
    } finally {
      clearTimeout(timer);
    }
    return entry;
  }

  return {
    get enabled() { return on; },
    get reason() { return on ? '' : offReason; },
    get key() { return on ? key : ''; },
    submit,
    recent: () => log.map(e => ({ ...e, urls: [...e.urls] })),
    latestFor: tag => {
      const e = log.find(x => x.tag === String(tag));
      return e ? { ...e, urls: [...e.urls] } : undefined;
    },
  };
}

/** Plain words for an entry, for the admin page. */
export function indexNowNote(entry) {
  if (!entry) return '';
  if (entry.state === 'sending') return 'Telling Bing about it…';
  if (entry.ok) return 'Bing notified.';
  return `Bing not notified (${entry.reason || 'unknown reason'}).`;
}
