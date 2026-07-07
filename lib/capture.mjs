import fs from 'node:fs';
import path from 'node:path';
import { parseLine, applyRecords, emptyDigest, finalizeKind, EDIT_TOOL_NAMES } from './transcript.mjs';
import { commitsSince, repoAuthorEmail } from './git.mjs';
import { loadState, saveState, upsertDigest, findDigest, dayOf } from './journal.mjs';
import { loadConfig } from './config.mjs';
import { projectsDirs } from './paths.mjs';
import { archiveSession } from './archive.mjs';

// 증분 파싱 헬퍼: 파일의 [offset, EOF) 구간에서 완결된(개행 종료) 라인만 읽고
// 소비한 바이트 수와 파싱된 레코드를 함께 돌려준다. transcriptPath 본문과
// 서브에이전트 파일 모두에서 재사용한다.
function readIncremental(filePath, offset) {
  const size = fs.statSync(filePath).size;
  if (size <= offset) return null;
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);

  const chunk = buf.toString('utf8');
  const lastNl = chunk.lastIndexOf('\n');
  if (lastNl === -1) return null;
  const completeText = chunk.slice(0, lastNl + 1);
  const consumed = Buffer.byteLength(completeText, 'utf8');
  const records = completeText.split('\n').filter(Boolean).map(parseLine).filter(Boolean);
  return { records, consumed };
}

// 부모 세션에 연결된 서브에이전트 transcript 파일들을 찾는다. 알려진 두 레이아웃을 모두 지원:
//  ① 부모와 같은 디렉토리의 `agent-*.jsonl` (첫 완결 레코드의 sessionId로 부모 매칭)
//  ② `<부모 sessionId>/subagents/*.jsonl` (경로 자체로 부모가 확정됨)
// 실측(2026-07, Windows, Claude Code 2.1.x): 이 머신에서는 ①은 관측되지 않았고 ②만 존재했다.
// 두 레이아웃 모두 지원해 다른 버전/환경에서도 동작하도록 한다.
function findSubagentFiles(transcriptPath, sessionId) {
  const dir = path.dirname(transcriptPath);
  const found = [];

  // 패턴 ②: <dir>/<sessionId>/subagents/*.jsonl
  const subagentsDir = path.join(dir, sessionId, 'subagents');
  try {
    for (const f of fs.readdirSync(subagentsDir)) {
      if (f.endsWith('.jsonl')) found.push(path.join(subagentsDir, f));
    }
  } catch {} // 디렉토리 없음 = 서브에이전트 없음 (정상)

  // 패턴 ①: <dir>/agent-*.jsonl, 첫 레코드의 sessionId로 부모 매칭
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('agent-') || !f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      const firstLine = firstCompleteLine(full);
      if (!firstLine) continue;
      const rec = parseLine(firstLine);
      if (rec && rec.sessionId === sessionId) found.push(full);
    }
  } catch {}

  return found;
}

function firstCompleteLine(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const nl = content.indexOf('\n');
  return nl === -1 ? null : content.slice(0, nl);
}

// 서브에이전트 파일에서는 파일 수정 도구(Edit/Write/MultiEdit/NotebookEdit)의 file_path만 추출한다.
// 서브에이전트의 요청/명령/대화는 노이즈이므로 계속 제외한다 (#10 명세).
function extractEditedFiles(records) {
  const files = [];
  for (const rec of records) {
    if (!rec || rec.type !== 'assistant' || !rec.message || !Array.isArray(rec.message.content)) continue;
    for (const block of rec.message.content) {
      if (!block || block.type !== 'tool_use' || !block.input) continue;
      if (EDIT_TOOL_NAMES.has(block.name) && typeof block.input.file_path === 'string') {
        files.push(block.input.file_path);
      }
    }
  }
  return files;
}

// digest.filesEdited에 새로 추가된 파일이 하나라도 있으면 true를 돌려준다 (호출부가 "새 바이트
// 없음 → null 반환" 계약을 유지할지 판단하는 데 사용).
function mergeSubagentEdits(digest, sessionId, transcriptPath, state) {
  let files;
  try {
    files = findSubagentFiles(transcriptPath, sessionId);
  } catch (err) {
    console.error(`[da-haetneundeyo] subagent discovery failed for ${sessionId}: ${err?.message ?? err}`);
    return false;
  }

  let changed = false;
  for (const agentFile of files) {
    const key = `${sessionId}#${path.basename(agentFile)}`;
    try {
      const sess = state.sessions[key] ?? { offset: 0 };
      const result = readIncremental(agentFile, sess.offset);
      if (!result) continue;
      const edited = extractEditedFiles(result.records);
      for (const f of edited) {
        if (!digest.filesEdited.includes(f)) {
          digest.filesEdited.push(f);
          changed = true;
        }
      }
      state.sessions[key] = { offset: sess.offset + result.consumed };
    } catch (err) {
      console.error(`[da-haetneundeyo] skip subagent file ${agentFile}: ${err?.message ?? err}`);
    }
  }
  return changed;
}

export function captureTranscript({ sessionId, transcriptPath, complete = false }, env = process.env) {
  const state = loadState(env);
  const sess = state.sessions[sessionId] ?? { offset: 0, day: null };
  const result = readIncremental(transcriptPath, sess.offset);

  const config = loadConfig(env);
  const digest = (sess.day && findDigest(sessionId, sess.day, env)) || emptyDigest(sessionId);

  if (result) {
    applyRecords(digest, result.records, { noiseMaxChars: config.noiseMaxChars });
  }

  const subagentChanged = mergeSubagentEdits(digest, sessionId, transcriptPath, state);

  if (!result && !subagentChanged) {
    // 메인 transcript도 새 바이트가 없고 서브에이전트 병합으로도 변화가 없으면 기존 계약대로 null.
    return null;
  }

  if (digest.project && digest.start) {
    const author = config.gitAuthor
      ?? (state.authors ??= {})[digest.project]
      ?? repoAuthorEmail(digest.project);
    if (author && !config.gitAuthor) state.authors[digest.project] = author; // 저장소별 캐시 (git 스폰 절약)
    const commits = commitsSince(digest.project, digest.start, digest.end, author);
    if (commits !== null) digest.commits = commits;
  }
  if (complete) digest.completed = true;
  finalizeKind(digest);

  upsertDigest(digest, env);
  state.sessions[sessionId] = { offset: sess.offset + (result?.consumed ?? 0), day: dayOf(digest) };
  saveState(state, env);
  return digest;
}

export function sweepProjects(env = process.env, { sinceMs, days } = {}) {
  const state = loadState(env);
  const cutoff = sinceMs ?? (days != null
    ? Date.now() - days * 86400_000
    : state.lastSweepMs);
  const config = loadConfig(env);
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
          const sessionId = path.basename(f, '.jsonl');
          const d = captureTranscript({ sessionId, transcriptPath: full }, env);
          if (d) processed += 1;
          if (d && config.archive && d.kind === 'work') {
            try {
              archiveSession(full, sessionId, dayOf(d), env);
            } catch (err) {
              console.error(`[da-haetneundeyo] archive skip ${f}: ${err?.message ?? err}`);
            }
          }
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
