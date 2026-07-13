import test from 'node:test';
import assert from 'node:assert/strict';
import { prsForCommit, collectPrOutcomes } from '../lib/github.mjs';

test('prsForCommit maps gh api output to {number,state,merged}', () => {
  const fakeExec = () => JSON.stringify([
    { number: 12, state: 'closed', merged_at: '2026-07-09T06:00:00Z', title: 'x' },
    { number: 13, state: 'open', merged_at: null },
  ]);
  assert.deepEqual(prsForCommit('D:\\repo', 'abc1234', fakeExec), [
    { number: 12, state: 'closed', merged: true },
    { number: 13, state: 'open', merged: false },
  ]);
});

test('prsForCommit returns null when gh fails (missing, unauthenticated, 404)', () => {
  const throwing = () => { throw new Error('gh: command not found'); };
  assert.equal(prsForCommit('D:\\repo', 'abc1234', throwing), null);
});

const entry = (over = {}) => ({
  sessionId: 's1', kind: 'work',
  cwdWindows: { 'D:\\work\\demo-api': { start: '2026-07-09T01:00:00Z', end: '2026-07-09T02:00:00Z' } },
  commits: [{ hash: 'abc1234', subject: 'fix', repo: 'demo-api', date: '2026-07-09' }],
  ...over,
});

test('collectPrOutcomes resolves cwd by repo basename, dedupes hashes, skips qa', () => {
  const calls = [];
  const fakePrs = (cwd, hash) => {
    calls.push([cwd, hash]);
    return [{ number: 7, state: 'closed', merged: true }];
  };
  const { prs } = collectPrOutcomes([
    entry(),
    entry({ sessionId: 's2' }), // 같은 해시 → dedupe
    entry({ sessionId: 's3', kind: 'qa' }), // qa 제외
  ], fakePrs);
  assert.deepEqual(calls, [['D:\\work\\demo-api', 'abc1234']]);
  assert.deepEqual(prs, { abc1234: [{ number: 7, state: 'closed', merged: true }] });
});

test('collectPrOutcomes omits commits with no PR or failed lookup', () => {
  const { prs } = collectPrOutcomes([entry()], () => null);
  assert.deepEqual(prs, {});
  const { prs: empty } = collectPrOutcomes([entry()], () => []);
  assert.deepEqual(empty, {});
});

test('collectPrOutcomes skips commits whose repo has no matching cwd', () => {
  const calls = [];
  const { prs } = collectPrOutcomes([
    entry({ commits: [{ hash: 'zzz9999', subject: 'x', repo: 'other-repo' }] }),
  ], (cwd, hash) => { calls.push(hash); return [{ number: 1, state: 'open', merged: false }]; });
  assert.deepEqual(calls, []);
  assert.deepEqual(prs, {});
});
