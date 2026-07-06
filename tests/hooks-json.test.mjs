import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('hooks.json registers Stop, SessionEnd, SessionStart with plugin-root commands', () => {
  const raw = fs.readFileSync(fileURLToPath(new URL('../hooks/hooks.json', import.meta.url)), 'utf8');
  const cfg = JSON.parse(raw);
  for (const event of ['Stop', 'SessionEnd', 'SessionStart']) {
    const entries = cfg.hooks[event];
    assert.ok(Array.isArray(entries) && entries.length === 1, `${event} registered`);
    const hook = entries[0].hooks[0];
    assert.equal(hook.type, 'command');
    assert.match(hook.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.ok(hook.timeout >= 30);
  }
});
