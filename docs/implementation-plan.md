# "다 했는데요?" (da-haetneundeyo) MVP Implementation Plan

> 이 문서는 최초 MVP 설계/계획의 기록이며 이후 릴리스(0.1.x)에서 일부 내용이 개선·대체되었다.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code 세션 transcript를 훅으로 증분 캡처해 작업 일지를 자동 축적하고, 주간/월간 보고서(md/docx)와 과거 작업 검색을 제공하는 플러그인 MVP.

**Architecture:** 순수 플러그인 구조 — 의존성 없는 Node ESM 모듈(`lib/`)을 훅 스크립트(`scripts/`)가 직접 import. 캡처는 결정적(무토큰), LLM은 스킬(`/report`, `/recall`, `/worklog`) 실행 시에만 사용. docx 내보내기만 esbuild로 번들(docxtemplater).

**Tech Stack:** Node.js ≥ 20 (ESM `.mjs`), `node:test` + `node:assert` (테스트, 의존성 0), esbuild + docxtemplater + pizzip (devDependencies, docx 번들용).

**Spec:** `docs/design.md`

## Global Constraints

- 런타임 의존성 0 — `lib/`, `scripts/`는 Node 내장 모듈만 사용. docx만 예외로 devDependencies를 esbuild 번들(`scripts/export-docx.cjs`)에 포함해 커밋.
- 훅 스크립트는 **어떤 경우에도 exit 0** — 모든 예외 catch, stderr에 `[da-haetneundeyo]` 프리픽스 로그만.
- 저널/상태 파일 쓰기는 항상 temp 파일 + rename (원자적).
- transcript 파싱: 한 줄 실패 = 그 줄만 스킵. `isSidechain: true` 레코드와 `agent-*.jsonl` 파일 제외.
- 데이터 디렉토리: `~/.claude/da-haetneundeyo/`, 테스트용 override 환경변수 `DHND_DATA_DIR`.
- transcript 탐색: `CLAUDE_CONFIG_DIR`(콤마 구분 다중) → `~/.claude` 폴백, 하위 `projects/*/`.
- `kind` 분류: `filesEdited`와 `commits` 모두 비면 `qa`, 아니면 `work`.
- 라이선스 MIT, 기본 언어 `ko`.
- 커밋 메시지: conventional commits (`feat:`, `test:`, `docs:`, `chore:`).

## File Structure

```
da-haetneundeyo/
├── .claude-plugin/plugin.json        # 플러그인 매니페스트
├── hooks/hooks.json                  # Stop/SessionEnd/SessionStart 등록
├── lib/                              # 의존성 0 ESM 모듈
│   ├── paths.mjs                     # 경로 해석 (dataDir, projectsDirs, ...)
│   ├── config.mjs                    # config.json 로드 + 기본값
│   ├── transcript.mjs                # 관대한 JSONL 파싱 + 다이제스트 빌드
│   ├── git.mjs                       # 세션 기간 커밋 조회
│   ├── journal.mjs                   # 저널 upsert/조회 + state.json
│   └── capture.mjs                   # 증분 캡처 오케스트레이션 + 스윕
├── scripts/
│   ├── hook-stop.mjs                 # Stop/SessionEnd 훅 진입점
│   ├── hook-session-start.mjs        # 재조정 스윕 + 최초 실행 온보딩
│   ├── journal-cli.mjs               # 스킬이 쓰는 CLI (sweep|backfill|range|note|kind)
│   └── export-docx.cjs               # esbuild 번들 산출물 (커밋됨)
├── src-docx/export-docx.src.mjs      # docx 내보내기 소스
├── skills/{report,recall,worklog}/SKILL.md
├── templates/weekly-ko.md, weekly-en.md, monthly-ko.md, monthly-en.md
├── tests/*.test.mjs, tests/helpers.mjs
├── package.json, LICENSE, .gitignore, README.md
```

---

### Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `package.json`, `LICENSE`, `.gitignore`, `.claude-plugin/plugin.json`

**Interfaces:**
- Produces: `npm test` = `node --test tests/`, 플러그인 매니페스트

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "da-haetneundeyo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/",
    "build:docx": "esbuild src-docx/export-docx.src.mjs --bundle --platform=node --format=cjs --outfile=scripts/export-docx.cjs"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "docxtemplater": "^3.60.0",
    "pizzip": "^3.2.0"
  }
}
```

- [ ] **Step 2: .claude-plugin/plugin.json 작성**

```json
{
  "name": "da-haetneundeyo",
  "version": "0.1.0",
  "description": "다 했는데요? — AI로 진행한 작업을 자동 기록해 주간/월간 업무 보고를 만들어주는 Claude Code 플러그인",
  "author": { "name": "dhbang" },
  "license": "MIT"
}
```

- [ ] **Step 3: LICENSE(MIT 전문, copyright 2026 dhbang)와 .gitignore 작성**

```gitignore
node_modules/
*.tmp-*
```

- [ ] **Step 4: 의존성 설치 및 테스트 러너 확인**

Run: `npm install && npm test`
Expected: `tests/` 디렉토리가 없어 실패하지 않도록 빈 `tests/.gitkeep` 생성 후 `# pass 0` 출력 확인

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: project scaffolding (npm, plugin manifest, MIT)"
```

---

### Task 2: 경로 해석과 설정 로드 (lib/paths.mjs, lib/config.mjs)

**Files:**
- Create: `lib/paths.mjs`, `lib/config.mjs`, `tests/helpers.mjs`, `tests/paths.test.mjs`, `tests/config.test.mjs`

**Interfaces:**
- Produces:
  - `dataDir(env?) → string`, `journalDir(env?)`, `statePath(env?)`, `configPath(env?)`, `reportsDir(env?)`, `templatesDir(env?)`
  - `claudeConfigDirs(env?) → string[]`, `projectsDirs(env?) → string[]`
  - `loadConfig(env?) → { language, projectMap, noiseMaxChars, docxTemplate }`
  - 테스트 헬퍼 `tmpEnv() → { root, env }` (격리된 DHND_DATA_DIR/CLAUDE_CONFIG_DIR)

- [ ] **Step 1: 실패하는 테스트 작성 (tests/helpers.mjs 포함)**

`tests/helpers.mjs`:
```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-'));
  const env = {
    ...process.env,
    DHND_DATA_DIR: path.join(root, 'data'),
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
  };
  fs.mkdirSync(path.join(root, 'claude', 'projects'), { recursive: true });
  return { root, env };
}
```

`tests/paths.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dataDir, claudeConfigDirs, projectsDirs, journalDir } from '../lib/paths.mjs';
import { tmpEnv } from './helpers.mjs';

test('DHND_DATA_DIR overrides data dir', () => {
  const { env } = tmpEnv();
  assert.equal(dataDir(env), env.DHND_DATA_DIR);
  assert.equal(journalDir(env), path.join(env.DHND_DATA_DIR, 'journal'));
});

