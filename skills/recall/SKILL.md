---
name: recall
description: 과거 작업을 검색한다. "그때 그거 어떻게 했지", "언제 했지", "recall" 등 과거 작업 회고 질문에 사용.
---

# 과거 작업 검색 (recall)

1. 질문에서 키워드를 뽑아 저널을 검색한다 (여러 키워드는 각각 실행):
   실행 전에 `~`를 홈 디렉토리 절대경로로 치환하라 (`~`는 따옴표 안에서 쉘 확장되지 않는다): bash는 `$HOME`, PowerShell은 `$env:USERPROFILE`.
   ```bash
   rg -i "<키워드>" "$HOME/.claude/da-haetneundeyo/journal/" --no-heading
   ```
2. 매칭된 다이제스트 줄만 파싱해 **인덱스 형태**로 먼저 보여준다 (항목당 1줄: 날짜, 프로젝트, 요약, 커밋해시).
3. 사용자가 특정 항목의 상세를 원할 때만:
   - 커밋 상세: `git -C <project> show --stat <hash>`
   - 세션 원문: `~/.claude/projects/`의 해당 `sessionId`.jsonl에서 관련 부분만 발췌 (전체 로드 금지)
   - 이어서 작업하려면 `claude --resume <sessionId>` 안내.
4. 검색 결과가 없으면 단계적으로 재시도한다 (각 단계 1회, 그래도 없으면 다음 단계로):
   ① 영/한 교차·동의어로 1회 재시도 (예: "타임아웃"↔"timeout", "로그인"↔"login")
   ② 커밋 메시지·파일명 관점 키워드로 재시도 (클래스명, 파일명 일부 등 — 사용자의 대화체 표현이 아니라
      코드/커밋에 실제로 쓰였을 법한 용어)
   ③ 기간 힌트가 있으면("지난달", "6월쯤") 전체 저널이 아니라 해당 월의 저널 파일만 조회
      (`journal/YYYY/MM/*.jsonl`)
   모든 단계 후에도 없으면 없다고 솔직히 답한다 (억지로 지어내지 말 것).

## 상세 조회 시 원문 폴백 순서

세션 상세(원문)를 보여줄 때는 다음 순서로 시도한다:

1. `~/.claude/projects/`의 원본 `sessionId`.jsonl (transcript 보존 기간 — 기본 30일 — 내라면 존재).
2. 원본이 없으면(30일 경과 등) 아카이브를 시도한다:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" archive-read --session <ID> --day <D>
   ```
   `{"ok":false,...}`가 나오면 아카이브도 없는 것이다(아카이브는 opt-in이라 기본은 꺼져 있음).
3. 원본도 아카이브도 없으면, 저널의 `commits` 필드로 `git show`(커밋 diff)를 이용해 "무엇을 했는지"만
   재구성한다. 이 경우 "해결 과정(어떻게·왜)"까지는 복원할 수 없다는 점을 사용자에게 알린다.
