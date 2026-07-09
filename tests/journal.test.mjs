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

test('readRange includes a boundary-spanning session started before the window but ended inside it', () => {
  const { env } = tmpEnv();
  // 주 경계를 넘긴 장기 세션: 시작 2026-07-03(지난주) → 종료 2026-07-09(조회 주간 안). 시작일 파일은
  // 2026-07-03.jsonl 이라 [07-06, 07-12] 창 밖이지만, 종료가 창 안이므로 포함되어야 한다 (#19).
  upsertDigest(digest({ sessionId: 'span', start: '2026-07-03T01:00:00Z', end: '2026-07-09T10:00:00Z' }), env);
  // 창 이전에 시작·종료해 겹치지 않는 세션은 제외되어야 한다.
  upsertDigest(digest({ sessionId: 'before', start: '2026-07-01T01:00:00Z', end: '2026-07-01T02:00:00Z' }), env);
  const got = readRange('2026-07-06', '2026-07-12', env).map((d) => d.sessionId).sort();
  assert.deepEqual(got, ['span']);
});

test('readRange excludes a session ending the day before the window, includes one ending on the first day', () => {
  const { env } = tmpEnv();
  upsertDigest(digest({ sessionId: 'edge-out', start: '2026-07-04T01:00:00Z', end: '2026-07-05T23:59:59Z' }), env);
  upsertDigest(digest({ sessionId: 'edge-in', start: '2026-07-04T01:00:00Z', end: '2026-07-06T00:00:01Z' }), env);
  const got = readRange('2026-07-06', '2026-07-12', env).map((d) => d.sessionId).sort();
  assert.deepEqual(got, ['edge-in']);
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
