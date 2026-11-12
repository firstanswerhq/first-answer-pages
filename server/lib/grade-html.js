/**
 * grade-html.js — every page of the AI Visibility Grader.
 *
 * Every dynamic value goes through escapeHtml, and AI answers and fetched page
 * text are always shown as text. Wording: plain American English, no dollar
 * figures, and never a promise that a listing or a fix will make an AI
 * assistant name a business (changes are picked up over days to weeks).
 */

import { layout, escapeHtml } from './html.js';
import { DEFAULT_SITE_NAME } from './config.js';
import { STATE_HINT } from './listing-fields.js';
import { formatRunTime, DEMO_LABEL } from './seance-html.js';
import { CHECKS, GROUPS } from './grade-checks.js';
import { stepNames, foundFromGrade } from './grader.js';
import {
  suggestedTitle, suggestedSummary, jsonLdBlock, llmsDraft, robotsLines,
} from './fix-kit.js';

const NOINDEX = '<meta name="robots" content="noindex, nofollow">';
const SCRIPTS = ['/js/grade.js'];

/** Groups shown in version one (the Google group is not shown yet). */
const SHOWN_GROUPS = Object.freeze(['ai_answers', 'ai_readable', 'search_basics', 'customer_basics']);

const page = (title, body, head = '') => layout({
  title, body, head: `${NOINDEX}${head ? `\n  ${head}` : ''}`, scripts: SCRIPTS,
});

const e = escapeHtml;

/** A short page for 404s, limits and other messages (always not indexed). */
export function gradeMessagePage(title, message, link = { href: '/grade', text: 'Grade a business' }) {
  return page(title, `<section class="message">
  <h1>${e(title)}</h1>
  <p>${e(message)}</p>
  <p><a href="${e(link.href)}">${e(link.text)}</a></p>
</section>`);
}

// ---- Form -------------------------------------------------------------------

const FIELD_DEFS = Object.freeze([
  { key: 'name', label: 'Business name', max: 120, autocomplete: 'organization' },
  { key: 'city', label: 'City', max: 80, autocomplete: 'address-level2' },
  { key: 'state', label: 'State', max: 30, hint: STATE_HINT, autocomplete: 'address-level1' },
  { key: 'service', label: 'What you do', max: 60, hint: 'For example: roofers, plumbers, hair salon.', list: 'service-suggestions' },
  { key: 'website', label: 'Your website (optional)', max: 200, type: 'text', hint: 'Leave it blank if you do not have one.', autocomplete: 'url' },
]);

function formFields(values, errors) {
  return FIELD_DEFS.map(f => {
    const err = errors[f.key];
    const describedBy = [err ? `err-${f.key}` : '', f.hint ? `hint-${f.key}` : ''].filter(Boolean).join(' ');
    return `    <div class="field${err ? ' missing' : ''}">
      <label for="g-${f.key}">${e(f.label)}</label>
      <input type="${f.type ?? 'text'}" id="g-${f.key}" name="${f.key}" value="${e(values[f.key] ?? '')}" maxlength="${f.max}"${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}${f.list ? ` list="${f.list}"` : ''}${err ? ' aria-invalid="true"' : ''}${describedBy ? ` aria-describedby="${describedBy}"` : ''}>
      ${f.hint ? `<span class="hint" id="hint-${f.key}">${e(f.hint)}</span>` : ''}
      ${err ? `<span class="missing-note" id="err-${f.key}">${e(err)}</span>` : ''}
    </div>`;
  }).join('\n');
}

/**
 * @param {{ values?: object, errors?: object, stamp?: string, categories?: { slug: string, label: string }[] }} [opts]
 */
export function gradeFormPage({ values = {}, errors = {}, stamp = '', categories = [] } = {}) {
  const options = categories
    .filter(c => c && c.slug !== 'other' && typeof c.label === 'string')
    .map(c => `<option value="${e(c.label)}"></option>`).join('');
  const problems = Object.keys(errors).length > 0
    ? `<p class="notice" role="alert">${e(errors.form ?? 'Please fix the problems below.')}</p>`
    : '';
  const body = `<section class="rise grade-start">
  <h1>Can AI find your business?</h1>
  <p class="tagline">Free check. About two minutes. No account needed.</p>
  <p>Ask an AI assistant for the best business like yours in your city. See if it names you, who it names instead, and what to fix.</p>
  ${problems}
  <form class="rise-form" method="POST" action="/grade">
${formFields(values, errors)}
    <div class="hp" aria-hidden="true">
      <label>Leave this empty <input type="text" name="nickname" tabindex="-1" autocomplete="off" value=""></label>
    </div>
    <input type="hidden" name="t" value="${e(stamp)}">
    <button type="submit" class="button">Check my business</button>
  </form>
  <datalist id="service-suggestions">${options}</datalist>
  <p class="hint">We visit your website once, only to read it. <a href="/grade/about">What we read and why</a>.</p>
</section>`;
  return page('Can AI find your business?', body);
}

