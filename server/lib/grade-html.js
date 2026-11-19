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
import {
  providerLabel, freeQuestion, stepNames, foundOf, isSecondOpinion, schemaHours,
} from './grader.js';

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">';
const REFRESH_NOSCRIPT = '<noscript><meta http-equiv="refresh" content="3"></noscript>';

function page(title, body, { refresh = false } = {}) {
  return layout({
    title,
    body,
    scripts: ['/js/grade.js'],
    head: `${ROBOTS_META}${refresh ? `\n  ${REFRESH_NOSCRIPT}` : ''}`,
  });
}

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

const resultsOf = grade => (Array.isArray(grade.results) ? grade.results : []);
const aiOf = grade => (Array.isArray(grade.ai) ? grade.ai : []);

// ---- the form ------------------------------------------------------------------------

function field({ id, name, label, value, hint, error, attrs = '' }) {
  return `<div class="field${error ? ' missing' : ''}">
    <label for="${id}">${label}</label>
    <input type="text" id="${id}" name="${name}" value="${h(value ?? '')}"${error ? ` aria-invalid="true" aria-describedby="${id}-err"` : ''}${attrs}>
    ${hint ? `<span class="hint">${hint}</span>` : ''}
    ${error ? `<span class="hint" id="${id}-err" role="alert">${h(error)}</span>` : ''}
  </div>`;
}

/**
 * @param {{ values?: object, errors?: object, stamp?: string, categories?: object[] }} [opts]
 */
export function gradeFormPage({ values = {}, errors = {}, stamp = '', categories = [] } = {}) {
  const options = (Array.isArray(categories) ? categories : [])
    .filter(c => c && c.slug !== 'other' && typeof c.label === 'string' && c.label !== '')
    .map(c => `<option value="${h(c.label)}"></option>`)
    .join('');
  const body = `<section class="grade-start">
  <h1>Can AI find your business?</h1>
  <p class="tagline">Get a free check in about two minutes. We ask an AI assistant who it would name, and we look at what AI can read on your website.</p>
  ${errors.form ? `<p class="notice" role="alert">${h(errors.form)}</p>` : ''}
  <form class="rise-form" method="POST" action="/grade">
    ${field({ id: 'g-name', name: 'name', label: 'Business name', value: values.name, error: errors.name, attrs: ' autocomplete="organization"' })}
    ${field({ id: 'g-city', name: 'city', label: 'City', value: values.city, error: errors.city, attrs: ' autocomplete="address-level2"' })}
    ${field({ id: 'g-state', name: 'state', label: 'State', value: values.state, hint: '2 letters, like TN', error: errors.state, attrs: ' autocomplete="address-level1"' })}
    ${field({ id: 'g-service', name: 'service', label: 'What you do', value: values.service, hint: 'Like roofers, plumbers or restaurants', error: errors.service, attrs: ' list="service-suggestions"' })}
    <datalist id="service-suggestions">${options}</datalist>
    ${field({ id: 'g-website', name: 'website', label: 'Your website (optional)', value: values.website, hint: 'Like example.com. Leave it empty if you do not have one.', error: errors.website, attrs: ' inputmode="url" autocapitalize="none"' })}
    <p class="hp" aria-hidden="true"><label>Leave this empty <input type="text" name="nickname" value="" tabindex="-1" autocomplete="off"></label></p>
    <input type="hidden" name="t" value="${h(stamp)}">
    <button type="submit" class="button">Check my business</button>
  </form>
  <p class="hint"><a href="/grade/about">What do we read, and why?</a></p>
</section>`;
  return page('Can AI find your business?', body);
}

// ---- the scan -------------------------------------------------------------------------

/** The page shown while a Grade runs. */
export function scanPage(grade) {
  const names = stepNames(grade.input);
  const done = new Map((Array.isArray(grade.steps) ? grade.steps : []).map(s => [s.name, s]));
  const firstOpen = names.findIndex(n => !done.has(n));
  const items = names.map((name, i) => {
    const step = done.get(name);
    let cls = 'waiting';
    let mark = 'Waiting';
    if (step) {
      cls = step.state === 'skipped' ? 'done skipped' : step.state === 'failed' ? 'done failed' : 'done';
      mark = step.state === 'skipped' ? 'Skipped' : step.state === 'failed' ? 'Problem' : 'Done';
    } else if (i === firstOpen || (i === 3 && firstOpen !== 4)) {
      cls = 'running';
      mark = 'Working';
    }
    return `<li class="grade-step ${cls}"><span class="step-mark">${mark}</span><span class="step-name">${h(name)}</span>${step?.finding ? `<span class="finding">${h(step.finding)}</span>` : ''}</li>`;
  }).join('\n    ');
  const body = `<section class="grade-scan" data-grade-scan data-status-url="/grade/${h(grade.id)}/status.json">
  <h1>Checking ${h(grade.input.name)}</h1>
  <p class="tagline">This takes about two minutes. You can leave this page open.</p>
  <ol class="grade-steps">
    ${items}
  </ol>
</section>`;
  return page(`Checking ${grade.input.name}`, body, { refresh: true });
}

