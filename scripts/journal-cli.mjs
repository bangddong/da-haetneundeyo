#!/usr/bin/env node
import { sweepProjects } from '../lib/capture.mjs';
import { readRange, setField } from '../lib/journal.mjs';
import { readArchive } from '../lib/archive.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) {
  args[rest[i].replace(/^--/, '')] = rest[i + 1];
}

const out = (v) => process.stdout.write(JSON.stringify(v) + '\n');

switch (cmd) {
  case 'sweep':
    out(sweepProjects(process.env));
    break;
  case 'backfill':
    out(sweepProjects(process.env, { days: Number(args.days ?? 30) }));
    break;
  case 'range': {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    const kindRe = /^(work|qa)$/;
    if (!dayRe.test(args.from ?? '') || !dayRe.test(args.to ?? '') || (args.kind != null && !kindRe.test(args.kind))) {
      console.error('usage: journal-cli range --from YYYY-MM-DD --to YYYY-MM-DD [--kind work|qa]');
      process.exit(1);
    }
    sweepProjects(process.env); // 최종 안전망
    const entries = readRange(args.from, args.to, process.env);
    out(args.kind ? entries.filter((d) => d.kind === args.kind) : entries);
    break;
  }
  case 'note':
    out({ ok: setField(args.session, args.day, 'note', args.text, process.env) });
    break;
  case 'kind':
    out({ ok: setField(args.session, args.day, 'kind', args.value, process.env) });
    break;
  case 'archive-read': {
    const records = readArchive(args.session, args.day, process.env);
    if (records === null) {
      out({ ok: false, reason: 'not archived' });
    } else {
      for (const r of records) process.stdout.write(JSON.stringify(r) + '\n');
    }
    break;
  }
  default:
    console.error('usage: journal-cli <sweep|backfill --days N|range --from D --to D [--kind work|qa]|note --session S --day D --text T|kind --session S --day D --value V|archive-read --session S --day D>');
    process.exit(1);
}
