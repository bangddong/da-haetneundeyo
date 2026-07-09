#!/usr/bin/env node
import fs from 'node:fs';
import { statePath } from '../lib/paths.mjs';
import { sweepProjects } from '../lib/capture.mjs';

try {
  const firstRun = !fs.existsSync(statePath(process.env));
  if (firstRun) {
    sweepProjects(process.env, { sinceMs: Date.now() - 7 * 24 * 3600_000 });
    // additionalContext is an instruction to Claude, not text shown verbatim — so it's written in English
    // and tells Claude to relay it in the user's language. Keeps the plugin free of hardcoded-locale output.
    const msg = [
      '[da-haetneundeyo] The "da-haetneundeyo" plugin ran for the first time. Recent 7-day sessions were added to the work journal.',
      'Privacy notice: from now on, every session\'s request text (including raw prompts), edited files, and commit info are stored locally under ~/.claude/da-haetneundeyo. Nothing is sent externally; deleting the directory removes it completely (see the README Privacy section).',
      'Present the following to the user, in the user\'s language: before backfill, the journal and reports cover only the last 7 days. To include the last 30 days, run',
      `"node \\"${process.env.CLAUDE_PLUGIN_ROOT ?? '<plugin>'}/scripts/journal-cli.mjs\\" backfill --days 30" (no token cost, up to 1-2 min).`,
      'Ask once whether they want this, then introduce natural-language usage like "what did I do today?" / "make a weekly report".',
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