/** The page for a Grade that did not finish. `stamp` lets "Start again" post the same details. */
export function failedPage(grade, { stamp = '' } = {}) {
  const i = grade.input ?? {};
  const hidden = ['name', 'city', 'state', 'service', 'website']
    .map(k => `<input type="hidden" name="${k}" value="${h(i[k] ?? '')}">`)
    .join('\n    ');
  const body = `<section class="message">
  <h1>This check didn't finish</h1>
  <p>Something took longer than expected, so we stopped. Nothing was lost. You can start again with the same details.</p>
  <form method="POST" action="/grade">
    ${hidden}
    <input type="hidden" name="t" value="${h(stamp)}">
    <button type="submit" class="button">Start again</button>
  </form>
  <p><a href="/grade">Change the details</a></p>
</section>`;
  return page("This check didn't finish", body);
}

// ---- pieces of the report ---------------------------------------------------------------

/** One sentence about what an answer did with the business. */
function outcome(a) {
  if (a.named) {
    if (Number.isInteger(a.position) && Number.isInteger(a.total) && a.total > 0) {
      const tail = a.nameCheck?.addedNamed
        ? ', but it was spelled a little differently from how you wrote it. We still counted it.'
        : '.';
      return `It listed ${plural(a.total, 'business', 'businesses')}, and yours was ${ordinal(a.position)}${tail}`;
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

function answerBlock(a) {
  return `${a.provider === 'mock' ? '<p class="hint">Demo answer (no AI connected)</p>\n  ' : ''}<details><summary>See the full answer</summary><div class="grade-answer">${h(a.answer ?? '')}</div></details>`;
}

function competitorList(a) {
  const list = Array.isArray(a.competitors) ? a.competitors : [];
  return !a.named && list.length > 0
    ? `<ol class="grade-competitors">${list.map(n => `<li>${h(n)}</li>`).join('')}</ol>`
    : '';
}

/** The AI part of the free report. */
function aiFree(grade, { googleLive, requester }) {
  const all = aiOf(grade);
  const prompt = freeQuestion(grade.input);
  const first = all.find(a => !isSecondOpinion(a) && a.prompt === prompt) ?? all.find(a => !isSecondOpinion(a));
  const seconds = all.filter(a => isSecondOpinion(a) && (a.prompt === (first?.prompt ?? prompt)));
  const mainLabel = grade.aiMain?.label ?? (first ? providerLabel(first.provider) : 'The assistant');
  const parts = [];

  if (first) {
    const lead = first.reusedFrom
      ? `We asked ${inline(first.provider)} on ${h(whenText(first.reusedFrom))}.`
      : `We just asked ${inline(first.provider)}.`;
    parts.push(`<p>${lead} ${h(outcome(first))}</p>`, competitorList(first), answerBlock(first));
  } else if (seconds.length > 0) {
    parts.push(`<p>${h(mainLabel)} did not answer this time, so this check has no AI score.</p>`);
  } else {
    const why = grade.aiMain?.state === 'limit'
      ? "The daily limit for AI checks was reached. You can run the check again later."
      : grade.aiMain?.state === 'not_connected'
        ? 'The AI check is not connected yet.'
        : "AI didn't answer this time. You can run the check again later.";
    parts.push(`<p>We couldn't ask AI this time. ${why}</p>`);
  }

  if (seconds.length > 0) {
    if (first) {
      parts.push('<h3>Other AI assistants, for comparison only (not scored):</h3>');
      for (const s of seconds) {
        parts.push(`<p>${h(providerLabel(s.provider))}, asked the same question: ${h(outcome(s))}</p>`);
        if (s.provider === 'gemini' && s.webSearch !== true) parts.push('<p class="hint">Gemini answered without a live web search.</p>');
        parts.push(competitorList(s), answerBlock(s));
      }
    } else {
      parts.push('<p class="hint">These answers are for comparison only (not scored).</p>');
      for (const s of seconds) {
        parts.push(`<p>We just asked ${h(providerLabel(s.provider))}. ${h(outcome(s))}</p>`);
        if (s.provider === 'gemini' && s.webSearch !== true) parts.push('<p class="hint">Gemini answered without a live web search.</p>');
        parts.push(competitorList(s), answerBlock(s));
      }
    }
  }

  if (googleLive) {
    parts.push(requester
      ? `<form method="post" action="/grade/${h(grade.id)}/google-live"><button type="submit" class="button">Show Google's live answer</button></form>`
      : '<p class="hint">Google\'s live answer is private to the person who ran the check, so it is not shown here.</p>');
  }
  return `<section class="grade-ai">
  <h2>What AI says</h2>
  ${parts.filter(Boolean).join('\n  ')}
</section>`;
}

function previewCard(grade) {
  const i = grade.input;
  const found = foundOf(grade);
  const hours = Array.isArray(found.hours) && found.hours.length ? found.hours.map(x => h(x)).join('; ') : blank('Add your hours');
  return `<div class="grade-preview">
    <h3>${h(i.name)}</h3>
    <p>${h(i.service)} in ${h(i.city)}, ${h(i.state)}</p>
    <p>Phone: ${found.phone ? `<span class="phone">${h(found.phone)}</span>` : blank('Add your phone number')}</p>
    <p>Hours: ${hours}</p>
    <p>Address: ${found.address ? h(found.address) : blank('Add your address')}</p>
    <p>Website: ${i.website ? h(i.website) : blank('Add your website')}</p>
  </div>`;
}

function topFails(grade) {
  const fails = resultsOf(grade)
    .filter(r => r.result === 'fail' && checkById(r.id))
    .sort((a, b) => checkById(b.id).points - checkById(a.id).points)
    .slice(0, 3);
  if (fails.length === 0) return '';
  return `<div class="grade-top-fails">
    <h2>Fix these first</h2>
    <ul>${fails.map(r => `<li><strong>${h(checkById(r.id).label)}</strong><br>${h(checkById(r.id).fix)}</li>`).join('')}</ul>
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

function groupLines(grade) {
  const results = resultsOf(grade);
  const lines = [];
  for (const g of GROUPS) {
    if (g.show === false) continue;
    const ids = new Set(CHECKS.filter(c => c.group === g.id).map(c => c.id));
    const mine = results.filter(r => ids.has(r.id));
    if (mine.length === 0) continue;
    let text;
    if (g.id === 'ai_answers') {
      text = mine[0].detail ?? '';
    } else {
      const counted = mine.filter(r => r.result !== 'not_checked');
      const passed = counted.filter(r => r.result === 'pass').length;
      text = counted.length === 0
        ? 'Not checked'
        : `${passed} of ${counted.length} ${counted.length === 1 ? 'check passes' : 'checks pass'}`;
    }
    lines.push(`<li><strong>${h(g.label)}:</strong> ${h(text)}</li>`);
  }
  return lines.length ? `<ul class="grade-groups">${lines.join('')}</ul>` : '';
}

function checkRow(r) {
  const c = checkById(r.id);
  if (!c) return '';
  const cls = r.result === 'fail' ? 'fail' : r.result === 'pass' ? 'pass' : 'not_checked';
  const word = { pass: 'Pass', fail: 'Needs work', not_checked: 'Not checked' }[cls];
  let points = 'Not counted';
  if (cls !== 'not_checked') {
    const earned = r.id === 'ai-named' && Number.isFinite(r.earned) ? r.earned : (cls === 'pass' ? c.points : 0);
    points = `${earned} of ${c.points} points`;
  }
  return `<li class="grade-check ${cls}"><span class="grade-result">${word}</span><strong>${h(c.label)}</strong><br><span class="grade-points">${points}</span><p>${h(r.detail ?? '')}</p>${cls === 'fail' ? `<p><strong>Fix:</strong> ${h(c.fix)}</p>` : ''}</li>`;
}

function allChecks(grade) {
  const results = resultsOf(grade);
  return GROUPS.filter(g => g.show !== false).map(g => {
    const ids = new Set(CHECKS.filter(c => c.group === g.id).map(c => c.id));
    const rows = results.filter(r => ids.has(r.id)).map(checkRow).join('\n    ');
    return rows ? `<section class="grade-group">
    <h2>${h(g.label)}</h2>
    <ul class="grade-checks">
    ${rows}
    </ul>
  </section>` : '';
  }).join('\n  ');
}

/** The full list of answers, with how many named the business. */
function answersSection(grade) {
  const all = aiOf(grade);
  if (all.length === 0) return '';
  const main = all.filter(a => !isSecondOpinion(a));
  const seconds = all.filter(a => isSecondOpinion(a));
  const mainLabel = grade.aiMain?.label ?? (main[0] ? providerLabel(main[0].provider) : 'The assistant');
  const lines = [];
  if (main.length > 1) lines.push(`<p><strong>Named in ${main.filter(a => a.named).length} of ${main.length} answers.</strong></p>`);
  if (seconds.length > 0) {
    const others = [...new Set(seconds.map(s => providerLabel(s.provider)))];
    if (main.length === 0) {
      lines.push(`<p>${h(mainLabel)} did not answer, so this check has no AI score. The answers from ${h(joinAnd(others))} are here so you can compare.</p>`);
    } else {
      const q = main.length;
      if (q > 1) lines.push(`<p>${h(mainLabel)} named your business in ${main.filter(a => a.named).length} of its ${q} answers.</p>`);
      lines.push(`<p>We asked ${h(joinAnd([mainLabel, ...others]))} the same ${q === 1 ? 'question' : `${q} questions`}. Only ${h(mainLabel)}'s answers count toward your score, so your score stays steady from check to check. ${others.length === 1 ? `${h(others[0])}'s answers are` : "The other assistants' answers are"} below so you can compare.</p>`);
    }
  }
  const prompts = [...new Set(all.map(a => a.prompt))];
  const items = prompts.map(p => {
    const entries = all.filter(a => a.prompt === p);
    return `<li><strong>${h(p)}</strong>${entries.map(a => `
      <p>${h(providerLabel(a.provider))}${isSecondOpinion(a) ? ' (for comparison only)' : ''}: ${h(outcome(a))}</p>
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
    phone: found.phone ?? '', website: i.website ?? '', address: found.address ?? '', hours: found.hours ?? [],
  };
  // The business label wants schema.org's own hours format; free text like "Monday to Friday, 8 am to 5 pm" is left out of it.
  const labelKit = { ...kit, hours: schemaHours(found.hours) };
  const items = [
    ['kit-title', 'Page title', 'Use this as your home page title.', suggestedTitle(kit)],
    ['kit-summary', 'Page summary', 'Use this as the summary Google shows under your title.', suggestedSummary(kit)],
    ['kit-label', 'Business label for AI', 'Paste this into your home page so AI can read your name and phone.', jsonLdBlock(labelKit)],
    ['kit-llms', 'Info sheet for AI (llms.txt)', 'Save this as a plain text file named llms.txt on your website.', llmsDraft(kit)],
  ];
  const blocked = resultsOf(grade).find(r => r.id === 'ai-bots-allowed' && r.result === 'fail')?.blocked ?? [];
  if (blocked.length > 0) {
    items.push(['kit-robots', 'robots.txt lines', 'Add these lines to your robots.txt file so these AI assistants can read your website.', robotsLines(blocked)]);
  }
  const blocks = items.map(([id, title, help, text]) => `<div class="kit-item">
      <h3>${h(title)}</h3>
      <p class="hint">${h(help)}</p>
      <pre id="${id}">${h(text)}</pre>
      <button type="button" class="copy-btn button" data-copy="${id}" hidden>Copy</button>
    </div>`).join('\n    ');
  return `<section class="grade-kit">
  <h2>Your fix kit</h2>
  ${blocks}
</section>
<section class="grade-offer">
  <h2>Want help?</h2>
  <p>Not sure how to add these? First Answer can apply the fixes for you. ${contactLink(contactEmail, 'Contact us')} and we will take a look.</p>
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
        ${bad ? `<span class="hint" id="l-err-${k}" role="alert">${h(errors[k])}</span>` : ''}
      </div>`;
  };
  const anyError = keys.some(k => errors[k]);
  return `<section class="grade-lead" id="unlock">
  <h2>See every check and the fixes</h2>
  <p>Tell us where to send it. You will see each check, what to change, and a fix kit you can copy and paste.</p>
  ${anyError ? '<p class="notice" role="alert">Please fix the highlighted fields.</p>' : ''}
  <form class="rise-form" method="POST" action="/grade/${h(grade.id)}/unlock">
      ${input('name', 'text', 'Your name', 'name')}
      ${input('email', 'email', 'Your email', 'email')}
      ${input('phone', 'tel', 'Your phone', 'tel')}
      <label class="check"><input type="checkbox" name="okToContact" value="1"${values.okToContact ? ' checked' : ''}> OK for First Answer Pages to call, text or email me about my report</label>
      <button type="submit" class="button">Show me my full report</button>
  </form>
</section>`;
}

