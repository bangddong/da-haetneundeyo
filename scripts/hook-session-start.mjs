#!/usr/bin/env node
import fs from 'node:fs';
import { statePath } from '../lib/paths.mjs';
import { sweepProjects } from '../lib/capture.mjs';

try {
  const firstRun = !fs.existsSync(statePath(process.env));
  if (firstRun) {
    sweepProjects(process.env, { sinceMs: Date.now() - 7 * 24 * 3600_000 });
    const msg = [
      '[da-haetneundeyo] "다 했는데요?" 플러그인이 처음 실행되었습니다. 최근 7일 세션을 작업 일지에 반영했습니다.',
      '프라이버시 고지: 이후 모든 세션의 요청 내용(원문 프롬프트 포함)·수정 파일·커밋 정보가 ~/.claude/da-haetneundeyo 에 로컬 저장됩니다. 외부 전송은 없으며, 디렉토리 삭제로 완전 제거됩니다 (README 프라이버시 섹션 참고).',
      '사용자에게 다음을 안내하세요: 백필 전에는 일지와 보고서가 최근 7일만 커버합니다. 지난 30일을 반영하려면',
      `"node \\"${process.env.CLAUDE_PLUGIN_ROOT ?? '<plugin>'}/scripts/journal-cli.mjs\\" backfill --days 30" 실행 (토큰 소모 없음, 최대 1-2분).`,
      '원하는지 한 번만 물어보고, 이후 "오늘 뭐 했지?", "주간보고 만들어줘" 같은 자연어 사용법을 소개하세요.',
    ].join(' ');
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: msg },
    }) + '\n');
  } else {
    sweepProjects(process.env);
  }
} catch (err) {
  console.error(`[da-haetneundeyo] session-start skipped: ${err?.message ?? err}`);
}
process.exit(0);
