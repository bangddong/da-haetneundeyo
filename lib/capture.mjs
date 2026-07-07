import fs from 'node:fs';
import path from 'node:path';
import { parseLine, applyRecords, emptyDigest, finalizeKind } from './transcript.mjs';
import { commitsSince, repoAuthorEmail } from './git.mjs';
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
