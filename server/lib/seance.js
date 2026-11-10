// The Seance: ask an AI assistant a plain question about a listing's category
// and city, record whether the answer names the business, and keep the history.

const MAX_ANSWER_CODE_POINTS = 4000;
const RUN_FAILED_MESSAGE = 'Seance run failed';

/** Typed error. code is 'not_found' or 'run_failed'. Messages are fixed text. */
export class SeanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SeanceError';
    this.code = code;
  }
}

/**
 * @param {{ category?: string, city?: string }} listing
 * @param {{ slug: string, label: string }[]} categories
 * @returns {string} `best <category label, lowercased> in <city>`; the city keeps
 *   its stored casing, and an unknown category falls back to the lowercased slug
 */
export function buildPrompt(listing, categories) {
  const found = Array.isArray(categories)
    ? categories.find(c => c && c.slug === listing.category)
    : undefined;
  const label = found && typeof found.label === 'string' && found.label !== ''
    ? found.label
    : listing.category;
  return `best ${String(label).toLowerCase()} in ${listing.city}`;
}

/**
 * Lowercase per code point, each punctuation code point becomes a space,
 * whitespace runs collapse to one space, then trim. No Unicode normalization.
 */
export function normalizeForMatch(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const lower = ch.toLowerCase();
    out += /^\p{P}$/u.test(lower) || /^\p{P}$/u.test(ch) ? ' ' : lower;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** True when the normalized name is non-empty and a substring of the normalized answer. */
export function detectNamed(name, answer) {
  const n = normalizeForMatch(name);
  if (n === '') return false;
  return normalizeForMatch(answer).includes(n);
}

/**
 * Append-only history over store.collection('seance').
 * No update or delete is exposed.
 */
export function createSeanceStore(store) {
  const coll = () => store.collection('seance');
  return {
    append: run => coll().append(run),
    async list(listingId) {
      const all = await coll().read();
      return (Array.isArray(all) ? all : []).filter(r => r && r.listingId === listingId);
    },
  };
}

/**
 * @param {object} ctx app context: store, assistantProvider, config, clock, newId
 * @param {string} listingId
 * @returns {Promise<object>} the stored run
 */
export async function runSeance(ctx, listingId) {
  const listing = ctx.store.findById(listingId);
  if (!listing) throw new SeanceError('not_found', 'Listing not found');

  const prompt = buildPrompt(listing, ctx.store.getCategories());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.config.providerTimeoutMs);

  let raw;
  try {
    const result = await ctx.assistantProvider.ask({ prompt, signal: controller.signal });
    raw = typeof result === 'string' ? result : result?.answer;
    if (typeof raw !== 'string') throw new Error('bad provider result');
  } catch {
    // Never surface provider messages: they could contain keys or response bodies.
    throw new SeanceError('run_failed', RUN_FAILED_MESSAGE);
  } finally {
    clearTimeout(timer);
  }

  const answer = Array.from(raw).slice(0, MAX_ANSWER_CODE_POINTS).join('');
  const run = {
    id: ctx.newId(),
    listingId,
    prompt,
    provider: ctx.assistantProvider.name,
    timestamp: new Date(ctx.clock.now()).toISOString(),
    answer,
    named: detectNamed(listing.name, answer),
  };
  await createSeanceStore(ctx.store).append(run);
  return run;
}
