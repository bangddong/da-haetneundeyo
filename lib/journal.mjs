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
