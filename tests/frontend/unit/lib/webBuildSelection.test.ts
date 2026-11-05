// @vitest-environment node
import { afterAll, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = process.cwd();
const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
const temporary = mkdtempSync(path.join(tmpdir(), 'afire-build-selection-'));
writeFileSync(path.join(temporary, 'pnpm'), '#!/bin/sh\nprintf "selected-pnpm:%s\\n" "$*"\n');
chmodSync(path.join(temporary, 'pnpm'), 0o755);
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
function run(frontend?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${temporary}:${process.env.PATH}`, EXPO_PUBLIC_API_URL: '' };
  delete env.AFIRE_FRONTEND;
  if (frontend) env.AFIRE_FRONTEND = frontend;
  return spawnSync('/bin/sh', ['-c', scripts['build:app']], { cwd: root, env, encoding: 'utf8' });
}
it.each([undefined, 'expo', 'vite', 'unknown'])('always uses the Expo release builder despite historical selection %s', frontend => {
  const result = run(frontend);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('EXPO_PUBLIC_API_URL must name the HTTPS production API');
  expect(result.stdout).not.toContain('selected-pnpm:');
});
