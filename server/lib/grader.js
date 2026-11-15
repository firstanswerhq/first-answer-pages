/**
 * grader.js — runs a Grade from start to finish.
 *
 * start(input) stores a `running` Grade and schedules run(id) without
 * awaiting it; the scan page polls. run(id) does the website steps and the
 * AI step together, then builds the free page facts, scores the Checks and
 * marks the Grade `done`. A failed step marks its Checks `not_checked` and the
 * run continues.
 *
 * Logs hold only the Grade_Id, step names, counts, timings and a fixed failure
 * code for the AI step. Never log typed input, AI answers or lead details. Every background promise ends in a
 * .catch that logs the Grade_Id only.
 */

import { randomUUID } from 'node:crypto';
import { SafeFetchError } from './safe-fetch.js';
import { readPageFacts, STREET_PATTERN } from './page-facts.js';
import { runWebsiteChecks, CHECKS } from './grade-checks.js';
import { scoreGrade } from './grade-score.js';
import { analyzeAnswer, registeredDomain } from './name-match.js';
import { normalizeForMatch } from './seance.js';
import { AssistantError } from './assistant.js';
import { mapCategory, normalizePhone, validateFields } from './listing-fields.js';

export const WEBSITE_BUDGET_MS = 30000;
export const AI_TIMEOUT_MS = 120000;
export const STALE_AFTER_MS = 4 * 60 * 1000;
export const REUSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ANSWER_CODE_POINTS = 4000;
export const MAX_ANALYZED_CODE_POINTS = 20000;

export const AI_NOT_CONNECTED = "AI check isn't connected";
export const AI_LIMIT_REACHED = 'AI check limit reached for today';
const AI_FAILED = "The AI check didn't finish.";

/** The five Scan_Steps, in order. */
export function stepNames(input) {
  return [
    'Finding your website',
    'Reading your home page',
    'Checking what AI is allowed to read',
    `Asking AI to name the best ${input.service} in ${input.city}`,
    'Drafting your free directory listing',
  ];
}

const FETCH_FAILURES = Object.freeze({
  blocked_address: "We can't visit that address.",
  bad_url: "We couldn't read that website address.",
  timeout: 'Your website took too long to answer.',
  too_large: 'Your home page is too large to read.',
  too_many_redirects: 'Your website sent us around in circles.',
  connect_failed: "We couldn't reach your website.",
});

const failureText = err => (err instanceof SafeFetchError
  ? FETCH_FAILURES[err.code] ?? FETCH_FAILURES.connect_failed
  : FETCH_FAILURES.connect_failed);

const cutCodePoints = (text, n) => Array.from(String(text ?? '')).slice(0, n).join('');

/** Key used to find an earlier Grade whose AI answers can be reused. */
export function reuseKey(input) {
  return [
    normalizeForMatch(input.name),
    normalizeForMatch(input.city),
    String(input.state ?? '').toLowerCase(),
    normalizeForMatch(input.service),
    registeredDomain(input.website) || '-',
  ].join('|');
}

/**
 * What the scan found, for the Free_Page_Preview and the Fix_Kit. JSON-LD
 * first, then tel: links and the visible text.
 */
export function extractFound(facts, input) {
  const found = {
    name: input.name,
    service: input.service,
    city: input.city,
    state: input.state,
    website: input.website ?? '',
    phone: '',
    address: '',
    hours: [],
  };
  if (!facts) return found;
  const business = facts.jsonLd?.business ?? null;
  found.phone = normalizePhone(business?.telephone ?? '');
  if (!found.phone) {
    for (const link of facts.telLinks ?? []) {
      found.phone = normalizePhone(link.replace(/^tel:/i, ''));
      if (found.phone) break;
    }
  }
  if (!found.phone) {
    const m = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(String(facts.text ?? '').slice(0, 200000));
    found.phone = m ? normalizePhone(m[0]) : '';
  }
  found.address = business?.address?.text ?? '';
  if (!found.address) {
    const m = STREET_PATTERN.exec(String(facts.text ?? '').slice(0, 200000));
    found.address = m ? m[0] : '';
  }
  found.hours = Array.isArray(business?.hours) ? business.hours.slice(0, 7) : [];
  return found;
}