function recheckBlock(grade, rechecking) {
  if (!grade.input.website) {
    return '<p class="notice">You did not give a website, so there is nothing to check again. Your fix kit still has a draft you can use.</p>';
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
  return `<section class="grade-recheck">\n  ${parts.join('\n  ')}\n</section>`;
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
export function reportPage(grade, opts = {}) {
  const {
    unlocked = false, leadGate = true, contactEmail = '', opened = false,
    googleLive = false, requester = false, leadValues, leadErrors,
    // A recheck that was cut off (for example by a restart) stops counting after 4 minutes; the route works that out.
    rechecking = false,
  } = opts;
  const i = grade.input;
  const full = !leadGate || unlocked;
  const s = grade.score ?? {};
  const scored = Number.isInteger(s.score);
  const failedLine = scored && Number.isInteger(s.failed) && Number.isInteger(s.counted)
    ? `<p class="grade-failed">${s.counted === 1 ? `${s.failed} of 1 check needs work` : `${s.failed} of ${s.counted} checks need work`}</p>`
    : '';
  const number = scored
    ? `<p class="grade-score-number"><span class="num">${s.score}</span><span class="of">out of 100</span></p>`
    : '<p class="grade-score-number"><span class="num-text">Not enough to score yet</span></p>';
  const noWebsite = !i.website
    ? '<p class="notice" role="status">We could only run the AI check. Add a website to get a score. A free listing gives AI something to read about the business.</p>'
    : '';
  const prev = Number.isInteger(grade.previousScore) && scored && grade.recheckedAt
    ? `<p class="grade-prev">Your score was ${grade.previousScore} before. It is ${s.score} now.</p>`
    : '';

  const top = `<div class="grade-top">
  <div class="grade-score">
    <p class="grade-eyebrow"><span class="grade-eyebrow-title">Your AI score</span><span class="grade-eyebrow-sub">How easily AI can find and name your business</span></p>
    ${number}
    <h1>${h(i.name)}</h1>
    <p class="grade-where">${h(i.service)} in ${h(i.city)}, ${h(i.state)}</p>
    ${failedLine}
    ${noWebsite}
    ${prev}
  </div>
</div>`;

  const claim = `<div class="grade-fix">
  <div>
    <h2>Your free listing</h2>
    ${previewCard(grade)}
    <form method="POST" action="/grade/${h(grade.id)}/claim"><button type="submit" class="button">Claim my free listing</button></form>
    <p class="hint">Nothing goes live until you do.</p>
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
  ${answersSection(grade)}
  ${recheckBlock(grade, rechecking)}
  ${fixKit(grade, contactEmail)}
</div>`
    : leadForm(grade, { values: leadValues, errors: leadErrors });

  const body = `<section class="grade-report">
${top}
${aiFree(grade, { googleLive, requester })}
${claim}
${searchPreview(grade)}
${groupLines(grade)}
${fullPart}
${foot}
</section>`;
  return page(`AI score for ${i.name}`, body, { refresh: rechecking });
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
  <p class="hint">We asked Google's AI, with a live search, the same question: ${h(freeQuestion(grade.input))} This answer is shown once, only to you. We do not save it and it does not change your score.</p>
  <div class="grade-answer">${h(text)}</div>
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

export const notFoundPage = () => messagePage('Page not found', 'We could not find that report. It may have been removed.');

/** What the Grader reads and why. */
export function aboutPage({ contactEmail = '' } = {}) {
  const body = `<section class="message">
  <h1>About the AI Visibility Grader</h1>
  <p>Someone typed your website into our free check, so our bot visited it. This page says what it does.</p>
  <h2>What it reads</h2>
  <ul>
    <li>Your home page.</li>
    <li>Your robots.txt file, to see which AI assistants it lets in.</li>
    <li>Your llms.txt file, if you have one.</li>
  </ul>
  <h2>What it does not do</h2>
  <ul>
    <li>It reads each page at most once per check.</li>
    <li>It does not run scripts on your site.</li>
    <li>It does not log in, fill in forms or send cookies.</li>
    <li>It only visits public websites.</li>
  </ul>
  <h2>Remove a report</h2>
  <p>To have a report removed, ${contactLink(contactEmail, contactEmail ? `email ${contactEmail}` : 'use the contact details on our About page')}. Reports are also deleted after 90 days.</p>
  <p><a href="/grade">Check a business</a></p>
</section>`;
  return page('About the AI Visibility Grader', body);
}
