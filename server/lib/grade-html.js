/**
 * grade-html.js — every page of the AI Visibility Grader.
 *
 * Pure functions: a Grade (and a few options) go in, an HTML string comes out.
 * Every typed value, every AI answer and every line read from a business website
 * goes through escapeHtml. The only raw HTML that is ever inserted is Google's own
 * Search Suggestions markup on the live-answer page, shown exactly as Google sent
 * it under a script-blocking policy.
 *
 * Wording: plain words, American spelling, no dollar figures, and nothing that says
 * or implies a listing, a fix or a score change will make an AI assistant name a
 * business. Changes are picked up over days to weeks.
 */

import { layout, escapeHtml as h } from './html.js';
import { CHECKS, GROUPS, checkById } from './grade-checks.js';
import {
  suggestedTitle, suggestedSummary, jsonLdBlock, llmsDraft, robotsLines,
} from './fix-kit.js';
import { formatRunTime } from './seance-html.js';
import { listedNames, splitLists } from './name-match.js';
import { scoreGrade } from './grade-score.js';
import { DEFAULT_SITE_NAME } from './config.js';
import {
  providerLabel, freeQuestion, stepNames, foundOf, isSecondOpinion, schemaHours, readableHours, isPartialScore,
  HOME_UNREADABLE, WEBSITE_UNREACHED, freeAnswersOf, scoredResults, AI_LIMIT_REACHED,
} from './grader.js';

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const REFRESH_NOSCRIPT = '<noscript><meta http-equiv="refresh" content="3"></noscript>';

// The human check (Cloudflare Turnstile). Shown only when the site key is set.
const TURNSTILE_SCRIPT = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';

function turnstileBlock(siteKey, message = '') {
  // A "couldn't confirm" message sits right above the widget, where the visitor is looking.
  return `${message ? `<p class="form-error" role="alert">${h(message)}</p>\n    ` : ''}<div class="cf-turnstile" data-sitekey="${h(siteKey)}"></div>
    <noscript><p class="hint">Turn on JavaScript to confirm you're a person.</p></noscript>`;
}

/**
 * The page shell for every /grade page. `indexable` (only the plain first render of the form and of the about
 * page) leaves out the robots meta tag and adds the canonical link and the description; every other page keeps
 * `noindex, nofollow`.
 */
function page(title, body, {
  refresh = false, turnstile = false, indexable = false, canonical = '', description = '',
} = {}) {
  const open = indexable === true;
  const parts = [open ? '' : ROBOTS_META, refresh ? REFRESH_NOSCRIPT : '', turnstile ? TURNSTILE_SCRIPT : ''].filter(Boolean);
  return layout({
    title,
    body,
    scripts: ['/js/grade.js'],
    head: parts.join('\n  '),
    ...(open ? { canonical, description } : {}),
  });
}

/** Title and summary of the check's form when it is shown to search engines (wording rules apply). */
// The page shell adds no site-name suffix to a title, so the suffix is written here once.
export const FORM_SEARCH_TITLE = `Can AI find your local business? Free AI Visibility Check | ${DEFAULT_SITE_NAME}`;
export const FORM_SEARCH_DESCRIPTION = 'See whether AI assistants name your local business when someone asks for one like it, and get a score with plain fixes. Free. No account needed.';
/** Summary of the about page when it is shown to search engines. */
export const ABOUT_SEARCH_DESCRIPTION = "What the free AI Visibility Check reads on a business's website and asks AI assistants, and why.";

// ---- small helpers ---------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
}