/** The found fields for a stored Grade (what the Free_Page_Preview and Fix_Kit use). */
export function foundFromGrade(grade) {
  const input = grade.input;
  const facts = grade.facts;
  return {
    name: input.name,
    service: input.service,
    city: input.city,
    state: input.state,
    website: input.website ?? '',
    phone: facts?.phone ?? '',
    address: facts?.address ?? '',
    hours: Array.isArray(facts?.hours) ? facts.hours : [],
  };
}

/** The small summary kept on a Grade. Only what the business published on its own website. */
function summarizeFacts(facts, input) {
  if (!facts) return null;
  const found = extractFound(facts, input);
  return {
    title: facts.title,
    metaDescription: facts.metaDescription,
    ogImage: facts.ogImage !== '',
    h1s: facts.h1s.slice(0, 5),
    phone: found.phone,
    hours: found.hours,
    address: found.address,
    jsonLdTypes: facts.jsonLd.types.slice(0, 10),
  };
}

/**
 * The `ai-named` Check_Result from the stored AI results.
 * @param {object[]} ai
 * @param {string} [reasonIfNone] used when no answer ran
 */
export function aiNamedResult(ai, reasonIfNone = AI_FAILED) {
  const ran = Array.isArray(ai) ? ai.length : 0;
  if (ran === 0) return { id: 'ai-named', result: 'not_checked', detail: reasonIfNone };
  const named = ai.filter(a => a.named).length;
  if (named === 0) {
    return { id: 'ai-named', result: 'fail', earned: 0, detail: ran === 1 ? 'No. AI did not name your business.' : `No. AI did not name your business in any of ${ran} answers.` };
  }
  const points = CHECKS.find(c => c.id === 'ai-named').points;
  return {
    id: 'ai-named',
    result: 'pass',
    earned: Math.round((points * named) / ran),
    detail: ran === 1 ? 'Yes. AI named your business.'
      : named === ran ? `Yes. AI named your business in all ${ran} answers.`
        : `Partly. AI named your business in ${named} of ${ran} answers.`,
  };
}

const withTimeout = (promise, ms, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), ms);
  timer.unref?.();
  promise.then(
    v => { clearTimeout(timer); resolve(v); },
    e => { clearTimeout(timer); reject(e); },
  );
});

/**
 * @param {{
 *   store: object, assistantProvider: object, aiBudget: object, safeFetcher: object,
 *   draftStore: { create: Function, get: Function },
 *   notifier?: object, clock: { now(): number }, newId: () => string, config: object,
 * }} deps
 */
