import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setExpoAccess } from '../fixtures/expoAccess';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: run-access.ts ios|android DEVICE_ID');
const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-access-transition-${platform}`);
// Sign in with run-local-https.ts benchmark first. Reuse that isolated account.
const viewer = await prisma.user.findFirstOrThrow({ where: { email: process.env.EXPO_ACCESS_EMAIL || `expo-${platform}-benchmark@example.test` } });
async function flow(name: string, stage: string, link: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', `${evidence}/${stage}`, '-e', `ROOM_LINK=${link}`, `tests/e2e/expo/${name}.yaml`], {
      stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${stage} failed (${code})`)));
  });
}
try {
  const fixture = await setExpoAccess('member', viewer.id);
  const link = `afire-local-https:///app/rooms/${fixture.roomId}/chat?message=${fixture.target.id}`;
  await flow('https-access-history', 'member', link);
  await setExpoAccess('visitor', viewer.id);
  await flow('https-access-downgraded', 'visitor', link);
  await setExpoAccess('member', viewer.id);
  await flow('https-access-history', 'restored', link);
  console.log(`PASS ${platform}: loaded history removed on downgrade and restored with membership; evidence ${evidence}`);
} finally {
  await setExpoAccess('member', viewer.id);
  await prisma.$disconnect();
}
