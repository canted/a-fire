import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { seedExpoPilot } from '../fixtures/expoPilot';
import { latestOtp, closePrisma } from '../fixtures/otp';

// The fixture database module enforces TEST_DATABASE_URL before any writes.
// Run against the same isolated test database as the local API process.
const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) {
  throw new Error('Usage: tsx tests/e2e/expo/run-native.ts ios|android DEVICE_ID');
}
const executable = process.env.MAESTRO_BIN || 'maestro';
const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-expo-${platform}`);
const origin = platform === 'android' ? 'http://10.0.2.2:8082' : 'http://localhost:8082';
const parameters = {
  METRO_ORIGIN: origin,
  DEV_CLIENT_URL: `afire-preview://expo-development-client/?url=${encodeURIComponent(origin)}`,
  MESSAGE: `Native ${platform} Room check ${Date.now()}`,
  DRAFT: `Unsent ${platform} draft`,
};
async function flow(name: string, extra: Record<string, string> = {}) {
  await new Promise<void>((resolveRun, reject) => {
    const args = Object.entries({ ...parameters, ...extra }).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
    const child = spawn(executable, ['--device', device, 'test', '--test-output-dir', `${evidence}/${name}-run`, ...args, `tests/e2e/expo/${name}.yaml`], {
      stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`Maestro ${name} exited ${code}`)));
  });
}
try {
  await mkdir(evidence, { recursive: true });
  await seedExpoPilot();
  await flow('request-code');
  await flow('room', { OTP: await latestOtp('expo-pilot@example.test') });
  await flow('session');
  await flow('keyboard');
  await flow('history');
} finally {
  await closePrisma();
}