// ---- Scan screen -------------------------------------------------------------

function stepStates(grade) {
  const done = new Map((grade.steps ?? []).map(s => [s.name, s]));
  const names = stepNames(grade.input);
  const websiteDone = [0, 1, 2].map(i => done.has(names[i]));
  const rows = names.map((name, i) => {
    const rec = done.get(name);
    if (rec) return { name, mark: rec.state === 'skipped' ? 'Skipped' : rec.state === 'failed' ? "Couldn't finish" : 'Done', cls: rec.state, finding: rec.finding };
    let running;
    if (i <= 2) running = i === 0 || websiteDone[i - 1];
    else if (i === 3) running = true;
    else running = names.slice(0, 4).every(n => done.has(n));
    return { name, mark: running ? 'Working' : 'Waiting', cls: running ? 'running' : 'waiting', finding: '' };
  });
  return rows;
}

function stepList(grade) {
  return stepStates(grade).map(r => `    <li class="grade-step ${e(r.cls)}"><span class="step-mark">${e(r.mark)}</span> ${e(r.name)}${r.finding ? ` <span class="finding">${e(r.finding)}</span>` : ''}</li>`).join('\n');
}

/** The scan screen shown while a Grade is running. */
export function scanPage(grade) {
  const body = `<section class="rise grade-scan" data-grade-scan data-status-url="/grade/${e(grade.id)}/status.json">
  <h1>Checking ${e(grade.input.name)}</h1>
  <p class="tagline" role="status">This takes about two minutes. This page updates by itself.</p>
  <ol class="grade-steps" aria-live="polite">
${stepList(grade)}
  </ol>
  <noscript><p>This page reloads every few seconds. You can also reload it yourself.</p></noscript>
</section>`;
  return page(`Checking ${grade.input.name}`, body, '<noscript><meta http-equiv="refresh" content="3"></noscript>');
}

// ---- Report -------------------------------------------------------------------

