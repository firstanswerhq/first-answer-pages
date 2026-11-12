import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { parseRobots, mayFetchRoot, AI_AGENTS } from '../server/lib/robots.js';

const agentName = fc.constantFrom('*', ...AI_AGENTS, 'Googlebot', 'bingbot');
const path = fc.constantFrom('', '/', '/*', '/private', '/admin/', '/$', '*');
const rule = fc.record({ allow: fc.boolean(), path });
const groupArb = fc.record({
  agents: fc.uniqueArray(agentName, { minLength: 1, maxLength: 3 }),
  rules: fc.array(rule, { minLength: 1, maxLength: 4 }),
});
const robotsArb = fc.array(groupArb, { maxLength: 5 });

const plain = groups => groups.map(g => [
  ...g.agents.map(a => `User-agent: ${a}`),
  ...g.rules.map(r => `${r.allow ? 'Allow' : 'Disallow'}: ${r.path}`),
].join('\n')).join('\n\n');

const noisy = (groups, flips) => {
  let n = 0;
  const flip = () => flips[n++ % flips.length];
  const caseOf = word => (flip() ? word.toUpperCase() : word.toLowerCase());
  const lines = ['﻿# robots for the site', 'Sitemap: https://example.com/sitemap.xml'];
  for (const g of groups) {
    for (const a of g.agents) lines.push(`${caseOf('User-Agent')}${flip() ? ' ' : ''}:  ${flip() ? a.toUpperCase() : a}   # who`);
    for (const r of g.rules) {
      lines.push(`  ${caseOf(r.allow ? 'Allow' : 'Disallow')} :${flip() ? ' ' : ''}${r.path}${flip() ? ' # why' : ''}`);
      if (flip()) lines.push('Crawl-delay: 10');
    }
    lines.push('', '# next');
  }
  return lines.join(flip() ? '\r\n' : '\n');
};

const answers = text => AI_AGENTS.map(agent => mayFetchRoot(parseRobots(text), agent));

// Feature: ai-visibility-grader, Property 5: Robots answers are stable under formatting
test('Property 5: case, spacing, comments, unknown fields and line endings do not change the answer', () => {
  fc.assert(fc.property(robotsArb, fc.array(fc.boolean(), { minLength: 1, maxLength: 20 }), (groups, flips) => {
    assert.deepEqual(answers(noisy(groups, flips)), answers(plain(groups)));
  }), { numRuns: 300 });
});

test('Property 5: parsing never throws on arbitrary text', () => {
  fc.assert(fc.property(fc.string({ maxLength: 500 }), text => {
    for (const agent of AI_AGENTS) assert.equal(typeof mayFetchRoot(parseRobots(text), agent), 'boolean');
  }), { numRuns: 300 });
  assert.deepEqual(parseRobots(undefined), []);
});

test('robots examples', () => {
  const may = (text, agent = 'GPTBot') => mayFetchRoot(parseRobots(text), agent);
  assert.equal(may(''), true);
  assert.equal(may('User-agent: *\nDisallow: /'), false);
  assert.equal(may('User-agent: *\nDisallow:'), true);
  assert.equal(may('User-agent: *\nDisallow: /private'), true);
  assert.equal(may('User-agent: *\nAllow: /\nDisallow: /'), true); // Allow wins a tie
  assert.equal(may('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /'), true); // specific group first
  assert.equal(may('User-agent: *\nAllow: /\n\nUser-agent: gptbot\nDisallow: /'), false);
  assert.equal(may('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /', 'ClaudeBot'), false);
  assert.equal(may('User-agent: GPTBot\nDisallow: /', 'ClaudeBot'), true);
  assert.equal(may('Disallow: /\nUser-agent: *\nAllow: /'), true); // rule before any agent is ignored
  assert.equal(AI_AGENTS.length, 8);
});
