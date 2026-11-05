import { spawn } from 'node:child_process';
import { seedExpoRichContent } from '../fixtures/expoRichContent';
import { prisma } from '../fixtures/database';

const [platform, device] = process.argv.slice(2);
if (!['ios', 'android'].includes(platform) || !device) throw new Error('Usage: run-media-access.ts ios|android DEVICE_ID');
const fixture = await seedExpoRichContent();
const viewer = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
const memberships = await prisma.roomMembership.findMany({ where: { room_id: fixture.roomId, user_id: viewer.id } });
const invitations = await prisma.roomMemberInvitation.findMany({ where: { room_id: fixture.roomId, user_id: viewer.id } });
async function flow(name: string) {
  await new Promise<void>((done, reject) => {
    const child = spawn(process.env.MAESTRO_BIN || 'maestro', ['--device', device, 'test', '--test-output-dir', `/tmp/afire-media-access-${platform}/${name}`, '-e', `ROOM_LINK=afire-local-https:///app/rooms/${fixture.roomId}/chat`, `tests/e2e/expo/${name}.yaml`], { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done() : reject(new Error(`${platform} ${name} failed (${code})`)));
  });
}
try {
  await flow('https-media-loaded');
  await prisma.$transaction([
    prisma.roomMembership.updateMany({ where: { id: { in: memberships.map(row => row.id) } }, data: { disabled: true } }),
    prisma.roomMemberInvitation.updateMany({ where: { id: { in: invitations.map(row => row.id) } }, data: { status: 'declined' } }),
  ]);
  await flow('https-media-revoked');
  console.log(`PASS ${platform}: mounted private media removed after access revocation`);
} finally {
  await prisma.$transaction([
    ...memberships.map(row => prisma.roomMembership.update({ where: { id: row.id }, data: { disabled: row.disabled } })),
    ...invitations.map(row => prisma.roomMemberInvitation.update({ where: { id: row.id }, data: { status: row.status } })),
  ]);
  await prisma.$disconnect();
}
