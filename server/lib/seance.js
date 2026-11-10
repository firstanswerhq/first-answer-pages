// The Seance: ask an AI assistant a plain question about a listing's category
// and city, record whether the answer names the business, and keep the history.

const MAX_ANSWER_CODE_POINTS = 4000;
const MAX_MODEL_CHARS = 100;
const RUN_FAILED_MESSAGE = 'Seance run failed';

/** Typed error. code is 'not_found' or 'run_failed'. Messages are fixed text. */
export class SeanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SeanceError';
    this.code = code;
  }
}

/** A natural plural phrase for each category slug, used in the Séance question. */
export const CATEGORY_PHRASES = Object.freeze({
  plumbers: 'plumbers',
  electricians: 'electricians',
  restaurants: 'restaurants',
  'auto-repair': 'auto repair shops',
  'hair-salons': 'hair salons',
  lawyers: 'lawyers',
  cleaners: 'cleaners',
  landscapers: 'landscapers',
  'pressure-washing': 'pressure washing companies',
  'pools-and-concrete': 'pool and concrete companies',
  'shops-and-restaurants': 'shops and restaurants',
  other: 'businesses',
});

/**
 * @param {{ category?: string, city?: string }} listing
 * @param {{ slug: string, label: string }[]} categories
 * @returns {string} `best <phrase> in <city>`; the phrase comes from
 *   CATEGORY_PHRASES, else the lowercased category label, else "businesses".
 *   The city keeps its stored casing.
 */
export function buildPrompt(listing, categories) {
  const found = Array.isArray(categories)
    ? categories.find(c => c && c.slug === listing.category)
    : undefined;
  const mapped = Object.hasOwn(CATEGORY_PHRASES, listing.category) ? CATEGORY_PHRASES[listing.category] : '';
  const label = found && typeof found.label === 'string' ? found.label.trim() : '';
  const phrase = mapped || label.toLowerCase() || 'businesses';
  return `best ${phrase} in ${listing.city}`;
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
  const timer = setTimeout(() => controller.abort(), ctx.config.seanceTimeoutMs ?? ctx.config.providerTimeoutMs);

  let raw;
  let result;
  try {
    result = await ctx.assistantProvider.ask({
      prompt,
      signal: controller.signal,
      category: listing.category,
      businessName: listing.name,
      // A pause_turn resend is a second paid call; the provider asks before sending it.
      consumeExtra: () => ctx.aiBudget?.consume({ kind: 'seance' })?.allowed === true,
    });
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
    provider: (typeof result?.provider === 'string' && result.provider !== '' ? result.provider : null)
      || ctx.assistantProvider?.name || 'unknown',
    timestamp: new Date(ctx.clock.now()).toISOString(),
    answer,
    named: detectNamed(listing.name, answer),
  };
  if (typeof result?.model === 'string') {
    const model = Array.from(result.model.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''))
      .slice(0, MAX_MODEL_CHARS).join('').trim();
    if (model !== '') run.model = model;
  }
  if (typeof result?.webSearch === 'boolean') run.webSearch = result.webSearch;
  if (Array.isArray(result?.sources)) {
    const sources = result.sources
      .filter(s => typeof s?.url === 'string' && /^https?:\/\//i.test(s.url) && typeof s.title === 'string')
      .map(s => ({ url: s.url, title: s.title }));
    if (sources.length > 0) run.sources = sources;
  }
  await createSeanceStore(ctx.store).append(run);
  return run;
}
