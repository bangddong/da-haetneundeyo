import fs from 'node:fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];

if (!args.template || !args.data || !args.out) {
  console.error('usage: export-docx --template <docx> --data <json> --out <docx>');
  process.exit(1);
}

try {
  const zip = new PizZip(fs.readFileSync(args.template));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
    nullGetter: () => '',
  });
  doc.render(JSON.parse(fs.readFileSync(args.data, 'utf8').replace(/^﻿/, '')));
  fs.writeFileSync(args.out, doc.getZip().generate({ type: 'nodebuffer' }));
  console.log(JSON.stringify({ ok: true, out: args.out }));
} catch (err) {
  if (err?.properties?.errors) {
    console.error(`[da-haetneundeyo] docx export failed: ${err?.message ?? err}`);
    for (const subErr of err.properties.errors) {
      console.error(`[da-haetneundeyo] ${subErr?.properties?.explanation ?? subErr?.message ?? subErr}`);
    }
  } else {
    console.error(`[da-haetneundeyo] docx export failed: ${err?.message ?? err}`);
  }
  process.exit(1);
}
