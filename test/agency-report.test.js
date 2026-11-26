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
  answersOf, isGoogleProfileUrl, csvDate,
} from '../server/lib/agency-report.js';
import { CHECK_ROW_NAMES, CHECK_ROW_IDS } from '../server/lib/health-map.js';
import { CHECKS } from '../server/lib/grade-checks.js';
import {
  voiceSection, sitesSection, printPage, reportCsvFor, reportPage, notCheckedLine, answersFromLine, POWERED_BY, ALREADY_HAVE,
  PRINT_KIT_LINE, SEND_THIS_PAGE, PRINT_CARDS_NOTE, PRINT_FOOTER_TAIL, PRINT_FOR_CLIENTS, SNAPSHOT_LINE, NO_QUESTION_SAVED,
  howWeChecked, voiceSummary, failedNote, PRINT_HEALTH_NOTE, oneAnswerLine,
} from '../server/lib/grade-html.js';
import { FOUNDING_NOTE, MAP_INTRO_NO_LISTING, healthModel } from '../server/lib/health-map.js';
import { REPLACE_CAPITALS, STREET_PLACEHOLDER, ZIP_PLACEHOLDER, jsonLdBlock } from '../server/lib/fix-kit.js';

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

/** The rows of a CSV, each an array of cells (quoted cells may hold commas, quotes and line breaks). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i += 1;
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}
/** The rows of one section ("check", "health", "answer", "named", "site"), read by the section column, as objects. */
function csvSection(text, section) {
  const [head, ...rows] = parseCsv(text);
  const at = head.indexOf('section');
  return rows.filter(r => r[at] === section).map(r => Object.fromEntries(head.map((name, k) => [name, r[k]])));
}

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
  // Batch 6 fix B item 6: the table shows from 2 answers (with 1 there is nothing to rank; see the one-answer test).
  const html = voiceSection(grade([answer({ competitors: ['Ridge <b>Plumbing</b>'] }), answer()]));
  assert.match(html, /<h2>Who AI named, across 2 answers<\/h2>/);
  assert.match(html, /<tr class="grade-voice-you"><td><strong>Zephyr Plumbing<\/strong> \(you\)<\/td><td>0 of 2<\/td><\/tr>/);
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

test('batch 4 Y1: on a shared host only the business\'s own page is "(your website)", never every page there', () => {
  const fbInput = { ...INPUT, website: 'https://www.facebook.com/', websitePage: 'https://www.facebook.com/zephyrplumbing' };
  const competitor = grade([
    answer({ sources: [{ url: 'https://www.facebook.com/someothercompetitor', title: 'Other' }] }),
  ], { input: fbInput });
  assert.deepEqual(sitesUsed(competitor).rows.map(r => [r.domain, r.own]), [['facebook.com', false]]);
  assert.equal(sitesSection(competitor).includes('(your website)'), false);
  // Its own page (www., m., case and a trailing slash ignored) is marked, even after a competitor's page.
  const own = grade([
    answer({ sources: [{ url: 'https://www.facebook.com/someothercompetitor' }, { url: 'https://m.facebook.com/ZephyrPlumbing/' }] }),
  ], { input: fbInput });
  // Batch 5 Z1: the own page is a row of its own; the competitor stays in the plain facebook.com row.
  assert.deepEqual(sitesUsed(own).rows.map(r => [r.domain, r.count, r.own]),
    [['facebook.com', 1, false], ['facebook.com/zephyrplumbing', 1, true]]);
  // A shared-host website with no page kept is never marked.
  const bare = grade([answer({ sources: [{ url: 'https://www.facebook.com/zephyrplumbing' }] })], { input: { ...INPUT, website: 'https://www.facebook.com/' } });
  assert.equal(sitesUsed(bare).rows[0].own, false);
});

test('batch 4 Y3: the Google line counts only Google Business Profile or Maps pages', () => {
  const links = { signals: { links: { google: { status: 'partly' } } } };
  const g = grade([
    answer({ sources: [{ url: 'https://support.google.com/business/answer/1' }] }),
    answer({ provider: 'chatgpt', sources: [{ url: 'https://www.google.com/search?q=zephyr' }] }),
    answer({ provider: 'grok', sources: [{ url: 'https://www.google.com/maps/place/Zephyr+Plumbing' }] }),
  ], links);
  const s = sitesUsed(g);
  assert.equal(s.rows.find(r => r.domain === 'google.com').count, 3, 'the domain row is unchanged');
  assert.deepEqual(s.gaps, ["AI read Google for one answer. Your website doesn't link to your Google profile."]);
  // No profile page among the sources: no Google line.
  const plain = grade([answer({ sources: [{ url: 'https://support.google.com/x' }] })], links);
  assert.deepEqual(sitesUsed(plain).gaps, []);
  // A g.page or maps.app.goo.gl link is a profile too.
  const short = grade([answer({ sources: [{ url: 'https://g.page/zephyr' }] }), answer({ sources: [{ url: 'https://maps.app.goo.gl/abc' }] })], links);
  assert.deepEqual(sitesUsed(short).gaps, ["AI read Google for 2 answers. Your website doesn't link to your Google profile."]);
  assert.equal(isGoogleProfileUrl('https://business.google.com/x'), true);
  assert.equal(isGoogleProfileUrl('https://maps.google.com/?cid=1'), true);
  assert.equal(isGoogleProfileUrl('https://www.google.com/mapsearch'), false);
  assert.equal(isGoogleProfileUrl('javascript:alert(1)'), false);
});

test('batch 4 Y4: the CSV has the same answers as "across N answers" (an answer with no text is skipped)', () => {
  const g = grade([
    answer({ named: true }),
    answer({ provider: 'chatgpt' }),
    answer({ provider: 'gemini', answer: '   ' }),
    answer({ provider: 'grok', answer: '' }),
  ]);
  // Batch 5 fix B: rows are read by their section column (K17 put the business columns first on every row).
  const rows = csvSection(reportCsvFor(g), 'answer');
  assert.equal(rows.length, shareOfVoice(g).total);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.engine), ['Claude', 'ChatGPT'], 'the two answers with text, in order');
  assert.equal(answersOf(g).length, 2);
});

