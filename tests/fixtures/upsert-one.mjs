import fs from 'node:fs';
import { upsertDigest } from '../../lib/journal.mjs';
import { emptyDigest } from '../../lib/transcript.mjs';

const [sessionId, gateFile] = process.argv.slice(2);

if (gateFile) {
  // Busy-wait until the gate file appears so all sibling processes race
  // upsertDigest at (as close to) the same instant as possible.
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(gateFile)) {
    if (Date.now() > deadline) throw new Error('gate timeout');
  }
}

const digest = {
  ...emptyDigest(sessionId),
  start: '2026-07-03T01:00:00Z',
  end: '2026-07-03T01:05:00Z',
  project: 'D:\\p',
  requests: [`요청-${sessionId}`],
};
upsertDigest(digest, process.env);
