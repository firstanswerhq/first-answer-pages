/**
 * sitemap-read.js: find and read a business website's sitemap (high-tech-look Requirement 3.9, checklist E2, D4, D5).
 *
 * Only the robots.txt the check already fetched is read for `Sitemap:` lines; with none, /sitemap.xml is asked for
 * once. The fetch itself is done by the grader through the safe fetcher (same rules, size limit and timeout as the
 * llms.txt request). This file only picks the address and reads what came back. Every scan is bounded.
 */

import { SITEMAP_MAX_ENTRIES } from './health-constants.js';

/** The sitemap addresses written in a robots.txt, in order (http or https only, at most 5). */
export function sitemapLinesFromRobots(text) {
  const out = [];
  for (const m of String(text ?? '').slice(0, 200000).matchAll(/^[ \t]*sitemap:[ \t]*(\S{1,2000})/gim)) {
    try {
      const url = new URL(m[1]);
      if (url.protocol === 'https:' || url.protocol === 'http:') out.push(url.href);
    } catch { /* not an address */ }
    if (out.length >= 5) break;
  }
  return out;
}

/** The one address to ask for: the first Sitemap: line of the robots.txt, else /sitemap.xml on the site. */
export function sitemapAddress(robotsText, base) {
  const [first] = sitemapLinesFromRobots(robotsText);
  if (first) return first;
  try {
    return new URL('/sitemap.xml', base).href;
  } catch {
    return null;
  }
}

/**
 * True when a sitemap reply is gzip-compressed (a ".xml.gz" sitemap): the address ends in .gz, the content type says
 * gzip, or the body starts with the gzip magic bytes (read as text, the second byte may come back as U+FFFD).
 * Such a sitemap is not unpacked here; it still counts as found.
 */
export function isGzipSitemap({ url, contentType, text } = {}) {
  if (typeof url === 'string' && /\.gz(?:$|[?#])/i.test(url)) return true;
  if (typeof contentType === 'string' && /gzip/i.test(contentType)) return true;
  return typeof text === 'string' && /^\u001f[\u008b\ufffd]/.test(text);
}

const dateMs = text => {
  const ms = Date.parse(String(text).trim());
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Read a sitemap's text.
 * @returns {{ isXml: boolean, isIndex: boolean, entries: number, locs: string[], lastmods: number[] }}
 *   `entries` counts the <url> and <sitemap> entries; `locs` holds up to 5,000 addresses; `lastmods` the dates (ms).
 */
export function parseSitemap(text) {
  const body = String(text ?? '').slice(0, 2 * 1024 * 1024);
  const head = body.trimStart().slice(0, 600).toLowerCase();
  const isIndex = /<sitemapindex[\s>]/.test(body.slice(0, 5000).toLowerCase());
  const isUrlset = /<urlset[\s>]/.test(body.slice(0, 5000).toLowerCase());
  const looksXml = head.startsWith('<?xml') || head.startsWith('<urlset') || head.startsWith('<sitemapindex') || isUrlset || isIndex;
  if (!looksXml || (!isIndex && !isUrlset)) return { isXml: false, isIndex: false, entries: 0, locs: [], lastmods: [] };
  const locs = [];
  const lastmods = [];
  let entries = 0;
  for (const m of body.matchAll(/<(?:url|sitemap)[\s>]/gi)) {
    entries += 1;
    if (entries >= SITEMAP_MAX_ENTRIES) break;
  }
  for (const m of body.matchAll(/<loc>\s*([^<\s]{1,2000})\s*<\/loc>/gi)) {
    if (locs.length >= SITEMAP_MAX_ENTRIES) break;
    locs.push(m[1]);
  }
  for (const m of body.matchAll(/<lastmod>\s*([^<]{1,40})\s*<\/lastmod>/gi)) {
    if (lastmods.length >= SITEMAP_MAX_ENTRIES) break;
    const ms = dateMs(m[1]);
    if (ms !== null) lastmods.push(ms);
  }
  return { isXml: true, isIndex, entries, locs, lastmods };
}
