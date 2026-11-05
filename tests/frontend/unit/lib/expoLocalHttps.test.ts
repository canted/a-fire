import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
const require = createRequire(import.meta.url);
const configure = require('../../../../frontend/app.config.cjs');
const { expo: base } = require('../../../../frontend/app.json');
afterEach(() => vi.unstubAllEnvs());
it('keeps the benchmark probe confined to local HTTPS builds', () => {
  vi.stubEnv('EXPO_PUBLIC_ROOM_BENCHMARK', '1');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://production.example/api');
  vi.stubEnv('EAS_BUILD', '');
  expect(() => configure({ config: base })).toThrow('Room benchmarking');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://localhost:8443/api');
  expect(() => configure({ config: base })).not.toThrow();
  vi.stubEnv('EAS_BUILD', 'true');
  expect(() => configure({ config: base })).toThrow('Room benchmarking');
});
it('leaves normal app identity and certificate trust unchanged', () => {
  vi.stubEnv('AFIRE_LOCAL_HTTPS_CA', '');
  const config = configure({ config: base });
  expect(config.ios.bundleIdentifier).toBe(base.ios.bundleIdentifier);
  expect(config.android.package).toBe(base.android.package);
  expect(config.scheme).toBe(base.scheme);
  expect(config.plugins.at(-1)).toEqual(['./plugins/local-https.cjs', { caFile: '' }]);
});
it('isolates the explicit localhost test build from the regular app', () => {
  vi.stubEnv('AFIRE_LOCAL_HTTPS_CA', '/tmp/public-root.pem');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://localhost:8443/api');
  vi.stubEnv('EAS_BUILD', '');
  const config = configure({ config: base });
  expect(config.android.package).toBe('co.canted.afire.preview.localhttps');
  expect(config.ios.bundleIdentifier).toBe('co.canted.afire.preview.localhttps');
  expect(config.scheme).toBe('afire-local-https');
});
it('rejects custom trust for cloud builds and nonlocal API destinations', () => {
  vi.stubEnv('AFIRE_LOCAL_HTTPS_CA', '/tmp/public-root.pem');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://localhost:8443/api');
  vi.stubEnv('EAS_BUILD', 'true');
  expect(() => configure({ config: base })).toThrow('only allowed in local builds');
  vi.stubEnv('EAS_BUILD', '');
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://production.example/api');
  expect(() => configure({ config: base })).toThrow('only allowed in local builds');
});
