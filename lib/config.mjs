import fs from 'node:fs';
import { configPath } from './paths.mjs';

export const DEFAULT_CONFIG = {
  language: 'ko',
  projectMap: {},
  noiseMaxChars: 2000,
  docxTemplate: null,
  gitAuthor: null,
  archive: false,
};

export function loadConfig(env = process.env) {
  try {
    const user = JSON.parse(fs.readFileSync(configPath(env), 'utf8'));
    return { ...DEFAULT_CONFIG, ...user };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
