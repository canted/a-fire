import { prisma } from './database';

/** Additive side-Room fixtures inside the established synthetic rich-content Room. */
export async function seedExpoSideEdges() {
  const parent = await prisma.room.findFirstOrThrow({ where: { name: 'Expo rich content' } });
  const owner = await prisma.user.findFirstOrThrow({ where: { email: 'expo-pilot@example.test' } });
  const viewers = await prisma.user.findMany({ where: { email: { in: ['web', 'ios', 'android'].map(platform => `expo-${platform}-benchmark@example.test`) } } });
  if (viewers.length !== 3) throw new Error('Expected all three synthetic benchmark users');
  const now = new Date();
  const rooms = [];
  for (const [name, porosity, members] of [
    ['Expo carry target', 'open', false],
    ['Expo suggestion target', 'closed', true],
    ['Expo knock target', 'closed', false],
  ] as const) {
    let room = await prisma.room.findFirst({ where: { parent_id: parent.id, name } });
    if (!room) room = await prisma.room.create({ data: { name, porosity, parent_id: parent.id, owner_id: owner.id, created_at: now, updated_at: now,
      memberships: { create: [owner, ...(members ? viewers : [])].map(user => ({ user_id: user.id, notify: false, created_at: now, updated_at: now })) } } });
    rooms.push({ id: room.id, name: room.name });
  }
  return { parent: parent.id, rooms };
}
