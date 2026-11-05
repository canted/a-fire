import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { seedExpoReading } from '../fixtures/expoReading';
import { latestOtp, closePrisma } from '../fixtures/otp';
import { ensureUser } from '../fixtures/factory';
import { prisma } from '../fixtures/database';
import { seedExpoBenchmark } from '../fixtures/expoBenchmark';

const [platform, device, mode] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: tsx tests/e2e/expo/run-local-https.ts ios|android DEVICE_ID');
const isolatedBenchmark = process.env.EXPO_ISOLATED_BENCHMARK === '1';
const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-local-https-${platform}`);
async function flow(name: string, parameters: Record<string, string> = {}) {
  await new Promise<void>((done, reject) => {
    const args = Object.entries(parameters).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', `${evidence}/${name}`, ...args, `tests/e2e/expo/${name}.yaml`], {
      stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${name} failed (${code})`)));
  });
}
try {
  const fixture = await seedExpoReading();
  const email = mode === 'benchmark' ? `expo-${platform}-${isolatedBenchmark ? 'performance' : 'benchmark'}@example.test` : mode === 'signed-out-link' ? `expo-${platform}-link@example.test` : 'expo-pilot@example.test';
  if (mode === 'benchmark') await seedExpoBenchmark(platform as 'ios' | 'android', isolatedBenchmark);
  if (mode === 'signed-out-link') {
    const user = await ensureUser(email, `${platform} link check`);
    if (!await prisma.roomMembership.findFirst({ where: { room_id: fixture.roomId, user_id: user } })) {
      const now = new Date();
      await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: user, created_at: now, updated_at: now } });
    }
  }
  const roomLink = `afire-local-https:///app/rooms/${fixture.roomId}/chat?message=${fixture.target.id}`;
  await flow('https-request-code', { EMAIL: email, ...(mode === 'signed-out-link' ? { ROOM_LINK: roomLink } : {}) });
  await flow('https-sign-in', { OTP: await latestOtp(email), ...(mode === 'signed-out-link' ? { EXPECTED_SCREEN: fixture.target.body } : {}) });
  if (mode !== 'benchmark') await flow('https-cold-link', {
    ROOM_LINK: roomLink,
    LATEST_MESSAGE: fixture.last!.body,
  });
  console.log(mode === 'benchmark' ? `PASS ${platform}: benchmark account signed in.` : `PASS ${platform}: release HTTPS sign-in${mode === 'signed-out-link' ? ' from a signed-out message link' : ''}, secure session restore and cold message link.`);
} finally { await closePrisma(); }