/** "a", "a and b", "a, b and c" */
function joinAnd(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The assistant's name in the middle of a sentence. */
const inline = provider => (provider === 'mock' ? 'the demo assistant' : providerLabel(provider));

/** An assistant's label inside a sentence: "The demo assistant" becomes "the demo assistant". */
const midSentence = label => (label === providerLabel('mock') ? 'the demo assistant' : label);

const blank = text => `<span class="blank">${h(text)}</span>`;

function hostOf(website) {
  try {
    return new URL(website).hostname;
  } catch {
    return '';
  }
}

function contactLink(contactEmail, text) {
  return contactEmail
    ? `<a href="mailto:${h(contactEmail)}">${h(text)}</a>`
    : `<a href="/about">${h(text)}</a>`;
}

// Entries that are not objects with a string id (a hand-edited grades.json) are left out, so the report is
// never a 500 because of them.
const resultsOf = grade => (Array.isArray(grade?.results)
  ? grade.results.filter(r => r !== null && typeof r === 'object' && typeof r.id === 'string')
  : []);
// An entry that is not an object (a hand-edited grades.json) is left out, so a null in `ai` never crashes the page (V163).
const aiOf = grade => (Array.isArray(grade.ai) ? grade.ai.filter(a => a && typeof a === 'object' && !Array.isArray(a)) : []);

/**
 * True when the daily limit is why the AI part did not run: the stored state says so, or (a Grade saved by the old
 * rescue line, which overwrote the state) the AI step's stored note does (V161).
 */
function dailyLimitHit(grade) {
  if (grade.aiMain?.state === 'limit') return true;
  // The step is found by what it says, not by its name: only the AI step writes this finding, and a Grade saved
  // before the question was reworded names that step with the service as it was typed (V164).
  return (Array.isArray(grade.steps) ? grade.steps : []).some(s => s && s.finding === AI_LIMIT_REACHED);
}

// ---- the form ------------------------------------------------------------------------

function field({ id, name, label, value, hint, error, attrs = '' }) {
  return `<div class="field${error ? ' missing' : ''}">
    <label for="${id}">${label}</label>
    <input type="text" id="${id}" name="${name}" value="${h(value ?? '')}"${error ? ` aria-invalid="true" aria-describedby="${id}-err"` : ''}${attrs}>
    ${hint && !error ? `<span class="hint">${hint}</span>` : ''}
    ${error ? `<span class="missing-note" id="${id}-err" role="alert">${h(error)}</span>` : ''}
  </div>`;
}

/**
 * @param {{ values?: object, errors?: object, stamp?: string, categories?: object[] }} [opts]
 */
export function gradeFormPage({
  values = {}, errors = {}, stamp = '', categories = [], turnstileSiteKey = '', indexable = false, canonical = '',
} = {}) {
  // Only the plain first render is shown to search engines; a form shown again with errors never is.
  const open = indexable === true && Object.keys(errors).length === 0;
  const checkOn = typeof turnstileSiteKey === 'string' && turnstileSiteKey !== '';
  const options = (Array.isArray(categories) ? categories : [])
    .filter(c => c && c.slug !== 'other' && typeof c.label === 'string' && c.label !== '')
    .map(c => `<option value="${h(c.label)}"></option>`)
    .join('');
  const body = `<section class="grade-start">
  <h1>Can AI find your business?</h1>
  <p class="tagline">Get a free check in about two minutes. We ask AI assistants to name the best businesses like yours in your city, and see if they name you. We also look at what AI can read on your website.</p>
  ${errors.form ? `<p class="form-error" role="alert">${h(errors.form)}</p>` : ''}
  ${['name', 'city', 'state', 'service', 'website'].some(k => errors[k]) ? '<p class="form-error" role="alert">Please fix the problems below.</p>' : ''}
  <form class="rise-form" method="POST" action="/grade">
    ${field({ id: 'g-name', name: 'name', label: 'Business name', value: values.name, error: errors.name, attrs: ' autocomplete="organization"' })}
    ${field({ id: 'g-city', name: 'city', label: 'City', value: values.city, error: errors.city, attrs: ' autocomplete="address-level2"' })}
    ${field({ id: 'g-state', name: 'state', label: 'State', value: values.state, hint: '2 letters, like TN', error: errors.state, attrs: ' autocomplete="address-level1"' })}
    ${field({ id: 'g-service', name: 'service', label: 'What you do', value: values.service, hint: 'Like roofers, plumbers or restaurants', error: errors.service, attrs: ' list="service-suggestions"' })}
    <datalist id="service-suggestions">${options}</datalist>
    ${field({ id: 'g-website', name: 'website', label: 'Your website (optional)', value: values.website, hint: 'Like example.com. Leave it empty if you do not have one.', error: errors.website, attrs: ' inputmode="url" autocapitalize="none"' })}
    <div class="field">
      <label class="check" for="g-nostorefront"><input type="checkbox" id="g-nostorefront" name="noStorefront" value="1"${values.noStorefront === true ? ' checked' : ''}> We go to our customers (no storefront)</label>
      <span class="hint">${h("Check this box if you go to your customers and don't show a street address.")}</span>
    </div>
    <p class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="nickname" value="" tabindex="-1" autocomplete="off"></label></p>
    <input type="hidden" name="t" value="${h(stamp)}">
    ${checkOn ? `${turnstileBlock(turnstileSiteKey, errors.humanCheck)}\n    ` : ''}<button type="submit" class="button">Check my business</button>
  </form>
  <p class="hint"><a href="/grade/about">What do we read, and why?</a></p>
</section>`;
  return open
    ? page(FORM_SEARCH_TITLE, body, { turnstile: checkOn, indexable: true, canonical, description: FORM_SEARCH_DESCRIPTION })
    : page('Can AI find your business?', body, { turnstile: checkOn });
}

// ---- the scan -------------------------------------------------------------------------

/** The page shown while a Grade runs. */
export function scanPage(grade) {
  const names = stepNames(grade.input);
  const done = new Map((Array.isArray(grade.steps) ? grade.steps : []).map(s => [s.name, s]));
  const firstOpen = names.findIndex(n => !done.has(n));
  // A check waiting behind the limit on running checks shows one extra first step and nothing else working.
  const inLine = grade.queued === true;
  const items = names.map((name, i) => {
    const step = done.get(name);
    let cls = 'waiting';
    let mark = 'Waiting';
    if (step) {
      cls = step.state === 'skipped' ? 'done skipped' : step.state === 'failed' ? 'done failed' : 'done';
      mark = step.state === 'skipped' ? 'Skipped' : step.state === 'failed' ? 'Problem' : 'Done';
    } else if (!inLine && (i === firstOpen || (i === 3 && firstOpen !== 4))) {
      cls = 'running';
      mark = 'Working';
    }
    return `<li class="grade-step ${cls}"><span class="step-mark">${mark}</span><span class="step-name">${h(name)}</span>${step?.finding ? `<span class="finding">${h(step.finding)}</span>` : ''}</li>`;
  });
  if (inLine) {
    items.unshift('<li class="grade-step running grade-step-line"><span class="step-mark">Working</span><span class="step-name">You\'re in line. Your check starts in a moment.</span></li>');
  }
  const itemsHtml = items.join('\n    ');
  const body = `<section class="grade-scan" data-grade-scan data-status-url="/grade/${h(grade.id)}/status.json">
  <h1>Checking ${h(grade.input.name)}</h1>
  <p class="tagline">This takes about two minutes. You can leave this page open.</p>
  <ol class="grade-steps">
    ${itemsHtml}
  </ol>
</section>`;
  return page(`Checking ${grade.input.name}`, body, { refresh: true });
}

/** The page for a Grade that did not finish. `stamp` lets "Start again" post the same details. */
export function failedPage(grade, { stamp = '', turnstileSiteKey = '' } = {}) {
  const checkOn = typeof turnstileSiteKey === 'string' && turnstileSiteKey !== '';
  const i = grade.input ?? {};
  const fields = ['name', 'city', 'state', 'service', 'website']
    .map(k => `<input type="hidden" name="${k}" value="${h(i[k] ?? '')}">`);
  // "Start again" keeps the no-storefront mode.
  if (i.noStorefront === true) fields.push('<input type="hidden" name="noStorefront" value="1">');
  const hidden = fields.join('\n    ');
  const body = `<section class="message">
  <h1>This check didn't finish</h1>
  <p>Something took longer than expected, so we stopped. Nothing was lost. You can start again with the same details.</p>
  <form method="POST" action="/grade">
    ${hidden}
    <input type="hidden" name="t" value="${h(stamp)}">
    ${checkOn ? `${turnstileBlock(turnstileSiteKey)}\n    ` : ''}<button type="submit" class="button">Start again</button>
  </form>
  <p><a href="/grade">Change the details</a></p>
</section>`;
  return page("This check didn't finish", body, { turnstile: checkOn });
}

// ---- pieces of the report ---------------------------------------------------------------

/**
 * Why the home page of a Grade with a website was not read, from the stored steps: the finding of the step that
 * failed ("We couldn't read your home page.", "We couldn't reach your website.", "Your website took too long to
 * answer."), or null when both steps ran or there was no website. A hand-built Grade with no steps gives null.
 */
function homeReadProblem(grade) {
  if (!grade?.input?.website) return null;
  try {
    const names = stepNames(grade.input);
    const steps = Array.isArray(grade.steps) ? grade.steps : [];
    const first = steps.find(s => s && s.name === names[0]);
    if (first?.state === 'failed') return typeof first.finding === 'string' ? first.finding : HOME_UNREADABLE;
    const second = steps.find(s => s && s.name === names[1]);
    if (second?.state === 'failed') return typeof second.finding === 'string' ? second.finding : HOME_UNREADABLE;
  } catch {
    return null;
  }
  return null;
}

/** Why the AI part of a partial score was left out, as the start of a sentence ending "so". */
function partialReason(grade) {
  const state = grade.aiMain?.state;
  if (dailyLimitHit(grade)) return "the daily limit for AI checks was reached, so";
  if (state === 'not_connected' || state === 'off') return "the AI check isn't connected yet, so";
  return `${midSentence(grade.aiMain?.label ?? 'The assistant')} didn't answer this time, so`;
}

/**
 * The main ranked list of a named answer, read from the answer text, with the business in it, and the names
 * from separate later lists ("Other names to check:"). Null when the business cannot be found in the text
 * (an empty or cut answer, or a spelling only the second look matched): the stored numbers are used then.
 * The count and the numbered rows come from this one list. When the second look dropped some names, only
 * the names it kept (and the business) are shown.
 */
function mainList(a, input) {
  if (!a.named || !Number.isInteger(a.position)) return null;
  try {
    const { main, also } = splitLists(String(a.answer ?? ''), {
      name: input?.name, city: input?.city, state: input?.state, service: input?.service, website: input?.website,
    });
    const at = main.findIndex(e => e.own);
    if (at === -1) return null;
    const kept = a.nameCheck?.dropped > 0 ? new Set(Array.isArray(a.competitors) ? a.competitors : []) : null;
    const ok = e => !kept || kept.has(e.name ?? e);
    const rows = main.filter(e => e.own || ok(e));
    return { rows, position: rows.findIndex(e => e.own) + 1, also: also.filter(n => ok(n)) };
  } catch {
    return null;
  }
}

/** One sentence about what an answer did with the business. */
function outcome(a, input) {
  if (a.named) {
    if (Number.isInteger(a.position) && Number.isInteger(a.total) && a.total > 0) {
      const tail = a.nameCheck?.addedNamed
        ? ', but it was spelled a little differently from how you wrote it. We still counted it.'
        : '.';
      const lists = mainList(a, input);
      const total = lists ? lists.rows.length : a.total;
      const position = lists ? lists.position : a.position;
      return `It listed ${plural(total, 'business', 'businesses')}, and yours was ${ordinal(position)}${tail}`;
    }
    return 'It named your business in its answer.';
  }
  const n = Array.isArray(a.competitors) ? a.competitors.length : 0;
  if (n > 0) return `It named ${n === 1 ? 'this 1 business' : `these ${n} businesses`}, not yours.`;
  return 'It did not name your business.';
}

function whenText(iso) {
  return formatRunTime(iso);
}

/**
 * An AI answer as plain reading text, for display only. Simple formatting is removed: bold and
 * emphasis marks, link markup (the link text stays), heading marks and citation marks. Bullets
 * become "• "; numbered lines and line breaks stay. The stored answer is never changed. The
 * result is still plain text and is escaped before it is shown.
 */
export function readableAnswer(text) {
  let t = String(text ?? '').replace(/\r\n?/g, '\n');
  // Citation marks: [[2]](link), [1], [web:3], [1, 2]
  // Every pattern has a length cap, so a long line of broken markup cannot make it slow.
  t = t.replace(/[ \t]{0,20}\[\[\s{0,5}(?:web:)?\d{1,4}\s{0,5}\]\]\([^)\n]{0,2000}\)/g, '');
  t = t.replace(/[ \t]{0,20}\[\s{0,5}(?:web:)?\d{1,4}(?:\s{0,5}[,;-]\s{0,5}(?:web:)?\d{1,4}){0,10}\s{0,5}\](?!\()/g, '');
  // Links: [name](link) becomes name
  t = t.replace(/\[([^\]\n]{1,200})\]\([^)\n]{0,2000}\)/g, '$1');
  // Heading marks at the start of a line
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  // Bullets
  t = t.replace(/^([ \t]{0,50})[-*\u2022][ \t]+/gm, '$1\u2022 ');
  // Emphasis
  t = t.replace(/\*\*([^\n]{1,300}?)\*\*/g, '$1');
  t = t.replace(/__([^\n]{1,300}?)__/g, '$1');
  t = t.replace(/\*(?=\S)([^*\n]{1,300}?)\*/g, '$1');
  t = t.replace(/(^|[^\w])_(?=\S)([^_\n]{1,300}?)_(?![\w])/g, '$1$2');
  return t;
}

