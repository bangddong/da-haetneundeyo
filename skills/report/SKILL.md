---
name: report
description: 작업 일지로 주간/월간 업무 보고서 초안(md/docx)을 생성한다. "주간보고", "월간보고", "report weekly/monthly" 요청 시 사용.
---

# 업무 보고서 생성 (report)

## 인자
- `weekly`(기본) | `monthly`, 선택적 `--format docx`, 선택적 기간(예: `2026-W27`, `2026-06`).
- `setup` 서브커맨드는 아래 "설정" 참고.

## 생성 절차

1. 기간 계산:
   - 명시 기간(`2026-W27`, `2026-06` 등)이 있으면 그것을 사용.
   - "지난주"/"저번주" → 직전 ISO 주차, "지난달"/"저번달" → 직전 월.
   - 기간 미지정 weekly: 기본은 이번 주 월~일. 단, **오늘이 월·화요일이면 이번 주엔 보고할 내용이 거의 없으므로 지난주를 기본으로 제안**하고 한 줄로 확인받는다 (예: "지난주(2026-W27, 6/29~7/5) 기준으로 만들까요?").
   - 기간 미지정 monthly: 기본은 이번 달. 단, 오늘이 1~3일이면 같은 방식으로 지난달을 제안.
2. 일지 로드 (sweep 자동 포함):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO>
   ```
3. `~/.claude/da-haetneundeyo/config.json`을 읽어 `projectMap`, `language`, `docxTemplate`, `reportsDir`을 확인한다.
   보고서 저장 위치(이하 `<reportsDir>`)는 `config.reportsDir`이 설정되어 있으면 그 디렉토리, 없으면
   기본값 `~/.claude/da-haetneundeyo/reports/`를 사용한다.
4. 템플릿 선택: `~/.claude/da-haetneundeyo/templates/`에 사용자 md 템플릿이 있으면 우선, 없으면 `${CLAUDE_PLUGIN_ROOT}/templates/<weekly|monthly>-<language>.md`.
5. 템플릿의 HTML 주석 지시에 따라 섹션을 작성한다. 원칙:
   - kind=qa 제외. 항목마다 근거(커밋 해시·세션 날짜) 병기.
   - requests가 모호해 커밋·파일 경로로 추정한 항목은 끝에 `⚠️추정` 마커.
   - 커밋 없는 work 세션·미해결 요청 → "차주(차월) 계획" 초안.

   실적 문장 변환 few-shot (실사례 기반):
   ```
   예시 1 — 커밋이 근거인 경우:
     requests: ["지금 커밋된거 하나 있는데 이거 다시 스테이지로 내리려면 ?"] + commits: [a1b2c3d "fix: 주문 취소 시 재고 롤백 누락 수정"]
     → "주문 취소 트랜잭션에서 재고 롤백이 누락되던 결함 수정 — 예외 발생 시 롤백 처리 보강 (a1b2c3d)"
     (요청 원문이 아니라 커밋 메시지·파일이 실적의 본체. 대화체 요청을 그대로 옮기지 말 것)
   예시 2 — 추정이 필요한 경우:
     requests: ["어제 그거 이어서"] + filesEdited: [CommonDialog.tsx] + commits: []
     → "공통 다이얼로그(CommonDialog) 개선 작업 진행 — 커밋 대기 ⏳ ⚠️추정"
     (요청만으로 작업 내용을 특정할 수 없으면 파일 경로에서 도메인을 추정하고 반드시 ⚠️추정 표기)
   ```
6. 결과를 `<reportsDir>/<기간>-<weekly|monthly>.md`로 저장하고 화면에도 출력한다.
   - `<기간>` 규칙: weekly는 ISO 주차(`2026-W27`), monthly는 `YYYY-MM`(`2026-07`). 명시 기간 인자가 있으면 그대로 사용.
   - `<reportsDir>`가 아직 없으면 생성한다.
7. 마지막에 `⚠️추정 항목 N건 — 해당 항목만 확인 후 제출하세요.`를 안내한다.

## 엣지케이스

- **기간 내 저널이 없음**: "해당 기간 기록이 없습니다. 백필 여부/기간을 확인하세요"라고 안내하고, 빈 보고서 파일을 만들지 않는다.
- **전부 kind=qa**: 실적 섹션에는 "보고할 개발 실적 없음"이라고 쓰고, qa 목록을 참고 자료로 첨부할지 사용자에게 물어본다.
- **journal-cli가 exit≠0**: stderr에 찍힌 요지를 가공하지 말고 사용자에게 그대로 보여준다.

## monthly 합성 전략

1. 기간(해당 월) 산출 후, `<reportsDir>`에서 그 달의 `*-weekly.md` 파일을 찾는다.
2. **2개 이상**이면 주간보고들을 1차 재료로 삼아 합성한다 — 저널을 처음부터 다시 훑지 않고 이미 작성된
   주간 실적 문장을 재사용/통합한다.
3. 저널은 **주간보고가 커버하지 않는 날짜 구간만** 보충 로드한다(`--kind work`로 qa 제외):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO> --kind work
   ```
