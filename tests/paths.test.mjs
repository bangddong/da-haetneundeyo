import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dataDir, claudeConfigDirs, projectsDirs, journalDir } from '../lib/paths.mjs';
import { tmpEnv } from './helpers.mjs';

test('DHND_DATA_DIR overrides data dir', () => {
  const { env } = tmpEnv();
  assert.equal(dataDir(env), env.DHND_DATA_DIR);
  assert.equal(journalDir(env), path.join(env.DHND_DATA_DIR, 'journal'));
});

test('CLAUDE_CONFIG_DIR supports comma-separated list', () => {
  const env = { CLAUDE_CONFIG_DIR: 'C:\\a, C:\\b' };
  assert.deepEqual(claudeConfigDirs(env), ['C:\\a', 'C:\\b']);
  assert.deepEqual(projectsDirs(env), [path.join('C:\\a', 'projects'), path.join('C:\\b', 'projects')]);
});

test('falls back to ~/.claude when CLAUDE_CONFIG_DIR unset', () => {
  const dirs = claudeConfigDirs({});
  assert.equal(dirs.length, 1);
  assert.ok(dirs[0].endsWith('.claude'));
});
