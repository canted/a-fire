import { createUserCommunityFixture, ensureUser } from './factory';
import { prisma } from './database';

/** Additive synthetic requests and a shared-Room invite candidate. */
export async function seedExpoRoomManagement(platform: 'web' | 'ios' | 'android') {
  const now = new Date();
  const suffix = now.getTime();
  const host = { email: `expo-${platform}-benchmark@example.test`, username: `${platform} benchmark`, skipEmailCleanup: true };
  const target = await createUserCommunityFixture({ ...host, roomName: `Expo ${platform} management ${suffix}` });
  const source = await createUserCommunityFixture({ ...host, roomName: `Expo ${platform} shared contacts ${suffix}` });
  const joinName = `${platform} join tester`;
  const knockName = `${platform} knock tester`;
  const inviteName = `${platform} invite tester`;
  const users = await Promise.all([joinName, knockName, inviteName].map((name, index) => ensureUser(`expo-${platform}-management-${suffix}-${index}@example.test`, name, now)));
  await prisma.roomJoinRequest.create({ data: { room_id: target.roomId, user_id: users[0], status: 'pending', created_at: now, updated_at: now } });
  await prisma.roomKnock.create({ data: { room_id: target.roomId, user_id: users[1], status: 'pending', created_at: now, updated_at: now } });
  await prisma.roomMembership.create({ data: { room_id: source.roomId, user_id: users[2], disabled: false, notify: false, created_at: now, updated_at: now } });
  return { room: target.roomId, joinName, knockName, inviteName };
}
