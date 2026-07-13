import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userLine, assistantToolUse } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/journal-cli.mjs', import.meta.url));
const run = (env, ...args) =>
  spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });

function seed(env) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), userLine('CLI 테스트') + '\n');
}

function seedWorkAndQa(env) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  // qa: 요청만 있고 파일 수정 없음
  fs.writeFileSync(
    path.join(dir, 'qa1.jsonl'),
    userLine('질문만 했어요', { sessionId: 'qa1' }) + '\n',
  );
  // work: Edit tool_use 포함
  fs.writeFileSync(
    path.join(dir, 'work1.jsonl'),
    [
      userLine('버그 고쳐줘', { sessionId: 'work1' }),
      assistantToolUse('Edit', { file_path: 'D:\\a.java' }, { sessionId: 'work1' }),
    ].join('\n') + '\n',
  );
}

test('backfill then range returns seeded session', () => {
  const { env } = tmpEnv();
  seed(env);
  const b = run(env, 'backfill', '--days', '30');
  assert.equal(b.status, 0);
  assert.equal(JSON.parse(b.stdout).processed, 1);
  const r = run(env, 'range', '--from', '2026-07-01', '--to', '2026-07-05');
  const entries = JSON.parse(r.stdout);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sessionId, 's1');
});

test('note and kind update journal', () => {
  const { env } = tmpEnv();
  seed(env);
  run(env, 'backfill', '--days', '30');
  const n = run(env, 'note', '--session', 's1', '--day', '2026-07-03', '--text', '결재선 건');
  assert.deepEqual(JSON.parse(n.stdout), { ok: true });
  const k = run(env, 'kind', '--session', 's1', '--day', '2026-07-03', '--value', 'work');
  assert.deepEqual(JSON.parse(k.stdout), { ok: true });
  const r = run(env, 'range', '--from', '2026-07-03', '--to', '2026-07-03');
  const [d] = JSON.parse(r.stdout);
  assert.equal(d.note, '결재선 건');
  assert.equal(d.kind, 'work');
});

test('unknown command exits 1 with usage', () => {
  const { env } = tmpEnv();
  const r = run(env, 'wat');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});

test('range without --from/--to exits 1 with usage', () => {
  const { env } = tmpEnv();
  const r = run(env, 'range', '--from', '2026-07-01');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});

test('range --kind work filters to work sessions only', () => {
  const { env } = tmpEnv();
  seedWorkAndQa(env);
  run(env, 'backfill', '--days', '30');
  const r = run(env, 'range', '--from', '2026-07-01', '--to', '2026-07-05', '--kind', 'work');
  assert.equal(r.status, 0);
  const entries = JSON.parse(r.stdout);
  assert.deepEqual(entries.map((d) => d.sessionId), ['work1']);
  assert.ok(entries.every((d) => d.kind === 'work'));
});

test('range --kind qa filters to qa sessions only', () => {
  const { env } = tmpEnv();
  seedWorkAndQa(env);
  run(env, 'backfill', '--days', '30');
  const r = run(env, 'range', '--from', '2026-07-01', '--to', '2026-07-05', '--kind', 'qa');
  assert.equal(r.status, 0);
  const entries = JSON.parse(r.stdout);
  assert.deepEqual(entries.map((d) => d.sessionId), ['qa1']);
});

test('range --kind with invalid value exits 1 with usage', () => {
  const { env } = tmpEnv();
  const r = run(env, 'range', '--from', '2026-07-01', '--to', '2026-07-05', '--kind', 'bogus');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});

test('range without --kind returns all sessions (existing behavior)', () => {
  const { env } = tmpEnv();
  seedWorkAndQa(env);
  run(env, 'backfill', '--days', '30');
  const r = run(env, 'range', '--from', '2026-07-01', '--to', '2026-07-05');
  const entries = JSON.parse(r.stdout);
  assert.deepEqual(entries.map((d) => d.sessionId).sort(), ['qa1', 'work1']);
});

test('pr-outcomes: disabled by default with a hint; validates date args', () => {
  const { env } = tmpEnv();
  const r = run(env, 'pr-outcomes', '--from', '2026-07-06', '--to', '2026-07-12');
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.reason, /prOutcomes/);
  const bad = run(env, 'pr-outcomes', '--from', 'nope');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /usage/);
});