test('13.3: the evidence says who answered, the model, when, and whether it searched the web live', () => {
  // Batch 6 item 6: the reviewers' wording, and one time zone label (CST, the same as every other time on the report).
  assert.equal(evidence(answer(), 'Claude'), 'Evidence: Claude claude-test, Nov 24, 2026, 12:00 PM CST, live web search on.');
  assert.equal(evidenceTime(AT), 'Nov 24, 2026, 12:00 PM CST');
  assert.equal(evidence(answer({ model: '', webSearch: false }), 'Gemini'), 'Evidence: Gemini, Nov 24, 2026, 12:00 PM CST, live web search off.');
  assert.equal(evidence(answer({ at: 'not a date' }), 'Claude'), 'Evidence: Claude claude-test, live web search on.', 'no time when none was stored');
  assert.ok(evidence(answer(), 'Claude').length <= 160);
});

test('13.4, batch 5 K17: one header row first; the report\'s own columns on every row; checks, answers, names and sites', () => {
  const report = { business: 'Zephyr Plumbing', website: 'https://zephyr.example/', city: 'Nashville', state: 'TN', checkDate: AT, score: 68 };
  const csv = reportCsv({
    report,
    preparedBy: 'Acme Agency',
    checks: [{ group: 'Search basics', item: 'Page title names your city and service', status: 'Pass', earned: 7, points: 7, detail: '' }],
    health: [{ group: 'Website: Can AI read your website', item: 'Page list for search engines (sitemap)', status: 'Found', detail: '' }],
    answers: [{
      engine: 'Claude', model: 'm', webSearch: true, question: 'Who, "best", here?', named: true, answer: '1. Zephyr\n2. Ridge',
      businesses: ['Zephyr Plumbing', 'Ridge'], sites: ['https://yelp.com/a'], date: AT,
    }],
    named: [{ name: 'Ridge', count: 1, total: 1, own: false }],
    sites: [{ domain: 'yelp.com', url: 'https://yelp.com/a', count: 1, own: false }],
  });
  const lines = csv.trim().split('\r\n');
  assert.deepEqual(CSV_COLUMNS, [
    'business', 'website', 'city', 'state', 'check_date', 'score', 'prepared_by',
    'section', 'group', 'item', 'status', 'points_earned', 'points_possible', 'detail',
    'engine', 'model', 'web_search', 'question', 'named', 'answer', 'businesses_named', 'sites_cited', 'date',
  ]);
  assert.equal(lines[0], CSV_COLUMNS.join(','), 'nothing above the header row');
  // Batch 6 item 7b: dates in Central time, "2026-11-24 12:00", no seconds or milliseconds.
  assert.equal(csvDate(AT), '2026-11-24 12:00');
  assert.equal(csvDate('2026-07-01T00:30:00.000Z'), '2026-06-30 19:30', 'daylight time');
  assert.equal(csvDate('not a date'), '');
  const meta = ['Zephyr Plumbing', 'https://zephyr.example/', 'Nashville', 'TN', csvDate(AT), '68', 'Acme Agency'];
  // A row by column name, so every expected row has exactly the 23 columns.
  const expectRow = fields => [...meta, ...CSV_COLUMNS.slice(meta.length).map(c => fields[c] ?? '')].map(csvCell).join(',');
  assert.equal(lines[1], expectRow({
    section: 'check', group: 'Search basics', item: 'Page title names your city and service', status: 'Pass', points_earned: '7', points_possible: '7',
  }));
  assert.equal(lines[2], expectRow({ section: 'health', group: 'Website: Can AI read your website', item: 'Page list for search engines (sitemap)', status: 'Found' }));
  assert.ok(csv.includes(expectRow({
    section: 'answer', engine: 'Claude', model: 'm', web_search: 'yes', question: 'Who, "best", here?', named: 'yes',
    answer: '1. Zephyr\n2. Ridge', businesses_named: 'Zephyr Plumbing; Ridge', sites_cited: 'https://yelp.com/a', date: csvDate(AT),
  })));
  assert.ok(csv.includes(expectRow({ section: 'named', item: 'Ridge', detail: '1 of 1' })));
  assert.ok(csv.includes(expectRow({ section: 'site', item: 'yelp.com', detail: '1 answer', sites_cited: 'https://yelp.com/a' })));
  assert.equal(lines[0].split(',').length, CSV_COLUMNS.length);
  assert.equal(lines[1].split(',').length, CSV_COLUMNS.length);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`, 'never a formula');
  assert.equal(csvCell('+1 615'), "'+1 615");
  // Batch 6 nit 15: leading spaces or a line break are looked past.
  assert.equal(csvCell('  =cmd'), "'  =cmd");
  assert.equal(csvCell('\n+evil'), `"'\n+evil"`);
  assert.equal(csvCell('  plain'), '  plain');
  assert.equal(reportCsv({}).split('\r\n')[0], CSV_COLUMNS.join(','));

  // The real report: one row per scored check, per health map row, per answer that came back.
  // Batch 6 fix A: the input has a scored Check, so "one check row, never also a health row" is really tested.
  const g = grade([answer({ named: true, competitors: ['Ridge Plumbing'] }), answer({ provider: 'chatgpt', webSearch: false, sources: [{ url: 'https://yelp.com/x' }] })], {
    results: [{ id: 'title-city-service', result: 'pass', detail: '' }],
  });
  const text = reportCsvFor(g);
  const real = text.trim().split('\r\n');
  assert.equal(real[0], CSV_COLUMNS.join(','));
  assert.ok(real[1].startsWith('Zephyr Plumbing,https://zephyr.example/,Nashville,TN,'));
  // Batch 5 fix B: rows are read by their section column, never by text that may also sit in another column.
  const answerRows = csvSection(text, 'answer');
  assert.equal(answerRows.length, 2, 'one row per answer that came back, no more');
  // Batch 6 item 7a: a scored Check is one "check" row, never also a "health" row, and the Free listing group is out.
  const health = csvSection(text, 'health');
  // Fix B item 9: a sensible floor again. This report is from before the signals, so its signal rows are "Not checked"
  // rows: 9 on the Website node, 4 Google profile, 3 Reviews, 6 Details match, 6 Links, plus the answers' rows. The
  // check rows for the Checks with no stored result stay (12 of them), since they have no "check" row.
  assert.ok(health.length >= 30, `${health.length} health rows`);
  assert.ok(health.some(r => r.group.startsWith('Website: ')), 'a health row still names its cluster');
  const checkItems = new Set(csvSection(text, 'check').map(r => r.item));
  assert.equal(health.some(r => checkItems.has(r.item)), false, 'no check counted twice');
  assert.equal(health.some(r => r.group === 'Free listing'), false);
  const titleRows = csvSection(text, 'check').filter(r => r.item === 'Page title names your city and service');
  assert.equal(titleRows.length, 1, 'the check is one "check" row');
  assert.deepEqual([titleRows[0].status, titleRows[0].points_earned, titleRows[0].points_possible], ['Pass', '7', '7']);
  assert.equal(health.some(r => r.item === 'Page title names your city and service'), false, 'and never also a health row');
  for (const r of csvSection(text, 'check')) assert.ok(['Pass', 'Partly', 'Needs work', 'Not checked'].includes(r.status), r.status);
  for (const r of parseCsv(text).slice(1)) assert.ok(r[4] === '' || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r[4]), r[4]);
  const claude = answerRows.find(r => r.engine === 'Claude');
  assert.deepEqual([claude.model, claude.web_search, claude.named], ['claude-test', 'yes', 'yes']);
  // K3: an answer from memory lists no cited sites.
  const chatgpt = answerRows.find(r => r.engine === 'ChatGPT');
  assert.deepEqual([chatgpt.model, chatgpt.web_search, chatgpt.named, chatgpt.answer, chatgpt.sites_cited], ['claude-test', 'no', 'no', '1. Some answer', '']);
  const ridge = csvSection(text, 'named').find(r => r.item === 'Ridge Plumbing');
  assert.equal(ridge.detail, '1 of 2');
  assert.ok(csvSection(text, 'health').every(r => r.group !== ''), 'every health row names its group');
  // Every row has every column.
  for (const row of parseCsv(text)) assert.equal(row.length, CSV_COLUMNS.length);
});

test('13.4: the print page opens every answer and the print stylesheet hides the menu, buttons, forms and animation', async () => {
  const g = grade([answer({ named: true })], { preparedBy: 'Acme' });
  const html = printPage(g);
  assert.equal(html.includes('<details>'), false, 'every answer is open');
  assert.match(html, /<section class="grade-report grade-print">/);
  // Batch 6 item 2: "Prepared by" is the title box's kicker.
  assert.match(html, /<span class="grade-eyebrow-sub grade-prepared-by">Prepared by Acme<\/span>/);
  assert.equal(html.includes('Report &middot; First Answer Pages'), false);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/, 'still noindex');
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const prints = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(prints, /\.site-nav/);
  assert.match(prints, /\.site-footer/);
  assert.match(prints, /animation: none !important/);
  assert.match(prints, /\.health-orb-host/);
  assert.match(prints, /\.grade-download[\s\S]*form/);
  // Batch 6 item 1: no forced page break anywhere (the report runs on to 6 to 8 pages).
  assert.equal(/break-before: page/.test(prints), false);
});

test('13.5: "Prepared by" is text only, one line, at most 60 characters, and escaped everywhere', () => {
  assert.equal(PREPARED_BY_MAX, 60);
  assert.equal(cleanPreparedBy('  Acme   Agency  '), 'Acme Agency');
  assert.equal(cleanPreparedBy('<script>x</script>'), 'scriptx/script');
  assert.equal(Array.from(cleanPreparedBy('x'.repeat(80))).length, 60);
  assert.equal(cleanPreparedBy('a\nb\u202Ec'), 'a bc');
  const html = printPage(grade([answer()], { preparedBy: 'Tom & "Jerry"' }));
  assert.ok(html.includes('Prepared by Tom &amp; &quot;Jerry&quot;'));
  // K17: "Prepared by" is a column on every row, guarded against formulas.
  const csv = reportCsv({ preparedBy: '=cmd', health: [{ group: 'Website', item: 'x', status: 'Found' }] });
  assert.equal(csv.split('\r\n')[0], CSV_COLUMNS.join(','));
  assert.ok(csv.split('\r\n')[1].startsWith(",,,,,,'=cmd,health,"));
});

// ---- Batch 5 (review-2026-11-25-batch4.md Z1-Z5, review-2026-11-25-full-report-reader.md K1-K23) ----------------

const FB_INPUT = { ...INPUT, website: 'https://www.facebook.com/', websitePage: 'https://www.facebook.com/riverbendplumbing' };
const RESULT = (id, result, extra = {}) => ({ id, result, detail: '', ...extra });

test('Z1: on a shared host the own page is its own "(your website)" row; competitors stay in the plain row', () => {
  const g = grade([
    answer({ sources: [{ url: 'https://www.facebook.com/MapleStreetPipe' }] }),
    answer({ provider: 'chatgpt', sources: [{ url: 'https://www.facebook.com/HollowCreek' }] }),
    answer({ provider: 'perplexity', sources: [{ url: 'https://m.facebook.com/RiverbendPlumbing/' }] }),
  ], { input: FB_INPUT, signals: { links: { facebook: { status: 'partly' } } } });
  const s = sitesUsed(g);
  assert.deepEqual(s.rows.map(r => [r.domain, r.count, r.own, r.url]), [
    ['facebook.com', 2, false, 'https://www.facebook.com/MapleStreetPipe'],
    ['facebook.com/riverbendplumbing', 1, true, 'https://m.facebook.com/RiverbendPlumbing/'],
  ]);
  // The Facebook line still counts every answer that cited any facebook.com page.
  assert.deepEqual(s.gaps, ["AI read Facebook for 3 answers. Your website doesn't link to a Facebook page."]);
  const html = sitesSection(g);
  assert.match(html, /<a href="https:\/\/www\.facebook\.com\/MapleStreetPipe" rel="nofollow noopener noreferrer">facebook\.com<\/a>: cited in 2 answers<\/li>/);
  assert.match(html, /facebook\.com\/riverbendplumbing<\/a>: cited in 1 answer <strong>\(your website\)<\/strong>/);
  // An own (not shared) domain keeps one row per domain.
  const own = grade([answer({ sources: [{ url: 'https://zephyr.example/a' }, { url: 'https://www.zephyr.example/b' }] })]);
  assert.deepEqual(sitesUsed(own).rows.map(r => [r.domain, r.count, r.own]), [['zephyr.example', 1, true]]);
});

test('Z2: only Google\'s own domains count as a Google Maps page', () => {
  assert.equal(isGoogleProfileUrl('https://google.evil.com/maps'), false);
  assert.equal(isGoogleProfileUrl('https://www.google.co.uk/maps/place/x'), true);
  assert.equal(isGoogleProfileUrl('https://google.de/maps'), true);
  assert.equal(isGoogleProfileUrl('https://www.google.com.au/maps/x'), true);
  assert.equal(isGoogleProfileUrl('https://google.com.evil.example/maps'), false);
});

test('K3: cited sites only from answers that used a live web search; answers from memory say so', () => {
  const memory = grade([answer({ webSearch: false, sources: [{ url: 'https://yelp.com/a' }] })], { signals: { links: { yelp: { status: 'partly' } } } });
  const s = sitesUsed(memory);
  assert.equal(s.hasSources, false);
  assert.deepEqual(s.gaps, []);
  assert.match(sitesSection(memory), /<p>These answers came from memory, without a live web search, so no sites were visited\.<\/p>/);
  const mixed = grade([answer({ sources: [{ url: 'https://bbb.org/x' }] }), answer({ provider: 'chatgpt', webSearch: false, sources: [{ url: 'https://angi.com/y' }] })]);
  assert.deepEqual(sitesUsed(mixed).rows.map(r => r.domain), ['bbb.org']);
  assert.match(sitesSection(mixed), /Only answers that used a live web search are counted here\./);
});

test('K1: an answer stored without its question never shows "undefined"; it falls back to the question asked', () => {
  const g = grade([answer({ prompt: undefined, named: true })]);
  const html = reportPage(g, { leadGate: false });
  assert.equal(/undefined/.test(html), false);
  assert.ok(html.includes('<strong>Who are the best plumbers in Nashville, TN? Name your top 5.</strong>'));
});

test('K2: a passed check whose details could not be read has the same tip on its card as in the health map', () => {
  const g = grade([answer()], { results: [RESULT('tap-to-call', 'pass'), RESULT('address-shown', 'pass')] });
  const html = reportPage(g, { leadGate: false });
  // Batch 6 item 4: never a green mark next to "but": both say "Partly", with the same tip; the points don't change.
  // Fix B items 5 and 7: "Full points, one fix below" instead of "4 of 4 points", and "Fix:" as the one word for advice.
  assert.match(html, /<li class="grade-check partly"><span class="grade-result">Partly<\/span><strong>Tap-to-call phone number<\/strong><br><span class="grade-points">Full points, one fix below<\/span>[\s\S]*?<p class="hint grade-tip"><strong>Fix:<\/strong> We saw a tap-to-call link but couldn(?:'|&#39;)t read the number\./);
  assert.equal(/Partly<\/span><strong>[^<]*<\/strong><br><span class="grade-points">\d+ of \d+ points/.test(html), false, 'never "Partly" with "N of N points" for a tip');
  assert.equal(html.includes('<strong>Tip:</strong>'), false);
  assert.match(html, /<strong class="health-row-name">Tap-to-call phone number:<\/strong> <span class="health-status">Found a link, but not the number<\/span>/);
  assert.match(html, /<li class="health-row health-partly"><span class="health-sym" aria-hidden="true">!<\/span><strong class="health-row-name">Tap-to-call phone number:/);
  assert.equal(/<li class="health-row health-good">(?:(?!<\/li>).)*but not/.test(html), false, 'no green mark next to "but"');
  // The CSV says the same word for the check.
  assert.ok(csvSection(reportCsvFor(g), 'check').some(r => r.item === 'Tap-to-call phone number' && r.status === 'Partly' && r.points_earned === '4'));
});

test('K4: with "Prepared by" set, the printout has none of our sales lines and one "Powered by" line', () => {
  const g = grade([answer()], { preparedBy: 'Acme Agency', results: [RESULT('business-labeled', 'fail')] });
  const print = printPage(g);
  for (const line of ['Want help?', 'can apply the fixes for you', 'Your free listing in our directory', 'Claim my free listing',
    'claim it below', FOUNDING_NOTE, 'A free listing gives AI something to read', 'Claim your free listing']) {
    assert.equal(print.includes(line), false, line);
  }
  assert.ok(print.includes(`<p class="hint grade-powered">${POWERED_BY}</p>`));
  assert.equal((print.match(/First Answer Pages/g) ?? []).length >= 1, true);
  // Batch 6 fix B item 4: on screen, with "Prepared by" set, the web page follows the same rules as the printout.
  const screen = reportPage(g, { leadGate: false });
  assert.equal(screen.includes('Want help?'), false);
  assert.equal(screen.includes('Your free listing in our directory'), false);
  assert.ok(screen.includes(`<p class="hint grade-powered">${POWERED_BY}</p>`));
  // Without "Prepared by", everything is as before.
  const ours = grade([answer()], { results: [RESULT('business-labeled', 'fail')] });
  assert.ok(reportPage(ours, { leadGate: false }).includes('Want help?'));
  assert.ok(printPage(ours).includes('Your free listing in our directory'));
  assert.equal(printPage(ours).includes(POWERED_BY), false);
  // The CSV of an agency has no "claim it below" either.
  assert.equal(reportCsvFor(g).includes('claim it below'), false);
});

test('K5, K6, K7: the print stylesheet runs sections on, hides screen-only words, and prints the center once', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const prints = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.equal(/\.grade-report > section, \.grade-full > section \{ break-before: page; \}/.test(prints), false, 'no break per section');
  // Batch 6 item 1: no forced page break at all, and groups flow (only single rows and cards are kept whole).
  assert.equal(/break-before: page/.test(prints), false);
  assert.match(prints, /\.grade-check,[^{]*\{ break-inside: avoid; \}/);
  assert.equal(/\.health-group[,\s][^{]*\{ break-inside: avoid/.test(prints), false, 'a whole health group is never kept on one page');
  assert.match(prints, /details > summary, \.copy-btn, \.grade-remove \{ display: none !important; \}/);
  assert.match(prints, /\.health-orb-name, \.health-orb-score \{ stroke: none !important; paint-order: normal !important;/);
  const g = grade([answer()], { results: [RESULT('business-labeled', 'fail')] });
  const print = printPage(g);
  assert.equal(print.includes(SEND_THIS_PAGE), false);
  assert.ok(print.includes(PRINT_KIT_LINE));
  assert.equal(print.includes('the Copy button copies it'), false);
  assert.ok(reportPage(g, { leadGate: false }).includes(SEND_THIS_PAGE), 'the screen keeps it');
});

test('K8: "Score by area" says how many points couldn\'t be checked, and which checks', () => {
  const g = grade([answer()], {
    results: [RESULT('title-city-service', 'pass'), RESULT('summary', 'not_checked'), RESULT('share-picture', 'not_checked')],
  });
  const line = notCheckedLine(g);
  assert.ok(line.includes("6 points couldn&#39;t be checked this time, so they don&#39;t count for or against you.") || line.includes("6 points couldn't be checked this time, so they don't count for or against you."));
  assert.ok(line.includes('Not checked: Search summary (the 2 lines under your link in Google) and Picture shown when someone shares your link.'));
  assert.equal(notCheckedLine(grade([answer()], { results: [RESULT('summary', 'pass')] })), '');
});

test('K10, K11, K12, K13: one name per check; the kit is linked; boxes already done say so; the label is complete', () => {
  const g = grade([answer()], {
    results: [RESULT('business-labeled', 'fail'), RESULT('title-city-service', 'pass'), RESULT('info-sheet', 'pass')],
    facts: { links: [{ href: 'https://www.facebook.com/zephyrplumbing' }, { href: 'https://www.facebook.com/sharer/sharer.php?u=x' }] },
  });
  const html = reportPage(g, { leadGate: false });
  // The health map's names on the score cards and the kit.
  assert.ok(html.includes('<strong>Name, phone and address tagged for AI (business label)</strong>'));
  assert.ok(html.includes('<h3>A short info file for AI (llms.txt)</h3>'));
  assert.equal(html.includes('Business label for AI'), false);
  // K11: the full report points at the kit, with a link.
  // Batch 6 nit 11: lower case.
  assert.ok(html.includes('(<a href="#kit-label">the code is in your fix kit, at the end of this report</a>)'));
  assert.equal(html.includes('in your full report)'), false);
  // K12: boxes for checks that passed.
  assert.equal((html.match(new RegExp(ALREADY_HAVE.replace(/[.]/g, '\\.'), 'g')) ?? []).length, 2);
  // K13: the address, sameAs from the profile link found, placeholders and the plain warning.
  assert.ok(html.includes('so AI can read your name, phone and address.'));
  assert.ok(html.includes(`<strong>${REPLACE_CAPITALS}</strong>`));
  const label = jsonLdBlock({ name: 'Zephyr', city: 'Nashville', state: 'TN', sameAs: ['https://www.facebook.com/zephyrplumbing', 'javascript:x'] }, { placeholders: true });
  assert.ok(label.includes(STREET_PLACEHOLDER) && label.includes(ZIP_PLACEHOLDER));
  assert.match(label, /"sameAs": \[\s*"https:\/\/www\.facebook\.com\/zephyrplumbing"\s*\]/);
  assert.ok(html.includes('https://www.facebook.com/zephyrplumbing'));
  assert.equal(html.includes('sharer.php'), false, 'a share button is never a profile');
  // Without the option nothing changes (the public listing pages never use it).
  assert.equal(jsonLdBlock({ name: 'Zephyr', city: 'Nashville', state: 'TN' }).includes(STREET_PLACEHOLDER), false);
});

test('K15, K16: the share-of-voice heading says where the answers came from; evidence names the stored model and time', () => {
  const g = grade([
    answer({ named: true }), answer({ named: true }), answer(),
    answer({ provider: 'chatgpt' }), answer({ provider: 'perplexity' }),
  ]);
  assert.equal(answersFromLine(g), '3 Claude answers plus 1 from ChatGPT and 1 from Perplexity.');
  assert.ok(voiceSection(g).includes('<p class="hint">3 Claude answers plus 1 from ChatGPT and 1 from Perplexity.</p>'));
  assert.equal(answersFromLine(grade([answer(), answer()])), '');
  assert.equal(evidence(answer({ model: 'claude-sonnet-4-5' }), 'Claude'), `Evidence: Claude claude-sonnet-4-5, ${evidenceTime(AT)}, live web search on.`);
});

test('K18, K19, K23: plain button names and sentences about the reader; who can see the report', async () => {
  const g = grade([answer()]);
  const html = reportPage(g, { leadGate: false });
  assert.ok(html.includes('>Print or save as PDF</a>'));
  assert.equal(html.includes('Download report'), false);
  assert.ok(html.includes('Only people with this link can see this report.'));
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  assert.match(css, /\.grade-prepared \.button-secondary \{/);
  for (const text of [answersFromLine(grade([answer(), answer({ provider: 'chatgpt' })])), POWERED_BY, ALREADY_HAVE, PRINT_KIT_LINE, REPLACE_CAPITALS]) {
    assert.ok(text.length <= 160, text);
    assert.equal(/guarantee|\$\d|colour|centre|will (?:name|recommend)/i.test(text), false, text);
  }
});

// ---- Batch 6 (batch6-fixes-2026-11-25.md, from review-2026-11-25-batch5.md and review-2026-11-25-batch5-reader.md) --

/** Every sentence of a text, split at its ends. */
const sentencesOf = text => String(text).split(/(?<=[.!?])\s+/).filter(Boolean);

test('batch 6 item 1: in print the map is small and first, answers print once, and the cards list only what needs work', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const prints = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  // The map has a print width limit small enough to share page 1 with the score box.
  const width = /\.health-map \{[^}]*max-width: ([\d.]+)rem/.exec(prints);
  assert.ok(width, 'the map has a print width limit');
  assert.ok(Number(width[1]) <= 18, `${width[1]}rem`);
  assert.match(prints, /\.health-map \{[^}]*order: -1/, 'the map comes before the list on paper');
  assert.match(prints, /\.grade-ai details, \.grade-ai \.grade-answer \{ display: none !important; \}/);
  assert.match(prints, /\.grade-check\.pass, \.grade-check\.not_checked \{ display: none !important; \}/);
  assert.match(prints, /\.grade-print-only \{ display: block !important; \}/);
  assert.match(css, /\n\.grade-print-only \{ display: none; \}/, 'the paper-only line is hidden on screen');
  // "What AI says" keeps its summary and the names; the full text is in "Every answer".
  const g = grade([answer({ named: true, competitors: ['Ridge Plumbing'] })], { results: [RESULT('business-labeled', 'fail')] });
  const print = printPage(g);
  assert.ok(print.includes(PRINT_CARDS_NOTE));
  const whatAiSays = /<section class="grade-ai">[\s\S]*?<\/section>/.exec(print)?.[0] ?? '';
  assert.ok(whatAiSays.includes('Ridge Plumbing'));
  assert.ok(/<section class="grade-all-answers">[\s\S]*grade-answer/.test(print), 'the full answer is in "Every answer"');
});

test('batch 6 item 2: "Prepared by" is the kicker, and the agency report has no Free listing group at all', async () => {
  const g = grade([answer()], { preparedBy: 'Harbor Digital Marketing', results: [RESULT('business-labeled', 'fail')] });
  const print = printPage(g);
  assert.ok(print.includes('<span class="grade-eyebrow-sub grade-prepared-by">Prepared by Harbor Digital Marketing</span>'));
  assert.equal(print.includes('Report &middot; First Answer Pages'), false);
  for (const text of ['Listed on First Answer Pages', 'Verified stamp', 'Listing matches your website', 'Listing links to your website',
    'Free listing', 'i = about your free listing', 'data-main="listing"']) {
    assert.equal(print.includes(text), false, text);
  }
  // Batch 6 fix A: the page is escaped ("couldn&#39;t"), so the intro is compared as it is written in the page.
  assert.ok(print.includes(`<p class="hint health-intro">${MAP_INTRO_NO_LISTING.replace(/'/g, '&#39;')}</p>`), 'the intro without the listing line');
  assert.equal((print.match(/<g class="health-branch" data-main="/g) ?? []).length, 12, 'six nodes in each of the two drawings');
  assert.ok(print.includes(`<p class="hint grade-powered">${POWERED_BY}</p>`));
  // The model itself leaves the group out, so the CSV follows.
  const model = healthModel(g, { agency: true });
  assert.equal(model.mains.some(m => m.id === 'listing'), false);
  assert.equal(model.mains.length, 6);
  assert.ok(healthModel(g).mains.some(m => m.id === 'listing'), 'our own report keeps it');
  // Without "Prepared by" the kicker and the listing group stay.
  const ours = printPage(grade([answer()]));
  assert.ok(ours.includes('Report &middot; First Answer Pages'));
  assert.ok(ours.includes('Free listing'));
  // The CSV never has the Free listing group, with or without "Prepared by".
  for (const x of [g, { ...g, preparedBy: '' }]) {
    const csv = reportCsvFor(x);
    assert.equal(csv.includes('Listed on First Answer Pages'), false);
    assert.equal(csv.includes('claim it below'), false);
    assert.equal(csvSection(csv, 'health').some(r => r.group === 'Free listing'), false);
  }
});

test('batch 6 item 3: no printed sentence is left broken; the footer says what to do in words', () => {
  const print = printPage(grade([answer()]));
  assert.equal(print.includes('so after you make fixes'), false);
  const meta = /<p class="grade-meta">[\s\S]*?<\/p>/.exec(print)?.[0] ?? '';
  assert.ok(meta.includes(PRINT_FOOTER_TAIL));
  assert.equal(/<a /.test(meta), false, 'no link left in the printed footer');
  assert.equal(PRINT_FOOTER_TAIL, 'so check again after you make fixes.');
  // On screen the footer keeps its link.
  assert.match(reportPage(grade([answer()]), { leadGate: false }), /so <a href="\/grade\?from=[^"]+">run a full new check<\/a> after you make fixes\./);
});

test('batch 6 item 5: "Who AI named" and "Sites AI used" come right after the score box, with one line from the real counts', () => {
  const g = grade([
    answer({ named: true, competitors: ['Hollow Creek', 'Maple Street'] }), answer({ named: true, competitors: ['Hollow Creek', 'Maple Street'] }),
    answer({ competitors: ['Hollow Creek', 'Maple Street'] }),
    answer({ provider: 'chatgpt', named: true, competitors: ['Hollow Creek', 'Maple Street'] }),
    answer({ provider: 'perplexity', competitors: ['Hollow Creek', 'Maple Street', 'Ridge'] }),
  ]);
  assert.equal(voiceSummary(g), 'Two competitors were named in every answer. You were named in 3 of 5.');
  assert.equal(voiceSummary(grade([answer({ competitors: ['Ridge'] }), answer({ named: true })])), 'You were named in 1 of 2.');
  assert.equal(voiceSummary(grade([answer()])), '', 'one answer: nothing to sum up');
  const html = reportPage(g, { leadGate: false });
  assert.ok(html.includes('<p class="grade-voice-summary">Two competitors were named in every answer. You were named in 3 of 5.</p>'));
  const score = html.indexOf('<div class="grade-top">');
  const voice = html.indexOf('<section class="grade-voice">');
  const sites = html.indexOf('<section class="grade-sites">');
  const health = html.indexOf('<section class="health"');
  assert.ok(score < voice && voice < sites && sites < health, 'score box, then who AI named, then sites, then the health map');
  for (const s of sentencesOf(voiceSummary(g))) assert.ok(s.length <= 160, s);
});

test('batch 6 item 8: "How we checked" from the real counts, a snapshot, never a promise', () => {
  const g = grade([
    answer({ named: true }), answer(), answer(), answer({ provider: 'chatgpt' }), answer({ provider: 'perplexity' }),
  ]);
  // Fix B item 10: words for one to nine.
  assert.match(howWeChecked(g), /^We asked one question and got answers from Claude three times, ChatGPT once,? and Perplexity once\. /);
  assert.equal(/\d/.test(howWeChecked(g)), false, 'no digits next to "once"');
  assert.ok(howWeChecked(g).endsWith(SNAPSHOT_LINE));
  assert.equal(howWeChecked(grade([answer()])), `We asked one question and got answers from Claude once. ${SNAPSHOT_LINE}`);
  assert.equal(howWeChecked(grade([])), '');
  const html = reportPage(g, { leadGate: false });
  assert.ok(html.includes(`<p class="hint grade-method"><strong>How we checked:</strong> ${howWeChecked(g)}</p>`));
  assert.ok(printPage(g).includes('<strong>How we checked:</strong>'));
  for (const s of sentencesOf(howWeChecked(g))) {
    assert.ok(s.length <= 160, s);
    assert.equal(/guarantee|will (?:name|recommend)|\$\d|colour|centre/i.test(s), false, s);
  }
});

test('batch 6 item 9: the share box says which page is for clients', () => {
  const html = reportPage(grade([answer()]), { leadGate: false });
  assert.ok(html.includes(PRINT_FOR_CLIENTS));
  assert.equal(PRINT_FOR_CLIENTS, 'Use the print page for clients; the web page above is for you.');
});

test('batch 6 item 10: an answer without its question, next to answers with one, gets a neutral heading', () => {
  const mixed = grade([answer({ named: true }), answer({ provider: 'chatgpt', prompt: undefined })]);
  const html = reportPage(mixed, { leadGate: false });
  const every = /<section class="grade-all-answers">[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
  assert.ok(every.includes(`<strong>${NO_QUESTION_SAVED}</strong>`));
  assert.equal((every.match(/<strong>Who are the best plumbers in Nashville, TN\? Name your top 5\.<\/strong>/g) ?? []).length, 1, 'the real question once');
  // When no answer kept its question, the question asked is used (batch 5 K1).
  const none = reportPage(grade([answer({ prompt: undefined })]), { leadGate: false });
  assert.equal(none.includes(NO_QUESTION_SAVED), false);
});

test('batch 6 nits 11 to 13: lower-case "your fix kit", lining numerals, and "the map" instead of "the lights"', async () => {
  assert.equal(failedNote(13), "13 checks make up your score. The map also shows extra checks that don't count toward your score.");
  assert.equal(failedNote(1).startsWith('1 check makes up your score.'), true);
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  assert.match(css, /font-variant-numeric: lining-nums;/);
});

// ---- Batch 6, fix B (batch6-fix-B-2026-11-26.md) ------------------------------------------------------------------

/** A stored Grade of the real shape: every scored Check has a result, as a finished check stores them. */
function realGrade(ai, extra = {}) {
  const results = CHECKS.filter(c => c.id !== 'google-profile')
    .map((c, k) => ({ id: c.id, result: c.id === 'ai-named' ? 'fail' : (k % 3 === 0 ? 'fail' : 'pass'), detail: 'stored detail' }));
  return grade(ai, { results, found: { phone: '(615) 555-0142', address: '12 Main St, Nashville, TN 37203', hours: [] }, ...extra });
}

const FIVE = () => [
  answer({ named: true, competitors: ['Hollow Creek'] }), answer({ competitors: ['Hollow Creek'] }), answer({ named: true, competitors: ['Hollow Creek'] }),
  answer({ provider: 'chatgpt', competitors: ['Hollow Creek'] }), answer({ provider: 'perplexity', named: true, competitors: ['Hollow Creek'] }),
];

test('fix B must-fix 2: on a real report no Check is in both the "check" and the "health" sections, matched by id', () => {
  for (const g of [realGrade(FIVE()), realGrade(FIVE(), { preparedBy: 'Acme' }), realGrade([answer()], { input: { ...INPUT, noStorefront: true } })]) {
    const text = reportCsvFor(g);
    const checks = csvSection(text, 'check');
    const health = csvSection(text, 'health');
    assert.equal(checks.length, 14, 'the 13 website checks and the AI check, once each');
    const checkItems = new Set(checks.map(r => r.item));
    assert.deepEqual(health.filter(r => checkItems.has(r.item)).map(r => r.item), [], 'no check counted twice');
    // Every health row that shows a Check is gone, by id, whatever its name (the no-storefront address row too).
    assert.deepEqual(health.filter(r => CHECK_ROW_IDS.has(r.item)).map(r => r.item), []);
    for (const r of checks) assert.ok(['Pass', 'Partly', 'Needs work', 'Not checked'].includes(r.status), r.status);
  }
  // An old report with no stored result for a Check keeps that Check's health row (it has no "check" row to replace it).
  const old = reportCsvFor(grade([answer()], { results: [] }));
  assert.ok(csvSection(old, 'health').some(r => r.item === 'Tap-to-call phone number'));
  assert.equal(csvSection(old, 'check').some(r => r.item === 'Tap-to-call phone number'), false);
});

test('fix B must-fix 1: the print page puts the map right after the score box; the list prints only rows that are not green', async () => {
  const g = realGrade(FIVE());
  const print = printPage(g);
  const top = print.indexOf('<div class="grade-top">');
  const health = print.indexOf('<section class="health"');
  const voice = print.indexOf('<section class="grade-voice">');
  assert.ok(top < health && health < voice, 'score box, then the health map, then "Who AI named"');
  assert.ok(print.includes(`<p class="hint grade-print-only">${PRINT_HEALTH_NOTE}</p>\n  <div class="health-layout">`));
  // On screen the order of batch 6 item 5 stays.
  const screen = reportPage(g, { leadGate: false });
  assert.ok(screen.indexOf('<section class="grade-voice">') < screen.indexOf('<section class="health"'));
  assert.equal(screen.includes(PRINT_HEALTH_NOTE), false);
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const prints = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(prints, /\.health-row\.health-good \{ display: none !important; \}/);
  const width = Number(/\.health-map \{[^}]*max-width: ([\d.]+)rem/.exec(prints)?.[1]);
  assert.ok(width <= 12, `${width}rem`);
  assert.equal(/\.kit-item[,\s][^{]*\{ break-inside: avoid/.test(prints), false, 'a kit box may break, so no half-empty pages');
});

test('fix B must-fix 3: the report headings draw their digits with lining figures, not the digits-only display font', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  // The rule that puts the digits-only font first on every h1, h2 and h3 (not its @font-face).
  const oldNumbers = css.lastIndexOf('font-family: "Old Numbers", "Fira Sans Condensed"');
  const rule = /\.grade-report h2, \.grade-report h3, \.grade-report h4, \.health h2, \.health h3, \.health h4, \.kit-item h3 \{\s*font-family: "Fira Sans Condensed"[^}]*font-variant-numeric: lining-nums;[^}]*font-feature-settings: "lnum" 1;/.exec(css);
  assert.ok(rule, 'the rule is there');
  assert.ok(oldNumbers !== -1 && rule.index > oldNumbers, 'it comes after the "Old Numbers" rule, so it wins');
});

test('fix B item 4: with "Prepared by" set, the web page follows the printout: kicker, no listing, no header button', () => {
  const g = realGrade([answer()], { preparedBy: 'Music City Web Co.' });
  const html = reportPage(g, { leadGate: false });
  assert.ok(html.includes('<span class="grade-eyebrow-sub grade-prepared-by">Prepared by Music City Web Co.</span>'));
  for (const text of ['Report &middot; First Answer Pages', 'List your business free', 'class="nav-cta"', 'Claim my free listing',
    'data-main="listing"', 'Listed on First Answer Pages', 'Want help?', 'Ask us to remove this report']) {
    assert.equal(html.includes(text), false, text);
  }
  assert.ok(html.includes(`<p class="hint grade-powered">${POWERED_BY}</p>`));
  // Batch 6 fix C: one plain sentence, with the link on its last words.
  assert.match(html, /Only people with this link can see this report\. To have this report removed, <a [^>]*>contact First Answer Pages<\/a>\.<\/p>/);
  // Without a name, the web page is as before.
  const ours = reportPage(realGrade([answer()]), { leadGate: false });
  for (const text of ['Report &middot; First Answer Pages', 'List your business free', 'Claim my free listing', 'Ask us to remove this report']) {
    assert.ok(ours.includes(text), text);
  }
  assert.equal(ours.includes(POWERED_BY), false);
});

test('fix B item 6: with one answer there is no table, only a plain sentence', () => {
  const one = grade([answer({ competitors: ['Ridge Plumbing', 'Ace <b>Drains</b>'] })]);
  const html = voiceSection(one);
  assert.equal(html.includes('<table'), false);
  assert.ok(html.includes('<h2>Who AI named, across 1 answer</h2>'));
  // The names come in share-of-voice order (most answers first, then A to Z), escaped.
  assert.ok(html.includes("<p class=\"grade-voice-summary\">The one answer didn&#39;t name you, and named Ace &lt;b&gt;Drains&lt;/b&gt; and Ridge Plumbing.</p>"));
  assert.equal(oneAnswerLine([{ name: 'Zephyr', count: 1, own: true }]), 'The one answer named you.');
  assert.equal(oneAnswerLine([{ name: 'Zephyr', count: 1, own: true }, { name: 'Ridge', count: 1, own: false }]), 'The one answer named you, and also named Ridge.');
  assert.ok(voiceSection(grade([answer(), answer()])).includes('<table'), 'two answers keep the table');
});

test('fix C: on paper the map comes before the list, in a block layout, and the fix kit heading stays with its first box', async () => {
  const g = realGrade(FIVE());
  const print = printPage(g);
  const section = /<section class="health"[\s\S]*?<\/section>/.exec(print)?.[0] ?? '';
  assert.ok(section.indexOf('<div class="health-map"') !== -1);
  assert.ok(section.indexOf('<div class="health-map"') < section.indexOf('<div class="health-list">'), 'print: the map first');
  // On screen the list stays first in the page (screen readers and search tools read it first).
  const screen = /<section class="health"[\s\S]*?<\/section>/.exec(reportPage(g, { leadGate: false }))?.[0] ?? '';
  assert.ok(screen.indexOf('<div class="health-list">') < screen.indexOf('<div class="health-map"'), 'screen: the list first');
  // The same rows and the same map either way.
  const rows = html => (html.match(/<li class="health-row /g) ?? []).length;
  assert.equal(rows(section), rows(screen));
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const prints = [...css.matchAll(/@media print \{([\s\S]*?)\n\}/g)].map(m => m[1]).join('\n');
  assert.match(prints, /\.health-layout \{ display: block !important; \}/);
  assert.equal(/\.health-layout \{ display: flex/.test(prints), false, 'no flex layout around the map on paper');
  assert.match(prints, /\.health > h2, \.health-intro, \.health > \.grade-print-only \{ break-after: avoid; \}/);
  assert.match(prints, /\.grade-kit > h2, \.grade-kit > h2 \+ p \{ break-after: avoid; \}/);
  assert.match(prints, /\.grade-kit > p \+ \.kit-item \{ break-before: avoid; \}/);
});

test('fix C: the "1." before each question in "Every answer" uses lining figures, after the "Old Numbers" rule', async () => {
  const css = await fs.readFile(fileURLToPath(new URL('../public/css/style.css', import.meta.url)), 'utf8');
  const oldNumbers = css.lastIndexOf('font-family: "Old Numbers", "Fira Sans Condensed"');
  const rule = /\.grade-all-answers ol > li::marker \{\s*font-family: "Fira Sans Condensed"[^}]*font-variant-numeric: lining-nums;[^}]*"lnum" 1;/.exec(css);
  assert.ok(rule, 'the marker rule is there');
  assert.ok(rule.index > oldNumbers, 'and it comes after the Old Numbers rule, so it wins');
});

test('fix B item 10: "How we checked" uses words for one to nine', () => {
  const nine = grade(Array.from({ length: 9 }, () => answer()));
  assert.match(howWeChecked(nine), /from Claude nine times\./);
  const twelve = grade(Array.from({ length: 12 }, () => answer()));
  assert.match(howWeChecked(twelve), /from Claude 12 times\./);
});