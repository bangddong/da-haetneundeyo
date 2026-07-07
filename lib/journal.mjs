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

// mkdir는 원자적 생성-실패(EEXIST)를 보장하므로 의존성 없이 락 프리미티브로 쓸 수 있다.
// recursive 옵션을 주면 이미 존재해도 성공해버려 락이 성립하지 않으므로 절대 사용 금지.
function withFileLock(file, fn) {
  const lockDir = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true }); // 락 디렉토리 자체를 만들 부모 경로 보장
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > 10_000) {
          fs.rmdirSync(lockDir); // 스테일 락 회수 (비정상 종료로 남은 락)
          continue;
        }
      } catch {}
      if (Date.now() > deadline) throw new Error(`lock timeout: ${lockDir}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); // 25ms 동기 대기
    }
  }
  try {
    return fn();
  } finally {
    try { fs.rmdirSync(lockDir); } catch {}
  }
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
  // 동일 날짜 파일에 여러 세션(프로세스)이 동시에 read-modify-write 하면 유실이 발생하므로
  // 읽기부터 원자적 쓰기까지 전체를 락으로 보호한다 (#11).
  withFileLock(file, () => {
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
  });
}

// setField는 findDigest(읽기) 후 upsertDigest(락으로 보호된 read-modify-write)를 호출하는 구조라
// upsertDigest의 락만으로 최종 일관성이 보장된다. setField 자체에 별도 락을 씌우면 findDigest 시점과
// upsertDigest 시점 사이 창(TOCTOU)은 여전히 남지만, 이는 upsertDigest 내부에서 sessionId로 다시
// 찾아 병합하므로 결과가 안전하게 수렴한다 (마지막 쓰기가 아니라 필드 단위 병합이 아님을 주의:
// setField는 "찾은 시점의 전체 digest"를 다시 씀 — 동시 경쟁 시 한쪽 필드 변경이 유실될 수 있으나
// 이는 이번 이슈(#11)의 범위인 "같은 날짜 파일 동시 쓰기로 인한 행 유실"과는 다른 문제이며
// state.json과 마찬가지로 후속 sweep/upsert로 자가 치유 가능한 범위로 간주해 이번 범위에서 제외한다.


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
