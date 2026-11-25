// Safe fetcher: fetches a business website without ever reaching a private or
// internal address. Every address is checked first, then the connection is
// pinned to the checked list. Only three request headers are ever sent.
import net from 'node:net';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { isPublicAddress } from './ip-guard.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class SafeFetchError extends Error {
  /**
   * @param {'bad_url'|'blocked_address'|'timeout'|'too_large'|'too_many_redirects'|'connect_failed'} code
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message || code);
    this.name = 'SafeFetchError';
    this.code = code;
  }
}

const stripBrackets = host => host.replace(/^\[|\]$/g, '');

/** Parse and validate a URL. Throws bad_url or blocked_address (IP literals). */
function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new SafeFetchError('bad_url', 'The address is not a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('bad_url', 'Only http and https addresses are allowed.');
  }
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    throw new SafeFetchError('bad_url', 'Only ports 80 and 443 are allowed.');
  }
  if (url.username || url.password) {
    throw new SafeFetchError('bad_url', 'Addresses with a user name or password are not allowed.');
  }
  const host = stripBrackets(url.hostname);
  if (!host) throw new SafeFetchError('bad_url', 'The address has no host name.');
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new SafeFetchError('blocked_address', 'That address is not a public address.');
  }
  return { url, host };
}

/** The charset named in a Content-Type header, or in a meta tag in the first 2 KiB of the page. */
function charsetOf(buffer, contentType) {
  const fromHeader = /charset\s*=\s*["']?([A-Za-z0-9_.:-]+)/i.exec(String(contentType ?? ''));
  if (fromHeader) return fromHeader[1];
  const head = buffer.subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]{0,300}?charset\s*=\s*["']?([A-Za-z0-9_.:-]+)/i.exec(head);
  return fromMeta ? fromMeta[1] : '';
}

/** Decode a body with its declared charset (UTF-8 when none is named or the name is not known). */
function decodeBody(buffer, contentType) {
  const label = charsetOf(buffer, contentType).trim().toLowerCase();
  if (label && label !== 'utf-8' && label !== 'utf8') {
    try {
      return new TextDecoder(label).decode(buffer);
    } catch {
      // An unknown charset name: fall back to UTF-8 below.
    }
  }
  return buffer.toString('utf8');
}

/**
 * @param {object} [options]
 * @param {{http: Function, https: Function}} [options.request]
 * @param {Function} [options.lookup] dns.lookup-style: (host, {all:true}, cb)
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {number} [options.maxRedirects]
 * @param {string} [options.userAgent]
 */
export function createSafeFetcher({
  request,
  lookup = dns.lookup,
  timeoutMs = 10000,
  maxBytes = 2 * 1024 * 1024,
  maxRedirects = 5,
  userAgent = 'FirstAnswerGrader/1.0 (+https://firstanswerhq.com)',
} = {}) {
  const transport = {
    http: request?.http ?? ((...a) => http.request(...a)),
    https: request?.https ?? ((...a) => https.request(...a)),
  };

  const resolveOnce = host => new Promise((resolve, reject) => {
    try {
      lookup(host, { all: true }, (err, list) => {
        if (err) {
          const failed = new SafeFetchError('connect_failed', 'The host name could not be found.');
          // Kept only as a fact for the health map (high-tech-look 12.1b): the name does not exist (NXDOMAIN).
          if (err.code === 'ENOTFOUND') failed.dns = 'not_found';
          return reject(failed);
        }
        resolve(Array.isArray(list) ? list : []);
      });
    } catch {
      // A lookup that throws on the spot is a failed lookup, never a bare Error.
      reject(new SafeFetchError('connect_failed', 'The host name could not be found.'));
    }
  });

  /**
   * Resolve a host name. A name that does not exist is asked once more before it counts as not found (12.1b: "on two
   * tries"), so one bad answer from a resolver is never reported as a dead address. Nothing else is retried.
   */
  const resolveAll = async host => {
    try {
      return await resolveOnce(host);
    } catch (err) {
      if (err?.dns !== 'not_found') throw err;
      return resolveOnce(host);
    }
  };

  /** Resolve and check every address for one URL. Returns the checked list. */
  async function checkedAddresses(url, host) {
    if (net.isIP(host)) return [{ address: host, family: net.isIP(host) }];
    const list = await resolveAll(host);
    if (list.length === 0) throw new SafeFetchError('connect_failed', 'The host name has no address.');
    for (const entry of list) {
      if (!isPublicAddress(entry.address)) {
        throw new SafeFetchError('blocked_address', 'That host points to a non-public address.');
      }
    }
    return list;
  }

  async function fetchText(rawUrl, opts = {}) {
    const strictSize = Boolean(opts.strictSize);
    let timer;
    let current = null; // { req, res } of the in-flight hop
    let finished = false;

    const destroyCurrent = () => {
      try { current?.res?.destroy?.(); } catch { /* ignore */ }
      try { current?.req?.destroy?.(); } catch { /* ignore */ }
    };

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new SafeFetchError('timeout', 'The website took too long to answer.'));
      }, timeoutMs);
    });

    const run = async () => {
      let target = rawUrl;
      for (let hop = 0; ; hop += 1) {
        const { url, host } = checkUrl(target);
        const list = await checkedAddresses(url, host);
        if (finished) throw new SafeFetchError('timeout');

        const pinnedLookup = (hostname, lookupOpts, cb) => {
          const done = typeof lookupOpts === 'function' ? lookupOpts : cb;
          const all = typeof lookupOpts === 'object' && lookupOpts && lookupOpts.all;
          if (all) return done(null, list.map(a => ({ address: a.address, family: a.family })));
          return done(null, list[0].address, list[0].family);
        };

        const send = url.protocol === 'https:' ? transport.https : transport.http;
        const res = await new Promise((resolve, reject) => {
          let req;
          try {
            req = send(url.href, {
              method: 'GET',
              agent: false,
              lookup: pinnedLookup,
              headers: {
                'User-Agent': userAgent,
                Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
                'Accept-Encoding': 'gzip, deflate, br',
              },
            }, resolve);
          } catch {
            return reject(new SafeFetchError('connect_failed', 'Could not connect to the website.'));
          }
          current = { req, res: null };
          req.on('error', err => {
            if (err instanceof SafeFetchError) return reject(err);
            const failed = new SafeFetchError('connect_failed', 'Could not connect to the website.');
            // An expired certificate is still refused (nothing is loosened); it is only noted for the health map (12.1a).
            if (err?.code === 'CERT_HAS_EXPIRED') failed.tls = 'expired';
            return reject(failed);
          });
          req.end();
        });
        current.res = res;
        // The certificate's end date, read from this same connection (12.1a: no extra request). Only for https.
        let certValidTo = null;
        if (url.protocol === 'https:') {
          try {
            const ms = Date.parse(res.socket?.getPeerCertificate?.()?.valid_to ?? '');
            if (Number.isFinite(ms)) certValidTo = new Date(ms).toISOString();
          } catch { /* not readable: left out */ }
        }

        const status = res.statusCode;
        const headers = res.headers || {};

        if (REDIRECT_STATUSES.has(status) && headers.location) {
          res.resume?.();
          res.destroy?.();
          if (hop >= maxRedirects) {
            throw new SafeFetchError('too_many_redirects', 'The website redirected too many times.');
          }
          try {
            target = new URL(String(headers.location), url).href;
          } catch {
            throw new SafeFetchError('bad_url', 'The website sent a bad redirect.');
          }
          continue;
        }

        const encoding = String(headers['content-encoding'] || '').trim().toLowerCase();
        let stream = res;
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = zlib.createGunzip();
        else if (encoding === 'deflate') stream = zlib.createInflate();
        else if (encoding === 'br') stream = zlib.createBrotliDecompress();
        if (stream !== res) {
          res.on('error', err => stream.destroy(err));
          res.pipe(stream);
        }

        const chunks = [];
        let total = 0;
        let truncated = false;
        try {
          for await (const chunk of stream) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (total + buf.length > maxBytes) {
              chunks.push(buf.subarray(0, maxBytes - total));
              total = maxBytes;
              truncated = true;
              break;
            }
            chunks.push(buf);
            total += buf.length;
          }
        } catch (err) {
          if (err instanceof SafeFetchError) throw err;
          throw new SafeFetchError('connect_failed', 'The website sent a broken answer.');
        }
        if (truncated) {
          stream.destroy?.();
          res.destroy?.();
          if (strictSize) throw new SafeFetchError('too_large', 'The page is too large.');
        }

        const contentType = Array.isArray(headers['content-type'])
          ? headers['content-type'][0]
          : String(headers['content-type'] || '');
        return {
          status,
          finalUrl: url.href,
          contentType,
          text: decodeBody(Buffer.concat(chunks), contentType),
          truncated,
          ...(certValidTo ? { certValidTo } : {}),
        };
      }
    };

    const work = run();
    work.catch(() => {}); // avoid unhandled rejection if the timer wins
    try {
      return await Promise.race([work, timeout]);
    } finally {
      finished = true;
      clearTimeout(timer);
      destroyCurrent();
    }
  }

  return { fetchText };
}
