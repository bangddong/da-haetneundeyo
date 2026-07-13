const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
export const EDIT_TOOL_NAMES = EDIT_TOOLS;

// 사용자 요청에서 노이즈로 간주해 완전히 제외하는 프리픽스 (trim 후 startsWith 검사).
const NOISE_PREFIXES = ['(local command', '<task-notification>', '<system-reminder>', '[Request interrupted'];

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
    kind: 'qa', note: null, cwdWindows: {},
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
  digest.cwdWindows ??= {}; // pre-0.1.5 journal digests lack this field
  const maxChars = opts.noiseMaxChars ?? 2000;
  for (const rec of records) {
    if (!rec || rec.isSidechain) continue;
    if (typeof rec.timestamp === 'string') {
      if (!digest.start || rec.timestamp < digest.start) digest.start = rec.timestamp;
      if (!digest.end || rec.timestamp > digest.end) digest.end = rec.timestamp;
    }
    if (typeof rec.cwd === 'string' && rec.cwd && typeof rec.timestamp === 'string') {
      const w = (digest.cwdWindows[rec.cwd] ??= { start: rec.timestamp, end: rec.timestamp });
      if (rec.timestamp < w.start) w.start = rec.timestamp;
      if (rec.timestamp > w.end) w.end = rec.timestamp;
    }
    if (typeof rec.gitBranch === 'string' && rec.gitBranch) digest.branch = rec.gitBranch;

    if (rec.type === 'user' && rec.message && !rec.isMeta) {
      const text = textOf(rec.message.content).trim();
      const excluded = !text || NOISE_PREFIXES.some((p) => text.startsWith(p));
      if (!excluded) {
        const stored = text.length > maxChars
          ? `${text.slice(0, 300)} …(전체 ${text.length}자 생략)`
          : text;
        if (!digest.requests.includes(stored)) {
          digest.requests.push(stored);
          digest.turns += 1;
        }
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

// digest.project를 cwdWindows 기준 "지배적 cwd"(구간 end-start 총합이 가장 긴 cwd)로 결정한다.
// 동률이면 end 타임스탬프가 가장 늦은(=마지막으로 관측된) cwd를 택한다. applyRecords 도중이 아니라
// capture 쪽에서 레코드 반영이 끝난 뒤 한 번 호출하는 것이 안전하다(증분 캡처마다 재계산해도 멱등).
export function finalizeProject(digest) {
  const entries = Object.entries(digest.cwdWindows);
  if (entries.length === 0) return;
  let best = null;
  let bestSpan = -1;
  for (const [cwd, w] of entries) {
    const span = Date.parse(w.end) - Date.parse(w.start);
    if (span > bestSpan || (span === bestSpan && w.end > best[1].end)) {
      best = [cwd, w];
      bestSpan = span;
    }
  }
  digest.project = best[0];
}

export function finalizeKind(digest) {
  digest.kind = digest.filesEdited.length === 0 && digest.commits.length === 0 ? 'qa' : 'work';
}

// 세션 아키타입 (#2): 지속시간 기반 분류. kind(work/qa)와 직교하는 축으로, 보고서 스킬이
// "marathon인데 커밋 0 = 대형 WIP → 차주계획 최우선" 같은 추론에 쓴다. 경계값은 실데이터
// (도그푸딩 저널 55세션) 분포를 참고해 정함: 15분 미만이면 quick(질의·핫픽스), 2시간까지
// standard(통상 작업 단위), 6시간까지 deep, 그 이상은 marathon(하루를 관통하는 세션).
export function finalizeArchetype(digest) {
  if (!digest.start || !digest.end) {
    digest.archetype = null;
    return;
  }
  const minutes = (Date.parse(digest.end) - Date.parse(digest.start)) / 60_000;
  digest.archetype =
    minutes < 15 ? 'quick' :
    minutes < 120 ? 'standard' :
    minutes < 360 ? 'deep' : 'marathon';
}
