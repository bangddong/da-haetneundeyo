import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { dataDir } from './paths.mjs';

// applyRecords와 같은 텍스트 추출 규칙(문자열 or text 블록, tool_result 제외)이지만
// 절단(300자 요약) 없이 원문을 그대로 보존한다 — 아카이브는 30일 경과 후의 유일한 원문 백업이므로.
function userTextOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === 'tool_result')) return '';
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text).join('\n');
  }
  return '';
}

// assistant 메시지는 tool_use/thinking 블록을 제외하고 text 블록만 join한다.
function assistantTextOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text).join('\n');
}

export function archivePath(day, sessionId, env) {
  return path.join(dataDir(env), 'archive', day.slice(0, 4), day.slice(5, 7), `${sessionId}.jsonl.gz`);
}

// transcript에서 user/assistant 텍스트만 추출해 <dataDir>/archive/YYYY/MM/<sessionId>.jsonl.gz로 저장한다.
// 이미 아카이브가 존재하고 원본 mtime보다 최신이면(즉 원본이 그 이후로 바뀌지 않았으면) 재작성을
// 건너뛰고 false를 반환한다. 새로 (재)작성했으면 true를 반환한다.
export function archiveSession(transcriptPath, sessionId, day, env = process.env) {
  const out = archivePath(day, sessionId, env);
  try {
    const outStat = fs.statSync(out);
    const srcStat = fs.statSync(transcriptPath);
    if (outStat.mtimeMs >= srcStat.mtimeMs) return false;
  } catch {} // 아카이브 없음 → 새로 생성 진행

  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // 파싱 실패 줄 스킵
    }
    if (!rec || typeof rec !== 'object' || rec.isSidechain) continue;
    const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null;

    if (rec.type === 'user' && rec.message && !rec.isMeta) {
      const text = userTextOf(rec.message.content).trim();
      if (text) records.push({ role: 'user', ts, text });
    } else if (rec.type === 'assistant' && rec.message) {
      const text = assistantTextOf(rec.message.content).trim();
      if (text) records.push({ role: 'assistant', ts, text });
    }
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  fs.writeFileSync(out, zlib.gzipSync(body));
  return true;
}

// archivePath의 gz를 풀어 {role, ts, text} 레코드 배열을 반환한다. 없으면 null.
export function readArchive(sessionId, day, env = process.env) {
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(archivePath(day, sessionId, env))).toString('utf8');
    return raw.trim().length ? raw.trim().split('\n').map((l) => JSON.parse(l)) : [];
  } catch {
    return null;
  }
}
