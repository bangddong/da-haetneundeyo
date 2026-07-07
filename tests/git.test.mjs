import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitsSince, repoAuthorEmail } from '../lib/git.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-git-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  g('init');
  g('config', 'user.email', 't@t.t');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1');
  g('add', '-A');
  g('commit', '-m', 'feat: 결재선 버그 수정');
  return dir;
}

test('returns commits since timestamp', () => {
  const dir = makeRepo();
  const commits = commitsSince(dir, '2020-01-01T00:00:00Z');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'feat: 결재선 버그 수정');
  assert.match(commits[0].hash, /^[0-9a-f]{7,}$/);
});

test('returns empty array when no commits in window', () => {
  const dir = makeRepo();
  const future = new Date(Date.now() + 86400_000).toISOString();
  assert.deepEqual(commitsSince(dir, future), []);
});

test('until bound excludes commits after the session window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-git-'));
  const g = (args, env) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  g(['init']);
  g(['config', 'user.email', 't@t.t']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'a.txt'), '1');
  g(['add', '-A']);
  g(['commit', '-m', 'in-window'], { GIT_COMMITTER_DATE: '2026-01-01T10:00:00Z', GIT_AUTHOR_DATE: '2026-01-01T10:00:00Z' });
  fs.writeFileSync(path.join(dir, 'a.txt'), '2');
  g(['add', '-A']);
  g(['commit', '-m', 'after-window'], { GIT_COMMITTER_DATE: '2026-01-02T10:00:00Z', GIT_AUTHOR_DATE: '2026-01-02T10:00:00Z' });
  const commits = commitsSince(dir, '2026-01-01T00:00:00Z', '2026-01-01T23:59:59Z');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'in-window');
});

test('returns null for non-git directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-nogit-'));
  assert.equal(commitsSince(dir, '2020-01-01T00:00:00Z'), null);
});

test('author filter: only matching author commits are returned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-git-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  g('init');
  g('-c', 'user.email=a@t.t', '-c', 'user.name=a', 'commit', '--allow-empty', '-m', 'from-a');
  g('-c', 'user.email=b@t.t', '-c', 'user.name=b', 'commit', '--allow-empty', '-m', 'from-b');
  const commits = commitsSince(dir, '2020-01-01T00:00:00Z', undefined, 'a@t.t');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'from-a');
});

test('repoAuthorEmail returns configured user.email', () => {
  const dir = makeRepo();
  assert.equal(repoAuthorEmail(dir), 't@t.t');
});

test('repoAuthorEmail returns null for non-git directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-nogit-'));
  assert.equal(repoAuthorEmail(dir), null);
});

test('repoAuthorEmail falls back to global config when repo has no local email', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-git-'));
  execFileSync('git', ['-C', dir, 'init'], { encoding: 'utf8' });
  const globalCfg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-cfg-')), 'gitconfig');
  fs.writeFileSync(globalCfg, '[user]\n\temail = global@t.t\n');
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalCfg;
  try {
    assert.equal(repoAuthorEmail(dir), 'global@t.t');
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  }
});
