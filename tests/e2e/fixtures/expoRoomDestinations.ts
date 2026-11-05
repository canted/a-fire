import { createUserCommunityFixture } from './factory';
import { prisma } from './database';

/** Additive fixtures only. A fresh Round avoids editing a previous test's draft. */
export async function seedExpoRoomDestinations(platform: 'web' | 'ios' | 'android', status: 'draft' | 'active' = 'active') {
  const fixture = await createUserCommunityFixture({
    email: `expo-${platform}-benchmark@example.test`, username: `${platform} benchmark`,
    roomName: `Expo ${platform} destination host ${Date.now()}`, skipEmailCleanup: true,
  });
  const now = new Date();
  const round = await prisma.round.create({ data: {
    room_id: fixture.roomId, host_id: fixture.userId,
    name: `Expo ${platform} destination Round`, prompt: 'Synthetic destination validation.',
    status, started_at: status === 'active' ? now : null, created_at: now, updated_at: now,
  } });
  return { room: fixture.roomId, round: round.id, name: round.name };
}
