# "다 했는데요?" (da-haetneundeyo) — 설계 문서

> 이 문서는 최초 MVP 설계/계획의 기록이며 이후 릴리스(0.1.x)에서 일부 내용이 개선·대체되었다.

- 작성일: 2026-07-03
- 상태: 설계 확정 (구현 계획 수립 전)
- 배포 목표: 오픈소스 (GitHub 마켓플레이스, 한/영 i18n, MIT 라이선스)

## 1. 문제 정의

AI(Claude Code)로 대부분의 업무를 진행하면서 개발자는 실행자가 아닌 **검토자**가 된다. 그 결과:

- 코드 디테일을 이전처럼 기억하지 못한다.
- 주간/월간 보고에 쓸 내용이 빈약하다 — 실제로는 일을 많이 했는데 정리된 기록이 없다.
- 과거 작업을 확인하려면 지난 대화를 돌려보거나 PR을 뒤져야 한다.

**목표:** 평소처럼 Claude Code를 사용하기만 해도 작업 기록이 자동으로 체계화되어, ① 작업 일지가 쌓이고 ② 주간/월간 업무 보고 초안이 나오고 ③ 과거 작업을 검색할 수 있는 플러그인.

### 비목표 (MVP 범위 외)

- GitHub/GitLab 등 PR 플랫폼 API 연동 (로컬 git만 결합, API는 확장 포인트)
- Excel/HWP 양식 출력 (docx만 MVP 포함)
- 팀 단위 집계·공유 (개인 사용 전제)
- 상주 프로세스, MCP 서버, 벡터 검색

## 2. 선행 조사 요약

