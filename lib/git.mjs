import { execFileSync } from 'node:child_process';

export function commitsSince(cwd, sinceIso, untilIso) {
  try {
    const args = ['-C', cwd, 'log', `--since=${sinceIso}`, '--format=%h%x09%s'];
    if (untilIso) args.splice(4, 0, `--until=${untilIso}`);
    const out = execFileSync(
      'git', args,
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
