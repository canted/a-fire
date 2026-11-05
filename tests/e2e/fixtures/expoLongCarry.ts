import { createUserCommunityFixture, ensureUser } from './factory';
import { prisma } from './database';
/** Isolated long columns for real edge-scroll carrying; no production recipients. */
export async function seedExpoLongCarry(platform: 'ios' | 'android') {
  const now = new Date(); const suffix = now.getTime();
  const fixture = await createUserCommunityFixture({ email: `expo-${platform}-benchmark@example.test`, username: `${platform} benchmark`, skipEmailCleanup: true, roomName: `Expo ${platform} long carry ${suffix}` });
  const host = await prisma.user.findFirstOrThrow({ where: { email: `expo-${platform}-benchmark@example.test` } });
  for (let index = 1; index <= 24; index++) {
    const label = String(index).padStart(2, '0');
    const user = await ensureUser(`expo-${platform}-carry-${suffix}-${index}@example.test`, `Carry peer ${label}`, now);
    await prisma.roomMembership.create({ data: { room_id: fixture.roomId, user_id: user, disabled: false, notify: false, created_at: now, updated_at: now } });
    await prisma.room.create({ data: { name: `Carry destination ${label}`, parent_id: fixture.roomId, porosity: 'open', owner_id: host.id, created_at: now, updated_at: now, memberships: { create: { user_id: host.id, notify: false, created_at: now, updated_at: now } } } });
  }
  return { room: fixture.roomId };
}
