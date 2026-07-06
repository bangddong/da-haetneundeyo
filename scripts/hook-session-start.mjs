#!/usr/bin/env node
import fs from 'node:fs';
import { statePath } from '../lib/paths.mjs';
import { sweepProjects } from '../lib/capture.mjs';

try {
  const firstRun = !fs.existsSync(statePath(process.env));
  if (firstRun) {
    sweepProjects(process.env, { sinceMs: Date.now() - 48 * 3600_000 });
    const msg = [
      '[da-haetneundeyo] 다 했는데요? 플러그인이 처음 실행되었습니다.',
      '최근 48시간 세션은 작업 일지에 반영했습니다.',
      '사용자에게 다음을 안내하세요: 지난 30일 세션 기록을 일지로 백필하려면',
      `"node \\"${process.env.CLAUDE_PLUGIN_ROOT ?? '<plugin>'}/scripts/journal-cli.mjs\\" backfill --days 30" 을 실행하면 되며(토큰 소모 없음, 최대 1-2분 소요),`,
      '원하는지 한 번만 물어보세요. 이후 /worklog, /report weekly 를 소개하세요.',
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
