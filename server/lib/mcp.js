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
import { normalizeCategory, normalizeCity } from './search-match.js';

export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2025-06-18', '2025-03-26', '2024-11-05']);
export const SERVER_INFO = Object.freeze({ name: 'first-answer-pages', version: '0.1.0' });
export const SEARCH_LIMIT = 25;

export const TOOLS = Object.freeze([
  {
    name: 'search_listings',
    description:
      'Search the local business directory. Optional filters: category, city, and a text query matched against name, description, and services. Returns up to 25 listings.',
    inputSchema: SEARCH_LISTINGS_SCHEMA,
  },
  {
    name: 'get_listing',
    description:
      'Get one business listing by id, with its owner-confirmed verification status, date, and hash when available.',
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
  const base = String(ctx.config?.baseUrl ?? '').replace(/\/+$/, '');
  return `${base}/listings/${encodeURIComponent(id)}`;
}

function summarize(ctx, listing) {
  const l = publicListing(listing);
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
    url: listingUrl(ctx, l.id),
  };
}

/** Drop empty-string values: an empty string counts as not supplied. */
function nonEmpty(v) {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function searchListings(ctx, args) {
  const rawCategory = nonEmpty(args.category);
  const rawCity = nonEmpty(args.city);
  const matches = ctx.store.searchListings({
    category: rawCategory === undefined
      ? undefined
      : (normalizeCategory(rawCategory, ctx.store.getCategories()) ?? rawCategory),
    city: rawCity === undefined ? undefined : (nonEmpty(normalizeCity(rawCity)) ?? rawCity),
    query: nonEmpty(args.query),
    limit: SEARCH_LIMIT,
  });
  const listings = matches.map(l => summarize(ctx, l));
  return toolSuccess({ listings, count: listings.length });
}

function getListing(ctx, args) {
  const listing = ctx.store.findById(args.id);
  if (!listing) return toolFailure('Listing not found');
  const v = verificationFor(ctx.store, listing);
  const verification = v
    ? { verified: true, verifiedDate: v.verifiedDate, hash: v.hash }
    : { verified: false, verifiedDate: null, hash: null };
  return toolSuccess({ listing: publicListing(listing), verification });
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
