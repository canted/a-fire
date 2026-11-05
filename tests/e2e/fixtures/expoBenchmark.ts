import { seedExpoReading } from './expoReading';
import { ensureUser } from './factory';
import { prisma } from './database';

export async function seedExpoBenchmark(platform: 'web' | 'ios' | 'android', isolated = false) {
  const email = `expo-${platform}-${isolated ? 'performance' : 'benchmark'}@example.test`;
  const viewer = await ensureUser(email, `${platform} benchmark`);
  const rooms = [];
  for (const count of [70, 500, 2000]) {
    const room = await seedExpoReading(count, `Expo performance ${count}`);
    const now = new Date();
    if (!await prisma.roomMembership.findFirst({ where: { room_id: room.roomId, user_id: viewer } })) {
      await prisma.roomMembership.create({ data: { room_id: room.roomId, user_id: viewer, created_at: now, updated_at: now } });
    }
    rooms.push(room);
  }
  return { email, viewer, rooms };
}
