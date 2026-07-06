import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { upsertDigest, findDigest, readRange, dayOf, dayFilePath, loadState, saveState, setField } from '../lib/journal.mjs';
import { emptyDigest } from '../lib/transcript.mjs';
import { tmpEnv } from './helpers.mjs';

const digest = (over = {}) => ({
  ...emptyDigest('s1'), start: '2026-07-03T01:00:00Z', end: '2026-07-03T02:00:00Z',
  project: 'D:\\p', requests: ['요청1'], ...over,
});

test('dayOf and dayFilePath', () => {
  const { env } = tmpEnv();
  assert.equal(dayOf(digest()), '2026-07-03');
  assert.ok(dayFilePath('2026-07-03', env).endsWith('2026-07-03.jsonl'));
  assert.ok(dayFilePath('2026-07-03', env).includes('2026'));
});

test('upsert is idempotent: same session 3x = 1 line', () => {
  const { env } = tmpEnv();
  upsertDigest(digest(), env);
  upsertDigest(digest({ requests: ['요청1', '요청2'] }), env);
  upsertDigest(digest({ requests: ['요청1', '요청2'] }), env);
  const lines = fs.readFileSync(dayFilePath('2026-07-03', env), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).requests, ['요청1', '요청2']);
});

test('upsert preserves existing note when new digest has none', () => {
  const { env } = tmpEnv();
  upsertDigest(digest({ note: '결재선 버그 건' }), env);
  upsertDigest(digest({ requests: ['요청1', '추가'] }), env);
  assert.equal(findDigest('s1', '2026-07-03', env).note, '결재선 버그 건');
});

test('readRange spans multiple days, skips corrupt lines', () => {
  const { env } = tmpEnv();
  upsertDigest(digest(), env);
  upsertDigest(digest({ sessionId: 's2', start: '2026-07-04T01:00:00Z' }), env);
  fs.appendFileSync(dayFilePath('2026-07-03', env), '{broken\n');
  const all = readRange('2026-07-01', '2026-07-05', env);
  assert.deepEqual(all.map((d) => d.sessionId).sort(), ['s1', 's2']);
});

test('state roundtrip and defaults', () => {
  const { env } = tmpEnv();
  assert.deepEqual(loadState(env), { sessions: {}, lastSweepMs: 0 });
  saveState({ sessions: { s1: { offset: 100, day: '2026-07-03' } }, lastSweepMs: 5 }, env);
  assert.equal(loadState(env).sessions.s1.offset, 100);
});

test('setField updates note and kind', () => {
  const { env } = tmpEnv();
  upsertDigest(digest(), env);
  assert.equal(setField('s1', '2026-07-03', 'kind', 'work', env), true);
  assert.equal(findDigest('s1', '2026-07-03', env).kind, 'work');
  assert.equal(setField('nope', '2026-07-03', 'note', 'x', env), false);
});
