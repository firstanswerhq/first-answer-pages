/**
 * base-url.js — the public base URL for absolute links (llms.txt, sitemap, JSON-LD).
 *
 * BASE_URL wins whenever it was set. Only when it was not (local use) do we
 * fall back to the request's own host and port, so a local llms.txt links to
 * pages that actually open. In production the configured value is always used.
 */

import { DEFAULT_BASE_URL } from './config.js';

// host, host:port, or [ipv6]:port
const HOST_RE = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * @param {import('express').Request} req
 * @param {{ baseUrl?: string, production?: boolean }} config
 * @returns {string} base URL without a trailing slash
 */
export function baseUrlFor(req, config) {
  const configured = typeof config?.baseUrl === 'string' ? config.baseUrl.replace(/\/+$/, '') : '';
  if (config?.production || (configured !== '' && configured !== DEFAULT_BASE_URL)) return configured;

  const host = typeof req?.get === 'function' ? req.get('host') : undefined;
  const protocol = req?.protocol === 'https' ? 'https' : 'http';
  if (typeof host === 'string' && HOST_RE.test(host)) return `${protocol}://${host}`;
  return configured || DEFAULT_BASE_URL;
}
