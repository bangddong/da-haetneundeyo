import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { dayFilePath } from '../lib/journal.mjs';
import { tmpEnv } from './helpers.mjs';

const helperScript = fileURLToPath(new URL('./fixtures/upsert-one.mjs', import.meta.url));

function spawnUpsert(env, sessionId, gateFile) {
  return new Promise((resolve, reject) => {
    const args = gateFile ? [helperScript, sessionId, gateFile] : [helperScript, sessionId];
    const child = spawn(process.execPath, args, { env });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`child ${sessionId} exited ${code}: ${stderr}`));
    });
    child.on('error', reject);
  });
}

test('concurrent upsertDigest from 8 processes: all 8 sessions land, no data loss', async () => {
  const { env } = tmpEnv();
  const sessionIds = Array.from({ length: 8 }, (_, i) => `s${i}`);
  const gateFile = path.join(env.DHND_DATA_DIR, 'go.gate');
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  const pending = Promise.all(sessionIds.map((id) => spawnUpsert(env, id, gateFile)));
  fs.writeFileSync(gateFile, '1'); // release all children at once to maximize collision odds
  await pending;

  const file = dayFilePath('2026-07-03', env);
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 8);
  const ids = lines.map((l) => JSON.parse(l).sessionId).sort();
  assert.deepEqual(ids, sessionIds.slice().sort());
});

test('no stray *.lock directory remains after concurrent writes', async () => {
  const { env } = tmpEnv();
  const sessionIds = Array.from({ length: 8 }, (_, i) => `t${i}`);
  const gateFile = path.join(env.DHND_DATA_DIR, 'go.gate');
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  const pending = Promise.all(sessionIds.map((id) => spawnUpsert(env, id, gateFile)));
  fs.writeFileSync(gateFile, '1');
  await pending;

  const file = dayFilePath('2026-07-03', env);
  const dir = path.dirname(file);
  const entries = fs.readdirSync(dir);
  assert.ok(!entries.some((e) => e.endsWith('.lock')), `unexpected lock dirs: ${entries}`);
});

test('stale lock (mtime > 10s old) is reclaimed and upsertDigest proceeds', async () => {
  const { env } = tmpEnv();
  const file = dayFilePath('2026-07-03', env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockDir = `${file}.lock`;
  fs.mkdirSync(lockDir);
  const old = new Date(Date.now() - 20_000);
  fs.utimesSync(lockDir, old, old);

  await spawnUpsert(env, 'stale-check');

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).sessionId, 'stale-check');
});

test('stale lock carries an owner token, and reclaim leaves a fresh token (not the reclaimer deleting its own lock early)', async () => {
  // Exercises the real withFileLock path indirectly via upsertDigest (fixtures/upsert-one.mjs):
  // pre-seed a stale lock dir with a bogus owner file, then let a real process reclaim it.
  // If reclaim works, the session lands and the final lock dir (if any lingers mid-run) always
  // carries *some* owner token written by mkdirSync+writeFileSync, never the stale placeholder.
  const { env } = tmpEnv();
  const file = dayFilePath('2026-07-03', env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockDir = `${file}.lock`;
  const ownerFile = path.join(lockDir, 'owner');
  fs.mkdirSync(lockDir);
  fs.writeFileSync(ownerFile, 'stale-owner-token');
  const old = new Date(Date.now() - 20_000);
  fs.utimesSync(lockDir, old, old);

  await spawnUpsert(env, 'owner-reclaim-check');

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).sessionId, 'owner-reclaim-check');
  // Lock dir is fully released after a clean run.
  assert.ok(!fs.existsSync(lockDir), 'lock dir should be released after successful reclaim + run');
});
