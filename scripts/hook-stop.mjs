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
