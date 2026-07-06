import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';

const script = fileURLToPath(new URL('../scripts/export-docx.cjs', import.meta.url));

function makeFixtureDocx(dir) {
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>{금주실적}</w:t></w:r></w:p></w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
  const zip = new PizZip();
  zip.file('[Content_Types].xml', types);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', docXml);
  const file = path.join(dir, 'template.docx');
  fs.writeFileSync(file, zip.generate({ type: 'nodebuffer' }));
  return file;
}

test('fills placeholder in docx template', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-docx-'));
  const template = makeFixtureDocx(dir);
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, JSON.stringify({ 금주실적: '결재선 버그 수정 (b2c3d4e)' }));
  const outFile = path.join(dir, 'out.docx');
  const r = spawnSync(process.execPath, [script,
    '--template', template, '--data', dataFile, '--out', outFile], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const outZip = new PizZip(fs.readFileSync(outFile));
  const xml = outZip.file('word/document.xml').asText();
  assert.match(xml, /결재선 버그 수정/);
  assert.doesNotMatch(xml, /\{금주실적\}/);
});

test('fills placeholder when data JSON has a leading BOM', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhnd-docx-'));
  const template = makeFixtureDocx(dir);
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, '﻿' + JSON.stringify({ 금주실적: '결재선 버그 수정 (b2c3d4e)' }));
  const outFile = path.join(dir, 'out.docx');
  const r = spawnSync(process.execPath, [script,
    '--template', template, '--data', dataFile, '--out', outFile], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const outZip = new PizZip(fs.readFileSync(outFile));
  const xml = outZip.file('word/document.xml').asText();
  assert.match(xml, /결재선 버그 수정/);
  assert.doesNotMatch(xml, /\{금주실적\}/);
});

test('missing args exit 1 with usage', () => {
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/i);
});