function answerBlock(a) {
  return `${a.provider === 'mock' ? '<p class="hint">Demo answer (no AI connected)</p>\n  ' : ''}<details><summary>See the full answer</summary><blockquote class="grade-answer seance-answer">${h(readableAnswer(a.answer ?? ''))}</blockquote></details>`;
}

/** The business's name as the AI wrote it in the answer, or the name the owner typed. */
function nameAsWritten(a, input) {
  const typed = String(input?.name ?? '');
  try {
    const listed = listedNames(String(a.answer ?? ''), input);
    const mine = listed[a.position - 1];
    if (mine && mine.own && mine.name) return mine.name;
    const any = listed.find(e => e.own);
    if (any && any.name) return any.name;
  } catch {
    // fall back to the typed name
  }
  return typed;
}

/**
 * The businesses an answer listed. With a position: every name in the AI's order, numbered as the AI
 * ranked them, with the business in its place. Without one: a plain list with no numbers.
 */
function competitorList(a, input) {
  const list = Array.isArray(a.competitors) ? a.competitors : [];
  // The numbered rows are the main list only, as the AI ranked it; names from a later list are listed plainly below.
  const lists = mainList(a, input);
  if (lists) {
    const rows = lists.rows.map(e => (e.own
      ? `<li class="grade-you"><strong>${h(e.name)}</strong> (you)</li>`
      : `<li>${h(e.name)}</li>`));
    const also = lists.also.length > 0
      ? `<p class="grade-others-heading">Also mentioned:</p><ul class="grade-competitors grade-competitors-plain">${lists.also.slice(0, 5).map(n => `<li>${h(n)}</li>`).join('')}</ul>`
      : '';
    return `<ol class="grade-competitors">${rows.join('')}</ol>${also}`;
  }
  if (a.named && Number.isInteger(a.position) && a.position >= 1 && a.position - 1 <= list.length) {
    const items = list.map(n => `<li>${h(n)}</li>`);
    items.splice(a.position - 1, 0, `<li class="grade-you"><strong>${h(nameAsWritten(a, input))}</strong> (you)</li>`);
    return `<ol class="grade-competitors">${items.join('')}</ol>`;
  }
  if (list.length === 0) return '';
  return `<p class="grade-others-heading">Other businesses it named:</p><ul class="grade-competitors grade-competitors-plain">${list.map(n => `<li>${h(n)}</li>`).join('')}</ul>`;
}

const JUST_ASKED_MS = 10 * 60 * 1000;

/** "We just asked Claude." for a fresh answer; "We asked Claude on <date>." once it is older or was carried over. */
function askedLine(entry, now, label) {
  const old = Boolean(entry.reusedFrom)
    || (Number.isFinite(now) && Number.isFinite(Date.parse(entry.at)) && now - Date.parse(entry.at) > JUST_ASKED_MS);
  return old
    ? `We asked ${label} on ${h(whenText(entry.reusedFrom || entry.at))}.`
    : `We just asked ${label}.`;
}

/** "1 time", "3 times". */
const timesText = n => `${n} ${n === 1 ? 'time' : 'times'}`;

/**
 * How many times the main assistant was asked one question: the answers that came back, or more when a higher
 * ask number shows an earlier ask failed ("We just asked Claude 3 times" with answers 2 and 3 back).
 */
function timesAsked(answers) {
  // Only ask numbers 1 to 3 count; a hand-edited 99, 0, -1, 2.5 or "3" is ignored (V106).
  const validAsk = a => (Number.isInteger(a.ask) && a.ask >= 1 && a.ask <= 3 ? a.ask : 0);
  const highest = Math.max(0, ...answers.map(validAsk));
  return Math.max(answers.length, highest);
}

/**
 * The free part when the main assistant answered the free question more than once (Feature E): the lead line,
 * the ranked list and outcome from the shown answer (the first that named the business, else the first), with
 * "From answer 1 of 3", and one closed block holding every answer. Everything is escaped.
 */
