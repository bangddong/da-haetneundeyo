import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitsSince } from '../lib/git.mjs';

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

test('returns null for non-git directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-nogit-'));
  assert.equal(commitsSince(dir, '2020-01-01T00:00:00Z'), null);
});
