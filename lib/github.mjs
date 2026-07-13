import path from 'node:path';
import { execFileSync } from 'node:child_process';

const GH_OPTS = { encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] };

// 커밋 하나가 속한 PR 목록을 gh CLI로 조회한다. {owner}/{repo} 플레이스홀더는 gh가 cwd의
// origin에서 해석한다. gh 미설치·미인증·비 GitHub 저장소·404 등 모든 실패는 null — 호출부는
// 조용히 스킵한다 (opt-in 부가 정보라 실패가 캡처/보고를 막으면 안 됨).
export function prsForCommit(cwd, hash, exec = execFileSync) {
  try {
    const out = exec('gh', ['api', `repos/{owner}/{repo}/commits/${hash}/pulls`], { ...GH_OPTS, cwd });
    const arr = JSON.parse(out);
    if (!Array.isArray(arr)) return null;
    return arr.map((p) => ({ number: p.number, state: p.state, merged: Boolean(p.merged_at) }));
  } catch {
    return null;
  }
}

// gh api 호출 폭주 방지 상한. 주간 보고 기준 커밋 수십 개 수준이라 넉넉하며, 초과분은
// stderr로 몇 건이 생략됐는지 알린다 (조용한 절단 금지 원칙).
const MAX_LOOKUPS = 50;

// 저널 엔트리들의 커밋에 PR 정보를 붙인다. 커밋의 repo(basename)와 일치하는 cwd를
// cwdWindows에서 찾아 그 디렉토리에서 gh를 실행한다. 반환: { prs: {hash: [...]}, skipped }.
export function collectPrOutcomes(entries, prsFn = prsForCommit) {
  const seen = new Map(); // hash -> cwd
  for (const e of entries) {
    if (e.kind !== 'work') continue;
    const cwds = Object.keys(e.cwdWindows ?? {});
    for (const c of e.commits ?? []) {
      if (seen.has(c.hash)) continue;
      // path.win32.basename은 '/'와 '\\' 구분자를 모두 처리한다 — 저널의 cwd는 기록된 머신의
      // 네이티브 경로(Windows면 백슬래시)라, POSIX에서 조회해도 안전하게 잘라야 한다.
      const cwd = cwds.find((d) => path.win32.basename(d) === c.repo);
      if (cwd) seen.set(c.hash, cwd);
    }
  }
  const prs = {};
  let calls = 0;
  let skipped = 0;
  for (const [hash, cwd] of seen) {
    if (calls >= MAX_LOOKUPS) { skipped += 1; continue; }
    calls += 1;
    const found = prsFn(cwd, hash);
    if (found && found.length > 0) prs[hash] = found;
  }
  if (skipped > 0) console.error(`[da-haetneundeyo] pr-outcomes: ${skipped} commit(s) skipped (lookup cap ${MAX_LOOKUPS})`);
  return { prs, skipped };
}
