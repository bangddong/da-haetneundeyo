import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { archiveSession } from '../lib/archive.mjs';
import { sweepProjects } from '../lib/capture.mjs';
import { findDigest } from '../lib/journal.mjs';
import { dataDir } from '../lib/paths.mjs';
import { userLine, assistantText, assistantToolUse } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/journal-cli.mjs', import.meta.url));
const run = (env, ...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });

function writeTranscript(env, sessionId, lines) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  return file;
}

function archivePath(env, day, sessionId) {
  return path.join(dataDir(env), 'archive', day.slice(0, 4), day.slice(5, 7), `${sessionId}.jsonl.gz`);
}

test('archiveSession extracts only user/assistant text, excludes tool_use', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [
    userLine('버그 고쳐줘'),
    assistantToolUse('Edit', { file_path: 'D:\\a.java' }),
    assistantText('고쳤습니다'),
  ]);

  const ok = archiveSession(file, 's1', '2026-07-03', env);
  assert.equal(ok, true);

  const gz = archivePath(env, '2026-07-03', 's1');
  assert.ok(fs.existsSync(gz));
  const raw = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  const records = raw.trim().split('\n').map((l) => JSON.parse(l));

  assert.ok(records.every((r) => r.role === 'user' || r.role === 'assistant'));
  assert.ok(records.some((r) => r.role === 'user' && r.text === '버그 고쳐줘'));
  assert.ok(records.some((r) => r.role === 'assistant' && r.text === '고쳤습니다'));
  // tool_use content must not leak into the archived text.
  assert.ok(!records.some((r) => JSON.stringify(r).includes('a.java')));
  assert.ok(!raw.includes('tool_use'));
});

test('archiveSession skips isSidechain records and returns false if unchanged (existing, newer original)', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [
    userLine('메인 요청'),
    userLine('사이드체인', { isSidechain: true }),
  ]);

  archiveSession(file, 's1', '2026-07-03', env);
  const gz = archivePath(env, '2026-07-03', 's1');
  const raw = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  assert.ok(!raw.includes('사이드체인'));
  assert.ok(raw.includes('메인 요청'));

  // Archive already exists and is newer than the (unchanged) original → skip, return false.
  const again = archiveSession(file, 's1', '2026-07-03', env);
  assert.equal(again, false);
});

test('archiveSession rewrites when transcript is touched newer, and gz reflects the update', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [
    userLine('첫 번째 요청'),
  ]);

  const first = archiveSession(file, 's1', '2026-07-03', env);
  assert.equal(first, true);
  const gz = archivePath(env, '2026-07-03', 's1');
  const rawFirst = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  assert.ok(rawFirst.includes('첫 번째 요청'));
  assert.ok(!rawFirst.includes('두 번째 요청'));

  // Simulate the transcript being appended to (e.g. more of the conversation happened)
  // after the first archive was written, then make its mtime newer than the archive.
  fs.appendFileSync(file, userLine('두 번째 요청') + '\n');
  const future = new Date(Date.now() + 10_000);
  fs.utimesSync(file, future, future);

  const second = archiveSession(file, 's1', '2026-07-03', env);
  assert.equal(second, true, 'archiveSession should rewrite when transcript is newer than existing archive');

  const rawSecond = zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8');
  assert.ok(rawSecond.includes('첫 번째 요청'));
  assert.ok(rawSecond.includes('두 번째 요청'), 'newly appended request should appear after re-archive');
});

test('config.archive=false: sweep does not create archives', () => {
  const { env } = tmpEnv();
  writeTranscript(env, 's1', [
    userLine('요청1'),
    assistantToolUse('Edit', { file_path: 'D:\\a.java' }),
  ]);
  sweepProjects(env, { sinceMs: 0 });
  assert.ok(findDigest('s1', '2026-07-03', env));
  assert.ok(!fs.existsSync(archivePath(env, '2026-07-03', 's1')));
});

test('config.archive=true: sweep archives work-kind sessions only', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'), JSON.stringify({ archive: true }));

  writeTranscript(env, 'work1', [
    userLine('버그 고쳐줘', { sessionId: 'work1' }),
    assistantToolUse('Edit', { file_path: 'D:\\a.java' }, { sessionId: 'work1' }),
  ]);
  writeTranscript(env, 'qa1', [
    userLine('질문만 했어요', { sessionId: 'qa1' }),
  ]);

  sweepProjects(env, { sinceMs: 0 });

  assert.ok(fs.existsSync(archivePath(env, '2026-07-03', 'work1')), 'work session should be archived');
  assert.ok(!fs.existsSync(archivePath(env, '2026-07-03', 'qa1')), 'qa session should not be archived');
});

test('archive-read CLI: writes archive then reads it back as JSONL', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [
    userLine('아카이브 왕복 테스트'),
    assistantText('응답 텍스트'),
  ]);
  archiveSession(file, 's1', '2026-07-03', env);

  const r = run(env, 'archive-read', '--session', 's1', '--day', '2026-07-03');
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.some((l) => l.role === 'user' && l.text === '아카이브 왕복 테스트'));
  assert.ok(lines.some((l) => l.role === 'assistant' && l.text === '응답 텍스트'));
});

test('archive-read CLI: missing archive returns ok:false with exit 0', () => {
  const { env } = tmpEnv();
  const r = run(env, 'archive-read', '--session', 'nope', '--day', '2026-07-03');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: false, reason: 'not archived' });
});

test('kind --value work archives the session immediately when config.archive is true', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'), JSON.stringify({ archive: true }));

  writeTranscript(env, 'qa1', [
    userLine('질문만 했어요', { sessionId: 'qa1' }),
  ]);
  // qa-classified session lands in the journal via a normal sweep (kind=qa, no archive yet).
  sweepProjects(env, { sinceMs: 0 });
  assert.ok(findDigest('qa1', '2026-07-03', env));
  assert.ok(!fs.existsSync(archivePath(env, '2026-07-03', 'qa1')));

  // User later reclassifies it as work via the CLI.
  const r = run(env, 'kind', '--session', 'qa1', '--day', '2026-07-03', '--value', 'work');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true });

  assert.ok(fs.existsSync(archivePath(env, '2026-07-03', 'qa1')), 'reclassified session should be archived immediately');
});
