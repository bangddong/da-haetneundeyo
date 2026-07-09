---
name: recall
description: Search past work. Use for retrospective questions like "how did I do that", "when did I do X", "recall", "그때 그거 어떻게 했지", "언제 했지".
---

# Past-work search (recall)

**Answer in `config.language` (default `ko`).**

1. Extract keywords from the question and search the journal (run each keyword separately):
   Before running, replace `~` with the absolute home path (`~` does not expand inside quotes): bash → `$HOME`,
   PowerShell → `$env:USERPROFILE`.
   ```bash
   rg -i "<keyword>" "$HOME/.claude/da-haetneundeyo/journal/" --no-heading
   ```
2. Parse only the matched digest lines and show an **index first** (one line per item: date, project, summary,
   commit hash).
3. Only when the user wants details for a specific item:
   - Commit details: `git -C <project> show --stat <hash>`
   - Session transcript: excerpt only the relevant part from the matching `sessionId`.jsonl under
     `~/.claude/projects/` (do not load the whole file).
   - To continue the work, point them to `claude --resume <sessionId>`.
4. If there are no results, retry step by step (once per step; move on if still nothing):
   ① Retry once with EN/KO cross terms / synonyms (e.g. "타임아웃" ↔ "timeout", "로그인" ↔ "login").
   ② Retry with commit-message / filename-oriented keywords (class names, partial file names — terms actually
      likely used in code/commits, not the user's conversational phrasing).
   ③ If there's a time hint ("last month", "around June"), query only that month's journal files
      (`journal/YYYY/MM/*.jsonl`) instead of the whole journal.
   If still nothing after all steps, say so honestly (don't fabricate).

## Transcript fallback order for detail lookups

When showing session detail (the original text), try in this order:

1. The original `sessionId`.jsonl under `~/.claude/projects/` (present within the transcript retention period —
   30 days by default).
2. If the original is gone (30+ days elapsed, etc.), try the archive:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" archive-read --session <ID> --day <D>
   ```
   `{"ok":false,...}` means there's no archive either (archiving is opt-in, off by default).
3. If neither original nor archive exists, reconstruct only "what was done" from the journal's `commits`
   field via `git show` (commit diff). In this case, tell the user that the "how/why" of the solution process
   cannot be recovered.
