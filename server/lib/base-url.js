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

/** A plain base address: http or https, a host of letters, digits, dots and hyphens, an optional port, and at most one trailing "/". */
const PLAIN_BASE_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?\/?$/i;

/**
 * The canonical address of `path` (such as '/rise' or '/grade'), built from the configured base address only,
 * never from the request's Host (V99). '' when the base address is not a plain one, so no canonical link is
 * shown. One helper for every page that has one.
 * @param {{ baseUrl?: string }} config
 * @param {string} path
 * @returns {string}
 */
export function canonicalUrl(config, path) {
  const base = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (!PLAIN_BASE_RE.test(base)) return '';
  return `${base.replace(/\/$/, '')}${path}`;
}

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
