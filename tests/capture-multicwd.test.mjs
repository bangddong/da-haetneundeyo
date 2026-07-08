import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureTranscript } from '../lib/capture.mjs';
import { userLine } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

function makeRepo(prefix, authorEmail, commitMsg, commitDateIso) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dhnd-multicwd-${prefix}-`));
  const g = (args, env) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  g(['init']);
  g(['config', 'user.email', authorEmail]);
  g(['config', 'user.name', prefix]);
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

test('commits from two cwds visited in one session are both captured, deduped, with repo field', () => {
  const { env } = tmpEnv();
  const repoA = makeRepo('a', 'author-a@t.t', 'feat: repo A 작업', '2026-07-03T01:30:00Z');
  const repoB = makeRepo('b', 'author-b@t.t', 'feat: repo B 작업', '2026-07-03T03:30:00Z');

  const file = writeTranscript(env, 's1', [
    userLine('repo A 작업 시작', { cwd: repoA, timestamp: '2026-07-03T01:00:00Z' }),
    userLine('repo A 작업 계속', { cwd: repoA, timestamp: '2026-07-03T02:00:00Z' }),
    userLine('repo B로 이동', { cwd: repoB, timestamp: '2026-07-03T03:00:00Z' }),
    userLine('repo B 작업 마무리', { cwd: repoB, timestamp: '2026-07-03T04:00:00Z' }),
  ]);

  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);

  assert.equal(d.commits.length, 2);
  const subjects = d.commits.map((c) => c.subject).sort();
  assert.deepEqual(subjects, ['feat: repo A 작업', 'feat: repo B 작업']);
  for (const c of d.commits) {
    assert.ok(c.repo === path.basename(repoA) || c.repo === path.basename(repoB));
  }

  // dedupe: re-running commit merge logic should not duplicate by hash
  const hashes = d.commits.map((c) => c.hash);
  assert.equal(new Set(hashes).size, hashes.length);
});

test('digest.project is the dominant cwd (longest cwdWindows span)', () => {
  const { env } = tmpEnv();
  const repoA = makeRepo('a2', 'author-a@t.t', 'feat: A', '2026-07-03T01:30:00Z');
  const repoB = makeRepo('b2', 'author-b@t.t', 'feat: B', '2026-07-03T05:30:00Z');

  // repoA window: 01:00 - 01:30 (30 min), repoB window: 02:00 - 05:00 (3h) -> repoB dominant
  const file = writeTranscript(env, 's1', [
    userLine('repo A 짧게', { cwd: repoA, timestamp: '2026-07-03T01:00:00Z' }),
    userLine('repo A 짧게 끝', { cwd: repoA, timestamp: '2026-07-03T01:30:00Z' }),
    userLine('repo B 시작', { cwd: repoB, timestamp: '2026-07-03T02:00:00Z' }),
    userLine('repo B 끝', { cwd: repoB, timestamp: '2026-07-03T05:00:00Z' }),
  ]);

  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.equal(d.project, repoB);
  assert.ok(d.cwdWindows[repoA]);
  assert.ok(d.cwdWindows[repoB]);
  assert.equal(d.cwdWindows[repoA].start, '2026-07-03T01:00:00Z');
  assert.equal(d.cwdWindows[repoA].end, '2026-07-03T01:30:00Z');
  assert.equal(d.cwdWindows[repoB].start, '2026-07-03T02:00:00Z');
  assert.equal(d.cwdWindows[repoB].end, '2026-07-03T05:00:00Z');
});

test('incremental capture across two cwds accumulates cwdWindows and merges commits', () => {
  const { env } = tmpEnv();
  const repoA = makeRepo('a3', 'author-a@t.t', 'feat: A 커밋', '2026-07-03T01:30:00Z');
  const repoB = makeRepo('b3', 'author-b@t.t', 'feat: B 커밋', '2026-07-03T03:30:00Z');

  const file = writeTranscript(env, 's1', [
    userLine('repo A 작업', { cwd: repoA, timestamp: '2026-07-03T01:00:00Z' }),
    userLine('repo A 작업 계속', { cwd: repoA, timestamp: '2026-07-03T02:00:00Z' }),
  ]);
  const d1 = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.equal(d1.commits.length, 1);
  assert.equal(d1.commits[0].subject, 'feat: A 커밋');
  assert.ok(d1.cwdWindows[repoA]);
  assert.equal(Object.keys(d1.cwdWindows).length, 1);

  fs.appendFileSync(file, [
    userLine('repo B로 이동', { cwd: repoB, timestamp: '2026-07-03T03:00:00Z' }),
    userLine('repo B 작업 마무리', { cwd: repoB, timestamp: '2026-07-03T04:00:00Z' }),
  ].map((l) => l + '\n').join(''));

  const d2 = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.ok(d2.cwdWindows[repoA]);
  assert.ok(d2.cwdWindows[repoB]);
  assert.equal(Object.keys(d2.cwdWindows).length, 2);
  assert.equal(d2.commits.length, 2);
  const subjects = d2.commits.map((c) => c.subject).sort();
  assert.deepEqual(subjects, ['feat: A 커밋', 'feat: B 커밋']);
});
