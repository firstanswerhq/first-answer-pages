/**
 * addon-monthly-watch task 6: the watch service. Fake clock, fake reader (`readFree`), real `createAiBudget`, the mock
 * notifier and a real data store in a temp folder. No network, no timer.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDataStore } from '../server/data.js';
import { createAiBudget } from '../server/lib/ai-budget.js';
import { createMockNotifier } from '../server/lib/notifier.js';
import {
  createWatchService, WATCH_BUDGET_FLOOR, WATCH_MAX_RETRIES, WATCH_RUNS_NOTE, defaultEmails, watchUrls, plainLine,
} from '../server/lib/watch-service.js';

const START = Date.UTC(2026, 10, 18, 18, 0, 0); // noon in Chicago
const DAY = 86400000;
const BASE = 'https://pages.example.test';
const EMAIL = 'owner@zephyr.example';
const INPUT = { name: 'Zephyr Plumbing', city: 'Nashville', state: 'TN', service: 'plumbers', website: null };

const dirs = [];
after(async () => {
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

const answer = (extra = {}) => ({
  prompt: 'Who are the best plumbers in Nashville, TN? Name your top 5.', provider: 'anthropic',
  named: true, position: 2, total: 5, competitors: ['Other Co', 'Another Co'], at: new Date(START).toISOString(), ...extra,
});

function grade(id, extra = {}) {
  return { id, status: 'done', input: { ...INPUT, website: '' }, createdAt: new Date(START).toISOString(), ai: [answer()], draftId: 'd1', ...extra };
}

/**
 * @param {{ reads?: object[], config?: object, gradeLimit?: number, grades?: object[] }} opts
 * `reads` is the queue of `readFree` results; when it is empty the reader answers "named".
 */
