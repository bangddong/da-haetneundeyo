import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-'));
  const env = {
    ...process.env,
    DHND_DATA_DIR: path.join(root, 'data'),
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
  };
  fs.mkdirSync(path.join(root, 'claude', 'projects'), { recursive: true });
  return { root, env };
}
