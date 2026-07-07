import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, emptyDigest, applyRecords, finalizeKind } from '../lib/transcript.mjs';
import { userLine, assistantToolUse, queueOp } from './fixtures.mjs';

const build = (lines) => {
  const d = emptyDigest('s1');
  applyRecords(d, lines.map(parseLine).filter(Boolean), { noiseMaxChars: 2000 });
  finalizeKind(d);
  return d;
};

test('parseLine returns null on broken JSON, object on valid', () => {
  assert.equal(parseLine('{broken'), null);
  assert.equal(parseLine(userLine('hi')).type, 'user');
});

test('collects user requests, cwd, branch, timestamps', () => {
  const d = build([
    userLine('결재선 조회 버그 고쳐줘', { timestamp: '2026-07-03T01:00:00Z' }),
    userLine('테스트도 돌려줘', { timestamp: '2026-07-03T02:00:00Z' }),
  ]);
  assert.deepEqual(d.requests, ['결재선 조회 버그 고쳐줘', '테스트도 돌려줘']);
  assert.equal(d.turns, 2);
  assert.equal(d.project, 'D:\\develop\\demo-api');
  assert.equal(d.branch, 'develop');
  assert.equal(d.start, '2026-07-03T01:00:00Z');
  assert.equal(d.end, '2026-07-03T02:00:00Z');
});

test('noise filters: sidechain, local command, tool_result, meta', () => {
  const d = build([
    userLine('진짜 요청'),
    userLine('(local command) ls', {}),
    userLine('사이드체인', { isSidechain: true }),
    userLine('메타', { isMeta: true }),
    userLine([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    queueOp(),
  ]);
  assert.deepEqual(d.requests, ['진짜 요청']);
});

test('noise filters: expanded exclude prefixes (task-notification, system-reminder, interrupted)', () => {
  const d = build([
    userLine('진짜 요청'),
    userLine('<task-notification>백그라운드 완료</task-notification>'),
    userLine('<system-reminder>컨텍스트 알림</system-reminder>'),
    userLine('[Request interrupted by user]'),
    userLine('  (local command) 앞뒤 공백'), // trim 후 startsWith 검사
  ]);
  assert.deepEqual(d.requests, ['진짜 요청']);
});

test('oversize request is truncated and preserved, not excluded', () => {
  const big = 'x'.repeat(2001);
  const d = build([userLine(big)]);
  assert.equal(d.requests.length, 1);
  assert.equal(d.requests[0], `${'x'.repeat(300)} …(전체 2001자 생략)`);
});

test('request at exactly noiseMaxChars is not truncated', () => {
  const exact = 'y'.repeat(2000);
  const d = build([userLine(exact)]);
  assert.deepEqual(d.requests, [exact]);
});

test('extracts filesEdited from edit tools and commands from Bash (dedup)', () => {
  const d = build([
    assistantToolUse('Edit', { file_path: 'D:\\a\\User.java', old_string: 'a', new_string: 'b' }),
    assistantToolUse('Write', { file_path: 'D:\\a\\New.java', content: '...' }),
    assistantToolUse('Edit', { file_path: 'D:\\a\\User.java', old_string: 'c', new_string: 'd' }),
    assistantToolUse('Bash', { command: 'gradlew test' }),
    assistantToolUse('Read', { file_path: 'D:\\a\\Read.java' }),
  ]);
  assert.deepEqual(d.filesEdited, ['D:\\a\\User.java', 'D:\\a\\New.java']);
  assert.deepEqual(d.commands, ['gradlew test']);
});

test('kind: qa when no edits/commits, work when edits exist', () => {
  assert.equal(build([userLine('git 질문')]).kind, 'qa');
  assert.equal(build([assistantToolUse('Edit', { file_path: 'a.ts' })]).kind, 'work');
  const d = build([userLine('질문')]);
  d.commits = [{ hash: 'abc1234', subject: 'fix' }];
  finalizeKind(d);
  assert.equal(d.kind, 'work');
});
