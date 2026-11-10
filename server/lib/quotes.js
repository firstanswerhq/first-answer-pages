// Quote store and submission. One function serves MCP, the JSON API, and the
// no-JS HTML form so validation, storage, and rate limits are identical.

import { validateQuoteArgs } from './tool-validator.js';
import { RULES } from './rate-limiter.js';

/** Run notify() with a timeout; rejects on timeout. */
function notifyWithTimeout(notifier, payload, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('notifier timed out');
      err.name = 'TimeoutError';
      reject(err);
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => notifier.notify(payload)), timeout])
    .finally(() => clearTimeout(timer));
}

/**
 * @param {object} ctx resolved app context
 * @param {unknown} args raw quote arguments
 * @param {string} clientIp
 * @returns {Promise<{status:'ok', quoteId:string}
 *   | {status:'invalid', argument:string, message:string}
 *   | {status:'rate_limited', retryAfterSeconds:number}>}
 */
export async function submitQuote(ctx, args, clientIp) {
  const checked = validateQuoteArgs(args, ctx.store);
  if (!checked.ok) {
    return { status: 'invalid', argument: checked.argument, message: checked.message };
  }
  const { id: listingId, name, contact, details } = checked.value;

  const limit = ctx.rateLimiter.consumeAll([
    { key: `quote:${clientIp}`, ...RULES.quote },
    { key: `quote:${clientIp}:${listingId}`, ...RULES['quote-listing'] },
  ]);
  if (!limit.allowed) {
    return { status: 'rate_limited', retryAfterSeconds: limit.retryAfterSeconds };
  }

  const quote = {
    id: ctx.newId(),
    listingId,
    name,
    contact,
    details,
    createdAt: new Date(ctx.clock.now()).toISOString(),
    notified: false,
  };
  const quotes = ctx.store.collection('quotes');
  await quotes.append(quote);

  // Best-effort retention; never blocks or fails the submission.
  if (typeof ctx.store.pruneExpired === 'function') {
    try {
      await ctx.store.pruneExpired({ quotes: true, drafts: false });
    } catch (err) {
      process.stderr.write(`[quote] prune failed: ${err?.name ?? 'Error'}\n`);
    }
  }

  const listing = ctx.store.findById(listingId);
  // The mock notifier (tests) keeps the original stored shape; real ones also
  // record which notifier ran and whether an email actually went out.
  const record = ctx.notifier?.name !== 'mock';
  const saveResult = (fields) => quotes.update(list => {
    const stored = list.find(q => q.id === quote.id);
    if (stored) Object.assign(stored, fields);
  });
  try {
    const result = await notifyWithTimeout(ctx.notifier, { quote, listing }, ctx.config.providerTimeoutMs);
    const sent = result?.sent === true;
    await saveResult({
      notified: result?.sent !== false,
      ...(record && { notifier: result?.notifier ?? ctx.notifier.name, emailed: sent }),
    });
  } catch (err) {
    // Name only: messages could echo user text.
    process.stderr.write(`[quote] notify failed: ${err?.name ?? 'Error'}\n`);
    if (record) {
      try {
        await saveResult({ notifier: ctx.notifier?.name ?? 'none', emailed: false });
      } catch { /* the quote itself is already saved */ }
    }
  }

  return { status: 'ok', quoteId: quote.id };
}

/**
 * Mark a saved quote handled (admin). Saves handled: true and handledAt.
 * @param {object} ctx resolved app context
 * @param {string} quoteId
 * @returns {Promise<{ status: 200 | 404 }>}
 */
export async function markQuoteHandled(ctx, quoteId) {
  let found = false;
  const at = new Date(ctx.clock.now()).toISOString();
  await ctx.store.collection('quotes').update(list => {
    const q = list.find(x => x && typeof x === 'object' && x.id === quoteId);
    if (q) {
      found = true;
      q.handled = true;
      if (typeof q.handledAt !== 'string') q.handledAt = at;
    }
  });
  return { status: found ? 200 : 404 };
}
