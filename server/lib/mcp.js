/**
 * mcp.js — pure JSON-RPC 2.0 dispatch for the MCP endpoint (POST /mcp).
 *
 * handleRpc never throws. It returns { status, body } where body is a JSON-RPC
 * response object, or null for a notification (HTTP 202, empty body).
 */

import {
  SEARCH_LISTINGS_SCHEMA,
  GET_LISTING_SCHEMA,
  REQUEST_QUOTE_SCHEMA,
  validateAgainstSchema,
} from './tool-validator.js';
import { submitQuote } from './quotes.js';
import { verificationFor } from './verifier.js';
import { publicListing } from './public-listing.js';
import { DEFAULT_SITE_NAME } from './config.js';
import { normalizeCategory, normalizeCity, categoryForQuery } from './search-match.js';
import { filledHours } from './html.js';
import { reviewsLinkHost, normalizeWebsite } from './listing-fields.js';

export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
export const SERVER_INFO = Object.freeze({ name: 'first-answer-pages', version: '0.1.0' });
export const SEARCH_LIMIT = 25;

/** Said up front in the lookup tools' descriptions (high-tech-look 9). */
export const FREE_NOTE = 'Free: there is no charge for this lookup.';
/** Who confirmed a field (high-tech-look 9.1). */
export const CONFIRMED_BY_BUSINESS = 'business';
export const CONFIRMED_BY_CHECK = 'First Answer phone and ID check';
/** The fields that carry a receipt, in this order. `area` is the listing's service area. */
export const RECEIPT_FIELDS = Object.freeze(['phone', 'hours', 'services', 'area', 'website']);

export const TOOLS = Object.freeze([
  {
    name: 'search_listings',
    description:
      `${FREE_NOTE} Search the local business directory. Optional filters: category, city, and a text query matched against name, description, services, and the category (so "plumber" finds every plumber). Returns up to 25 listings. Each listing has receipts: for its phone, hours, services, area and website, the date it was last confirmed and by whom, or null when unknown. Every answer has fetchedAt, the time it was built.`,
    inputSchema: SEARCH_LISTINGS_SCHEMA,
  },
  {
    name: 'get_listing',
    description:
      `${FREE_NOTE} Get one business listing by id, with its "details confirmed by the business" status, date, and hash when available, receipts for its phone, hours, services, area and website (the date last confirmed and by whom, or null when unknown), the Verified check with who checked and when (or null), and fetchedAt.`,
    inputSchema: GET_LISTING_SCHEMA,
  },
  {
    name: 'request_quote',
    description:
      'Send a quote request to a listed business. Requires the listing id, your name, an email or phone number to reach you, and the details of the job.',
    inputSchema: REQUEST_QUOTE_SCHEMA,
  },
]);

/**
 * The tool list for one server: search_listings lists the valid category
 * slugs as an enum (advertised only; the validator does not enforce it, so
 * "plumber" or "Plumbers" still work).
 */
export function buildTools(ctx) {
  let slugs = [];
  try {
    slugs = (ctx?.store?.getCategories?.() ?? []).map(c => c?.slug).filter(s => typeof s === 'string' && s !== '');
  } catch {
    slugs = [];
  }
  if (slugs.length === 0) return TOOLS;
  return TOOLS.map(t => (t.name !== 'search_listings' ? t : {
    ...t,
    inputSchema: {
      ...t.inputSchema,
      properties: {
        ...t.inputSchema.properties,
        category: { ...t.inputSchema.properties.category, enum: slugs },
      },
    },
  }));
}

const E_PARSE = -32700;
const E_INVALID_REQUEST = -32600;
const E_METHOD = -32601;
const E_PARAMS = -32602;
const E_INTERNAL = -32603;

function rpcError(id, code, message) {
  return { status: id === null && (code === E_PARSE || code === E_INVALID_REQUEST) ? 400 : 200,
    body: { jsonrpc: '2.0', id, error: { code, message } } };
}

