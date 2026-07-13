---
name: report
description: Generate weekly/monthly work-report drafts (md/docx) from the work journal. Use for "weekly report", "monthly report", "주간보고", "월간보고", "report weekly/monthly" requests.
---

# Work report generation (report)

## Arguments
- `weekly` (default) | `monthly`, optional `--format docx`, optional period (e.g. `2026-W27`, `2026-06`).
- The `setup` subcommand is covered under "Setup" below.

## Localization

**Write the report body in `config.language` (default `ko`).** All section text, achievement sentences,
and plan items follow this language. The markers below are also language-dependent — use the row that
matches `config.language`:

| Meaning | `ko` | `en` |
|---|---|---|
| Inferred/guessed item | `⚠️추정` | `⚠️assumed` |
| Work done but not yet committed | `⏳ 커밋 대기` | `⏳ pending commit` |
| Verification footer | `⚠️추정 항목 N건 — 해당 항목만 확인 후 제출하세요.` | `N item(s) marked ⚠️assumed — verify only those before submitting.` |

The bundled templates already carry the correct marker per language (`⚠️추정` in `*-ko.md`,
`⚠️assumed` in `*-en.md`); keep the report body consistent with the chosen template's marker.

## Procedure

1. Compute the period:
   - If an explicit period is given (`2026-W27`, `2026-06`, etc.), use it.
   - "지난주"/"last week" → the previous ISO week; "지난달"/"last month" → the previous month.
   - Unspecified weekly: default to this week (Mon–Sun). **But if today is Monday/Tuesday there's little to
     report for this week yet, so propose last week by default** and confirm in one line (e.g. "Build it for
     last week (2026-W27, 6/29–7/5)?").
   - Unspecified monthly: default to this month. But if today is the 1st–3rd, propose last month the same way.
2. Load the journal (sweep is automatic):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO>
   ```
   - `range` also returns **sessions that spanned the period boundary** (started before the window, ended
     inside it). Such a session straddles multiple reporting periods, so base its achievements **only on
     commits whose `commits[].date` (YYYY-MM-DD) falls within the reporting period** — do not put
     out-of-period commits in this period's report (they may already appear in the previous period's report,
     causing duplication). For older entries without `commits[].date`, judge by the session end date.
3. Read `~/.claude/da-haetneundeyo/config.json` for `projectMap`, `language`, `docxTemplate`, `reportsDir`.
   The report output location (`<reportsDir>` below) is `config.reportsDir` if set, otherwise the default
   `~/.claude/da-haetneundeyo/reports/`.
4. Template selection: prefer a user md template in `~/.claude/da-haetneundeyo/templates/`, otherwise
   `${CLAUDE_PLUGIN_ROOT}/templates/<weekly|monthly>-<language>.md`.
5. Write the sections per the template's HTML-comment instructions. Principles:
   - Exclude `kind=qa`. Cite evidence (commit hash · session date) for every item.
   - `commits[]` may carry size stats (`files`/`insertions`/`deletions`). Use them to (a) rank which
     work leads each project section (bigger change ≠ always more important, but it's a signal) and
     (b) optionally annotate scale on major items, e.g. "(3 files, +120/−45)". Skip the annotation for
     trivial sizes; never fabricate numbers when the fields are absent (pre-existing entries).
   - Append the inferred marker (see Localization table) to any item guessed from commits/file paths because
     the request was ambiguous.
   - `work` sessions with no commits and unresolved requests → draft into the "next-period plan".

   Achievement-sentence few-shot (illustrative). **These illustrate the transformation, not the
   output language** — write your actual output in `config.language`:
   ```
   Example 1 — commit is the evidence (ko output):
     requests: ["방금 커밋한 거 하나 스테이지에서 내리려면?"] + commits: [a1b2c3d "fix: 주문 취소 시 재고 롤백 누락 수정"]
     → "주문 취소 트랜잭션에서 재고 롤백이 누락되던 결함 수정 — 예외 발생 시 롤백 처리 보강 (a1b2c3d)"
     (The commit message/files are the substance of the achievement, not the raw request. Don't transcribe the conversational request verbatim.)
   Example 2 — inference required (en output):
     requests: ["continue that thing from yesterday"] + filesEdited: [CommonDialog.tsx] + commits: []
     → "Progressed the common dialog (CommonDialog) improvement — ⏳ pending commit ⚠️assumed"
     (When the request alone can't pin down the work, infer the domain from file paths and always add the inferred marker.)
   ```
6. Save the result to `<reportsDir>/<period>-<weekly|monthly>.md` and also print it to screen.
   - `<period>` rule: weekly = ISO week (`2026-W27`), monthly = `YYYY-MM` (`2026-07`). If an explicit period
     argument was given, use it as-is.
   - Create `<reportsDir>` if it doesn't exist yet.
7. End with the verification footer (see Localization table).

## Edge cases

- **No journal in the period**: say "No records for this period. Check whether a backfill is needed / the
  period." and do NOT create an empty report file.
- **All `kind=qa`**: write "No development achievements to report" in the achievements section, and ask the
  user whether to attach the qa list as reference material.
- **journal-cli exits non-zero**: show the gist printed to stderr to the user as-is, without reshaping it.

## Monthly synthesis strategy

1. After computing the period (the month), find that month's `*-weekly.md` files in `<reportsDir>`.
2. If there are **2 or more**, synthesize primarily from the weekly reports — reuse/merge the already-written
   weekly achievement sentences instead of re-scanning the journal from scratch.
3. Load the journal only for **date ranges the weeklies don't cover** (`--kind work` to exclude qa):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO> --kind work
   ```
4. If there are fewer than 2 weeklies, load the whole month's journal and synthesize as usual.

## Separating personal projects

- Projects whose `projectMap` value in `config.json` is exactly `"(제외)"` are **fully excluded** from the
  report (they appear nowhere — neither achievements nor next-period plan).
- Projects with no `projectMap` mapping (the user hasn't named the work yet) are NOT auto-excluded; instead
  put them in a separate "Other (review before submitting)" section so the user makes the final call on
  whether they count as work.

## --format docx

8. If config has no `docxTemplate`: save md only and point the user to "register a company template with
   `/report setup`".
9. If it exists, build the data JSON by these rules. `docxTemplate.fields` is a `{ "docxPlaceholder": "sectionKey" }` map:
   - The data JSON's **key = the placeholder name exactly**, value = the section text written for that section
     key (achievements/next_plans/notes).
   - Example: if fields is `{ "금주실적": "achievements", "차주계획": "next_plans" }`, the data JSON is
     `{ "금주실적": "<achievements section text>", "차주계획": "<next_plans section text>" }`.
   - ⚠️ docxtemplater replaces unmatched tags with an **empty string, without error**. Before exporting,
     verify the data JSON keys exactly match the `{tag}` names in the template.
   - Write the data JSON to `<reportsDir>/.tmp-docx-data.json` as UTF-8 (no BOM), and delete it after success.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/export-docx.cjs" --template <docxTemplate.path> --data <tmp.json> --out <reportsDir>/<period>.docx
   ```
   stdout is `{"ok":true,"out":"<output path>"}`. After confirming `ok:true`, give the user the `out` path.

## Setup (/report setup)

1. Ask for the company report template (.docx) path and copy it to `~/.claude/da-haetneundeyo/templates/`.
2. Guide the user to put curly-brace placeholders like `{금주실적}` in the template, ask which section
   (achievements/next_plans/notes) each maps to, and save it under `docxTemplate: { path, fields }` in
   `config.json`.
3. Also confirm `projectMap`: propose a work name per project path seen in the journal and save the user's edits.
4. Also ask about the report output location (`reportsDir`). Confirm whether to keep the default
   (`~/.claude/da-haetneundeyo/reports/`) or use another directory, and save it to `reportsDir` in
   `config.json`. **If they pick a cloud auto-sync folder like OneDrive, warn the user that the saved reports
   (which contain work content — achievement sentences, commit summaries, etc.) will be synced as-is.**
