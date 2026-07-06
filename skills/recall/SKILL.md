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
4. 검색 결과가 없으면 기간을 넓히거나 유사 키워드로 1회 재시도 후, 그래도 없으면 없다고 답한다.
