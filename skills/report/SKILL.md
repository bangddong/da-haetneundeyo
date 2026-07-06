---
name: report
description: 작업 일지로 주간/월간 업무 보고서 초안(md/docx)을 생성한다. "주간보고", "월간보고", "report weekly/monthly" 요청 시 사용.
---

# 업무 보고서 생성 (report)

## 인자
- `weekly`(기본) | `monthly`, 선택적 `--format docx`, 선택적 기간(예: `2026-W27`, `2026-06`).
- `setup` 서브커맨드는 아래 "설정" 참고.

## 생성 절차

1. 기간 계산: weekly = 이번 주 월~일(오늘 포함), monthly = 이번 달 1일~말일. 명시 기간이 있으면 그것을 사용.
2. 일지 로드 (sweep 자동 포함):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO>
   ```
3. `~/.claude/da-haetneundeyo/config.json`을 읽어 `projectMap`, `language`, `docxTemplate`을 확인한다.
4. 템플릿 선택: `~/.claude/da-haetneundeyo/templates/`에 사용자 md 템플릿이 있으면 우선, 없으면 `${CLAUDE_PLUGIN_ROOT}/templates/<weekly|monthly>-<language>.md`.
5. 템플릿의 HTML 주석 지시에 따라 섹션을 작성한다. 원칙:
   - kind=qa 제외. 항목마다 근거(커밋 해시·세션 날짜) 병기.
   - requests가 모호해 커밋·파일 경로로 추정한 항목은 끝에 `⚠️추정` 마커.
   - 커밋 없는 work 세션·미해결 요청 → "차주(차월) 계획" 초안.
6. 결과를 `~/.claude/da-haetneundeyo/reports/<기간>-<weekly|monthly>.md`로 저장하고 화면에도 출력한다.
   - `<기간>` 규칙: weekly는 ISO 주차(`2026-W27`), monthly는 `YYYY-MM`(`2026-07`). 명시 기간 인자가 있으면 그대로 사용.
7. 마지막에 `⚠️추정 항목 N건 — 해당 항목만 확인 후 제출하세요.`를 안내한다.

## --format docx

8. config의 `docxTemplate`이 없으면: md만 저장하고 "회사 양식을 등록하려면 `/report setup`"을 안내.
9. 있으면 데이터 JSON을 다음 규칙으로 만든다. `docxTemplate.fields`는 `{ "docx플레이스홀더": "섹션키" }` 맵이다:
   - 데이터 JSON의 **키 = 플레이스홀더 이름 그대로**, 값 = 해당 섹션키(achievements/next_plans/notes)로 작성한 섹션 텍스트.
   - 예: fields가 `{ "금주실적": "achievements", "차주계획": "next_plans" }`이면 데이터 JSON은
     `{ "금주실적": "<achievements 섹션 텍스트>", "차주계획": "<next_plans 섹션 텍스트>" }`.
   - ⚠️ docxtemplater는 매칭되지 않은 태그를 **오류 없이 빈 문자열로** 치환한다. 데이터 JSON 키가 양식의 `{태그}` 이름과 정확히 일치하는지 내보내기 전에 확인할 것.
   - 데이터 JSON은 `~/.claude/da-haetneundeyo/reports/.tmp-docx-data.json`에 UTF-8(BOM 없이)로 쓰고, 성공 후 삭제한다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/export-docx.cjs" --template <docxTemplate.path> --data <임시.json> --out <reports/기간.docx>
   ```
   stdout은 `{"ok":true,"out":"<생성 경로>"}` 형태다. `ok:true` 확인 후 `out` 경로를 사용자에게 안내한다.

## 설정 (/report setup)

1. 사용자에게 회사 양식 .docx 경로를 받아 `~/.claude/da-haetneundeyo/templates/`로 복사.
2. 양식 안에 `{금주실적}`처럼 중괄호 플레이스홀더를 넣도록 안내하고, 각 플레이스홀더가 어떤 섹션(achievements/next_plans/notes)인지 물어 `config.json`의 `docxTemplate: { path, fields }`에 저장.
3. `projectMap`도 함께 확인: 저널에 등장한 project 경로별로 업무명을 제안하고 사용자가 수정하면 저장.
