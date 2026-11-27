/**
 * addon-fix-pack: the fix pack. A Google Business Profile description, FAQ text and FAQ markup built only from what
 * the owner typed and what the check found; the "Your fix pack" section of the full report; and the plain-text
 * download. Pure builders first, then the page, then the route.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';

import {
  GBP_DESCRIPTION_MAX, GBP_ALLOWS_LINKS, GBP_ALLOWS_PHONE, FAQ_MIN_PAIRS, FAQ_ADD_FIRST, FAQ_MARKUP_LINE,
  GBP_ABOUT_LEFT_OUT, FAQ_QUESTIONS, PACK_HEADINGS, FAQ_JSON_TEXT_NOTE,
  gbpDescription, gbpAboutLeftOut, faqPairs, faqText, faqJsonData, faqJsonLd, fixPackText,
} from '../server/lib/fix-kit.js';
import { reportPage, PACK_HELP, fixPackTextFor } from '../server/lib/grade-html.js';
import { createApp } from '../server/app.js';

const REPO_DATA = fileURLToPath(new URL('../data/', import.meta.url));
const START = Date.UTC(2026, 10, 22, 18, 0, 0);
const len = s => Array.from(s).length;

const FULL = {
  name: 'Acme Roofing', service: 'Roofers', city: 'Nashville', state: 'tn',
  phone: '(615) 555-0100', website: 'https://acme.example/', address: '12 Main Street, Nashville, TN 37203',
  hours: ['Monday to Friday, 7:00 am to 6:00 pm'],
};

const PROMISE = /will name|guarantee|\$|rank you|get you named/iu;
const BRITISH = /colour|neighbour|licence|centre|organis|favourite/iu;
const BANNED = ['licensed', 'insured', 'family owned', 'free estimate', '24/7', 'emergency', 'award', 'guarantee', 'best', '#1'];

/** The JSON inside a `<script type="application/ld+json">` block. */
function jsonOf(block) {
  assert.ok(block.startsWith('<script type="application/ld+json">\n'));
  assert.ok(block.endsWith('\n</script>'));
  const inner = block.slice('<script type="application/ld+json">\n'.length, -'\n</script>'.length);
  assert.equal(inner.includes('<'), false, 'no raw < inside the block');
  return JSON.parse(inner);
}

// ---- task 1: the limits ---------------------------------------------------------------------------------------

test('task 1: the Google Business Profile description limits (from the spec)', () => {
  assert.equal(GBP_DESCRIPTION_MAX, 750);
  assert.equal(GBP_ALLOWS_LINKS, false);
  assert.equal(GBP_ALLOWS_PHONE, false);
  assert.equal(FAQ_MIN_PAIRS, 2);
});

// ---- task 2: the Google description -------------------------------------------------------------------------

test('gbpDescription: the typed service and the place when there are no own words', () => {
  assert.equal(gbpDescription(FULL), 'Acme Roofing offers roofers. Serving Nashville, TN.');
  assert.equal(gbpDescription({ ...FULL, service: 'HVAC repair' }), 'Acme Roofing offers HVAC repair. Serving Nashville, TN.');
  assert.equal(gbpDescription({ name: 'Acme Roofing', service: 'Roofers' }), 'Acme Roofing offers roofers.');
  assert.equal(gbpDescription({ name: '', service: 'Roofers', city: 'Nashville' }), '', 'no name, no description');
});

test('gbpDescription: the place sentence for a storefront and for no storefront', () => {
  assert.ok(gbpDescription(FULL).endsWith(' Serving Nashville, TN.'));
  assert.ok(gbpDescription({ ...FULL, noStorefront: true }).endsWith(' Serving Nashville, TN and nearby areas.'));
  assert.ok(gbpDescription({ ...FULL, state: '' }).endsWith(' Serving Nashville.'));
});