test('CLAUDE_CONFIG_DIR supports comma-separated list', () => {
  const env = { CLAUDE_CONFIG_DIR: 'C:\\a, C:\\b' };
  assert.deepEqual(claudeConfigDirs(env), ['C:\\a', 'C:\\b']);
  assert.deepEqual(projectsDirs(env), [path.join('C:\\a', 'projects'), path.join('C:\\b', 'projects')]);
});

test('falls back to ~/.claude when CLAUDE_CONFIG_DIR unset', () => {
  const dirs = claudeConfigDirs({});
  assert.equal(dirs.length, 1);
  assert.ok(dirs[0].endsWith('.claude'));
});
```

`tests/config.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { tmpEnv } from './helpers.mjs';

test('returns defaults when config.json missing', () => {
  const { env } = tmpEnv();
  const cfg = loadConfig(env);
  assert.equal(cfg.language, 'ko');
  assert.deepEqual(cfg.projectMap, {});
  assert.equal(cfg.noiseMaxChars, 2000);
});

test('merges user config over defaults', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'),
    JSON.stringify({ projectMap: { 'D:\\develop\\demo-api': '주문 API' } }));
  const cfg = loadConfig(env);
  assert.equal(cfg.projectMap['D:\\develop\\demo-api'], '주문 API');
  assert.equal(cfg.language, 'ko');
});

test('returns defaults on corrupt config.json', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'), '{broken');
  assert.equal(loadConfig(env).language, 'ko');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/paths.mjs'`

- [ ] **Step 3: 구현**

`lib/paths.mjs`:
```js
import os from 'node:os';
import path from 'node:path';

export function claudeConfigDirs(env = process.env) {
  const raw = env.CLAUDE_CONFIG_DIR;
  if (raw) return raw.split(',').map((p) => p.trim()).filter(Boolean);
  return [path.join(os.homedir(), '.claude')];
}

export function projectsDirs(env = process.env) {
  return claudeConfigDirs(env).map((d) => path.join(d, 'projects'));
}

export function dataDir(env = process.env) {
  return env.DHND_DATA_DIR || path.join(os.homedir(), '.claude', 'da-haetneundeyo');
}

export const journalDir = (env) => path.join(dataDir(env), 'journal');
export const statePath = (env) => path.join(dataDir(env), 'state.json');
export const configPath = (env) => path.join(dataDir(env), 'config.json');
export const reportsDir = (env) => path.join(dataDir(env), 'reports');
export const templatesDir = (env) => path.join(dataDir(env), 'templates');
```

`lib/config.mjs`:
```js
import fs from 'node:fs';
import { configPath } from './paths.mjs';

export const DEFAULT_CONFIG = {
  language: 'ko',
  projectMap: {},
  noiseMaxChars: 2000,
  docxTemplate: null,
};

export function loadConfig(env = process.env) {
  try {
    const user = JSON.parse(fs.readFileSync(configPath(env), 'utf8'));
    return { ...DEFAULT_CONFIG, ...user };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: path resolution and config loading"
```

---

### Task 3: transcript 파서와 다이제스트 빌더 (lib/transcript.mjs)

**Files:**
- Create: `lib/transcript.mjs`, `tests/transcript.test.mjs`, `tests/fixtures.mjs`

**Interfaces:**
- Produces:
  - `parseLine(line: string) → object | null` — 실패 시 null
  - `emptyDigest(sessionId: string) → Digest`
  - `applyRecords(digest, records, { noiseMaxChars }) → Digest` (mutate + return)
  - `finalizeKind(digest) → void` — `filesEdited`·`commits` 기준 `qa`/`work` 설정
  - Digest 형태: `{ sessionId, project, branch, start, end, turns, requests[], filesEdited[], commands[], commits[], kind, note, completed? }`

- [ ] **Step 1: 픽스처 빌더 작성**

`tests/fixtures.mjs` (실제 transcript 레코드 형태 기반):
```js
let n = 0;
const base = (extra) => ({
  uuid: `u${++n}`, sessionId: 's1', isSidechain: false,
  timestamp: '2026-07-03T06:50:48.682Z', cwd: 'D:\\develop\\demo-api',
  gitBranch: 'develop', ...extra,
});

export const userLine = (content, extra = {}) =>
  JSON.stringify(base({ type: 'user', message: { role: 'user', content }, ...extra }));

export const assistantToolUse = (name, input, extra = {}) =>
  JSON.stringify(base({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${n}`, name, input }] },
    ...extra,
  }));

export const queueOp = () => JSON.stringify({ type: 'queue-operation', operation: 'enqueue' });
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/transcript.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLine, emptyDigest, applyRecords, finalizeKind } from '../lib/transcript.mjs';
import { userLine, assistantToolUse, queueOp } from './fixtures.mjs';

const build = (lines) => {
  const d = emptyDigest('s1');
  applyRecords(d, lines.map(parseLine).filter(Boolean), { noiseMaxChars: 2000 });
  finalizeKind(d);
  return d;
};

test('parseLine returns null on broken JSON, object on valid', () => {
  assert.equal(parseLine('{broken'), null);
  assert.equal(parseLine(userLine('hi')).type, 'user');
});

test('collects user requests, cwd, branch, timestamps', () => {
  const d = build([
    userLine('결재선 조회 버그 고쳐줘', { timestamp: '2026-07-03T01:00:00Z' }),
    userLine('테스트도 돌려줘', { timestamp: '2026-07-03T02:00:00Z' }),
  ]);
  assert.deepEqual(d.requests, ['결재선 조회 버그 고쳐줘', '테스트도 돌려줘']);
  assert.equal(d.turns, 2);
  assert.equal(d.project, 'D:\\develop\\demo-api');
  assert.equal(d.branch, 'develop');
  assert.equal(d.start, '2026-07-03T01:00:00Z');
  assert.equal(d.end, '2026-07-03T02:00:00Z');
});

