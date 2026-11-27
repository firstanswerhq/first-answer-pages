/**
 * The GRADE_MAIN_ASKS setting (Feature E, task E1; Requirement 23.9). Nothing uses it yet; that is E2.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseGradeMainAsks, DEFAULT_GRADE_MAIN_ASKS, configFromEnv } from '../server/lib/config.js';

test('E1: GRADE_MAIN_ASKS unset gives 3, with no warning', () => {
  const warnings = [];
  const warn = msg => warnings.push(String(msg));
  assert.equal(DEFAULT_GRADE_MAIN_ASKS, 3);
  assert.equal(parseGradeMainAsks(undefined, warn), 3);
  assert.equal(parseGradeMainAsks('', warn), 3);
  assert.equal(parseGradeMainAsks('   ', warn), 3);
  assert.deepEqual(warnings, []);
});

test('E1: GRADE_MAIN_ASKS 1, 2 and 3 are read as given, with no warning', () => {
  const warnings = [];
  const warn = msg => warnings.push(String(msg));
  assert.equal(parseGradeMainAsks('1', warn), 1);
  assert.equal(parseGradeMainAsks('2', warn), 2);
  assert.equal(parseGradeMainAsks('3', warn), 3);
  assert.equal(parseGradeMainAsks(' 2 ', warn), 2, 'spaces around it are fine');
  assert.deepEqual(warnings, []);
});

test('E1: GRADE_MAIN_ASKS 0, 4, "x" and other bad values warn without echoing the value and give 3', () => {
  for (const bad of ['0', '4', 'x', '-1', '2.5', '1e0', '03', 'three', '99', 'secret-value-7']) {
    const warnings = [];
    assert.equal(parseGradeMainAsks(bad, msg => warnings.push(String(msg))), 3, bad);
    assert.equal(warnings.length, 1, bad);
    assert.match(warnings[0], /GRADE_MAIN_ASKS/);
    if (bad.length > 1) assert.equal(warnings[0].includes(bad), false, `${bad} is not echoed`);
  }
  // The single-character values are not echoed either: the message is fixed text.
  const once = [];
  parseGradeMainAsks('x', msg => once.push(String(msg)));
  parseGradeMainAsks('4', msg => once.push(String(msg)));
  parseGradeMainAsks('0', msg => once.push(String(msg)));
  assert.equal(new Set(once).size, 1, 'the same message whatever was typed');
});

test('E1: configFromEnv reads gradeMainAsks', () => {
  const quiet = { warn() {} };
  assert.equal(configFromEnv({}, quiet).gradeMainAsks, 3);
  assert.equal(configFromEnv({ GRADE_MAIN_ASKS: '1' }, quiet).gradeMainAsks, 1);
  assert.equal(configFromEnv({ GRADE_MAIN_ASKS: '2' }, quiet).gradeMainAsks, 2);
  assert.equal(configFromEnv({ GRADE_MAIN_ASKS: '3' }, quiet).gradeMainAsks, 3);
  for (const bad of ['0', '4', 'x']) assert.equal(configFromEnv({ GRADE_MAIN_ASKS: bad }, quiet).gradeMainAsks, 3, bad);
  const warnings = [];
  configFromEnv({ GRADE_MAIN_ASKS: 'secret-value-7' }, { warn: msg => warnings.push(String(msg)) });
  assert.ok(warnings.some(w => w.includes('GRADE_MAIN_ASKS')));
  assert.equal(warnings.some(w => w.includes('secret-value-7')), false);
});

test('E1: the README lists GRADE_MAIN_ASKS with its default', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /\| `GRADE_MAIN_ASKS` \| `3` \|/);
});