test('gbpDescription: the owner\'s words are the first sentence exactly as typed', () => {
  assert.equal(gbpDescription({ ...FULL, about: 'We fix leaking pipes' }), 'We fix leaking pipes. Serving Nashville, TN.');
  assert.equal(gbpDescription({ ...FULL, about: 'We fix pipes!' }), 'We fix pipes! Serving Nashville, TN.', 'no second end mark');
  assert.equal(gbpDescription({ ...FULL, about: 'we FIX pipes' }), 'we FIX pipes. Serving Nashville, TN.', 'never recased');
  assert.equal(gbpAboutLeftOut({ ...FULL, about: 'We fix leaking pipes' }), false);
  assert.equal(gbpAboutLeftOut(FULL), false, 'no words typed, nothing left out');
});

test('gbpDescription: own words with a web address, an email, a phone number or an emoji are not used, and the box says why', () => {
  for (const about of [
    'See www.acme.example for more', 'Visit https://acme.example today', 'Email jo@acme.example',
    'Call 615 555 0100 now', 'Call (615) 555-0100', 'Text 6155550100', 'Fast roofs \u{1F680}',
  ]) {
    const out = gbpDescription({ ...FULL, about });
    assert.equal(out, 'Acme Roofing offers roofers. Serving Nashville, TN.', about);
    assert.equal(gbpAboutLeftOut({ ...FULL, about }), true, about);
  }
  assert.ok(GBP_ABOUT_LEFT_OUT.includes('web address'));
});

const word = fc.stringMatching(/^[A-Za-z][a-z]{0,9}$/);
const words = (min, max) => fc.array(word, { minLength: min, maxLength: max }).map(a => a.join(' '));

test('gbpDescription: at most 750 code points, cut at a word, never a web address, an @ or 7 digits in a row', () => {
  fc.assert(fc.property(words(1, 5), words(1, 4), words(1, 2), fc.option(words(1, 220), { nil: undefined }), fc.boolean(),
    (name, service, city, about, noStorefront) => {
      const f = { ...FULL, name, service, city, about, noStorefront };
      const out = gbpDescription(f);
      assert.ok(len(out) <= GBP_DESCRIPTION_MAX, String(len(out)));
      assert.equal(/https?:\/\/|www\.|@/iu.test(out), false);
      assert.equal(/(?:\d[\s().-]{0,2}){6}\d/u.test(out), false);
      assert.equal(out.includes('555'), false, 'the phone is never put in');
      if (about) {
        const full = `${about}. ${noStorefront ? `Serving ${city}, TN and nearby areas.` : `Serving ${city}, TN.`}`;
        assert.ok(out === full || (full.startsWith(out) && full[out.length] === ' '), 'cut at a word, never mid-word');
      }
    }), { numRuns: 300 });
});

// ---- task 3: the FAQ ---------------------------------------------------------------------------------------------

test('faqPairs: the five pairs in order, each built from one fact', () => {
  assert.deepEqual(faqPairs(FULL), [
    { question: FAQ_QUESTIONS.what, answer: 'Acme Roofing offers roofers.' },
    { question: FAQ_QUESTIONS.where, answer: 'Acme Roofing serves Nashville, TN. The address is 12 Main Street, Nashville, TN 37203.' },
    { question: FAQ_QUESTIONS.reach, answer: 'Call Acme Roofing at (615) 555-0100.' },
    { question: FAQ_QUESTIONS.open, answer: 'Acme Roofing is open Monday to Friday, 7:00 am to 6:00 pm.' },
    { question: FAQ_QUESTIONS.website, answer: 'The website is https://acme.example/' },
  ]);
  assert.equal(faqPairs({ ...FULL, about: 'We fix roofs and gutters' })[0].answer, 'We fix roofs and gutters.', 'own words as typed');
});

