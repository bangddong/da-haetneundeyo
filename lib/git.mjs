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
    // %ad(author date, --date=short → YYYY-MM-DD)를 함께 뽑는다. 주 경계를 넘긴 세션이
    // 여러 보고 기간에 걸칠 때, 보고서 스킬이 커밋을 해당 기간으로 필터링하는 데 쓴다 (#19).
    const args = ['-C', cwd, 'log', '--no-merges', '--date=short', `--since=${sinceIso}`, '--format=%h%x09%ad%x09%s'];
    if (untilIso) args.push(`--until=${untilIso}`);
    if (authorEmail) args.push(`--author=${authorEmail}`);
    const out = execFileSync('git', args, GIT_OPTS);
    return out.split('\n').filter(Boolean).map((l) => {
      // 앞의 두 탭만 구분자로 쓴다(제목에 탭이 있어도 안전).
      const t1 = l.indexOf('\t');
      const t2 = l.indexOf('\t', t1 + 1);
      return { hash: l.slice(0, t1), date: l.slice(t1 + 1, t2), subject: l.slice(t2 + 1) };
    });
  } catch {
    return null;
  }
}
