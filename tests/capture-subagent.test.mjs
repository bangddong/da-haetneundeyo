import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captureTranscript } from '../lib/capture.mjs';
import { findDigest, loadState } from '../lib/journal.mjs';
import { userLine, assistantToolUse } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

function writeTranscript(env, sessionId, lines) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  return file;
}

function writeSubagentsDir(env, parentSessionId, agentFileName, lines) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p', parentSessionId, 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, agentFileName);
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  return file;
}

function writeSiblingAgentFile(env, agentFileName, lines) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, agentFileName);
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  return file;
}

test('subagents/ dir pattern: subagent Edit merges into parent digest, kind becomes work', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('조사만 해줘')]); // 부모: 요청만, 파일수정 없음
  writeSubagentsDir(env, 's1', 'agent-x.jsonl', [
    userLine('서브에이전트 프롬프트', { sessionId: 's1' }),
    assistantToolUse('Edit', { file_path: 'D:\\sub\\Fixed.java' }, { sessionId: 's1' }),
  ]);

  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.filesEdited, ['D:\\sub\\Fixed.java']);
  assert.equal(d.kind, 'work');
  assert.equal(findDigest('s1', '2026-07-03', env).kind, 'work');
});

test('sibling agent-*.jsonl pattern: matched by first record sessionId, merges Edit', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's2', [userLine('조사만 해줘', { sessionId: 's2' })]);
  writeSiblingAgentFile(env, 'agent-y.jsonl', [
    userLine('서브 프롬프트', { sessionId: 's2' }),
    assistantToolUse('Write', { file_path: 'D:\\sub\\New.java' }, { sessionId: 's2' }),
  ]);

  const d = captureTranscript({ sessionId: 's2', transcriptPath: file }, env);
  assert.deepEqual(d.filesEdited, ['D:\\sub\\New.java']);
  assert.equal(d.kind, 'work');
});

test('sibling agent-*.jsonl with unrelated sessionId is not merged', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's3', [userLine('조사만 해줘', { sessionId: 's3' })]);
  writeSiblingAgentFile(env, 'agent-z.jsonl', [
    userLine('무관한 세션', { sessionId: 'other-session' }),
    assistantToolUse('Write', { file_path: 'D:\\sub\\ShouldNotAppear.java' }, { sessionId: 'other-session' }),
  ]);

  const d = captureTranscript({ sessionId: 's3', transcriptPath: file }, env);
  assert.deepEqual(d.filesEdited, []);
  assert.equal(d.kind, 'qa');
});

test('subagent files are incrementally parsed: second capture does not reprocess', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's4', [userLine('조사만 해줘')]);
  const agentFile = writeSubagentsDir(env, 's4', 'agent-w.jsonl', [
    userLine('서브 프롬프트', { sessionId: 's4' }),
    assistantToolUse('Edit', { file_path: 'D:\\sub\\A.java' }, { sessionId: 's4' }),
  ]);
  captureTranscript({ sessionId: 's4', transcriptPath: file }, env);
  const key = `s4#${path.basename(agentFile)}`;
  const offsetAfterFirst = loadState(env).sessions[key]?.offset;
  assert.ok(offsetAfterFirst > 0);

  fs.appendFileSync(agentFile, assistantToolUse('Edit', { file_path: 'D:\\sub\\B.java' }, { sessionId: 's4' }) + '\n');
  fs.appendFileSync(file, userLine('추가 요청') + '\n');
  const d = captureTranscript({ sessionId: 's4', transcriptPath: file }, env);
  assert.deepEqual(d.filesEdited, ['D:\\sub\\A.java', 'D:\\sub\\B.java']);
});
