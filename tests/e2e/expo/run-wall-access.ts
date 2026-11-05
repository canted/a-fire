import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) {
  throw new Error('Usage: run-wall-access.ts ios|android DEVICE');
}
const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-wall-access-${platform}`);
let roomId: number;
let wallId: number;
async function flow(stage: 'open' | 'loss' | 'restored') {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '-e', `ROOM_ID=${roomId}`, '-e', `WALL_ID=${wallId}`, '--test-output-dir', `${evidence}/${stage}`, `tests/e2e/expo/https-wall-access-${stage}.yaml`], {
      stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${stage} failed (${code})`)));
  });
}
try {
  const viewer = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
  const wall = await prisma.roundResult.findFirstOrThrow({ where: { title: 'Synthetic Room Wall', room: { name: 'Expo Wall parity' } } });
  roomId = wall.room_id; wallId = wall.id;
  const memberships = await prisma.roomMembership.findMany({ where: { room_id: roomId, user_id: viewer.id } });
  if (!memberships.some(membership => !membership.disabled)) throw new Error('Expected active synthetic membership');
  await flow('open');
  try {
    await prisma.roomMembership.updateMany({ where: { id: { in: memberships.map(membership => membership.id) } }, data: { disabled: true } });
    await flow('loss');
  } finally {
    for (const membership of memberships) await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: membership.disabled } });
  }
  await flow('restored');
  console.log(`PASS ${platform}: protected Wall removed on access loss and restored by Retry.`);
} finally { await prisma.$disconnect(); }
