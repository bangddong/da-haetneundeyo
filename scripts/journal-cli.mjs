#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sweepProjects } from '../lib/capture.mjs';
import { readRange, setField } from '../lib/journal.mjs';
import { readArchive, archiveSession } from '../lib/archive.mjs';
import { loadConfig } from '../lib/config.mjs';
import { projectsDirs } from '../lib/paths.mjs';

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
  case 'kind': {
    const ok = setField(args.session, args.day, 'kind', args.value, process.env);
    if (ok && args.value === 'work' && loadConfig(process.env).archive) {
      // work로 재분류된 세션은 다음 sweep을 기다리지 않고 즉시 아카이브를 시도한다 — 그렇지 않으면
      // 재분류 시점과 다음 sweep(또는 cleanupPeriodDays 경과로 원본 삭제) 사이의 갭 동안 아카이브가
      // 영영 생성되지 않을 수 있다. stdout 계약(JSON 한 줄, {ok})은 절대 건드리지 않고 실패는
      // stderr로만 로그한다.
      try {
        let transcriptPath = null;
        for (const dir of projectsDirs(process.env)) {
          let projects = [];
          try { projects = fs.readdirSync(dir); } catch { continue; }
          for (const proj of projects) {
            const candidate = path.join(dir, proj, `${args.session}.jsonl`);
            if (fs.existsSync(candidate)) { transcriptPath = candidate; break; }
          }
          if (transcriptPath) break;
        }
        if (transcriptPath) archiveSession(transcriptPath, args.session, args.day, process.env);
      } catch (err) {
        console.error(`[da-haetneundeyo] archive-on-reclassify skip ${args.session}: ${err?.message ?? err}`);
      }
    }
    out({ ok });
    break;
  }
  case 'pr-outcomes': {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dayRe.test(args.from ?? '') || !dayRe.test(args.to ?? '')) {
      console.error('usage: journal-cli pr-outcomes --from YYYY-MM-DD --to YYYY-MM-DD');
      process.exit(1);
    }
    if (!loadConfig(process.env).prOutcomes) {
      out({ ok: false, reason: 'disabled — set "prOutcomes": true in config.json to enable' });
      break;
    }
    const { collectPrOutcomes } = await import('../lib/github.mjs');
    const entries = readRange(args.from, args.to, process.env);
    const { prs } = collectPrOutcomes(entries);
    out({ ok: true, prs });
    break;
  }
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
    console.error('usage: journal-cli <sweep|backfill --days N|range --from D --to D [--kind work|qa]|note --session S --day D --text T|kind --session S --day D --value V|archive-read --session S --day D|pr-outcomes --from D --to D>');
    process.exit(1);
}
