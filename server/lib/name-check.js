/**
 * name-check.js — a second check on reading AI answers for business names.
 *
 * The Grader's own reader (name-match.js) finds the business and pulls out
 * competitor names. This module asks Google's Gemini Decisions API two yes/no
 * questions about each pulled-out name: is it a specific business, and is it the
 * same business as the one being graded. It returns the probabilities and does
 * nothing else; the Grader applies the limits below.
 *
 * Every failure (refused call, bad reply, network error, a reply slower than
 * the deadline) gives null, never an exception, so the Grader's own reading
 * stands. The key goes only in a request header. Nothing here logs an answer,
 * a name, a city or the key.
 */

const DECISIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';
const DEFAULT_MODEL = 'gemini-decision-1';
const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = 'FirstAnswerPages/1.0 (+https://firstanswerhq.com)';

/** A name is dropped from the competitors only when Gemini's "is a business" probability is below this. */
export const DROP_BELOW = 0.15;
/** The business counts as named under a different spelling only at or above this "same business" probability. */
export const NAMED_ABOVE = 0.95;

const MAX_NAMES = 30;
const MAX_BUSINESS_WORDS = 8;
const MAX_NAME_CODE_POINTS = 80;
const MAX_ANSWER_CODE_POINTS = 8000;

/** Letters, numbers, spaces and a few plain marks; everything else (quotes, brackets, newlines) goes. */
const plain = text => String(text ?? '')
  .replace(/[^\p{L}\p{N} '.,&-]/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

const cut = (text, max) => Array.from(text).slice(0, max).join('').trim();

/** The business name as it goes into a question: at most 8 words of plain characters. */
const businessLabel = name => plain(String(name ?? '').trim().split(/\s+/).slice(0, MAX_BUSINESS_WORDS).join(' '));

/** A name pulled out of an AI answer, cleaned the same way so it cannot carry instructions. */
const nameLabel = name => cut(plain(name), MAX_NAME_CODE_POINTS);

const isProbability = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * @param {{ apiKey: string, model?: string, timeoutMs?: number }} opts
 * @returns {{ name: string, check: Function }}
 *   check({ answer, business: { name, city, state }, names }) resolves
 *   { isBusiness: Map<string, number>, sameAs: Map<string, number> } or null.
 */
export function createNameChecker({ apiKey, model, timeoutMs } = {}) {
  const useModel = model || DEFAULT_MODEL;
  const deadlineMs = Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  return {
    name: 'gemini-decisions',
    async check({ answer, business, names } = {}) {
      try {
        const list = (Array.isArray(names) ? names : [])
          .filter(n => typeof n === 'string' && n.trim() !== '')
          .slice(0, MAX_NAMES);
        if (list.length === 0 || typeof answer !== 'string' || answer.trim() === '') return null;

        const target = businessLabel(business?.name);
        if (target === '') return null;
        const city = plain(business?.city);
        const state = plain(business?.state);
        const place = [city, state].filter(Boolean).join(', ');
        const where = place ? ` in ${place}` : '';

        const questions = {};
        list.forEach((name, i) => {
          const label = nameLabel(name);
          questions[`n${i}`] = {
            type: 'noul',
            instructions: `Is "${label}" the name of one specific business, rather than a heading, a general phrase or advice?`,
          };
          questions[`s${i}`] = {
            type: 'noul',
            instructions: `Is "${label}" the same business as "${target}"${where}? Answer yes only if they are clearly one business, allowing for spelling or word-order differences.`,
          };
        });

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), deadlineMs);
        let data;
        try {
          const res = await fetch(DECISIONS_URL, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-goog-api-key': apiKey,
              'user-agent': USER_AGENT,
            },
            body: JSON.stringify({
              model: useModel,
              input: [{ type: 'text', text: cut(answer, MAX_ANSWER_CODE_POINTS) }],
              questions,
            }),
            signal: ctrl.signal,
          });
          if (!res.ok) return null;
          data = JSON.parse(await res.text());
        } finally {
          clearTimeout(timer);
        }

        const answers = data?.answers;
        if (answers === null || typeof answers !== 'object') return null;
        const isBusiness = new Map();
        const sameAs = new Map();
        list.forEach((name, i) => {
          const n = answers[`n${i}`];
          const s = answers[`s${i}`];
          if (isProbability(n?.noul)) isBusiness.set(name, n.noul);
          if (isProbability(s?.noul)) sameAs.set(name, s.noul);
        });
        if (isBusiness.size === 0 && sameAs.size === 0) return null;
        return { isBusiness, sameAs };
      } catch {
        return null;
      }
    },
  };
}

/**
 * The name checker, or null without GEMINI_API_KEY, when GEMINI_NAME_CHECK is off,
 * or in a test run.
 * @param {object} config resolved config from configFromEnv()
 */
export function createNameCheck(config) {
  const key = config?.gemini?.apiKey;
  if (!key || config?.geminiNameCheck === false || config?.testRun) return null;
  return createNameChecker({ apiKey: key, model: config.decisionModel, timeoutMs: DEFAULT_TIMEOUT_MS });
}
