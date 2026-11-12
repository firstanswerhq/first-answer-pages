/**
 * safe-fetch.js — fetches a public web page without letting the visitor reach
 * private networks.
 *
 * Rules (never loosen them, not even for tests; tests inject fakes):
 *  - http/https only, ports 80 and 443 only, no user name or password.
 *  - Every host name is resolved here, and every resolved address must pass
 *    isPublicAddress. The socket can only open to a checked address because
 *    the request gets a pinned `lookup` that never resolves again.
 *  - Redirects are followed by hand (at most 5); each target is checked from
 *    the top.
 *  - Only User-Agent, Accept and Accept-Encoding are sent. No cookies, no
 *    visitor headers.
 *  - One timer per fetch (connect, redirects and body); the decompressed body
 *    is capped at maxBytes.
 *
 * `request` is injectable: { http: fn, https: fn } with the same shape as
 * node:http request(url, options, callback). `lookup` has the dns.lookup shape.
 */

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';
import { isPublicAddress } from './ip-guard.js';

export class SafeFetchError extends Error {
  /** @param {'bad_url'|'blocked_address'|'timeout'|'too_large'|'too_many_redirects'|'connect_failed'} code */
  constructor(code, message) {
    super(message ?? code);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_USER_AGENT = 'FirstAnswerPagesBot/1.0 (+/grade/about)';
const DEFAULT_ACCEPT = 'text/html,text/plain;q=0.9,*/*;q=0.5';

/** Parse and check a URL string. Returns { url, host, literal } or throws. */
function checkUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError('bad_url', 'not a valid address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('bad_url', 'only http and https are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new SafeFetchError('bad_url', 'addresses with credentials are not allowed');
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new SafeFetchError('bad_url', 'only ports 80 and 443 are allowed');
  }
  // WHATWG URL has already turned decimal, hex and octal IPv4 into dotted form.
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (host === '') throw new SafeFetchError('bad_url', 'missing host');
  const family = net.isIP(host);
  if (family !== 0) {
    if (!isPublicAddress(host)) throw new SafeFetchError('blocked_address', 'address is not public');
    return { url, host, literal: [{ address: host, family }] };
  }
  return { url, host, literal: null };
}

function resolveAll(lookup, host) {
  return new Promise((resolve, reject) => {
    try {
      lookup(host, { all: true }, (err, result) => {
        if (err) return reject(new SafeFetchError('connect_failed', 'could not resolve the host'));
        const list = Array.isArray(result) ? result : [{ address: result }];
        resolve(list);
      });
    } catch {
      reject(new SafeFetchError('connect_failed', 'could not resolve the host'));
    }
  });
}

/** Returns the checked list as [{ address, family }]. Throws blocked_address. */
async function resolveChecked(lookup, host) {
  const raw = await resolveAll(lookup, host);
  const list = [];
  for (const entry of raw) {
    const address = typeof entry === 'string' ? entry : entry?.address;
    if (typeof address !== 'string' || !isPublicAddress(address)) {
      throw new SafeFetchError('blocked_address', 'host resolves to a non-public address');
    }
    list.push({ address, family: net.isIP(address) });
  }
  if (list.length === 0) throw new SafeFetchError('blocked_address', 'host did not resolve');
  return list;
}

/** A lookup that never resolves again: it answers with the checked list. */
function pinnedLookupFor(list) {
  return (hostname, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (opts && opts.all) return cb(null, list.map(a => ({ address: a.address, family: a.family })));
    return cb(null, list[0].address, list[0].family);
  };
}

function charsetOf(contentType) {
  const m = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? '');
  return m ? m[1] : 'utf-8';
}

function decodeText(buffer, contentType) {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function decoderFor(encoding) {
  switch (String(encoding ?? '').trim().toLowerCase()) {
    case 'gzip': case 'x-gzip': return zlib.createGunzip();
    case 'deflate': return zlib.createInflate();
    case 'br': return zlib.createBrotliDecompress();
    default: return null;
  }
}

/**
 * @param {{
 *   request?: { http: Function, https: Function },
 *   lookup?: Function,
 *   timeoutMs?: number, maxBytes?: number, maxRedirects?: number, userAgent?: string,
 * }} [options]
 */
export function createSafeFetcher({
  request = { http: http.request, https: https.request },
  lookup = dns.lookup,
  timeoutMs = 10000,
  maxBytes = 2 * 1024 * 1024,
  maxRedirects = 5,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  function sendRequest(url, list, accept, signal) {
    return new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? request.https : request.http;
      const headers = {
        'User-Agent': userAgent,
        Accept: accept,
        'Accept-Encoding': 'gzip, deflate, br',
      };
      let req;
      try {
        req = lib(url, { method: 'GET', headers, agent: false, lookup: pinnedLookupFor(list), signal }, resolve);
      } catch {
        return reject(new SafeFetchError('connect_failed', 'could not connect'));
      }
      req.on('error', () => reject(new SafeFetchError('connect_failed', 'could not connect')));
      req.end();
    });
  }

  async function readBody(response) {
    const decoder = decoderFor(response.headers?.['content-encoding']);
    let source = response;
    response.on('error', err => { if (decoder) decoder.destroy(err); });
    if (decoder) source = response.pipe(decoder);
    const chunks = [];
    let total = 0;
    let truncated = false;
    try {
      for await (const chunk of source) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (total + buf.length > maxBytes) {
          const keep = maxBytes - total;
          if (keep > 0) chunks.push(buf.subarray(0, keep));
          total = maxBytes;
          truncated = true;
          break;
        }
        chunks.push(buf);
        total += buf.length;
      }
    } catch {
      throw new SafeFetchError('connect_failed', 'could not read the response');
    } finally {
      response.destroy();
      if (decoder) decoder.destroy();
    }
    return { buffer: Buffer.concat(chunks), truncated };
  }

  async function run(startUrl, accept, strictSize, signal) {
    let current = startUrl;
    for (let hop = 0; ; hop += 1) {
      const { url, host, literal } = checkUrl(current);
      const list = literal ?? await resolveChecked(lookup, host);
      const response = await sendRequest(url, list, accept, signal);
      const status = response.statusCode;
      const location = response.headers?.location;
      if (REDIRECT_STATUSES.has(status) && typeof location === 'string' && location !== '') {
        response.resume();
        response.destroy();
        if (hop >= maxRedirects) throw new SafeFetchError('too_many_redirects', 'too many redirects');
        try {
          current = new URL(location, url).href;
        } catch {
          throw new SafeFetchError('bad_url', 'bad redirect address');
        }
        continue;
      }
      const { buffer, truncated } = await readBody(response);
      if (truncated && strictSize) throw new SafeFetchError('too_large', 'page is too large');
      const contentType = String(response.headers?.['content-type'] ?? '');
      return {
        status,
        finalUrl: url.href,
        contentType,
        text: decodeText(buffer, contentType),
        truncated,
      };
    }
  }

  /**
   * @param {string} url
   * @param {{ accept?: string, strictSize?: boolean }} [opts]
   * @returns {Promise<{ status: number, finalUrl: string, contentType: string, text: string, truncated: boolean }>}
   */
  function fetchText(url, { accept = DEFAULT_ACCEPT, strictSize = false } = {}) {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SafeFetchError('timeout', 'timed out'));
        controller.abort();
      }, timeoutMs);
      run(String(url), accept, strictSize, controller.signal).then(resolve, err => {
        reject(err instanceof SafeFetchError ? err : new SafeFetchError('connect_failed', 'could not connect'));
      }).finally(() => clearTimeout(timer));
    });
  }

  return { fetchText };
}
