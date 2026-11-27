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
import { healthModel, healthMapHtml, checkTip, checkName, CHECK_ROW_IDS } from './health-map.js';
import { hasPlaceholder, REPLACE_CAPITALS } from './fix-kit.js';
import { registeredDomain } from './name-match.js';
import {
  shareOfVoice, sitesUsed, evidence, reportCsv, cleanPreparedBy, PREPARED_BY_MAX, answersOf,
} from './agency-report.js';
import { DEFAULT_SITE_NAME } from './config.js';
import {
  providerLabel, freeQuestion, extraQuestions, stepNames, foundOf, isSecondOpinion, schemaHours, readableHours, isPartialScore,
  HOME_UNREADABLE, WEBSITE_UNREACHED, freeAnswersOf, scoredResults, AI_LIMIT_REACHED, AI_FAILED,
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
  refresh = false, turnstile = false, indexable = false, canonical = '', description = '', scripts = [], navCta = true,
} = {}) {
  const open = indexable === true;
  const parts = [open ? '' : ROBOTS_META, refresh ? REFRESH_NOSCRIPT : '', turnstile ? TURNSTILE_SCRIPT : ''].filter(Boolean);
  return layout({
    title,
    body,
    scripts: ['/js/grade.js', ...scripts],
    head: parts.join('\n  '),
    navCta,
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

/** The link that starts a new check with this business filled in (V157). Every mention of it is this link (V244). */
const runNewLink = (grade, text = 'Run a new check') => `<a href="/grade?from=${encodeURIComponent(grade.id)}">${text}</a>`;

/** The first letter of a typed service in capitals ("plumbers" becomes "Plumbers"), as the fix kit does. */
function capFirst(text) {
  const chars = Array.from(String(text ?? ''));
  return chars.length ? chars[0].toUpperCase() + chars.slice(1).join('') : '';
}

/**
 * What the main assistant did with the business, in plain words, to follow "<Assistant> " (V207): "named your
 * business in all 3 answers", "named your business in 2 of its 3 answers", "didn't name your business in any of its
 * 3 answers". `short` is when fewer answers came back than were asked ("in 1 of the 2", "in both", "in either").
 */
function namedCountText(named, total, short = false, its = true) {
  if (short) {
    if (named === 0) return "didn't name your business in either";
    if (named === total) return 'named your business in both';
    return `named your business in ${named} of the ${total}`;
  }
  if (named === 0) return `didn't name your business in any of its ${total} answers`;
  if (named === total) return total === 2 ? 'named your business in both answers' : `named your business in all ${total} answers`;
  return `named your business in ${named} of ${its ? 'its ' : ''}${total} answers`;
}

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
  prefilled = false,
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
  <p class="tagline">Get a free check in about a minute. We ask AI assistants to name the best businesses like yours in your city, and see if they name you. We also look at what AI can read on your website.</p>
  ${prefilled === true && Object.keys(errors).length === 0 ? '<p class="notice" role="status">We filled this in from your last check. Change anything that\'s wrong, then press Check my business.</p>' : ''}
  ${errors.form ? `<p class="form-error" role="alert">${h(errors.form)}</p>` : ''}
  ${['name', 'city', 'state', 'service', 'about', 'website'].some(k => errors[k]) ? '<p class="form-error" role="alert">Please fix the problems below.</p>' : ''}
  <form class="rise-form" method="POST" action="/grade">
    ${field({ id: 'g-name', name: 'name', label: 'Business name', value: values.name, error: errors.name, attrs: ' autocomplete="organization"' })}
    ${field({ id: 'g-city', name: 'city', label: 'City', value: values.city, error: errors.city, attrs: ' autocomplete="address-level2"' })}
    ${field({ id: 'g-state', name: 'state', label: 'State', value: values.state, hint: '2 letters, like TN', error: errors.state, attrs: ' autocomplete="address-level1"' })}
    ${field({ id: 'g-service', name: 'service', label: 'What you do', value: values.service, hint: 'Like roofers, plumbers or restaurants', error: errors.service, attrs: ' list="service-suggestions"' })}
    <datalist id="service-suggestions">${options}</datalist>
    ${field({ id: 'g-about', name: 'about', label: 'Describe what you do, in your own words (optional)', value: values.about, hint: 'One sentence is plenty. Example: We pressure wash driveways and soft-wash roofs.', error: errors.about, attrs: ' maxlength="200"' })}
    ${field({ id: 'g-website', name: 'website', label: 'Your website (optional)', value: values.website, hint: "Like example.com. Leave it empty if you don't have one.", error: errors.website, attrs: ' inputmode="url" autocapitalize="none"' })}
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
  const totalSteps = names.length;
  const doneCount = [...done.values()].filter(s => s).length;
  // Never show 100% on the scan page — the scan page only renders while the grade is still running,
  // so even if all 5 steps are recorded the grade isn't done yet. Cap at 95%.
  const rawPct = Math.round((doneCount / totalSteps) * 100);
  const pct = Math.min(rawPct, 95);
  const body = `<section class="grade-scan" data-grade-scan data-status-url="/grade/${h(grade.id)}/status.json" data-total-steps="${totalSteps}" data-done-steps="${doneCount}">
  <h1>Checking ${h(grade.input.name)}</h1>
  <div class="scan-progress-wrap">
    <div class="scan-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" style="--pct:${pct}%">
      <div class="scan-progress-fill"></div>
      <div class="scan-progress-glow"></div>
    </div>
    <span class="scan-progress-label">${pct}%</span>
  </div>
  <p class="tagline">This can take up to a minute. We're asking AI assistants about your business.</p>
  <ol class="grade-steps">
    ${itemsHtml}
  </ol>
</section>`;
  // The finished report is swapped into this page in place, so the orb script is loaded here too (Step 2 review V12).
  // It does nothing until a health map is on the page.
  return page(`Checking ${grade.input.name}`, body, { refresh: true, scripts: [HEALTH_ORB_SCRIPT, HEALTH_DRILL_SCRIPT, HEALTH_INTERACT_SCRIPT, HEALTH_SCAN_SCRIPT] });
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
  if (dailyLimitHit(grade)) return "today's limit for AI questions was reached, so";
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
  return "It didn't name your business.";
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

const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * An answer's text, escaped, with the business's name in <mark> where the answer named it (high-tech-look J3, batch 3
 * X13). The text is escaped first and the escaped name is wrapped after, so nothing from the answer becomes markup.
 * A name is never matched inside an escaped character such as &amp;. Answers that didn't name the business are
 * shown plain.
 */
export function markedAnswer(a, input) {
  const text = h(readableAnswer(a?.answer ?? ''));
  if (!a?.named || !input) return text;
  let written = '';
  try {
    written = nameAsWritten(a, input);
  } catch {
    written = '';
  }
  const names = [...new Set([String(input.name ?? ''), String(written ?? '')].map(n => h(n.trim())))]
    .filter(n => n.length >= 3)
    .sort((x, y) => y.length - x.length);
  if (names.length === 0) return text;
  const pattern = new RegExp(`(?<![\\w&#])(?:${names.map(escapeRegExp).join('|')})(?![\\w;])`, 'gi');
  return text.replace(pattern, m => `<mark>${m}</mark>`);
}

function answerBlock(a, input = null) {
  return `${a.provider === 'mock' ? '<p class="hint">Demo answer (no AI connected)</p>\n  ' : ''}<details><summary>See the full answer</summary><blockquote class="grade-answer seance-answer">${markedAnswer(a, input)}</blockquote></details>`;
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
  const count = namedCountText(named, total, short, false);
  const shownIndex = Math.max(0, answers.findIndex(a => a.named));
  const shown = answers[shownIndex];
  // Which answer the list is from, numbered among the answers that came back (V102).
  // "the one that named you" when only one answer did, "the first one that named you" when several did (V245).
  // Only when a list is shown (high-tech-look J3: never point at a list that isn't there).
  const listHtml = competitorList(shown, input);
  const from = !listHtml ? '' : shown.named
    ? ` This list is from answer ${shownIndex + 1}, the ${named === 1 ? '' : 'first '}one that named you.`
    : ` This list is from answer ${shownIndex + 1}.`;
  const demo = firstAnswer.provider === 'mock' ? '<p class="hint">Demo answer (no AI connected)</p>\n  ' : '';
  const blocks = answers.map((a, i) => `<p>Answer ${i + 1}</p><blockquote class="grade-answer seance-answer">${markedAnswer(a, input)}</blockquote>`).join('');
  // Why we ask more than once (V101). When today's limit cut the asks short, the Grade stores the number
  // planned and the number asked, and the hint says both (V107); otherwise the number is the times asked.
  const limited = cut && Number.isInteger(cut.planned) && Number.isInteger(cut.asked)
    && cut.asked >= 1 && cut.asked < cut.planned && cut.planned <= 3 && cut.asked === n;
  const why = limited
    ? `AI answers change from one time to the next, so we ask the same question ${timesText(cut.planned)}. Today we could ask only ${timesText(cut.asked)} because we reached today's limit.`
    : `AI answers change from one time to the next, so we ask the same question ${times}.`;
  // Named in some answers but not all (V206): say where the business stood in the answer that named it, and that the
  // others did not, before the list, so one good answer never reads as the whole result.
  // The outcome line, unless it only says again what the lead line already said (J3): "It named your business in
  // its answer." or "It didn't name your business." add nothing to "Claude named your business in 2 of 3 answers".
  const plainOutcome = outcome(shown, input);
  const echoes = ['It named your business in its answer.', "It didn't name your business."].includes(plainOutcome);
  let result = echoes ? '' : h(plainOutcome);
  if (named > 0 && named < total && shown.named) {
    const lists = mainList(shown, input);
    const position = lists ? lists.position : shown.position;
    const of = lists ? lists.rows.length : shown.total;
    const rest = total - named;
    // One answer named you: "In the other 2 answers ..."; several did: "In 1 answer ..." (V225-6).
    const others = named === 1 ? `In the other ${rest === 1 ? 'answer' : `${rest} answers`}` : `In ${rest === 1 ? '1 answer' : `${rest} answers`}`;
    result = Number.isInteger(position) && Number.isInteger(of) && of > 0
      ? h(`${named === 1 ? `In that answer you were ${ordinal(position)} of ${of}.` : `In the first answer that named you, you were ${ordinal(position)} of ${of}.`} ${others}, ${subject} didn't name you.`)
      : '';
  }
  return [
    `<p>${asked} ${h(subject)} ${count}.</p>`,
    // One paragraph under the lead line (V109).
    `<p class="hint">${why}${from}</p>`,
    result ? `<p>${result}</p>` : '',
    listHtml,
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
    parts.push(`<p>${lead} ${h(outcome(first, grade.input))}</p>`, competitorList(first, grade.input), answerBlock(first, grade.input));
  } else if (seconds.length > 0) {
    parts.push(dailyLimitHit(grade)
      ? `<p>We couldn't ask ${h(mainLabel)} this time because today's limit for AI questions was reached, so this check has no AI score.</p>`
      : `<p>${h(mainLabel)} didn't answer this time, so this check has no AI score.</p>`);
  } else {
    // One clear instruction (V203): the button at the top runs a new check; the one at the bottom only reads the website.
    const hasWebsite = Boolean(grade.input?.website);
    if (dailyLimitHit(grade)) {
      parts.push(hasWebsite
        ? `<p>We couldn't ask AI this time. Today's limit for AI questions was reached. Come back tomorrow and tap ${runNewLink(grade)}.</p>`
        : "<p>We couldn't ask AI this time. Today's limit for AI questions was reached. You can run the check again tomorrow.</p>");
    } else if (grade.aiMain?.state === 'not_connected') {
      parts.push("<p>We couldn't ask AI this time. The AI check is not connected yet.</p>");
    } else {
      // One short sentence naming the assistant, not three that repeat each other (V140).
      parts.push(hasWebsite
        ? `<p>${h(mainLabel)} didn't answer this time. Come back later and tap ${runNewLink(grade)}.</p>`
        : `<p>${h(mainLabel)} didn't answer this time. Please run the check again later.</p>`);
    }
  }

  if (seconds.length > 0) {
    if (first) {
      parts.push('<h3>Other AI assistants, for comparison only (not scored):</h3>');
      for (const s of seconds) {
        parts.push(`<p>${h(providerLabel(s.provider))}, asked the same question: ${h(outcome(s, grade.input))}</p>`);
        if (s.provider === 'gemini' && s.webSearch !== true) parts.push('<p class="hint">Gemini answered without a live web search.</p>');
        parts.push(competitorList(s, grade.input), answerBlock(s, grade.input));
      }
    } else {
      parts.push('<p class="hint">These answers are for comparison only (not scored).</p>');
      for (const s of seconds) {
        parts.push(`<p>${askedLine(s, now, h(providerLabel(s.provider)))} ${h(outcome(s, grade.input))}</p>`);
        if (s.provider === 'gemini' && s.webSearch !== true) parts.push('<p class="hint">Gemini answered without a live web search.</p>');
        parts.push(competitorList(s, grade.input), answerBlock(s, grade.input));
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
  // The question itself, so the reader sees what was asked (high-tech-look J3).
  const question = first ? `<p class="grade-question">The question we asked: ${h(first.prompt ?? prompt)}</p>\n  ` : '';
  return `<section class="grade-ai">
  <h2>What AI says</h2>
  ${question}${parts.filter(Boolean).join('\n  ')}
</section>${google ? `\n${google}` : ''}`;
}

/**
 * True when the hours check passed on the home page but no hours were copied for the listing: the hours were plain
 * text only (V241, the owner's decision: they are not copied, and the report says so).
 */
function hoursPlainTextOnly(grade) {
  const passed = resultsOf(grade).some(r => r.id === 'hours-shown' && r.result === 'pass');
  return passed && readableHours(foundOf(grade).hours).length === 0;
}

/** True when a Check passed on the home page (the same facts the health rows use, high-tech-look J1, J2). */
const checkPassed = (grade, id) => resultsOf(grade).some(r => r.id === id && r.result === 'pass');

function previewCard(grade) {
  const i = grade.input;
  const found = foundOf(grade);
  const shown = readableHours(found.hours);
  // Google shows hours for the business: said without copying them (Google's values are never kept, T3). Batch 3 X13:
  // the line says why the owner should still add them.
  const googleHours = grade.signals?.google?.hours?.status === 'good';
  const hours = shown.length
    ? shown.map(x => h(x)).join('; ')
    : blank(hoursPlainTextOnly(grade) ? "Add your hours (we saw them on your website but couldn't copy them)"
      // Batch 5 K19: about what the owner can do, not about how we work.
      : googleHours ? "Add your hours on your website and we'll fill them in" : 'Add your hours');
  // Only "Add your ..." for what was really not found; when the page shows it but it couldn't be copied, say so (J1, J2).
  const phone = found.phone
    ? `<span class="phone">${h(found.phone)}</span>`
    : blank(checkPassed(grade, 'tap-to-call') ? "Add your phone number (we saw a tap-to-call link but couldn't read the number)" : 'Add your phone number');
  const address = found.address
    ? h(found.address)
    : blank(checkPassed(grade, 'address-shown') ? "Add your street address (we saw one on your website but couldn't copy it)" : 'Add your street address');
  return `<div class="grade-preview">
    <h3>${h(i.name)} &middot; ${phone}</h3>
    <p>${h(capFirst(i.service))} in ${h(i.city)}, ${h(i.state)}</p>
    <p>Hours: ${hours}</p>
    ${i.noStorefront === true
    // A business that goes to its customers shows its area, never an address, even when the page has one.
    ? `<p>Serves the ${h(i.city)} area</p>`
    : `<p>Address: ${address}</p>`}
    <p>Website: ${i.website ? h(i.website) : blank('Add your website')}</p>
  </div>`;
}

/** Batch 5 K6: the line under "Fix these first" on paper, where the reader is the web team. */
export const SEND_THIS_PAGE = 'Not a computer person? Send this page to whoever built your website.';
export const PRINT_KIT_LINE = 'Your web team can use the fix kit at the end.';

function topFails(grade, full = false) {
  // The AI answers are not something the owner can change directly, so they are never a "fix first" item.
  const check = id => checkById(id, grade.input);
  const fails = resultsOf(grade)
    .filter(r => r.result === 'fail' && r.id !== 'ai-named' && check(r.id))
    .sort((a, b) => check(b.id).points - check(a.id).points)
    .slice(0, 3);
  if (fails.length === 0) return '';
  return `<div class="grade-top-fails">
    <h2>Fix these first</h2>
    <p class="hint">${SEND_THIS_PAGE}</p>
    <ul>${fails.map(r => `<li><strong>${h(reportName(r.id, grade.input, check(r.id).label))}</strong><br>${fixHtml(check(r.id).fix, full)}</li>`).join('')}</ul>
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

/**
 * Batch 5 K8: the points we couldn't check, and which checks they were, so the reader knows where the rest went. ''
 * when every shown check ran. Escaped here.
 */
export function notCheckedLine(grade) {
  const shown = new Set(CHECKS.filter(c => GROUPS.find(g => g.id === c.group)?.show !== false).map(c => c.id));
  const missed = resultsOf(grade).filter(r => r && shown.has(r.id) && r.result !== 'pass' && r.result !== 'fail');
  const points = missed.reduce((sum, r) => sum + (checkById(r.id, grade.input)?.points ?? 0), 0);
  if (points <= 0) return '';
  const names = missed.map(r => checkName(r.id, grade.input) ?? checkById(r.id, grade.input)?.label).filter(Boolean);
  const listed = names.length <= 2 ? joinAnd(names) : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
  return ` ${h(`${points} ${points === 1 ? 'point' : 'points'} couldn't be checked this time, so they don't count for or against you.`)} ${h(`Not checked: ${listed}.`)}`;
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
  // Both numbers in one sentence (V208): the points earned out of the points checked, and the score that gives.
  const relation = Number.isInteger(score?.score) && Number.isFinite(score.earned) && Number.isFinite(score.available) && score.available > 0
    ? `\n  <p class="hint">You earned ${score.earned} of the ${score.available} points we ${isPartialScore(grade) ? 'could check today' : 'checked'}. That is ${score.score} out of 100.${notCheckedLine(grade)}</p>`
    : '';
  return lines.length ? `<section class="grade-areas">\n  <h2>Score by area</h2>${relation}\n  <ul class="grade-groups">${lines.join('')}</ul>\n</section>` : '';
}

function checkRow(r, input, ctx = {}) {
  // The Grade's input picks the service-area wording for a business with no storefront.
  const c = checkById(r.id, input);
  if (!c) return '';
  let cls = r.result === 'fail' ? 'fail' : r.result === 'pass' ? 'pass' : 'not_checked';
  // "Partly" (Requirement 27): the AI check passed, but it named the business in only some answers. A display
  // label only: the stored result, the points, the score and the count of checks that need work do not change.
  // A result stored without `earned` (an older Grade) stays "Pass".
  const partly = r.id === 'ai-named' && cls === 'pass' && Number.isFinite(r.earned) && r.earned < c.points;
  if (partly) cls = 'partly';
  // Batch 6 item 4: a check that passed but whose details couldn't all be read says "Partly", like its health map row,
  // with the same tip. A display label only: the stored result, the points and the score don't change.
  const tip = cls === 'pass' ? checkTip(r.id, input, ctx.found) : null;
  if (tip) cls = 'partly';
  const word = { pass: 'Pass', partly: 'Partly', fail: 'Needs work', not_checked: 'Not checked' }[cls];
  let points = 'Not counted';
  if (cls !== 'not_checked') {
    const earned = r.id === 'ai-named' && Number.isFinite(r.earned) ? r.earned : (r.result === 'pass' ? c.points : 0);
    points = `${earned} of ${c.points} points`;
  }
  // Under "Partly" a leading "Yes. " would sit oddly beside a weak result; it is left off here, never in storage (V153).
  let detail = partly ? String(r.detail ?? '').replace(/^Yes\.\s+/, '') : (r.detail ?? '');
  // Fix B item 5: a "Partly" card that earned every point says so in words, so "Partly, 4 of 4 points" never confuses.
  if (tip) points = FULL_POINTS_TIP;
  let pointsHtml = `<br><span class="grade-points">${points}</span>`;
  let detailHtml = h(detail);
  // The AI row when the AI part did not run (V203, V204, V211, V242, V244): say why in the assistant's own name, with
  // no "Not counted" badge, and give the way to ask again as a link.
  if (r.id === 'ai-named' && cls === 'not_checked') {
    const website = Boolean(input?.website) && Boolean(ctx.runNew);
    if (ctx.limited) {
      detailHtml = `${h("We hit today's limit for AI questions, so this part has no score yet.")}${website ? ` Come back tomorrow and tap ${ctx.runNew}.` : ''}`;
      pointsHtml = '';
    } else if (r.detail === AI_FAILED || r.detail === "AI didn't answer this time") {
      // The assistant's name starts the sentence, so it starts with a capital ("The demo assistant", V225-5).
      detailHtml = `${h(`${capFirst(ctx.label ?? 'The assistant')} didn't answer this time, so this part has no score.`)}${website ? ` Come back later and tap ${ctx.runNew}.` : ''}`;
      pointsHtml = '';
    }
  }
  // Hours found only as plain text are not copied into the listing; the row says so (V241).
  if (r.id === 'hours-shown' && cls === 'pass' && ctx.hoursPlainOnly) {
    detailHtml = h('Your home page shows your hours in plain text.');
  }
  // The AI row's advice is not a fix the owner can make, so it reads as what they can do, never as a promise (V205).
  const fixLabel = r.id === 'ai-named' ? 'What you can do:' : 'Fix:';
  // Batch 5 K2: the same tip as its health map row (the tip was worked out above).
  // Fix B item 7: one word for advice everywhere: "Fix:".
  const tipHtml = tip ? `<p class="hint grade-tip"><strong>Fix:</strong> ${h(tip.reason)}</p>` : '';
  return `<li class="grade-check ${cls}"><span class="grade-result">${word}</span><strong>${h(reportName(r.id, input, c.label))}</strong>${pointsHtml}<p>${detailHtml}</p>${tipHtml}${cls === 'fail' ? `<p><strong>${fixLabel}</strong> ${fixHtml(ctx.agency ? agencyFix(c.fix) : c.fix, ctx.full)}</p>` : ''}</li>`;
}

/** Batch 5 K4: on an agency's printout, advice never points at our free listing. */
function agencyFix(text) {
  return String(text ?? '').replace('Claim your free listing and work through the fixes below.', 'Work through the fixes below.');
}

/** Batch 5 K10: the one name of a check on the report (the health map's name), or its own label. */
function reportName(id, input, fallback) {
  return checkName(id, input) ?? fallback;
}

const IN_FULL_REPORT = '(a few lines of code in your full report)';
// Batch 6 nit 11: "your fix kit" in lower case.
const IN_KIT = 'the code is in your fix kit, at the end of this report';

/**
 * A fix sentence, escaped. Batch 5 K11: on the full report, "in your full report" points at the fix kit below, with a
 * link to the business label block.
 */
function fixHtml(text, full) {
  const s = String(text ?? '');
  if (!full || !s.includes(IN_FULL_REPORT)) return h(s);
  const [before, after] = s.split(IN_FULL_REPORT);
  return `${h(before)}(<a href="#kit-label">${h(IN_KIT)}</a>)${h(after)}`;
}

function allChecks(grade, { agency = false } = {}) {
  const results = resultsOf(grade);
  return GROUPS.filter(g => g.show !== false).map(g => {
    const ids = new Set(CHECKS.filter(c => c.group === g.id).map(c => c.id));
    const ctx = {
      limited: dailyLimitHit(grade), label: grade.aiMain?.label, runNew: runNewLink(grade), hoursPlainOnly: hoursPlainTextOnly(grade),
      // The score cards are only on the full report, so their fixes point at the fix kit (K11); the tips use the same
      // facts as the health map (K2).
      full: true, found: foundOf(grade), agency,
    };
    const rows = results.filter(r => ids.has(r.id)).map(r => checkRow(r, grade.input, ctx)).join('\n    ');
    return rows ? `<section class="grade-group">
    <h2>${h(g.label)}</h2>
    <ul class="grade-checks">
    ${rows}
    </ul>
  </section>` : '';
  }).join('\n  ');
}

/** Batch 6 item 10: the heading for answers stored without their question, next to answers that kept theirs. */
export const NO_QUESTION_SAVED = 'Answer, question not saved';

const QUESTIONS_NOT_ASKED = "The other questions were not asked because today's limit for AI questions was reached.";

/** The full list of answers, with how many named the business. */
function answersSection(grade, { now } = {}) {
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
  const others = [...new Set(seconds.map(s => providerLabel(s.provider)))];
  // When some answers do not count, one paragraph says it in order (V240): what we asked, which answers count and what
  // the assistant did with them, the other questions, and what the rest are for. Each fact once.
  const stacked = free.length > 0 && (otherMain.length > 0 || seconds.length > 0);
  if (stacked) {
    const questionsAsked = new Set(main.map(a => a.prompt)).size;
    const firstTimes = timesAsked(free);
    const asked = questionsAsked === 1
      ? `We asked ${h(midSentence(mainLabel))} the question${firstTimes > 1 ? ` ${timesText(firstTimes)}` : ''}.`
      : `We asked ${h(midSentence(mainLabel))} ${questionsAsked} questions${firstTimes > 1 ? `, and asked the first one ${timesText(firstTimes)}` : ''}.`;
    const namedCount = free.filter(a => a.named).length;
    let counts;
    if (free.length === 1) {
      // "that answer" points at the question just named; with several questions it says which answer counts (V252).
      const which = questionsAsked > 1 ? 'Only its answer to the first question counts' : 'Only that answer counts';
      counts = `${which} toward your score. ${h(mainLabel)} ${namedCount ? 'named you' : "didn't name you"}.`;
    } else {
      const which = questionsAsked > 1 ? `Only those first ${free.length} answers` : 'Only these answers';
      const said = namedCount === 0 ? "didn't name you in any of them" : namedCount === free.length ? 'named you in all of them' : `named you in ${namedCount} of them`;
      counts = `${which} count toward your score. ${h(mainLabel)} ${said}.`;
    }
    let otherLine = '';
    if (otherMain.length > 0) {
      const k = otherMain.length;
      const n = otherMain.filter(a => a.named).length;
      if (k === 1) {
        otherLine = `On the other question, ${h(midSentence(mainLabel))} ${n === 1 ? 'named you' : "didn't name you"}.`;
      } else {
        const said = n === 0 ? "didn't name you" : n === k ? `named you ${k === 2 ? 'both times' : `all ${k} times`}` : `named you in ${n} of ${k}`;
        otherLine = `On the ${k} other questions, ${h(midSentence(mainLabel))} ${said}.`;
      }
    }
    const compare = seconds.length > 0
      ? (others.length === 1 ? `${h(others[0])}'s answers are here to compare.` : "The other assistants' answers are here to compare.")
      : '';
    lines.push(`<p>${[asked, counts, otherLine, compare].filter(Boolean).join(' ')}</p>`);
  } else {
    if (free.length > 1) {
      // The count is said once, in one form (V104, V108).
      const namedCount = free.filter(a => a.named).length;
      // "all 3 answers", "any of its 3 answers", never "3 of its 3" or "none of its 3" (V142, V207).
      lines.push(`<p>${h(mainLabel)} ${namedCountText(namedCount, free.length)}.</p>`);
    }
    // The free question got no answer, so nothing counts, but the answers to the other questions are still told.
    if (otherMain.length > 0) {
      const k = otherMain.length;
      const n = otherMain.filter(a => a.named).length;
      if (k === 1) {
        lines.push(`<p>On the other question, ${h(mainLabel)} ${n === 1 ? 'named your business' : "didn't name your business"}. It is not counted toward your score.</p>`);
      } else {
        const said = n === 0 ? "didn't name you" : n === k ? `named you ${k === 2 ? 'both times' : `all ${k} times`}` : `named your business in ${n} of ${k}`;
        lines.push(`<p>On the ${k} other questions, ${h(mainLabel)} ${said}. They are not counted toward your score.</p>`);
      }
    }
  }
  // The free question got no answer, but the extra questions did (they run when it failed): say so plainly (V158).
  if (main.length > 0 && free.length === 0) {
    // When the daily limit was the reason, Claude is not blamed (V166).
    lines.push(limitHit
      ? `<p>We couldn't ask ${h(mainLabel)} the first question because today's limit for AI questions was reached, so this check has no AI score. The other answers are shown below but not counted toward your score.</p>`
      : `<p>${h(mainLabel)} didn't answer the first question, so this check has no AI score. The other answers are shown below but not counted toward your score.</p>`);
  }
  if (limitHit && otherMain.length === 0) lines.push(`<p>${QUESTIONS_NOT_ASKED}</p>`);
  // The two other questions run in the background after the report opens (V220, V243). While they really run, the
  // report says so and refreshes; when they have stopped with fewer answered than asked, it says that instead. The run
  // writes `extraAiDoneAt` when it ends. A report made before that marker existed has none, so the note is shown for
  // at most 5 minutes after the start and after that the run counts as stopped.
  const extraPrompts = new Set(all.filter(a => a.extra === true && !isSecondOpinion(a)).map(a => a.prompt));
  const expected = extraQuestions(grade.input).length;
  if (grade.extraAiStartedAt && !limitHit && extraPrompts.size < expected) {
    const startedAt = Date.parse(grade.extraAiStartedAt);
    const stillRunning = !grade.extraAiDoneAt && Number.isFinite(now) && Number.isFinite(startedAt) && now - startedAt < 5 * 60 * 1000;
    lines.push(stillRunning
      ? '<p class="notice" role="status" data-grade-rechecking>The other questions are still being answered. This page updates by itself.</p>'
      : '<p class="hint">We couldn\'t get answers to every question this time. The ones we got are below.</p>');
  }
  if (seconds.length > 0 && !stacked) {
    if (main.length === 0) {
      lines.push(limitHit
        ? `<p>We couldn't ask ${h(mainLabel)} because today's limit for AI questions was reached, so this check has no AI score. The answers from ${h(joinAnd(others))} are here so you can compare.</p>`
        : `<p>${h(mainLabel)} didn't answer, so this check has no AI score. The answers from ${h(joinAnd(others))} are here so you can compare.</p>`);
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
    // Batch 5 K1: an answer stored without its question falls back to the question "What AI says" shows; never the
    // word "undefined". With nothing to show, the heading is left out.
    // Batch 6 item 10: the fallback is used only when no answer kept its question. An answer without one next to answers
    // with one gets a neutral heading, so it is never shown under a question it didn't answer.
    const hasQuestion = q => typeof q === 'string' && q.trim() !== '';
    const noneSaved = all.every(a => !hasQuestion(a.prompt));
    const question = hasQuestion(p) ? p
      : noneSaved ? ([firstPrompt, freeQuestion(grade.input)].find(hasQuestion) ?? '') : NO_QUESTION_SAVED;
    const heading = question ? `<strong>${h(question)}</strong>` : '';
    // 13.3: the evidence for each answer, right under the question it answers.
    return `<li>${heading}${entries.map(a => `
      <p>${label(a)}: ${h(outcome(a, grade.input))}</p>
      <p class="hint grade-evidence">${h(evidence(a, providerLabel(a.provider)))}</p>
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

/** Batch 5 K12: shown on a kit box whose check already passed. */
export const ALREADY_HAVE = 'You already have one. Use this only if you want to replace it.';

/** Profile addresses on the business's own website (Facebook, Instagram, Yelp, TikTok, LinkedIn), for `sameAs` (K13). */
const PROFILE_DOMAINS = new Set(['facebook.com', 'instagram.com', 'yelp.com', 'tiktok.com', 'linkedin.com']);
function profileLinks(grade) {
  const links = Array.isArray(grade?.facts?.links) ? grade.facts.links : [];
  const out = [];
  for (const l of links) {
    const href = typeof l === 'string' ? l : l?.href;
    let u;
    try {
      u = new URL(String(href));
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || !PROFILE_DOMAINS.has(registeredDomain(u.href))) continue;
    // A share button or the site's own home page is never the business's profile.
    if (/share|sharer|intent/i.test(u.pathname) || u.pathname.replace(/\/+$/, '') === '') continue;
    out.push(`${u.origin}${u.pathname.replace(/\/+$/, '')}`);
  }
  return [...new Set(out)].slice(0, 5);
}

function fixKit(grade, contactEmail, { offer = true } = {}) {
  const i = grade.input;
  const found = foundOf(grade);
  const kit = {
    name: i.name, service: i.service, city: i.city, state: i.state,
    phone: found.phone ?? '', website: i.website ?? '', address: found.address ?? '', hours: readableHours(found.hours),
  };
  // The business label wants schema.org's own hours format; free text like "Monday to Friday, 8 am to 5 pm" is left out of it.
  const labelKit = { ...kit, hours: schemaHours(found.hours), noStorefront: i.noStorefront === true, sameAs: profileLinks(grade) };
  const intro = i.website
    ? 'Send this kit to whoever looks after your website. Each box says where it goes, and the Copy button copies it.'
    : 'This kit is ready for when you have a website. Hand it to whoever builds it. Each box says where it goes, and the Copy button copies it.';
  const passed = id => resultsOf(grade).some(r => r.id === id && r.result === 'pass');
  const name = (id, fallback) => reportName(id, i, fallback);
  const label = jsonLdBlock(labelKit, { placeholders: true });
  const items = [
    ['kit-title', name('title-city-service', 'Page title'), 'Use this as your home page title.', suggestedTitle(kit), passed('title-city-service')],
    ['kit-summary', name('summary', 'Page summary'), 'Use this as the summary Google shows under your title.', suggestedSummary(kit), passed('summary')],
    ['kit-label', name('business-labeled', 'Business label for AI'),
      // K13: the technical term once, the address too, and a plain warning when a placeholder is in the block (V137).
      // V137 stays: with no phone found, the line says to put it in.
      `Paste this business label (schema.org LocalBusiness markup) into your home page so AI can read your name, phone and address.${kit.phone ? '' : ' Put your phone number in before you paste.'}${hasPlaceholder(label) ? ` ${REPLACE_CAPITALS}` : ''}`,
      label, passed('business-labeled')],
    ['kit-llms', name('info-sheet', 'Info sheet for AI (llms.txt)'), 'Save this as a plain text file named llms.txt on your website.', llmsDraft(kit), passed('info-sheet')],
  ];
  const blocked = resultsOf(grade).find(r => r.id === 'ai-bots-allowed' && r.result === 'fail')?.blocked ?? [];
  if (blocked.length > 0) {
    items.push(['kit-robots', 'robots.txt lines', 'Replace the lines that block these assistants with these lines in your robots.txt file, so they can read your website.', robotsLines(blocked), false]);
  }
  const blocks = items.map(([id, title, help, text, have]) => `<div class="kit-item">
      <h3>${h(title)}</h3>
      ${have ? `<p class="hint grade-kit-have"><strong>${h(ALREADY_HAVE)}</strong></p>\n      ` : ''}<p class="hint">${id === 'kit-label' && hasPlaceholder(text)
    ? `${h(help.replace(` ${REPLACE_CAPITALS}`, ''))} <strong>${h(REPLACE_CAPITALS)}</strong>` : h(help)}</p>
      <pre id="${id}">${h(text)}</pre>
      <button type="button" class="copy-btn button" data-copy="${id}" hidden>Copy</button>
    </div>`).join('\n    ');
  // K4: with "Prepared by" set, the report is the agency's, so it has no offer of ours.
  const offerBlock = offer ? `
<section class="grade-offer">
  <h2>Want help?</h2>
  <p>Not sure how to add these? First Answer, the team behind First Answer Pages, can apply the fixes for you. ${contactLink(contactEmail, 'Contact us')} and we will take a look.</p>
</section>` : '';
  return `<section class="grade-kit">
  <h2>Your fix kit</h2>
  <p>${intro}</p>
  ${blocks}
</section>${offerBlock}`;
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
  // One sentence, used under the recheck button and on a report with no website (V251, V257, S17).
  // Batch 5 K14: each action is named by what it does.
  // Fix B: "run a full new check", the same words as the footer ("asks AI again" would repeat the sentence's start).
  const askAgain = `To ask AI again after your changes, ${runNewLink(grade, FULL_NEW_CHECK)}.`;
  if (!grade.input.website) {
    return `<p class="hint">You didn't give a website, so there is nothing to check again. Your fix kit still has a draft you can use. ${askAgain}</p>`;
  }
  // When the AI part is what is missing, "Check again" would not bring it back; the button says what it does (V203).
  // A Grade saved by the old rescue line says "ok" but is still partial, so the state alone is not used (V225-4).
  const aiState = grade.aiMain?.state;
  const aiMissing = dailyLimitHit(grade) || (isPartialScore(grade) && aiState !== 'not_connected' && aiState !== 'off');
  const parts = [];
  if (rechecking) {
    parts.push('<p class="notice" role="status" data-grade-rechecking>Checking your website again. This page updates by itself.</p>');
  }
  if (grade.recheckFailedAt) {
    parts.push("<p class=\"notice\" role=\"alert\">We couldn't reach your website when we checked again. Your earlier results are kept.</p>");
  }
  parts.push(aiMissing
    ? `<form method="POST" action="/grade/${h(grade.id)}/recheck"><button type="submit" class="button">Recheck my website only</button></form>
  <p class="hint">Fixed something on your website? This reads your website again and doesn't ask AI again. ${askAgain}</p>`
    : `<form method="POST" action="/grade/${h(grade.id)}/recheck"><button type="submit" class="button">Check again (website only, fast)</button></form>
  <p class="hint">Fixed something? Check again to see your new score. This reads your website again and doesn't ask AI again. ${askAgain}</p>`);
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
    // Batch 5 K4: the printable report of an agency (Prepared by set) carries no sales lines of ours.
    agency: agencyOption = false,
    // Batch 6 fix B: the print page puts the health map right after the score box.
    print = false,
  } = opts;
  const prepared = cleanPreparedBy(grade.preparedBy) !== '';
  // Batch 6 fix B item 4: with "Prepared by" set, the web page follows the same rules as the printout: the agency's
  // kicker, no Free listing group, no claim panel, no header button, one small "Powered by" line.
  const agency = agencyOption === true || prepared;
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
      : `<p class="notice" role="status">We could only run the AI check. Add a website to get a score.${agency ? '' : ' A free listing gives AI something to read about the business.'}</p>`)
    : '';
  // A score that leaves out the AI part is marked as partial, and never set beside an earlier score.
  const partial = isPartialScore(grade);
  const partialLine = partial
    // "Check again" only reads the website again and never asks the AI, so it cannot give the full score back. The line
    // points at a new check instead, with the business's details filled in (V157; nothing new is spent by this page).
    // One instruction (V203): come back, then press Run a new check. The button at the bottom only reads the website.
    ? `<p class="hint grade-partial">${h(`Partial score: ${partialReason(grade)} the AI part isn't counted.`)} Come back ${limited ? 'tomorrow' : 'later'} and tap ${runNewLink(grade)} to get your full score.</p>`
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
    <p class="grade-eyebrow"><span class="grade-eyebrow-title">AI Visibility Check</span>${agency && prepared
    // Batch 6 item 2: an agency's report says whose it is, in the kicker, at the same size.
    ? `<span class="grade-eyebrow-sub grade-prepared-by">Prepared by ${h(cleanPreparedBy(grade.preparedBy))}</span>`
    : '<span class="grade-eyebrow-sub">Report &middot; First Answer Pages</span>'}</p>
    ${number}
    ${partialLine}
    ${readNotice}
    ${reachLine}
    <h1>${h(i.name)}</h1>
    <p class="grade-where">${h(i.service)} in ${h(i.city)}, ${h(i.state)}</p>
    ${failedLine}${failedLine ? `\n    <p class="hint grade-failed-note">${h(failedNote(s.counted))}</p>` : ''}
    ${noWebsite}
    ${prev}
  </div>
</div>`;

  const claim = agency
    ? `<div class="grade-fix">
  ${topFails(grade, full)}
</div>`
    : `<div class="grade-fix">
  <div>
    <h2>Your free listing in our directory</h2>
    ${previewCard(grade)}
    <form method="POST" action="/grade/${h(grade.id)}/claim"><button type="submit" class="button">Claim my free listing</button></form>
    <p class="hint">A free listing for your business in our directory, First Answer Pages. Next, check the details and send it to us. Nothing goes live until you send it and we approve it.</p>
  </div>
  ${topFails(grade, full)}
</div>`;

  const when = grade.finishedAt || grade.createdAt;
  // Batch 6 item 8: how we checked, from the real counts, before the footer.
  const method = howWeChecked(grade);
  // Batch 5 K23: who can see the report, next to the way to remove it. K4: an agency's printout ends with one line.
  const foot = `${method ? `<p class="hint grade-method"><strong>How we checked:</strong> ${h(method)}</p>\n` : ''}<p class="grade-meta">Automated check, ${h(whenText(when))}. AI assistants pick up changes over days to weeks, so ${runNewLink(grade, FULL_NEW_CHECK)} after you make fixes.</p>
<p class="hint grade-remove">Only people with this link can see this report. ${agency
    // An agency's report: the way to remove it stays (privacy), said to whoever reads it, not to the business owner.
    // Batch 6 fix C: one plain sentence, with the link on its last words.
    ? `To have this report removed, ${contactLink(contactEmail, 'contact First Answer Pages')}.`
    : `Ask us to remove this report: ${contactLink(contactEmail, contactEmail || 'contact page')}.`}</p>${agency ? `\n<p class="hint grade-powered">${POWERED_BY}</p>` : ''}`;

  const justOpened = opened && full && leadGate && unlocked
    ? '<p class="notice saved-note" role="status">Your full report is open.</p>'
    : '';

  const fullPart = full
    ? `<div class="grade-full" id="full-report">
  ${justOpened}
  ${downloadBlock(grade)}
  <p class="hint grade-print-only">${PRINT_CARDS_NOTE}</p>
  ${allChecks(grade, { agency })}
  ${answersSection(grade, { now })}
  ${fixKit(grade, contactEmail, { offer: !prepared && !agency })}
  ${recheckBlock(grade, rechecking)}
</div>`
    : leadForm(grade, { values: leadValues, errors: leadErrors });

  // The health map (high-tech-look Requirement 2): the plain list and the map of the same signals, right under the
  // score. It shows the existing score and changes nothing; the fix sentences show only in the full report.
  // `found` is what the listing card shows, so the rows and the card never disagree (J1, J2).
  const healthMap = healthMapHtml(healthModel(grade, { score: scored ? s.score : null, found: foundOf(grade), agency, ...aiHealth(grade) }), {
    full,
    // Every "Run a new check" in a reason is the report's own link (V244).
    runNew: text => runNewLink(grade, text),
    // Batch 6 fix C: on paper the map comes first, so it sits on page 1 right under the score box.
    mapFirst: print,
    // Step 1F: drill-down panels need the grade ID for the recheck form and the contact email for the help CTA.
    gradeId: grade.id,
    contactEmail,
  });

  // Requirement 13 (full report): who AI named across every answer, and the sites the answers used.
  const agencySections = full ? `${voiceSection(grade)}\n${sitesSection(grade)}` : '';

  // On screen "Who AI named" and "Sites AI used" come right after the score box (batch 6 item 5). On paper the health
  // map comes first, so the score box and the map share page 1 (batch 6 fix B item 1).
  const afterTop = print ? `${healthMap}\n${agencySections}` : `${agencySections}\n${healthMap}`;
  const body = `<section class="grade-report">
${top}
${afterTop}
${aiFree(grade, { googleLive, requester, now, secondPending })}
${claim}
${searchPreview(grade)}
${groupLines(grade, s)}
${fullPart}
${foot}
</section>`;
  return page(`AI Visibility Check for ${i.name}`, body, {
    refresh: rechecking || secondPending.length > 0 || body.includes('The other questions are still being answered.'),
    // The orb's turning particles: a small script loaded after the page; the report reads the same without it.
    scripts: [HEALTH_ORB_SCRIPT, HEALTH_DRILL_SCRIPT, HEALTH_INTERACT_SCRIPT, HEALTH_SCAN_SCRIPT],
    // Fix B item 4: no "List your business free" header button on an agency's report.
    navCta: !agency,
  });
}

/** The one-time scan when the health map first comes into view (2.10; decoration only). */
export const HEALTH_SCAN_SCRIPT = '/js/health-scan.js';

/** Batch 6 item 1: on paper the score cards list only what needs work; this line says where the rest are. */
export const PRINT_CARDS_NOTE = 'Only checks that need work are listed below. Every check is in "Health of your setup" above.';
/** Batch 6 fix B item 1: on paper the health list lists only the rows that are not green. */
export const PRINT_HEALTH_NOTE = 'Only the rows that are not green are listed here. Everything else passed.';
/** Batch 6 fix B item 5: a check that earned every point but has a fix to make it better. */
export const FULL_POINTS_TIP = 'Full points, one fix below';
/** Batch 6 item 3: the printed footer has no link to click, so it says what to do in words. */
export const PRINT_FOOTER_TAIL = 'so check again after you make fixes.';
/** Batch 6 item 9. */
export const PRINT_FOR_CLIENTS = 'Use the print page for clients; the web page above is for you.';
/** Batch 6 item 8: the last sentence of "How we checked". Never a promise that AI will name a business. */
export const SNAPSHOT_LINE = 'AI answers change from day to day, so this is a snapshot, not a ranking.';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const countWord = n => COUNT_WORDS[n] ?? String(n);
// Fix B item 10: words for one to nine ("three times"), the same as "one question".
const timesWord = n => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n <= 9 ? countWord(n) : n} times`);

/**
 * Batch 6 item 8: "How we checked", from the real counts: how many questions and how many answers came back from each
 * assistant. '' when no answer came back.
 */
export function howWeChecked(grade) {
  const answers = answersOf({ ai: aiOf(grade) });
  if (answers.length === 0) return '';
  const questions = new Set(answers.map(a => a.prompt).filter(p => typeof p === 'string' && p.trim() !== '')).size || 1;
  const counts = new Map();
  for (const a of answers) {
    const label = providerLabel(a.provider);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const main = grade.aiMain?.label && counts.has(grade.aiMain.label) ? grade.aiMain.label : [...counts.keys()][0];
  const parts = [`${main} ${timesWord(counts.get(main))}`];
  for (const [label, n] of counts) if (label !== main) parts.push(`${label} ${timesWord(n)}`);
  const asked = questions === 1 ? 'one question' : `${countWord(questions)} questions`;
  return `We asked ${asked} and got answers from ${joinAnd(parts)}. ${SNAPSHOT_LINE}`;
}

/**
 * Batch 6 item 5: one plain line under "Who AI named", from the real counts only ("Two competitors were named in every
 * answer. You were named in 3 of 5."). '' with one answer.
 */
export function voiceSummary(grade) {
  const { total, rows } = shareOfVoice(grade);
  if (total < 2) return '';
  const own = rows.find(r => r.own);
  const everywhere = rows.filter(r => !r.own && r.count === total).length;
  const lead = everywhere === 0 ? ''
    : `${capFirst(countWord(everywhere))} ${everywhere === 1 ? 'competitor was' : 'competitors were'} named in every answer. `;
  return `${lead}You were named in ${own ? own.count : 0} of ${total}.`;
}

/**
 * Batch 6 fix B item 6: the one answer in a plain sentence ("The one answer named you, and also named Ridge Plumbing
 * and Ace Drains."), with at most five other names, so it never reads as a ranking.
 */
export function oneAnswerLine(rows) {
  const own = rows.find(r => r.own);
  const others = rows.filter(r => !r.own && r.count > 0).map(r => r.name);
  const shown = others.length > 5 ? [...others.slice(0, 5), `${others.length - 5} more`] : others;
  const lead = own && own.count > 0 ? 'The one answer named you' : "The one answer didn't name you";
  if (shown.length === 0) return `${lead}.`;
  return `${lead}, and ${own && own.count > 0 ? 'also named' : 'named'} ${joinAnd(shown)}.`;
}

/** Batch 5 K14, fix B: the link that asks AI again, in the recheck line and the footer alike. */
export const FULL_NEW_CHECK = 'run a full new check';

/** Batch 5 K4: the one line about us on an agency's printable report. */
export const POWERED_BY = 'Powered by First Answer Pages';

/** The small script that turns the health map's orb (decoration only). */
export const HEALTH_ORB_SCRIPT = '/js/health-orb.js';

/** Step 1F: the drill-down interaction script for the health map. */
export const HEALTH_DRILL_SCRIPT = '/js/health-drill.js';

/** Step 1F-canvas: the interactive canvas overlay for the health map drill-down. */
export const HEALTH_INTERACT_SCRIPT = '/js/health-interact.js';

// ---- Requirement 13: the agency-grade parts of the full report --------------------------------------------------------

/**
 * Batch 5 K15: which assistants the answers came from, when there are several ("3 Claude answers plus 1 from ChatGPT
 * and 1 from Perplexity."). The main assistant first. '' when they all came from one.
 */
export function answersFromLine(grade) {
  const counts = new Map();
  for (const a of answersOf(grade)) {
    const label = providerLabel(a.provider);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  if (counts.size < 2) return '';
  const main = grade.aiMain?.label && counts.has(grade.aiMain.label) ? grade.aiMain.label : [...counts.keys()][0];
  const n = counts.get(main);
  const rest = [...counts.entries()].filter(([label]) => label !== main).map(([label, k]) => `${k} from ${label}`);
  return `${n} ${main} ${n === 1 ? 'answer' : 'answers'} plus ${joinAnd(rest)}.`;
}

/** 13.1: "Who AI named, across N answers", with the checked business always a row (even at 0), highlighted. */
export function voiceSection(grade) {
  const { total, rows } = shareOfVoice(grade);
  if (total === 0) return '';
  const body = rows.map(r => (r.own
    ? `<tr class="grade-voice-you"><td><strong>${h(r.name)}</strong> (you)</td><td>${r.count} of ${total}</td></tr>`
    : `<tr><td>${h(r.name)}</td><td>${r.count} of ${total}</td></tr>`)).join('\n      ');
  // Fix B item 6: with one answer there is nothing to rank, so a plain sentence instead of the table.
  if (total === 1) {
    return `<section class="grade-voice">
  <h2>${h('Who AI named, across 1 answer')}</h2>
  <p class="grade-voice-summary">${h(oneAnswerLine(rows))}</p>
</section>`;
  }
  const from = answersFromLine(grade);
  const summary = voiceSummary(grade);
  return `<section class="grade-voice">
  <h2>${h(`Who AI named, across ${total} ${total === 1 ? 'answer' : 'answers'}`)}</h2>${from ? `\n  <p class="hint">${h(from)}</p>` : ''}${summary ? `\n  <p class="grade-voice-summary">${h(summary)}</p>` : ''}
  <table class="grade-voice-table">
    <thead><tr><th scope="col">Business</th><th scope="col">Answers that named it</th></tr></thead>
    <tbody>
      ${body}
    </tbody>
  </table>
</section>`;
}

/** 13.2: "Sites AI used to answer", only from the sources stored on the answers. */
export function sitesSection(grade) {
  const { hasSources, rows, gaps, fromMemory } = sitesUsed(grade);
  if ((Array.isArray(grade.ai) ? grade.ai : []).length === 0) return '';
  if (!hasSources) {
    // Batch 5 K3: answers from memory list no visited sites, and the page says so in plain words.
    return `<section class="grade-sites">
  <h2>Sites AI used to answer</h2>
  <p>${fromMemory ? 'These answers came from memory, without a live web search, so no sites were visited.' : "These answers didn't list their sources."}</p>
</section>`;
  }
  const items = rows.map(r => `<li><a href="${h(r.url)}" rel="nofollow noopener noreferrer">${h(r.domain)}</a>: ${r.count === 1 ? 'cited in 1 answer' : `cited in ${r.count} answers`}${r.own ? ' <strong>(your website)</strong>' : ''}</li>`).join('\n    ');
  const gapLines = gaps.map(g => `<p class="grade-sites-gap">${h(g)}</p>`).join('\n  ');
  return `<section class="grade-sites">
  <h2>Sites AI used to answer</h2>
  <p class="hint">Only answers that used a live web search are counted here.</p>
  <ul class="grade-sites-list">
    ${items}
  </ul>${gapLines ? `\n  ${gapLines}` : ''}
</section>`;
}

/** 13.4 and 13.5: the download links and the optional "Prepared by" name. */
function downloadBlock(grade) {
  const id = h(grade.id);
  const prepared = cleanPreparedBy(grade.preparedBy);
  return `<section class="grade-download">
  <h2>Share this report</h2>
  <p><a class="button" href="/grade/${id}/print">Print or save as PDF</a> <a href="/grade/${id}/data.csv">Download data (CSV)</a></p>
  <p class="hint">"Print or save as PDF" opens a clean page for printing. Choose "Save as PDF" in your browser's print window. ${PRINT_FOR_CLIENTS}</p>
  <form method="POST" action="/grade/${id}/prepared-by" class="grade-prepared">
    <label for="prepared-by">Prepared by (optional, shows on the downloaded report)</label>
    <input id="prepared-by" name="preparedBy" type="text" maxlength="${PREPARED_BY_MAX}" value="${h(prepared)}" autocomplete="organization">
    <button type="submit" class="button-secondary">Save</button>
  </form>
</section>`;
}

/**
 * 13.4: the printable page: the full report with every answer opened, "Prepared by" at the top, and a print
 * stylesheet that hides the site's menu, buttons, forms and animation. The browser's own print window saves the PDF.
 */
export function printPage(grade, opts = {}) {
  const prepared = cleanPreparedBy(grade.preparedBy);
  // Batch 5 K4: with "Prepared by" set, the printout is the agency's: none of our sales lines, one "Powered by" line.
  const page = reportPage(grade, { ...opts, leadGate: false, agency: prepared !== '', print: true })
    // Fix B item 1: on paper the health list shows only the rows that are not green; one line says so.
    .replace('<div class="health-layout">', `<p class="hint grade-print-only">${h(PRINT_HEALTH_NOTE)}</p>\n  <div class="health-layout">`)
    // K6: words that only make sense on screen.
    .split(SEND_THIS_PAGE).join(PRINT_KIT_LINE)
    .split(', and the Copy button copies it.').join('.')
    // Batch 6 item 3: the footer's link is not on paper, so the sentence says what to do in words.
    .replace(/so <a [^>]*>[^<]*<\/a> after you make fixes\./g, PRINT_FOOTER_TAIL);
  // "Prepared by" is in the title box now (batch 6 item 2), so the print head holds only the print note.
  const head = `<div class="grade-print-head">
  <p class="hint grade-print-note">Use your browser's Print button and choose "Save as PDF".</p>
</div>`;
  // Batch 4 Y2: the print page never loads the scan, so a quick print never shows a counting score in the map.
  const scanTag = `<script type="module" src="${HEALTH_SCAN_SCRIPT}"></script>`;
  return page
    .split(scanTag).join('')
    .replace('<section class="grade-report">', `<section class="grade-report grade-print">\n${head}`)
    .replace(/<details>/g, '<details open>');
}

/** 13.4: the report's data as CSV: one row per health row, one per answer. The same facts as the page. */
export function reportCsvFor(grade) {
  const g = { ...grade, results: scoredResults(grade) };
  const prepared = cleanPreparedBy(grade.preparedBy) !== '';
  // K4: an agency's CSV has no sales lines of ours (no "claim it below").
  const model = healthModel(g, { score: null, found: foundOf(g), agency: prepared, ...aiHealth(g) });
  const s = currentScore(g);
  // Batch 5 K17: the report's own columns on every row, so many clients can sit in one sheet.
  const report = {
    business: g.input?.name ?? '', website: g.input?.websitePage || g.input?.website || '', city: g.input?.city ?? '',
    state: g.input?.state ?? '', checkDate: g.finishedAt || g.createdAt || '', score: Number.isInteger(s.score) ? s.score : null,
  };
  const groupLabel = id => GROUPS.find(x => x.id === id)?.label ?? '';
  const checkIds = new Set();
  const checks = resultsOf(g).map(r => {
    const c = checkById(r.id, g.input);
    if (!c || GROUPS.find(x => x.id === c.group)?.show === false) return null;
    checkIds.add(r.id);
    const ran = r.result === 'pass' || r.result === 'fail';
    const earned = !ran ? '' : r.id === 'ai-named' && Number.isFinite(r.earned) ? r.earned : (r.result === 'pass' ? c.points : 0);
    // One vocabulary (batch 6 item 7a): Pass, Partly, Needs work, Not checked, the same words as the score cards.
    const partlyNow = r.result === 'pass' && (checkTip(r.id, g.input, foundOf(g)) !== null
      || (r.id === 'ai-named' && Number.isFinite(r.earned) && r.earned < c.points));
    return {
      group: groupLabel(c.group), item: reportName(r.id, g.input, c.label),
      status: partlyNow ? 'Partly' : r.result === 'pass' ? 'Pass' : r.result === 'fail' ? 'Needs work' : 'Not checked',
      earned, points: c.points, detail: String(r.detail ?? ''),
    };
  }).filter(Boolean);
  // The health rows name their cluster too ("Website: Search basics"), so the groups read right in a sheet.
  // Batch 6 item 7a: a row that shows a scored Check is left out here (it has its "check" row, with points), so a pivot
  // never counts it twice. Item 2: the Free listing group is never in the CSV, with or without "Prepared by".
  // Fix B must-fix 2: matched by the Check id, and dropped only when that check row really exists, so an old report
  // with no stored result for a check keeps its health row.
  const shownByCheck = sub => checkIds.has(CHECK_ROW_IDS.get(sub.name));
  const health = model.mains.filter(m => m.id !== 'listing').flatMap(m => m.subs.filter(sub => !shownByCheck(sub)).map(sub => ({
    group: sub.cluster ? `${m.name}: ${sub.cluster}` : m.name, item: sub.name, status: sub.label, detail: sub.reason ?? '',
  })));
  // Batch 4 Y4: the same answers as "Who AI named, across N answers" (an answer with no text is skipped).
  const answers = answersOf({ ai: aiOf(g) }).map(a => ({
    engine: providerLabel(a.provider),
    model: typeof a.model === 'string' ? a.model : '',
    webSearch: a.webSearch === true,
    question: String(a.prompt ?? ''),
    named: a.named === true,
    answer: readableAnswer(a.answer ?? ''),
    businesses: [...(a.named === true ? [String(g.input?.name ?? '')] : []),
      ...(Array.isArray(a.competitors) ? a.competitors.filter(n => typeof n === 'string' && n.trim() !== '') : [])],
    // K3: cited sites only for an answer that used a live web search.
    sites: a.webSearch === true && Array.isArray(a.sources)
      ? [...new Set(a.sources.map(src => src?.url).filter(u => typeof u === 'string' && /^https?:\/\//i.test(u)))]
      : [],
    date: typeof a.at === 'string' ? a.at : '',
  }));
  const voice = shareOfVoice(g);
  const named = voice.rows.map(r => ({ ...r, total: voice.total }));
  const sites = sitesUsed(g).rows;
  return reportCsv({ report, preparedBy: grade.preparedBy, checks, health, answers, named, sites });
}

/**
 * Under "N of M checks need work": what the count is, said about the owner's report (Step 2 reader reviews H10, J9):
 * "13 checks make up your score. The lights below also show extra checks that don't count toward it."
 */
export function failedNote(counted) {
  const lead = counted === 1 ? '1 check makes up your score.' : `${counted} checks make up your score.`;
  // Batch 6 nit 13: "the map", not "the lights" (jargon).
  return `${lead} The map also shows extra checks that don't count toward your score.`;
}

/**
 * The AI answers node of the health map: one sub-node per answer to the free question, in the report's own words
 * ("Named you" or "Didn't name you"), and the node's status from the `ai-named` row (Pass, Partly, Needs work).
 */
function aiHealth(grade) {
  const answers = freeAnswersOf(Array.isArray(grade.ai) ? grade.ai : []);
  const row = resultsOf(grade).find(r => r && r.id === 'ai-named');
  const points = CHECKS.find(c => c.id === 'ai-named')?.points ?? 30;
  let aiStatus = 'not_checked';
  if (row?.result === 'pass') aiStatus = Number.isFinite(row.earned) && row.earned < points ? 'partly' : 'good';
  else if (row?.result === 'fail') aiStatus = 'missing';
  const aiRows = answers.map((a, k) => ({
    name: `Answer ${k + 1} (${providerLabel(a.provider)})`,
    status: a.named ? 'good' : 'missing',
    label: a.named ? 'Named you' : "Didn't name you",
  }));
  // No answer: no "Answer 1" row, one plain line instead (Step 2 reader review H5).
  let aiReason;
  if (aiRows.length === 0) {
    const state = grade.aiMain?.state;
    aiReason = dailyLimitHit(grade) || state === 'limit'
      ? "Today's limit for AI questions was reached. Run a new check tomorrow to see what AI assistants say about you."
      : state === 'not_connected' || state === 'off' ? "The AI check isn't connected yet."
        : "The AI assistant didn't reply this time. Run a new check later to see what it says about you.";
  }
  return { aiRows, aiStatus, aiReason };
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

/** A date as "November 24, 2026" (the owner's time zone). */
export function fairUseDay(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
    : '';
}

/** The sentences of the "checked recently" page (high-tech-look 11.2), each 160 characters or less. */
export function repeatCheckLines({ checkedAt, againAt }) {
  return [
    `This business was checked on ${fairUseDay(checkedAt)}.`,
    'Open that report and use Check again to see your website changes.',
    `AI assistants usually take days to weeks to notice changes, so we ask them again after ${fairUseDay(againAt)}.`,
  ];
}

/**
 * Fair use (high-tech-look Requirement 11): a new check of a business checked in the last days. No new AI check runs.
 * The button to the earlier report shows only to the browser that ran it (`showLink`); anyone else sees the same
 * words, the date, and no link to the report.
 */
export function repeatCheckPage({ gradeId, checkedAt, againAt, showLink = false }) {
  const lines = repeatCheckLines({ checkedAt, againAt });
  const button = showLink && typeof gradeId === 'string'
    ? `<p><a class="button" href="/grade/${h(gradeId)}">Open that report</a></p>`
    : '<p><a href="/grade">Back to the check</a></p>';
  const body = `<section class="message grade-repeat">
  <h1>This business was checked recently</h1>
  ${lines.map(l => `<p>${h(l)}</p>`).join('\n  ')}
  ${button}
</section>`;
  return page('This business was checked recently', body);
}

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
    <li>We ask Claude up to 3 questions. We ask the first question up to 3 times, because AI answers change. The questions name the kind of business and the city, never the business name.</li>
    <li>When it's switched on, we use Google's Gemini as a checker to see whether each answer names the business. Each answer, with the business name, city and state, is sent to it for that. Otherwise we look for the name in the answer ourselves.</li>
    <li>When we can, ChatGPT, Gemini, Grok and Perplexity are asked the same questions so the answers can be compared. Only Claude's answers to the first question count toward the score.</li>
    <li>The person who ran the check can also see what Google's AI says right now. It is private to them, and we never save it, score it or share it.</li>
  </ul>
  <h2>Your report</h2>
  <p>Reports are not listed in search engines and are deleted after 90 days. To ask us to remove one sooner, ${contactLink(contactEmail, contactEmail ? `email ${contactEmail}` : 'use the contact details on our About page')}.</p>
  <p><a href="/grade">Check a business</a></p>
</section>`;
  return page('About the AI Visibility Check', body, indexable === true
    ? { indexable: true, canonical, description: ABOUT_SEARCH_DESCRIPTION }
    : {});
}
