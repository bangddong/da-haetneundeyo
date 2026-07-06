#!/usr/bin/env node
import { captureTranscript } from '../lib/capture.mjs';

// Fail-safe: a hook must never block Claude Code, even if stdin never closes.
const failSafeMs = Number(process.env.DHND_HOOK_TIMEOUT_MS ?? 10_000);
const failSafe = setTimeout(() => process.exit(0), failSafeMs);

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
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
clearTimeout(failSafe);
process.exit(0);
