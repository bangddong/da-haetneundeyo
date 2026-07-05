import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { tmpEnv } from './helpers.mjs';

test('returns defaults when config.json missing', () => {
  const { env } = tmpEnv();
  const cfg = loadConfig(env);
  assert.equal(cfg.language, 'ko');
  assert.deepEqual(cfg.projectMap, {});
  assert.equal(cfg.noiseMaxChars, 2000);
});

test('merges user config over defaults', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'),
    JSON.stringify({ projectMap: { 'D:\\develop\\demo-api': '주문 API' } }));
  const cfg = loadConfig(env);
  assert.equal(cfg.projectMap['D:\\develop\\demo-api'], '주문 API');
  assert.equal(cfg.language, 'ko');
});

test('returns defaults on corrupt config.json', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'), '{broken');
  assert.equal(loadConfig(env).language, 'ko');
});