test('faqPairs: each pair appears only with its fact', () => {
  const questions = f => faqPairs(f).map(p => p.question);
  assert.equal(questions({ ...FULL, phone: '' }).includes(FAQ_QUESTIONS.reach), false);
  assert.equal(questions({ ...FULL, hours: [] }).includes(FAQ_QUESTIONS.open), false);
  assert.equal(questions({ ...FULL, hours: undefined }).includes(FAQ_QUESTIONS.open), false);
  assert.equal(questions({ ...FULL, website: '' }).includes(FAQ_QUESTIONS.website), false);
  assert.equal(questions({ ...FULL, city: '', state: '' }).includes(FAQ_QUESTIONS.where), false);
  assert.equal(questions({ ...FULL, service: '' }).includes(FAQ_QUESTIONS.what), false);
  // No address found: the place only. No storefront: never the address, even if one was found.
  assert.equal(faqPairs({ ...FULL, address: '' })[1].answer, 'Acme Roofing serves Nashville, TN.');
  assert.equal(faqPairs({ ...FULL, noStorefront: true })[1].answer, 'Acme Roofing serves Nashville, TN and nearby areas.');
  for (const p of faqPairs({ ...FULL, phone: '', hours: [], website: '' })) {
    assert.equal(/ADD YOUR|\bXXX\b/u.test(p.answer), false, 'never a placeholder');
  }
  assert.deepEqual(faqPairs({ ...FULL, name: '' }), []);
});

test('faqText: questions and answers in plain text; fewer than 2 pairs says what to add first', () => {
  const text = faqText(faqPairs({ ...FULL, hours: [], website: '' }));
  assert.equal(text, [
    'What do you do?', 'Acme Roofing offers roofers.', '',
    'Where do you work?', 'Acme Roofing serves Nashville, TN. The address is 12 Main Street, Nashville, TN 37203.', '',
    'How can I reach you?', 'Call Acme Roofing at (615) 555-0100.',
  ].join('\n'));
  const one = faqPairs({ name: 'Acme Roofing', phone: '(615) 555-0100' });
  assert.equal(one.length, 1);
  assert.equal(faqText(one), FAQ_ADD_FIRST);
  assert.equal(faqText([]), FAQ_ADD_FIRST);
  assert.equal(FAQ_ADD_FIRST, 'Add what you do and your phone number to your website, then run a new check.');
});

test('banned words: none appear unless the owner typed them in their own words', () => {
  const plain = [gbpDescription(FULL), faqText(faqPairs(FULL)), fixPackText(FULL, { markup: 'script' }), fixPackText({ ...FULL, noStorefront: true })].join('\n').toLowerCase();
  for (const w of BANNED) assert.equal(plain.includes(w), false, w);
  const typed = { ...FULL, about: 'Licensed and insured roofers, 24/7 emergency calls, best in town' };
  const out = fixPackText(typed).toLowerCase();
  for (const w of ['licensed', 'insured', '24/7', 'emergency', 'best']) assert.ok(out.includes(w), `${w} is kept because it was typed`);
  for (const w of ['award', 'free estimate', 'guarantee', 'family owned', '#1']) assert.equal(out.includes(w), false, w);
});

