import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captureTranscript, sweepProjects } from '../lib/capture.mjs';
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

test('captures new transcript into journal', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('버그 고쳐줘')]);
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.requests, ['버그 고쳐줘']);
  assert.equal(findDigest('s1', '2026-07-03', env).sessionId, 's1');
  assert.ok(loadState(env).sessions.s1.offset > 0);
});

test('incremental: second capture only consumes appended lines and merges', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  const offset1 = loadState(env).sessions.s1.offset;
  fs.appendFileSync(file, assistantToolUse('Edit', { file_path: 'D:\\a.java' }) + '\n');
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.requests, ['요청1']);           // 기존 유지
  assert.deepEqual(d.filesEdited, ['D:\\a.java']);   // 새로 추가
  assert.equal(d.kind, 'work');
  assert.ok(loadState(env).sessions.s1.offset > offset1);
});

test('no new bytes → returns null without touching journal', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.equal(captureTranscript({ sessionId: 's1', transcriptPath: file }, env), null);
});

test('incomplete trailing line (no newline) is not consumed', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  fs.appendFileSync(file, '{"type":"user","partial');
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.requests, ['요청1']);
  const offset = loadState(env).sessions.s1.offset;
  assert.equal(offset, fs.statSync(file).size - Buffer.byteLength('{"type":"user","partial'));
});

test('complete flag marks digest completed', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file, complete: true }, env);
  assert.equal(d.completed, true);
});

test('sweepProjects picks up unprocessed transcripts, skips agent-*.jsonl', () => {
  const { env } = tmpEnv();
  writeTranscript(env, 's1', [userLine('요청1')]);
  writeTranscript(env, 'agent-x', [userLine('사이드')]);
  const { processed } = sweepProjects(env, { sinceMs: 0 });
  assert.equal(processed, 1);
  assert.ok(findDigest('s1', '2026-07-03', env));
});
