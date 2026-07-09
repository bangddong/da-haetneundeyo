---
name: worklog
description: 오늘/이번 주 작업 일지를 조회하고 항목을 보완한다. 사용자가 "오늘 뭐 했지", "작업 일지", "worklog"를 요청할 때 사용.
---

# 작업 일지 (worklog)

## 조회

1. 기간 결정: 인자가 없으면 오늘, "week"면 이번 주 월~일, "지난주"/"last week"면 직전 ISO 주차(월~일). 날짜(YYYY-MM-DD)나 기간이 오면 그대로. 주 초(월·화)에 "week" 결과가 1~2건뿐이면 "지난주를 보려면 '지난주'라고 요청하세요"를 한 줄 안내.
2. 다음을 실행해 일지를 가져온다 (sweep이 자동 포함되어 놓친 세션도 회수된다):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO>
   ```
   필요하면 `--kind work|qa`로 필터링할 수 있다 (기본은 `--kind` 생략 = 전체).
3. 출력 형식 (시간순, 프로젝트는 config.json의 projectMap 이름으로 표시):
   ```
   📓 7/3 (금) — 세션 N건 (작업 N · 질의 N), 커밋 N건
   · [프로젝트 HH:MM-HH:MM] 요약 한 줄 → 커밋해시 (kind=work)
   · [프로젝트 HH:MM-HH:MM] 요약 한 줄 (질의 — 보고서 제외)
   ```
   - 요약 한 줄은 requests·filesEdited·commits를 종합해 만들되 추측을 섞지 말 것.
   - `kind=work`인데 `commits`가 빈 항목에는 `⏳ 미완료 추정` 표시.
   - `note`가 있으면 요약 대신 note를 우선 사용.
   - `range`는 조회 기간 이전에 시작해 기간 안까지 이어진 **장기 세션**도 반환한다. 이때 날짜 헤더는
     세션 시작일 기준이라 조회 기간보다 앞선 날짜로 보일 수 있다 — 정상이며, "○○부터 이어진 세션"처럼
     한 줄로 표기하면 된다.

## 보완 (사용자가 메모/재분류를 원할 때)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" note --session <ID> --day <YYYY-MM-DD> --text "<메모>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" kind --session <ID> --day <YYYY-MM-DD> --value <work|qa>
```
반환 `{"ok":true}` 확인 후 갱신된 항목만 다시 보여준다.