const ordinal = n => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] ?? 'th'}`;
};

const providerWho = name => (name === 'anthropic' ? 'Claude' : name === 'openai' ? 'OpenAI' : name === 'mock' ? 'a demo assistant' : 'an AI assistant');

const resultOf = (grade, id) => (grade.results ?? []).find(r => r.id === id);

/** One plain sentence about the first AI answer. */
function aiSentence(entry, now) {
  const justNow = !entry.reusedFrom && Number.isFinite(now) && now - Date.parse(entry.at) < 10 * 60 * 1000;
  const asked = justNow
    ? `We asked ${providerWho(entry.provider)} once just now.`
    : `We asked ${providerWho(entry.provider)} on ${formatRunTime(entry.at)}.`;
  const n = entry.competitors.length;
  let tail;
  if (entry.named) {
    tail = entry.position && entry.total > 1
      ? `It named your business ${ordinal(entry.position)} of ${entry.total}.`
      : 'It named your business.';
  } else if (n === 0) {
    tail = 'It did not name your business.';
  } else {
    tail = n === 1 ? 'It named 1 other business, not yours.' : `It named these ${n} businesses, not yours.`;
  }
  return `${asked} ${tail}`;
}

function answerBlock(entry) {
  const demo = entry.provider === 'mock' ? ` <span class="seance-demo">${DEMO_LABEL}</span>` : '';
  return `<details>
      <summary>See the AI's answer${demo}</summary>
      <blockquote class="seance-answer grade-answer">${e(entry.answer)}</blockquote>
    </details>`;
}

function aiSection(grade, now) {
  const entry = (grade.ai ?? [])[0];
  if (!entry) {
    const r = resultOf(grade, 'ai-named');
    return `<section class="grade-ai">
    <h2>What AI says</h2>
    <p>We couldn't ask AI this time${r?.detail ? ` (${e(r.detail.replace(/\.$/, ''))})` : ''}. You can run the AI check again later.</p>
  </section>`;
  }
  const list = entry.competitors.length > 0
    ? `<ol class="grade-competitors">${entry.competitors.map(c => `<li>${e(c)}</li>`).join('')}</ol>`
    : '';
  return `<section class="grade-ai">
    <h2>What AI says</h2>
    <p>${e(aiSentence(entry, now))}</p>
    ${list}
    ${answerBlock(entry)}
  </section>`;
}

function scoreSection(grade) {
  const s = grade.score ?? {};
  const big = Number.isInteger(s.score)
    ? `<p class="grade-score-number"><span class="num">${s.score}</span> <span class="of">out of 100</span></p>`
    : '<p class="grade-score-number"><span class="num-text">Not enough to score yet</span></p>';
  const failed = s.counted > 0
    ? `<p class="grade-failed">${s.failed} of ${s.counted} checks failed</p>`
    : '<p class="grade-failed">No checks could be run yet</p>';
  const prev = Number.isInteger(grade.previousScore) && Number.isInteger(s.score)
    ? `<p class="grade-prev">Before: ${grade.previousScore}. Now: ${s.score}.</p>`
    : '';
  return `<section class="grade-score">
    <h1>${e(grade.input.name)}</h1>
    <p class="grade-where">${e(grade.input.service)} in ${e(grade.input.city)}, ${e(grade.input.state)}</p>
    ${big}
    ${failed}${prev}
  </section>`;
}

function previewCard(found) {
  const blank = text => `<span class="blank">${e(text)}</span>`;
  const phone = found.phone ? e(found.phone) : blank('Add your phone number');
  const hours = found.hours.length > 0 ? e(found.hours.join('; ')) : blank('Add your hours');
  const address = found.address ? e(found.address) : blank('Add your address');
  const website = found.website ? e(found.website) : blank('Add your website');
  return `<article class="listing-card grade-preview" aria-label="Your free page, as it would look">
      <h3><strong>${e(found.name)}</strong> <span class="phone">${phone}</span></h3>
      <p>${e(found.service)} &middot; ${e(found.city)}, ${e(found.state)}</p>
      <p>${address}</p>
      <p>Hours: ${hours}</p>
      <p>${website}</p>
    </article>`;
}

function topFailed(grade) {
  const order = new Map(CHECKS.map((c, i) => [c.id, i]));
  const byId = new Map(CHECKS.map(c => [c.id, c]));
  return (grade.results ?? [])
    .filter(r => r.result === 'fail' && byId.has(r.id))
    .sort((a, b) => byId.get(b.id).points - byId.get(a.id).points || order.get(a.id) - order.get(b.id))
    .slice(0, 3)
    .map(r => `<li><strong>${e(byId.get(r.id).label)}.</strong> ${e(r.detail)}</li>`)
    .join('');
}

function fixSection(grade) {
  const found = foundFromGrade(grade);
  const failed = topFailed(grade);
  return `<div class="grade-fix">
    <section class="grade-claim">
      <h2>Your free page</h2>
      ${previewCard(found)}
      <form method="POST" action="/grade/${e(grade.id)}/claim">
        <button type="submit" class="button">Claim my free page</button>
      </form>
      <p class="hint">Goes live after you check it and we approve it.</p>
    </section>
    ${failed ? `<section class="grade-top-fails"><h2>Fix these first</h2><ul>${failed}</ul></section>` : ''}
  </div>`;
}

function googleSection(grade) {
  const found = foundFromGrade(grade);
  const facts = grade.facts;
  const nowTitle = facts?.title ? e(facts.title) : '<span class="blank">No page title found</span>';
  const nowDesc = facts?.metaDescription ? e(facts.metaDescription) : '<span class="blank">No search summary found</span>';
  const host = (() => {
    try { return new URL(grade.input.website).hostname; } catch { return ''; }
  })();
  return `<section class="grade-google">
    <h2>How you look in search</h2>
    <div class="grade-before-after">
      <div class="serp serp-before">
        <h3>Now</h3>
        <p class="serp-title">${nowTitle}</p>
        <p class="serp-url">${host ? e(host) : '<span class="blank">No website</span>'}</p>
        <p class="serp-desc">${nowDesc}</p>
      </div>
      <div class="serp serp-after">
        <h3>With the fixes</h3>
        <p class="serp-title">${e(suggestedTitle(found))}</p>
        <p class="serp-url">${host ? e(host) : e('your-website')}</p>
        <p class="serp-desc">${e(suggestedSummary(found))}</p>
      </div>
    </div>
  </section>`;
}

function groupLines(grade) {
  const by = grade.score?.byGroup ?? {};
  const lines = SHOWN_GROUPS.map(g => {
    const v = by[g];
    return `<li><strong>${e(GROUPS[g])}:</strong> ${v ? `${v.earned} of ${v.available} points` : 'Not checked'}</li>`;
  }).join('');
  return `<section class="grade-groups"><h2>The short version</h2><ul>${lines}</ul></section>`;
}

function leadForm(grade, { values = {}, errors = {} } = {}) {
  const field = (key, label, type, auto) => `    <div class="field${errors[key] ? ' missing' : ''}">
      <label for="l-${key}">${e(label)}</label>
      <input type="${type}" id="l-${key}" name="${key}" value="${e(values[key] ?? '')}" maxlength="200" autocomplete="${auto}" required>
      ${errors[key] ? `<span class="missing-note">${e(errors[key])}</span>` : ''}
    </div>`;
  return `<section class="grade-lead">
    <h2>See every check and the fixes</h2>
    <p>Enter your name, email and phone to open the full report. It has every check, the fix for each one, and text you can copy and paste.</p>
    <form class="rise-form" method="POST" action="/grade/${e(grade.id)}/unlock">
