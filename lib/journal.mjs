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
//
// 락 디렉토리 안에 owner 파일(`${pid}:${Date.now()}`)을 남겨 소유권을 기록한다. 스테일 락을
// 회수(rmdir 후 재획득)한 뒤에는 owner 토큰이 바뀌므로, release 시점에 owner 파일이 여전히
// "이 프로세스가 이번에 획득한 토큰"과 일치할 때만 rmdir한다 — 그래야 A가 스테일로 판정되어
// B가 회수한 락을 A의 (지연된) finally가 실수로 지우는 일이 없다.
function withFileLock(file, fn) {
  const lockDir = `${file}.lock`;
  const ownerFile = path.join(lockDir, 'owner');
  fs.mkdirSync(path.dirname(file), { recursive: true }); // 락 디렉토리 자체를 만들 부모 경로 보장
  const deadline = Date.now() + 5000; // 이 값은 항상 훅의 DHND_HOOK_TIMEOUT_MS(기본 10s)보다 작아야 한다
                                       // — 아래 Atomics.wait는 이벤트 루프를 블록하므로 훅의 fail-safe
                                       // 타이머가 락 대기 중에는 발동할 수 없다 (setTimeout도 못 돈다).
  let token;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      token = `${process.pid}:${Date.now()}`;
      fs.writeFileSync(ownerFile, token);
      break;
    } catch (err) {
      // Windows에서는 다른 프로세스가 lockDir을 rename/rmSync로 지우는 도중(파일시스템이 삭제를
      // 아직 확정하지 못한 "삭제 대기" 상태) 같은 경로에 mkdirSync를 시도하면 EEXIST 대신 EPERM/
      // EACCES가 나는 경우가 있다 — POSIX의 EEXIST와 동일하게 "지금은 못 만든다, 잠시 후 재시도"로
      // 취급한다. 그 외 에러 코드는 진짜 예외이므로 그대로 던진다.
      if (err.code !== 'EEXIST' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
      try {
        if (Date.now() - fs.statSync(lockDir).mtimeMs > 10_000) {
          // 스테일 락 회수 (비정상 종료로 남은 락). unlinkSync(owner)+rmdirSync(lockDir)는
          // 두 번의 non-atomic syscall이라 동시에 여러 리클레이머가 진입하면 인터리빙될 수 있다
          // (리클레이머 C가 리클레이머 B의 새 락을 지워버려 B가 임계구역 안에 있는 동안 C도
          // 진입하는 이중 획득이 발생). rename은 원자적이라 정확히 하나의 리클레이머만 성공한다 —
          // 성공한 쪽만 트래시로 옮긴 뒤 지우고 continue해 재획득을 시도하고, 실패한 쪽(레이스에서
          // 지거나 그 사이 디렉토리가 이미 사라진 경우)도 조용히 continue해 루프 상단에서 다시
          // mkdirSync를 시도한다.
          const trash = `${lockDir}.stale-${process.pid}-${Date.now()}`;
          try {
            fs.renameSync(lockDir, trash);
            fs.rmSync(trash, { recursive: true, force: true });
          } catch {} // 레이스에서 지거나 디렉토리가 이미 사라짐 — 재시도 루프로 진행
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
    try {
      if (fs.readFileSync(ownerFile, 'utf8') === token) {
        fs.unlinkSync(ownerFile); // rmdir requires an empty dir
        fs.rmdirSync(lockDir);
      }
    } catch {}
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

// 세션 다이제스트는 시작일 파일(dayOf = start의 날짜)에만 적재되므로, 주 경계를 넘겨 계속된
// 세션은 시작일이 조회 창 밖이면 통째로 누락됐다 (#19). 이를 막기 위해 창 시작 이전으로
// LOOKBACK_DAYS 만큼 더 거슬러 올라가 파일을 읽고, "종료가 fromDay 이후"인(=창과 겹치는)
// 세션만 포함한다. 존재하지 않는 날짜 파일 읽기는 비용이 없다(빈 배열 반환).
// LOOKBACK_DAYS는 Claude Code 기본 transcript 보존 기간(cleanupPeriodDays≈30일)을 상한으로 잡아
// 그 안에서 도달 가능한 어떤 장기 세션도 커버한다.
const LOOKBACK_DAYS = 31;

export function readRange(fromDay, toDay, env) {
  const out = [];
  const cur = new Date(`${fromDay}T00:00:00Z`);
  cur.setUTCDate(cur.getUTCDate() - LOOKBACK_DAYS);
  const end = new Date(`${toDay}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.toISOString().slice(0, 10);
    for (const line of readLines(dayFilePath(day, env))) {
      const d = parseDigestLine(line);
      if (!d) continue;
      // 겹침 판정: 종료(없으면 시작)가 창 시작일 이후여야 한다. 문자열 비교로 충분하다 —
      // ISO 종료 타임스탬프는 같은 날 00:00(fromDay)보다 사전순으로 크거나 같기 때문.
      const effectiveEnd = d.end ?? d.start ?? day;
      if (effectiveEnd < fromDay) continue;
      out.push(d);
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
