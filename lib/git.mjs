import { execFileSync } from 'node:child_process';

const GIT_OPTS = { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] };

export function repoAuthorEmail(cwd) {
  try {
    // Guard: outside a repo, `git config user.email` would still resolve the
    // global value — but a non-repo cwd has no author to attribute.
    execFileSync('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], GIT_OPTS);
    const out = execFileSync('git', ['-C', cwd, 'config', 'user.email'], GIT_OPTS).trim();
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
    const out = execFileSync('git', args, GIT_OPTS);
    return out.split('\n').filter(Boolean).map((l) => {
      const idx = l.indexOf('\t');
      return { hash: l.slice(0, idx), subject: l.slice(idx + 1) };
    });
  } catch {
    return null;
  }
}