${field('name', 'Your name', 'text', 'name')}
${field('email', 'Email', 'email', 'email')}
${field('phone', 'Phone', 'tel', 'tel')}
      <label class="check"><input type="checkbox" name="okToContact" value="1"> OK for ${e(DEFAULT_SITE_NAME)} to call, text or email me about my report</label>
      <button type="submit" class="button">Show my full report</button>
    </form>
  </section>`;
}

const RESULT_TEXT = Object.freeze({ pass: 'Passed', fail: 'Needs work', not_checked: 'Not checked' });

function checkItem(check, result) {
  const r = result ?? { result: 'not_checked', detail: 'Not checked' };
  const earned = r.result === 'pass' ? (Number.isFinite(r.earned) ? r.earned : check.points) : 0;
  const points = r.result === 'not_checked' ? '' : ` <span class="grade-points">${earned} of ${check.points} points</span>`;
  const fix = r.result === 'fail' ? `<br><em>Fix:</em> ${e(check.fix)}` : '';
  return `<li class="grade-check ${e(r.result)}"><strong>${e(check.label)}</strong> <span class="grade-result">${RESULT_TEXT[r.result]}</span>${points}<br>${e(r.detail)}${fix}</li>`;
}

function allAnswers(grade) {
  const ai = grade.ai ?? [];
  if (ai.length === 0) return '';
  const named = ai.filter(a => a.named).length;
  const items = ai.map(a => `<li><p><strong>${e(a.prompt)}</strong></p>${a.provider === 'mock' ? `<p class="seance-demo">${DEMO_LABEL}</p>` : ''}<p>${e(aiSentence(a, NaN))}</p>${answerBlock(a)}</li>`).join('');
  return `<div class="grade-all-answers"><p>Named in ${named} of ${ai.length} ${ai.length === 1 ? 'answer' : 'answers'}.</p><ol>${items}</ol></div>`;
}

function kitItem(index, title, text) {
  return `<div class="kit-item">
      <h3>${e(title)}</h3>
      <pre id="kit-${index}">${e(text)}</pre>
      <button type="button" class="button copy-btn" data-copy="kit-${index}" hidden>Copy</button>
    </div>`;
}

function fixKit(grade) {
  const found = foundFromGrade(grade);
  const items = [
    ['Page title', suggestedTitle(found)],
    ['Search summary', suggestedSummary(found)],
    ['Business label for AI (paste in your home page)', jsonLdBlock(found)],
    ['Info sheet for AI (save as llms.txt)', llmsDraft(found)],
  ];
  const bots = resultOf(grade, 'ai-bots-allowed');
  if (bots?.result === 'fail' && Array.isArray(bots.blocked) && bots.blocked.length > 0) {
    items.push(['Lines to add to robots.txt', robotsLines(bots.blocked)]);
  }
  return `<section class="grade-kit">
    <h2>Your fix kit</h2>
    <p>Copy these into your website, or send them to whoever looks after it.</p>
    ${items.map(([title, text], i) => kitItem(i + 1, title, text)).join('\n    ')}
  </section>`;
}

function fullReport(grade, contact) {
  const groups = SHOWN_GROUPS.map(g => {
    const checks = CHECKS.filter(c => c.group === g);
    const extra = g === 'ai_answers' ? allAnswers(grade) : '';
    return `<section class="grade-group">
    <h3>${e(GROUPS[g])}</h3>
    <ul class="grade-checks">
      ${checks.map(c => checkItem(c, resultOf(grade, c.id))).join('\n      ')}
    </ul>
    ${extra}
  </section>`;
  }).join('\n');
  const used = (grade.ai ?? []).length;
  const answersNote = used > 0 ? `<p class="hint">The AI part of this score uses ${used} ${used === 1 ? 'answer' : 'answers'}.</p>` : '';
  return `<section class="grade-full">
    <h2>Every check</h2>
    ${answersNote}
    ${groups}
  </section>
  ${fixKit(grade)}
  <section class="grade-recheck">
    <h2>Made some changes?</h2>
    <form method="POST" action="/grade/${e(grade.id)}/recheck">
      <button type="submit" class="button">Check again</button>
    </form>
    <p class="hint">This reads your website again. It does not ask AI again.</p>
  </section>
  <section class="grade-offer">
    <p>Want us to make these changes for you? <a href="${e(contact.href)}">${e(contact.text)}</a>.</p>
  </section>`;
}

/**
 * @param {object} grade a `done` Grade
 * @param {{ unlocked?: boolean, leadGate?: boolean, contactEmail?: string, now?: number,
 *   leadValues?: object, leadErrors?: object }} [opts]
 */
export function reportPage(grade, {
  unlocked = false, leadGate = true, contactEmail, now = NaN, leadValues, leadErrors,
} = {}) {
  const contact = contactEmail
    ? { href: `mailto:${contactEmail}`, text: contactEmail }
    : { href: '/about', text: 'Contact us' };
  const showFull = !leadGate || unlocked;
  const when = formatRunTime(grade.finishedAt ?? grade.createdAt);
  const body = `<article class="rise grade-report">
  <div class="grade-top">
  ${scoreSection(grade)}
  ${aiSection(grade, now)}
  </div>
  ${fixSection(grade)}
  ${googleSection(grade)}
  ${groupLines(grade)}
  <p class="grade-meta">Automated check, ${e(when)}. AI assistants pick up changes over days to weeks.</p>
  ${showFull ? fullReport(grade, contact) : leadForm(grade, { values: leadValues, errors: leadErrors })}
  <p class="hint">Ask us to remove this report: <a href="${e(contact.href)}">${e(contact.text)}</a></p>
