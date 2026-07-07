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

export function finalizeKind(digest) {
  digest.kind = digest.filesEdited.length === 0 && digest.commits.length === 0 ? 'qa' : 'work';
}
