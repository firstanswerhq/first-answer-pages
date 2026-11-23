/**
 * grade-admin.js — Grader pages for the admin (mounted behind the existing admin gate).
 *
 *   GET  /admin/grades             newest 100 Grades
 *   GET  /admin/leads              newest 100 Leads
 *   POST /admin/grades/:id/delete  delete a Grade and its Leads (browser: asks first)
 *
 * API clients (bearer header, or no Accept: text/html) get JSON from the POST route;
 * browsers get a confirm page, then a 303 back to the list.
 */

import { layout, escapeHtml } from '../lib/html.js';
import { formatRunTime } from '../lib/seance-html.js';
import { isPartialScore, scoredResults } from '../lib/grader.js';
import { scoreGrade } from '../lib/grade-score.js';

const NOTES = Object.freeze({
  deleted: 'Deleted the report and its leads.',
  notfound: 'That report was not found.',
});

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const LIMIT = 100;

/** Central time without the zone name. */
function adminTime(iso) {
  if (typeof iso !== 'string' || Number.isNaN(new Date(iso).getTime())) return String(iso ?? '');
  return formatRunTime(iso).replace(/ [A-Z]{2,5}$/, '');
}

const newestFirst = (a, b) => String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? ''));

const whole = n => (Number.isInteger(n) && n >= 0 ? n : 0);

/**
 * How the bot protection is set up and today's counts, from the guard (the AI budget): counts only, no
 * business name, no visitor detail. Every value goes through escapeHtml.
 */
function protectionBlock(ctx) {
  // The counts must never be the reason this page fails: a guard that throws shows zeros.
  let summary = {};
  try {
    summary = ctx.gradeGuard?.summary?.() ?? {};
  } catch {
    summary = {};
  }
  if (summary === null || typeof summary !== 'object') summary = {};
  const usage = summary.usage ?? {};
  const counts = summary.counts ?? {};
  const humanCheck = !ctx.turnstile
    ? 'off (no Turnstile keys)'
    : summary.misconfigured === true
      ? 'on, but Cloudflare reported a problem (wrong secret key or an error on its side); checks are let through'
      : 'on';
  const notifier = ctx.notifier;
  const emails = notifier && notifier.name !== 'none' && typeof notifier.notifyAllowance === 'function'
    ? 'on'
    : 'off (no email service set)';
  const checks = whole(counts.checks);
  const checksRun = `${checks} ${checks === 1 ? 'check' : 'checks'}`;
  const lines = [
    `Human check: ${humanCheck}`,
    `Heads-up emails: ${emails}`,
    `Today: ${whole(usage.used)} AI calls used, ${whole(usage.left)} left. ${checksRun} run.`,
    `Human check today: ${whole(counts.humanPass)} passed, ${whole(counts.human)} turned away.`,
    `Limits today: ${whole(counts.limit)} turned away by the per-address limits, ${whole(counts.network)} by the per-network limit.`,
  ];
  return `<ul class="admin-protection">\n${lines.map(l => `    <li>${escapeHtml(l)}</li>`).join('\n')}\n  </ul>`;
}

/**
 * @param {import('express').Router} router
 * @param {object} ctx resolved dependencies from createApp
 * @param {{ adminNav: () => string, wantsHtml: (req: object) => boolean, form: Function }} helpers
 */
