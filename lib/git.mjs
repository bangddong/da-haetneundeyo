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
    // --shortstat으로 변경 규모(파일 수·추가/삭제 라인)도 수집한다 — 보고서 실적 문장의
    // 정량 근거로 쓰인다 (#1). 출력은 "커밋 줄 → 빈 줄 → 공백으로 시작하는 stat 줄" 반복이며
    // 빈 커밋은 stat 줄이 없다.
    const args = ['-C', cwd, 'log', '--no-merges', '--date=short', `--since=${sinceIso}`, '--format=%h%x09%ad%x09%s', '--shortstat'];
    if (untilIso) args.push(`--until=${untilIso}`);
    if (authorEmail) args.push(`--author=${authorEmail}`);
    const out = execFileSync('git', args, GIT_OPTS);
    const commits = [];
    for (const l of out.split('\n')) {
      if (!l.trim()) continue;
      const stat = l.match(/^\s+(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
      if (stat) {
        const last = commits[commits.length - 1];
        if (last) {
          last.files = Number(stat[1]);
          last.insertions = Number(stat[2] ?? 0);
          last.deletions = Number(stat[3] ?? 0);
        }
        continue;
      }
      // 앞의 두 탭만 구분자로 쓴다(제목에 탭이 있어도 안전).
      const t1 = l.indexOf('\t');
      const t2 = l.indexOf('\t', t1 + 1);
      if (t1 === -1 || t2 === -1) continue;
      commits.push({ hash: l.slice(0, t1), date: l.slice(t1 + 1, t2), subject: l.slice(t2 + 1), files: 0, insertions: 0, deletions: 0 });
    }
    return commits;
  } catch {
    return null;
  }
}