function rpcResult(id, result) {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** JSON-RPC error for a body that could not be parsed. */
export function parseErrorResponse() {
  return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: E_PARSE, message: 'Parse error' } } };
}

/** JSON-RPC error for a structurally invalid request. */
export function invalidRequestResponse(message = 'Invalid Request') {
  return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: E_INVALID_REQUEST, message } } };
}

/** Internal error with HTTP 200 (never 500). */
export function internalErrorResponse(id = null) {
  return { status: 200, body: { jsonrpc: '2.0', id, error: { code: E_INTERNAL, message: 'Internal error' } } };
}

function toolSuccess(structured) {
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function toolFailure(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function listingUrl(ctx, id) {
  // requestBaseUrl comes from the HTTP route (BASE_URL, or the request host when BASE_URL is unset locally).
  const base = String(ctx.requestBaseUrl ?? ctx.config?.baseUrl ?? '').replace(/\/+$/, '');
  return `${base}/listings/${encodeURIComponent(id)}`;
}

/** The time an answer was built, from the app's clock (high-tech-look 9.2). */
function fetchedAt(ctx) {
  const raw = ctx?.clock?.now?.() ?? Date.now();
  const d = new Date(raw instanceof Date ? raw.getTime() : raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

/** A stored date or time as given, or null. Nothing is made up: an unreadable value is null. */
function storedDate(value) {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Date.parse(value)) ? value : null;
}

/**
 * The Verified stamp (trust.js), only with who checked and when, else null (high-tech-look 9.3). The phone code and
 * the photo ID check both passed; `checkedAt` is the later of the two, as stored.
 */
export function verifiedCheckFor(store, listing, now) {
  let status = null;
  try {
    status = typeof store?.getTrustStatus === 'function' ? store.getTrustStatus(listing, now) : null;
  } catch {
    status = null;
  }
  const at = storedDate(status?.verifiedAt);
  if (status?.verified !== true || !at) return null;
  return { checkedBy: CONFIRMED_BY_CHECK, checkedAt: at };
}

/** True when the listing really has a value for a receipt field. */
function hasField(l, field) {
  if (field === 'phone') return typeof l.phone === 'string' && l.phone.trim() !== '';
  if (field === 'hours') return Boolean(l.hours && typeof l.hours === 'object' && filledHours(l.hours).length > 0);
  if (field === 'services') return Array.isArray(l.services) && l.services.some(s => typeof s === 'string' && s.trim() !== '');
  if (field === 'area') return typeof l.serviceArea === 'string' && l.serviceArea.trim() !== '';
  if (field === 'website') return normalizeWebsite(l.website) !== '';
  return false;
}

/**
 * For each field returned (phone, hours, services, area, website): when it was last confirmed and by whom, or null for
 * both when unknown (high-tech-look 9.1). The business confirms every field when it confirms its details (the stored
 * date). The Verified check confirms the phone only: its code went to that number. Never an invented date.
 * @returns {Record<string, { lastConfirmed: string|null, confirmedBy: string|null }>}
 */
export function receiptsFor(store, listing, now) {
  const l = publicListing(listing) ?? {};
  const owner = ownerConfirmation(store, listing);
  const ownerAt = storedDate(owner?.verifiedAt) ?? storedDate(owner?.verifiedDate);
  const check = verifiedCheckFor(store, listing, now);
  const unknown = () => ({ lastConfirmed: null, confirmedBy: null });
  const out = {};
  for (const field of RECEIPT_FIELDS) {
    if (!hasField(l, field)) out[field] = unknown();
    else if (field === 'phone' && check) out[field] = { lastConfirmed: check.checkedAt, confirmedBy: CONFIRMED_BY_CHECK };
    else if (ownerAt) out[field] = { lastConfirmed: ownerAt, confirmedBy: CONFIRMED_BY_BUSINESS };
    else out[field] = unknown();
  }
  return out;
}

/** Hours as the filled-in days only, the same as the page, the JSON-LD and get_listing. */
function filledHoursObject(hours) {
  if (!hours || typeof hours !== 'object') return {};
  return Object.fromEntries(filledHours(hours).map(([day, text]) => [day.toLowerCase(), text]));
}

/** "Details confirmed by the business", only with a readable stored date (batch 5 Z5), else null. */
function ownerConfirmation(store, listing) {
  let v = null;
  try {
    v = verificationFor(store, listing);
  } catch {
    v = null;
  }
  return v && storedDate(v.verifiedDate) ? v : null;
}

function summarize(ctx, listing, now) {
  const l = publicListing(listing);
  const hours = filledHoursObject(l.hours);
  return {
    id: l.id,
    name: l.name,
    category: l.category,
    phone: l.phone,
    city: l.city,
    state: l.state,
    serviceArea: l.serviceArea,
    description: l.description,
    services: l.services,
    // Batch 5 Z3: the hours are returned too, so the hours receipt is about a field that is in the answer.
    ...(Object.keys(hours).length > 0 ? { hours } : {}),
    url: listingUrl(ctx, l.id),
    // The link to the business's reviews, only when it has a valid one; never a rating, count or review text.
    // The business's own website (publicListing has already checked it again), only when it has one.
    ...(normalizeWebsite(l.website) !== '' ? { website: normalizeWebsite(l.website) } : {}),
    ...(reviewsLinkHost(l.reviewsLink) !== '' ? { reviews: l.reviewsLink.trim() } : {}),
    receipts: receiptsFor(ctx.store, listing, now),
  };
}

/** Drop empty-string values: an empty string counts as not supplied. */
function nonEmpty(v) {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function searchListings(ctx, args) {
  const categories = ctx.store.getCategories();
  const rawCategory = nonEmpty(args.category);
  const rawCity = nonEmpty(args.city);
  const category = rawCategory === undefined ? undefined : (normalizeCategory(rawCategory, categories) ?? rawCategory);
  const city = rawCity === undefined ? undefined : (nonEmpty(normalizeCity(rawCity)) ?? rawCity);
  const query = nonEmpty(args.query);

  let matches;
  // A query that names a trade ("plumber") also matches every listing in that
  // category, not just names, descriptions and services that contain the word.
  const queryCategory = query === undefined ? undefined : categoryForQuery(query, categories);
  if (queryCategory && (category === undefined || category === queryCategory)) {
    // Real text matches first (a plumber who lists "drain cleaning" beats a cleaner),
    // then the rest of the named category.
    const textMatches = ctx.store.searchListings({ category, city, query });
    const textIds = new Set(textMatches.map(l => l.id));
    const categoryOnly = ctx.store.searchListings({ category, city })
      .filter(l => l.category === queryCategory && !textIds.has(l.id));
    matches = [...textMatches, ...categoryOnly].slice(0, SEARCH_LIMIT);
  } else {
    matches = ctx.store.searchListings({ category, city, query, limit: SEARCH_LIMIT });
  }
  const at = fetchedAt(ctx);
  const listings = matches.map(l => summarize(ctx, l, at));
  return toolSuccess({ listings, count: listings.length, fetchedAt: at });
}

function getListing(ctx, args) {
  const at = fetchedAt(ctx);
  const listing = ctx.store.findById(args.id);
  // Batch 5 Z4: the "not found" answer is a lookup answer too, so it says when it was built.
  if (!listing) {
    return { ...toolFailure('Listing not found'), structuredContent: { error: 'Listing not found', fetchedAt: at } };
  }
  // Z5: an unreadable stored date is never "verified: true".
  const v = ownerConfirmation(ctx.store, listing);
  // "Details confirmed by the business" (the tamper-check hash): the identifiers keep their old names, and a confirmed
  // listing also says who confirmed it and keeps the owner's wording (high-tech-look 9.3).
  const verification = v
    ? {
      verified: true, verifiedDate: v.verifiedDate, hash: v.hash,
      confirmedBy: CONFIRMED_BY_BUSINESS, label: 'Details confirmed by the business',
    }
    : { verified: false, verifiedDate: null, hash: null };
  // Hours: only the days the owner filled in, the same as the page and JSON-LD.
  const out = publicListing(listing);
  if (out && out.hours && typeof out.hours === 'object') out.hours = filledHoursObject(out.hours);
  return toolSuccess({
    listing: out,
    verification,
    // The Verified stamp: only with who checked and when, else null.
    verifiedCheck: verifiedCheckFor(ctx.store, listing, at),
    receipts: receiptsFor(ctx.store, listing, at),
    fetchedAt: at,
  });
}

async function requestQuote(ctx, args, clientIp, id) {
  const r = await submitQuote(ctx, args, clientIp);
  if (r.status === 'invalid') return rpcError(id, E_PARAMS, `Invalid argument: ${r.argument}: ${r.message}`);
  if (r.status === 'rate_limited') {
    return {
      result: toolFailure(`Too many quote requests. Try again in ${r.retryAfterSeconds} seconds.`),
    };
  }
  const listing = ctx.store.findById(args.id);
  const phone = listing ? listing.phone : '';
  const message = `Thanks! Your request is saved and we'll pass it to the business. If you need help sooner, call them at ${phone}.`;
  return { result: toolSuccess({ quoteId: r.quoteId, message }) };
}

async function callTool(ctx, id, params, clientIp) {
  if (!isPlainObject(params) || typeof params.name !== 'string') {
    return rpcError(id, E_PARAMS, 'Invalid params: name is required');
  }
  const tool = buildTools(ctx).find(t => t.name === params.name);
  if (!tool) return rpcError(id, E_PARAMS, `Unknown tool: ${params.name}`);

  const args = params.arguments === undefined ? {} : params.arguments;
  const checked = validateAgainstSchema(tool.inputSchema, args);
  if (!checked.ok) {
    return rpcError(id, E_PARAMS, `Invalid argument: ${checked.argument}: ${checked.message}`);
  }

  if (tool.name === 'search_listings') return rpcResult(id, searchListings(ctx, args));
  if (tool.name === 'get_listing') return rpcResult(id, getListing(ctx, args));

  const out = await requestQuote(ctx, args, clientIp, id);
  if (out.body) return out; // rpcError
  return rpcResult(id, out.result);
}

/**
 * @param {object} ctx
 * @param {unknown} message parsed JSON body
 * @param {string} clientIp
 * @returns {Promise<{status:number, body:object|null}>}
 */
export async function handleRpc(ctx, message, clientIp) {
  try {
    if (!isPlainObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return invalidRequestResponse();
    }
    const hasId = Object.hasOwn(message, 'id');
    if (hasId && typeof message.id !== 'string' && typeof message.id !== 'number') {
      return invalidRequestResponse();
    }

    // Notification: no id, no response body.
    if (!hasId) return { status: 202, body: null };

    const id = message.id;
    const params = message.params;

    switch (message.method) {
      case 'initialize': {
        const requested = isPlainObject(params) ? params.protocolVersion : undefined;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : SUPPORTED_PROTOCOL_VERSIONS[0];
        return rpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { ...SERVER_INFO, title: ctx?.config?.siteName || DEFAULT_SITE_NAME },
        });
      }
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: buildTools(ctx).map(t => ({ ...t })) });
      case 'tools/call':
        return await callTool(ctx, id, params, clientIp);
      default:
        return rpcError(id, E_METHOD, `Method not found: ${message.method}`);
    }
  } catch (err) {
    process.stderr.write(`[mcp] internal error: ${err?.name ?? 'Error'}\n`);
    const id = isPlainObject(message) && (typeof message.id === 'string' || typeof message.id === 'number')
      ? message.id : null;
    return internalErrorResponse(id);
  }
}