function severalAnswers(answers, input, now, cut = null) {
  const firstAnswer = answers[0];
  const label = inline(firstAnswer.provider);
  const subject = providerLabel(firstAnswer.provider);
  const total = answers.length;
  const named = answers.filter(a => a.named).length;
  const n = timesAsked(answers);
  const times = timesText(n);
  // Fewer answers than asks: say how many came back, and count against those (V100).
  const short = total < n;
  const got = short ? ` and got ${total} answers` : '';
  // Fresh answers say "just"; carried-over or older ones say when they were asked.
  const old = answers.some(a => a.reusedFrom)
    || (Number.isFinite(now) && Number.isFinite(Date.parse(firstAnswer.at)) && now - Date.parse(firstAnswer.at) > JUST_ASKED_MS);
  const asked = old
    ? `We asked ${h(label)} ${times} on ${h(whenText(firstAnswer.reusedFrom || firstAnswer.at))}${got}.`
    : `We just asked ${h(label)} ${times}${got}.`;
  const count = short
    ? (named === 0 ? `in none of the ${total}` : `in ${named} of the ${total}`)
    : (named === 0 ? `in none of ${total} answers` : `in ${named} of ${total} answers`);
  const shownIndex = Math.max(0, answers.findIndex(a => a.named));
  const shown = answers[shownIndex];
  // Which answer the list is from, numbered among the answers that came back (V102).
  const from = shown.named
    ? `This list is from answer ${shownIndex + 1}, the first one that named you.`
    : `This list is from answer ${shownIndex + 1}.`;
  const demo = firstAnswer.provider === 'mock' ? '<p class="hint">Demo answer (no AI connected)</p>\n  ' : '';
  const blocks = answers.map((a, i) => `<p>Answer ${i + 1}</p><blockquote class="grade-answer seance-answer">${h(readableAnswer(a.answer ?? ''))}</blockquote>`).join('');
  // Why we ask more than once (V101). When today's limit cut the asks short, the Grade stores the number
  // planned and the number asked, and the hint says both (V107); otherwise the number is the times asked.
  const limited = cut && Number.isInteger(cut.planned) && Number.isInteger(cut.asked)
    && cut.asked >= 1 && cut.asked < cut.planned && cut.planned <= 3 && cut.asked === n;
  const why = limited
    ? `AI answers change from one time to the next, so we ask the same question ${timesText(cut.planned)}. Today we could ask only ${timesText(cut.asked)} because we reached today's limit.`
    : `AI answers change from one time to the next, so we ask the same question ${times}.`;
  return [
    `<p>${asked} ${h(subject)} named your business ${count}.</p>`,
    // One paragraph under the lead line (V109).
    `<p class="hint">${why} ${from}</p>`,
    `<p>${h(outcome(shown, input))}</p>`,
    competitorList(shown, input),
    `${demo}<details><summary>${h(`See ${subject}'s answers`)}</summary>${blocks}</details>`,
  ];
}

/** The AI part of the free report. */
function aiFree(grade, { googleLive, requester, now, secondPending = [] }) {
  const all = aiOf(grade);
  const prompt = freeQuestion(grade.input);
  // The free answers are the main answers to the first main answer's own question. Nothing here compares with
  // today's wording of the question, so an older Grade asked with older wording still shows its answers.
  // An answer to one of the two extra questions is never the free answer, even when the free question failed.
  const mainAnswers = freeAnswersOf(all);
  const first = mainAnswers[0];
  const seconds = all.filter(a => isSecondOpinion(a) && (a.prompt === (first?.prompt ?? prompt)));
  const mainLabel = grade.aiMain?.label ?? (first ? providerLabel(first.provider) : 'The assistant');
  const parts = [];

  if (first && mainAnswers.length > 1) {
    parts.push(...severalAnswers(mainAnswers, grade.input, now, grade.aiMain?.asks ?? null));
  } else if (first) {
    const lead = askedLine(first, now, inline(first.provider));
    parts.push(`<p>${lead} ${h(outcome(first, grade.input))}</p>`, competitorList(first, grade.input), answerBlock(first));
  } else if (seconds.length > 0) {
    parts.push(dailyLimitHit(grade)
      ? `<p>We couldn't ask ${h(mainLabel)} this time because today's limit for AI checks was reached, so this check has no AI score.</p>`
      : `<p>${h(mainLabel)} did not answer this time, so this check has no AI score.</p>`);
  } else {
    if (dailyLimitHit(grade)) {
      parts.push("<p>We couldn't ask AI this time. The daily limit for AI checks was reached. You can run the check again tomorrow.</p>");
    } else if (grade.aiMain?.state === 'not_connected') {
      parts.push("<p>We couldn't ask AI this time. The AI check is not connected yet.</p>");
    } else {
      // One short sentence naming the assistant, not three that repeat each other (V140).
      parts.push(`<p>${h(mainLabel)} didn't answer this time. Please run the check again later.</p>`);
    }
  }

  if (seconds.length > 0) {
    if (first) {
      parts.push('<h3>Other AI assistants, for comparison only (not scored):</h3>');
      for (const s of seconds) {
        parts.push(`<p>${h(providerLabel(s.provider))}, asked the same question: ${h(outcome(s, grade.input))}</p>`);
        if (s.provider === 'gemini' && s.webSearch !== true) parts.push('<p class="hint">Gemini answered without a live web search.</p>');
        parts.push(competitorList(s, grade.input), answerBlock(s));
      }
    } else {
      parts.push('<p class="hint">These answers are for comparison only (not scored).</p>');
      for (const s of seconds) {
        parts.push(`<p>${askedLine(s, now, h(providerLabel(s.provider)))} ${h(outcome(s, grade.input))}</p>`);
        if (s.provider === 'gemini' && s.webSearch !== true) parts.push('<p class="hint">Gemini answered without a live web search.</p>');
        parts.push(competitorList(s, grade.input), answerBlock(s));
      }
    }
  }

  // A second opinion that ran out of its 45 seconds is said so; the report never waited for it.
  const askedPrompt = first?.prompt ?? prompt;
  const missed = (Array.isArray(grade.secondMissed) ? grade.secondMissed : []).filter(m => m && m.prompt === askedPrompt);
  for (const m of missed) parts.push(`<p class="hint">${h(providerLabel(m.provider))} didn't answer in time.</p>`);
  // The script (and the no-script refresh) reloads the page while this note shows; it goes away when they arrive.
  const waitingOn = [...new Set(secondPending.map(providerLabel))];
  if (waitingOn.length > 0) {
    parts.push(`<p class="notice" role="status" data-grade-rechecking>${h(`${joinAnd(waitingOn)} ${waitingOn.length === 1 ? 'is' : 'are'} still answering. This page updates by itself.`)}</p>`);
  }

  const google = googleLive ? `<section class="grade-ai grade-google">
  <h2>What Google's AI says</h2>
  <p>The question we ask: ${h(prompt)}</p>
  <p class="hint">From Google's Gemini. Google doesn't review or endorse this report. Only you can see the answer. We don't save it. Your score comes from ${h(midSentence(mainLabel))}'s answers to the first question only.</p>
  ${requester
    ? `<form method="post" action="/grade/${h(grade.id)}/google-live"><button type="submit" class="button">Show Google's live answer</button></form>`
    : '<p class="hint">Google\'s live answer is private to the person who ran the check, so it is not shown here.</p>'}
</section>` : '';
  return `<section class="grade-ai">
  <h2>What AI says</h2>
  ${parts.filter(Boolean).join('\n  ')}