test('property: no invented fact (every word with a capital or a digit comes from the facts or the fixed text)', () => {
  const strip = t => t.replace(/^[.,;:?!'"()]+|[.,;:?!'"()]+$/gu, '').replace(/'s$/u, '');
  const tokens = s => String(s ?? '').split(/\s+/u).map(strip).filter(Boolean);
  const fixed = [
    ...Object.values(FAQ_QUESTIONS), ...Object.values(PACK_HEADINGS), FAQ_ADD_FIRST, FAQ_MARKUP_LINE, FAQ_JSON_TEXT_NOTE,
    'Serving and nearby areas', 'Call at', 'The address is', 'The website is', 'offers serves is open',
    // The markup's own schema.org words.
    'FAQPage Question Answer acceptedAnswer mainEntity',
  ];
  const facts = fc.record({
    name: words(1, 5),
    service: words(1, 4),
    city: words(1, 2),
    state: fc.constantFrom('TN', 'tx', ''),
    about: fc.option(words(1, 12), { nil: undefined }),
    phone: fc.option(fc.constantFrom('(615) 555-0100', '615-555-0111'), { nil: undefined }),
    website: fc.option(fc.constant('https://example.com/'), { nil: undefined }),
    address: fc.option(fc.constant('12 Main Street, Nashville, TN 37203'), { nil: undefined }),
    hours: fc.option(fc.constant(['Monday to Friday, 7:00 am to 6:00 pm']), { nil: undefined }),
    noStorefront: fc.boolean(),
  });
  fc.assert(fc.property(facts, f => {
    const source = new Set([
      ...[f.name, f.service, f.city, f.state, String(f.state).toUpperCase(), f.about, f.phone, f.website, f.address, ...(f.hours ?? [])]
        .flatMap(tokens),
      ...fixed.flatMap(tokens),
    ]);
    const out = [gbpDescription(f), faqText(faqPairs(f)), fixPackText(f)].join('\n');
    for (const t of tokens(out)) {
      if (!/[A-Z0-9]/u.test(t)) continue;
      if (t.startsWith('"') || t.startsWith('{') || t.startsWith('@')) continue; // the JSON's own keys and marks
      if (/^"?@?(context|type)"?:?$/iu.test(t)) continue;
      assert.ok(source.has(t), `${t} is not from the facts`);
    }
    if (f.noStorefront) assert.equal(out.includes('12 Main Street'), false, 'no street address with no storefront');
  }), { numRuns: 300 });
});

// ---- task 4: the markup and the whole pack ------------------------------------------------------------------------

test('faqJsonLd: parses as FAQPage JSON, has no <, and equals the FAQ text one for one', () => {
  const pairs = faqPairs({ ...FULL, name: 'A </script><b>"x"</b>' });
  const data = jsonOf(faqJsonLd(pairs));
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'FAQPage');
  assert.equal(data.mainEntity.length, pairs.length);
  data.mainEntity.forEach((q, i) => {
    assert.equal(q['@type'], 'Question');
    assert.equal(q.name, pairs[i].question);
    assert.deepEqual(q.acceptedAnswer, { '@type': 'Answer', text: pairs[i].answer });
  });
  // The FAQ text holds the same pairs.
  const text = faqText(pairs).split('\n\n').map(block => block.split('\n'));
  assert.deepEqual(text, data.mainEntity.map(q => [q.name, q.acceptedAnswer.text]));
  for (const key of ['aggregateRating', 'review', 'ratingValue']) assert.equal(faqJsonLd(pairs).includes(key), false, key);
  assert.equal(faqJsonData(pairs).includes('<'), false);
});

test('faqJsonLd: nothing with fewer than 2 pairs', () => {
  assert.equal(faqJsonLd([]), '');
  assert.equal(faqJsonLd(faqPairs({ name: 'Acme Roofing', phone: '(615) 555-0100' })), '');
  assert.equal(faqJsonData([{ question: 'Q?', answer: 'A.' }]), '');
});

test('fixPackText: three parts under plain headings; the markup part only with 2 or more pairs and a website', () => {
  const text = fixPackText(FULL);
  const parts = text.trimEnd().split('\n\n');
  assert.ok(text.startsWith(`${PACK_HEADINGS.gbp}\n${gbpDescription(FULL)}\n\n${PACK_HEADINGS.faq}\n`));
  assert.ok(text.includes(`${PACK_HEADINGS.markup}\n${FAQ_JSON_TEXT_NOTE}\n${faqJsonData(faqPairs(FULL))}`));
  assert.ok(parts.length >= 3);
  assert.equal(/<\/?[a-z][^>]*>/iu.test(text), false, 'the text version holds no HTML tags');
  assert.ok(text.endsWith('\n'));

  const script = fixPackText(FULL, { markup: 'script' });
  assert.ok(script.includes(`${PACK_HEADINGS.markup}\n${FAQ_MARKUP_LINE}\n${faqJsonLd(faqPairs(FULL))}`));

  const noSite = fixPackText({ ...FULL, website: '' });
  assert.equal(noSite.includes(PACK_HEADINGS.markup), false, 'no markup without a website');

  const few = fixPackText({ name: 'Acme Roofing', phone: '(615) 555-0100' });
  assert.ok(few.includes(`${PACK_HEADINGS.faq}\n${FAQ_ADD_FIRST}`), 'the "add this first" sentence');
  assert.equal(few.includes(PACK_HEADINGS.markup), false);
  assert.ok(few.startsWith(`${PACK_HEADINGS.gbp}\nAcme Roofing.`));
});

test('fixPackText: control characters and line breaks are stripped from inserted values', () => {
  const text = fixPackText({ ...FULL, name: 'Acme\r\nBcc: x\u0000 Roofing', about: 'We fix\nroofs\u202E' });
  assert.equal(/[\u0000-\u0009\u000B-\u001F\u202E]/u.test(text), false);
  assert.ok(text.includes('Acme Bcc: x Roofing'));
  assert.ok(text.includes('We fix roofs.'));
  for (const line of text.split('\n')) assert.equal(line.startsWith('Bcc:'), false);
});

test('wording: the fixed text has no promise words, no dollar signs and American spelling', () => {
  const fixed = [
    FAQ_ADD_FIRST, FAQ_MARKUP_LINE, GBP_ABOUT_LEFT_OUT, FAQ_JSON_TEXT_NOTE, ...Object.values(FAQ_QUESTIONS),
    ...Object.values(PACK_HEADINGS), ...Object.values(PACK_HELP),
  ].join('\n');
  assert.equal(PROMISE.test(fixed), false);
  assert.equal(BRITISH.test(fixed), false);
  assert.equal(FAQ_MARKUP_LINE, 'Only paste this on a page that also shows these questions and answers to visitors.');
});

// ---- task 6: the report section ---------------------------------------------------------------------------------

function storedGrade(input = {}, found = {}) {
  return {
    id: 'packAAAAAAAAAAAAAAAAAA', status: 'done',
    input: { name: 'Acme Roofing', city: 'Nashville', state: 'TN', service: 'roofers', website: 'https://acme.example/', ...input },
    createdAt: new Date(START).toISOString(), finishedAt: new Date(START).toISOString(), steps: [], facts: null,
    found: { phone: '(615) 555-0100', hours: [], address: '12 Main Street', website: 'https://acme.example/', reviewsLink: '', ...found },
    results: [], ai: [], aiMain: { provider: 'anthropic', label: 'Claude', state: 'ok' }, score: null,
  };
}

const preOf = (html, id) => new RegExp(`<pre id="${id}">([\\s\\S]*?)</pre>`, 'u').exec(html)?.[1];

test('page: the full report has the four pack boxes, after the fix kit, with hidden Copy buttons', () => {
  const html = reportPage(storedGrade(), { leadGate: false });
  assert.ok(html.includes('Your fix pack'));
  assert.ok(html.indexOf('Your fix kit') < html.indexOf('Your fix pack'));
  for (const id of ['pack-gbp', 'pack-faq', 'pack-faq-json', 'pack-all']) {
    assert.ok(preOf(html, id) !== undefined, id);
    assert.ok(html.includes(`<button type="button" class="copy-btn button" data-copy="${id}" hidden>Copy</button>`), id);
  }
  assert.equal(preOf(html, 'pack-gbp'), 'Acme Roofing offers roofers. Serving Nashville, TN.');
  assert.ok(html.includes(PACK_HELP.gbp));
  assert.ok(html.includes(PACK_HELP.faq));
  assert.ok(html.includes(FAQ_MARKUP_LINE));
  assert.ok(preOf(html, 'pack-faq-json').startsWith('&lt;script type=&quot;application/ld+json&quot;&gt;'));
  assert.ok(html.includes('href="/grade/packAAAAAAAAAAAAAAAAAA/fix-pack.txt"'));
  // Without JavaScript every box's text is on the page; only the Copy buttons stay hidden.
  assert.ok(preOf(html, 'pack-faq').includes('What do you do?'));
  assert.ok(preOf(html, 'pack-all').includes(PACK_HEADINGS.gbp));
});

test('page: a locked report has no fix pack', () => {
  const html = reportPage(storedGrade());
  assert.equal(html.includes('Your fix pack'), false);
  assert.equal(html.includes('pack-gbp'), false);
  assert.equal(html.includes('fix-pack.txt'), false);
});

test('page: no website means no markup box; no storefront means no street address in the pack', () => {
  const noSite = reportPage(storedGrade({ website: '' }, { website: '' }), { leadGate: false });
  assert.ok(preOf(noSite, 'pack-faq') !== undefined);
  assert.equal(preOf(noSite, 'pack-faq-json'), undefined);
  const ns = reportPage(storedGrade({ noStorefront: true }), { leadGate: false });
  for (const id of ['pack-gbp', 'pack-faq', 'pack-faq-json', 'pack-all']) {
    assert.equal(preOf(ns, id).includes('12 Main Street'), false, id);
  }
  assert.ok(preOf(ns, 'pack-gbp').endsWith('Serving Nashville, TN and nearby areas.'));
});

test('page: the name and the owner\'s words are escaped', () => {
  const html = reportPage(storedGrade({ name: 'Acme <script>alert(1)</script>', about: 'We fix <b>roofs</b>' }), { leadGate: false });
  const pack = html.slice(html.indexOf('Your fix pack'));
  assert.equal(pack.includes('<script>alert(1)</script>'), false);
  assert.equal(pack.includes('<b>roofs</b>'), false);
  // Typed words that end in a mark other than a letter or digit get no "." added.
  assert.equal(preOf(html, 'pack-gbp'), 'We fix &lt;b&gt;roofs&lt;/b&gt; Serving Nashville, TN.');
});

test('page: own words that cannot go in the Google description say why under the box', () => {
  const html = reportPage(storedGrade({ about: 'See www.acme.example' }), { leadGate: false });
  assert.ok(html.includes(GBP_ABOUT_LEFT_OUT));
  assert.equal(reportPage(storedGrade({ about: 'We fix roofs' }), { leadGate: false }).includes(GBP_ABOUT_LEFT_OUT), false);
});

test('fixPackTextFor reads the stored Grade (the found phone, the typed name)', () => {
  const text = fixPackTextFor(storedGrade());
  assert.ok(text.includes('Call Acme Roofing at (615) 555-0100.'));
  assert.ok(text.includes('The website is https://acme.example/'));
});

// ---- task 7: the download -------------------------------------------------------------------------------------

const cleanups = [];
after(async () => {
  for (const fn of cleanups.reverse()) await fn();
});

async function startEnv() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-fix-pack-'));
  for (const name of ['listings.json', 'categories.json']) await fs.copyFile(path.join(REPO_DATA, name), path.join(dir, name));
  const app = createApp({
    dataDir: dir,
    config: { baseUrl: 'http://example.test', graderSecret: 'test-secret', graderLeadGate: true, demoMode: false },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  cleanups.push(async () => {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const ctx = app.locals.ctx;
  await ctx.store.collection('grades').append(storedGrade());
  return { ctx, base: `http://127.0.0.1:${server.address().port}` };
}

test('route: 303 to the report without access; text/plain with Content-Disposition with access; 404 for a bad id', async () => {
  const env = await startEnv();
  const url = `${env.base}/grade/packAAAAAAAAAAAAAAAAAA/fix-pack.txt`;

  const locked = await fetch(url, { redirect: 'manual' });
  assert.equal(locked.status, 303);
  assert.equal(locked.headers.get('location'), '/grade/packAAAAAAAAAAAAAAAAAA');

  env.ctx.config.graderLeadGate = false;
  const res = await fetch(url, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="fix-pack-packAAAAAAAAAAAAAAAAAA.txt"');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
  const body = await res.text();
  assert.equal(/<\/?[a-z][^>]*>/iu.test(body), false, 'no HTML tags');
  assert.ok(body.startsWith(PACK_HEADINGS.gbp));
  assert.ok(body.includes(PACK_HEADINGS.faq));
  assert.ok(body.includes(PACK_HEADINGS.markup));

  assert.equal((await fetch(`${env.base}/grade/bad/fix-pack.txt`, { redirect: 'manual' })).status, 404);
  assert.equal((await fetch(`${env.base}/grade/nopeAAAAAAAAAAAAAAAAAA/fix-pack.txt`, { redirect: 'manual' })).status, 404);
});
