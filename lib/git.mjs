import { execFileSync } from 'node:child_process';

export function commitsSince(cwd, sinceIso) {
  try {
    const out = execFileSync(
      'git', ['-C', cwd, 'log', `--since=${sinceIso}`, '--format=%h%x09%s'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split('\n').filter(Boolean).map((l) => {
      const idx = l.indexOf('\t');
      return { hash: l.slice(0, idx), subject: l.slice(idx + 1) };
    });
  } catch {
    return null;
  }
}
