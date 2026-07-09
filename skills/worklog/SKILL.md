---
name: worklog
description: View and refine today's / this week's work journal. Use for "what did I do today", "work journal", "worklog", "오늘 뭐 했지", "작업 일지" requests.
---

# Work journal (worklog)

**Write output in `config.language` (default `ko`).** Labels and markers below follow this language.

## View

1. Decide the period: no argument → today; "week" → this week (Mon–Sun); "지난주"/"last week" → the previous
   ISO week (Mon–Sun); a date (YYYY-MM-DD) or a range → use as-is. Early in the week (Mon/Tue), if "week"
   returns only 1–2 items, add a one-line hint: "to see last week, ask for '지난주' / 'last week'".
2. Fetch the journal (sweep is included automatically, so missed sessions are recovered):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO>
   ```
   Filter with `--kind work|qa` if needed (default = no `--kind` = all).
3. Output format (chronological; show projects by their `projectMap` name from config.json). Use the row
   matching `config.language`:

   `ko`:
   ```
   📓 7/3 (금) — 세션 N건 (작업 N · 질의 N), 커밋 N건
   · [프로젝트 HH:MM-HH:MM] 요약 한 줄 → 커밋해시 (kind=work)
   · [프로젝트 HH:MM-HH:MM] 요약 한 줄 (질의 — 보고서 제외)
   ```
   `en`:
   ```
   📓 7/3 (Fri) — N sessions (N work · N q&a), N commits
   · [project HH:MM-HH:MM] one-line summary → commitHash (kind=work)
   · [project HH:MM-HH:MM] one-line summary (q&a — excluded from reports)
   ```
   - Build the one-line summary from requests · filesEdited · commits combined; don't mix in guesses.
   - For a `kind=work` item with empty `commits`, mark it: `ko` → `⏳ 미완료 추정`, `en` → `⏳ likely incomplete`.
   - If `note` exists, use the note instead of the summary.
   - `range` also returns **long sessions** that started before the queried period and continued into it. Their
     date header is based on the session start, so it may show a date earlier than the queried period — this is
     normal; label it in one line (e.g. "session continued from ○○").

## Refine (when the user wants a note / reclassification)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" note --session <ID> --day <YYYY-MM-DD> --text "<note>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" kind --session <ID> --day <YYYY-MM-DD> --value <work|qa>
```
After confirming the return `{"ok":true}`, re-show only the updated item.
