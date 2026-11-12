import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  suggestedTitle, suggestedSummary, jsonLdBlock, llmsDraft, robotsLines,
} from '../server/lib/fix-kit.js';

const len = s => Array.from(s).length;
const nasty = fc.constantFrom('<', '</script>', '"', "'", '\u{1F600}', '&', '\\', '\n', '|');
const piece = fc.oneof(fc.stringMatching(/^[A-Za-z0-9]{1,14}$/), nasty);
const text = (max = 8) => fc.array(piece, { minLength: 1, maxLength: max }).map(p => p.join(' '));

const found = fc.record({
  name: text(10),
  service: text(6),
  city: text(3),
  state: fc.constantFrom('TN', 'tx', 'CA', ''),
  phone: fc.option(fc.constantFrom('(615) 555-0100', '615-555-0111'), { nil: undefined }),
  website: fc.option(fc.constant('https://example.com/'), { nil: undefined }),
  address: fc.option(text(3), { nil: undefined }),
  hours: fc.option(fc.array(text(3), { maxLength: 3 }), { nil: undefined }),
});

// Feature: ai-visibility-grader, Property 9: Fix kit stays within its limits
test('Property 9: title is at most 60 characters and never ends mid-word', () => {
  fc.assert(fc.property(found, f => {
    const title = suggestedTitle(f);
    assert.ok(len(title) <= 60, title);
    const source = new Set(
      [f.name, f.service, f.city, f.state, '| in']
        .flatMap(v => String(v).replace(/\s+/g, ' ').trim().split(' '))
        .flatMap(w => [w, w ? w[0].toUpperCase() + w.slice(1) : w, w.toUpperCase()]),
    );
    const longWord = f.name.split(/\s+/).some(w => len(w) > 60);
    if (!longWord) {
      for (const token of title.split(' ').filter(Boolean)) {
        // the city is followed by a comma when a state is present
        const ok = source.has(token) || (token.endsWith(',') && source.has(token.slice(0, -1)));
        assert.ok(ok, `${token} in ${title}`);
      }
    }
  }), { numRuns: 300 });
});

test('Property 9: summary is at most 160 characters', () => {
  fc.assert(fc.property(found, f => {
    assert.ok(len(suggestedSummary(f)) <= 160);
  }), { numRuns: 300 });
});

test('Property 9: JSON-LD block parses after its script tags are removed and has no raw <', () => {
  fc.assert(fc.property(found, f => {
    const block = jsonLdBlock(f);
    assert.ok(block.startsWith('<script type="application/ld+json">\n'));
    assert.ok(block.endsWith('\n</script>'));
    const body = block.slice('<script type="application/ld+json">\n'.length, -'\n</script>'.length);
    assert.equal(body.includes('<'), false);
    const parsed = JSON.parse(body);
    assert.equal(parsed['@type'], 'LocalBusiness');
    assert.equal(parsed.name, f.name.replace(/\s+/g, ' ').trim());
  }), { numRuns: 300 });
});

test('examples: title shortening order, llms draft and robots lines', () => {
  assert.equal(
    suggestedTitle({ name: 'Acme Roofing', service: 'roofers', city: 'Nashville', state: 'tn' }),
    'Acme Roofing | Roofers in Nashville, TN',
  );
  assert.equal(
    suggestedTitle({ name: 'Acme Roofing And Exteriors Of Middle Tennessee', service: 'roofers', city: 'Nashville', state: 'TN' }),
    'Acme Roofing And Exteriors Of Middle Tennessee | Nashville',
  );
  const summary = suggestedSummary({ name: 'Acme Roofing', service: 'Roofers', city: 'Nashville', state: 'TN', phone: '(615) 555-0100' });
  assert.equal(summary, 'Acme Roofing: roofers in Nashville, TN. Call (615) 555-0100 today. Serving Nashville and nearby areas.');
  const draft = llmsDraft({ name: 'Acme Roofing', service: 'Roofers', city: 'Nashville', state: 'TN', phone: '(615) 555-0100', hours: ['Mo-Fr 08:00-17:00'] });
  assert.match(draft, /^# Acme Roofing\n/);
  assert.match(draft, /- Hours: Mo-Fr 08:00-17:00/);
  assert.equal(robotsLines(['GPTBot', 'bad agent!']), 'User-agent: GPTBot\nAllow: /');
  assert.equal(robotsLines([]), '');
});

test('examples: a plural or ordinary service is lower-cased in a sentence, all-caps words stay as typed', () => {
  const base = { name: 'Summit Heating', city: 'Franklin', state: 'TN' };
  assert.match(suggestedSummary({ ...base, service: 'HVAC' }), /^Summit Heating: HVAC in Franklin, TN\./);
  assert.match(suggestedSummary({ ...base, service: 'Heating and AC' }), /^Summit Heating: heating and AC in Franklin, TN\./);
  assert.match(suggestedSummary({ ...base, service: 'Roofers' }), /^Summit Heating: roofers in Franklin, TN\./);
  assert.match(suggestedSummary({ ...base, service: 'HVAC Repair' }), /^Summit Heating: HVAC repair in Franklin, TN\./);
  // A single capital letter is not an all-caps word.
  assert.match(suggestedSummary({ ...base, service: 'A Plumbers' }), /: a plumbers in /);
  // The llms.txt line follows the same rule.
  assert.match(llmsDraft({ ...base, service: 'HVAC' }), /\n> Summit Heating: HVAC in Franklin, TN\.\n/);
  assert.match(llmsDraft({ ...base, service: 'Roofers' }), /\n> Summit Heating: roofers in Franklin, TN\.\n/);
  // The Service line keeps the service exactly as typed.
  assert.match(llmsDraft({ ...base, service: 'HVAC' }), /\n- Service: HVAC\n/);
});

test('property: lower-casing never changes the summary length rule', () => {
  fc.assert(fc.property(fc.constantFrom('HVAC', 'Roofers', 'AC repair', 'Hair Salon', 'TV and DVD fixing'), service => {
    const out = suggestedSummary({ name: 'Acme', service, city: 'Nashville', state: 'TN' });
    assert.ok(len(out) <= 160);
    for (const word of service.split(' ')) {
      const allCaps = word.length >= 2 && word === word.toUpperCase();
      assert.ok(out.includes(allCaps ? word : word.toLowerCase()), `${word} in ${out}`);
    }
  }), { numRuns: 25 });
});