</section>${google ? `\n${google}` : ''}`;
}

function previewCard(grade) {
  const i = grade.input;
  const found = foundOf(grade);
  const shown = readableHours(found.hours);
  const hours = shown.length ? shown.map(x => h(x)).join('; ') : blank('Add your hours');
  return `<div class="grade-preview">
    <h3>${h(i.name)} &middot; ${found.phone ? `<span class="phone">${h(found.phone)}</span>` : blank('Add your phone number')}</h3>
    <p>${h(i.service)} in ${h(i.city)}, ${h(i.state)}</p>
    <p>Hours: ${hours}</p>
    ${i.noStorefront === true
    // A business that goes to its customers shows its area, never an address, even when the page has one.
    ? `<p>Serves the ${h(i.city)} area</p>`
    : `<p>Address: ${found.address ? h(found.address) : blank('Add your address')}</p>`}
    <p>Website: ${i.website ? h(i.website) : blank('Add your website')}</p>
  </div>`;
}

function topFails(grade) {
  // The AI answers are not something the owner can change directly, so they are never a "fix first" item.
  const check = id => checkById(id, grade.input);
  const fails = resultsOf(grade)
    .filter(r => r.result === 'fail' && r.id !== 'ai-named' && check(r.id))
    .sort((a, b) => check(b.id).points - check(a.id).points)
    .slice(0, 3);
  if (fails.length === 0) return '';
  return `<div class="grade-top-fails">
    <h2>Fix these first</h2>
    <p class="hint">Not a computer person? Send this page to whoever built your website.</p>
    <ul>${fails.map(r => `<li><strong>${h(check(r.id).label)}</strong><br>${h(check(r.id).fix)}</li>`).join('')}</ul>
  </div>`;
}

function searchPreview(grade) {
  const i = grade.input;
  if (!i.website || !grade.facts) return '';
  const byId = new Map(resultsOf(grade).map(r => [r.id, r.result]));
  const good = byId.get('title-city-service') === 'pass' && byId.get('summary') === 'pass';
  const found = foundOf(grade);
  const kit = { name: i.name, service: i.service, city: i.city, state: i.state, phone: found.phone ?? '' };
  const host = hostOf(i.website);
  const now = `<div class="serp">
      <h3>Now</h3>
      <p class="serp-title">${grade.facts.title ? h(grade.facts.title) : blank('No page title found')}</p>
      <p class="serp-url">${h(host)}</p>
      <p>${grade.facts.metaDescription ? h(grade.facts.metaDescription) : blank('No page summary found')}</p>
    </div>`;
  if (good) {
    return `<section class="grade-search">
    <h2>How you look in search</h2>
    <p>Your title and summary already look good.</p>
    <div class="grade-before-after">${now}</div>
  </section>`;
  }
  return `<section class="grade-search">
    <h2>How you look in search</h2>
    <div class="grade-before-after">
    ${now}
    <div class="serp">
      <h3>With the fixes</h3>
      <p class="serp-title">${h(suggestedTitle(kit))}</p>
      <p class="serp-url">${h(host)}</p>
      <p>${h(suggestedSummary(kit))}</p>
    </div>
    </div>
  </section>`;
}

/** The Score worked out from the stored results with the current points (see reportPage). */
function currentScore(grade) {
  const results = resultsOf(grade);
  // A Grade stored with no results at all has nothing to work out from, so it keeps its stored numbers.
  if (results.length === 0) return grade.score ?? {};
  try {
    return scoreGrade(results);
  } catch {
    return grade.score ?? {};
  }
}

function groupLines(grade, score = currentScore(grade)) {
  const results = resultsOf(grade);
  const byGroup = score?.byGroup ?? {};
  const lines = [];
  for (const g of GROUPS) {
    if (g.show === false) continue;
    const ids = new Set(CHECKS.filter(c => c.group === g.id).map(c => c.id));
    if (!results.some(r => ids.has(r.id))) continue;
    const area = byGroup[g.id];
    const text = area && Number.isFinite(area.earned) && Number.isFinite(area.available) && area.available > 0
      ? `${area.earned} of ${area.available} points`
      : 'Not checked';
    lines.push(`<li><strong>${h(g.label)}:</strong> ${h(text)}</li>`);
  }
  // One line on how the headline score relates to the points below: the same two sums the areas add up to (V135).
  const relation = Number.isInteger(score?.score) && Number.isFinite(score.earned) && Number.isFinite(score.available) && score.available > 0
    ? `\n  <p class="hint">Your score is the share of the points we could check: ${score.earned} of ${score.available}.</p>`
    : '';
  return lines.length ? `<section class="grade-areas">\n  <h2>Score by area</h2>${relation}\n  <ul class="grade-groups">${lines.join('')}</ul>\n</section>` : '';
}

function checkRow(r, input) {
  // The Grade's input picks the service-area wording for a business with no storefront.
  const c = checkById(r.id, input);
  if (!c) return '';
  let cls = r.result === 'fail' ? 'fail' : r.result === 'pass' ? 'pass' : 'not_checked';
  // "Partly" (Requirement 27): the AI check passed, but it named the business in only some answers. A display
  // label only: the stored result, the points, the score and the count of checks that need work do not change.
  // A result stored without `earned` (an older Grade) stays "Pass".
  const partly = r.id === 'ai-named' && cls === 'pass' && Number.isFinite(r.earned) && r.earned < c.points;
  if (partly) cls = 'partly';
  const word = { pass: 'Pass', partly: 'Partly', fail: 'Needs work', not_checked: 'Not checked' }[cls];
  let points = 'Not counted';
  if (cls !== 'not_checked') {
    const earned = r.id === 'ai-named' && Number.isFinite(r.earned) ? r.earned : (cls === 'pass' ? c.points : 0);
    points = `${earned} of ${c.points} points`;
  }
  // Under "Partly" a leading "Yes. " would sit oddly beside a weak result; it is left off here, never in storage (V153).
  const detail = partly ? String(r.detail ?? '').replace(/^Yes\.\s+/, '') : (r.detail ?? '');
  return `<li class="grade-check ${cls}"><span class="grade-result">${word}</span><strong>${h(c.label)}</strong><br><span class="grade-points">${points}</span><p>${h(detail)}</p>${cls === 'fail' ? `<p><strong>Fix:</strong> ${h(c.fix)}</p>` : ''}</li>`;
}

function allChecks(grade) {
  const results = resultsOf(grade);
  return GROUPS.filter(g => g.show !== false).map(g => {
    const ids = new Set(CHECKS.filter(c => c.group === g.id).map(c => c.id));
    const rows = results.filter(r => ids.has(r.id)).map(r => checkRow(r, grade.input)).join('\n    ');
    return rows ? `<section class="grade-group">
    <h2>${h(g.label)}</h2>
    <ul class="grade-checks">
    ${rows}
    </ul>
  </section>` : '';
  }).join('\n  ');
}

const QUESTIONS_NOT_ASKED = "The other questions were not asked because today's limit for AI checks was reached.";

/** The full list of answers, with how many named the business. */
function answersSection(grade, { leadGate = true } = {}) {
  const all = aiOf(grade);
  // The daily limit stopped the free question, so the other questions were not asked (V162): say so.
  const limitHit = dailyLimitHit(grade);
  if (all.length === 0) {
    return limitHit
      ? `<section class="grade-all-answers">\n  <h2>Every answer</h2>\n  <p>${QUESTIONS_NOT_ASKED}</p>\n</section>`
      : '';
  }
  const main = all.filter(a => !isSecondOpinion(a));
  const seconds = all.filter(a => isSecondOpinion(a));
  const mainLabel = grade.aiMain?.label ?? (main[0] ? providerLabel(main[0].provider) : 'The assistant');
  const lines = [];
  // The score counts the free question's answers only (Requirement 26). The main assistant's answers to the two
  // extra questions are shown, labeled, and have a line of their own.
  const free = freeAnswersOf(all);
  const counted = new Set(free);
  const otherMain = main.filter(a => !counted.has(a));
  // The count is said once, in one form whether or not there are second opinions (V104, V108).
  if (free.length > 1) {
    const namedCount = free.filter(a => a.named).length;
    // "none of its 5 answers", never "0 of its 5 answers" (V142).
    lines.push(`<p>${h(mainLabel)} named your business in ${namedCount === 0 ? 'none' : namedCount} of its ${free.length} answers.</p>`);
  }
  if (otherMain.length > 0) {
    const k = otherMain.length;
    const n = otherMain.filter(a => a.named).length;
    lines.push(k === 1
      ? `<p>On the other question, ${h(mainLabel)} ${n === 1 ? 'named' : 'did not name'} your business. It is not counted toward your score.</p>`
      : `<p>On the ${k} other questions, ${h(mainLabel)} named your business in ${n === 0 ? 'none' : n} of ${k}. They are not counted toward your score.</p>`);
  }
  // The free question got no answer, but the extra questions did (they run when it failed): say so plainly (V158).
  if (main.length > 0 && free.length === 0) {
    // When the daily limit was the reason, Claude is not blamed (V166).
    lines.push(limitHit
      ? `<p>We couldn't ask ${h(mainLabel)} the first question because today's limit for AI checks was reached, so this check has no AI score. The other answers are shown below but not counted toward your score.</p>`
      : `<p>${h(mainLabel)} did not answer the first question, so this check has no AI score. The other answers are shown below but not counted toward your score.</p>`);
  }
  if (limitHit && otherMain.length === 0) lines.push(`<p>${QUESTIONS_NOT_ASKED}</p>`);
  if (seconds.length > 0) {
    const others = [...new Set(seconds.map(s => providerLabel(s.provider)))];
    if (main.length === 0) {
      lines.push(limitHit
        ? `<p>We couldn't ask ${h(mainLabel)} because today's limit for AI checks was reached, so this check has no AI score. The answers from ${h(joinAnd(others))} are here so you can compare.</p>`
        : `<p>${h(mainLabel)} did not answer, so this check has no AI score. The answers from ${h(joinAnd(others))} are here so you can compare.</p>`);
    } else {
      // Count questions, not answers: the free question asked 3 times is still one question.
      // Every question that was asked, by anyone: ChatGPT answering all 3 means 3, even when Claude answered 2.
      const q = new Set(all.map(a => a.prompt)).size;
      // The same count as the lead line, so a failed ask still reads "asked it 3 times" in both places.
      const firstTimes = free.length > 0 ? timesAsked(free) : 1;
      const askedMore = firstTimes > 1
        ? ` ${h(mainLabel)} was asked ${q === 1 ? 'it' : 'the first one'} ${timesText(firstTimes)}.`
        : '';
      lines.push(`<p>We asked ${h(joinAnd([mainLabel, ...others]))} the same ${q === 1 ? 'question' : `${q} questions`}.${askedMore} ${others.length === 1 ? `${h(others[0])}'s answers are` : "The other assistants' answers are"} below so you can compare.</p>`);
    }
  }
  // Said whenever an answer below does not count, so the owner knows the score does not move when this report opens.
  // "This question" while only one has been asked so far; with the gate off the report is open from the first view,
  // so the ending says the score stays the same as more answers come in (V160).
  if (free.length > 0 && (otherMain.length > 0 || seconds.length > 0)) {
    const which = new Set(all.map(a => a.prompt)).size === 1 ? 'this question' : 'the first question';
    const ending = leadGate === false ? 'so it stays the same as more answers come in.' : 'so it does not change when you open this report.';
    lines.push(`<p>Your score counts only ${h(midSentence(mainLabel))}'s answers to ${which}, ${ending}</p>`);
  }
  // The free question is listed first, even when a repeat check stored carried extra answers before it (V159).
  const firstPrompt = free[0]?.prompt ?? freeQuestion(grade.input);
  const prompts = [...new Set(all.map(a => a.prompt))]
    .sort((a, b) => (a === firstPrompt ? 0 : 1) - (b === firstPrompt ? 0 : 1));
  const items = prompts.map(p => {
    const asked = all.filter(a => a.prompt === p);
    // When the main assistant answered this question more than once, each of its answers says which one it is.
    const mains = asked.filter(a => !isSecondOpinion(a));
    // Claude's answers come first under every question, then the second opinions (V142).
    const entries = [...mains, ...asked.filter(a => isSecondOpinion(a))];
    const label = a => {
      const name = h(providerLabel(a.provider));
      if (isSecondOpinion(a)) return `${name} (for comparison only)`;
      if (!counted.has(a)) return `${name} (not counted toward your score)`;
      return mains.length > 1 ? `${name}, answer ${mains.indexOf(a) + 1} of ${mains.length}` : name;
    };
    return `<li><strong>${h(p)}</strong>${entries.map(a => `
      <p>${label(a)}: ${h(outcome(a, grade.input))}</p>
      ${answerBlock(a)}`).join('')}</li>`;
  }).join('\n    ');
  return `<section class="grade-all-answers">
  <h2>Every answer</h2>
  ${lines.join('\n  ')}
  <ol>
    ${items}
  </ol>
</section>`;
}

