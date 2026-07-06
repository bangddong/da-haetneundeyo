import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findDigest } from '../lib/journal.mjs';
import { userLine } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/hook-stop.mjs', import.meta.url));

function runHook(env, payload) {
  return spawnSync(process.execPath, [script], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env, encoding: 'utf8',
  });
}

test('valid payload captures session and exits 0', () => {
  const { env } = tmpEnv();
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 's1.jsonl');
  fs.writeFileSync(file, userLine('훅 테스트') + '\n');
  const r = runHook(env, {
    hook_event_name: 'Stop', session_id: 's1', transcript_path: file, cwd: 'D:\\p',
  });
  assert.equal(r.status, 0);
  assert.ok(findDigest('s1', '2026-07-03', env));
});

test('broken stdin JSON still exits 0', () => {
  const { env } = tmpEnv();
  const r = runHook(env, '{not json');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /da-haetneundeyo/);
});

test('missing transcript file still exits 0', () => {
  const { env } = tmpEnv();
  const r = runHook(env, {
    hook_event_name: 'Stop', session_id: 'sx', transcript_path: 'C:\\nope\\missing.jsonl',
  });
  assert.equal(r.status, 0);
});

test('exits 0 via fail-safe when stdin never closes', async () => {
  const { env } = tmpEnv();
  const child = spawn(process.execPath, [script], {
    env: { ...env, DHND_HOOK_TIMEOUT_MS: '500' },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.write('{"hook_event_name":"Stop"');   // no end(), no EOF
  const code = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('hook did not exit within 5s')), 5000);
    child.on('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  assert.equal(code, 0);
});