4. 주간보고가 2개 미만이면 기존 방식대로 월 전체 저널을 로드해 합성한다.

## 개인 프로젝트 분리

- `config.json`의 `projectMap`에서 값이 정확히 `"(제외)"`인 프로젝트는 **보고서에서 완전히 제외**한다
  (실적/차주계획 어디에도 등장시키지 않음).
- `projectMap`에 매핑이 없는(사용자가 아직 업무명을 지정하지 않은) 프로젝트는 무조건 제외하지 말고,
  "기타 (제출 시 제외 검토)" 섹션으로 분리해 별도로 보여준다 — 업무성 여부를 사용자가 최종 판단하게 한다.

## --format docx

8. config의 `docxTemplate`이 없으면: md만 저장하고 "회사 양식을 등록하려면 `/report setup`"을 안내.
9. 있으면 데이터 JSON을 다음 규칙으로 만든다. `docxTemplate.fields`는 `{ "docx플레이스홀더": "섹션키" }` 맵이다:
   - 데이터 JSON의 **키 = 플레이스홀더 이름 그대로**, 값 = 해당 섹션키(achievements/next_plans/notes)로 작성한 섹션 텍스트.
   - 예: fields가 `{ "금주실적": "achievements", "차주계획": "next_plans" }`이면 데이터 JSON은
     `{ "금주실적": "<achievements 섹션 텍스트>", "차주계획": "<next_plans 섹션 텍스트>" }`.
   - ⚠️ docxtemplater는 매칭되지 않은 태그를 **오류 없이 빈 문자열로** 치환한다. 데이터 JSON 키가 양식의 `{태그}` 이름과 정확히 일치하는지 내보내기 전에 확인할 것.
   - 데이터 JSON은 `<reportsDir>/.tmp-docx-data.json`에 UTF-8(BOM 없이)로 쓰고, 성공 후 삭제한다.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/export-docx.cjs" --template <docxTemplate.path> --data <임시.json> --out <reportsDir>/<기간>.docx
   ```
   stdout은 `{"ok":true,"out":"<생성 경로>"}` 형태다. `ok:true` 확인 후 `out` 경로를 사용자에게 안내한다.

## 설정 (/report setup)

1. 사용자에게 회사 양식 .docx 경로를 받아 `~/.claude/da-haetneundeyo/templates/`로 복사.
2. 양식 안에 `{금주실적}`처럼 중괄호 플레이스홀더를 넣도록 안내하고, 각 플레이스홀더가 어떤 섹션(achievements/next_plans/notes)인지 물어 `config.json`의 `docxTemplate: { path, fields }`에 저장.
3. `projectMap`도 함께 확인: 저널에 등장한 project 경로별로 업무명을 제안하고 사용자가 수정하면 저장.
4. 보고서 저장 위치(`reportsDir`)도 물어본다. 기본값(`~/.claude/da-haetneundeyo/reports/`)을 유지할지,
   다른 디렉토리를 쓸지 확인해 `config.json`의 `reportsDir`에 저장한다. **OneDrive 등 클라우드 자동
   동기화 폴더를 지정하는 경우, 저장되는 보고서에 업무 내용(실적 문장, 커밋 요약 등)이 포함되어
   그대로 동기화된다는 점을 사용자에게 안내한다.**