function fixKit(grade, contactEmail) {
  const i = grade.input;
  const found = foundOf(grade);
  const kit = {
    name: i.name, service: i.service, city: i.city, state: i.state,
    phone: found.phone ?? '', website: i.website ?? '', address: found.address ?? '', hours: readableHours(found.hours),
  };
  // The business label wants schema.org's own hours format; free text like "Monday to Friday, 8 am to 5 pm" is left out of it.
  const labelKit = { ...kit, hours: schemaHours(found.hours), noStorefront: i.noStorefront === true };
  const intro = i.website
    ? 'Send this kit to whoever looks after your website. Each box says where it goes, and the Copy button copies it.'
    : 'This kit is ready for when you have a website. Hand it to whoever builds it. Each box says where it goes, and the Copy button copies it.';
  const items = [
    ['kit-title', 'Page title', 'Use this as your home page title.', suggestedTitle(kit)],
    ['kit-summary', 'Page summary', 'Use this as the summary Google shows under your title.', suggestedSummary(kit)],
    ['kit-label', 'Business label for AI',
      // No phone found: the block holds a placeholder, and the line above it says to replace it (V137).
      `Paste this into your home page so AI can read your name and phone.${kit.phone ? '' : ' Put your phone number in before you paste.'}`,
      jsonLdBlock(labelKit)],
    ['kit-llms', 'Info sheet for AI (llms.txt)', 'Save this as a plain text file named llms.txt on your website.', llmsDraft(kit)],
  ];
  const blocked = resultsOf(grade).find(r => r.id === 'ai-bots-allowed' && r.result === 'fail')?.blocked ?? [];
  if (blocked.length > 0) {
    items.push(['kit-robots', 'robots.txt lines', 'Replace the lines that block these assistants with these lines in your robots.txt file, so they can read your website.', robotsLines(blocked)]);
  }
  const blocks = items.map(([id, title, help, text]) => `<div class="kit-item">
      <h3>${h(title)}</h3>
      <p class="hint">${h(help)}</p>
      <pre id="${id}">${h(text)}</pre>
      <button type="button" class="copy-btn button" data-copy="${id}" hidden>Copy</button>
    </div>`).join('\n    ');
  return `<section class="grade-kit">
  <h2>Your fix kit</h2>
  <p>${intro}</p>
  ${blocks}
</section>
<section class="grade-offer">
  <h2>Want help?</h2>
  <p>Not sure how to add these? First Answer, the team behind First Answer Pages, can apply the fixes for you. ${contactLink(contactEmail, 'Contact us')} and we will take a look.</p>
</section>`;
}

