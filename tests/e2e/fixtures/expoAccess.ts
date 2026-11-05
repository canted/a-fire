import { seedExpoReading } from './expoReading';
import { prisma } from './database';

/** Dedicated, reversible access transitions in the guarded test database. */
export async function seedExpoAccess() {
  const fixture = await seedExpoReading(70, 'Expo access acceptance');
  return fixture;
}
export async function setExpoAccess(kind: 'member' | 'visitor' | 'denied', viewerId?: number) {
  const fixture = await seedExpoAccess();
  const viewer = viewerId ?? fixture.viewer;
  const now = new Date();
  if (!await prisma.roomMembership.findFirst({ where: { room_id: fixture.roomId, user_id: viewer } })) {
    await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: viewer, disabled: kind !== 'member', created_at: now, updated_at: now } });
  }
  await prisma.$transaction([
    prisma.roomMembership.updateMany({ where: { room_id: fixture.roomId, user_id: viewer }, data: { disabled: kind !== 'member', updated_at: now } }),
    prisma.roomMemberInvitation.upsert({ where: { room_id_user_id: { room_id: fixture.roomId, user_id: viewer } },
      create: { room_id: fixture.roomId, user_id: viewer, invited_by_id: fixture.author, status: kind === 'visitor' ? 'pending' : 'declined', created_at: now, updated_at: now },
      update: { status: kind === 'visitor' ? 'pending' : 'declined', updated_at: now } }),
  ]);
  return { ...fixture, viewer, access: kind };
}