test('noise filters: sidechain, local command, tool_result, oversize, meta', () => {
  const big = 'x'.repeat(3000);
  const d = build([
    userLine('진짜 요청'),
    userLine('(local command) ls', {}),
    userLine(big),
    userLine('사이드체인', { isSidechain: true }),
    userLine('메타', { isMeta: true }),
    userLine([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
    queueOp(),
  ]);
  assert.deepEqual(d.requests, ['진짜 요청']);
});

test('extracts filesEdited from edit tools and commands from Bash (dedup)', () => {
  const d = build([
    assistantToolUse('Edit', { file_path: 'D:\\a\\User.java', old_string: 'a', new_string: 'b' }),
    assistantToolUse('Write', { file_path: 'D:\\a\\New.java', content: '...' }),
    assistantToolUse('Edit', { file_path: 'D:\\a\\User.java', old_string: 'c', new_string: 'd' }),
    assistantToolUse('Bash', { command: 'gradlew test' }),
    assistantToolUse('Read', { file_path: 'D:\\a\\Read.java' }),
  ]);
  assert.deepEqual(d.filesEdited, ['D:\\a\\User.java', 'D:\\a\\New.java']);
  assert.deepEqual(d.commands, ['gradlew test']);
});

test('kind: qa when no edits/commits, work when edits exist', () => {
  assert.equal(build([userLine('git 질문')]).kind, 'qa');
  assert.equal(build([assistantToolUse('Edit', { file_path: 'a.ts' })]).kind, 'work');
  const d = build([userLine('질문')]);
  d.commits = [{ hash: 'abc1234', subject: 'fix' }];
  finalizeKind(d);
  assert.equal(d.kind, 'work');
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/transcript.mjs'`

- [ ] **Step 4: 구현**

`lib/transcript.mjs`:
```js
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export function parseLine(line) {
  try {
    const rec = JSON.parse(line);
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

export function emptyDigest(sessionId) {
  return {
    sessionId, project: null, branch: null, start: null, end: null,
    turns: 0, requests: [], filesEdited: [], commands: [], commits: [],
    kind: 'qa', note: null,
  };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === 'tool_result')) return '';
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text).join('\n');
  }
  return '';
}

export function applyRecords(digest, records, opts = {}) {
  const maxChars = opts.noiseMaxChars ?? 2000;
  for (const rec of records) {
    if (!rec || rec.isSidechain) continue;
    if (typeof rec.timestamp === 'string') {
      if (!digest.start || rec.timestamp < digest.start) digest.start = rec.timestamp;
      if (!digest.end || rec.timestamp > digest.end) digest.end = rec.timestamp;
    }
    if (typeof rec.cwd === 'string' && rec.cwd) digest.project = rec.cwd;
    if (typeof rec.gitBranch === 'string' && rec.gitBranch) digest.branch = rec.gitBranch;

    if (rec.type === 'user' && rec.message && !rec.isMeta) {
      const text = textOf(rec.message.content).trim();
      const noise = !text || text.startsWith('(local command') || text.length > maxChars;
      if (!noise && !digest.requests.includes(text)) {
        digest.requests.push(text);
        digest.turns += 1;
      }
    }

    if (rec.type === 'assistant' && rec.message && Array.isArray(rec.message.content)) {
      for (const block of rec.message.content) {
        if (!block || block.type !== 'tool_use' || !block.input) continue;
        if (EDIT_TOOLS.has(block.name) && typeof block.input.file_path === 'string') {
          if (!digest.filesEdited.includes(block.input.file_path)) {
            digest.filesEdited.push(block.input.file_path);
          }
        } else if (block.name === 'Bash' && typeof block.input.command === 'string') {
          const cmd = block.input.command.slice(0, 200);
          if (!digest.commands.includes(cmd)) digest.commands.push(cmd);
        }
      }
    }
  }
  return digest;
}

export function finalizeKind(digest) {
  digest.kind = digest.filesEdited.length === 0 && digest.commits.length === 0 ? 'qa' : 'work';
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: tolerant transcript parser and session digest builder"
```

---

### Task 4: git 커밋 결합 (lib/git.mjs)

**Files:**
- Create: `lib/git.mjs`, `tests/git.test.mjs`

**Interfaces:**
- Produces: `commitsSince(cwd: string, sinceIso: string) → {hash, subject}[] | null` — git 없음/실패 시 `null` (호출부는 기존값 유지)

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/git.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitsSince } from '../lib/git.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-git-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  g('init');
  g('config', 'user.email', 't@t.t');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), '1');
  g('add', '-A');
  g('commit', '-m', 'feat: 결재선 버그 수정');
  return dir;
}

test('returns commits since timestamp', () => {
  const dir = makeRepo();
  const commits = commitsSince(dir, '2020-01-01T00:00:00Z');
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'feat: 결재선 버그 수정');
  assert.match(commits[0].hash, /^[0-9a-f]{7,}$/);
});

test('returns empty array when no commits in window', () => {
  const dir = makeRepo();
  assert.deepEqual(commitsSince(dir, '2999-01-01T00:00:00Z'), []);
});

test('returns null for non-git directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-nogit-'));
  assert.equal(commitsSince(dir, '2020-01-01T00:00:00Z'), null);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/git.mjs'`

- [ ] **Step 3: 구현**

`lib/git.mjs`:
```js
import { execFileSync } from 'node:child_process';

export function commitsSince(cwd, sinceIso) {
  try {
    const out = execFileSync(
      'git', ['-C', cwd, 'log', `--since=${sinceIso}`, '--format=%h%x09%s'],
      { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.split('\n').filter(Boolean).map((l) => {
      const idx = l.indexOf('\t');
      return { hash: l.slice(0, idx), subject: l.slice(idx + 1) };
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: git commit matching for session window"
```

---

### Task 5: 저널 저장소와 상태 (lib/journal.mjs)

**Files:**
- Create: `lib/journal.mjs`, `tests/journal.test.mjs`

**Interfaces:**
- Consumes: `journalDir/statePath` (Task 2)
- Produces:
  - `dayOf(digest) → 'YYYY-MM-DD'` (start 기준, 없으면 오늘)
  - `dayFilePath(day, env) → string` — `journal/YYYY/MM/YYYY-MM-DD.jsonl`
  - `upsertDigest(digest, env) → void` — sessionId 기준 교체-또는-추가, 기존 `note` 보존, 원자적 쓰기
  - `findDigest(sessionId, day, env) → Digest | null`
  - `readRange(fromDay, toDay, env) → Digest[]`
  - `loadState(env) → { sessions: {}, lastSweepMs: 0 }`, `saveState(state, env)`
  - `setField(sessionId, day, field, value, env) → boolean` — note/kind 수정용

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/journal.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { upsertDigest, findDigest, readRange, dayOf, dayFilePath, loadState, saveState, setField } from '../lib/journal.mjs';
import { emptyDigest } from '../lib/transcript.mjs';
import { tmpEnv } from './helpers.mjs';

const digest = (over = {}) => ({
  ...emptyDigest('s1'), start: '2026-07-03T01:00:00Z', end: '2026-07-03T02:00:00Z',
  project: 'D:\\p', requests: ['요청1'], ...over,
});

test('dayOf and dayFilePath', () => {
  const { env } = tmpEnv();
  assert.equal(dayOf(digest()), '2026-07-03');
  assert.ok(dayFilePath('2026-07-03', env).endsWith('2026-07-03.jsonl'));
  assert.ok(dayFilePath('2026-07-03', env).includes('2026'));
});

test('upsert is idempotent: same session 3x = 1 line', () => {
  const { env } = tmpEnv();
  upsertDigest(digest(), env);
  upsertDigest(digest({ requests: ['요청1', '요청2'] }), env);
  upsertDigest(digest({ requests: ['요청1', '요청2'] }), env);
  const lines = fs.readFileSync(dayFilePath('2026-07-03', env), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).requests, ['요청1', '요청2']);
});

