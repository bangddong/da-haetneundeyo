import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userLine } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/hook-session-start.mjs', import.meta.url));
const run = (env) => spawnSync(process.execPath, [script], { input: '{}', env, encoding: 'utf8' });

test('first run emits onboarding additionalContext and exits 0', () => {
  const { env } = tmpEnv();
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), userLine('첫 세션') + '\n');
  const r = run(env);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(payload.hookSpecificOutput.additionalContext, /backfill/);
  assert.match(payload.hookSpecificOutput.additionalContext, /Privacy notice/);
});

test('second run is silent and exits 0', () => {
  const { env } = tmpEnv();
  run(env);
  const r = run(env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('exits 0 even when projects dir is missing', () => {
  const { env } = tmpEnv();
  fs.rmSync(path.join(env.CLAUDE_CONFIG_DIR, 'projects'), { recursive: true, force: true });
  assert.equal(run(env).status, 0);
});
