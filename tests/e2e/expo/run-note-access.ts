import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prisma } from '../fixtures/database';

const [platform, device, noteId, body] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device || !/^\d+$/.test(noteId || '') || !body) {
  throw new Error('Usage: run-note-access.ts ios|android DEVICE NOTE_ID BODY_REGEX');
}
const evidence = resolve(process.env.EXPO_NATIVE_EVIDENCE || `/tmp/afire-note-access-${platform}`);
async function flow(stage: 'open' | 'loss' | 'restored') {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '-e', `NOTE_ID=${noteId}`, '-e', `NOTE_BODY=${body}`, '--test-output-dir', `${evidence}/${stage}`, `tests/e2e/expo/https-note-access-${stage}.yaml`], {
      stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' },
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${stage} failed (${code})`)));
  });
}
try {
  const viewer = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
  const note = await prisma.page.findUniqueOrThrow({ where: { id: Number(noteId) } });
  if (!note.title?.startsWith(`Expo ${platform} move source `) || !note.room_id) throw new Error('Expected a synthetic Note editing fixture');
  const memberships = await prisma.roomMembership.findMany({ where: { room_id: note.room_id, user_id: viewer.id } });
  if (!memberships.some(membership => !membership.disabled)) throw new Error('Expected active synthetic membership');
  await flow('open');
  try {
    await prisma.roomMembership.updateMany({ where: { id: { in: memberships.map(membership => membership.id) } }, data: { disabled: true } });
    await flow('loss');
  } finally {
    for (const membership of memberships) await prisma.roomMembership.update({ where: { id: membership.id }, data: { disabled: membership.disabled } });
  }
  await flow('restored');
  console.log(`PASS ${platform}: protected Note removed on access loss and restored by Retry.`);
} finally { await prisma.$disconnect(); }
