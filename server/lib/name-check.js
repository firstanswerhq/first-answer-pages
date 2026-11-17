/**
 * name-check.js — a second check on how the Grader reads an AI answer, using
 * Google's Gemini Decisions API (yes/no questions answered as probabilities).
 *
 * Our own reader (name-match.js) pulls business names out of an answer and
 * decides whether the checked business was named. It sometimes counts a
 * heading or a tip ("Before booking") as a business, and it can miss a
 * business named a little differently. This check asks Gemini, for the same
 * answer: is the checked business named, and is each pulled-out name really a
 * business? The Grader uses the replies only when Gemini is very sure, and
 * falls back to its own reader on any failure.
 *
 * The answer text is sent to Google; nothing typed by a visitor is sent except
 * the business name, city and state. The key goes only in the x-goog-api-key
 * header and is never logged.
 */

const DECISIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';
export const DEFAULT_DECISION_MODEL = 'gemini-decision-1';
const MAX_NAMES = 30;
const MAX_ANSWER_CHARS = 40_000;
const DEFAULT_TIMEOUT_MS = 8000;

/** Plain, short, quote-free text for use inside a question. */
const clean = (s, max = 120) => String(s ?? '').replace(/["“”\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A probability from 0 to 1, or null. */
const prob = a => (a && typeof a.noul === 'number' && Number.isFinite(a.noul) && a.noul >= 0 && a.noul <= 1 ? a.noul : null);

/**
 * @param {{ apiKey: string, model?: string, timeoutMs?: number }} opts
 * @returns {{ name: string, check: (args: { answer: string, business: { name: string, city?: string, state?: string }, names: string[], signal?: AbortSignal }) => Promise<{ named: number|null, isBusiness: Map<string, number> } | null> }}
 */
export function createNameChecker({ apiKey, model = DEFAULT_DECISION_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const safeModel = String(model).replace(/[^A-Za-z0-9._-]/g, '');
  return {
    name: 'gemini-decisions',
    async check({ answer, business, names = [], signal } = {}) {
      const bizName = clean(business?.name);
      const text = String(answer ?? '').slice(0, MAX_ANSWER_CHARS);
      if (!bizName || !text.trim()) return null;
      const place = [clean(business?.city, 60), clean(business?.state, 30)].filter(Boolean).join(', ');
      const list = [...new Set((Array.isArray(names) ? names : []).map(n => String(n ?? '')).filter(n => clean(n)))].slice(0, MAX_NAMES);
      const questions = {
        named: {
          type: 'noul',
          instructions: `Does this answer name or recommend the business "${bizName}"${place ? ` (in ${place})` : ''}? Count small spelling differences, a shortened form of the name, or a missing "The" or "LLC" as the same business. Do not count a different business that only shares a word with it.`,
          criteria: { true_description: 'The answer names this business.', false_description: 'The answer does not name this business.' },
        },
      };
      list.forEach((n, i) => {
        questions[`n${i}`] = {
          type: 'noul',
          instructions: `In this answer, is "${clean(n)}" the name of a specific business someone could hire or visit? Answer no for headings, labels, tips, steps, review or directory websites (like Yelp, Google, Angi or the BBB), and general phrases.`,
          criteria: { true_description: 'It is the name of a specific business.', false_description: 'It is not the name of a business.' },
        };
      });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onOuter = () => ctrl.abort();
      signal?.addEventListener?.('abort', onOuter, { once: true });
      try {
        const res = await fetch(DECISIONS_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ model: safeModel, input: [{ type: 'text', text }], questions }),
          signal: ctrl.signal,
        });
        process.stderr.write(`[name-check] status=${Number(res.status) || 0}\n`);
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const answers = data?.answers;
        if (!answers || typeof answers !== 'object') return null;
        const isBusiness = new Map();
        list.forEach((n, i) => {
          const p = prob(answers[`n${i}`]);
          if (p !== null) isBusiness.set(n, p);
        });
        return { named: prob(answers.named), isBusiness };
      } catch {
        process.stderr.write('[name-check] failed\n');
        return null;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener?.('abort', onOuter);
      }
    },
  };
}

/** The name checker, or null when it is off (no Gemini key, switched off, or a test run). */
export function createNameCheck(config) {
  const g = config?.gemini;
  if (!g?.apiKey || config?.geminiNameCheck === false || config?.testRun === true) return null;
  return createNameChecker({ apiKey: g.apiKey, model: config?.decisionModel || DEFAULT_DECISION_MODEL });
}

/** Only a very sure "not a business" removes a name; only a very sure "named" adds a mention. */
export const DROP_BELOW = 0.15;
export const NAMED_ABOVE = 0.95;
