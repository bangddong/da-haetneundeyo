import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const commands = [
  { file: 'report.md', skill: 'da-haetneundeyo:report' },
  { file: 'worklog.md', skill: 'da-haetneundeyo:worklog' },
  { file: 'recall.md', skill: 'da-haetneundeyo:recall' },
];

for (const { file, skill } of commands) {
  test(`commands/${file} exists with description frontmatter and delegates to ${skill}`, () => {
    const full = fileURLToPath(new URL(`../commands/${file}`, import.meta.url));
    assert.ok(fs.existsSync(full), `${file} should exist`);
    const raw = fs.readFileSync(full, 'utf8');
    assert.match(raw, /^---\r?\n[\s\S]*?description:\s*.+\r?\n[\s\S]*?---/, 'has description in frontmatter');
    assert.ok(raw.includes(skill), `body mentions ${skill}`);
  });
}
