import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { upsertDigest, findDigest, readRange, dayOf, dayFilePath, loadState, saveState, setField, localDay } from '../lib/journal.mjs';
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

test('localDay converts ISO to local date with explicit offsets', () => {
  // 2026-07-08T16:00Z = KST(+540) 7/9 01:00, NY(-240) 7/8 12:00, UTC 7/8
  assert.equal(localDay('2026-07-08T16:00:00Z', 540), '2026-07-09');
  assert.equal(localDay('2026-07-08T16:00:00Z', -240), '2026-07-08');
  assert.equal(localDay('2026-07-08T16:00:00Z', 0), '2026-07-08');
  // 음수 오프셋에서 이전 날짜로 넘어가는 경우: 7/9 02:00Z = NY 7/8 22:00
  assert.equal(localDay('2026-07-09T02:00:00Z', -240), '2026-07-08');
});

test('readRange (KST): a session at 1am local is visible in the local-day query, not the UTC day', () => {
  const { env } = tmpEnv();
  env.DHND_UTC_OFFSET_MIN = '540'; // KST 고정 — 머신 타임존과 무관하게 결정적
  // 7/9 01:00~02:00 KST = 7/8 16:00~17:00 UTC → 파일은 2026-07-08.jsonl에 적재됨
  upsertDigest(digest({ sessionId: 'night', start: '2026-07-08T16:00:00Z', end: '2026-07-08T17:00:00Z' }), env);
  assert.deepEqual(readRange('2026-07-09', '2026-07-09', env).map((d) => d.sessionId), ['night']);
  assert.deepEqual(readRange('2026-07-08', '2026-07-08', env), []); // 로컬 기준 7/8이 아님
});

test('readRange (negative offset): local toDay session stored in the next UTC day file is still found', () => {
  const { env } = tmpEnv();
  env.DHND_UTC_OFFSET_MIN = '-240'; // America/New_York(서머타임) 고정
  // 7/9 22:00 NY = 7/10 02:00 UTC → 파일은 2026-07-10.jsonl (조회 상한보다 뒤)
  upsertDigest(digest({ sessionId: 'ny-evening', start: '2026-07-10T02:00:00Z', end: '2026-07-10T03:00:00Z' }), env);
  assert.deepEqual(readRange('2026-07-09', '2026-07-09', env).map((d) => d.sessionId), ['ny-evening']);
});

test('findDigest falls back to adjacent day files (local vs UTC key ±1 mismatch)', () => {
  const { env } = tmpEnv();
  // 파일 키는 UTC 7/8이지만, 스킬이 보여주는 로컬(KST) 날짜는 7/9 — 사용자는 --day 2026-07-09로 요청한다
  upsertDigest(digest({ sessionId: 'night', start: '2026-07-08T16:00:00Z', end: '2026-07-08T17:00:00Z' }), env);
  assert.equal(findDigest('night', '2026-07-09', env)?.sessionId, 'night');
  assert.equal(setField('night', '2026-07-09', 'note', '새벽 작업 건', env), true);
  assert.equal(findDigest('night', '2026-07-08', env).note, '새벽 작업 건'); // 원래 파일 위치는 유지
});

test('readRange includes a boundary-spanning session started before the window but ended inside it', () => {
  const { env } = tmpEnv();
  env.DHND_UTC_OFFSET_MIN = '0'; // UTC 의미론으로 고정 (경계 타임스탬프가 로컬 tz에 따라 달라지지 않도록)
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
  env.DHND_UTC_OFFSET_MIN = '0';
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
