// @vitest-environment node
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

it.each([
  { exported: undefined, configured: 'https://afire.app/api', expected: 'https://afire.app/api' },
  { exported: 'https://stage.example.test/api', configured: 'https://afire.app/api', expected: 'https://stage.example.test/api' },
  { exported: undefined, configured: 'http://localhost:4000/api', expected: null },
])('selects release configuration with environment precedence: $exported / $configured', ({ exported, configured, expected }) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'afire-release-env-'));
  try {
    mkdirSync(path.join(directory, 'bin'));
    mkdirSync(path.join(directory, 'frontend/node_modules/expo/bin'), { recursive: true });
    symlinkSync(path.resolve('node_modules'), path.join(directory, 'node_modules'), 'dir');
    for (const name of ['build-expo-web.mjs', 'compress-web-asset.mjs', 'expo-web-html.mjs']) {
      copyFileSync(path.resolve('bin', name), path.join(directory, 'bin', name));
    }
    writeFileSync(path.join(directory, '.env.production'), `EXPO_PUBLIC_API_URL=${configured}\n`);
    writeFileSync(path.join(directory, '.env'), 'EXPO_PUBLIC_API_URL=http://development.example:4000/api\n');
    // Observe the environment handed to Expo without exporting a real bundle.
    writeFileSync(path.join(directory, 'frontend/node_modules/expo/bin/cli'), 'console.log("expo-endpoint:" + process.env.EXPO_PUBLIC_API_URL); process.exit(13);');
    const env = { ...process.env };
    delete env.EXPO_PUBLIC_API_URL;
    if (exported !== undefined) env.EXPO_PUBLIC_API_URL = exported;
    const result = spawnSync(process.execPath, [path.join(directory, 'bin/build-expo-web.mjs')], { cwd: directory, env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    if (expected) {
      expect(result.stdout).toContain(`expo-endpoint:${expected}`);
      expect(result.stderr).toContain('Expo web export failed (13)');
    } else {
      expect(result.stdout).not.toContain('expo-endpoint:');
      expect(result.stderr).toContain('EXPO_PUBLIC_API_URL must name the HTTPS production API');
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
