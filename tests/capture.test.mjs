import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureTranscript, sweepProjects } from '../lib/capture.mjs';
import { findDigest, loadState, saveState } from '../lib/journal.mjs';
import { userLine, assistantToolUse } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-capture-git-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  g('init');
  g('config', 'user.email', 'repo-author@t.t');
  g('config', 'user.name', 'repo-author');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1');
  g('add', '-A');
  g('commit', '-m', 'feat: 초기 커밋');
  return dir;
}

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

test('does not persist a resolved author cache to state.json', () => {
  // The author cache is process-scoped, not persisted: a stored cache would
  // never notice a repo whose git user.email later changes, silently
  // dropping that repo's commits from every future report.
  const { env } = tmpEnv();
  const repoDir = makeRepo();
  const file = writeTranscript(env, 's1', [userLine('버그 고쳐줘', { cwd: repoDir })]);
  captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.equal(loadState(env).authors, undefined);
});

test('ignores a stale persisted author and re-resolves from the repo', () => {
  const { env } = tmpEnv();
  // Commit dated inside the session window (01:00–03:00) authored by
  // repo-author@t.t.
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-capture-git-'));
  const g = (args, extraEnv) => execFileSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf8', env: { ...process.env, ...extraEnv },
  });
  g(['init']);
  g(['config', 'user.email', 'repo-author@t.t']);
  g(['config', 'user.name', 'repo-author']);
  fs.writeFileSync(path.join(repoDir, 'a.txt'), '1');
  g(['add', '-A']);
  g(['commit', '-m', 'feat: 초기 커밋'], {
    GIT_COMMITTER_DATE: '2026-07-03T02:00:00Z', GIT_AUTHOR_DATE: '2026-07-03T02:00:00Z',
  });
  // Simulate a legacy state.json holding a now-wrong cached author.
  saveState({ sessions: {}, lastSweepMs: 0, authors: { [repoDir]: 'moved-on@t.t' } }, env);
  const file = writeTranscript(env, 's1', [
    userLine('버그 고쳐줘', { cwd: repoDir, timestamp: '2026-07-03T01:00:00Z' }),
    userLine('마무리', { cwd: repoDir, timestamp: '2026-07-03T03:00:00Z' }),
  ]);
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  // The commit is attributed only if the current repo email was used, not
  // the stale cache (which would filter it out via --author).
  assert.equal(d.commits.length, 1);
  assert.equal(d.commits[0].subject, 'feat: 초기 커밋');
});

test('strips a legacy authors key from state.json on next capture', () => {
  const { env } = tmpEnv();
  saveState({ sessions: {}, lastSweepMs: 0, authors: { '/old/repo': 'x@t.t' } }, env);
  const file = writeTranscript(env, 's1', [userLine('버그 고쳐줘')]);
  captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.equal(loadState(env).authors, undefined);
});

test('sweepProjects picks up unprocessed transcripts, skips agent-*.jsonl', () => {
  const { env } = tmpEnv();
  writeTranscript(env, 's1', [userLine('요청1')]);
  writeTranscript(env, 'agent-x', [userLine('사이드')]);
  const { processed } = sweepProjects(env, { sinceMs: 0 });
  assert.equal(processed, 1);
  assert.ok(findDigest('s1', '2026-07-03', env));
});