export function createGrader({
  store, assistantProvider, aiBudget, safeFetcher, draftStore, notifier, clock, newId, config,
  extraAssistants = [],
}) {
  // Second opinions (ChatGPT and so on): asked the same questions as the main assistant.
  const extras = (Array.isArray(extraAssistants) ? extraAssistants : []).filter(p => p && typeof p.ask === 'function');
  // A second opinion never spends the last of the day's AI calls: these are kept for the main assistant.
  const EXTRA_RESERVE = 12;
  // After this many failures in a row a second opinion is left out for a while.
  const EXTRA_MAX_FAILS = 3;
  const EXTRA_PAUSE_MS = 15 * 60 * 1000;
  const extraHealth = new Map(); // provider name -> { fails, pausedUntil }
  const extraUsable = provider => {
    const h = extraHealth.get(provider.name);
    if (h && h.pausedUntil > nowMs()) return false;
    const left = typeof aiBudget?.peek === 'function' ? aiBudget.peek({ kind: 'grade' }).remaining : Infinity;
    return !(left <= EXTRA_RESERVE);
  };
  const noteExtra = (provider, ok) => {
    if (ok) return void extraHealth.delete(provider.name);
    const h = extraHealth.get(provider.name) ?? { fails: 0, pausedUntil: 0 };
    h.fails += 1;
    if (h.fails >= EXTRA_MAX_FAILS) { h.fails = 0; h.pausedUntil = nowMs() + EXTRA_PAUSE_MS; }
    extraHealth.set(provider.name, h);
  };
  /** Ask a second opinion, unless it is paused or the day's calls are nearly used up. */
  const askExtra = async (input, prompt, provider) => {
    if (!extraUsable(provider)) return { reason: AI_LIMIT_REACHED };
    const res = await askAi(input, prompt, provider);
    if (res.entry || res.reason === AI_FAILED) noteExtra(provider, Boolean(res.entry));
    return res;
  };
  /** Providers (main first) that have no stored answer to this prompt yet. */
  const missingFor = (ai, prompt) => {
    const have = new Set((ai ?? []).filter(a => a.prompt === prompt).map(a => a.provider));
    return [assistantProvider, ...extras].filter(p => p && !have.has(p.name));
  };
  const grades = () => store.collection('grades');
  const nowIso = () => new Date(clock.now()).toISOString();
  const nowMs = () => Number(new Date(clock.now()));
  const logId = (id, msg) => process.stderr.write(`[grader] id=${id} ${msg}\n`);

  /** Running promises, so a second run for the same id is ignored. */
  const runs = new Map();
  /** In-memory view of running Grades, for status.json. */
  const live = new Map();

  function updateGrade(id, change) {
    return grades().update(list => {
      const g = list.find(x => x && x.id === id);
      if (g) change(g);
    });
  }

  async function addStep(id, step) {
    live.get(id)?.steps.push(step);
    await updateGrade(id, g => { g.steps.push(step); });
  }

  /** Run one step; always records it, never throws. */
  async function timed(id, name, fn, track = true) {
    const t0 = nowMs();
    let state = 'done';
    let finding = '';
    let value;
    try {
      const out = await fn();
      value = out?.value;
      finding = out?.finding ?? '';
      if (out?.state) state = out.state;
    } catch {
      state = 'failed';
      finding = 'This step did not finish.';
    }
    const step = { name, state, ms: nowMs() - t0, finding };
    if (track) {
      try {
        await addStep(id, step);
      } catch {
        logId(id, 'a step was not saved');
      }
    }
    return { value, state };
  }

  // ---- website part --------------------------------------------------------

  /** The website steps. With track=false (a recheck) no Scan_Step is recorded. */
  async function websitePart(id, input, track = true) {
    const names = stepNames(input);
    const out = { facts: null, robots: null, llms: null, failure: undefined };
    if (!input.website) {
      if (track) {
        for (const name of names.slice(0, 3)) {
          await addStep(id, { name, state: 'skipped', ms: 0, finding: 'No website given.' });
        }
      }
      return out;
    }

    let home;
    const fetchStep = await timed(id, names[0], async () => {
      try {
        const res = await safeFetcher.fetchText(input.website, { strictSize: true });
        if (res.status >= 400) {
          out.failure = `Your website answered with an error (status ${res.status}).`;
          return { finding: out.failure, state: 'failed' };
        }
        if (!/html|xml|^$/i.test(res.contentType)) {
          out.failure = "Your home page isn't a web page we can read.";
          return { finding: out.failure, state: 'failed' };
        }
        home = res;
        return { finding: 'Found your website.' };
      } catch (err) {
        out.failure = failureText(err);
        return { finding: out.failure, state: 'failed' };
      }
    }, track);
    void fetchStep;

    await timed(id, names[1], async () => {
      if (!home) return { finding: out.failure ?? FETCH_FAILURES.connect_failed, state: 'skipped' };
      out.facts = readPageFacts(home.text);
      const n = out.facts.h1s.length;
      return { finding: `Found ${n} main ${n === 1 ? 'headline' : 'headlines'}.` };
    }, track);

    await timed(id, names[2], async () => {
      const base = home?.finalUrl ?? input.website;
      const get = async (path, accept) => {
        try {
          const res = await safeFetcher.fetchText(new URL(path, base).href, { accept });
          return { status: res.status, contentType: res.contentType, text: res.text };
        } catch {
          return null;
        }
      };
      [out.robots, out.llms] = await Promise.all([
        get('/robots.txt', 'text/plain,*/*;q=0.5'),
        get('/llms.txt', 'text/plain,*/*;q=0.5'),
      ]);
      const parts = [];
      parts.push(out.robots ? "Read your website's rules for AI." : "Couldn't read your website's rules for AI.");
      parts.push(out.llms ? 'Checked for llms.txt.' : "Couldn't check for llms.txt.");
      return { finding: parts.join(' ') };
    }, track);
    return out;
  }

  // ---- AI part -------------------------------------------------------------

  /**
   * Ask the provider one question. Returns { entry } or { reason }.
   * The mock never consumes budget; in production the mock is not allowed to answer.
   */
  async function askAi(input, prompt, provider = assistantProvider) {
    const isMock = provider?.name === 'mock';
    if (isMock && config.production === true) return { reason: AI_NOT_CONNECTED };
    if (!isMock) {
      const budget = aiBudget.consume({ kind: 'grade' });
      if (!budget.allowed) return { reason: AI_LIMIT_REACHED };
    }
    const t0 = nowMs();
    try {
      const category = mapCategory(input.service, store.getCategories()) || '';
      const res = await withTimeout(provider.ask({
        prompt,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
        category,
        businessName: input.name,
        consumeExtra: () => (isMock ? true : aiBudget.consume({ kind: 'grade' }).allowed === true),
      }), AI_TIMEOUT_MS, 'ai timeout');
      const answer = cutCodePoints(res.answer, MAX_ANSWER_CODE_POINTS);
      // Read the whole answer for names (bounded), so a business named late is not missed; store the capped one.
      const analysis = analyzeAnswer(cutCodePoints(res.answer, MAX_ANALYZED_CODE_POINTS), input);
      return {
        entry: {
          prompt,
          provider: String(res.provider ?? provider.name ?? ''),
          model: String(res.model ?? ''),
          webSearch: res.webSearch === true,
          answer,
          named: analysis.named,
          position: analysis.position,
          total: analysis.total,
          competitors: analysis.competitors,
          ms: nowMs() - t0,
          at: nowIso(),
        },
      };
    } catch (err) {
      // A fixed code only, never the error's message: a message could carry a key, a reply or typed input.
      const code = err instanceof AssistantError ? err.code
        : err?.message === 'ai timeout' ? 'ai_timeout'
          : 'internal';
      process.stderr.write(`[grader] ai-failed code=${code}\n`);
      return { reason: AI_FAILED };
    }
  }

  const freePrompt = input => `Who are the best ${input.service} in ${input.city}, ${input.state}? Name your top 5.`;

  async function aiPart(id, grade) {
    const name = stepNames(grade.input)[3];
    const prompt = freePrompt(grade.input);
    const kept = Array.isArray(grade.ai) ? grade.ai : [];
    const toAsk = missingFor(kept, prompt);
    if (toAsk.length === 0) {
      await addStep(id, { name, state: 'done', ms: 0, finding: 'Used the answer AI gave us for this same question earlier this week.' });
      return { ai: kept, reason: undefined };
    }
    let reason;
    let ai = kept;
    await timed(id, name, async () => {
      // The main assistant and any second opinions are asked at the same time.
      const results = await Promise.all(toAsk.map(p => (p === assistantProvider
        ? askAi(grade.input, prompt)
        : askExtra(grade.input, prompt, p))));
      const fresh = results.map(r => r.entry).filter(Boolean);
      // This question's answers first (main assistant first), then anything else carried over.
      const mine = [...kept.filter(a => a.prompt === prompt), ...fresh];
      const order = [assistantProvider, ...extras].map(p => p?.name);
      mine.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
      ai = [...mine, ...kept.filter(a => a.prompt !== prompt)];
      if (mine.length > 0) {
        if (mine.some(a => a.named)) return { finding: 'AI named your business.' };
        const n = Math.max(...mine.map(a => a.competitors.length));
        if (n === 0) return { finding: 'AI did not name your business.' };
        return { finding: `AI named ${n} other ${n === 1 ? 'business' : 'businesses'}, not yours.` };
      }
      reason = results[0]?.reason;
      return { finding: reason, state: 'failed' };
    });
    return { ai, reason };
  }

  // ---- run -----------------------------------------------------------------

  async function doRun(id) {
    const list = await grades().read();
    const grade = Array.isArray(list) ? list.find(g => g && g.id === id) : undefined;
    if (!grade || grade.status !== 'running') return;
    const { input } = grade;
    live.set(id, { status: 'running', steps: [] });

    const [site, ai] = await Promise.all([
      withTimeout(websitePart(id, input), WEBSITE_BUDGET_MS, 'website budget')
        .catch(() => ({ facts: null, robots: null, llms: null, failure: FETCH_FAILURES.timeout })),
      aiPart(id, grade),
    ]);

    const results = [
      ...runWebsiteChecks({ facts: site.facts, robots: site.robots, llms: site.llms, input, failure: site.failure }),
      aiNamedResult(ai.ai, ai.reason),
    ];
    // (The ai-bots-allowed result carries `blocked`, the crawler names the Fix_Kit needs.)
    let facts = null;
    await timed(id, stepNames(input)[4], async () => {
      facts = summarizeFacts(site.facts, input);
      return { finding: facts ? 'Drafted your free listing from what we found.' : 'Drafted your free listing from what you typed.' };
    });

    const score = scoreGrade(results);
    await updateGrade(id, g => {
      g.status = 'done';
      g.finishedAt = nowIso();
      g.facts = facts;
      g.results = results;
      g.ai = ai.ai;
      g.score = score;
    });
    logId(id, `done checks=${score.counted} failed=${score.failed}`);
  }

  /** Runs the Grade once; a second call for the same id gets the same promise. */
  function run(id) {
    if (runs.has(id)) return runs.get(id);
    const p = doRun(id)
      .catch(async () => {
        logId(id, 'run failed');
        try {
          await updateGrade(id, g => { if (g.status === 'running') { g.status = 'failed'; g.finishedAt = nowIso(); } });
        } catch {
          // nothing more to do
        }
      })
      .finally(() => {
        runs.delete(id);
        live.delete(id);
      });
    runs.set(id, p);
    return p;
  }

  // ---- public API ------------------------------------------------------------

  /** An earlier `done` Grade (last 7 days, same key) whose AI answers can be copied. */
  async function findReusableAi(key) {
    const list = await grades().read();
    if (!Array.isArray(list)) return [];
    const cutoff = nowMs() - REUSE_WINDOW_MS;
    const match = list
      .filter(g => g && g.status === 'done' && g.key === key && Array.isArray(g.ai) && g.ai.length > 0
        && Date.parse(g.createdAt) >= cutoff)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    // Copy only the AI entries: never the unlock state, Lead or Draft.
    return match ? match.ai.map(a => ({ ...structuredClone(a), reusedFrom: a.at })) : [];
  }

  /**
   * Store a new Grade and schedule its run. Returns the Grade_Id.
   * @param {{ name: string, city: string, state: string, service: string, website: string|null }} rawInput
   */
  async function start(rawInput) {
    const input = {
      name: String(rawInput.name).trim(),
      city: String(rawInput.city).trim(),
      state: String(rawInput.state).trim().toUpperCase(),
      service: String(rawInput.service).trim(),
      website: rawInput.website ? String(rawInput.website) : null,
    };
    const id = newId();
    const key = reuseKey(input);
    const ai = await findReusableAi(key);
    const grade = {
      id,
      status: 'running',
      input,
      key,
      createdAt: nowIso(),
      finishedAt: null,
      steps: [],
      facts: null,
      results: [],
      ai,
      score: null,
      previousScore: null,
      draftId: null,
      recheckedAt: null,
    };
    await grades().append(grade);
    live.set(id, { status: 'running', steps: [] });
    if (typeof store.pruneExpired === 'function') {
      store.pruneExpired({ quotes: false, drafts: false, grades: true, leads: true })
        .catch(() => logId(id, 'prune failed'));
    }
    queueMicrotask(() => { run(id).catch(() => logId(id, 'run failed')); });
    return id;
  }

  /** True when a Grade has been `running` for more than 4 minutes. */
  function isStale(grade, now = nowMs()) {
    if (!grade || grade.status !== 'running') return false;
    const created = Date.parse(grade.createdAt);
    return Number.isNaN(created) ? false : now - created > STALE_AFTER_MS;
  }

  /** A stored Grade, with a stale `running` Grade read as `failed`. Undefined when unknown. */
  async function get(id) {
    const list = await grades().read();
    const grade = Array.isArray(list) ? list.find(g => g && g.id === id) : undefined;
    if (!grade) return undefined;
    return isStale(grade) ? { ...grade, status: 'failed' } : grade;
  }

  /** { status, steps, done } for status.json; running Grades are answered from memory. */
  async function statusOf(id) {
    const mem = live.get(id);
    if (mem) return { status: 'running', steps: mem.steps.map(s => ({ ...s })), done: false };
    const grade = await get(id);
    if (!grade) return undefined;
    return { status: grade.status, steps: grade.steps, done: grade.status !== 'running' };
  }

  // ---- extra AI questions, unlock, claim, recheck --------------------------------

  /** Replace the ai-named result from the stored AI answers and recompute the Score. */
  function applyAiResults(g) {
    const i = g.results.findIndex(r => r.id === 'ai-named');
    const prev = i >= 0 ? g.results[i] : undefined;
    const next = aiNamedResult(g.ai, prev?.result === 'not_checked' ? prev.detail : undefined);
    if (i >= 0) g.results[i] = next;
    else g.results.push(next);
    g.score = scoreGrade(g.results);
  }

  const extraPrompts = input => [
    `I need ${input.service} in ${input.city}, ${input.state}. Which companies would you recommend?`,
    `Which ${input.service} in ${input.city}, ${input.state} do people say are the most reliable?`,
  ];

  async function runExtraQuestions(id) {
    // Mark first, so repeated views can never start the questions twice.
    let claimed = false;
    await updateGrade(id, g => {
      if (g.status === 'done' && !g.extraAiStartedAt) {
        g.extraAiStartedAt = nowIso();
        claimed = true;
      }
    });
    if (!claimed) return;
    const grade = await get(id);
    for (const prompt of extraPrompts(grade.input)) {
      const current = await get(id);
      const toAsk = missingFor(current?.ai, prompt);
      if (toAsk.length === 0) continue;
      const results = await Promise.all(toAsk.map(p => (p === assistantProvider
        ? askAi(grade.input, prompt)
        : askExtra(grade.input, prompt, p))));
      const entries = results.map(r => r.entry).filter(Boolean);
      if (entries.length > 0) {
        await updateGrade(id, g => {
          g.ai.push(...entries);
          applyAiResults(g);
        });
      }
      // Budget used up or the main assistant failed: keep what we have.
      if (toAsk[0] === assistantProvider && !results[0].entry) break;
    }
  }

  /** Start the two extra AI questions in the background (once per Grade). */
  function startExtraQuestions(id) {
    runExtraQuestions(id).catch(() => logId(id, 'extra questions failed'));
  }

  /**
   * Store a Lead, start the extra questions and tell the site owner.
   * @param {{ name: string, email: string, phone: string, okToContact: boolean }} lead
   */
  async function unlock(id, lead) {
    const grade = await get(id);
    if (!grade || grade.status !== 'done') return { status: 409 };
    await store.collection('leads').append({
      id: randomUUID(),
      gradeId: id,
      business: grade.input.name,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      okToContact: lead.okToContact === true,
      score: grade.score?.score ?? null,
      createdAt: nowIso(),
    });
    startExtraQuestions(id);
    if (typeof notifier?.notifyLead === 'function') {
      try {
        withTimeout(Promise.resolve(notifier.notifyLead({
          business: grade.input.name,
          score: grade.score?.score ?? null,
          reportUrl: `${config.baseUrl ?? ''}/grade/${id}`,
          lead: { name: lead.name, email: lead.email, phone: lead.phone, okToContact: lead.okToContact === true },
        })), 10000, 'notice timeout').catch(() => logId(id, 'lead notice failed'));
      } catch {
        logId(id, 'lead notice failed');
      }
    }
    return { status: 200 };
  }

  /** Create a Draft from what the scan found. It is not published: the owner and an admin still review it. */
  async function claim(id) {
    const grade = await get(id);
    if (!grade || grade.status !== 'done') return { status: 404 };
    const found = foundFromGrade(grade);
    const categories = store.getCategories();
    const checked = validateFields({
      name: found.name,
      category: mapCategory(found.service, categories) || 'other',
      phone: found.phone,
      services: [found.service],
      serviceArea: found.city,
      city: found.city,
      state: found.state,
      address: found.address,
      hours: hoursToObject(found.hours),
    }, categories);
    const created = await draftStore.create({
      fields: checked.fields, missingFields: checked.missingFields, provider: 'grader',
    });
    await updateGrade(id, g => { if (!g.draftId) g.draftId = created.draft.id; });
    return { status: 201, draft: created.draft };
  }

  /** True when a Draft still exists (so a returning browser can be sent back to it). */
  async function draftExists(draftId) {
    const found = await draftStore.get(draftId);
    return found.status === 200;
  }

  const isRechecking = g => g?.recheckRunning === true
    && nowMs() - Date.parse(g.recheckStartedAt) <= STALE_AFTER_MS;

  async function runRecheck(id) {
    try {
      const grade = await get(id);
      const site = await withTimeout(websitePart(id, grade.input, false), WEBSITE_BUDGET_MS, 'website budget')
        .catch(() => ({ facts: null, robots: null, llms: null, failure: FETCH_FAILURES.timeout }));
      const websiteResults = runWebsiteChecks({
        facts: site.facts, robots: site.robots, llms: site.llms, input: grade.input, failure: site.failure,
      });
      // The site could not be read this time: keep the earlier results instead of wiping them.
      if (grade.input.website && !site.facts) {
        await updateGrade(id, g => {
          g.recheckFailedAt = nowIso();
          g.recheckRunning = false;
        });
        return;
      }
      const facts = summarizeFacts(site.facts, grade.input);
      await updateGrade(id, g => {
        delete g.recheckFailedAt;
        const ai = g.results.find(r => r.id === 'ai-named');
        g.previousScore = g.score?.score ?? null;
        g.results = [...websiteResults, ...(ai ? [ai] : [])];
        g.facts = facts ?? g.facts;
        g.score = scoreGrade(g.results);
        g.recheckedAt = nowIso();
        g.recheckRunning = false;
      });
    } catch {
      await updateGrade(id, g => { g.recheckRunning = false; }).catch(() => {});
      throw new Error('recheck failed');
    }
  }

  /**
   * Run the website checks again (no AI question). It never sets the Grade back to
   * `running`; it uses its own recheckRunning flag. Returns false when one is already running.
   */
  async function recheck(id) {
    let started = false;
    await updateGrade(id, g => {
      if (g.status === 'done' && !isRechecking(g)) {
        g.recheckRunning = true;
        g.recheckStartedAt = nowIso();
        started = true;
      }
    });
    if (!started) return false;
    runRecheck(id).catch(() => logId(id, 'recheck failed'));
    return true;
  }

  return {
    start, run, get, statusOf, isStale, findReusableAi, askAi, updateGrade, grades, notifier,
    startExtraQuestions, unlock, claim, draftExists, recheck, isRechecking,
  };
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** "mo" / "mon" / "monday" to "monday"; anything else to undefined. */
function dayName(word) {
  const w = word.trim().toLowerCase();
  if (w.length < 2) return undefined;
  return DAY_NAMES.find(n => n.startsWith(w));
}

/**
 * Found hours strings ("Mo-Fr 08:00-17:00", "Monday, Tuesday 07:00-18:00") to
 * { monday: '08:00-17:00', ... }. Strings it cannot read are left out.
 * @param {string[]} hours
 * @returns {Record<string, string>}
 */
export function hoursToObject(hours) {
  const out = {};
  for (const raw of Array.isArray(hours) ? hours : []) {
    const text = String(raw).slice(0, 200);
    const m = /^\s*([A-Za-z][A-Za-z ,-]*?)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i.exec(text);
    if (!m) continue;
    const days = [];
    for (const token of m[1].split(',')) {
      const [a, b] = token.split('-').map(dayName);
      if (a && b) {
        const from = DAY_NAMES.indexOf(a);
        const to = DAY_NAMES.indexOf(b);
        for (let i = from; i <= to; i += 1) days.push(DAY_NAMES[i]);
      } else if (a && token.split('-').length === 1) {
        days.push(a);
      }
    }
    for (const day of days) if (!Object.hasOwn(out, day)) out[day] = m[2].trim();
  }
  return out;
}
