/**
 * high-tech-look Requirement 13: the agency-grade parts of the full report, from data the check already has.
 * Share of voice (counts, the checked business at 0), sites AI used (no sources, the business's own site, directory
 * gaps), evidence, the CSV (columns and rows), the print stylesheet, and "Prepared by" (escaped, capped at 60).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  shareOfVoice, sitesUsed, evidence, evidenceTime, reportCsv, csvCell, cleanPreparedBy, CSV_COLUMNS, PREPARED_BY_MAX,
} from '../server/lib/agency-report.js';
import { voiceSection, sitesSection, printPage, reportCsvFor } from '../server/lib/grade-html.js';

const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: 'https://zephyr.example/' };
const AT = '2026-11-24T18:00:00.000Z';
const answer = (extra = {}) => ({
  prompt: 'Who are the best plumbers in Nashville, TN? Name your top 5.', provider: 'anthropic', model: 'claude-test',
  webSearch: true, answer: '1. Some answer', named: false, position: null, total: 2, competitors: [], at: AT, ...extra,
});
const grade = (ai, extra = {}) => ({
  id: 'agency0000000000000001', status: 'done', input: INPUT, ai, results: [], createdAt: AT, finishedAt: AT,
  steps: [], facts: null, found: { phone: '', address: '', hours: [] }, score: null,
  aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, ...extra,
});

test('13.1: who AI named across the answers that came back; the checked business is always a row', () => {
  const g = grade([
    answer({ named: true, competitors: ['Ridge Plumbing', 'Ace Drains'] }),
    answer({ provider: 'chatgpt', competitors: ['Ridge Plumbing'] }),
    answer({ provider: 'gemini', answer: '   ', competitors: ['Not Counted Co'] }), // didn't come back: skipped
    answer({ provider: 'grok', competitors: ['ridge plumbing', 'Zephyr Plumbing'] }), // own name in the list
  ]);
  const { total, rows } = shareOfVoice(g);
  assert.equal(total, 3);
  const by = Object.fromEntries(rows.map(r => [r.name, r]));
  assert.equal(by['Ridge Plumbing'].count, 3, 'counted once per answer, case ignored');
  assert.equal(by['Ace Drains'].count, 1);
  assert.equal(by['Zephyr Plumbing'].count, 2);
  assert.equal(by['Zephyr Plumbing'].own, true);
  assert.equal('Not Counted Co' in by, false, 'an answer that did not come back is skipped');
  assert.equal(rows.length, 3, 'never a name that no answer listed');
  // Named nowhere: still a row, at 0.
  const none = shareOfVoice(grade([answer({ competitors: ['Ridge Plumbing'] })]));
  assert.deepEqual(none.rows.find(r => r.own), { name: 'Zephyr Plumbing', count: 0, own: true });
  const html = voiceSection(grade([answer({ competitors: ['Ridge <b>Plumbing</b>'] })]));
  assert.match(html, /<h2>Who AI named, across 1 answer<\/h2>/);
  assert.match(html, /<tr class="grade-voice-you"><td><strong>Zephyr Plumbing<\/strong> \(you\)<\/td><td>0 of 1<\/td><\/tr>/);
  assert.ok(html.includes('Ridge &lt;b&gt;Plumbing&lt;/b&gt;'), 'escaped');
  assert.equal(voiceSection(grade([])), '');
});

test('13.2: the sites AI used come only from the stored sources; the own website is marked; gaps only when known', () => {
  const g = grade([
    answer({ sources: [{ url: 'https://www.yelp.com/biz/zephyr', title: 'Yelp' }, { url: 'https://zephyr.example/about', title: 'Zephyr' }] }),
    answer({ provider: 'perplexity', sources: [{ url: 'https://yelp.com/search', title: 'Yelp' }, { url: 'javascript:alert(1)', title: 'x' }] }),
  ], { signals: { links: { yelp: { status: 'partly' }, facebook: { status: 'partly' } } } });
  const s = sitesUsed(g);
  assert.equal(s.hasSources, true);
  assert.deepEqual(s.rows.map(r => [r.domain, r.count, r.own]), [['yelp.com', 2, false], ['zephyr.example', 1, true]]);
  assert.deepEqual(s.gaps, ["AI read Yelp for 2 answers. Your website doesn't link to a Yelp page."]);
  const html = sitesSection(g);
  assert.match(html, /<a href="https:\/\/www\.yelp\.com\/biz\/zephyr" rel="nofollow noopener noreferrer">yelp\.com<\/a>: cited in 2 answers/);
  assert.match(html, /zephyr\.example<\/a>: cited in 1 answer <strong>\(your website\)<\/strong>/);
  assert.equal(html.includes('javascript:'), false, 'never a source that is not an address');
  // A link the website has, or one not checked, is never called missing.
  assert.deepEqual(sitesUsed({ ...g, signals: { links: { yelp: { status: 'good' } } } }).gaps, []);
  assert.deepEqual(sitesUsed({ ...g, signals: { links: { yelp: { status: 'not_checked' } } } }).gaps, []);
  // No answer had sources.
  const none = sitesSection(grade([answer()]));
  assert.ok(none.includes("<p>These answers didn't list their sources.</p>"));
  for (const gap of s.gaps) assert.ok(gap.length <= 160);
});

test('13.3: the evidence says who answered, the model, when, and whether it searched the web live', () => {
  assert.equal(evidence(answer(), 'Claude'), `Evidence: Claude (model claude-test), asked ${evidenceTime(AT)}, with a live web search.`);
  assert.equal(evidenceTime(AT), 'Nov 24, 2026, 12:00 PM CT');
  assert.equal(evidence(answer({ model: '', webSearch: false }), 'Gemini'), `Evidence: Gemini, asked ${evidenceTime(AT)}, without a live web search.`);
  assert.ok(evidence(answer(), 'Claude').length <= 160);
});

test('13.4: the CSV has one row per health row and one per answer, in fixed columns, safe for spreadsheets', () => {
  const csv = reportCsv({
    preparedBy: 'Acme Agency',
    health: [{ group: 'Website', item: 'Page list for search engines (sitemap)', status: 'Found', detail: '' }],
    answers: [{ engine: 'Claude', model: 'm', question: 'Who, "best", here?', named: true, date: AT }],
  });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'Prepared by,Acme Agency');
  assert.equal(lines[1], '');
  assert.equal(lines[2], CSV_COLUMNS.join(','));
  assert.deepEqual(CSV_COLUMNS, ['section', 'group', 'item', 'status', 'detail', 'engine', 'model', 'question', 'named', 'date']);
  assert.equal(lines[3], 'health,Website,Page list for search engines (sitemap),Found,,,,,,');
  assert.equal(lines[4], `answer,,,,,Claude,m,"Who, ""best"", here?",yes,${AT}`);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`, 'never a formula');
  assert.equal(csvCell('+1 615'), "'+1 615");
  assert.equal(reportCsv({ health: [], answers: [] }).split('\r\n')[0], CSV_COLUMNS.join(','), 'no "Prepared by" line when unset');

  // The real report: one row per list row of the health map, one per stored answer.
  const g = grade([answer({ named: true }), answer({ provider: 'chatgpt' })]);
  const real = reportCsvFor(g).trim().split('\r\n');
  assert.equal(real[0], CSV_COLUMNS.join(','));
  assert.equal(real.filter(l => l.startsWith('answer,')).length, 2);
  assert.ok(real.filter(l => l.startsWith('health,')).length >= 40);
  assert.ok(real.some(l => /^answer,,,,,Claude,claude-test,.*,yes,/.test(l)));
  assert.ok(real.some(l => /^answer,,,,,ChatGPT,claude-test,.*,no,/.test(l)));
});

test('13.4: the print page opens every answer and the print stylesheet hides the menu, buttons, forms and animation', async () => {
  const g = grade([answer({ named: true })], { preparedBy: 'Acme' });
  const html = printPage(g);
  assert.equal(html.includes('<details>'), false, 'every answer is open');
  assert.match(html, /<section class="grade-report grade-print">/);
  assert.match(html, /<p class="grade-prepared-by">Prepared by Acme<\/p>/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'still noindex');
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const prints = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(prints, /\.site-nav/);
  assert.match(prints, /\.site-footer/);
  assert.match(prints, /animation: none !important/);
  assert.match(prints, /\.health-orb-host/);
  assert.match(prints, /\.grade-download[\s\S]*form/);
  assert.match(prints, /break-before: page/);
});

test('13.5: "Prepared by" is text only, one line, at most 60 characters, and escaped everywhere', () => {
  assert.equal(PREPARED_BY_MAX, 60);
  assert.equal(cleanPreparedBy('  Acme   Agency  '), 'Acme Agency');
  assert.equal(cleanPreparedBy('<script>x</script>'), 'scriptx/script');
  assert.equal(Array.from(cleanPreparedBy('x'.repeat(80))).length, 60);
  assert.equal(cleanPreparedBy('a\nb\u202Ec'), 'a bc');
  const html = printPage(grade([answer()], { preparedBy: 'Tom & "Jerry"' }));
  assert.ok(html.includes('Prepared by Tom &amp; &quot;Jerry&quot;'));
  const csv = reportCsv({ preparedBy: '=cmd', health: [], answers: [] });
  assert.equal(csv.split('\r\n')[0], "Prepared by,'=cmd");
});
