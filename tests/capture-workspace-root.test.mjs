import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureTranscript } from '../lib/capture.mjs';
import { userLine, assistantToolUse } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

// 워크스페이스 루트(자체는 git repo 아님) 아래에 하위 repo를 만든다.
function makeChildRepo(root, name, commitMsg, commitDateIso) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const g = (args, env) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  g(['init']);
  g(['config', 'user.email', 'me@t.t']);
  g(['config', 'user.name', 'me']);
  fs.writeFileSync(path.join(dir, 'a.txt'), '1');
  g(['add', '-A']);
  g(['commit', '-m', commitMsg], {
    GIT_COMMITTER_DATE: commitDateIso, GIT_AUTHOR_DATE: commitDateIso,
  });
  return dir;
}

function writeTranscript(env, sessionId, lines) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  return file;
}

test('non-repo workspace root cwd: commits inferred from filesEdited across two child repos', () => {
  const { env } = tmpEnv();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-ws-'));
  const repoA = makeChildRepo(root, 'api', 'feat: api 작업', '2026-07-13T03:00:00Z');
  const repoB = makeChildRepo(root, 'web', 'feat: web 작업', '2026-07-13T03:30:00Z');

  const file = writeTranscript(env, 's1', [
    userLine('루트에서 작업 시작', { cwd: root, timestamp: '2026-07-13T02:00:00Z' }),
    assistantToolUse('Edit', { file_path: path.join(repoA, 'a.txt'), old_string: '1', new_string: '2' }, { cwd: root, timestamp: '2026-07-13T02:30:00Z' }),
    assistantToolUse('Edit', { file_path: path.join(repoB, 'a.txt'), old_string: '1', new_string: '2' }, { cwd: root, timestamp: '2026-07-13T02:40:00Z' }),
    userLine('마무리', { cwd: root, timestamp: '2026-07-13T04:00:00Z' }),
  ]);

  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);

  assert.equal(d.commits.length, 2);
  const subjects = d.commits.map((c) => c.subject).sort();
  assert.deepEqual(subjects, ['feat: api 작업', 'feat: web 작업']);
  const repos = d.commits.map((c) => c.repo).sort();
  assert.deepEqual(repos, ['api', 'web']);
});

test('fallback respects the window time range: commit after window end is excluded', () => {
  const { env } = tmpEnv();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-ws-'));
  const repo = makeChildRepo(root, 'api', 'feat: 창 밖 커밋', '2026-07-13T06:00:00Z');

  const file = writeTranscript(env, 's1', [
    userLine('루트에서 작업', { cwd: root, timestamp: '2026-07-13T02:00:00Z' }),
    assistantToolUse('Edit', { file_path: path.join(repo, 'a.txt'), old_string: '1', new_string: '2' }, { cwd: root, timestamp: '2026-07-13T02:30:00Z' }),
    userLine('마무리', { cwd: root, timestamp: '2026-07-13T04:00:00Z' }),
  ]);

  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.commits, []);
});

test('same repo reached via its own cwd window and fallback: commit deduped by hash', () => {
  const { env } = tmpEnv();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-ws-'));
  const repo = makeChildRepo(root, 'api', 'feat: 한 번만', '2026-07-13T03:00:00Z');

  const file = writeTranscript(env, 's1', [
    userLine('루트에서 시작', { cwd: root, timestamp: '2026-07-13T02:00:00Z' }),
    assistantToolUse('Edit', { file_path: path.join(repo, 'a.txt'), old_string: '1', new_string: '2' }, { cwd: root, timestamp: '2026-07-13T02:30:00Z' }),
    userLine('repo로 잠깐 이동', { cwd: repo, timestamp: '2026-07-13T02:50:00Z' }),
    userLine('repo에서 나옴', { cwd: repo, timestamp: '2026-07-13T02:55:00Z' }),
    userLine('루트에서 마무리', { cwd: root, timestamp: '2026-07-13T04:00:00Z' }),
  ]);

  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.equal(d.commits.length, 1);
  assert.equal(d.commits[0].subject, 'feat: 한 번만');
});

test('edited files outside any repo (or nonexistent) are skipped without error', () => {
  const { env } = tmpEnv();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-ws-'));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'x');

  const file = writeTranscript(env, 's1', [
    userLine('루트 파일만 편집', { cwd: root, timestamp: '2026-07-13T02:00:00Z' }),
    assistantToolUse('Edit', { file_path: path.join(root, 'CLAUDE.md'), old_string: 'x', new_string: 'y' }, { cwd: root, timestamp: '2026-07-13T02:30:00Z' }),
    assistantToolUse('Edit', { file_path: path.join(root, 'ghost', 'gone.txt'), old_string: 'x', new_string: 'y' }, { cwd: root, timestamp: '2026-07-13T02:40:00Z' }),
    userLine('마무리', { cwd: root, timestamp: '2026-07-13T04:00:00Z' }),
  ]);

  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.commits, []);
});
