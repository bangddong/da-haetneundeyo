import fs from 'node:fs';
import path from 'node:path';
import { configPath, dataDir } from './paths.mjs';

export const DEFAULT_CONFIG = {
  language: 'ko',
  projectMap: {},
  noiseMaxChars: 2000,
  docxTemplate: null,
  gitAuthor: null,
  archive: false,
  reportsDir: null,
};

export function loadConfig(env = process.env) {
  try {
    const user = JSON.parse(fs.readFileSync(configPath(env), 'utf8'));
    return { ...DEFAULT_CONFIG, ...user };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// 사용자가 config.json에 reportsDir을 지정했으면 그 경로를, 아니면 기본 위치
// (<dataDir>/reports, 예: OneDrive 등 클라우드 동기화 폴더가 아닌 로컬 기본값)를 돌려준다 (#15).
export function resolvedReportsDir(env = process.env) {
  return loadConfig(env).reportsDir || path.join(dataDir(env), 'reports');
}