세션 히스토리 × git을 결합해 업무 보고를 생성하는 도구는 **존재하지 않음** (2026-07 기준). Claude Code 공식 기능 요청(#29585)은 "not planned"로 닫혀 수요만 검증된 상태.

| 프로젝트 | 라이선스 | 판정 | 차용 항목 |
|---|---|---|---|
| cc-session-tools | 없음(차용 불가) | 패턴 참고 | JSONL 노이즈 필터 체크리스트, 30분 유휴 갭 타임시트 휴리스틱, 템플릿 플레이스홀더 패턴 |
| claude-sessions | MIT | 패턴 참고 | 세션 요약 항목 분류법(성과/문제와 해결/미완료/후임자 팁) |
| claude-mem | Apache-2.0 | 패턴 참고 | hooks.json 등록 형식·timeout, "훅은 항상 exit 0" 규약, 검색 progressive disclosure |
| claude-code-log | MIT | 스키마 이식 | `models.py` = transcript 비공식 스키마 명세 (레코드 8종, 버전 quirk, `leafUuid` 매칭, cwd 복원) |
| ccusage v19 태그 | MIT | 코드 차용 | 경로 탐색(`CLAUDE_CONFIG_DIR`→`~/.claude`), dedup 해시(`message.id+requestId`), 타임존 일/주/월 버킷팅 |

npm에 transcript 파싱 전용 라이브러리는 없음 → 파서 자작 (추후 분리 배포 시 생태계 기여 포인트).

## 3. 아키텍처 (접근 A: 순수 플러그인, 스크립트 내장)

```
da-haetneundeyo/
├── .claude-plugin/plugin.json      # 플러그인 매니페스트
├── hooks/hooks.json                # Stop / SessionStart / SessionEnd 등록
├── scripts/                        # Node 스크립트 (esbuild 단일 파일 번들, 의존성 설치 불필요)
│   ├── capture.mjs                 # 훅 진입점: 증분 파싱 → 저널 upsert
│   ├── backfill.mjs                # 소급 파싱 (온보딩 백필 + 재조정 스윕)
│   └── export-docx.mjs             # docxtemplater 양식 채우기
├── skills/
│   ├── report/                     # /report weekly|monthly [--format docx], /report setup
│   ├── recall/                     # /recall <질문>
│   └── worklog/                    # /worklog (조회·보완)
└── templates/
    ├── weekly-ko.md, weekly-en.md, monthly-ko.md, monthly-en.md
    └── (사용자 등록: 회사양식.docx)
```

원칙:
- **캡처는 결정적(무토큰), LLM은 조회·생성 시점에만.**
- 상주 프로세스 없음. Node 단일 런타임. 네이티브 의존성 없음 (SQLite 대신 파일 기반).
- 훅은 절대 Claude Code를 방해하지 않는다: 모든 에러 삼킴, 항상 exit 0, stderr 로그만.

## 4. 캡처 전략 — "transcript JSONL의 증분 투영"

사용 현실: 정상 종료는 드물고 강제 compact, IDE/터미널 강제 종료가 일상. 따라서 SessionEnd 의존 설계는 배제하고 3중 안전망을 둔다.

1. **Stop 훅 (주력)** — 매 턴 종료마다 발화. 세션별 저장된 바이트 오프셋 이후의 새 줄만 증분 파싱해 저널에 세션ID 기준 **upsert**. 턴당 ~30ms, 토큰 0. 터미널을 언제 죽여도 마지막 완료 턴까지는 이미 저널에 있음.
2. **SessionStart 훅 (재조정)** — 저널 최종 처리 시점 이후 mtime이 변한 JSONL을 스캔해 놓친 세션 회수. 최초 실행 시(state.json 없음) 온보딩 백필 제안.
3. **/report·/worklog 실행 시 스윕 (최종 안전망)** — 보고서 생성 전 항상 재조정 1회.

- SessionEnd는 보너스: 세션 완료 마킹만.
- upsert는 멱등 — 같은 세션 재처리에도 중복 없음.
- 강제 compact: JSONL 원본과 세션ID가 유지되므로 증분 upsert가 자연히 이어감. PreCompact 훅 불필요.
- JSONL 30일 보존 초과 리스크: 턴마다 적재하는 구조상 방치 불가능. 설치 시 백필이 기존 보존분 흡수.

### 훅 stdin (Claude Code 제공)

```json
{ "hook_event_name": "Stop", "session_id": "...", "transcript_path": "...", "cwd": "..." }
```

## 5. 저장 구조 및 저널 스키마

```
~/.claude/da-haetneundeyo/
├── journal/2026/07/2026-07-03.jsonl   # 하루 1파일, 세션당 1줄 (upsert)
├── state.json                          # 세션별 처리 오프셋, 마지막 스윕 시각
├── config.json                         # 프로젝트→업무명 매핑, 템플릿 경로, 언어, 출력 경로
├── templates/                          # 사용자 등록 양식
└── reports/2026-W27-weekly.md(.docx)   # 생성물 보관
```

저널 한 줄 (다이제스트):

```json
{
  "sessionId": "87a50023-...",
  "project": "D:\\work\\demo-api",
  "branch": "develop",
  "start": "2026-07-03T15:50", "end": "2026-07-03T15:57",
  "turns": 9,
  "requests": ["사용자 요청 원문(노이즈 필터 적용)"],
  "filesEdited": ["src/.../UserController.java"],
  "commands": ["gradlew test"],
  "commits": [{ "hash": "b2c3d4e", "date": "2026-07-03", "subject": "config : ...", "files": 3, "insertions": 120, "deletions": 45 }],
  "kind": "work | qa",
  "archetype": "quick | standard | deep | marathon",
  "note": "(사용자가 /worklog에서 추가한 보완 메모)",
  "cwdWindows": { "D:\\work\\demo-api": { "start": "...", "end": "..." } }
}
```

- `kind` 자동 분류 규칙: `filesEdited`와 `commits`가 모두 비어 있으면 `qa`(보고서 기본 제외), 파일 수정 또는 커밋이 있으면 `work`. 사용자가 `/worklog`에서 재분류 가능.
- `archetype`: 지속시간 기반 보조 축 — <15분 quick, <2시간 standard, <6시간 deep, 이상 marathon. deep/marathon인데 커밋이 없으면 대형 WIP 신호로 보고서 차주계획에 활용.
- `commits`: 캡처 시 cwd별 세션 시간 창 × `git log --since/--until --author --no-merges --shortstat` 대조로 결합 — 세션 × git 결합의 핵심. `date`(author date)는 주 경계를 넘긴 세션의 기간별 커밋 필터용, `files/insertions/deletions`는 실적의 정량 근거.
- 워크스페이스 루트 폴백: cwd 창의 디렉토리가 git repo가 아니면(멀티 프로젝트 루트 등), 그 cwd 하위에서 편집된 파일(`filesEdited`)의 dirname에 `rev-parse --show-toplevel`을 물어 하위 repo를 추론하고, 같은 시간 창으로 커밋을 수집한다(#11). dirname 단위 캐시로 git 스폰을 절약하고, 추론 실패(repo 밖 파일·삭제된 경로)는 조용히 스킵, 결과는 해시 기준 dedupe.
- 날짜 의미론: 저장 파일 키는 UTC 날짜지만, `range` 조회와 note/kind 대상 탐색은 **머신 로컬 날짜**(로컬 자정 경계) 기준 — KST 새벽 세션도 "오늘"에 잡힌다. 특수 환경은 `DHND_UTC_OFFSET_MIN` env로 오프셋을 고정할 수 있다.
- 파일 기반 선택 이유: 네이티브 의존성 제로(Windows 안전), 사람이 직접 읽고 수정 가능, ripgrep 검색으로 충분(세션당 1줄 규모), 개인 git 저장소로 PC 간 동기화 가능. 수년치 누적 시 필요하면 인덱스 추가.

### JSONL 파싱 원칙 (선행 프로젝트 공통 교훈)

- 한 줄 파싱 실패 = 그 줄만 스킵. 알 수 없는 레코드 타입은 버리지 않고 보존(optional-heavy 스키마).
- 서브에이전트/사이드체인(`isSidechain`, `agent-*.jsonl`, `queue-operation` 첫 줄) 제외.
- 프로젝트 식별은 디렉토리명 역산이 아니라 레코드 내 `cwd` 필드 사용.
- 노이즈 필터: `(local command` 프리픽스, 2000자 초과 붙여넣기, tool_result 등 제외.
- 중복 제거 키: `message.id + requestId` (ccusage 방식).

## 6. 커맨드(스킬) 명세

### /worklog
- 오늘(기본) 또는 지정 기간의 저널을 사람이 읽게 렌더링. 실행 전 재조정 스윕.
- 세션별: 시간대, 프로젝트, 요약 한 줄, 커밋 링크, `qa`/`work` 구분, 진행 중 표시.
- 보완 액션: 모호한 항목에 사용자가 한 줄 메모 추가(`note` 필드 저장) — 강제 아님, 보고서 품질 인센티브.
- "커밋 없이 끝난 work 세션"을 미완료 후보로 표시.

### /report weekly|monthly [--format docx] [기간]
- 실행 전 재조정 스윕 → 기간 내 저널 + 프로젝트별 `git log` + 매핑 config + 템플릿 로드.
- LLM이 다이제스트를 **실적 문장으로 승격**: 요청 원문·파일 경로·커밋 메시지를 교차해 업무 언어로 작성, 항목마다 커밋 해시 등 근거 병기.
- **추정 항목은 ⚠️ 플래그로 명시** — 사용자는 플래그 항목만 검증하면 됨(신뢰의 핵심).
- 미완료 후보 → "차주 계획" 섹션 자동 제안.
- 출력: `reports/`에 md 항상 생성(원본), `--format docx` 시 docxtemplater로 양식 채움.

### /report setup
- 회사 양식 .docx 등록: `{금주실적}` `{차주계획}` `{작성자}` 플레이스홀더 매핑을 대화형으로 구성해 config에 저장.
- 프로젝트→업무명 매핑 편집 (`demo-api` → "주문 API 백엔드"). 최초에는 플러그인이 추정치 제안, 사용자는 수정만.

### /recall <질문>
- ripgrep으로 저널 검색(~ms) → 다이제스트 인덱스 우선 표시(항목당 소량 토큰) → 사용자가 원할 때만 원본 transcript 해당 구간 추가 로드 (progressive disclosure).
- 결과에서 원본 세션(`claude --resume`)·커밋으로 점프 가능.

### 온보딩 (SessionStart 최초 실행)
- `~/.claude/projects/` 스캔 결과 요약("28일간 세션 47개 발견") + 백필 제안. 승인 시 토큰 0으로 ~10초 내 완료 → **설치 당일 첫 보고서 생성 가능**이 온보딩의 중심.

## 7. docx 내보내기 (MVP 포함)

- **docxtemplater** (순수 JS, MIT) 번들 — 사용자 추가 설치 없음.
- 회사 양식 .docx의 플레이스홀더를 저널 데이터로 채움 → 표·로고·서식 100% 유지, "생성 → 바로 첨부 제출".
- md가 항상 원본(source of truth), docx는 파생물. pandoc은 설치돼 있을 때만 쓰는 선택 경로. HWP는 미지원(신뢰할 라이브러리 부재), 필요 시 md→docx 우회 안내.

## 8. 사용자 액션 인벤토리 (UX 계약)

| 구분 | 액션 | 빈도 |
|---|---|---|
| 최초 1회 | 설치 → 백필 승인 → (선택) 매핑 확인 → (선택) 양식 등록 | ~5분 |
| 주기 | `/report weekly` → ⚠️ 플래그 항목만 검토 → docx 제출 | 주/월 1회, ~5분 |
| 비정기 | `/worklog` 확인·메모 보완, `/recall` 검색 | 필요할 때 |

자동(사용자 액션 아님): 세션 기록, 비정상 종료 복구, git 매칭, 노이즈 제외, 미완료 감지. 수동 세션 선언(`/session-start` 류)은 배제 — claude-sessions의 실패 요인.

## 9. 에러 처리

- 훅: 모든 예외 catch → stderr 로그 → exit 0. 저널 손상 방지 위해 임시 파일 쓰기 후 rename(원자적).
- state.json 유실 시: 저널의 마지막 타임스탬프 기준으로 재구성 (upsert 멱등성 덕에 안전).
- git 없는 디렉토리/명령 실패: commits 빈 배열로 진행.
- 파서는 Claude Code 스키마 변경에 관대해야 함 (5절 원칙).

## 10. 테스트 전략

- 파서 단위 테스트: 실제 transcript 샘플(익명화) 픽스처 기반 — 레코드 타입별, 버전 quirk별.
- upsert 멱등성 테스트: 같은 세션 3회 재처리 → 저널 1줄 유지.
- 증분 오프셋 테스트: 파일 append 후 새 줄만 파싱되는지.
- docx 테스트: 플레이스홀더 치환 결과 검증.
- 훅 통합: stdin 페이로드 시뮬레이션 → exit 0 보장, 오류 주입 시에도 exit 0.

## 11. 국제화·프라이버시·배포

- i18n: 스킬 안내문/템플릿 한·영 제공, `config.json`의 `language`로 선택. 기본 한국어(제작 배경), README는 영/한 병기.
- 프라이버시: 저널에 프롬프트 원문 포함 — README에 저장 위치·git 동기화 시 비공개 저장소 사용 경고 명시. 민감 문자열 마스킹 규칙(config의 정규식 목록)은 확장 포인트.
- 배포: GitHub 저장소 + `.claude-plugin/marketplace.json`, MIT 라이선스.

## 12. 확장 포인트 (MVP 이후)

- PR 플랫폼 API (GitHub `gh`, GitLab `glab`) — 저널의 브랜치·커밋과 PR 매칭
- Excel 양식 출력, 민감정보 마스킹, 파서 npm 패키지 분리 배포
- SessionStart 컨텍스트 주입("어제 하던 일 이어서") — claude-mem의 `additionalContext` 방식
- 타임시트(`30분 유휴 갭` 휴리스틱 기반 근무시간 추정)