function leadForm(grade, { values = {}, errors = {} } = {}) {
  const keys = ['name', 'email', 'phone'];
  const firstBad = keys.find(k => errors[k]);
  const input = (k, type, label, auto) => {
    const bad = Boolean(errors[k]);
    return `<div class="field${bad ? ' missing' : ''}">
        <label for="l-${k}">${label}</label>
        <input type="${type}" id="l-${k}" name="${k}" value="${h(values[k] ?? '')}"${bad ? ` aria-invalid="true" aria-describedby="l-err-${k}"` : ''} autocomplete="${auto}"${k === firstBad ? ' autofocus' : ''}>
        ${bad ? `<span class="missing-note" id="l-err-${k}" role="alert">${h(errors[k])}</span>` : ''}
      </div>`;
  };
  const anyError = keys.some(k => errors[k]);
  return `<section class="grade-lead" id="unlock">
  <h2>See every check and the fixes</h2>
  <p>Enter your name, email and phone to open the full report right away, on this page. It has every check, the fix for each one, and text you can copy and paste.</p>
  ${anyError ? '<p class="form-error" role="alert">Please fix the highlighted fields.</p>' : ''}
  <form class="rise-form" method="POST" action="/grade/${h(grade.id)}/unlock">
      ${input('name', 'text', 'Your name', 'name')}
      ${input('email', 'email', 'Your email', 'email')}
      ${input('phone', 'tel', 'Your phone', 'tel')}
      <p class="hint">Why the phone number? It is the fastest way to help if you want a hand with your report. We only call, text or email you if you check the box below. We never sell it.</p>
      <label class="check"><input type="checkbox" name="okToContact" value="1"${values.okToContact ? ' checked' : ''}> OK for First Answer Pages to call, text or email me about my report</label>
      <button type="submit" class="button">Show me my full report</button>
  </form>
</section>`;
}

function recheckBlock(grade, rechecking) {
  if (!grade.input.website) {
    return '<p class="hint">You did not give a website, so there is nothing to check again. Your fix kit still has a draft you can use.</p>';
  }
  const parts = [];
  if (rechecking) {
    parts.push('<p class="notice" role="status" data-grade-rechecking>Checking your website again. This page updates by itself.</p>');
  }
  if (grade.recheckFailedAt) {
    parts.push("<p class=\"notice\" role=\"alert\">We couldn't reach your website when we checked again. Your earlier results are kept.</p>");
  }
  parts.push(`<form method="POST" action="/grade/${h(grade.id)}/recheck"><button type="submit" class="button">Check again</button></form>
  <p class="hint">Fixed something? Check again to see your new score. This reads your website again and does not ask AI again.</p>`);
  return `<section class="grade-recheck">\n  <h2>Made some changes?</h2>\n  ${parts.join('\n  ')}\n</section>`;
}

// ---- the report ----------------------------------------------------------------------------

/**
 * The report for a finished Grade.
 * @param {object} grade
 * @param {{
 *   unlocked?: boolean, leadGate?: boolean, contactEmail?: string, opened?: boolean,
 *   googleLive?: boolean, requester?: boolean, leadValues?: object, leadErrors?: object,
 * }} [opts] `unlocked` is true when this visitor opened the full report; `leadGate: false` shows it to everyone.
 */
