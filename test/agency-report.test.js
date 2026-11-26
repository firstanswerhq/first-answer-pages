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
  answersOf, isGoogleProfileUrl,
} from '../server/lib/agency-report.js';
import {
  voiceSection, sitesSection, printPage, reportCsvFor, reportPage, notCheckedLine, answersFromLine, POWERED_BY, ALREADY_HAVE,
  PRINT_KIT_LINE, SEND_THIS_PAGE,
} from '../server/lib/grade-html.js';
import { FOUNDING_NOTE } from '../server/lib/health-map.js';
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
  const rows = reportCsvFor(g).split('\r\n').filter(line => line.startsWith('answer,'));
  assert.equal(rows.length, shareOfVoice(g).total);
  assert.equal(rows.length, 2);
  assert.equal(answersOf(g).length, 2);
});

test('13.3: the evidence says who answered, the model, when, and whether it searched the web live', () => {
  assert.equal(evidence(answer(), 'Claude'), `Evidence: Claude (model claude-test), asked ${evidenceTime(AT)}, with a live web search.`);
  assert.equal(evidenceTime(AT), 'Nov 24, 2026, 12:00 PM CT');
  assert.equal(evidence(answer({ model: '', webSearch: false }), 'Gemini'), `Evidence: Gemini, asked ${evidenceTime(AT)}, without a live web search.`);
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
  const meta = ['Zephyr Plumbing', 'https://zephyr.example/', 'Nashville', 'TN', AT, '68', 'Acme Agency'];
  // A row by column name, so every expected row has exactly the 23 columns.
  const expectRow = fields => [...meta, ...CSV_COLUMNS.slice(meta.length).map(c => fields[c] ?? '')].map(csvCell).join(',');
  assert.equal(lines[1], expectRow({
    section: 'check', group: 'Search basics', item: 'Page title names your city and service', status: 'Pass', points_earned: '7', points_possible: '7',
  }));
  assert.equal(lines[2], expectRow({ section: 'health', group: 'Website: Can AI read your website', item: 'Page list for search engines (sitemap)', status: 'Found' }));
  assert.ok(csv.includes(expectRow({
    section: 'answer', engine: 'Claude', model: 'm', web_search: 'yes', question: 'Who, "best", here?', named: 'yes',
    answer: '1. Zephyr\n2. Ridge', businesses_named: 'Zephyr Plumbing; Ridge', sites_cited: 'https://yelp.com/a', date: AT,
  })));
  assert.ok(csv.includes(expectRow({ section: 'named', item: 'Ridge', detail: '1 of 1' })));
  assert.ok(csv.includes(expectRow({ section: 'site', item: 'yelp.com', detail: '1 answer', sites_cited: 'https://yelp.com/a' })));
  assert.equal(lines[0].split(',').length, CSV_COLUMNS.length);
  assert.equal(lines[1].split(',').length, CSV_COLUMNS.length);
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`, 'never a formula');
  assert.equal(csvCell('+1 615'), "'+1 615");
  assert.equal(reportCsv({}).split('\r\n')[0], CSV_COLUMNS.join(','));

  // The real report: one row per scored check, per health map row, per answer that came back.
  const g = grade([answer({ named: true, competitors: ['Ridge Plumbing'] }), answer({ provider: 'chatgpt', webSearch: false, sources: [{ url: 'https://yelp.com/x' }] })]);
  const real = reportCsvFor(g).trim().split('\r\n');
  assert.equal(real[0], CSV_COLUMNS.join(','));
  assert.ok(real[1].startsWith('Zephyr Plumbing,https://zephyr.example/,Nashville,TN,'));
  assert.equal(real.filter(l => l.includes(',answer,')).length, 2);
  assert.ok(real.filter(l => l.includes(',health,')).length >= 40);
  assert.ok(real.some(l => /,answer,,,,,,,Claude,claude-test,yes,.*,yes,/.test(l)));
  // K3: an answer from memory lists no cited sites.
  assert.ok(real.some(l => /,answer,,,,,,,ChatGPT,claude-test,no,.*,no,1\. Some answer,,,/.test(l)));
  assert.ok(real.some(l => l.includes(',named,,Ridge Plumbing,,,,1 of 2,')));
  assert.ok(real.some(l => l.includes(',health,Website: Search basics,')), 'the cluster is named with its group');
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
  assert.match(html, /<li class="grade-check pass"><span class="grade-result">Pass<\/span><strong>Tap-to-call phone number<\/strong>[\s\S]*?<p class="hint grade-tip"><strong>Tip:<\/strong> We saw a tap-to-call link but couldn(?:'|&#39;)t read the number\./);
  assert.match(html, /<strong class="health-row-name">Tap-to-call phone number:<\/strong> <span class="health-status">Found a link, but not the number<\/span>/);
  assert.match(html, /<li class="health-row health-good"[^>]*>[\s\S]{0,200}Tap-to-call phone number:/);
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
  // On screen, "Want help?" is hidden when "Prepared by" is set; the free listing card stays.
  const screen = reportPage(g, { leadGate: false });
  assert.equal(screen.includes('Want help?'), false);
  assert.ok(screen.includes('Your free listing in our directory'));
  assert.equal(screen.includes(POWERED_BY), false);
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
  assert.match(prints, /\.grade-kit \{ break-before: page; \}/);
  assert.match(prints, /\.grade-check,[^{]*\{ break-inside: avoid; \}/);
  assert.match(prints, /details > summary, \.copy-btn, \.grade-remove, \.grade-meta a \{ display: none !important; \}/);
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
  assert.ok(html.includes('(<a href="#kit-label">the code is in Your fix kit, at the end of this report</a>)'));
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
  assert.equal(evidence(answer({ model: 'claude-sonnet-4-5' }), 'Claude'), `Evidence: Claude (model claude-sonnet-4-5), asked ${evidenceTime(AT)}, with a live web search.`);
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