async function makeEnv({ reads = [], config = {}, gradeLimit = 100, grades = [grade('g1')] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fap-watch-service-'));
  dirs.push(dir);
  await fs.writeFile(path.join(dir, 'listings.json'), '[]');
  await fs.writeFile(path.join(dir, 'categories.json'), '[]');
  const store = createDataStore({ dataDir: dir });
  for (const g of grades) await store.collection('grades').append(g);
  const clock = { t: START, now() { return this.t; } };
  const aiBudget = createAiBudget({ clock, limit: 1000, gradeLimit });
  const notifier = createMockNotifier();
  const reader = {
    calls: 0,
    queue: [...reads],
    async readFree() {
      this.calls += 1;
      return this.queue.length > 0 ? this.queue.shift() : named();
    },
    async get(id) {
      const list = await store.collection('grades').read();
      return list.find(g => g.id === id);
    },
    async watchEligible(id) {
      const g = await this.get(id);
      return Boolean(g && g.status === 'done' && g.draftId);
    },
  };
  const logs = [];
  let n = 0;
  const service = createWatchService({
    store, grader: reader, aiBudget, notifier, clock,
    newId: () => `watch${String(++n).padStart(17, '0')}`,
    config: { baseUrl: BASE, gradeAiRepeatDays: 0, watchMaxPerDay: 10, watchMaxActive: 200, ...config },
    log: line => logs.push(line),
  });
  return { dir, store, clock, aiBudget, notifier, reader, logs, service };
}

const named = () => ({ named: true, position: 1, total: 5, competitors: ['Other Co'], state: 'ok' });
const notNamed = () => ({ named: false, position: null, total: 5, competitors: ['Other Co', 'Rival Pipes'], state: 'ok' });
const failedRead = () => ({ named: false, position: null, total: 0, competitors: [], state: 'failed' });

/** Starts a watch with an email and confirms it. */
async function activeWithEmail(env) {
  const started = await env.service.start({ gradeId: 'g1', email: EMAIL });
  assert.equal(started.ok, true);
  const done = await env.service.confirm(started.watch.id, started.watch.confirmToken);
  assert.equal(done.ok, true);
  return env.service.get(started.watch.id);
}

// ---- start, confirm, stop, get --------------------------------------------------------------------------------------

test('start without an email: active at once, first reading is the report\'s own answer, no AI and no email', async () => {
  const env = await makeEnv();
  const res = await env.service.start({ gradeId: 'g1' });
  assert.equal(res.ok, true);
  const w = res.watch;
  assert.equal(w.status, 'active');
  assert.equal(w.email, null);
  assert.equal(w.gradeId, 'g1');
  assert.equal(w.readings.length, 1);
  assert.deepEqual(
    { named: w.readings[0].named, position: w.readings[0].position, total: w.readings[0].total, source: w.readings[0].source },
    { named: true, position: 2, total: 5, source: 'report' },
  );
  assert.deepEqual(w.readings[0].competitors, ['Other Co', 'Another Co']);
  assert.equal(w.nextDueAt, new Date(START + 30 * DAY).toISOString());
  assert.equal(env.reader.calls, 0, 'no AI asked');
  assert.equal(env.notifier.owners.length, 0, 'no email');
  assert.match(w.confirmToken, /^[A-Za-z0-9_-]{32}$/u, '24 random bytes, base64url');
  assert.match(w.stopToken, /^[A-Za-z0-9_-]{32}$/u);
  assert.notEqual(w.confirmToken, w.stopToken);
  assert.deepEqual(await env.service.get(w.id), w);
});

test('start with an email: pending, and a confirm email goes out with the unsubscribe headers', async () => {
  const env = await makeEnv();
  const res = await env.service.start({ gradeId: 'g1', email: `  ${EMAIL} ` });
  assert.equal(res.ok, true);
  const w = res.watch;
  assert.equal(w.status, 'pending');
  assert.equal(w.email, EMAIL);
  assert.equal(env.notifier.owners.length, 1);
  const mail = env.notifier.owners[0];
  assert.equal(mail.to, EMAIL);
  const urls = watchUrls(BASE, w);
  assert.ok(mail.text.includes(urls.confirm), 'the confirm link');
  assert.ok(mail.text.includes(urls.stop), 'the stop link');
  assert.equal(urls.stop, `${BASE}/watch/${w.id}/stop?t=${w.stopToken}`);
  assert.deepEqual(mail.headers, {
    'List-Unsubscribe': `<${urls.stop}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  });
  assert.equal(/<[a-z]/iu.test(mail.text), false, 'plain text, no HTML');
});

test('confirm: a wrong token changes nothing; the right one makes the watch active', async () => {
  const env = await makeEnv();
  const { watch } = await env.service.start({ gradeId: 'g1', email: EMAIL });
  assert.deepEqual(await env.service.confirm(watch.id, 'wrong'), { ok: false, state: 'bad_token' });
  assert.deepEqual(await env.service.confirm(watch.id, watch.stopToken), { ok: false, state: 'bad_token' });
  assert.deepEqual(await env.service.confirm('nope', watch.confirmToken), { ok: false, state: 'not_found' });
  assert.equal((await env.service.get(watch.id)).status, 'pending');
  env.clock.t += 60000;
  const res = await env.service.confirm(watch.id, watch.confirmToken);
  assert.equal(res.ok, true);
  assert.equal(res.state, 'confirmed');
  const w = await env.service.get(watch.id);
  assert.equal(w.status, 'active');
  assert.equal(w.confirmedAt, new Date(START + 60000).toISOString());
  assert.equal((await env.service.confirm(watch.id, watch.confirmToken)).state, 'already');
});

test('start: not eligible, a bad email and the WATCH_MAX_ACTIVE cap start nothing', async () => {
  const env = await makeEnv({
    config: { watchMaxActive: 1 },
    grades: [grade('g1'), grade('g2', { draftId: undefined }), grade('g3', { status: 'running' })],
  });
  assert.deepEqual(await env.service.start({ gradeId: 'g2' }), { ok: false, reason: 'not_eligible' });
  assert.deepEqual(await env.service.start({ gradeId: 'g3' }), { ok: false, reason: 'not_eligible' });
  assert.deepEqual(await env.service.start({ gradeId: 'missing' }), { ok: false, reason: 'not_eligible' });
  assert.deepEqual(await env.service.start({ gradeId: 'g1', email: 'not an email' }), { ok: false, reason: 'email' });
  assert.equal((await env.service.start({ gradeId: 'g1' })).ok, true);
  assert.deepEqual(await env.service.start({ gradeId: 'g1' }), { ok: false, reason: 'full' });
  assert.equal((await env.store.collection('watches').read()).length, 1);

  const none = await makeEnv({ config: { watchMaxActive: 0 } });
  assert.deepEqual(await none.service.start({ gradeId: 'g1' }), { ok: false, reason: 'full' });
});

test('stop: a wrong token keeps the watch; the right one deletes it and its email address', async () => {
  const env = await makeEnv();
  const w = await activeWithEmail(env);
  assert.deepEqual(await env.service.stop(w.id, 'wrong'), { ok: false });
  assert.deepEqual(await env.service.stop(w.id, w.confirmToken), { ok: false });
  assert.ok(await env.service.get(w.id));
  assert.deepEqual(await env.service.stop(w.id, w.stopToken), { ok: true });
  assert.equal(await env.service.get(w.id), undefined);
  const raw = await fs.readFile(path.join(env.dir, 'watches.json'), 'utf8');
  assert.equal(raw.includes(EMAIL), false, 'the address is gone from the file');
  assert.deepEqual(await env.service.stop(w.id, w.stopToken), { ok: false });
});

// ---- runDue ---------------------------------------------------------------------------------------------------------

test('runDue: nothing is due before 30 days', async () => {
  const env = await makeEnv();
  await env.service.start({ gradeId: 'g1' });
  const out = await env.service.runDue(START + 29 * DAY);
  assert.equal(out.due, 0);
  assert.equal(env.reader.calls, 0);
});

test('runDue never runs at 25 or fewer Grader calls left', async () => {
  const env = await makeEnv({ gradeLimit: WATCH_BUDGET_FLOOR });
  await env.service.start({ gradeId: 'g1' });
  env.clock.t = START + 30 * DAY;
  assert.equal(env.aiBudget.peek({ kind: 'grade' }).remaining, 25);
  const out = await env.service.runDue();
  assert.equal(out.stopped, 'floor');
  assert.equal(env.reader.calls, 0);
  assert.equal(out.asked, 0);

  const ok = await makeEnv({ gradeLimit: WATCH_BUDGET_FLOOR + 1 });
  await ok.service.start({ gradeId: 'g1' });
  ok.clock.t = START + 30 * DAY;
  const ran = await ok.service.runDue();
  assert.equal(ran.stopped, null);
  assert.equal(ok.reader.calls, 1);
});

test('runDue stops at WATCH_MAX_PER_DAY readings, oldest due first, and goes on the next day', async () => {
  const env = await makeEnv({ config: { watchMaxPerDay: 2 } });
  const ids = [];
  for (let i = 0; i < 3; i += 1) {
    ids.push((await env.service.start({ gradeId: 'g1' })).watch.id);
    env.clock.t += 60000;
  }
  env.clock.t = START + 31 * DAY;
  const out = await env.service.runDue();
  assert.equal(out.due, 3);
  assert.equal(out.asked, 2);
  assert.equal(out.stopped, 'cap');
  assert.equal(env.reader.calls, 2);
  assert.equal(env.aiBudget.notes()[WATCH_RUNS_NOTE], 2);
  assert.equal((await env.service.get(ids[0])).readings.length, 2, 'oldest first');
  assert.equal((await env.service.get(ids[1])).readings.length, 2);
  assert.equal((await env.service.get(ids[2])).readings.length, 1, 'left for tomorrow');

  env.clock.t += DAY;
  const next = await env.service.runDue();
  assert.equal(next.asked, 1);
  assert.equal((await env.service.get(ids[2])).readings.length, 2);

  const zero = await makeEnv({ config: { watchMaxPerDay: 0 } });
  await zero.service.start({ gradeId: 'g1' });
  assert.equal((await zero.service.runDue(START + 30 * DAY)).stopped, 'cap');
  assert.equal(zero.reader.calls, 0);
});

test('runDue: a reading with no change is saved, the next one is due in 30 days, no email', async () => {
  const env = await makeEnv();
  const w = await activeWithEmail(env);
  const sentBefore = env.notifier.owners.length;
  const at = START + 30 * DAY;
  const out = await env.service.runDue(at);
  assert.equal(out.asked, 1);
  assert.equal(env.reader.calls, 1, 'one ask: the same as before, so no confirm ask');
  const after = await env.service.get(w.id);
  assert.equal(after.readings.length, 2);
  assert.equal(after.readings[1].source, 'ask');
  assert.equal(after.readings[1].named, true);
  assert.equal(after.readings[1].at, new Date(at).toISOString());
  assert.equal(after.nextDueAt, new Date(at + 30 * DAY).toISOString());
  assert.equal(after.lastChangeAt, null);
  assert.equal(env.notifier.owners.length, sentBefore);
  assert.equal((await env.service.runDue(at + DAY)).due, 0, 'not due again tomorrow');
});

test('runDue reuses a fresh full-check answer and asks nothing', async () => {
  const env = await makeEnv({ config: { gradeAiRepeatDays: 7 } });
  const w = (await env.service.start({ gradeId: 'g1' })).watch;
  // A full check of the same business on day 27, with a fresh answer that did not name it.
  const fresh = grade('g-fresh', {
    createdAt: new Date(START + 27 * DAY).toISOString(),
    ai: [answer({ named: false, position: null, total: 4, competitors: ['Fresh Rival'] })],
  });
  await env.store.collection('grades').append(fresh);
  // The reader agrees on the confirm ask (the reused answer differs from the report's).
  env.reader.queue.push(notNamed());
  await env.service.runDue(START + 30 * DAY);
  const after = await env.service.get(w.id);
  assert.equal(after.readings[1].source, 'reused');
  assert.equal(after.readings[1].named, false);
  assert.deepEqual(after.readings[1].competitors, ['Fresh Rival']);
  assert.equal(env.reader.calls, 1, 'only the confirm ask; the reading itself asked nothing');

  // The same, but the answer did not change: nothing at all is asked.
  const same = await makeEnv({ config: { gradeAiRepeatDays: 7 } });
  const w2 = (await same.service.start({ gradeId: 'g1' })).watch;
  await same.store.collection('grades').append(grade('g-fresh', { createdAt: new Date(START + 27 * DAY).toISOString() }));
  const out = await same.service.runDue(START + 30 * DAY);
  assert.equal(out.reused, 1);
  assert.equal(same.reader.calls, 0);
  assert.equal((await same.service.get(w2.id)).readings[1].source, 'reused');
  assert.equal(same.aiBudget.notes()[WATCH_RUNS_NOTE] ?? 0, 0, 'a reused reading is not counted');
});

test('runDue does not reuse old, other-business, reused or admin answers', async () => {
  const env = await makeEnv({ config: { gradeAiRepeatDays: 7 } });
  await env.service.start({ gradeId: 'g1' });
  const day = d => new Date(START + d * DAY).toISOString();
  await env.store.collection('grades').append(grade('old', { createdAt: day(20) }));
  await env.store.collection('grades').append(grade('other', { createdAt: day(28), input: { ...INPUT, website: '', name: 'Other Plumbing' } }));
  await env.store.collection('grades').append(grade('copied', { createdAt: day(28), ai: [answer({ reusedFrom: day(1) })] }));
  await env.store.collection('grades').append(grade('admin', { createdAt: day(28), byAdmin: true }));
  await env.store.collection('grades').append(grade('about', { createdAt: day(28), input: { ...INPUT, website: '', about: 'fix water heaters' } }));
  const out = await env.service.runDue(START + 30 * DAY);
  assert.equal(out.reused, 0);
  assert.equal(out.asked, 1);
  assert.equal(env.reader.calls, 1);
});

test('runDue: a change confirmed by a second ask is kept and emailed', async () => {
  const env = await makeEnv({ reads: [notNamed(), notNamed()] });
  const w = await activeWithEmail(env);
  const sentBefore = env.notifier.owners.length;
  const at = START + 30 * DAY;
  const out = await env.service.runDue(at);
  assert.equal(out.changes, 1);
  assert.equal(env.reader.calls, 2, 'asked once more the same day');
  const after = await env.service.get(w.id);
  assert.equal(after.readings[1].named, false);
  assert.equal(after.lastChangeAt, new Date(at).toISOString());
  assert.equal(env.notifier.owners.length, sentBefore + 1);
  const mail = env.notifier.owners.at(-1);
  assert.equal(mail.to, EMAIL);
  assert.equal(mail.subject, 'AI did not name Zephyr Plumbing this month');
  assert.ok(mail.text.includes('AI did not name your business this time.'));
  assert.match(mail.text, /^We asked: Who are the best .+ in Nashville, TN\? Name your top 5\.$/mu);
  assert.ok(mail.text.includes('Other Co, Rival Pipes'));
  assert.ok(mail.text.includes('AI answers change from one time to the next, so this is one snapshot, not a ranking.'));
  assert.ok(mail.text.includes(`${BASE}/watch/${w.id}`));
  assert.equal(mail.headers['List-Unsubscribe'], `<${BASE}/watch/${w.id}/stop?t=${w.stopToken}>`);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(/\$|guarantee|will name/iu.test(mail.subject + mail.text), false);
});

test('runDue: when the second ask disagrees there is no change and nothing is sent', async () => {
  const env = await makeEnv({ reads: [notNamed(), named()] });
  const w = await activeWithEmail(env);
  const sentBefore = env.notifier.owners.length;
  const out = await env.service.runDue(START + 30 * DAY);
  assert.equal(out.changes, 0);
  assert.equal(env.reader.calls, 2);
  const after = await env.service.get(w.id);
  assert.equal(after.lastChangeAt, null);
  assert.equal(after.readings.length, 2);
  assert.equal(after.readings[1].named, true, 'the answer that agrees with the one before is kept');
  assert.equal(env.notifier.owners.length, sentBefore);
});

test('runDue: a watch without an email records the change and sends nothing', async () => {
  const env = await makeEnv({ reads: [notNamed(), notNamed()] });
  const w = (await env.service.start({ gradeId: 'g1' })).watch;
  await env.service.runDue(START + 30 * DAY);
  assert.notEqual((await env.service.get(w.id)).lastChangeAt, null);
  assert.equal(env.notifier.owners.length, 0);
});

test(`runDue: a failed reading is tried the next day, on at most ${WATCH_MAX_RETRIES} days, then "couldn't check"`, async () => {
  const env = await makeEnv({ reads: [failedRead(), failedRead(), failedRead(), failedRead()] });
  const w = (await env.service.start({ gradeId: 'g1' })).watch;
  let at = START + 30 * DAY;
  for (let i = 1; i <= WATCH_MAX_RETRIES; i += 1) {
    await env.service.runDue(at);
    const now = await env.service.get(w.id);
    assert.equal(now.retries, i);
    assert.equal(now.readings.length, 1, 'nothing recorded yet');
    assert.equal(now.nextDueAt, new Date(at + DAY).toISOString(), 'tried again the next day');
    assert.equal((await env.service.runDue(at + 3600000)).due, 0, 'not again the same day');
    at += DAY;
  }
  await env.service.runDue(at);
  const last = await env.service.get(w.id);
  assert.equal(env.reader.calls, WATCH_MAX_RETRIES + 1);
  assert.equal(last.retries, 0);
  assert.equal(last.readings.length, 2);
  assert.equal(last.readings[1].source, 'none');
  assert.equal(last.nextDueAt, new Date(at + 30 * DAY).toISOString(), 'the next one is due in 30 days');
  assert.equal(last.lastChangeAt, null);
});

test('runDue: a reader that throws counts as a failed reading', async () => {
  const env = await makeEnv();
  env.reader.readFree = async () => { env.reader.calls += 1; throw new Error('boom'); };
  const w = (await env.service.start({ gradeId: 'g1' })).watch;
  const out = await env.service.runDue(START + 30 * DAY);
  assert.equal(out.failed, 1);
  assert.equal((await env.service.get(w.id)).retries, 1);
});

test('runDue deletes a pending watch not confirmed in 7 days', async () => {
  const env = await makeEnv();
  const { watch } = await env.service.start({ gradeId: 'g1', email: EMAIL });
  const kept = await activeWithEmail(env);
  assert.equal((await env.service.runDue(START + 6 * DAY)).pruned, 0);
  assert.ok(await env.service.get(watch.id));
  assert.equal((await env.service.runDue(START + 7 * DAY)).pruned, 1);
  assert.equal(await env.service.get(watch.id), undefined);
  assert.ok(await env.service.get(kept.id), 'a confirmed watch stays');
  const raw = await fs.readFile(path.join(env.dir, 'watches.json'), 'utf8');
  assert.equal(raw.split(EMAIL).length - 1, 1, 'only the confirmed watch keeps the address');
});

test('3 failed sends in a row pause the watch, and a paused watch is never due', async () => {
  const env = await makeEnv({ reads: [notNamed(), notNamed(), named(), named()] });
  env.notifier.failOwnerSends = 3;
  const w = await activeWithEmail(env); // the confirm email fails (1)
  assert.equal(w.sendFailures, 1);
  let at = START + 30 * DAY;
  await env.service.runDue(at); // stopped naming: the alert fails (2)
  assert.equal((await env.service.get(w.id)).sendFailures, 2);
  assert.equal((await env.service.get(w.id)).status, 'active');
  at += 30 * DAY;
  await env.service.runDue(at); // started naming: the alert fails (3)
  const paused = await env.service.get(w.id);
  assert.equal(paused.sendFailures, 3);
  assert.equal(paused.status, 'paused');
  const calls = env.reader.calls;
  assert.equal((await env.service.runDue(at + 30 * DAY)).due, 0);
  assert.equal(env.reader.calls, calls);
});

test('a sent email resets the failed-send count', async () => {
  const env = await makeEnv({ reads: [notNamed(), notNamed()] });
  env.notifier.failOwnerSends = 1;
  const w = await activeWithEmail(env);
  assert.equal(w.sendFailures, 1);
  await env.service.runDue(START + 30 * DAY);
  assert.equal((await env.service.get(w.id)).sendFailures, 0);
});

test('a watch stopped during a run is not brought back', async () => {
  const env = await makeEnv();
  const w = (await env.service.start({ gradeId: 'g1' })).watch;
  env.reader.readFree = async () => {
    await env.service.stop(w.id, w.stopToken);
    return notNamed();
  };
  await env.service.runDue(START + 30 * DAY);
  assert.equal(await env.service.get(w.id), undefined);
});

test('logs hold the watch id and counts only: never the business, the email, the question or an answer', async () => {
  const env = await makeEnv({ reads: [notNamed(), notNamed(), failedRead()] });
  const w = await activeWithEmail(env);
  await env.service.runDue(START + 30 * DAY);
  await env.service.runDue(START + 60 * DAY);
  await env.service.stop(w.id, w.stopToken);
  const text = env.logs.join('\n');
  assert.ok(env.logs.length > 0);
  assert.ok(text.includes(w.id));
  for (const secret of ['Zephyr', 'Nashville', 'plumb', EMAIL, 'owner@', 'Other Co', 'Rival Pipes', 'Who are']) {
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `no "${secret}" in the logs`);
  }
});

test('email builders: every inserted value is one plain line', () => {
  const watch = { id: 'w1', confirmToken: 'c', stopToken: 's', input: { name: 'Bad\nName\u0000 <b>Co</b>' } };
  const urls = watchUrls(`${BASE}/`, watch);
  assert.equal(urls.page, `${BASE}/watch/w1`);
  const confirm = defaultEmails.confirm({ watch, urls });
  assert.equal(confirm.subject.includes('\n'), false);
  assert.equal(confirm.subject.includes('\u0000'), false);
  const change = defaultEmails.change({
    watch, change: 'started', question: 'Who\r\nis best?', urls,
    reading: { competitors: ['A\nB', 'C'] },
  });
  assert.equal(change.subject, `AI named ${plainLine(watch.input.name)} this month`);
  assert.ok(change.text.includes('We asked: Who is best?'));
  assert.ok(change.text.includes('AI named: A B, C'));
  assert.equal(plainLine('a\u202Eb\tc'), 'a b c');
});
