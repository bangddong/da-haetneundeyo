import { execFileSync } from 'node:child_process';

export function repoAuthorEmail(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'config', '--local', 'user.email'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function commitsSince(cwd, sinceIso, untilIso, authorEmail) {
  try {
    const args = ['-C', cwd, 'log', '--no-merges', `--since=${sinceIso}`, '--format=%h%x09%s'];
    if (untilIso) args.push(`--until=${untilIso}`);
    if (authorEmail) args.push(`--author=${authorEmail}`);
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