test('upsert preserves existing note when new digest has none', () => {
  const { env } = tmpEnv();
  upsertDigest(digest({ note: '결재선 버그 건' }), env);
  upsertDigest(digest({ requests: ['요청1', '추가'] }), env);
  assert.equal(findDigest('s1', '2026-07-03', env).note, '결재선 버그 건');
});

test('readRange spans multiple days, skips corrupt lines', () => {
  const { env } = tmpEnv();
  upsertDigest(digest(), env);
  upsertDigest(digest({ sessionId: 's2', start: '2026-07-04T01:00:00Z' }), env);
  fs.appendFileSync(dayFilePath('2026-07-03', env), '{broken\n');
  const all = readRange('2026-07-01', '2026-07-05', env);
  assert.deepEqual(all.map((d) => d.sessionId).sort(), ['s1', 's2']);
});

test('state roundtrip and defaults', () => {
  const { env } = tmpEnv();
  assert.deepEqual(loadState(env), { sessions: {}, lastSweepMs: 0 });
  saveState({ sessions: { s1: { offset: 100, day: '2026-07-03' } }, lastSweepMs: 5 }, env);
  assert.equal(loadState(env).sessions.s1.offset, 100);
});

test('setField updates note and kind', () => {
  const { env } = tmpEnv();
  upsertDigest(digest(), env);
  assert.equal(setField('s1', '2026-07-03', 'kind', 'work', env), true);
  assert.equal(findDigest('s1', '2026-07-03', env).kind, 'work');
  assert.equal(setField('nope', '2026-07-03', 'note', 'x', env), false);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/journal.mjs'`

- [ ] **Step 3: 구현**

`lib/journal.mjs`:
```js
import fs from 'node:fs';
import path from 'node:path';
import { journalDir, statePath } from './paths.mjs';

export function dayOf(digest) {
  return (digest.start ?? new Date().toISOString()).slice(0, 10);
}

export function dayFilePath(day, env) {
  return path.join(journalDir(env), day.slice(0, 4), day.slice(5, 7), `${day}.jsonl`);
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function parseDigestLine(line) {
  try {
    const d = JSON.parse(line);
    return d && typeof d === 'object' && d.sessionId ? d : null;
  } catch {
    return null;
  }
}

export function upsertDigest(digest, env) {
  const file = dayFilePath(dayOf(digest), env);
  const lines = readLines(file);
  let replaced = false;
  const out = lines.map((line) => {
    const existing = parseDigestLine(line);
    if (!existing || existing.sessionId !== digest.sessionId) return line;
    replaced = true;
    if (digest.note == null && existing.note != null) digest.note = existing.note;
    return JSON.stringify(digest);
  });
  if (!replaced) out.push(JSON.stringify(digest));
  atomicWrite(file, out.join('\n') + '\n');
}

export function findDigest(sessionId, day, env) {
  for (const line of readLines(dayFilePath(day, env))) {
    const d = parseDigestLine(line);
    if (d && d.sessionId === sessionId) return d;
  }
  return null;
}

export function readRange(fromDay, toDay, env) {
  const out = [];
  const cur = new Date(`${fromDay}T00:00:00Z`);
  const end = new Date(`${toDay}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.toISOString().slice(0, 10);
    for (const line of readLines(dayFilePath(day, env))) {
      const d = parseDigestLine(line);
      if (d) out.push(d);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function setField(sessionId, day, field, value, env) {
  const existing = findDigest(sessionId, day, env);
  if (!existing) return false;
  existing[field] = value;
  upsertDigest(existing, env);
  return true;
}

export function loadState(env) {
  try {
    return JSON.parse(fs.readFileSync(statePath(env), 'utf8'));
  } catch {
    return { sessions: {}, lastSweepMs: 0 };
  }
}

export function saveState(state, env) {
  atomicWrite(statePath(env), JSON.stringify(state));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: journal store with idempotent upsert and state tracking"
```

---

### Task 6: 증분 캡처 오케스트레이션 (lib/capture.mjs)

**Files:**
- Create: `lib/capture.mjs`, `tests/capture.test.mjs`

**Interfaces:**
- Consumes: Task 2~5의 모든 export
- Produces:
  - `captureTranscript({ sessionId, transcriptPath, complete? }, env) → Digest | null`
    - state의 바이트 오프셋 이후만 읽음, 완결된 줄(`\n`까지)만 소비
    - 기존 저널 다이제스트 위에 새 레코드 적용(증분), git 커밋 갱신, upsert, 오프셋 저장
  - `sweepProjects(env, { sinceMs?, days? }) → { processed: number }`
    - `projects/*/` 아래 `*.jsonl`(단, `agent-*` 제외) 중 mtime > 기준시각을 captureTranscript로 처리

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/capture.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { captureTranscript, sweepProjects } from '../lib/capture.mjs';
import { findDigest, loadState } from '../lib/journal.mjs';
import { userLine, assistantToolUse } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

function writeTranscript(env, sessionId, lines) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => l + '\n').join(''));
  return file;
}

test('captures new transcript into journal', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('버그 고쳐줘')]);
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.requests, ['버그 고쳐줘']);
  assert.equal(findDigest('s1', '2026-07-03', env).sessionId, 's1');
  assert.ok(loadState(env).sessions.s1.offset > 0);
});

test('incremental: second capture only consumes appended lines and merges', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  const offset1 = loadState(env).sessions.s1.offset;
  fs.appendFileSync(file, assistantToolUse('Edit', { file_path: 'D:\\a.java' }) + '\n');
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.requests, ['요청1']);           // 기존 유지
  assert.deepEqual(d.filesEdited, ['D:\\a.java']);   // 새로 추가
  assert.equal(d.kind, 'work');
  assert.ok(loadState(env).sessions.s1.offset > offset1);
});

test('no new bytes → returns null without touching journal', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.equal(captureTranscript({ sessionId: 's1', transcriptPath: file }, env), null);
});

test('incomplete trailing line (no newline) is not consumed', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  fs.appendFileSync(file, '{"type":"user","partial');
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file }, env);
  assert.deepEqual(d.requests, ['요청1']);
  const offset = loadState(env).sessions.s1.offset;
  assert.equal(offset, fs.statSync(file).size - Buffer.byteLength('{"type":"user","partial'));
});

test('complete flag marks digest completed', () => {
  const { env } = tmpEnv();
  const file = writeTranscript(env, 's1', [userLine('요청1')]);
  const d = captureTranscript({ sessionId: 's1', transcriptPath: file, complete: true }, env);
  assert.equal(d.completed, true);
});

test('sweepProjects picks up unprocessed transcripts, skips agent-*.jsonl', () => {
  const { env } = tmpEnv();
  writeTranscript(env, 's1', [userLine('요청1')]);
  writeTranscript(env, 'agent-x', [userLine('사이드')]);
  const { processed } = sweepProjects(env, { sinceMs: 0 });
  assert.equal(processed, 1);
  assert.ok(findDigest('s1', '2026-07-03', env));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/capture.mjs'`

- [ ] **Step 3: 구현**

`lib/capture.mjs`:
```js
import fs from 'node:fs';
import path from 'node:path';
import { parseLine, applyRecords, emptyDigest, finalizeKind } from './transcript.mjs';
import { commitsSince } from './git.mjs';
import { loadState, saveState, upsertDigest, findDigest, dayOf } from './journal.mjs';
import { loadConfig } from './config.mjs';
import { projectsDirs } from './paths.mjs';

export function captureTranscript({ sessionId, transcriptPath, complete = false }, env = process.env) {
  const state = loadState(env);
  const sess = state.sessions[sessionId] ?? { offset: 0, day: null };
  const size = fs.statSync(transcriptPath).size;
  if (size <= sess.offset) return null;

  const fd = fs.openSync(transcriptPath, 'r');
  const buf = Buffer.alloc(size - sess.offset);
  fs.readSync(fd, buf, 0, buf.length, sess.offset);
  fs.closeSync(fd);

  const chunk = buf.toString('utf8');
  const lastNl = chunk.lastIndexOf('\n');
  if (lastNl === -1) return null;
  const completeText = chunk.slice(0, lastNl + 1);
  const consumed = Buffer.byteLength(completeText, 'utf8');

  const records = completeText.split('\n').filter(Boolean).map(parseLine).filter(Boolean);
  const config = loadConfig(env);
  const digest = (sess.day && findDigest(sessionId, sess.day, env)) || emptyDigest(sessionId);
  applyRecords(digest, records, { noiseMaxChars: config.noiseMaxChars });

  if (digest.project && digest.start) {
    const commits = commitsSince(digest.project, digest.start);
    if (commits !== null) digest.commits = commits;
  }
  if (complete) digest.completed = true;
  finalizeKind(digest);

  upsertDigest(digest, env);
  state.sessions[sessionId] = { offset: sess.offset + consumed, day: dayOf(digest) };
  saveState(state, env);
  return digest;
}

export function sweepProjects(env = process.env, { sinceMs, days } = {}) {
  const state = loadState(env);
  const cutoff = sinceMs ?? (days != null
    ? Date.now() - days * 86400_000
    : state.lastSweepMs);
  let processed = 0;
  for (const dir of projectsDirs(env)) {
    let projects = [];
    try { projects = fs.readdirSync(dir); } catch { continue; }
    for (const proj of projects) {
      let files = [];
      const projDir = path.join(dir, proj);
      try { files = fs.readdirSync(projDir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl') || f.startsWith('agent-')) continue;
        const full = path.join(projDir, f);
        try {
          if (fs.statSync(full).mtimeMs <= cutoff) continue;
          const d = captureTranscript({ sessionId: path.basename(f, '.jsonl'), transcriptPath: full }, env);
          if (d) processed += 1;
        } catch (err) {
          console.error(`[da-haetneundeyo] skip ${f}: ${err?.message ?? err}`);
        }
      }
    }
  }
  const next = loadState(env);
  next.lastSweepMs = Date.now();
  saveState(next, env);
  return { processed };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: incremental capture with byte offsets and project sweep"
```

---

### Task 7: Stop/SessionEnd 훅 진입점 (scripts/hook-stop.mjs)

**Files:**
- Create: `scripts/hook-stop.mjs`, `tests/hook-stop.test.mjs`

**Interfaces:**
- Consumes: `captureTranscript` (Task 6)
- Produces: stdin JSON(`{hook_event_name, session_id, transcript_path, cwd}`)을 받아 캡처 실행. **어떤 입력에도 exit 0.**

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`tests/hook-stop.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findDigest } from '../lib/journal.mjs';
import { userLine } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/hook-stop.mjs', import.meta.url));

function runHook(env, payload) {
  return spawnSync(process.execPath, [script], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env, encoding: 'utf8',
  });
}

test('valid payload captures session and exits 0', () => {
  const { env } = tmpEnv();
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 's1.jsonl');
  fs.writeFileSync(file, userLine('훅 테스트') + '\n');
  const r = runHook(env, {
    hook_event_name: 'Stop', session_id: 's1', transcript_path: file, cwd: 'D:\\p',
  });
  assert.equal(r.status, 0);
  assert.ok(findDigest('s1', '2026-07-03', env));
});

test('broken stdin JSON still exits 0', () => {
  const { env } = tmpEnv();
  const r = runHook(env, '{not json');
  assert.equal(r.status, 0);
  assert.match(r.stderr, /da-haetneundeyo/);
});

test('missing transcript file still exits 0', () => {
  const { env } = tmpEnv();
  const r = runHook(env, {
    hook_event_name: 'Stop', session_id: 'sx', transcript_path: 'C:\\nope\\missing.jsonl',
  });
  assert.equal(r.status, 0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — 스크립트 파일 없음

- [ ] **Step 3: 구현**

`scripts/hook-stop.mjs`:
```js
#!/usr/bin/env node
import { captureTranscript } from '../lib/capture.mjs';

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

try {
  const payload = JSON.parse(await readStdin());
  if (payload?.session_id && payload?.transcript_path) {
    captureTranscript({
      sessionId: payload.session_id,
      transcriptPath: payload.transcript_path,
      complete: payload.hook_event_name === 'SessionEnd',
    });
  }
} catch (err) {
  console.error(`[da-haetneundeyo] capture skipped: ${err?.message ?? err}`);
}
process.exit(0);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: stop/session-end hook entry, never fails"
```

---

### Task 8: journal-cli (스킬용 CLI: sweep|backfill|range|note|kind)

**Files:**
- Create: `scripts/journal-cli.mjs`, `tests/journal-cli.test.mjs`

**Interfaces:**
- Consumes: `sweepProjects`, `readRange`, `setField` (Task 5~6)
- Produces (스킬들이 Bash로 호출하는 계약):
  - `node journal-cli.mjs sweep` → `{"processed":N}` JSON 출력
  - `node journal-cli.mjs backfill --days 30` → 동일 (기준시각을 N일 전으로)
  - `node journal-cli.mjs range --from 2026-06-29 --to 2026-07-05` → 다이제스트 JSON 배열 출력 (range 실행 전 sweep 자동 수행 = 최종 안전망)
  - `node journal-cli.mjs note --session s1 --day 2026-07-03 --text "메모"` → `{"ok":true|false}`
  - `node journal-cli.mjs kind --session s1 --day 2026-07-03 --value work` → `{"ok":true|false}`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/journal-cli.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userLine } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/journal-cli.mjs', import.meta.url));
const run = (env, ...args) =>
  spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });

function seed(env) {
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), userLine('CLI 테스트') + '\n');
}

test('backfill then range returns seeded session', () => {
  const { env } = tmpEnv();
  seed(env);
  const b = run(env, 'backfill', '--days', '30');
  assert.equal(b.status, 0);
  assert.equal(JSON.parse(b.stdout).processed, 1);
  const r = run(env, 'range', '--from', '2026-07-01', '--to', '2026-07-05');
  const entries = JSON.parse(r.stdout);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sessionId, 's1');
});

test('note and kind update journal', () => {
  const { env } = tmpEnv();
  seed(env);
  run(env, 'backfill', '--days', '30');
  const n = run(env, 'note', '--session', 's1', '--day', '2026-07-03', '--text', '결재선 건');
  assert.deepEqual(JSON.parse(n.stdout), { ok: true });
  const k = run(env, 'kind', '--session', 's1', '--day', '2026-07-03', '--value', 'work');
  assert.deepEqual(JSON.parse(k.stdout), { ok: true });
  const r = run(env, 'range', '--from', '2026-07-03', '--to', '2026-07-03');
  const [d] = JSON.parse(r.stdout);
  assert.equal(d.note, '결재선 건');
  assert.equal(d.kind, 'work');
});

test('unknown command exits 1 with usage', () => {
  const { env } = tmpEnv();
  const r = run(env, 'wat');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — 스크립트 파일 없음

- [ ] **Step 3: 구현**

`scripts/journal-cli.mjs`:
```js
#!/usr/bin/env node
import { sweepProjects } from '../lib/capture.mjs';
import { readRange, setField } from '../lib/journal.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  args[rest[i].replace(/^--/, '')] = rest[i + 1];
}

const out = (v) => process.stdout.write(JSON.stringify(v) + '\n');

switch (cmd) {
  case 'sweep':
    out(sweepProjects(process.env));
    break;
  case 'backfill':
    out(sweepProjects(process.env, { days: Number(args.days ?? 30) }));
    break;
  case 'range': {
    sweepProjects(process.env); // 최종 안전망
    out(readRange(args.from, args.to, process.env));
    break;
  }
  case 'note':
    out({ ok: setField(args.session, args.day, 'note', args.text, process.env) });
    break;
  case 'kind':
    out({ ok: setField(args.session, args.day, 'kind', args.value, process.env) });
    break;
  default:
    console.error('usage: journal-cli <sweep|backfill --days N|range --from D --to D|note --session S --day D --text T|kind --session S --day D --value V>');
    process.exit(1);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: journal CLI for skills (sweep/backfill/range/note/kind)"
```

---

### Task 9: SessionStart 훅 — 재조정 스윕 + 최초 실행 온보딩

**Files:**
- Create: `scripts/hook-session-start.mjs`, `tests/hook-session-start.test.mjs`

**Interfaces:**
- Consumes: `sweepProjects`, `statePath`
- Produces:
  - 최초 실행(state.json 없음): 최근 48시간만 스윕 + stdout에 `{hookSpecificOutput:{hookEventName:"SessionStart", additionalContext:"..."}}` 출력 — Claude가 사용자에게 백필을 제안하게 하는 안내문
  - 이후 실행: lastSweepMs 이후 변경분만 스윕, stdout 출력 없음. 항상 exit 0.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/hook-session-start.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userLine } from './fixtures.mjs';
import { tmpEnv } from './helpers.mjs';

const script = fileURLToPath(new URL('../scripts/hook-session-start.mjs', import.meta.url));
const run = (env) => spawnSync(process.execPath, [script], { input: '{}', env, encoding: 'utf8' });

test('first run emits onboarding additionalContext and exits 0', () => {
  const { env } = tmpEnv();
  const dir = path.join(env.CLAUDE_CONFIG_DIR, 'projects', 'D--p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), userLine('첫 세션') + '\n');
  const r = run(env);
  assert.equal(r.status, 0);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(payload.hookSpecificOutput.additionalContext, /backfill/);
});

test('second run is silent and exits 0', () => {
  const { env } = tmpEnv();
  run(env);
  const r = run(env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
});

test('exits 0 even when projects dir is missing', () => {
  const { env } = tmpEnv();
  fs.rmSync(path.join(env.CLAUDE_CONFIG_DIR, 'projects'), { recursive: true, force: true });
  assert.equal(run(env).status, 0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — 스크립트 파일 없음

- [ ] **Step 3: 구현**

`scripts/hook-session-start.mjs`:
```js
#!/usr/bin/env node
import fs from 'node:fs';
import { statePath } from '../lib/paths.mjs';
import { sweepProjects } from '../lib/capture.mjs';

try {
  const firstRun = !fs.existsSync(statePath(process.env));
  if (firstRun) {
    sweepProjects(process.env, { sinceMs: Date.now() - 48 * 3600_000 });
    const msg = [
      '[da-haetneundeyo] 다 했는데요? 플러그인이 처음 실행되었습니다.',
      '최근 48시간 세션은 작업 일지에 반영했습니다.',
      '사용자에게 다음을 안내하세요: 지난 30일 세션 기록을 일지로 백필하려면',
      `"node \\"${process.env.CLAUDE_PLUGIN_ROOT ?? '<plugin>'}/scripts/journal-cli.mjs\\" backfill --days 30" 을 실행하면 되며(토큰 소모 없음, 수 초 소요),`,
      '원하는지 한 번만 물어보세요. 이후 /worklog, /report weekly 를 소개하세요.',
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: session-start hook with reconcile sweep and onboarding"
```

---

### Task 10: 훅 등록 (hooks/hooks.json) + 로컬 설치 검증

**Files:**
- Create: `hooks/hooks.json`, `tests/hooks-json.test.mjs`

**Interfaces:**
- Produces: 플러그인 설치 시 Stop/SessionEnd/SessionStart 훅 자동 활성화

- [ ] **Step 1: 실패하는 테스트 작성 (JSON 구조 검증)**

`tests/hooks-json.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('hooks.json registers Stop, SessionEnd, SessionStart with plugin-root commands', () => {
  const raw = fs.readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8');
  const cfg = JSON.parse(raw);
  for (const event of ['Stop', 'SessionEnd', 'SessionStart']) {
    const entries = cfg.hooks[event];
    assert.ok(Array.isArray(entries) && entries.length === 1, `${event} registered`);
    const hook = entries[0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.ok(hook.timeout >= 30);
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — hooks.json 없음

- [ ] **Step 3: hooks.json 작성**

`hooks/hooks.json`:
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-stop.mjs\"",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-stop.mjs\"",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/hook-session-start.mjs\"",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 로컬 설치 수동 검증**

```bash
claude plugin marketplace add D:\develop\da-haetneundeyo || true
```
로컬 마켓플레이스 미구성 시 대안: `~/.claude/settings.json` 검증 대신, 실제 검증은 Task 12 이후 최종 검증 단계에서 수행. 여기서는 `claude plugin validate D:\develop\da-haetneundeyo` (CLI가 지원하는 경우) 또는 JSON 스키마 수동 확인으로 대체.
Expected: 매니페스트/훅 JSON 오류 없음

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: register stop/session-end/session-start hooks"
```

---

### Task 11: 보고서 템플릿 4종 + docx 내보내기

**Files:**
- Create: `templates/weekly-ko.md`, `templates/weekly-en.md`, `templates/monthly-ko.md`, `templates/monthly-en.md`
- Create: `src-docx/export-docx.src.mjs`, `tests/export-docx.test.mjs`
- Create(빌드 산출물, 커밋): `scripts/export-docx.cjs`

**Interfaces:**
- Produces:
  - md 템플릿: `{{placeholder}}` + HTML 주석(`<!-- ... -->`)이 LLM 섹션 작성 지시문
  - `node scripts/export-docx.cjs --template <docx> --data <json> --out <docx>` — data는 `{ "플레이스홀더명": "텍스트" }` 맵, docx 내 `{플레이스홀더명}` 치환

- [ ] **Step 1: weekly-ko.md 작성** (다른 3종은 같은 구조로 언어/기간명만 변경)

```markdown
# 주간 업무 보고 — {{period}}

작성자: {{author}} | 작성일: {{generated_date}}

## 금주 실적
<!-- LLM 지시: 저널의 kind=work 항목을 projectMap 업무명으로 그룹핑.
     각 항목은 "동사형 실적 문장 (커밋해시 또는 근거)" 형식.
     requests 원문이 모호하면 커밋 메시지·파일 경로로 보완하되
     추정한 항목 끝에 " ⚠️추정" 마커를 붙일 것. qa 항목은 제외. -->
{{achievements}}

## 차주 계획
<!-- LLM 지시: 커밋 없이 끝난 work 세션(미완료 후보)과 requests에 남은
     미해결 요청을 근거로 제안. 각 항목에 근거 세션 날짜 병기. -->
{{next_plans}}

## 특이사항
<!-- LLM 지시: 장애/블로커/의사결정 필요 항목만. 없으면 "없음". -->
{{notes}}

---
<!-- 검증 안내: ⚠️추정 마커 항목만 확인하면 됩니다. -->
```

- [ ] **Step 2: 나머지 템플릿 3종 작성**

`weekly-en.md`(영문 동일 구조), `monthly-ko.md`/`monthly-en.md`(제목 "월간 업무 보고"/"Monthly Report", "금주"→"금월", "차주"→"차월"). 각 파일 전체 내용은 Step 1과 동일 구조에서 해당 문구만 치환.

- [ ] **Step 3: docx 내보내기 실패 테스트 작성**

`tests/export-docx.test.mjs` (픽스처 docx를 pizzip으로 즉석 생성):
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';

const script = fileURLToPath(new URL('../scripts/export-docx.cjs', import.meta.url));

function makeFixtureDocx(dir) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>{금주실적}</w:t></w:r></w:p></w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const zip = new PizZip();
  zip.file('[Content_Types].xml', types);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', docXml);
  const file = path.join(dir, 'template.docx');
  fs.writeFileSync(file, zip.generate({ type: 'nodebuffer' }));
  return file;
}

test('fills placeholder in docx template', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-docx-'));
  const template = makeFixtureDocx(dir);
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, JSON.stringify({ 금주실적: '결재선 버그 수정 (b2c3d4e)' }));
  const outFile = path.join(dir, 'out.docx');
  const r = spawnSync(process.execPath, [script,
    '--template', template, '--data', dataFile, '--out', outFile], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const outZip = new PizZip(fs.readFileSync(outFile));
  const xml = outZip.file('word/document.xml').asText();
  assert.match(xml, /결재선 버그 수정/);
  assert.doesNotMatch(xml, /\{금주실적\}/);
});

test('missing args exit 1 with usage', () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `scripts/export-docx.cjs` 없음

- [ ] **Step 5: 소스 작성 및 번들**

`src-docx/export-docx.src.mjs`:
```js
import fs from 'node:fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];

if (!args.template || !args.data || !args.out) {
  console.error('usage: export-docx --template <docx> --data <json> --out <docx>');
  process.exit(1);
}

try {
  const zip = new PizZip(fs.readFileSync(args.template));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
    nullGetter: () => '',
  });
  doc.render(JSON.parse(fs.readFileSync(args.data, 'utf8')));
  fs.writeFileSync(args.out, doc.getZip().generate({ type: 'nodebuffer' }));
  console.log(JSON.stringify({ ok: true, out: args.out }));
} catch (err) {
  console.error(`[da-haetneundeyo] docx export failed: ${err?.message ?? err}`);
  process.exit(1);
}
```

Run: `npm run build:docx`
Expected: `scripts/export-docx.cjs` 생성 (번들, 커밋 대상)

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: report templates (ko/en) and docx export via docxtemplater"
```

---

### Task 12: 스킬 3종 (worklog / report / recall)

**Files:**
- Create: `skills/worklog/SKILL.md`, `skills/report/SKILL.md`, `skills/recall/SKILL.md`

**Interfaces:**
- Consumes: `journal-cli.mjs`(Task 8), `export-docx.cjs`·템플릿(Task 11), `reportsDir`/`config.json`
- Produces: `/worklog`, `/report`, `/recall` 사용자 커맨드

- [ ] **Step 1: skills/worklog/SKILL.md 작성**

````markdown
---
name: worklog
description: 오늘/이번 주 작업 일지를 조회하고 항목을 보완한다. 사용자가 "오늘 뭐 했지", "작업 일지", "worklog"를 요청할 때 사용.
---

# 작업 일지 (worklog)

## 조회

1. 기간 결정: 인자가 없으면 오늘, "week"면 이번 주 월~일. 날짜(YYYY-MM-DD)나 기간이 오면 그대로.
2. 다음을 실행해 일지를 가져온다 (sweep이 자동 포함되어 놓친 세션도 회수된다):
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" range --from <FROM> --to <TO>
   ```
3. 출력 형식 (시간순, 프로젝트는 config.json의 projectMap 이름으로 표시):
   ```
   📓 7/3 (금) — 세션 N건 (작업 N · 질의 N), 커밋 N건
   · [프로젝트 HH:MM-HH:MM] 요약 한 줄 → 커밋해시 (kind=work)
   · [프로젝트 HH:MM-HH:MM] 요약 한 줄 (질의 — 보고서 제외)
   ```
   - 요약 한 줄은 requests·filesEdited·commits를 종합해 만들되 추측을 섞지 말 것.
   - `kind=work`인데 `commits`가 빈 항목에는 `⏳ 미완료 추정` 표시.
   - `note`가 있으면 요약 대신 note를 우선 사용.

## 보완 (사용자가 메모/재분류를 원할 때)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" note --session <ID> --day <YYYY-MM-DD> --text "<메모>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/journal-cli.mjs" kind --session <ID> --day <YYYY-MM-DD> --value <work|qa>
```
반환 `{"ok":true}` 확인 후 갱신된 항목만 다시 보여준다.
````

- [ ] **Step 2: skills/report/SKILL.md 작성**

````markdown
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
7. 마지막에 `⚠️추정 항목 N건 — 해당 항목만 확인 후 제출하세요.`를 안내한다.

## --format docx

8. config의 `docxTemplate`이 없으면: md만 저장하고 "회사 양식을 등록하려면 `/report setup`"을 안내.
9. 있으면 `docxTemplate.fields`( `{ "docx플레이스홀더": "md섹션키" }` )에 따라 섹션 텍스트를 JSON으로 임시 파일에 쓰고:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/export-docx.cjs" --template <docxTemplate.path> --data <임시.json> --out <reports/기간.docx>
   ```
   `{"ok":true}` 확인 후 파일 경로를 안내한다.

## 설정 (/report setup)

1. 사용자에게 회사 양식 .docx 경로를 받아 `~/.claude/da-haetneundeyo/templates/`로 복사.
2. 양식 안에 `{금주실적}`처럼 중괄호 플레이스홀더를 넣도록 안내하고, 각 플레이스홀더가 어떤 섹션(achievements/next_plans/notes)인지 물어 `config.json`의 `docxTemplate: { path, fields }`에 저장.
3. `projectMap`도 함께 확인: 저널에 등장한 project 경로별로 업무명을 제안하고 사용자가 수정하면 저장.
````

- [ ] **Step 3: skills/recall/SKILL.md 작성**

````markdown
---
name: recall
description: 과거 작업을 검색한다. "그때 그거 어떻게 했지", "언제 했지", "recall" 등 과거 작업 회고 질문에 사용.
---

# 과거 작업 검색 (recall)

1. 질문에서 키워드를 뽑아 저널을 검색한다 (여러 키워드는 각각 실행):
   ```bash
   rg -i "<키워드>" "~/.claude/da-haetneundeyo/journal/" --no-heading
   ```
   (경로는 홈 디렉토리 확장에 주의 — 절대 경로로 치환해 실행)
2. 매칭된 다이제스트 줄만 파싱해 **인덱스 형태**로 먼저 보여준다 (항목당 1줄: 날짜, 프로젝트, 요약, 커밋해시).
3. 사용자가 특정 항목의 상세를 원할 때만:
   - 커밋 상세: `git -C <project> show --stat <hash>`
   - 세션 원문: `~/.claude/projects/`의 해당 `sessionId`.jsonl에서 관련 부분만 발췌 (전체 로드 금지)
   - 이어서 작업하려면 `claude --resume <sessionId>` 안내.
4. 검색 결과가 없으면 기간을 넓히거나 유사 키워드로 1회 재시도 후, 그래도 없으면 없다고 답한다.
````

- [ ] **Step 4: 스킬 frontmatter 검증**

Run: `node -e "const fs=require('fs');for(const s of ['worklog','report','recall']){const t=fs.readFileSync('skills/'+s+'/SKILL.md','utf8');if(!/^---\nname: /.test(t))throw new Error(s)};console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: worklog/report/recall skills"
```

---

### Task 13: README, 프라이버시 고지, 최종 검증

**Files:**
- Create: `README.md`
- Modify: `.claude-plugin/plugin.json` (keywords 추가 시)

**Interfaces:**
- Produces: 오픈소스 공개 가능한 문서 + 전체 테스트 그린

- [ ] **Step 1: README.md 작성** — 아래 섹션 필수, 한국어 본문 + 영어 요약(상단 1문단):

- 한 줄 소개(영/한): "Turns your Claude Code sessions into weekly/monthly work reports."
- 왜 필요한가 (AI가 일하고 사람이 보고하는 시대의 문제)
- 설치: `/plugin marketplace add <repo>` → `/plugin install da-haetneundeyo`
- 설치 후: 첫 세션에서 백필 안내가 나오는 것, `/worklog`, `/report weekly`, `/recall` 사용법과 예시 출력
- 회사 양식 등록: `/report setup`
- 동작 원리: Stop 훅 증분 캡처(토큰 0) → 저널(JSONL) → 보고서 시점에만 LLM. 다이어그램 1개.
- **프라이버시**: `~/.claude/da-haetneundeyo/journal/`에 프롬프트 원문이 저장됨. 이 디렉토리를 git 동기화할 경우 반드시 비공개 저장소 사용. 삭제 방법 안내.
- 요구사항: Node ≥ 20, Claude Code 최신
- 라이선스: MIT

- [ ] **Step 2: 전체 테스트 및 빌드 확인**

Run: `npm test && npm run build:docx && git status --short`
Expected: 전체 PASS, 빌드 산출물 변경 없음(이미 커밋됨)

- [ ] **Step 3: 실사용 스모크 테스트 (수동)**

1. `claude` 새 세션 시작 → `/plugin marketplace add D:\develop\da-haetneundeyo` → `/plugin install da-haetneundeyo@da-haetneundeyo`
2. 새 세션에서 아무 작업 1턴 수행 → `~/.claude/da-haetneundeyo/journal/`에 오늘 파일 생성 확인
3. `/worklog` → 방금 세션 표시 확인
4. `/report weekly` → md 생성 확인
Expected: 각 단계 정상. 실패 시 stderr 로그(`[da-haetneundeyo]`) 확인 후 수정.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: README with install guide and privacy notes"
```

---

## Self-Review 결과 (계획 작성 시 수행)

- **스펙 커버리지**: 캡처 3중 안전망(Task 6·8·9의 sweep + Task 7 훅), 저널 스키마·멱등 upsert(Task 5), qa/work 분류(Task 3), git 결합(Task 4), 온보딩 백필(Task 9), 템플릿·docx(Task 11), 스킬 3종(Task 12), 프라이버시 고지(Task 13) — 스펙 6절 커맨드 명세의 `/report setup`은 Task 12 report 스킬에 포함. 확장 포인트(PR API 등)는 MVP 제외로 계획에 없음(의도적).
- **타입 일관성**: Digest 필드명(`sessionId/project/branch/start/end/turns/requests/filesEdited/commands/commits/kind/note/completed`)을 Task 3 정의 그대로 5~12에서 사용. journal-cli 서브커맨드 계약(Task 8)과 스킬의 호출(Task 12) 일치 확인.
- **주의**: Claude Code hooks.json의 정확한 스키마(matcher 유무)는 구현 시 공식 문서로 재확인할 것 — Task 10 테스트가 구조를 고정하므로 문서와 다르면 테스트와 함께 수정.