export function reportPage(storedGrade, opts = {}) {
  // One number everywhere (Requirement 26): every part of the page reads the results with the `ai-named` result
  // worked out from the stored answers by the one rule (the free question's answers only). Nothing is written.
  const grade = { ...storedGrade, results: scoredResults(storedGrade) };
  const {
    unlocked = false, leadGate = true, contactEmail = '', opened = false,
    googleLive = false, requester = false, leadValues, leadErrors,
    // A recheck that was cut off (for example by a restart) stops counting after 4 minutes; the route works that out.
    rechecking = false,
    // Assistant names of second opinions that have not answered yet (their 45 seconds are not up).
    secondPending = [],
    // The current time in ms, so an answer older than 10 minutes says when it was asked.
    now,
  } = opts;
  const i = grade.input;
  const full = !leadGate || unlocked;
  // One rule for every number on the page: worked out once from the stored results with the current points,
  // never read from the stored Score, so a Grade made before a change in points never shows two scores.
  const s = currentScore(grade);
  const scored = Number.isInteger(s.score);
  const failedLine = scored && Number.isInteger(s.failed) && Number.isInteger(s.counted)
    ? `<p class="grade-failed">${s.counted === 1 ? `${s.failed} of 1 check needs work` : `${s.failed} of ${s.counted} checks need work`}</p>`
    : '';
  const number = scored
    ? `<p class="grade-score-number"><span class="num">${s.score}</span><span class="of">out of 100</span></p>`
    : '<p class="grade-score-number"><span class="num-text">Not enough to score yet</span></p>';
  // The daily limit is the reason the AI part did not run: say "tomorrow", not "later" (V139).
  const limited = dailyLimitHit(grade);
  const noWebsite = !i.website
    ? (limited
      ? '<p class="notice" role="status">We couldn\'t run any checks this time. Please try again tomorrow.</p>'
      : '<p class="notice" role="status">We could only run the AI check. Add a website to get a score. A free listing gives AI something to read about the business.</p>')
    : '';
  // A score that leaves out the AI part is marked as partial, and never set beside an earlier score.
  const partial = isPartialScore(grade);
  const partialLine = partial
    // "Check again" only reads the website again and never asks the AI, so it cannot give the full score back. The line
    // points at a new check instead, with the business's details filled in (V157; nothing new is spent by this page).
    ? `<p class="hint grade-partial">${h(`Partial score: ${partialReason(grade)} the AI part isn't counted.`)} <a href="/grade?from=${encodeURIComponent(grade.id)}">Run a new check</a> ${limited ? 'tomorrow' : 'later'} for your full score.</p>`
    : '';
  // A website we could not read gives a score from the few checks that ran. Say so under the score, on the locked
  // and the unlocked report alike (V134), in the same style as the notice for an AI that did not answer.
  const homeProblem = homeReadProblem(grade);
  const readNotice = homeProblem !== null && scored
    ? `<p class="hint grade-partial">${h(`Partial score: we couldn't read your home page, so most website checks aren't counted.${homeProblem === HOME_UNREADABLE ? ' Your website may be blocking automated visitors.' : ''}`)}</p>`
    : '';
  const host = hostOf(i.website);
  const reachLine = homeProblem === WEBSITE_UNREACHED && host
    ? `<p class="hint grade-partial">${h(`We couldn't reach ${host}. Check the spelling and run the check again.`)}</p>`
    : '';
  // Shown only when the results include reviews-visible, so scores are never compared across the change in points.
  const hasReviewsCheck = resultsOf(grade).some(r => r && r.id === 'reviews-visible');
  const prev = Number.isInteger(grade.previousScore) && scored && grade.recheckedAt && !partial && hasReviewsCheck
    ? `<p class="grade-prev">Your score was ${grade.previousScore} before. It is ${s.score} now.</p>`
    : '';

  const top = `<div class="grade-top">
  <div class="grade-score">
    <p class="grade-eyebrow"><span class="grade-eyebrow-title">AI Visibility Check</span><span class="grade-eyebrow-sub">Report &middot; First Answer Pages</span></p>
    ${number}
    ${partialLine}
    ${readNotice}
    ${reachLine}
    <h1>${h(i.name)}</h1>
    <p class="grade-where">${h(i.service)} in ${h(i.city)}, ${h(i.state)}</p>
    ${failedLine}
    ${noWebsite}
    ${prev}
  </div>
</div>`;

  const claim = `<div class="grade-fix">
  <div>
    <h2>Your free listing in our directory</h2>
    ${previewCard(grade)}
    <form method="POST" action="/grade/${h(grade.id)}/claim"><button type="submit" class="button">Claim my free listing</button></form>
    <p class="hint">A free listing for your business in our directory, First Answer Pages. Next you check the details and send it to us for approval. Nothing goes live until you do.</p>
  </div>
  ${topFails(grade)}
</div>`;

  const when = grade.finishedAt || grade.createdAt;
  const foot = `<p class="grade-meta">Automated check, ${h(whenText(when))}. AI assistants pick up changes over days to weeks, so look again after you make fixes.</p>
<p class="hint">Ask us to remove this report: ${contactLink(contactEmail, contactEmail || 'contact page')}.</p>`;

  const justOpened = opened && full && leadGate && unlocked
    ? '<p class="notice saved-note" role="status">Your full report is open.</p>'
    : '';

  const fullPart = full
    ? `<div class="grade-full" id="full-report">
  ${justOpened}
  ${allChecks(grade)}
  ${answersSection(grade, { leadGate })}
  ${fixKit(grade, contactEmail)}
  ${recheckBlock(grade, rechecking)}
</div>`
    : leadForm(grade, { values: leadValues, errors: leadErrors });

  const body = `<section class="grade-report">
${top}
${aiFree(grade, { googleLive, requester, now, secondPending })}
${claim}
${searchPreview(grade)}
${groupLines(grade, s)}
${fullPart}
${foot}
</section>`;
  return page(`AI Visibility Check for ${i.name}`, body, { refresh: rechecking || secondPending.length > 0 });
}

// ---- Google's live answer ----------------------------------------------------------------------

/**
 * Google's live answer, shown once to the browser that ran the check. The answer text is
 * escaped. `suggestionsHtml` is Google's own Search Suggestions markup and is inserted
 * exactly as sent (the route serves this page with a policy that blocks scripts).
 */
export function googleLivePage({ grade, text, sources = [], suggestionsHtml = '' }) {
  const links = (Array.isArray(sources) ? sources : [])
    .filter(s => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
    .map(s => `<li><a href="${h(s.url)}" rel="noopener noreferrer nofollow">${h(s.title || s.url)}</a></li>`)
    .join('');
  const body = `<section class="grade-ai">
  <h1>What Google's AI says</h1>
  <p>The question we asked: ${h(freeQuestion(grade.input))}</p>
  <p class="hint">From Google's Gemini, with a live Google search. Google doesn't review or endorse this report. Only you can see this answer. We don't save it. Your score comes from ${h(midSentence(grade.aiMain?.label ?? 'Claude'))}'s answers only.</p>
  <blockquote class="grade-answer seance-answer">${h(readableAnswer(text))}</blockquote>
  ${links ? `<h2>Where it looked</h2><ul>${links}</ul>` : ''}
  ${suggestionsHtml ? `<div class="grade-google-suggestions">${suggestionsHtml}</div>` : ''}
  <p><a href="/grade/${h(grade.id)}">Back to your report</a></p>
</section>`;
  return page("What Google's AI says", body);
}

// ---- other pages ---------------------------------------------------------------------------------

/** A short page with a heading, one line and a link. */
export function messagePage(title, message, link = { href: '/grade', text: 'Back to the check' }) {
  const body = `<section class="message">
  <h1>${h(title)}</h1>
  <p>${h(message)}</p>
  <p><a href="${h(link.href)}">${h(link.text)}</a></p>
</section>`;
  return page(title, body);
}

export const notFoundPage = () => messagePage('Page not found', 'We could not find that report. It may have been removed. Reports are deleted after 90 days.');

/** What the Grader reads and why. */
export function aboutPage({ contactEmail = '', userAgent = '', indexable = false, canonical = '' } = {}) {
  const body = `<section class="message">
  <h1>About the AI Visibility Check</h1>
  <p>This is our free <a href="/grade">AI Visibility Check</a>. Someone types in a business name, city, state and what the business does, and a website if it has one. This page says exactly what the check does, so anyone whose website was checked can see why.</p>
  <h2>What we visit</h2>
  <ul>
    <li>Our server visits the website once per check. It reads the home page, /robots.txt and /llms.txt. Each is read at most once per check.</li>
    <li>It reads public pages only, on the public internet.</li>
    <li>It does not log in, fill in forms, run scripts or send cookies.</li>
    ${userAgent ? `<li>Our visits identify themselves as: <code>${h(userAgent)}</code></li>` : ''}
  </ul>
  <h2>What we ask AI</h2>
  <ul>
    <li>We ask Claude up to 3 questions about the best businesses of that kind in that city, and the first one up to 3 times, because AI answers change from one time to the next. The questions name the kind of business and the city, never the business name.</li>
    <li>Each answer, with the business name, city and state, is sent to Google's Gemini to help check whether the business is named.</li>
    <li>When we can, ChatGPT, Gemini, Grok and Perplexity are asked the same questions so the answers can be compared. Only Claude's answers to the first question count toward the score.</li>
    <li>The person who ran a check can see Google's live answer. It is private to them, and we never save it, score it or share it.</li>
  </ul>
  <h2>Your report</h2>
  <p>Reports are not listed in search engines and are deleted after 90 days. To ask us to remove one sooner, ${contactLink(contactEmail, contactEmail ? `email ${contactEmail}` : 'use the contact details on our About page')}.</p>
  <p><a href="/grade">Check a business</a></p>
</section>`;
  return page('About the AI Visibility Check', body, indexable === true
    ? { indexable: true, canonical, description: ABOUT_SEARCH_DESCRIPTION }
    : {});
}