export function mountGradeAdmin(router, ctx, { adminNav, wantsHtml, form }) {
  const read = async name => {
    const list = await ctx.store.collection(name).read();
    return Array.isArray(list) ? list.filter(x => x && typeof x === 'object') : [];
  };
  const now = () => ctx.clock.now();

  router.get('/admin/grades', async (req, res, next) => {
    try {
      const grades = (await read('grades')).sort(newestFirst).slice(0, LIMIT);
      const leads = await read('leads');
      const withLead = new Set(leads.map(l => l.gradeId));
      const noteKey = typeof req.query.note === 'string' && Object.hasOwn(NOTES, req.query.note) ? req.query.note : '';

      const items = grades.map(g => {
        const stale = g.status === 'running' && ctx.grader.isStale(g, now());
        const status = stale ? 'failed' : String(g.status ?? '');
        // A score without the AI part is marked "partial" next to the number.
        // Worked out from the stored results with the current points, like the report (never the stored Score).
        // A Grade stored with no results at all has nothing to work out from, so it keeps its stored number.
        // The `ai-named` result is worked out by the same rule as the report (the free question's answers only).
        const view = { ...g, results: scoredResults(g) };
        const current = view.results.length > 0 ? scoreGrade(view.results).score : g.score?.score;
        const score = Number.isInteger(current)
          ? `${current}${isPartialScore(view) ? ' (partial)' : ''}`
          : 'not scored';
        const id = String(g.id ?? '');
        const safeId = encodeURIComponent(id);
        return `<li class="pending-item">
  <h2>${escapeHtml(g.input?.name ?? '(no name)')}</h2>
  <p>${escapeHtml(g.input?.city ?? '')}, ${escapeHtml(g.input?.state ?? '')} &middot; Score: ${escapeHtml(score)} &middot; Status: ${escapeHtml(status)}</p>
  <p>Lead: ${withLead.has(g.id) ? 'yes' : 'no'} &middot; Free listing claimed: ${g.draftId ? 'yes' : 'no'} &middot; ${escapeHtml(adminTime(g.createdAt ?? ''))}</p>
  <p><a href="/grade/${safeId}">Open the report</a></p>
  <form method="POST" action="/admin/grades/${safeId}/delete"><button type="submit" class="admin-button admin-button-secondary">Delete</button></form>
</li>`;
      }).join('\n');

      const body = `<section class="admin">
  ${adminNav()}
  <h1>AI Visibility Check reports</h1>
  ${noteKey ? `<p class="admin-note" role="status">${escapeHtml(NOTES[noteKey])}</p>` : ''}
  ${protectionBlock(ctx)}
  ${grades.length === 0 ? '<p>No reports yet.</p>' : `<ul class="pending-list">\n${items}\n</ul>`}
</section>`;
      res.type('html').send(layout({ title: 'AI Visibility Check reports', body }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/leads', async (req, res, next) => {
    try {
      const leads = (await read('leads')).sort(newestFirst).slice(0, LIMIT);
      const items = leads.map(l => `<li class="pending-item">
  <h2>${escapeHtml(l.business ?? '(no name)')}</h2>
  <p>${escapeHtml(l.name ?? '')} &middot; <span class="owner-email">${escapeHtml(l.email ?? '')}</span> &middot; ${escapeHtml(l.phone ?? '')}</p>
  <p>OK to contact: ${l.okToContact === true ? 'yes' : 'no'} &middot; Score: ${Number.isInteger(l.score) ? l.score : 'not scored'} &middot; ${escapeHtml(adminTime(l.createdAt ?? ''))}</p>
  ${typeof l.gradeId === 'string' && ID_PATTERN.test(l.gradeId) ? `<p><a href="/grade/${encodeURIComponent(l.gradeId)}">Open the report</a></p>` : ''}
</li>`).join('\n');
      const body = `<section class="admin">
  ${adminNav()}
  <h1>AI Visibility Check leads</h1>
  ${leads.length === 0 ? '<p>No leads yet.</p>' : `<ul class="pending-list">\n${items}\n</ul>`}
</section>`;
      res.type('html').send(layout({ title: 'AI Visibility Check leads', body }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/grades/:id/delete', form, async (req, res, next) => {
    try {
      const { id } = req.params;
      const browser = wantsHtml(req);
      const exists = ID_PATTERN.test(id) && Boolean(await ctx.grader.get(id));
      if (!exists) {
        return browser ? res.redirect(303, '/admin/grades?note=notfound') : res.status(404).json({ error: 'Report not found' });
      }
      // Browsers are asked first; API clients act right away.
      if (browser && req.body?.confirm !== 'yes') {
        const body = `<section class="admin">
  ${adminNav()}
  <h1>Delete this report?</h1>
  <p>This removes the report and any leads that opened it. It can't be undone.</p>
  <form method="POST" action="/admin/grades/${encodeURIComponent(id)}/delete">
    <input type="hidden" name="confirm" value="yes">
    <button type="submit" class="admin-button">Yes, delete</button>
  </form>
  <p><a href="/admin/grades">Cancel</a></p>
</section>`;
        return res.type('html').send(layout({ title: 'Delete this report?', body }));
      }
      const removed = await ctx.grader.remove(id);
      if (!removed) return browser ? res.redirect(303, '/admin/grades?note=notfound') : res.status(404).json({ error: 'Report not found' });
      return browser ? res.redirect(303, '/admin/grades?note=deleted') : res.json({ ok: true });
    } catch (err) {
      return next(err);
    }
  });
}
