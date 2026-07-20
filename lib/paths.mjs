import os from 'node:os';
import path from 'node:path';

export function claudeConfigDirs(env = process.env) {
  const raw = env.CLAUDE_CONFIG_DIR;
  if (raw) return raw.split(',').map((p) => p.trim()).filter(Boolean);
  return [path.join(os.homedir(), '.claude')];
}

export function projectsDirs(env = process.env) {
  return claudeConfigDirs(env).map((d) => path.join(d, 'projects'));
}

export function dataDir(env = process.env) {
  return env.DHND_DATA_DIR || path.join(os.homedir(), '.claude', 'da-haetneundeyo');
}

export const journalDir = (env) => path.join(dataDir(env), 'journal');
export const statePath = (env) => path.join(dataDir(env), 'state.json');
export const configPath = (env) => path.join(dataDir(env), 'config.json');
