/**
 * grade-admin.js — admin pages for the Grader. Mounted by the admin router
 * after its login gate, so every route here already needs the admin token or
 * login cookie.
 *
 *   GET  /admin/grades              newest 100 Grades
 *   GET  /admin/leads               newest 100 Leads
 *   POST /admin/grades/:id/delete   delete a Grade and its Leads
 */

import { layout, escapeHtml } from '../lib/html.js';
import { formatRunTime } from '../lib/seance-html.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const e = escapeHtml;

/** Central time without the zone name, e.g. 'Nov 10, 2026, 2:15 PM'. */
function when(iso) {
  if (typeof iso !== 'string' || Number.isNaN(new Date(iso).getTime())) return String(iso ?? '');
  return formatRunTime(iso).replace(/ [A-Z]{2,5}$/, '');
}

const newestFirst = list => [...list]
  .filter(x => x && typeof x === 'object')
  .sort((a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? '') || 0)
  .slice(0, 100);

/**
 * @param {import('express').Router} router
 * @param {object} ctx resolved dependencies from createApp
 * @param {{ adminNav: () => string, wantsHtml: (req: object) => boolean, form: Function }} helpers
 */
export function mountGradeAdmin(router, ctx, { adminNav, wantsHtml, form }) {
  const readList = async name => {
    const list = await ctx.store.collection(name).read();
    return Array.isArray(list) ? list : [];
  };

  router.get('/admin/grades', async (req, res, next) => {
    try {
      const [grades, leads] = await Promise.all([readList('grades'), readList('leads')]);
      const leadIds = new Set(leads.map(l => l?.gradeId));
      const rows = newestFirst(grades).map(g => {
        const i = g.input ?? {};
        const score = Number.isInteger(g.score?.score) ? String(g.score.score) : 'not scored';
        const link = ID_PATTERN.test(String(g.id)) ? `<a href="/grade/${e(g.id)}">${e(i.name ?? '(no name)')}</a>` : e(i.name ?? '(no name)');
        return `<li class="pending-item">
    <strong>${link}</strong> &middot; ${e(i.city ?? '')}, ${e(i.state ?? '')}
    <br>Score: ${e(score)} &middot; Status: ${e(g.status ?? '')} &middot; Lead: ${leadIds.has(g.id) ? 'yes' : 'no'} &middot; Page claimed: ${g.draftId ? 'yes' : 'no'}
    <br><small>${e(when(g.createdAt))}</small>
    <form method="POST" action="/admin/grades/${e(g.id)}/delete"><button type="submit" class="admin-button admin-button-secondary">Delete</button></form>
  </li>`;
      });
      const body = `<section class="admin">
  ${adminNav()}
  <h1>Grades</h1>
  <p><a href="/admin/leads">See leads &rarr;</a></p>
  ${rows.length === 0 ? '<p>No grades yet.</p>' : `<ul class="pending-list">\n${rows.join('\n')}\n</ul>`}
</section>`;
      res.type('html').send(layout({ title: 'Grades', body }));
    } catch (err) {
      next(err);
    }
  });

  router.get('/admin/leads', async (req, res, next) => {
    try {
      const leads = await readList('leads');
      const rows = newestFirst(leads).map(l => `<li class="pending-item">
    <strong>${e(l.business ?? '')}</strong>${ID_PATTERN.test(String(l.gradeId)) ? ` &middot; <a href="/grade/${e(l.gradeId)}">report</a>` : ''}
    <br>${e(l.name ?? '')} &middot; ${e(l.email ?? '')} &middot; ${e(l.phone ?? '')}
    <br>OK to contact: ${l.okToContact ? 'yes' : 'no'} &middot; Score: ${Number.isInteger(l.score) ? l.score : 'not scored'}
    <br><small>${e(when(l.createdAt))}</small>
  </li>`);
      const body = `<section class="admin">
  ${adminNav()}
  <h1>Leads</h1>
  <p><a href="/admin/grades">&larr; Grades</a></p>
  ${rows.length === 0 ? '<p>No leads yet.</p>' : `<ul class="pending-list">\n${rows.join('\n')}\n</ul>`}
</section>`;
      res.type('html').send(layout({ title: 'Leads', body }));
    } catch (err) {
      next(err);
    }
  });

  // Delete a Grade and its Leads (for removal requests). The report then returns 404.
  router.post('/admin/grades/:id/delete', form, async (req, res, next) => {
    try {
      const id = req.params.id;
      if (!ID_PATTERN.test(id)) {
        return wantsHtml(req) ? res.redirect(303, '/admin/grades') : res.status(404).json({ error: 'Grade not found' });
      }
      let found = false;
      await ctx.store.collection('grades').update(list => {
        const i = list.findIndex(g => g && g.id === id);
        if (i !== -1) {
          list.splice(i, 1);
          found = true;
        }
      });
      await ctx.store.collection('leads').update(list => {
        for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] && list[i].gradeId === id) list.splice(i, 1);
      });
      if (wantsHtml(req)) return res.redirect(303, '/admin/grades');
      return found ? res.json({ ok: true }) : res.status(404).json({ error: 'Grade not found' });
    } catch (err) {
      return next(err);
    }
  });
}