</article>`;
  return page(`${grade.input.name}: AI visibility check`, body);
}

// ---- Failed, about --------------------------------------------------------------

/** Shown when a Grade did not finish. The button starts a new Grade with the same typed details. */
export function failedPage(grade, { stamp = '' } = {}) {
  const i = grade.input;
  const hidden = ['name', 'city', 'state', 'service']
    .map(k => `<input type="hidden" name="${k}" value="${e(i[k])}">`).join('\n      ');
  const body = `<section class="rise message">
  <h1>This check didn't finish</h1>
  <p>Something took too long. Nothing is wrong with your business. Please try again.</p>
  <form method="POST" action="/grade">
      ${hidden}
      <input type="hidden" name="website" value="${e(i.website ?? '')}">
      <input type="hidden" name="t" value="${e(stamp)}">
      <button type="submit" class="button">Start again</button>
  </form>
</section>`;
  return page("This check didn't finish", body);
}

/** What the Grader reads and why. */
export function aboutPage({ contactEmail, userAgent = '' } = {}) {
  const contact = contactEmail
    ? `<a href="mailto:${e(contactEmail)}">${e(contactEmail)}</a>`
    : '<a href="/about">our contact page</a>';
  const body = `<section class="rise grade-about">
  <h1>What the Grader reads</h1>
  <p>When someone grades a business with a website, our server visits that website once. It is the same as opening the page in a browser.</p>
  <ul>
    <li>The home page.</li>
    <li>The file <code>/robots.txt</code>, to see whether AI assistants are allowed in.</li>
    <li>The file <code>/llms.txt</code>, to see whether there is an info sheet for AI.</li>
  </ul>
  <p>We read only public pages. We do not log in, fill in forms, or run the page's scripts. We send no cookies. We visit only websites on the public internet.</p>
  ${userAgent ? `<p>Our visits identify themselves as <code>${e(userAgent)}</code>.</p>` : ''}
  <p>We also ask one AI assistant for the best business of that kind in that city, and check whether the business is named.</p>
  <p>Reports are not listed in search engines. We delete them after 90 days.</p>
  <p>Questions, or want a report removed? Contact ${contact}.</p>
  <p><a href="/grade">Grade a business</a></p>
</section>`;
  return page('What the Grader reads', body);
}
