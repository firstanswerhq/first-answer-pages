/**
 * addon-monthly-watch task 1: the three settings. WATCH_ENABLED (on/off, default off, a bad value warns and is off),
 * WATCH_MAX_PER_DAY (0 to 200, default 10) and WATCH_MAX_ACTIVE (0 to 10000, default 200). A bad value warns without
 * echoing it and falls back to the default. Off by default in test runs too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  configFromEnv, parseWatchEnabled, parseWatchMaxPerDay, parseWatchMaxActive,
  DEFAULT_WATCH_MAX_PER_DAY, DEFAULT_WATCH_MAX_ACTIVE,
} from '../server/lib/config.js';

const collect = () => {
  const warned = [];
  return { warned, warn: m => warned.push(m) };
};

test('WATCH_ENABLED: off unless "on"; a bad value warns once, without the value, and means off', () => {
  const { warned, warn } = collect();
  assert.equal(parseWatchEnabled(undefined, warn), false);
  assert.equal(parseWatchEnabled('', warn), false);
  assert.equal(parseWatchEnabled('  ', warn), false);
  assert.equal(parseWatchEnabled('off', warn), false);
  assert.equal(parseWatchEnabled('OFF', warn), false);
  assert.equal(warned.length, 0, 'no warning for unset or off');
  assert.equal(parseWatchEnabled('on', warn), true);
  assert.equal(parseWatchEnabled(' On ', warn), true);
  assert.equal(warned.length, 0);
  for (const bad of ['yes', 'true', '1', 'enabled-secret-word']) {
    assert.equal(parseWatchEnabled(bad, warn), false, bad);
  }
  assert.equal(warned.length, 4, 'one warning per bad value');
  for (const w of warned) {
    assert.equal(w, 'WATCH_ENABLED must be on or off; using off.');
    assert.equal(w.includes('enabled-secret-word'), false, 'the value is never echoed');
  }
});

test('WATCH_MAX_PER_DAY: a whole number from 0 to 200, default 10', () => {
  const { warned, warn } = collect();
  assert.equal(DEFAULT_WATCH_MAX_PER_DAY, 10);
  assert.equal(parseWatchMaxPerDay(undefined, warn), 10);
  assert.equal(parseWatchMaxPerDay('', warn), 10);
  assert.equal(parseWatchMaxPerDay('0', warn), 0);
  assert.equal(parseWatchMaxPerDay('25', warn), 25);
  assert.equal(parseWatchMaxPerDay('200', warn), 200);
  assert.equal(warned.length, 0);
  for (const bad of ['201', '-1', '2.5', '010', 'ten', '1e2', '999999']) {
    assert.equal(parseWatchMaxPerDay(bad, warn), 10, bad);
  }
  assert.equal(warned.length, 7);
  for (const w of warned) {
    assert.equal(w, 'WATCH_MAX_PER_DAY must be a whole number from 0 to 200; using 10.');
    assert.equal(/ten|999999|2\.5/.test(w), false);
  }
});

test('WATCH_MAX_ACTIVE: a whole number from 0 to 10000, default 200', () => {
  const { warned, warn } = collect();
  assert.equal(DEFAULT_WATCH_MAX_ACTIVE, 200);
  assert.equal(parseWatchMaxActive(undefined, warn), 200);
  assert.equal(parseWatchMaxActive('0', warn), 0);
  assert.equal(parseWatchMaxActive('50', warn), 50);
  assert.equal(parseWatchMaxActive('10000', warn), 10000);
  assert.equal(warned.length, 0);
  for (const bad of ['10001', '-5', 'lots', '3.0', '0200']) {
    assert.equal(parseWatchMaxActive(bad, warn), 200, bad);
  }
  assert.equal(warned.length, 5);
  for (const w of warned) assert.equal(w, 'WATCH_MAX_ACTIVE must be a whole number from 0 to 10000; using 200.');
});

test('configFromEnv: the watch is off by default, in a test run and outside one; the settings are read', () => {
  for (const env of [{}, { NODE_TEST_CONTEXT: 'child' }]) {
    const c = configFromEnv(env, { warn: () => {} });
    assert.equal(c.watchEnabled, false, JSON.stringify(env));
    assert.equal(c.watchMaxPerDay, 10);
    assert.equal(c.watchMaxActive, 200);
  }
  const on = configFromEnv({ WATCH_ENABLED: 'on', WATCH_MAX_PER_DAY: '3', WATCH_MAX_ACTIVE: '40' }, { warn: () => {} });
  assert.deepEqual([on.watchEnabled, on.watchMaxPerDay, on.watchMaxActive], [true, 3, 40]);
  // A bad value warns through the config's own warn, and falls back.
  const { warned, warn } = collect();
  const bad = configFromEnv({ WATCH_ENABLED: 'maybe', WATCH_MAX_PER_DAY: 'x', WATCH_MAX_ACTIVE: 'y' }, { warn });
  assert.deepEqual([bad.watchEnabled, bad.watchMaxPerDay, bad.watchMaxActive], [false, 10, 200]);
  assert.ok(warned.includes('WATCH_ENABLED must be on or off; using off.'));
  assert.ok(warned.includes('WATCH_MAX_PER_DAY must be a whole number from 0 to 200; using 10.'));
  assert.ok(warned.includes('WATCH_MAX_ACTIVE must be a whole number from 0 to 10000; using 200.'));
});
