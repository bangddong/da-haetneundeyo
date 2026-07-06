#!/usr/bin/env node
import { sweepProjects } from '../lib/capture.mjs';
import { readRange, setField } from '../lib/journal.mjs';

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
    if (!dayRe.test(args.from ?? '') || !dayRe.test(args.to ?? '')) {
      console.error('usage: journal-cli range --from YYYY-MM-DD --to YYYY-MM-DD');
      process.exit(1);
    }
    sweepProjects(process.env); // 최종 안전망
    out(readRange(args.from, args.to, process.env));
    break;
  }
  case 'note':
    out({ ok: setField(args.session, args.day, 'note', args.text, process.env) });
    break;
  case 'kind':
    out({ ok: setField(args.session, args.day, 'kind', args.value, process.env) });
    break;
  default:
    console.error('usage: journal-cli <sweep|backfill --days N|range --from D --to D|note --session S --day D --text T|kind --session S --day D --value V>');
    process.exit(1);
}
