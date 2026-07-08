import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolvedReportsDir } from '../lib/config.mjs';
import { dataDir } from '../lib/paths.mjs';
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
    JSON.stringify({ projectMap: { 'D:\\work\\demo-api': '주문 API' } }));
  const cfg = loadConfig(env);
  assert.equal(cfg.projectMap['D:\\work\\demo-api'], '주문 API');
  assert.equal(cfg.language, 'ko');
});

test('returns defaults on corrupt config.json', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'), '{broken');
  assert.equal(loadConfig(env).language, 'ko');
});

test('resolvedReportsDir defaults to <dataDir>/reports when config.reportsDir is unset', () => {
  const { env } = tmpEnv();
  assert.equal(resolvedReportsDir(env), path.join(dataDir(env), 'reports'));
});

test('resolvedReportsDir uses config.reportsDir when set', () => {
  const { env } = tmpEnv();
  fs.mkdirSync(env.DHND_DATA_DIR, { recursive: true });
  const custom = path.join(env.DHND_DATA_DIR, 'custom-reports');
  fs.writeFileSync(path.join(env.DHND_DATA_DIR, 'config.json'),
    JSON.stringify({ reportsDir: custom }));
  assert.equal(resolvedReportsDir(env), custom);
});
