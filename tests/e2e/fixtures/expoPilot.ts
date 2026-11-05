import { createUserCommunityFixture } from './factory';
import { prisma } from './database';

/** Additive fixture; database.ts rejects non-test databases before any writes. */
export async function seedExpoPilot() {
  const fixture = await createUserCommunityFixture({ email: 'expo-pilot@example.test', username: 'Expo Pilot', roomName: 'Expo Room pilot', skipEmailCleanup: true });
  const now = Date.now();
  for (let index = 1; index <= 70; index++) {
    const nonce = `expo-pilot-fixture-${index}`;
    await prisma.chatMessage.upsert({
      where: { author_id_client_nonce: { author_id: fixture.userId, client_nonce: nonce } }, update: {},
      create: {
        room_id: fixture.roomId, author_id: fixture.userId, client_nonce: nonce,
        body: `Pilot message ${index}: a small update from today's creative practice.`, masked_alias: 'Pilot member',
        fire_at: new Date(now + 86400000), expires_at: new Date(now + 172800000),
        created_at: new Date(now - (71 - index) * 60000), updated_at: new Date(now),
      },
    });
  }
  return { email: 'expo-pilot@example.test', roomId: fixture.roomId };
}
